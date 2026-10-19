use crate::{Project, StreamKind};

fn report_label(text: &str) -> String {
    let mut chars = text.chars();
    let prefix: String = chars.by_ref().take(160).collect();
    if chars.next().is_some() {
        format!("{prefix}...")
    } else {
        prefix
    }
}

#[derive(Debug, Clone)]
pub struct ExportAdjustment {
    pub track_id: Option<String>,
    pub message: String,
}

impl Project {
    /// The end of the included video timeline, excluding cover/attached pictures.
    pub fn video_duration(&self) -> Option<i64> {
        let mut ends = Vec::new();
        for track in self.output_tracks() {
            if self
                .assets
                .iter()
                .any(|asset| asset.id == track.asset_id && asset.is_still_image())
            {
                continue;
            }
            if self.stream(track).is_some_and(|stream| {
                stream.kind == StreamKind::Video && !stream.properties.contains_key("attached_pic")
            }) {
                ends.push(
                    self.source_end(track)?
                        .saturating_add(track.offset_ms)
                        .max(0),
                );
            }
        }
        ends.into_iter().max()
    }

    /// Prepare export-only intervals. Saved edits and original media remain untouched.
    pub fn fit_to_video(&self) -> (Self, Vec<ExportAdjustment>) {
        let mut output = self.clone();
        let mut notices = Vec::new();
        let Some(end) = self.video_duration().filter(|end| *end > 0) else {
            return (output, notices);
        };
        let natural_video_assets: std::collections::HashSet<_> = self
            .output_tracks()
            .into_iter()
            .filter(|track| {
                track.offset_ms == 0
                    && !track.is_trimmed()
                    && self.source_end(track) == Some(end)
                    && self.stream(track).is_some_and(|stream| {
                        stream.kind == StreamKind::Video
                            && !stream.properties.contains_key("attached_pic")
                    })
            })
            .map(|track| track.asset_id.as_str())
            .collect();
        for track in &mut output.tracks {
            if !track.enabled || track.muted {
                continue;
            }
            let Some(stream) = self.stream(track) else {
                continue;
            };
            if !matches!(stream.kind, StreamKind::Audio | StreamKind::Subtitle) {
                continue;
            }
            // Image subtitle packets cannot safely be rewritten as text cues.
            if stream.kind == StreamKind::Subtitle
                && !["subrip", "ass", "ssa", "webvtt", "mov_text", "text"]
                    .contains(&stream.codec.as_str())
            {
                continue;
            }
            let start = track.trim_start_ms.max(-track.offset_ms).max(0);
            let source_end = self.source_end(track);
            // Preserve ordinary embedded codec padding instead of re-encoding an otherwise untouched movie.
            if stream.kind == StreamKind::Audio
                && track.offset_ms == 0
                && !track.is_trimmed()
                && natural_video_assets.contains(track.asset_id.as_str())
                && source_end.is_some_and(|stop| stop > end && stop <= end.saturating_add(50))
            {
                continue;
            }
            let stop = source_end
                .unwrap_or(i64::MAX)
                .min(end.saturating_sub(track.offset_ms));
            let label = if track.title.is_empty() {
                format!(
                    "{:?} source stream {} [{}]",
                    stream.kind,
                    track.stream_index,
                    report_label(&track.id)
                )
            } else {
                format!(
                    "{} [{}]",
                    report_label(&track.title),
                    report_label(&track.id)
                )
            };
            if stop.saturating_sub(start) < 10 {
                track.enabled = false;
                notices.push(ExportAdjustment { track_id: Some(track.id.clone()), message: format!(
                    "Omitted {label}: less than 10 ms remains within the video timeline 0..{end} ms."
                ) });
                continue;
            }
            if start != track.trim_start_ms || source_end.is_none_or(|original| stop < original) {
                track.trim_start_ms = start;
                track.trim_end_ms = Some(stop);
                notices.push(ExportAdjustment { track_id: Some(track.id.clone()), message: format!("Cropped {label} to video timeline: output {}..{} ms (retained source {start}..{stop} ms).", start.saturating_add(track.offset_ms), stop.saturating_add(track.offset_ms)) });
            }
        }
        output.chapters.retain_mut(|chapter| {
            if chapter.start_ms >= end {
                notices.push(ExportAdjustment {
                    track_id: None,
                    message: format!(
                        "Omitted chapter '{}' at {} ms: starts outside video timeline 0..{end} ms.",
                        report_label(&chapter.title),
                        chapter.start_ms
                    ),
                });
                return false;
            }
            if chapter.end_ms > end {
                chapter.end_ms = end;
                notices.push(ExportAdjustment {
                    track_id: None,
                    message: format!(
                        "Cropped chapter '{}' (start {} ms) to video end {end} ms.",
                        report_label(&chapter.title),
                        chapter.start_ms
                    ),
                });
            }
            true
        });
        (output, notices)
    }
}
