export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}
function timestamp(text: string): number {
  if (!/^(?:\d+:)?\d{2}:\d{2}\.\d{3}$/.test(text))
    throw new Error("Invalid WebVTT timestamp");
  const parts = text.split(":").map(Number);
  if (parts[parts.length - 1] >= 60 || parts[parts.length - 2] >= 60)
    throw new Error("Invalid WebVTT timestamp range");
  const result = Math.round(parts.reduce((sum, n) => sum * 60 + n, 0) * 1000);
  if (!Number.isFinite(result) || result > 31_536_000_000)
    throw new Error("Subtitle timestamp exceeds the supported range");
  return result;
}
export function inspectVtt(text: string): SubtitleCue[] {
  if (text.length > 4 * 1024 * 1024 || !text.startsWith("WEBVTT"))
    throw new Error("Invalid or oversized subtitle preview");
  const cues: SubtitleCue[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n"),
      index = lines.findIndex((line) => line.includes(" --> "));
    if (index < 0) continue;
    const [start, end] = lines[index].split(" --> ");
    const cue = {
      start: timestamp(start.trim()),
      end: timestamp(end.trim().split(/\s+/)[0]),
      text: lines
        .slice(index + 1)
        .join("\n")
        .trimEnd(),
    };
    if (cue.end <= cue.start)
      throw new Error("Subtitle cue has a non-positive duration");
    cues.push(cue);
    if (cues.length > 10000)
      throw new Error("Preview supports up to 10,000 subtitle cues");
  }
  if (!cues.length) throw new Error("No displayable subtitle cues found");
  return cues;
}

export function bindSubtitlePreview(
  video: HTMLVideoElement,
  cues: SubtitleCue[],
  onError: (message: string) => void,
): () => void {
  let track: TextTrack | undefined;
  let previous: { track: TextTrack; mode: TextTrackMode }[] = [];
  const install = () => {
    if (track) return;
    try {
      previous = Array.from(video.textTracks, (t) => ({
        track: t,
        mode: t.mode,
      }));
      for (const item of previous) item.track.mode = "disabled";
      track = video.addTextTrack("subtitles", "Test subtitle", "und");
      for (const cue of cues)
        track.addCue(new VTTCue(cue.start / 1000, cue.end / 1000, cue.text));
      track.mode = "showing";
    } catch (error) {
      onError(
        `Subtitle cue inspection is available, but this WebView could not display the overlay: ${String(error)}`,
      );
    }
  };
  // Native WebKit may discard script tracks created before the source metadata is ready.
  video.addEventListener("loadedmetadata", install);
  if (video.readyState >= 1) install();
  return () => {
    video.removeEventListener("loadedmetadata", install);
    if (track) {
      track.mode = "hidden";
      const list = track.cues;
      if (list)
        for (let i = list.length - 1; i >= 0; i--) track.removeCue(list[i]);
      track.mode = "disabled";
    }
    for (const item of previous) item.track.mode = item.mode;
  };
}
