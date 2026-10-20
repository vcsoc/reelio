pub mod local_model;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::Path,
};
pub const MAX_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CUES: usize = 10_000;
pub const MAX_TIME: i64 = 99 * 3_600_000 + 59 * 60_000 + 59_999;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Cue {
    pub id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub cues: Vec<Cue>,
}
pub fn clock(ms: i64) -> String {
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3600000,
        ms / 60000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}
pub fn parse_clock(value: &str) -> Result<i64, String> {
    let bytes = value.as_bytes();
    if bytes.len() != 12
        || bytes[2] != b':'
        || bytes[5] != b':'
        || !matches!(bytes[8], b',' | b'.')
        || [0, 1, 3, 4, 6, 7, 9, 10, 11]
            .iter()
            .any(|i| !bytes[*i].is_ascii_digit())
    {
        return Err("Use HH:MM:SS,mmm timestamps".into());
    }
    let n = |a, b| value[a..b].parse::<i64>().unwrap();
    let (h, m, s, ms) = (n(0, 2), n(3, 5), n(6, 8), n(9, 12));
    if m > 59 || s > 59 {
        return Err("Minutes and seconds must be below 60".into());
    }
    Ok(((h * 60 + m) * 60 + s) * 1000 + ms)
}
impl Document {
    pub fn validate(&self, complete: bool) -> Result<(), String> {
        if self.cues.len() > MAX_CUES {
            return Err("Subtitles support at most 10,000 cues".into());
        }
        let mut ids = HashSet::new();
        let mut bytes = 0;
        for (i, c) in self.cues.iter().enumerate() {
            if c.id.is_empty() || c.id.len() > 64 || !ids.insert(&c.id) {
                return Err("Subtitle cue identities are invalid or duplicated".into());
            }
            if c.start_ms < 0 || c.end_ms <= c.start_ms || c.end_ms > MAX_TIME {
                return Err(format!("Cue {} has an invalid interval", i + 1));
            }
            if c.text.len() > 16_384
                || c.text
                    .chars()
                    .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
                || (complete
                    && (c.text.contains("\n\n")
                        || c.text.lines().any(|line| line.trim().is_empty())))
            {
                return Err(format!(
                    "Cue {} contains unsupported blank lines, control characters or oversized text",
                    i + 1
                ));
            }
            if complete && c.text.trim().is_empty() {
                return Err(format!("Cue {} needs subtitle text", i + 1));
            }
            bytes += c.text.len() + 128;
        }
        if bytes > MAX_BYTES {
            return Err("Subtitle document exceeds 4 MiB".into());
        }
        if complete && self.cues.is_empty() {
            return Err("Add at least one subtitle cue".into());
        }
        Ok(())
    }
    pub fn parse(text: &str) -> Result<Self, String> {
        if text.len() > MAX_BYTES {
            return Err("SRT file exceeds 4 MiB".into());
        }
        let normalized = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
        if normalized.contains('\r') || normalized.contains('\0') {
            return Err("SRT must be UTF-8 with LF or CRLF newlines".into());
        }
        let normalized = normalized
            .lines()
            .map(|line| if line.trim().is_empty() { "" } else { line })
            .collect::<Vec<_>>()
            .join("\n");
        let mut cues = Vec::new();
        for block in normalized
            .trim_matches('\n')
            .split("\n\n")
            .map(|b| b.trim_matches('\n'))
            .filter(|b| !b.trim().is_empty())
        {
            if cues.len() >= MAX_CUES {
                return Err("SRT exceeds 10,000 cues".into());
            }
            let mut lines = block.lines();
            let index = lines.next().ok_or("Missing cue index")?.trim();
            if index.is_empty() || !index.bytes().all(|b| b.is_ascii_digit()) {
                return Err("Each SRT block must start with a numeric cue index".into());
            }
            let timing = lines.next().ok_or("Missing SRT timestamp")?;
            let (start, end) = timing
                .split_once(" --> ")
                .ok_or("Invalid SRT timestamp separator")?;
            cues.push(Cue {
                id: uuid::Uuid::new_v4().to_string(),
                start_ms: parse_clock(start.trim())?,
                end_ms: parse_clock(end.trim())?,
                text: lines.collect::<Vec<_>>().join("\n"),
            });
        }
        let doc = Self { cues };
        doc.validate(true)?;
        Ok(doc)
    }
    pub fn srt(&self) -> Result<String, String> {
        self.validate(true)?;
        let mut out = String::new();
        for (i, c) in self.cues.iter().enumerate() {
            out.push_str(&format!(
                "{}\n{} --> {}\n{}\n\n",
                i + 1,
                clock(c.start_ms),
                clock(c.end_ms),
                c.text
            ));
        }
        if out.len() > MAX_BYTES {
            return Err("SRT output exceeds 4 MiB".into());
        }
        Ok(out)
    }
    pub fn read(path: &Path) -> Result<Self, String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("Choose a regular SRT file".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > MAX_BYTES {
            return Err("SRT exceeds 4 MiB".into());
        }
        Self::parse(
            std::str::from_utf8(&bytes)
                .map_err(|_| "SRT must be UTF-8; convert legacy encodings before importing")?,
        )
    }
    pub fn save_copy(&self, path: &Path) -> Result<(), String> {
        if path
            .extension()
            .and_then(|e| e.to_str())
            .is_none_or(|e| !e.eq_ignore_ascii_case("srt"))
        {
            return Err("Choose a new .srt filename".into());
        }
        let bytes = self.srt()?;
        let parent = path.parent().ok_or("Missing destination directory")?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        file.write_all(bytes.as_bytes())
            .map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist_noclobber(path).map_err(|_| {
            "Destination exists or cannot be published. Original files were not overwritten."
        })?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_unicode_multiline_crlf() {
        let s =
            "\u{feff}7\r\n00:00:01,002 --> 00:00:02,500\r\nHello <i>world</i>\r\nBonjour 世界\r\n";
        let d = Document::parse(s).unwrap();
        let out = d.srt().unwrap();
        let e = Document::parse(&out).unwrap();
        assert_eq!(e.cues[0].text, d.cues[0].text);
        assert_eq!(e.cues[0].start_ms, 1002);
        assert!(out.starts_with("1\n"));
    }
    #[test]
    fn invalid_and_oversized_files_fail() {
        for s in [
            "",
            "x\n00:00:00,000 --> 00:00:01,000\na",
            "1\n00:99:00,000 --> 00:00:01,000\na",
            "1\n00:00:02,000 --> 00:00:01,000\na",
        ] {
            assert!(Document::parse(s).is_err());
        }
        assert!(Document::parse(&"x".repeat(MAX_BYTES + 1)).is_err());
        for s in ["é:00:00,000", "00:00:00,00é", "999:00:00,000"] {
            assert!(parse_clock(s).is_err());
        }
    }
    #[test]
    fn original_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.srt");
        std::fs::write(&path, b"original").unwrap();
        let d = Document::parse("1\n00:00:00,000 --> 00:00:01,000\nHello\n").unwrap();
        assert!(d.save_copy(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        let copy = dir.path().join("b.srt");
        d.save_copy(&copy).unwrap();
        assert_eq!(Document::read(&copy).unwrap().cues[0].text, "Hello");
    }
    #[test]
    fn identity_and_blank_lines_validate() {
        let mut d = Document::parse("1\n00:00:00,000 --> 00:00:01,000\nHi\n").unwrap();
        d.cues.push(d.cues[0].clone());
        assert!(d.validate(false).is_err());
        d.cues.pop();
        d.cues[0].text = "a\n\nb".into();
        assert!(d.validate(false).is_ok());
        assert!(d.srt().is_err());
        let parsed=Document::parse("1\n00:00:00,000 --> 00:00:01,000\nFirst\n \n\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond\n").unwrap();
        assert_eq!(parsed.cues.len(), 2);
    }
}
