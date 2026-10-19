import type { Project, Track } from "../../types";
import { isImageAsset } from "../../types";
export const MAX_OFFSET = 86_400_000;
export const MIN_CLIP_WIDTH = 28;
export function offsetAfterDrag(
  original: number,
  pixels: number,
  pixelsPerMs: number,
) {
  return Math.max(
    -MAX_OFFSET,
    Math.min(
      MAX_OFFSET,
      Math.round((original + pixels / pixelsPerMs) / 10) * 10,
    ),
  );
}
export function zoomAt(
  zoom: number,
  delta: number,
  scroll: number,
  pointer: number,
) {
  const next = Math.max(0.25, Math.min(512, zoom * Math.exp(-delta * 0.002)));
  return {
    zoom: next,
    scroll: Math.max(0, ((scroll + pointer) * next) / zoom - pointer),
  };
}
export function zoomTimeline(
  zoom: number,
  delta: number,
  scroll: number,
  width: number,
  duration: number,
  playhead: number,
  pointer?: number,
) {
  const marker = ((playhead * width) / duration) * zoom;
  const position = marker - scroll;
  const anchor =
    pointer ?? (position < 16 || position > width - 16 ? width / 2 : position);
  const base = pointer === undefined ? marker - anchor : scroll;
  const next = zoomAt(zoom, delta, base, anchor);
  return {
    zoom: next.zoom,
    scroll: Math.max(
      0,
      Math.min(width * Math.max(0, next.zoom - 1), next.scroll),
    ),
  };
}
export function applyTimelineScroll(
  viewport: { scrollLeft: number },
  desired: number,
) {
  let request = desired;
  let bestRequest = request;
  let bestError = Infinity;
  let lastRequest = request;
  // Fractional-scale WebKit can round twice while translating CSS scroll units.
  for (let attempt = 0; attempt < 3; attempt++) {
    lastRequest = request;
    viewport.scrollLeft = request;
    const error = desired - viewport.scrollLeft;
    if (Math.abs(error) < bestError) {
      bestError = Math.abs(error);
      bestRequest = request;
    }
    if (Math.abs(error) <= 0.25) break;
    request += error;
  }
  if (lastRequest !== bestRequest) viewport.scrollLeft = bestRequest;
  return viewport.scrollLeft;
}
export function rulerInterval(pixelsPerMs: number) {
  const minimum = 110 / Math.max(Number.EPSILON, pixelsPerMs);
  const unit = Math.pow(10, Math.floor(Math.log10(minimum)));
  return ([1, 2, 5, 10].find((n) => n * unit >= minimum) ?? 10) * unit;
}
export function trackDuration(p: Project, t: Track) {
  const asset = p.assets.find((a) => a.id === t.asset_id);
  return (
    asset?.streams.find((s) => s.index === t.stream_index)?.duration_ms ??
    asset?.duration_ms ??
    p.assets.find((a) => a.streams.some((s) => s.kind === "video"))
      ?.duration_ms ??
    10_000
  );
}
export function sourceDuration(p: Project, t: Track) {
  const asset = p.assets.find((a) => a.id === t.asset_id);
  return (
    asset?.streams.find((s) => s.index === t.stream_index)?.duration_ms ??
    asset?.duration_ms ??
    null
  );
}
export function clipBounds(p: Project, t: Track) {
  return {
    start: t.trim_start_ms ?? 0,
    end: t.trim_end_ms ?? trackDuration(p, t),
  };
}
export function timelineViewportDuration(p: Project) {
  return (
    Math.max(
      10000,
      ...p.tracks
        .filter((track) => {
          if (
            isImageAsset(p.assets.find((asset) => asset.id === track.asset_id))
          )
            return false;
          const stream = p.assets
            .find((asset) => asset.id === track.asset_id)
            ?.streams.find((stream) => stream.index === track.stream_index);
          return (
            stream &&
            ["video", "audio", "subtitle"].includes(stream.kind) &&
            !stream.properties.attached_pic
          );
        })
        .map((track) => clipBounds(p, track).end + track.offset_ms),
    ) * 1.15
  );
}
export function videoTimelineEnd(p: Project) {
  const videos = p.tracks.filter(
    (track) =>
      track.enabled &&
      !track.muted &&
      !isImageAsset(p.assets.find((asset) => asset.id === track.asset_id)) &&
      p.assets
        .find((asset) => asset.id === track.asset_id)
        ?.streams.some(
          (stream) =>
            stream.index === track.stream_index &&
            stream.kind === "video" &&
            !stream.properties.attached_pic,
        ),
  );
  if (
    !videos.length ||
    videos.some((video) => {
      const duration = sourceDuration(p, video);
      return duration === null || !Number.isFinite(duration) || duration <= 0;
    })
  )
    return null;
  const end = Math.max(
    ...videos.map((video) => clipBounds(p, video).end + video.offset_ms),
  );
  return end > 0 ? end : null;
}
export function referenceVideoEnd(p: Project) {
  if (!p.main_video_track_id) return videoTimelineEnd(p);
  const track = p.tracks.find((track) => track.id === p.main_video_track_id);
  const asset = p.assets.find((asset) => asset.id === track?.asset_id);
  const stream = asset?.streams.find(
    (stream) => stream.index === track?.stream_index,
  );
  if (
    !track ||
    !stream ||
    stream.kind !== "video" ||
    stream.properties.attached_pic ||
    isImageAsset(asset)
  )
    return null;
  const duration = sourceDuration(p, track);
  if (duration === null || !Number.isFinite(duration) || duration <= 0)
    return null;
  const end = clipBounds(p, track).end + track.offset_ms;
  return end > 0 ? end : null;
}
export function videoTrimSnap(p: Project, t: Track, scale: number) {
  const stream = p.assets
    .find((asset) => asset.id === t.asset_id)
    ?.streams.find((stream) => stream.index === t.stream_index);
  const end = referenceVideoEnd(p);
  if (
    end === null ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    sourceDuration(p, t) === null ||
    !stream ||
    !(
      stream.kind === "audio" ||
      (stream.kind === "video" &&
        !!p.main_video_track_id &&
        t.id !== p.main_video_track_id) ||
      (stream.kind === "subtitle" &&
        ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"].includes(
          stream.codec,
        ))
    )
  )
    return undefined;
  const visibleRight = (track: Track) => {
    const bounds = clipBounds(p, track);
    const left = Math.max(0, bounds.start + track.offset_ms);
    return (
      left * scale +
      Math.max(MIN_CLIP_WIDTH, (bounds.end + track.offset_ms - left) * scale)
    );
  };
  const anchor = p.tracks.find((track) => {
    const stream = p.assets
      .find((asset) => asset.id === track.asset_id)
      ?.streams.find((stream) => stream.index === track.stream_index);
    return (
      (p.main_video_track_id
        ? track.id === p.main_video_track_id
        : track.enabled && !track.muted) &&
      stream?.kind === "video" &&
      !isImageAsset(p.assets.find((asset) => asset.id === track.asset_id)) &&
      !stream.properties.attached_pic &&
      clipBounds(p, track).end + track.offset_ms === end
    );
  });
  if (!anchor) return undefined;
  // Tiny clips have a minimum rendered width; snap against that visible edge, not an invisible timestamp pixel.
  return {
    end: end - t.offset_ms,
    tolerance: 8 / scale,
    activationEnd:
      clipBounds(p, t).end + (visibleRight(anchor) - visibleRight(t)) / scale,
  };
}
export function clipToVideo(
  p: Project,
  t: Track,
): {
  changes: Pick<Track, "trim_end_ms"> | null;
  reason: string;
} {
  const stream = p.assets
    .find((asset) => asset.id === t.asset_id)
    ?.streams.find((stream) => stream.index === t.stream_index);
  const unavailable = (reason: string) => ({ changes: null, reason });
  if (
    !stream ||
    !["video", "audio", "subtitle"].includes(stream.kind) ||
    isImageAsset(p.assets.find((asset) => asset.id === t.asset_id))
  )
    return unavailable(
      "Clip to video applies to video, audio and text-subtitle clips.",
    );
  if (t.id === p.main_video_track_id)
    return unavailable(
      "This is the main video reference; choose another clip to fit.",
    );
  if (
    stream.kind === "subtitle" &&
    !["subrip", "ass", "ssa", "webvtt", "mov_text", "text"].includes(
      stream.codec,
    )
  )
    return unavailable("Image-subtitle trimming is not supported.");
  const videoEnd = referenceVideoEnd(p);
  if (videoEnd === null)
    return unavailable(
      "Select a main video or include a video with a known, nonempty duration first.",
    );
  const duration = sourceDuration(p, t);
  if (duration === null || !Number.isFinite(duration) || duration <= 0)
    return unavailable("This clip's source duration is not available.");
  const bounds = clipBounds(p, t);
  const end = Math.round(videoEnd - t.offset_ms);
  if (end - Math.max(bounds.start, -t.offset_ms, 0) < 10)
    return unavailable("This clip has no trimmable overlap with the video.");
  if (end >= bounds.end || end > duration)
    return unavailable(
      "This clip already ends at or before the video; source material will not be extended.",
    );
  return {
    changes: { trim_end_ms: end },
    reason: "Shorten this clip to end with the video (Ctrl+Alt+click).",
  };
}
// Source bounds stay fixed to the timeline's source origin, so trimming never slips content.
export function trimAfterDrag(
  edge: "start" | "end",
  start: number,
  end: number,
  duration: number,
  offset: number,
  delta: number,
  snap?: { end: number; tolerance: number; activationEnd?: number },
) {
  const minimum = Math.max(0, -offset);
  if (
    edge === "end" &&
    snap &&
    Math.abs(end + delta - (snap.activationEnd ?? snap.end)) <=
      snap.tolerance &&
    snap.end >= Math.max(start, minimum) + 10 &&
    snap.end <= duration
  ) {
    return { trim_end_ms: snap.end >= duration ? null : snap.end };
  }
  const value =
    Math.round(
      ((edge === "start" ? Math.max(start, minimum) : end) + delta) / 10,
    ) * 10;
  if (edge === "start")
    return { trim_start_ms: Math.max(minimum, Math.min(end - 10, value)) };
  const next = Math.max(
    Math.max(start, minimum) + 10,
    Math.min(duration, value),
  );
  return { trim_end_ms: next >= duration ? null : next };
}
export function timelineDuration(p: Project) {
  return Math.max(
    1000,
    ...p.tracks
      .filter(
        (t) =>
          t.enabled &&
          !t.muted &&
          !isImageAsset(p.assets.find((asset) => asset.id === t.asset_id)),
      )
      .map((t) => clipBounds(p, t).end + t.offset_ms),
  );
}
export function subtitleAtOffset<T extends { start: number; end: number }>(
  cues: T[],
  offset: number,
  trimStart = 0,
  trimEnd = Infinity,
) {
  return cues
    .filter((c) => Math.min(c.end, trimEnd) > Math.max(c.start, trimStart))
    .map((c) => ({
      ...c,
      start: Math.max(0, Math.max(c.start, trimStart) + offset),
      end: Math.min(c.end, trimEnd) + offset,
    }))
    .filter((c) => c.end > c.start);
}
