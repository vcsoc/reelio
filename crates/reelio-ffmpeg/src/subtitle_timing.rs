const LIMIT: usize = 4 * 1024 * 1024;
fn timestamp(text: &str) -> Result<i64, String> {
    let parts: Vec<_> = text.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [m, s] => ("0", *m, *s),
        [h, m, s] => (*h, *m, *s),
        _ => return Err("Invalid subtitle clock".into()),
    };
    let (seconds, millis) = seconds
        .split_once('.')
        .ok_or("Missing subtitle milliseconds")?;
    if millis.len() != 3
        || [hours, minutes, seconds, millis]
            .iter()
            .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("Invalid subtitle timestamp".into());
    }
    let number = |s: &str| {
        s.parse::<i64>()
            .map_err(|_| "Subtitle timestamp overflow".to_string())
    };
    let h = number(hours)?;
    let m = number(minutes)?;
    let s = number(seconds)?;
    let ms = number(millis)?;
    if h > 8760 || m > 59 || s > 59 {
        return Err("Subtitle timestamp outside supported range".into());
    }
    Ok(((h * 60 + m) * 60 + s) * 1000 + ms)
}
fn clock(ms: i64) -> String {
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3600000,
        ms / 60000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}
fn cues(
    text: &str,
    offset: i64,
    trim_start: i64,
    trim_end: Option<i64>,
) -> Result<Vec<(i64, i64, String)>, String> {
    if text.len() > LIMIT || !text.starts_with("WEBVTT") {
        return Err("Invalid or oversized subtitle timing data".into());
    }
    let normalized = text.replace('\r', "");
    let mut cues = Vec::new();
    let mut count = 0;
    for block in normalized.split("\n\n") {
        let lines: Vec<_> = block.lines().collect();
        let Some(index) = lines.iter().position(|s| s.contains(" --> ")) else {
            continue;
        };
        count += 1;
        if count > 10000 {
            return Err("Timeline subtitle processing supports up to 10,000 cues".into());
        }
        let (start, end) = lines[index]
            .split_once(" --> ")
            .ok_or("Invalid subtitle interval")?;
        let start = timestamp(start.trim())?;
        let end = timestamp(end.split_whitespace().next().ok_or("Missing cue end")?)?;
        if end <= start {
            return Err("Invalid subtitle cue duration".into());
        }
        let body = lines[index + 1..].join("\n");
        let start = start.max(trim_start);
        let end = end.min(trim_end.unwrap_or(i64::MAX));
        if end <= start {
            continue;
        }
        let start = start.saturating_add(offset).max(0);
        let end = end.saturating_add(offset);
        if end > start && !body.trim().is_empty() {
            cues.push((start, end, body));
        }
    }
    Ok(cues)
}
pub fn times(text: &str, offset: i64) -> Result<Vec<(i64, i64)>, String> {
    trimmed_times(text, offset, 0, None)
}
pub fn trimmed_times(
    text: &str,
    offset: i64,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<(i64, i64)>, String> {
    Ok(cues(text, offset, start, end)?
        .into_iter()
        .map(|(s, e, _)| (s, e))
        .collect())
}
#[cfg(test)]
pub fn shifted_srt(text: &str, offset: i64) -> Result<String, String> {
    trimmed_srt(text, offset, 0, None)
}
pub fn trimmed_srt(
    text: &str,
    offset: i64,
    start: i64,
    end: Option<i64>,
) -> Result<String, String> {
    let cues = cues(text, offset, start, end)?;
    if cues.is_empty() {
        return Err(
            "Subtitle lane has no cues in the retained output interval; extend its edges, move it right or exclude it".into(),
        );
    }
    let mut output = String::new();
    for (index, (start, end, body)) in cues.into_iter().enumerate() {
        output.push_str(&format!(
            "{}\n{} --> {}\n{body}\n\n",
            index + 1,
            clock(start),
            clock(end)
        ));
        if output.len() > LIMIT {
            return Err("Shifted subtitles exceed 4 MiB".into());
        }
    }
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shifts_and_clamps_cues() {
        let vtt="WEBVTT\n\n00:00.100 --> 00:00.300\ndrop\n\n00:00.300 --> 00:00.900\nclip\n\n00:01.000 --> 00:01.500\nkeep\n";
        assert_eq!(times(vtt, -500).unwrap(), vec![(0, 400), (500, 1000)]);
        let srt = shifted_srt(vtt, -500).unwrap();
        assert!(!srt.contains("drop"));
        assert!(srt.contains("00:00:00,000 --> 00:00:00,400"));
    }
    #[test]
    fn rejects_oversized_and_invalid_clocks() {
        assert!(times("WEBVTT\n\n00:99.000 --> 00:99.500\nx", 0).is_err());
        assert!(times(
            "WEBVTT\n\n99999999999999999999:00:00.000 --> 00:01.000\nx",
            0
        )
        .is_err());
        assert!(shifted_srt("WEBVTT\n\n00:00.100 --> 00:00.300\nx", -500).is_err());
    }
}
