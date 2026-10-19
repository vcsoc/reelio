use super::*;
use std::io::{Seek, SeekFrom};

pub fn fragmented_mp4(path: &Path) -> Result<bool, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let len = file.metadata().map_err(|error| error.to_string())?.len();
    let mut offset = 0u64;
    for index in 0..4096 {
        if offset == len {
            return Ok(false);
        }
        let mut header = [0; 8];
        if len.saturating_sub(offset) < 8 {
            return Ok(false);
        }
        file.read_exact(&mut header)
            .map_err(|error| error.to_string())?;
        if index == 0 && &header[4..] != b"ftyp" {
            return Ok(false);
        }
        let mut size = u64::from(u32::from_be_bytes(header[..4].try_into().unwrap()));
        let mut minimum = 8;
        if size == 1 {
            let mut extended = [0; 8];
            file.read_exact(&mut extended)
                .map_err(|error| error.to_string())?;
            size = u64::from_be_bytes(extended);
            minimum = 16;
        } else if size == 0 {
            size = len - offset;
        }
        if size < minimum || size > len - offset {
            return Err("Invalid MP4 atom bounds".into());
        }
        if &header[4..] == b"moof" {
            return Ok(true);
        }
        offset += size;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
    }
    Err("MP4 exceeds preview atom inspection limit".into())
}

impl Ffmpeg {
    /// Only decodes a bounded, validated still image; never a movie or an image sequence.
    pub fn cover_image_bytes(&self, asset: &Asset) -> Result<Vec<u8>, String> {
        if !asset.is_still_image() || asset.size > 8 * 1024 * 1024 {
            return Err("Choose a still image smaller than 8 MiB".into());
        }
        let stream = asset
            .streams
            .iter()
            .find(|stream| stream.kind == StreamKind::Video)
            .ok_or("Image has no readable picture")?;
        let dimension = |name: &str| {
            stream
                .properties
                .get(name)
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0)
        };
        let (width, height) = (dimension("width"), dimension("height"));
        if width == 0 || height == 0 || width > 8192 || height > 8192 || width * height > 8_388_608
        {
            return Err(
                "Image exceeds supported dimensions (8192 per edge, 8 megapixels total)".into(),
            );
        }
        let mut cmd = command(&self.ffmpeg)?;
        cmd.args([
            "-v",
            "error",
            "-nostdin",
            "-threads",
            "1",
            "-max_pixels",
            "8388608",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            FORMATS,
        ]);
        if let Some(format) = still_image_demuxer(&asset.path)? {
            cmd.args(["-f", format]);
        }
        cmd.arg("-i").arg(&asset.path).args([
            "-map",
            &format!("0:{}", stream.index),
            "-frames:v",
            "1",
            "-vf",
            "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease",
            "-filter_threads",
            "1",
            "-threads",
            "1",
            "-c:v",
            "png",
            "-f",
            "image2pipe",
            "pipe:1",
        ]);
        capture_bytes(cmd, Duration::from_secs(20))
    }

    fn preview_packet_hash(&self, path: &Path, index: u32) -> Result<String, String> {
        let mut cmd = command(&self.ffmpeg)?;
        cmd.args([
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            FORMATS,
            "-i",
        ])
        .arg(path)
        .args([
            "-map",
            &format!("0:{index}"),
            "-c",
            "copy",
            "-f",
            "hash",
            "-hash",
            "sha256",
            "pipe:1",
        ]);
        capture(cmd, Duration::from_secs(30))
    }

    /// A private, verified stream-copy preview, not a project edit or an export.
    pub fn seekable_preview(&self, path: &Path) -> Result<Option<tempfile::NamedTempFile>, String> {
        if !fragmented_mp4(path)? {
            return Ok(None);
        }
        let before = fs::metadata(path).map_err(|error| error.to_string())?;
        if before.len() > 256 * 1024 * 1024 {
            return Err(
                "Fragmented MP4 exceeds the 256 MiB seekable-preview limit; source is unchanged"
                    .into(),
            );
        }
        let source = self.probe(path)?;
        if source.is_still_image() {
            return Err("Still images belong in Poster & cover, not video playback".into());
        }
        let video = source
            .streams
            .iter()
            .find(|stream| {
                stream.kind == StreamKind::Video && !stream.properties.contains_key("attached_pic")
            })
            .ok_or("Fragmented preview needs a video stream")?;
        let mut expected = vec![video];
        expected.extend(
            source
                .streams
                .iter()
                .filter(|stream| stream.kind == StreamKind::Audio),
        );
        let output = tempfile::Builder::new()
            .prefix("reelio-seekable-")
            .suffix(".mp4")
            .tempfile()
            .map_err(|error| error.to_string())?;
        let mut cmd = command(&self.ffmpeg)?;
        cmd.args([
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            FORMATS,
            "-i",
        ])
        .arg(path);
        for stream in &expected {
            cmd.args(["-map", &format!("0:{}", stream.index)]);
        }
        cmd.args([
            "-c",
            "copy",
            "-sn",
            "-dn",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-movflags",
            "+faststart",
            "-fs",
            &(before.len() + 1024 * 1024).to_string(),
            "-f",
            "mp4",
        ])
        .arg(output.path());
        capture_bytes(cmd, Duration::from_secs(30))?;
        let actual = self.probe(output.path())?;
        if actual.streams.len() != expected.len() {
            return Err("Preview verification failed: stream count changed".into());
        }
        for (original, copied) in expected.iter().zip(&actual.streams) {
            let start = |stream: &Stream| {
                stream
                    .properties
                    .get("start_time")
                    .and_then(|value| value.parse::<f64>().ok())
                    .filter(|value| value.is_finite())
            };
            if let Some(original_start) = start(original) {
                if start(copied)
                    .is_none_or(|copied_start| (original_start - copied_start).abs() > 0.002)
                {
                    return Err("Preview verification failed: source stream timing changed".into());
                }
            }
            if original.kind != copied.kind
                || original.codec != copied.codec
                || self.preview_packet_hash(path, original.index)?
                    != self.preview_packet_hash(output.path(), copied.index)?
            {
                return Err("Preview verification failed: encoded media payload changed".into());
            }
        }
        let expected_duration = video
            .duration_ms
            .or(source.duration_ms)
            .ok_or("Preview source duration is unavailable")?;
        if actual.streams[0]
            .duration_ms
            .or(actual.duration_ms)
            .is_none_or(|duration| (duration - expected_duration).abs() > 100)
        {
            return Err("Preview verification failed: video duration changed".into());
        }
        let after = fs::metadata(path).map_err(|error| error.to_string())?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err("Source changed while preparing preview".into());
        }
        Ok(Some(output))
    }
}
