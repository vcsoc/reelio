import { describe, expect, it } from "vitest";
import {
  offsetAfterDrag,
  trimAfterDrag,
  clipBounds,
  clipToVideo,
  referenceVideoEnd,
  videoTrimSnap,
  timelineViewportDuration,
  timelineDuration,
  subtitleAtOffset,
  zoomAt,
  zoomTimeline,
  applyTimelineScroll,
  MAX_OFFSET,
  rulerInterval,
} from "./geometry";
import { addAsset, emptyProject } from "../../stores/projectStore";
it("uses a stable, excluded main video reference for fitting and magnetic snapping, without changing inclusion", () => {
  const p = clippingProject();
  const main = p.tracks[0],
    audio = p.tracks[1];
  main.enabled = false;
  main.trim_end_ms = 7000;
  main.offset_ms = 1000;
  p.main_video_track_id = main.id;
  const other = {
    ...main,
    id: "other-video",
    enabled: true,
    trim_end_ms: null,
    offset_ms: 0,
  };
  p.tracks.push(other);
  expect(referenceVideoEnd(p)).toBe(8000);
  expect(clipToVideo(p, audio).changes).toEqual({ trim_end_ms: 8000 });
  expect(videoTrimSnap(p, audio, 0.01)?.end).toBe(8000);
  expect(clipToVideo(p, other).changes).toEqual({ trim_end_ms: 8000 });
  expect(clipToVideo(p, main).changes).toBeNull();
  expect(main.enabled).toBe(false);
  p.tracks.reverse();
  expect(referenceVideoEnd(p)).toBe(8000);
  p.main_video_track_id = "missing";
  expect(referenceVideoEnd(p)).toBeNull();
  delete p.main_video_track_id;
  expect(referenceVideoEnd(p)).toBe(10000);
});
function clippingProject() {
  return addAsset(emptyProject(), {
    id: "clipping",
    path: "movie.mkv",
    format: "matroska",
    size: 1,
    modified_ms: 1,
    duration_ms: 30000,
    streams: ["video", "audio", "subtitle"].map((kind, index) => ({
      index,
      kind: kind as "video" | "audio" | "subtitle",
      codec: ["h264", "aac", "subrip"][index],
      title: "",
      language: "und",
      duration_ms: index === 0 ? 10000 : 30000,
      default: true,
      forced: false,
      properties: {},
    })),
    metadata: {},
    chapters: [],
  });
}
describe("clip to video", () => {
  it("shortens audio and text subtitles without changing the project or source origin", () => {
    const p = clippingProject();
    p.tracks[1].trim_start_ms = 2000;
    const before = JSON.stringify(p);
    expect(clipToVideo(p, p.tracks[1]).changes).toEqual({ trim_end_ms: 10000 });
    expect(clipToVideo(p, p.tracks[2]).changes).toEqual({ trim_end_ms: 10000 });
    expect(JSON.stringify(p)).toBe(before);
  });
  it("honors positive/negative offsets and the retained video end without time-grid rounding", () => {
    const p = clippingProject();
    p.tracks[0].trim_end_ms = 6333;
    p.tracks[0].offset_ms = 1000;
    p.tracks[1].offset_ms = 2000;
    expect(clipToVideo(p, p.tracks[1]).changes).toEqual({ trim_end_ms: 5333 });
    p.tracks[1].offset_ms = -2000;
    expect(clipToVideo(p, p.tracks[1]).changes).toEqual({ trim_end_ms: 9333 });
  });
  it("does not extend short clips, cross the left edge, or create sub-10-ms/empty clips", () => {
    const p = clippingProject();
    const t = p.tracks[1];
    t.trim_end_ms = 9000;
    expect(clipToVideo(p, t).changes).toBeNull();
    t.trim_end_ms = null;
    t.trim_start_ms = 9991;
    expect(clipToVideo(p, t).changes).toBeNull();
    t.trim_start_ms = 0;
    t.offset_ms = 10000;
    expect(clipToVideo(p, t).changes).toBeNull();
    t.offset_ms = -30000;
    expect(clipToVideo(p, t).changes).toBeNull();
  });
  it("disables unsafe operations for absent/unknown video, unknown source and image subtitles", () => {
    const p = clippingProject();
    expect(clipToVideo(p, p.tracks[0]).changes).toBeNull();
    p.tracks[0].enabled = false;
    expect(clipToVideo(p, p.tracks[1]).changes).toBeNull();
    p.tracks[0].enabled = true;
    p.assets[0].streams[2].codec = "hdmv_pgs_subtitle";
    expect(clipToVideo(p, p.tracks[2]).changes).toBeNull();
    p.assets[0].streams[0].duration_ms = null;
    p.assets[0].duration_ms = null;
    expect(clipToVideo(p, p.tracks[1]).changes).toBeNull();
    p.assets[0].streams[0].duration_ms = 10000;
    p.assets[0].streams[1].duration_ms = null;
    expect(clipToVideo(p, p.tracks[1]).changes).toBeNull();
  });
  it("uses the latest included real-video end, ignoring excluded videos and cover pictures", () => {
    const p = clippingProject();
    const other = structuredClone(p.tracks[0]);
    other.id = "other";
    other.offset_ms = 5000;
    p.tracks.push(other);
    expect(clipToVideo(p, p.tracks[1]).changes).toEqual({ trim_end_ms: 15000 });
    other.enabled = false;
    expect(clipToVideo(p, p.tracks[1]).changes).toEqual({ trim_end_ms: 10000 });
    p.assets[0].streams[0].properties.attached_pic = "1";
    expect(clipToVideo(p, p.tracks[1]).changes).toBeNull();
  });
});
describe("native scroll rounding", () => {
  it("corrects fractional-display CSS rounding without unbounded retries at scroll limits", () => {
    let actual = 0;
    let writes = 0;
    const viewport = {
      get scrollLeft() {
        return actual;
      },
      set scrollLeft(value: number) {
        writes++;
        actual = Math.floor(Math.floor(Math.min(400, value) * 0.909) / 0.909);
      },
    };
    expect(
      Math.abs(applyTimelineScroll(viewport, 246.898) - 246.898),
    ).toBeLessThan(1.1);
    expect(writes).toBeLessThanOrEqual(4);
    writes = 0;
    applyTimelineScroll(viewport, 10000);
    expect(writes).toBeLessThanOrEqual(4);
    expect(viewport.scrollLeft).toBeLessThanOrEqual(400);
  });
});
describe("timeline zoom anchoring", () => {
  it("preserves cursor time across consecutive zoom requests without relying on painted scroll positions", () => {
    let view = { zoom: 4, scroll: 1000 };
    const anchor = (view.scroll + 350) / view.zoom;
    for (let i = 0; i < 20; i++) {
      view = zoomTimeline(view.zoom, -20, view.scroll, 1000, 100000, 0, 350);
      expect((view.scroll + 350) / view.zoom).toBeCloseTo(anchor, 8);
    }
  });
  it("keeps a visible playhead stationary and brings an offscreen playhead back into view", () => {
    const visible = zoomTimeline(4, -100, 200, 1000, 100000, 10000);
    expect(
      ((10000 * 1000) / 100000) * visible.zoom - visible.scroll,
    ).toBeCloseTo(200);
    const hidden = zoomTimeline(4, 100, 0, 1000, 100000, 80000);
    expect(((80000 * 1000) / 100000) * hidden.zoom - hidden.scroll).toBeCloseTo(
      500,
    );
    const fit = zoomTimeline(1, 10000, 0, 1000, 100000, 80000);
    expect(fit.scroll).toBe(0);
    expect(fit.zoom).toBe(0.25);
  });
});
describe("real-world retained timeline geometry", () => {
  it("fits retained intervals instead of an hours-long subtitle's original duration", () => {
    const p = clippingProject();
    p.assets[0].streams[2].duration_ms = 9029354;
    p.tracks[1].trim_end_ms = 13931;
    p.tracks[2].trim_end_ms = 18070;
    expect(timelineViewportDuration(p)).toBe(18070 * 1.15);
    p.tracks[2].enabled = false;
    expect(timelineViewportDuration(p)).toBe(18070 * 1.15);
  });
  it("snaps at the visible video edge even when minimum clip widths displace timestamp pixels", () => {
    const p = clippingProject();
    const scale = 0.001;
    const snap = videoTrimSnap(p, p.tracks[1], scale)!;
    expect(snap.end).toBe(10000);
    expect(snap.activationEnd).toBe(28000);
    expect(
      trimAfterDrag("end", 0, 30000, 30000, 0, -2000 + 7000, snap),
    ).toEqual({ trim_end_ms: 10000 });
    expect(
      trimAfterDrag("end", 0, 30000, 30000, 0, -2000 - 9000, snap).trim_end_ms,
    ).not.toBe(10000);
  });
});
describe("video edge snapping", () => {
  it("snaps to the exact non-grid video end at an eight-pixel distance across timeline zoom levels", () => {
    const p = clippingProject();
    p.tracks[0].trim_end_ms = 6333;
    for (const scale of [0.01, 0.1, 1, 10]) {
      const snap = videoTrimSnap(p, p.tracks[1], scale)!;
      for (const direction of [-1, 1]) {
        const delta = 6333 - 30000 + (direction * 7) / scale;
        expect(trimAfterDrag("end", 0, 30000, 30000, 0, delta, snap)).toEqual({
          trim_end_ms: 6333,
        });
        const outside = trimAfterDrag(
          "end",
          0,
          30000,
          30000,
          0,
          6333 - 30000 + (direction * 9) / scale,
          snap,
        );
        expect(outside.trim_end_ms).not.toBe(6333);
      }
    }
  });
  it("accounts for video/clip offsets and never slips the left edge or exceeds source bounds", () => {
    const p = clippingProject();
    p.tracks[0].offset_ms = 123;
    p.tracks[1].offset_ms = -2000;
    const snap = videoTrimSnap(p, p.tracks[1], 1)!;
    expect(snap.end).toBe(12123);
    expect(
      trimAfterDrag("end", 4000, 30000, 30000, -2000, -17880, snap),
    ).toEqual({ trim_end_ms: 12123 });
    expect(trimAfterDrag("start", 0, 30000, 30000, 0, 12120, snap)).toEqual({
      trim_start_ms: 12120,
    });
    expect(
      trimAfterDrag("end", 12120, 30000, 30000, 0, -17880, snap).trim_end_ms,
    ).not.toBe(12123);
    expect(trimAfterDrag("end", 0, 10000, 10000, 0, 2120, snap)).toEqual({
      trim_end_ms: null,
    });
    expect(
      trimAfterDrag("end", 0, 30000, 30000, 0, -17880, {
        end: 30000,
        tolerance: 30000,
      }),
    ).toEqual({ trim_end_ms: null });
  });
  it("does not snap video itself, image subtitles, or clips with unavailable video/source duration", () => {
    const p = clippingProject();
    expect(videoTrimSnap(p, p.tracks[0], 1)).toBeUndefined();
    p.assets[0].streams[2].codec = "hdmv_pgs_subtitle";
    expect(videoTrimSnap(p, p.tracks[2], 1)).toBeUndefined();
    expect(videoTrimSnap(p, p.tracks[1], 0)).toBeUndefined();
    p.tracks[0].enabled = false;
    expect(videoTrimSnap(p, p.tracks[1], 1)).toBeUndefined();
  });
});
describe("timeline positioning", () => {
  it("trims either source edge without slipping the other, and restores original limits", () => {
    expect(trimAfterDrag("start", 0, 1000, 1000, 0, 200)).toEqual({
      trim_start_ms: 200,
    });
    expect(trimAfterDrag("end", 200, 1000, 1000, 0, -300)).toEqual({
      trim_end_ms: 700,
    });
    expect(trimAfterDrag("start", 200, 700, 1000, 0, -500)).toEqual({
      trim_start_ms: 0,
    });
    expect(trimAfterDrag("end", 200, 700, 1000, 0, 2000)).toEqual({
      trim_end_ms: null,
    });
    expect(trimAfterDrag("start", 0, 700, 1000, -300, -100)).toEqual({
      trim_start_ms: 300,
    });
    expect(trimAfterDrag("start", 0, 700, 1000, 0, Infinity)).toEqual({
      trim_start_ms: 690,
    });
    expect(trimAfterDrag("end", 200, 700, 1000, 0, -Infinity)).toEqual({
      trim_end_ms: 210,
    });
  });
  it("derives the output end from retained source bounds, not the full original duration", () => {
    const p = addAsset(emptyProject(), {
      id: "a",
      path: "movie.mkv",
      format: "matroska",
      size: 1,
      modified_ms: 1,
      duration_ms: 10000,
      streams: [
        {
          index: 0,
          kind: "video",
          codec: "h264",
          title: "",
          language: "und",
          duration_ms: 10000,
          default: true,
          forced: false,
          properties: {},
        },
      ],
      metadata: {},
      chapters: [],
    });
    p.tracks[0].trim_start_ms = 2000;
    p.tracks[0].trim_end_ms = 5000;
    p.tracks[0].offset_ms = -1000;
    expect(clipBounds(p, p.tracks[0])).toEqual({ start: 2000, end: 5000 });
    expect(timelineDuration(p)).toBe(4000);
  });
  it("clips subtitle cues against both source edges before applying output offset", () => {
    expect(
      subtitleAtOffset(
        [
          { start: 0, end: 300 },
          { start: 400, end: 1500 },
          { start: 1600, end: 2000 },
        ],
        -500,
        600,
        1400,
      ),
    ).toEqual([{ start: 100, end: 900 }]);
  });
  it("moves clips in milliseconds and bounds hostile/large positions", () => {
    expect(offsetAfterDrag(500, 20, 0.1)).toBe(700);
    expect(offsetAfterDrag(0, -50, 0.1)).toBe(-500);
    expect(offsetAfterDrag(MAX_OFFSET, 100, 0.1)).toBe(MAX_OFFSET);
  });
  it("keeps the time under the pointer stationary while zooming the shared timeline view", () => {
    const result = zoomAt(1, -120, 300, 50);
    expect(result.zoom).toBeGreaterThan(1);
    expect((result.scroll + 50) / result.zoom).toBeCloseTo(350);
    expect(zoomAt(512, -1000, 0, 0).zoom).toBe(512);
    expect(zoomAt(0.25, 1000, 0, 0).zoom).toBe(0.25);
  });
  it("keeps ruler labels separated at narrow and highly zoomed scales", () => {
    for (const scale of [0.00001, 0.002, 0.007, 0.1, 1, 100]) {
      expect(rulerInterval(scale) * scale).toBeGreaterThanOrEqual(110);
      expect(rulerInterval(scale) * scale).toBeLessThanOrEqual(275);
    }
  });
  it("shifts subtitle previews, clips straddling cues and drops cues before zero", () => {
    expect(
      subtitleAtOffset(
        [
          { start: 100, end: 400, text: "drop" },
          { start: 300, end: 900, text: "clip" },
          { start: 1000, end: 2000, text: "shift" },
        ],
        -500,
      ),
    ).toEqual([
      { start: 0, end: 400, text: "clip" },
      { start: 500, end: 1500, text: "shift" },
    ]);
    expect(subtitleAtOffset([{ start: 100, end: 400 }], 500)).toEqual([
      { start: 600, end: 900 },
    ]);
  });
});
