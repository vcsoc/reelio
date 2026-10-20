import { describe, it, expect } from "vitest";
import {
  cueClock,
  parseCueClock,
  documentKey,
  shiftCues,
  splitCue,
  mergeCue,
  replaceText,
  cueIssues,
  type SrtDocument,
} from "./editorModel";
const fixture = (): SrtDocument => ({
  cues: [
    { id: "a", start_ms: 1000, end_ms: 3000, text: "Hello world" },
    { id: "b", start_ms: 4000, end_ms: 6000, text: "Second cue" },
  ],
});
describe("SRT editor operations", () => {
  it("roundtrips exact clocks and rejects malformed clocks", () => {
    for (const n of [0, 1, 1234, 86400000, 359999999])
      expect(parseCueClock(cueClock(n))).toBe(n);
    for (const s of [
      "0:00:00,000",
      "00:60:00,000",
      "00:00:61,000",
      "00:00:00,00",
      "x",
    ])
      expect(() => parseCueClock(s)).toThrow();
  });
  it("shifts only selected cues without mutating input", () => {
    const original = fixture(),
      next = shiftCues(original, new Set(["b"]), -500);
    expect(next.cues[0]).toBe(original.cues[0]);
    expect(next.cues[1].start_ms).toBe(3500);
    expect(original.cues[1].start_ms).toBe(4000);
    expect(() => shiftCues(original, new Set(["a"]), -2000)).toThrow();
    expect(() => shiftCues(original, new Set(["a"]), Infinity)).toThrow();
  });
  it("splits text and timing with a new stable cue identity", () => {
    const d = splitCue(fixture(), "a", 2000, 5);
    expect(d.cues).toHaveLength(3);
    expect(d.cues[0]).toMatchObject({
      id: "a",
      start_ms: 1000,
      end_ms: 2000,
      text: "Hello",
    });
    expect(d.cues[1]).toMatchObject({
      start_ms: 2000,
      end_ms: 3000,
      text: "world",
    });
    expect(d.cues[1].id).not.toBe("a");
    expect(() => splitCue(fixture(), "a", 1000, 5)).toThrow();
    expect(() => splitCue(fixture(), "a", 2000, 0)).toThrow();
  });
  it("merges only adjacent cues and preserves remaining identity", () => {
    const d = mergeCue(fixture(), "a");
    expect(d.cues).toHaveLength(1);
    expect(d.cues[0]).toMatchObject({
      id: "a",
      start_ms: 1000,
      end_ms: 6000,
      text: "Hello world\nSecond cue",
    });
    expect(() => mergeCue(fixture(), "b")).toThrow();
  });
  it("replaces literal text only in chosen cues", () => {
    const d = replaceText(fixture(), "cue", "字幕", new Set(["b"]));
    expect(d.cues[1].text).toBe("Second 字幕");
    expect(d.cues[0].text).toBe("Hello world");
    expect(() => replaceText(fixture(), "", "", new Set())).toThrow();
  });
  it("reports reading speed, missing text and overlap", () => {
    const d = fixture();
    d.cues[0].text = "";
    d.cues[1].start_ms = 2000;
    expect(cueIssues(d).join(" ")).toContain("enter subtitle text");
    expect(cueIssues(d).join(" ")).toContain("overlaps");
  });
  it("compares native documents independently of JSON field order", () => {
    const d = fixture(),
      other = {
        cues: d.cues.map((c) => ({
          text: c.text,
          end_ms: c.end_ms,
          start_ms: c.start_ms,
          id: c.id,
        })),
      };
    expect(documentKey(d)).toBe(documentKey(other));
  });
});
