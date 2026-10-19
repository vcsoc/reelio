import { describe, it, expect } from "vitest";
import { chapterEnds, chapterTime, parseChapterTime } from "./timing";
describe("chapter start-only timing", () => {
  it("round trips millisecond clocks", () => {
    for (const ms of [0, 1234, 183338, 3600000, 31536000000])
      expect(parseChapterTime(chapterTime(ms))).toBe(ms);
    expect(chapterTime(183338)).toBe("00:03:03.338");
  });
  it("rejects ambiguous or overflowing clocks", () => {
    for (const text of [
      "1234",
      "00:60:00.000",
      "00:00:60.000",
      "00:00:01.2",
      "-1:00:00.000",
      "9999:00:00.000",
    ])
      expect(parseChapterTime(text)).toBeUndefined();
  });
  it("derives boundaries without reordering titles", () => {
    const chapters = [
      { title: "Second", start_ms: 5000, end_ms: 1 },
      { title: "First", start_ms: 1234, end_ms: 1 },
    ];
    chapterEnds(chapters, 10000);
    expect(chapters.map((c) => c.end_ms)).toEqual([10000, 5000]);
  });
});
