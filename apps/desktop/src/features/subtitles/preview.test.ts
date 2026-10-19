import { describe, expect, it } from "vitest";
import { inspectVtt } from "./preview";
describe("subtitle preview inspection", () => {
  it("preserves timing and safe plain cue text", () => {
    const cues = inspectVtt(
      "WEBVTT\n\n00:00.200 --> 00:01.500\n<b>Fixture</b>\n\ncue-id\n01:02:03.000 --> 01:02:04.000 align:start\nSecond cue\n",
    );
    expect(cues).toEqual([
      { start: 200, end: 1500, text: "<b>Fixture</b>" },
      { start: 3723000, end: 3724000, text: "Second cue" },
    ]);
  });
  it("rejects malformed or empty cue streams", () => {
    expect(() => inspectVtt("<html>login</html>")).toThrow();
    expect(() => inspectVtt("WEBVTT\n\n")).toThrow();
    expect(() =>
      inspectVtt("WEBVTT\n\n00:99.000 --> 00:01.000\nBad"),
    ).toThrow();
    expect(() =>
      inspectVtt("WEBVTT\n\n00:02.000 --> 00:01.000\nBad"),
    ).toThrow();
  });
});
