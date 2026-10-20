import { describe, it, expect } from "vitest";
import {
  previewFrameMs,
  frameTarget,
  playbackSpeeds,
  syncPreviewAudioRate,
} from "./playback";
describe("preview transport", () => {
  it("pauses audio rather than letting an unsupported rate drift out of sync", () => {
    let paused = false;
    const media = {
      get playbackRate() {
        return 1;
      },
      set playbackRate(_value: number) {
        throw Error("Unsupported rate");
      },
      pause: () => {
        paused = true;
      },
    };
    expect(syncPreviewAudioRate(media, 10)).toBe(false);
    expect(paused).toBe(true);
    const normal = {
      playbackRate: 1,
      pause: () => {
        throw Error("Should not pause");
      },
    };
    expect(syncPreviewAudioRate(normal, 0.25)).toBe(true);
    expect(normal.playbackRate).toBe(0.25);
  });
  it("uses rational nominal source frames and bounded fallbacks", () => {
    expect(previewFrameMs("30000/1001")).toBeCloseTo(1001 / 30);
    expect(previewFrameMs("24")).toBeCloseTo(1000 / 24);
    for (const rate of [
      undefined,
      "0/0",
      "0",
      "Infinity",
      "-2",
      "2000",
      "oops",
    ])
      expect(previewFrameMs(rate)).toBe(40);
  });
  it("clamps frame stepping at source boundaries", () => {
    expect(frameTarget(0, -1, 40, 2000)).toBe(0);
    expect(frameTarget(1990, 1, 40, 2000)).toBe(2000);
    expect(frameTarget(1000, -1, 40, 2000)).toBe(960);
  });
  it("provides all requested discrete playback speeds", () => {
    expect(playbackSpeeds).toEqual([0.1, 0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 10]);
  });
});
