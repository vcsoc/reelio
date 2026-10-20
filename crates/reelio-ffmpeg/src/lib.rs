use reelio_domain::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

mod preview;
pub use tempfile::NamedTempFile as PreparedPreview;
const MAX_PROBE: u64 = 8 * 1024 * 1024;
const FORMATS: &str = "mov,matroska,webm,avi,mpegts,mpeg,aac,mp3,flac,ogg,wav,aiff,srt,ass,webvtt,jpeg_pipe,png_pipe,webp_pipe";
fn still_image_demuxer(path: &Path) -> Result<Option<&'static str>, String> {
    let mut header = Vec::with_capacity(12);
    fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(12)
        .read_to_end(&mut header)
        .map_err(|error| error.to_string())?;
    Ok(if header.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpeg_pipe")
    } else if header.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png_pipe")
    } else if header.len() == 12 && &header[..4] == b"RIFF" && &header[8..] == b"WEBP" {
        Some("webp_pipe")
    } else {
        None
    })
}

pub trait MediaBackend: Send + Sync {
    fn probe(&self, path: &Path) -> Result<Asset, String>;
    fn capabilities(&self) -> Result<Capabilities, String>;
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub ffmpeg_version: String,
    pub ffprobe_version: String,
    pub muxers: Vec<String>,
    pub subtitle_encoders: Vec<String>,
}
#[derive(Debug, Clone)]
pub struct Ffmpeg {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}
impl Default for Ffmpeg {
    fn default() -> Self {
        Self {
            ffmpeg: "ffmpeg".into(),
            ffprobe: "ffprobe".into(),
        }
    }
}
fn executable(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return fs::canonicalize(path).map_err(|e| format!("Backend unavailable: {e}"));
    }
    if path.components().count() != 1 {
        return Err("Backend path must be absolute or a bare executable name".into());
    }
    let name = path.to_string_lossy();
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let candidate = dir.join(path);
        if candidate.is_file() {
            return fs::canonicalize(candidate).map_err(|e| e.to_string());
        }
        #[cfg(windows)]
        {
            let candidate = dir.join(format!("{name}.exe"));
            if candidate.is_file() {
                return fs::canonicalize(candidate).map_err(|e| e.to_string());
            }
        }
    }
    Err(format!(
        "Backend {name} was not found. Install FFmpeg or configure absolute executable paths."
    ))
}
fn host_backend_environment(command: &mut Command, appimage: bool) {
    if appimage {
        // Bundled media libraries are for WebKit/GStreamer, not the host's FFmpeg ABI.
        command.env_remove("LD_LIBRARY_PATH");
    }
}
fn command(path: &Path) -> Result<Command, String> {
    let mut c = Command::new(executable(path)?);
    host_backend_environment(
        &mut c,
        std::env::var_os("APPDIR").is_some() || std::env::var_os("APPIMAGE").is_some(),
    );
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(c)
}
fn capture(cmd: Command, timeout: Duration) -> Result<String, String> {
    String::from_utf8(capture_bytes(cmd, timeout)?)
        .map_err(|_| "Backend returned invalid UTF-8".into())
}
fn capture_bytes(mut cmd: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start media backend: {e}"))?;
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    let overflow = Arc::new(AtomicBool::new(false));
    fn reader<R: Read + Send + 'static>(
        mut r: R,
        overflow: Arc<AtomicBool>,
    ) -> thread::JoinHandle<Vec<u8>> {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let mut buf = [0; 8192];
            while let Ok(n) = r.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if bytes.len() + n > MAX_PROBE as usize {
                    overflow.store(true, Ordering::SeqCst);
                    break;
                }
                bytes.extend_from_slice(&buf[..n]);
            }
            bytes
        })
    }
    let o = reader(out, overflow.clone());
    let e = reader(err, overflow.clone());
    let start = Instant::now();
    let status = loop {
        if overflow.load(Ordering::SeqCst) || start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = o.join();
            let _ = e.join();
            return Err("Backend exceeded output or time limits".into());
        }
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => thread::sleep(Duration::from_millis(15)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e.to_string());
            }
        }
    };
    let stdout = o.join().map_err(|_| "Backend reader failed")?;
    let stderr = e.join().map_err(|_| "Backend reader failed")?;
    if overflow.load(Ordering::SeqCst) {
        return Err("Backend output exceeded limit".into());
    }
    if !status.success() {
        return Err(format!(
            "Media backend rejected the file or operation: {}",
            String::from_utf8_lossy(&stderr)
        ));
    }
    Ok(stdout)
}
fn scalar(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
fn millis(v: &Value) -> Option<i64> {
    let n = scalar(v)?.parse::<f64>().ok()?;
    if n.is_finite() && (0.0..1e12).contains(&n) {
        Some((n * 1000.0).round() as i64)
    } else {
        None
    }
}
fn clock_duration(text: &str) -> Option<i64> {
    if text.len() > 64
        || !text
            .bytes()
            .all(|c| c.is_ascii_digit() || c == b':' || c == b'.')
    {
        return None;
    }
    let parts: Vec<_> = text.split(':').collect();
    let [hours, minutes, seconds] = parts.as_slice() else {
        return None;
    };
    let hours = hours.parse::<u32>().ok()?;
    let minutes = minutes.parse::<u32>().ok()?;
    let seconds = seconds.parse::<f64>().ok()?;
    if hours > 8760 || minutes >= 60 || !seconds.is_finite() || !(0.0..60.0).contains(&seconds) {
        return None;
    }
    Some(
        ((f64::from(hours) * 3600.0 + f64::from(minutes) * 60.0 + seconds) * 1000.0).round() as i64,
    )
}
fn tags(v: &Value) -> BTreeMap<String, String> {
    v.as_object()
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| scalar(v).map(|v| (k.to_lowercase(), v)))
                .collect()
        })
        .unwrap_or_default()
}
pub fn fingerprint(path: &Path) -> Result<(u64, u64), String> {
    let m = fs::metadata(path).map_err(|e| format!("Source is unavailable: {e}"))?;
    if !m.is_file() {
        return Err("Only regular local files are supported".into());
    }
    let modified = m
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis()
        .min(u64::MAX as u128) as u64;
    Ok((m.len(), modified))
}
impl MediaBackend for Ffmpeg {
    fn probe(&self, path: &Path) -> Result<Asset, String> {
        let path = fs::canonicalize(path).map_err(|e| format!("Missing source: {e}"))?;
        let (size, modified_ms) = fingerprint(&path)?;
        let image_demuxer = still_image_demuxer(&path)?;
        if image_demuxer.is_some() && size > 8 * 1024 * 1024 {
            return Err("Still images must be smaller than 8 MiB".into());
        }
        let mut cmd = command(&self.ffprobe)?;
        cmd.args([
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            FORMATS,
            "-show_format",
            "-show_streams",
            "-show_chapters",
            "-of",
            "json",
        ]);
        // Force a single-file demuxer by signature; image2 may interpret filenames as sequences.
        if let Some(format) = image_demuxer {
            cmd.args(["-f", format]);
        }
        cmd.arg(&path);
        let raw = capture(cmd, Duration::from_secs(30))?;
        let mut asset = parse_probe(&raw, path.clone(), size, modified_ms)?;
        if asset.duration_ms.is_none()
            && !asset.streams.is_empty()
            && asset.streams.iter().all(|s| s.kind == StreamKind::Subtitle)
            && ["srt", "ass", "webvtt"].contains(&asset.format.as_str())
        {
            let mut packets = command(&self.ffprobe)?;
            packets
                .args([
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file",
                    "-format_whitelist",
                    FORMATS,
                    "-select_streams",
                    "s",
                    "-show_entries",
                    "packet=pts_time,duration_time",
                    "-of",
                    "json",
                ])
                .arg(&path);
            let data: Value = serde_json::from_str(&capture(packets, Duration::from_secs(30))?)
                .map_err(|e| format!("Invalid subtitle timing response: {e}"))?;
            if let Some(packets) = data["packets"].as_array() {
                if packets.len() > 10000 {
                    return Err("Subtitle timeline supports up to 10,000 cues".into());
                }
                asset.duration_ms = packets
                    .iter()
                    .filter_map(|packet| {
                        Some(millis(&packet["pts_time"])? + millis(&packet["duration_time"])?)
                    })
                    .max();
            }
        }
        Ok(asset)
    }
    fn capabilities(&self) -> Result<Capabilities, String> {
        let run = |path: &Path, args: &[&str]| -> Result<String, String> {
            let mut c = command(path)?;
            c.args(args);
            capture(c, Duration::from_secs(15))
        };
        let version = run(&self.ffmpeg, &["-version"])?;
        let probe = run(&self.ffprobe, &["-version"])?;
        let muxers = run(&self.ffmpeg, &["-hide_banner", "-muxers"])?;
        let encoders = run(&self.ffmpeg, &["-hide_banner", "-encoders"])?;
        Ok(Capabilities {
            ffmpeg_version: version.lines().next().unwrap_or_default().into(),
            ffprobe_version: probe.lines().next().unwrap_or_default().into(),
            muxers: ["mp4", "matroska"]
                .iter()
                .filter(|m| {
                    muxers
                        .lines()
                        .any(|l| l.split_whitespace().nth(1) == Some(**m))
                })
                .map(|m| m.to_string())
                .collect(),
            subtitle_encoders: ["mov_text", "srt", "webvtt"]
                .iter()
                .filter(|m| {
                    encoders
                        .lines()
                        .any(|l| l.split_whitespace().nth(1) == Some(**m))
                })
                .map(|m| {
                    if *m == "srt" {
                        "subrip".into()
                    } else {
                        m.to_string()
                    }
                })
                .collect(),
        })
    }
}
pub fn parse_probe(raw: &str, path: PathBuf, size: u64, modified_ms: u64) -> Result<Asset, String> {
    let v: Value =
        serde_json::from_str(raw).map_err(|e| format!("Malformed probe response: {e}"))?;
    let format = v["format"]["format_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let arr = v["streams"].as_array().ok_or("No readable streams found")?;
    if arr.is_empty() || arr.len() > 4096 {
        return Err("File has no streams or too many streams".into());
    }
    let mut streams = vec![];
    for s in arr {
        let kind = match s["codec_type"].as_str().unwrap_or("") {
            "video" => StreamKind::Video,
            "audio" => StreamKind::Audio,
            "subtitle" => StreamKind::Subtitle,
            "attachment" => StreamKind::Attachment,
            _ => StreamKind::Data,
        };
        let mut properties = BTreeMap::new();
        for key in [
            "profile",
            "codec_tag_string",
            "width",
            "height",
            "r_frame_rate",
            "avg_frame_rate",
            "nb_frames",
            "pix_fmt",
            "bits_per_raw_sample",
            "bit_rate",
            "sample_rate",
            "channels",
            "channel_layout",
            "display_aspect_ratio",
            "color_primaries",
            "color_transfer",
            "color_space",
            "start_time",
        ] {
            if let Some(x) = scalar(&s[key]) {
                properties.insert(key.into(), x);
            }
        }
        properties.insert("source_format".into(), format.clone());
        if matches!(format.as_str(), "jpeg_pipe" | "png_pipe" | "webp_pipe")
            || v["format"]["tags"]["major_brand"]
                .as_str()
                .is_some_and(|brand| brand.trim() == "avif")
        {
            properties.insert("still_image".into(), "1".into());
        }
        if s["disposition"]["attached_pic"].as_i64() == Some(1) {
            properties.insert("attached_pic".into(), "1".into());
        }
        if let Some(side) = s.get("side_data_list") {
            properties.insert("side_data".into(), side.to_string());
        }
        let t = tags(&s["tags"]);
        for key in ["handler_name", "filename", "mimetype"] {
            if let Some(value) = t.get(key) {
                properties.insert(key.into(), value.clone());
            }
        }
        for flag in ["comment", "visual_impaired", "hearing_impaired"] {
            properties.insert(
                flag.into(),
                s["disposition"][flag].as_i64().unwrap_or(0).to_string(),
            );
        }
        streams.push(Stream {
            index: s["index"]
                .as_u64()
                .and_then(|i| u32::try_from(i).ok())
                .ok_or("Invalid stream index")?,
            kind,
            codec: s["codec_name"].as_str().unwrap_or("unknown").into(),
            title: t.get("title").cloned().unwrap_or_default(),
            language: t
                .get("language")
                .filter(|l| l.len() == 3 && l.bytes().all(|b| b.is_ascii_alphabetic()))
                .cloned()
                .unwrap_or("und".into()),
            duration_ms: millis(&s["duration"])
                .or_else(|| t.get("duration").and_then(|value| clock_duration(value))),
            default: s["disposition"]["default"].as_i64() == Some(1),
            forced: s["disposition"]["forced"].as_i64() == Some(1),
            properties,
        });
    }
    let mut chapters = vec![];
    if let Some(items) = v["chapters"].as_array() {
        if items.len() > 10000 {
            return Err("Source exceeds chapter count limit".into());
        }
        for c in items {
            chapters.push(Chapter {
                start_ms: millis(&c["start_time"])
                    .ok_or("Source has malformed or negative chapter start timing")?,
                end_ms: millis(&c["end_time"])
                    .ok_or("Source has malformed or negative chapter end timing")?,
                title: tags(&c["tags"]).get("title").cloned().unwrap_or_default(),
            });
        }
    }
    Ok(Asset {
        id: id(),
        path,
        format,
        size,
        modified_ms,
        duration_ms: millis(&v["format"]["duration"]),
        streams,
        metadata: tags(&v["format"]["tags"]),
        chapters,
    })
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    pub phase: String,
    pub processed_ms: i64,
    pub percent: Option<f64>,
    pub bytes: u64,
    pub elapsed_ms: u64,
    #[serde(default)]
    pub notices: Vec<String>,
}
fn arg(args: &mut Vec<OsString>, key: impl Into<OsString>, value: impl Into<OsString>) {
    args.push(key.into());
    args.push(value.into());
}
pub fn build_args(
    p: &Project,
    plan: &ExportPlan,
    chapter_file: Option<&Path>,
    artwork_file: Option<&Path>,
    output: &Path,
) -> Result<Vec<OsString>, String> {
    build_args_prepared(
        p,
        plan,
        chapter_file,
        artwork_file,
        output,
        &BTreeMap::new(),
    )
}
mod subtitle_timing;
fn build_args_prepared(
    p: &Project,
    plan: &ExportPlan,
    chapter_file: Option<&Path>,
    artwork_file: Option<&Path>,
    output: &Path,
    subtitle_sources: &BTreeMap<String, PathBuf>,
) -> Result<Vec<OsString>, String> {
    if !plan.errors.is_empty() {
        return Err(plan.errors.join("; "));
    }
    let (prepared, _) = p.fit_to_video();
    let p = &prepared;
    let mut args: Vec<OsString> = ["-hide_banner", "-nostdin", "-v", "error", "-y"]
        .map(Into::into)
        .to_vec();
    for a in &p.assets {
        args.extend(["-protocol_whitelist", "file", "-format_whitelist", FORMATS].map(Into::into));
        arg(&mut args, "-i", a.path.as_os_str());
    }
    let shifted: Vec<_> = plan
        .tracks
        .iter()
        .filter_map(|mapped| p.tracks.iter().find(|t| t.id == mapped.track_id))
        .filter(|t| {
            (t.offset_ms != 0 || t.is_trimmed())
                && p.stream(t).is_some_and(|s| s.kind == StreamKind::Subtitle)
        })
        .collect();
    for t in &shifted {
        args.extend(["-protocol_whitelist", "file", "-format_whitelist", FORMATS].map(Into::into));
        arg(
            &mut args,
            "-itsoffset",
            format!(
                "{:.3}",
                if subtitle_sources.contains_key(&t.id) {
                    0.0
                } else {
                    t.offset_ms as f64 / 1000.0
                }
            ),
        );
        let asset = p
            .assets
            .iter()
            .find(|a| a.id == t.asset_id)
            .ok_or("Missing shifted subtitle source")?;
        if (t.offset_ms < 0 || t.is_trimmed()) && !subtitle_sources.contains_key(&t.id) {
            return Err(
                "Negative subtitle offsets must be normalized before argument generation".into(),
            );
        }
        arg(
            &mut args,
            "-i",
            subtitle_sources
                .get(&t.id)
                .unwrap_or(&asset.path)
                .as_os_str(),
        );
    }
    let input_count = p.assets.len() + shifted.len();
    if let Some(path) = chapter_file {
        args.extend(["-f", "ffmetadata"].map(Into::into));
        arg(&mut args, "-i", path.as_os_str());
    }
    if let Some(path) = artwork_file.filter(|_| p.container != Container::Matroska) {
        args.extend(
            [
                "-protocol_whitelist",
                "file",
                "-f",
                "image2",
                "-pattern_type",
                "none",
            ]
            .map(Into::into),
        );
        arg(&mut args, "-i", path.as_os_str());
    }
    if p.artwork.is_some() != artwork_file.is_some() {
        return Err("Artwork must be decoded and staged before export".into());
    }
    arg(&mut args, "-map_metadata:g", "-1");
    arg(
        &mut args,
        "-map_chapters",
        if chapter_file.is_some() {
            input_count.to_string()
        } else {
            "-1".into()
        },
    );
    let mut filters = Vec::new();
    for mapped in &plan.tracks {
        let t = p
            .tracks
            .iter()
            .find(|t| t.id == mapped.track_id)
            .ok_or("Missing planned track")?;
        let original_input = p
            .assets
            .iter()
            .position(|a| a.id == t.asset_id)
            .ok_or("Missing source")?;
        let input = shifted
            .iter()
            .position(|s| s.id == t.id)
            .map(|n| p.assets.len() + n)
            .unwrap_or(original_input);
        let i = mapped.output_index;
        match mapped.compatibility.action {
            Action::RenderAudio => {
                let sources: Vec<_> = if mapped.mix_sources.is_empty() {
                    vec![t]
                } else {
                    mapped
                        .mix_sources
                        .iter()
                        .map(|id| {
                            p.tracks
                                .iter()
                                .find(|t| &t.id == id)
                                .ok_or("Missing mix input")
                        })
                        .collect::<Result<_, _>>()?
                };
                let mut labels = String::new();
                for (n, source) in sources.iter().enumerate() {
                    let source_input = p
                        .assets
                        .iter()
                        .position(|a| a.id == source.asset_id)
                        .ok_or("Missing mix source")?;
                    let start = source.trim_start_ms.max(-source.offset_ms).max(0);
                    let trim = start as f64 / 1000.0;
                    let end = source
                        .trim_end_ms
                        .map(|e| format!(":end={:.3}", e as f64 / 1000.0))
                        .unwrap_or_default();
                    // AAC trimming/delay can propagate unknown PTS; rebuild a sample clock after padding.
                    filters.push(format!("[{source_input}:{}]atrim=start={trim:.3}{end},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay={}:all=1,asetpts=N/SR/TB[a{i}_{n}]",source.stream_index,source.offset_ms.saturating_add(start).max(0)));
                    labels.push_str(&format!("[a{i}_{n}]"));
                }
                filters.push(format!("{labels}amix=inputs={}:duration=longest:dropout_transition=0:normalize=1[out{i}]",sources.len()));
                arg(&mut args, "-map", format!("[out{i}]"));
                arg(&mut args, format!("-b:{i}"), "192k");
            }
            Action::RenderVideo => {
                let start = t.trim_start_ms.max(-t.offset_ms).max(0);
                let trim = start as f64 / 1000.0;
                let pad = t.offset_ms.saturating_add(start).max(0) as f64 / 1000.0;
                let end = t
                    .trim_end_ms
                    .map(|e| format!(":end={:.3}", e as f64 / 1000.0))
                    .unwrap_or_default();
                filters.push(format!("[{input}:{}]trim=start={trim:.3}{end},setpts=PTS-STARTPTS,tpad=start_duration={pad:.3}:start_mode=add:color=black,format=yuv420p[out{i}]",t.stream_index));
                arg(&mut args, "-map", format!("[out{i}]"));
                arg(&mut args, format!("-crf:{i}"), "18");
            }
            _ => arg(
                &mut args,
                "-map",
                format!(
                    "{input}:{}",
                    if subtitle_sources.contains_key(&t.id) {
                        0
                    } else {
                        t.stream_index
                    }
                ),
            ),
        }
        arg(
            &mut args,
            format!("-c:{i}"),
            if mapped.compatibility.action == Action::RenderVideo {
                "libx264"
            } else {
                mapped
                    .compatibility
                    .target_codec
                    .as_deref()
                    .unwrap_or("copy")
            },
        );
        if mapped.compatibility.action == Action::BitstreamFilter {
            arg(&mut args, format!("-bsf:{i}"), "aac_adtstoasc");
        }
        arg(
            &mut args,
            format!("-metadata:s:{i}"),
            format!("language={}", t.language),
        );
        arg(
            &mut args,
            format!("-metadata:s:{i}"),
            format!("title={}", t.title),
        );
        // MP4 stores a track label as handler_name rather than the generic title tag.
        if p.container != Container::Matroska {
            arg(
                &mut args,
                format!("-metadata:s:{i}"),
                format!("handler_name={}", t.title),
            );
        }
        let mut flags = vec![];
        if mapped.default {
            flags.push("default");
        }
        if t.forced {
            flags.push("forced");
        }
        if t.commentary {
            flags.push("comment");
        }
        if t.descriptive {
            flags.push("visual_impaired");
        }
        arg(
            &mut args,
            format!("-disposition:{i}"),
            if flags.is_empty() {
                "0".into()
            } else {
                flags.join("+")
            },
        );
    }
    if !filters.is_empty() {
        arg(&mut args, "-filter_complex", filters.join(";"));
        arg(&mut args, "-filter_complex_threads", "2");
    }
    if !shifted.is_empty() {
        arg(&mut args, "-avoid_negative_ts", "disabled");
    }
    if let Some(path) = artwork_file {
        if p.container == Container::Matroska {
            arg(&mut args, "-attach", path.as_os_str());
            arg(&mut args, "-metadata:s:t:0", "mimetype=image/jpeg");
            arg(&mut args, "-metadata:s:t:0", "filename=cover.jpg");
        } else {
            let input = input_count + usize::from(chapter_file.is_some());
            let output = plan.tracks.len();
            arg(&mut args, "-map", format!("{input}:0"));
            arg(&mut args, format!("-c:{output}"), "copy");
            arg(&mut args, format!("-disposition:{output}"), "attached_pic");
        }
    }
    for (key, value) in &p.metadata {
        if metadata_writable(p.container, key) {
            arg(&mut args, "-metadata", format!("{key}={value}"));
        }
    }
    if p.container != Container::Matroska {
        arg(&mut args, "-movflags", "+faststart");
    }
    args.extend(["-progress", "pipe:1", "-nostats"].map(Into::into));
    arg(&mut args, "-f", p.container.muxer());
    args.push(output.as_os_str().into());
    Ok(args)
}
fn escape_metadata(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('=', "\\=")
        .replace(';', "\\;")
        .replace('#', "\\#")
        .replace('\n', "\\\n")
        .replace('\r', "")
}
pub fn verify(p: &Project, plan: &ExportPlan, actual: &Asset) -> Result<(), String> {
    let auxiliary_chapter_stream = p.container != Container::Matroska && !p.chapters.is_empty();
    let expected_count = plan.tracks.len()
        + usize::from(auxiliary_chapter_stream)
        + usize::from(p.artwork.is_some());
    if actual.streams.len() != expected_count {
        return Err(format!("Verification failed: expected {expected_count} streams including chapter representation, found {}",actual.streams.len()));
    }
    if auxiliary_chapter_stream {
        let chapter = actual
            .streams
            .iter()
            .skip(plan.tracks.len())
            .find(|s| s.kind == StreamKind::Data)
            .ok_or("Missing MP4 chapter stream")?;
        if chapter.kind != StreamKind::Data
            || chapter.codec != "bin_data"
            || chapter
                .properties
                .get("codec_tag_string")
                .map(String::as_str)
                != Some("text")
            || chapter.properties.get("handler_name").map(String::as_str) != Some("SubtitleHandler")
        {
            return Err(
                "Verification failed: MP4 auxiliary chapter stream representation differs".into(),
            );
        }
    }
    if let Some(artwork) = &p.artwork {
        let cover = actual
            .streams
            .iter()
            .skip(plan.tracks.len())
            .find(|s| s.properties.contains_key("attached_pic"))
            .ok_or("Verification failed: missing attached cover image")?;
        if cover.codec != "mjpeg"
            || cover.properties.get("width") != Some(&artwork.width.to_string())
            || cover.properties.get("height") != Some(&artwork.height.to_string())
        {
            return Err("Verification failed: artwork codec or dimensions differ".into());
        }
        if p.container == Container::Matroska
            && (cover.properties.get("filename").map(String::as_str) != Some("cover.jpg")
                || cover.properties.get("mimetype").map(String::as_str) != Some("image/jpeg"))
        {
            return Err("Verification failed: Matroska cover attachment metadata differs".into());
        }
    }
    for (expected, found) in plan.tracks.iter().zip(&actual.streams) {
        let t = p
            .tracks
            .iter()
            .find(|t| t.id == expected.track_id)
            .ok_or("Missing track")?;
        let source = p.stream(t).ok_or("Missing stream")?;
        let codec = expected
            .compatibility
            .target_codec
            .as_deref()
            .unwrap_or(&source.codec);
        if found.codec != codec || found.kind != source.kind {
            return Err(format!(
                "Verification failed: output stream {} codec/type mismatch",
                expected.output_index
            ));
        }
        // Verify the same resolved default used for muxing, including automatic MP4 choices.
        if found.language != t.language
            || found.default != expected.default
            || found.forced != t.forced
        {
            return Err(format!("Verification failed: output stream {} language/default/forced is {}/{}/{}, expected {}/{}/{}",expected.output_index,found.language,found.default,found.forced,t.language,expected.default,t.forced));
        }
        if (found.properties.get("comment").is_some_and(|v| v == "1")) != t.commentary
            || (found
                .properties
                .get("visual_impaired")
                .is_some_and(|v| v == "1"))
                != t.descriptive
        {
            return Err(format!(
                "Verification failed: output stream {} accessibility dispositions differ",
                expected.output_index
            ));
        }
        if !t.title.is_empty() {
            let title_ok =
                found.title == t.title || found.properties.get("handler_name") == Some(&t.title);
            if !title_ok {
                return Err(format!(
                    "Verification failed: output stream {} title differs",
                    expected.output_index
                ));
            }
        }
    }
    if actual.chapters.len() != plan.chapters.len() {
        return Err("Verification failed: chapter count differs".into());
    }
    for (a, b) in actual.chapters.iter().zip(&plan.chapters) {
        if (a.start_ms - b.start_ms).abs() > 5
            || (a.end_ms - b.end_ms).abs() > 5
            || a.title != b.title
        {
            return Err(format!("Verification failed: chapter timing/title differs: found {}..{} {:?}, expected {}..{} {:?}",a.start_ms,a.end_ms,a.title,b.start_ms,b.end_ms,b.title));
        }
    }
    for (key, value) in &p.metadata {
        if metadata_writable(p.container, key) && actual.metadata.get(key) != Some(value) {
            return Err(format!(
                "Verification failed: metadata '{key}' was not preserved by this backend"
            ));
        }
    }
    let expected_duration = plan.duration_ms;
    if expected_duration.is_some_and(|d| d > 0) && actual.duration_ms.is_none_or(|d| d <= 0) {
        return Err("Verification failed: cannot verify the expected output duration".into());
    }
    if let (Some(expected), Some(found)) = (expected_duration, actual.duration_ms) {
        if (expected - found).abs() > 2000.max(expected / 100) {
            return Err("Verification failed: duration differs beyond tolerance".into());
        }
    }
    Ok(())
}
impl Ffmpeg {
    pub fn subtitle_preview(&self, path: &Path, index: u32) -> Result<String, String> {
        let asset = self.probe(path)?;
        let stream = asset
            .streams
            .iter()
            .find(|s| s.index == index)
            .ok_or("Subtitle stream no longer exists")?;
        if stream.kind != StreamKind::Subtitle
            || !["subrip", "ass", "ssa", "webvtt", "mov_text"].contains(&stream.codec.as_str())
        {
            return Err(
                "Preview supports text subtitles only; image-subtitle OCR is not implemented"
                    .into(),
            );
        }
        if !self
            .capabilities()?
            .subtitle_encoders
            .iter()
            .any(|s| s == "webvtt")
        {
            return Err("The configured FFmpeg backend lacks the WebVTT preview encoder".into());
        }
        let mut cmd = command(&self.ffmpeg)?;
        cmd.args([
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            FORMATS,
            "-i",
        ])
        .arg(path)
        .args([
            "-map",
            &format!("0:{index}"),
            "-c:s",
            "webvtt",
            "-f",
            "webvtt",
            "pipe:1",
        ]);
        let text = capture(cmd, Duration::from_secs(20))?;
        if text.len() > 4 * 1024 * 1024 || !text.starts_with("WEBVTT") {
            return Err("Subtitle preview exceeds 4 MiB or is invalid WebVTT".into());
        }
        Ok(text)
    }
    pub fn export(
        &self,
        p: &Project,
        destination: &Path,
        approve_conversion: bool,
        cancel: &AtomicBool,
        mut progress: impl FnMut(Progress),
    ) -> Result<PathBuf, String> {
        let mut plan = plan(p);
        let (prepared, mut adjustments) = p.fit_to_video();
        let mut notices = Vec::new();
        let p = &prepared;
        if !plan.errors.is_empty() {
            return Err(plan.errors.join("; "));
        }
        let caps = self.capabilities()?;
        if !caps.muxers.contains(&p.container.muxer().to_string()) {
            return Err("Configured FFmpeg lacks the required muxer".into());
        }
        let rendering = plan.tracks.iter().any(|t| {
            matches!(
                t.compatibility.action,
                Action::RenderAudio | Action::RenderVideo
            )
        });
        let render_encoders = if rendering {
            let mut command = command(&self.ffmpeg)?;
            command.args(["-hide_banner", "-encoders"]);
            Some(capture(command, Duration::from_secs(15))?)
        } else {
            None
        };
        for t in &plan.tracks {
            if let Some(codec) = &t.compatibility.target_codec {
                if !approve_conversion {
                    return Err(
                        "Subtitle conversion or timeline rendering requires explicit approval"
                            .into(),
                    );
                }
                if matches!(
                    t.compatibility.action,
                    Action::RenderAudio | Action::RenderVideo
                ) {
                    let encoder = if codec == "h264" {
                        "libx264"
                    } else {
                        codec.as_str()
                    };
                    if !render_encoders.as_ref().is_some_and(|text| {
                        text.lines()
                            .any(|line| line.split_whitespace().nth(1) == Some(encoder))
                    }) {
                        return Err(format!("Backend lacks required render encoder: {encoder}"));
                    }
                } else if !caps.subtitle_encoders.contains(codec) {
                    return Err(format!("Backend lacks subtitle encoder: {codec}"));
                }
            }
        }
        if destination.exists() {
            return Err("Destination already exists. Choose a new path; existing files are never overwritten.".into());
        }
        if destination.extension().and_then(|s| s.to_str()) != Some(p.container.extension()) {
            return Err(format!("Output must end in .{}", p.container.extension()));
        }
        let parent = fs::canonicalize(
            destination
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )
        .map_err(|e| e.to_string())?;
        let destination = parent.join(destination.file_name().ok_or("Invalid destination")?);
        for a in &p.assets {
            if fs::canonicalize(&a.path).map_err(|e| e.to_string())? == destination {
                return Err("Output must not replace a source".into());
            }
            if fingerprint(&a.path)? != (a.size, a.modified_ms) {
                return Err("Source changed since import. Re-import before exporting.".into());
            }
        }
        let temp = tempfile::Builder::new()
            .prefix(".reelio-export-")
            .suffix(&format!(".{}", p.container.extension()))
            .tempfile_in(&parent)
            .map_err(|e| e.to_string())?;
        let mut chapters = tempfile::NamedTempFile::new_in(&parent).map_err(|e| e.to_string())?;
        writeln!(chapters, ";FFMETADATA1").map_err(|e| e.to_string())?;
        for c in &plan.chapters {
            writeln!(
                chapters,
                "[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle={}",
                c.start_ms,
                c.end_ms,
                escape_metadata(&c.title)
            )
            .map_err(|e| e.to_string())?;
        }
        chapters.flush().map_err(|e| e.to_string())?;
        let artwork_bytes = p
            .artwork
            .as_ref()
            .map(reelio_artwork::jpeg_bytes)
            .transpose()?;
        let artwork_file = if let Some(bytes) = &artwork_bytes {
            let mut file = tempfile::Builder::new()
                .prefix(".reelio-cover-")
                .suffix(".jpg")
                .tempfile_in(&parent)
                .map_err(|e| e.to_string())?;
            file.write_all(bytes)
                .and_then(|_| file.flush())
                .map_err(|e| e.to_string())?;
            Some(file)
        } else {
            None
        };
        let mut subtitle_files = Vec::new();
        let mut subtitle_sources = BTreeMap::new();
        let mut subtitle_times = BTreeMap::new();
        let mut empty_subtitles = Vec::new();
        for mapped in &plan.tracks {
            let t = p
                .tracks
                .iter()
                .find(|t| t.id == mapped.track_id)
                .ok_or("Missing subtitle track")?;
            if (t.offset_ms == 0 && !t.is_trimmed())
                || !p.stream(t).is_some_and(|s| s.kind == StreamKind::Subtitle)
            {
                continue;
            }
            if cancel.load(Ordering::SeqCst) {
                return Err("Cancelled; source files are safe".into());
            }
            let source = p
                .assets
                .iter()
                .find(|a| a.id == t.asset_id)
                .ok_or("Missing subtitle source")?;
            let vtt = self.subtitle_preview(&source.path, t.stream_index)?;
            let times =
                subtitle_timing::trimmed_times(&vtt, t.offset_ms, t.trim_start_ms, t.trim_end_ms)?;
            if times.is_empty() {
                if p.video_duration().is_some() {
                    adjustments.retain(|notice| notice.track_id.as_deref() != Some(t.id.as_str()));
                    notices.push(format!("Omitted subtitle '{}' [{}]: no cues intersect the video timeline after offsets and trims.", t.title.chars().take(160).collect::<String>(), t.id));
                    empty_subtitles.push(t.id.clone());
                    continue;
                }
                return Err("Trimmed/positioned subtitle lane has no cues in the retained output interval; extend its edges or exclude it".into());
            }
            subtitle_times.insert(mapped.track_id.clone(), times);
            if t.offset_ms < 0 || t.is_trimmed() {
                let srt = subtitle_timing::trimmed_srt(
                    &vtt,
                    t.offset_ms,
                    t.trim_start_ms,
                    t.trim_end_ms,
                )?;
                let mut file = tempfile::Builder::new()
                    .prefix(".reelio-subtitles-")
                    .suffix(".srt")
                    .tempfile_in(&parent)
                    .map_err(|e| e.to_string())?;
                file.write_all(srt.as_bytes())
                    .and_then(|_| file.flush())
                    .map_err(|e| e.to_string())?;
                subtitle_sources.insert(t.id.clone(), file.path().to_path_buf());
                subtitle_files.push(file);
            }
        }
        plan.tracks
            .retain(|track| !empty_subtitles.contains(&track.track_id));
        for (index, track) in plan.tracks.iter_mut().enumerate() {
            track.output_index = index;
        }
        if p.container != Container::Matroska {
            let mut subtitles = plan.tracks.iter_mut().filter(|mapped| {
                p.tracks
                    .iter()
                    .find(|track| track.id == mapped.track_id)
                    .and_then(|track| p.stream(track))
                    .is_some_and(|stream| stream.kind == StreamKind::Subtitle)
            });
            if let Some(first) = subtitles.next() {
                if !first.default && !subtitles.any(|track| track.default) {
                    first.default = true;
                    notices.push(format!("Selected output subtitle [{}] as default after cropping removed the previous default.", first.track_id));
                }
            }
        }
        let args = build_args_prepared(
            p,
            &plan,
            if p.chapters.is_empty() {
                None
            } else {
                Some(chapters.path())
            },
            artwork_file.as_ref().map(|f| f.path()),
            temp.path(),
            &subtitle_sources,
        )?;
        let mut cmd = command(&self.ffmpeg)?;
        cmd.args(args);
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelled; source files are safe".into());
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let (tx, rx) = std::sync::mpsc::sync_channel(256);
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.len() > 8192 {
                    break;
                }
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let err_reader = thread::spawn(move || {
            let mut tail = Vec::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                tail.extend_from_slice(&buf[..n]);
                if tail.len() > 65536 {
                    tail.drain(..tail.len() - 65536);
                }
            }
            tail
        });
        let started = Instant::now();
        let mut processed_ms = 0;
        let mut bytes = 0;
        let mut interrupted = false;
        let status = loop {
            if cancel.load(Ordering::SeqCst) {
                interrupted = true;
                let _ = child.kill();
            }
            while let Ok(line) = rx.try_recv() {
                if let Some((key, value)) = line.split_once('=') {
                    match key {
                        "out_time_us" => processed_ms = value.parse::<i64>().unwrap_or(0) / 1000,
                        "total_size" => bytes = value.parse().unwrap_or(0),
                        "progress" => progress(Progress {
                            phase: "processing".into(),
                            processed_ms,
                            percent: plan
                                .duration_ms
                                .filter(|d| *d > 0)
                                .map(|d| (processed_ms as f64 / d as f64 * 100.0).clamp(0.0, 99.0)),
                            bytes,
                            elapsed_ms: started.elapsed().as_millis() as u64,
                            notices: Vec::new(),
                        }),
                        _ => {}
                    }
                }
            }
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => thread::sleep(Duration::from_millis(40)),
                Err(e) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(e.to_string());
                }
            }
        };
        // Drop the receiver before joining so a final burst cannot deadlock a full progress channel.
        drop(rx);
        let _ = reader.join();
        let errors = err_reader.join().unwrap_or_default();
        if interrupted || cancel.load(Ordering::SeqCst) {
            return Err("Cancelled; temporary output removed and sources preserved".into());
        }
        if !status.success() {
            return Err(format!(
                "Export failed; sources are safe: {}",
                String::from_utf8_lossy(&errors)
            ));
        }
        progress(Progress {
            phase: "verifying".into(),
            processed_ms,
            percent: Some(99.0),
            bytes,
            elapsed_ms: started.elapsed().as_millis() as u64,
            notices: Vec::new(),
        });
        let actual = self.probe(temp.path())?;
        verify(p, &plan, &actual)?;
        for (track_id, expected) in &subtitle_times {
            let index = plan
                .tracks
                .iter()
                .find(|track| &track.track_id == track_id)
                .ok_or("Missing retained subtitle mapping")?
                .output_index;
            if cancel.load(Ordering::SeqCst) {
                return Err("Cancelled; source files are safe".into());
            }
            let stream = actual
                .streams
                .get(index)
                .ok_or("Missing positioned subtitle output")?;
            let vtt = self.subtitle_preview(temp.path(), stream.index)?;
            let found = subtitle_timing::times(&vtt, 0)?;
            if found.len() != expected.len()
                || found
                    .iter()
                    .zip(expected)
                    .any(|((s, e), (a, b))| (s - a).abs() > 2 || (e - b).abs() > 2)
            {
                return Err(format!(
                    "Verification failed: subtitle timeline timing differs for output track {}",
                    index + 1
                ));
            }
        }
        if let Some(expected) = &artwork_bytes {
            let cover = actual
                .streams
                .iter()
                .find(|s| s.properties.contains_key("attached_pic"))
                .ok_or("Verified artwork is missing")?;
            let mut command = command(&self.ffmpeg)?;
            command
                .args([
                    "-nostdin",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-format_whitelist",
                    FORMATS,
                    "-i",
                ])
                .arg(temp.path())
                .args([
                    "-map",
                    &format!("0:{}", cover.index),
                    "-c",
                    "copy",
                    "-frames:v",
                    "1",
                    "-f",
                    "image2pipe",
                    "pipe:1",
                ]);
            if capture_bytes(command, Duration::from_secs(20))? != *expected {
                return Err(
                    "Verification failed: embedded artwork bytes differ from the approved cover"
                        .into(),
                );
            }
        }
        for a in &p.assets {
            if fingerprint(&a.path)? != (a.size, a.modified_ms) {
                return Err("Source changed while exporting; output was not finalized".into());
            }
        }
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelled before finalization".into());
        }
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist_noclobber(&destination)
            .map_err(|e| format!("Could not finalize output without overwriting: {e}"))?;
        #[cfg(unix)]
        if let Ok(dir) = fs::File::open(&parent) {
            let _ = dir.sync_all();
        }
        progress(Progress {
            phase: "verifying".into(),
            processed_ms,
            percent: Some(100.0),
            bytes,
            elapsed_ms: started.elapsed().as_millis() as u64,
            notices: adjustments
                .into_iter()
                .map(|notice| notice.message)
                .chain(notices)
                .collect(),
        });
        Ok(destination)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appimage_backend_uses_host_libraries_without_changing_normal_commands() {
        let mut bundled = Command::new("ffmpeg");
        host_backend_environment(&mut bundled, true);
        assert!(bundled
            .get_envs()
            .any(|(key, value)| key == "LD_LIBRARY_PATH" && value.is_none()));
        let mut normal = Command::new("ffmpeg");
        host_backend_environment(&mut normal, false);
        assert!(normal.get_envs().next().is_none());
    }
    #[test]
    fn stream_duration_clock_tags_are_bounded_and_do_not_use_container_length() {
        assert_eq!(clock_duration("00:00:04.000000000"), Some(4000));
        assert_eq!(clock_duration("01:02:03.125"), Some(3723125));
        for invalid in [
            "00:61:00.000",
            "8761:00:00.000",
            "00:00:NaN",
            "-1:00:00.000",
            "00:00:60.000",
        ] {
            assert_eq!(clock_duration(invalid), None);
        }
    }
    #[test]
    fn probe_tolerates_missing_values() {
        let a=parse_probe(r#"{"streams":[{"index":0,"codec_type":"audio","codec_name":"aac","duration":"N/A"}],"format":{}}"#,PathBuf::from("x"),0,0).unwrap();
        assert_eq!(a.streams[0].language, "und");
        assert_eq!(a.streams[0].duration_ms, None);
    }
    #[test]
    fn malformed_probe_rejected() {
        assert!(parse_probe("{}", "x".into(), 0, 0).is_err());
    }
    #[test]
    fn chapter_escaping() {
        assert_eq!(escape_metadata("a=b;#c"), "a\\=b\\;\\#c");
    }
}
