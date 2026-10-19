use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::PathBuf,
};
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 3;
pub fn id() -> String {
    Uuid::new_v4().to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Container {
    Mp4,
    M4v,
    Matroska,
}
impl Container {
    pub fn muxer(self) -> &'static str {
        match self {
            Self::Mp4 | Self::M4v => "mp4",
            Self::Matroska => "matroska",
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::M4v => "m4v",
            Self::Matroska => "mkv",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamKind {
    Video,
    Audio,
    Subtitle,
    Attachment,
    Data,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stream {
    pub index: u32,
    pub kind: StreamKind,
    pub codec: String,
    pub title: String,
    pub language: String,
    pub duration_ms: Option<i64>,
    pub default: bool,
    pub forced: bool,
    pub properties: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub path: PathBuf,
    pub format: String,
    pub size: u64,
    pub modified_ms: u64,
    pub duration_ms: Option<i64>,
    pub streams: Vec<Stream>,
    pub metadata: BTreeMap<String, String>,
    pub chapters: Vec<Chapter>,
}
impl Asset {
    pub fn is_still_image(&self) -> bool {
        if self.streams.iter().any(|stream| {
            stream.kind == StreamKind::Audio
                || stream
                    .properties
                    .get("nb_frames")
                    .and_then(|value| value.parse::<u64>().ok())
                    .is_some_and(|count| count > 1)
        }) {
            return false;
        }
        matches!(self.format.as_str(), "jpeg_pipe" | "png_pipe" | "webp_pipe")
            || self
                .metadata
                .get("major_brand")
                .is_some_and(|brand| brand.trim() == "avif")
            || self.streams.iter().any(|stream| {
                stream
                    .properties
                    .get("still_image")
                    .is_some_and(|value| value == "1")
            })
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioRole {
    Mix,
    #[default]
    Separate,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub asset_id: String,
    pub stream_index: u32,
    pub enabled: bool,
    pub title: String,
    pub language: String,
    pub default: bool,
    pub forced: bool,
    pub commentary: bool,
    pub descriptive: bool,
    pub offset_ms: i64,
    #[serde(default)]
    pub trim_start_ms: i64,
    #[serde(default)]
    pub trim_end_ms: Option<i64>,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub audio_role: AudioRole,
}
impl Track {
    pub fn is_trimmed(&self) -> bool {
        self.trim_start_ms != 0 || self.trim_end_ms.is_some()
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
    pub start_ms: i64,
    pub end_ms: i64,
    pub title: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artwork {
    pub jpeg: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub source_label: String,
}
impl Artwork {
    pub fn validate(&self) -> Result<(), String> {
        if self.jpeg.is_empty()
            || self.jpeg.len() > 2_796_204
            || !self.jpeg.is_ascii()
            || self.width == 0
            || self.height == 0
            || self.width > 4096
            || self.height > 4096
            || u64::from(self.width) * u64::from(self.height) > 8_388_608
            || self.source_label.len() > 2048
            || self.source_label.contains('\0')
        {
            Err("Artwork exceeds supported payload, dimension, or label limits".into())
        } else {
            Ok(())
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub container: Container,
    pub assets: Vec<Asset>,
    pub tracks: Vec<Track>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_video_track_id: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub chapters: Vec<Chapter>,
    #[serde(default)]
    pub artwork: Option<Artwork>,
}
impl Default for Project {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            id: id(),
            name: "Untitled project".into(),
            container: Container::Mp4,
            assets: vec![],
            tracks: vec![],
            main_video_track_id: None,
            metadata: BTreeMap::new(),
            chapters: vec![],
            artwork: None,
        }
    }
}
impl Project {
    pub fn upgrade_legacy(&mut self) -> Result<(), String> {
        match self.schema_version {
            1 | 2 => {
                if self.tracks.iter().any(Track::is_trimmed) {
                    return Err("Clip trims require project schema 3".into());
                }
                self.schema_version = SCHEMA_VERSION;
                Ok(())
            }
            SCHEMA_VERSION => Ok(()),
            _ => Err("Unsupported project schema version".into()),
        }
    }
    pub fn add_asset(&mut self, asset: Asset) -> Result<(), String> {
        if self.assets.iter().any(|a| a.path == asset.path) {
            return Err("This source is already in the project".into());
        }
        if self.assets.is_empty() {
            self.metadata = asset.metadata.clone();
            self.chapters = asset.chapters.clone();
        }
        for s in &asset.streams {
            self.tracks.push(Track {
                id: id(),
                asset_id: asset.id.clone(),
                stream_index: s.index,
                enabled: matches!(
                    s.kind,
                    StreamKind::Video | StreamKind::Audio | StreamKind::Subtitle
                ) && !s.properties.contains_key("attached_pic"),
                title: s.title.clone(),
                language: s.language.clone(),
                default: s.default,
                forced: s.forced,
                commentary: s.properties.get("comment").is_some_and(|v| v == "1"),
                descriptive: s
                    .properties
                    .get("visual_impaired")
                    .is_some_and(|v| v == "1"),
                offset_ms: 0,
                trim_start_ms: 0,
                trim_end_ms: None,
                muted: false,
                audio_role: AudioRole::Separate,
            });
        }
        self.assets.push(asset);
        Ok(())
    }
    pub fn stream(&self, track: &Track) -> Option<&Stream> {
        self.assets
            .iter()
            .find(|a| a.id == track.asset_id)?
            .streams
            .iter()
            .find(|s| s.index == track.stream_index)
    }
    pub fn mix_tracks(&self) -> Vec<&Track> {
        self.tracks
            .iter()
            .filter(|t| {
                t.enabled
                    && !t.muted
                    && t.audio_role == AudioRole::Mix
                    && self.stream(t).is_some_and(|s| s.kind == StreamKind::Audio)
            })
            .collect()
    }
    pub fn output_default(&self, t: &Track) -> bool {
        t.default
            || (t.audio_role == AudioRole::Mix
                && self.stream(t).is_some_and(|s| s.kind == StreamKind::Audio)
                && self.mix_tracks().iter().any(|t| t.default))
    }
    pub fn source_duration(&self, t: &Track) -> Option<i64> {
        self.stream(t).and_then(|s| s.duration_ms).or_else(|| {
            self.assets
                .iter()
                .find(|a| a.id == t.asset_id)
                .and_then(|a| a.duration_ms)
        })
    }
    pub fn source_end(&self, t: &Track) -> Option<i64> {
        t.trim_end_ms.or_else(|| self.source_duration(t))
    }
    pub fn timeline_duration(&self) -> Option<i64> {
        self.tracks
            .iter()
            .filter(|t| t.enabled && !t.muted)
            .filter_map(|t| {
                self.source_end(t)
                    .map(|d| d.saturating_add(t.offset_ms).max(0))
            })
            .max()
    }
    pub fn output_tracks(&self) -> Vec<&Track> {
        let first_mix = self.mix_tracks().first().map(|t| t.id.as_str());
        self.tracks
            .iter()
            .filter(|t| {
                t.enabled
                    && !t.muted
                    && !(self.stream(t).is_some_and(|s| s.kind == StreamKind::Audio)
                        && t.audio_role == AudioRole::Mix
                        && Some(t.id.as_str()) != first_mix)
            })
            .collect()
    }
    pub fn validate(&self) -> Vec<String> {
        let mut errors = vec![];
        if let Some(artwork) = &self.artwork {
            if let Err(error) = artwork.validate() {
                errors.push(error);
            }
        }
        if self.schema_version != SCHEMA_VERSION {
            errors.push("Unsupported project schema version".into());
        }
        if self.assets.len() > 256 || self.tracks.len() > 4096 || self.chapters.len() > 10000 {
            errors.push("Project exceeds resource limits".into());
        }
        if self.name.len() > 512 || self.name.contains('\0') {
            errors.push("Project name is invalid or too long".into());
        }
        let mut ids = HashSet::new();
        for a in &self.assets {
            if a.duration_ms
                .is_some_and(|d| !(0..=31_536_000_000).contains(&d))
            {
                errors.push("Source duration exceeds supported range".into());
            }
            if !ids.insert(a.id.clone()) {
                errors.push("Duplicate asset identity".into());
            }
            let mut indices = HashSet::new();
            for s in &a.streams {
                if s.duration_ms
                    .is_some_and(|d| !(0..=31_536_000_000).contains(&d))
                {
                    errors.push("Stream duration exceeds supported range".into());
                }
                if !indices.insert(s.index) {
                    errors.push("Duplicate source stream index".into());
                }
            }
        }
        ids.clear();
        for t in &self.tracks {
            if !ids.insert(t.id.clone()) {
                errors.push("Duplicate track identity".into());
            }
            if self.stream(t).is_none() {
                errors.push(format!("Track {} references a missing stream", t.id));
            }
            if t.language.len() != 3 || !t.language.bytes().all(|c| c.is_ascii_alphabetic()) {
                errors.push("Track languages must use three-letter ISO 639 codes (or und)".into());
            }
            if t.title.len() > 4096 || t.title.contains('\0') {
                errors.push("Invalid track title".into());
            }
            if t.muted && self.stream(t).is_some_and(|s| s.kind != StreamKind::Audio) {
                errors.push("Only audio lanes can be muted".into());
            }
            if t.is_trimmed() {
                let duration = self.source_duration(t);
                let end = self.source_end(t);
                if duration.is_none_or(|d| d <= 0)
                    || t.trim_start_ms < 0
                    || end.is_none_or(|e| {
                        e.saturating_sub(t.trim_start_ms) < 10 || e > duration.unwrap_or(0)
                    })
                    || end.is_some_and(|e| e.saturating_add(t.offset_ms) <= 0)
                    || self.stream(t).is_none_or(|s| {
                        !matches!(
                            s.kind,
                            StreamKind::Video | StreamKind::Audio | StreamKind::Subtitle
                        ) || s.properties.contains_key("attached_pic")
                    })
                {
                    errors.push("Clip trims require a known source duration, valid media lane and a nonempty source interval within the original media and output timeline".into());
                }
            }
            if t.offset_ms.unsigned_abs() > 86_400_000 {
                errors.push("Track offset exceeds 24 hours".into());
            }
        }
        if let Some(id) = &self.main_video_track_id {
            if !self.tracks.iter().any(|track| {
                &track.id == id
                    && self.stream(track).is_some_and(|stream| {
                        stream.kind == StreamKind::Video
                            && !stream.properties.contains_key("attached_pic")
                    })
                    && self
                        .assets
                        .iter()
                        .any(|asset| asset.id == track.asset_id && !asset.is_still_image())
            }) {
                errors.push(
                    "The main video reference must identify an existing video clip, not artwork"
                        .into(),
                );
            }
        }
        for kind in [StreamKind::Video, StreamKind::Audio, StreamKind::Subtitle] {
            if self
                .output_tracks()
                .iter()
                .filter(|t| {
                    self.output_default(t) && self.stream(t).is_some_and(|s| s.kind == kind)
                })
                .count()
                > 1
            {
                errors.push(format!("Choose at most one default {kind:?} track"));
            }
        }
        let mut previous = -1;
        let timeline_duration = self.timeline_duration();
        let video_duration = self.video_duration();
        for c in &self.chapters {
            if c.start_ms < 0
                || c.start_ms <= previous
                || c.end_ms <= c.start_ms
                || c.end_ms > 31_536_000_000
                || c.title.len() > 4096
                || c.title.contains('\0')
            {
                errors.push("Chapters require strictly increasing, non-negative starts and ends after starts".into());
            }
            if video_duration.is_none()
                && timeline_duration.is_some_and(|d| c.end_ms > d.saturating_add(1000))
            {
                errors.push("Chapter extends beyond the output timeline".into());
            }
            previous = c.start_ms;
        }
        if self.metadata.len() > 512
            || self.metadata.iter().any(|(k, v)| {
                k.is_empty()
                    || k.len() > 128
                    || k.contains('\0')
                    || v.len() > 65536
                    || v.contains('\0')
            })
        {
            errors.push("Invalid or oversized metadata".into());
        }
        errors
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Copy,
    BitstreamFilter,
    ConvertSubtitle,
    RenderAudio,
    RenderVideo,
    Transcode,
    Unsupported,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Compatibility {
    pub action: Action,
    pub reason: String,
    pub warning: Option<String>,
    pub target_codec: Option<String>,
}
fn decision(
    action: Action,
    reason: &str,
    target: Option<&str>,
    warning: Option<&str>,
) -> Compatibility {
    Compatibility {
        action,
        reason: reason.into(),
        warning: warning.map(Into::into),
        target_codec: target.map(Into::into),
    }
}
pub fn compatibility(container: Container, stream: &Stream) -> Compatibility {
    use Action::*;
    if stream.properties.contains_key("attached_pic") {
        return decision(
            Unsupported,
            "Cover art requires a dedicated container artwork adapter; not a normal video track",
            None,
            None,
        );
    }
    let codec = stream.codec.as_str();
    match (container, stream.kind) {
        (_, StreamKind::Attachment | StreamKind::Data) => decision(Unsupported, "Attachments and data need a dedicated container adapter", None, None),
        (Container::Matroska, StreamKind::Video) if ["h264","hevc","av1","vp8","vp9","mpeg4","mpeg2video","mpeg1video","ffv1","prores","mjpeg","theora"].contains(&codec) => decision(Copy,"Copy video without re-encoding",None,None),
        (Container::Matroska, StreamKind::Audio) if ["aac","alac","ac3","eac3","mp3","flac","opus","vorbis","dts","truehd","pcm_s16le","pcm_s24le","pcm_s32le","pcm_f32le"].contains(&codec) => decision(Copy,"Copy audio without re-encoding",None,None),
        (Container::Matroska, StreamKind::Subtitle) if ["subrip","ass","ssa","webvtt","hdmv_pgs_subtitle","dvd_subtitle"].contains(&codec) => decision(Copy,"Preserve subtitle stream",None,None),
        (Container::Matroska, StreamKind::Subtitle) if codec == "mov_text" => decision(ConvertSubtitle,"Convert timed text to SubRip",Some("subrip"),Some("Text styling and positioning may be lost")),
        (Container::Mp4 | Container::M4v, StreamKind::Video) if ["h264","hevc","av1","mpeg4","mpeg2video","mjpeg"].contains(&codec) => decision(Copy,"Copy video; playback support varies by player",None,None),
        (Container::Mp4 | Container::M4v, StreamKind::Audio) if ["aac","alac","ac3","eac3","mp3"].contains(&codec) => {
            if codec == "aac" && stream.properties.get("source_format").is_some_and(|f| f == "aac" || f.contains("mpegts")) { decision(BitstreamFilter,"Convert ADTS headers for MP4",None,None) }
            else { decision(Copy,"Copy audio; playback support varies by player",None,None) }
        },
        (Container::Mp4 | Container::M4v, StreamKind::Subtitle) if codec == "mov_text" => decision(Copy,"Preserve MP4 timed text",None,None),
        (Container::Mp4 | Container::M4v, StreamKind::Subtitle) if ["subrip","webvtt","ass","ssa","text"].contains(&codec) => decision(ConvertSubtitle,"Convert text subtitles to MP4 timed text",Some("mov_text"),Some("Styling, fonts and positioning may be lost; explicit approval required")),
        (_, StreamKind::Audio | StreamKind::Video) => decision(Transcode,"Codec is not in the conservative copy allowlist. Transcoding is not implemented; select another container or disable the track",None,None),
        _ => decision(Unsupported,"No supported lossless path (image subtitles require a compatible container, not OCR)",None,None),
    }
}
mod export_window;
pub use export_window::ExportAdjustment;
#[cfg(test)]
mod export_window_tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedTrack {
    pub track_id: String,
    pub output_index: usize,
    pub source_index: u32,
    pub asset_id: String,
    pub compatibility: Compatibility,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub mix_sources: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPlan {
    pub tracks: Vec<PlannedTrack>,
    #[serde(default)]
    pub chapters: Vec<Chapter>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub duration_ms: Option<i64>,
    pub estimated_bytes: u64,
}
pub fn plan(project: &Project) -> ExportPlan {
    let mut validation = project.validate();
    let has_video = project.output_tracks().iter().any(|track| {
        project.stream(track).is_some_and(|stream| {
            stream.kind == StreamKind::Video && !stream.properties.contains_key("attached_pic")
        })
    });
    let video_duration = project.video_duration();
    if has_video && video_duration.is_none_or(|end| end <= 0) {
        validation.push(
            "Cannot determine a nonempty video timeline; re-inspect the video before exporting"
                .into(),
        );
    }
    let (prepared, crop_notices) = project.fit_to_video();
    let project = &prepared;
    // MP4 needs a default per media kind. Resolve an omitted choice by output order,
    // without modifying saved dispositions or overriding an explicit selection.
    let automatic: std::collections::HashSet<&str> = if project.container == Container::Matroska {
        Default::default()
    } else {
        [StreamKind::Video, StreamKind::Audio, StreamKind::Subtitle]
            .into_iter()
            .filter_map(|kind| {
                let tracks = project.output_tracks();
                let mut selected = tracks
                    .into_iter()
                    .filter(|t| project.stream(t).is_some_and(|s| s.kind == kind));
                let first = selected.next()?;
                if project.output_default(first) || selected.any(|t| project.output_default(t)) {
                    None
                } else {
                    Some(first.id.as_str())
                }
            })
            .collect()
    };
    let mut result = ExportPlan { tracks: vec![], chapters:project.chapters.clone(), errors: validation, warnings: vec!["Verification checks container structure, stream codecs, tags, dispositions and chapters; it is not a full decode or bitstream integrity guarantee.".into(), "Unknown source metadata may not survive remuxing. Only mapped fields are verified.".into()], duration_ms: project.assets.first().and_then(|a| a.duration_ms), estimated_bytes: project.assets.iter().fold(0u64,|total,a|total.saturating_add(a.size)) };
    result
        .warnings
        .extend(crop_notices.into_iter().map(|notice| notice.message));
    if video_duration.is_some()
        && project.output_tracks().iter().any(|track| {
            project
                .stream(track)
                .is_some_and(|stream| stream.kind == StreamKind::Subtitle)
        })
    {
        result.warnings.push("Text subtitle lanes with no cues inside the video timeline are omitted and reported after export. For MP4/M4V, a removed subtitle default moves to the first remaining subtitle track and is reported.".into());
    }
    if project.container != Container::Matroska
        && result.chapters.first().is_some_and(|c| c.start_ms > 0)
    {
        let end = result.chapters[0].start_ms;
        result.chapters.insert(
            0,
            Chapter {
                start_ms: 0,
                end_ms: end,
                title: "Opening".into(),
            },
        );
        result.warnings.push("MP4/M4V chapter playback starts at zero: an Opening chapter is added before the first marker without changing your saved markers.".into());
        if result.chapters.len() > 10000 {
            result.errors.push(
                "Output exceeds the 10,000-chapter limit including its opening chapter".into(),
            );
        }
    }
    if let Some(artwork) = &project.artwork {
        result.warnings.push(format!("Approved JPEG cover ({} x {}) will be added as MP4/M4V cover art or a Matroska cover.jpg attachment. Video streams are not transcoded for artwork.",artwork.width,artwork.height));
        result.estimated_bytes = result
            .estimated_bytes
            .saturating_add((artwork.jpeg.len() as u64).saturating_mul(3) / 4);
    }
    if project.container != Container::Matroska && !project.chapters.is_empty() {
        result.warnings.push("MP4/M4V chapters add one auxiliary timed-text data stream in addition to the selected media tracks; verification expects this container-specific representation.".into());
    }
    let mix = project.mix_tracks();
    if mix.len() > 64 {
        result
            .errors
            .push("Audio mix exceeds 64 active inputs".into());
    }
    for t in project.output_tracks() {
        if project
            .assets
            .iter()
            .any(|asset| asset.id == t.asset_id && asset.is_still_image())
        {
            result.errors.push("Still images are cover resources, not video tracks; use Poster & cover or exclude the image track".into());
            continue;
        }
        if let Some(s) = project.stream(t) {
            let mut c = compatibility(project.container, s);
            let mix_sources: Vec<String> = if s.kind == StreamKind::Audio
                && t.audio_role == AudioRole::Mix
                && (mix.len() > 1 || mix.iter().any(|t| t.offset_ms != 0 || t.is_trimmed()))
            {
                mix.iter().map(|t| t.id.clone()).collect()
            } else {
                vec![]
            };
            if s.kind == StreamKind::Audio
                && (!mix_sources.is_empty()
                    || t.offset_ms != 0
                    || t.is_trimmed()
                    || c.action == Action::Transcode)
            {
                c=decision(Action::RenderAudio,"Render timing/mix/trim to AAC audio",Some("aac"),Some("Audio mixing, trimming or positioning encodes a new 48 kHz stereo AAC track at 192 kb/s; original files are unchanged. Explicit render approval required."));
            } else if s.kind == StreamKind::Video
                && (t.offset_ms != 0 || t.is_trimmed())
                && !s.properties.contains_key("attached_pic")
            {
                c=decision(Action::RenderVideo,"Render trimmed/positioned video to H.264",Some("h264"),Some("Video trimming/positioning renders H.264 with black lead-in or trimmed head at source-frame granularity (not arbitrary sub-frame precision). Explicit render approval required."));
            }
            if s.kind == StreamKind::Subtitle
                && (t.offset_ms < 0 || t.is_trimmed())
                && ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"]
                    .contains(&s.codec.as_str())
            {
                c=decision(Action::ConvertSubtitle,"Trim/shift text cues to the retained output interval",Some(if project.container==Container::Matroska{"subrip"}else{"mov_text"}),Some("Subtitle trims/negative offsets normalize text through SubRip to clip/drop cues outside the retained interval; styling may be lost. Explicit conversion approval required."));
            }
            if matches!(c.action, Action::Unsupported | Action::Transcode) {
                result.errors.push(format!("{}: {}", s.codec, c.reason));
            }
            if s.kind == StreamKind::Subtitle
                && video_duration.is_some_and(|end| {
                    project
                        .source_end(t)
                        .is_none_or(|source_end| source_end.saturating_add(t.offset_ms) > end)
                })
                && !["subrip", "ass", "ssa", "webvtt", "mov_text", "text"]
                    .contains(&s.codec.as_str())
            {
                result.errors.push("Cropping image subtitles to the video timeline is not supported; use text subtitles or exclude that track".into());
            }
            if s.kind == StreamKind::Subtitle
                && (t.offset_ms != 0 || t.is_trimmed())
                && !["subrip", "ass", "ssa", "webvtt", "mov_text", "text"]
                    .contains(&s.codec.as_str())
            {
                result.errors.push("Timeline trims/offsets currently require text subtitles; image subtitle trimming/positioning is not supported".into());
            }
            if matches!(s.kind, StreamKind::Audio | StreamKind::Video)
                && t.offset_ms < 0
                && project
                    .source_end(t)
                    .is_some_and(|d| d <= t.offset_ms.saturating_neg())
            {
                result
                    .errors
                    .push("A media lane is positioned entirely before the output starts".into());
            }
            if let Some(w) = &c.warning {
                result.warnings.push(w.clone());
            }
            if automatic.contains(t.id.as_str()) {
                result.warnings.push(format!("No default {kind:?} track selected: output track {number} is selected automatically. Choose another included track's Default checkbox to override.",kind=s.kind,number=result.tracks.len()+1));
            }
            result.tracks.push(PlannedTrack {
                default: project.output_default(t) || automatic.contains(t.id.as_str()),
                track_id: t.id.clone(),
                output_index: result.tracks.len(),
                source_index: t.stream_index,
                asset_id: t.asset_id.clone(),
                compatibility: c,
                mix_sources,
            });
        }
    }
    if project
        .output_tracks()
        .iter()
        .filter(|t| {
            (t.offset_ms != 0 || t.is_trimmed())
                && project
                    .stream(t)
                    .is_some_and(|s| s.kind == StreamKind::Subtitle)
        })
        .count()
        > 64
    {
        result
            .errors
            .push("Timeline subtitle processing exceeds 64 positioned tracks".into());
    }
    if result
        .tracks
        .iter()
        .filter(|t| {
            matches!(
                t.compatibility.action,
                Action::RenderAudio | Action::RenderVideo
            )
        })
        .count()
        > 64
    {
        result
            .errors
            .push("Timeline rendering exceeds 64 output streams".into());
    }
    result.duration_ms = video_duration.or_else(|| project.timeline_duration());
    if result.tracks.is_empty() {
        result
            .errors
            .push("Enable at least one output track".into());
    }
    for key in project.metadata.keys() {
        if !metadata_writable(project.container, key) {
            result.warnings.push(format!(
                "Metadata '{key}' is project-only for this output; it will not be written"
            ));
        }
    }
    result
}
pub fn metadata_writable(container: Container, key: &str) -> bool {
    match container {
        Container::Matroska => [
            "title",
            "artist",
            "album",
            "date",
            "genre",
            "comment",
            "description",
            "copyright",
        ]
        .contains(&key),
        _ => [
            "title",
            "artist",
            "album",
            "date",
            "genre",
            "comment",
            "description",
            "copyright",
            "show",
            "season_number",
            "episode_sort",
            "episode_id",
            "network",
            "synopsis",
        ]
        .contains(&key),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn stream(kind: StreamKind, codec: &str) -> Stream {
        Stream {
            index: 3,
            kind,
            codec: codec.into(),
            title: "".into(),
            language: "und".into(),
            duration_ms: None,
            default: false,
            forced: false,
            properties: BTreeMap::new(),
        }
    }
    #[test]
    fn new_projects_default_to_mp4_but_saved_formats_are_preserved() {
        let mut project = Project::default();
        assert_eq!(project.container, Container::Mp4);
        for container in [Container::Matroska, Container::Mp4, Container::M4v] {
            project.container = container;
            let saved = serde_json::to_vec(&project).unwrap();
            let reopened: Project = serde_json::from_slice(&saved).unwrap();
            assert_eq!(reopened.container, container);
        }
    }
    #[test]
    fn main_video_reference_is_persistent_validated_and_independent_of_export_inclusion() {
        let mut p = trim_project(StreamKind::Video, "h264");
        let id = p.tracks[0].id.clone();
        p.tracks[0].enabled = false;
        p.main_video_track_id = Some(id.clone());
        assert!(!p
            .validate()
            .iter()
            .any(|error| error.contains("main video reference")));
        let restored: Project = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(restored.main_video_track_id, Some(id));
        assert_eq!(restored.video_duration(), None);
        p.main_video_track_id = Some("missing".into());
        assert!(p
            .validate()
            .iter()
            .any(|error| error.contains("main video reference")));
        p.main_video_track_id = Some(p.tracks[0].id.clone());
        p.assets[0].streams[0].kind = StreamKind::Audio;
        assert!(p
            .validate()
            .iter()
            .any(|error| error.contains("main video reference")));
        p.assets[0].streams[0].kind = StreamKind::Video;
        p.assets[0].format = "png_pipe".into();
        assert!(p
            .validate()
            .iter()
            .any(|error| error.contains("main video reference")));
    }
    fn trim_project(kind: StreamKind, codec: &str) -> Project {
        let mut p = Project {
            container: Container::Matroska,
            ..Project::default()
        };
        p.add_asset(Asset {
            id: id(),
            path: "source.mkv".into(),
            format: "matroska".into(),
            size: 100,
            modified_ms: 0,
            duration_ms: Some(1000),
            streams: vec![stream(kind, codec)],
            metadata: Default::default(),
            chapters: vec![],
        })
        .unwrap();
        p
    }
    #[test]
    fn source_trims_change_output_end_and_require_explicit_render_or_conversion() {
        for (kind, codec, action) in [
            (StreamKind::Video, "h264", Action::RenderVideo),
            (StreamKind::Audio, "aac", Action::RenderAudio),
            (StreamKind::Subtitle, "subrip", Action::ConvertSubtitle),
        ] {
            let mut p = trim_project(kind, codec);
            p.tracks[0].trim_start_ms = 200;
            p.tracks[0].trim_end_ms = Some(800);
            p.tracks[0].offset_ms = -200;
            let result = plan(&p);
            assert!(result.errors.is_empty(), "{:?}", result.errors);
            assert_eq!(result.duration_ms, Some(600));
            assert_eq!(result.tracks[0].compatibility.action, action);
            assert!(result.tracks[0].compatibility.warning.is_some());
            let saved = serde_json::to_string(&p).unwrap();
            let reopened: Project = serde_json::from_str(&saved).unwrap();
            assert_eq!(reopened.schema_version, 3);
            assert_eq!(reopened.tracks[0].trim_end_ms, Some(800));
            assert_eq!(reopened.tracks[0].id, p.tracks[0].id);
        }
    }
    #[test]
    fn source_trim_validation_rejects_unknown_outside_reversed_and_overflowing_intervals() {
        for (start, end) in [
            (-1, Some(800)),
            (800, Some(800)),
            (900, Some(500)),
            (0, Some(1001)),
            (i64::MAX, None),
            (0, Some(i64::MIN)),
        ] {
            let mut p = trim_project(StreamKind::Video, "h264");
            p.tracks[0].trim_start_ms = start;
            p.tracks[0].trim_end_ms = end;
            assert!(!plan(&p).errors.is_empty());
        }
        let mut p = trim_project(StreamKind::Video, "h264");
        p.assets[0].duration_ms = None;
        p.tracks[0].trim_end_ms = Some(500);
        assert!(!plan(&p).errors.is_empty());
        let mut p = trim_project(StreamKind::Subtitle, "hdmv_pgs_subtitle");
        p.tracks[0].trim_end_ms = Some(500);
        assert!(plan(&p).errors.iter().any(|e| e.contains("image subtitle")));
    }
    #[test]
    fn legacy_schemas_upgrade_to_untrimmed_tracks_but_cannot_smuggle_new_trim_semantics() {
        for version in [1, 2] {
            let mut p = trim_project(StreamKind::Video, "h264");
            p.schema_version = version;
            p.upgrade_legacy().unwrap();
            assert_eq!(p.schema_version, 3);
            assert_eq!(p.tracks[0].trim_start_ms, 0);
            assert_eq!(p.tracks[0].trim_end_ms, None);
            p.schema_version = version;
            p.tracks[0].trim_end_ms = Some(500);
            assert!(p.upgrade_legacy().is_err());
        }
    }
    #[test]
    fn trimmed_subtitles_share_the_positioned_processing_limit() {
        let mut p = trim_project(StreamKind::Subtitle, "subrip");
        let original = p.tracks[0].clone();
        p.tracks = (0..65)
            .map(|_| {
                let mut t = original.clone();
                t.id = id();
                t.trim_end_ms = Some(500);
                t
            })
            .collect();
        assert!(plan(&p).errors.iter().any(|e| e.contains("64 positioned")));
    }
    #[test]
    fn mp4_defaults_follow_enabled_output_order_without_mutating_choices() {
        let mut first = stream(StreamKind::Audio, "aac");
        first.index = 0;
        let mut second = first.clone();
        second.index = 1;
        let mut p = Project {
            container: Container::Mp4,
            ..Default::default()
        };
        p.add_asset(Asset {
            id: id(),
            path: "source.mka".into(),
            format: "matroska".into(),
            size: 100,
            modified_ms: 0,
            duration_ms: Some(1000),
            streams: vec![first, second],
            metadata: Default::default(),
            chapters: vec![],
        })
        .unwrap();
        let check = |p: &Project| {
            let result = plan(p);
            assert!(result.errors.is_empty(), "{:?}", result.errors);
            result.tracks.iter().map(|t| t.default).collect::<Vec<_>>()
        };
        assert_eq!(check(&p), vec![true, false]);
        assert!(p.tracks.iter().all(|t| !t.default));
        p.container = Container::M4v;
        assert_eq!(check(&p), vec![true, false]);
        p.tracks[1].default = true;
        assert_eq!(check(&p), vec![false, true]);
        p.tracks[1].enabled = false;
        assert_eq!(check(&p), vec![true]);
        p.tracks[1].default = false;
        p.tracks[1].enabled = true;
        p.tracks.swap(0, 1);
        assert_eq!(plan(&p).tracks[0].track_id, p.tracks[0].id);
        assert_eq!(check(&p), vec![true, false]);
        p.container = Container::Matroska;
        assert_eq!(check(&p), vec![false, false]);
        p.tracks.iter_mut().for_each(|t| t.default = true);
        assert!(plan(&p)
            .errors
            .iter()
            .any(|e| e.contains("at most one default")));
    }
    #[test]
    fn image_subtitles_never_become_text() {
        assert_eq!(
            compatibility(
                Container::Mp4,
                &stream(StreamKind::Subtitle, "hdmv_pgs_subtitle")
            )
            .action,
            Action::Unsupported
        );
        assert_eq!(
            compatibility(
                Container::Matroska,
                &stream(StreamKind::Subtitle, "hdmv_pgs_subtitle")
            )
            .action,
            Action::Copy
        );
    }
    #[test]
    fn text_conversion_is_explicit() {
        let c = compatibility(Container::Mp4, &stream(StreamKind::Subtitle, "ass"));
        assert_eq!(c.action, Action::ConvertSubtitle);
        assert!(c.warning.is_some());
    }
    #[test]
    fn unknown_codecs_are_not_assumed_copyable() {
        assert_eq!(
            compatibility(
                Container::Matroska,
                &stream(StreamKind::Audio, "future_codec")
            )
            .action,
            Action::Transcode
        );
    }
    #[test]
    fn reject_invalid_chapters() {
        let p = Project {
            chapters: vec![
                Chapter {
                    start_ms: 0,
                    end_ms: 100,
                    title: "A".into(),
                },
                Chapter {
                    start_ms: 0,
                    end_ms: 100,
                    title: "B".into(),
                },
            ],
            ..Project::default()
        };
        assert!(!p.validate().is_empty());
    }
    #[test]
    fn schema_and_metadata_validated() {
        let mut p = Project {
            schema_version: 900,
            ..Project::default()
        };
        p.metadata.insert("bad\0key".into(), "x".into());
        assert_eq!(p.validate().len(), 2);
    }
    #[test]
    fn unknown_tag_names_are_project_only_not_invalid() {
        let mut p = Project::default();
        p.metadata
            .insert("com.apple.quicktime.location".into(), "local tag".into());
        assert!(p.validate().is_empty());
        assert!(plan(&p).warnings.iter().any(|w| w.contains("project-only")));
    }
    #[test]
    fn hostile_numeric_limits_do_not_overflow_planning() {
        let mut p = Project::default();
        p.chapters.push(Chapter {
            start_ms: i64::MAX - 1,
            end_ms: i64::MAX,
            title: String::new(),
        });
        assert!(!plan(&p).errors.is_empty());
    }
    #[test]
    fn empty_export_rejected() {
        assert!(!plan(&Project::default()).errors.is_empty());
    }
}
