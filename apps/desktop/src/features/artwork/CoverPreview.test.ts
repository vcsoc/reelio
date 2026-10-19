import { describe, expect, it } from "vitest";
import { coverDropHit } from "./CoverPreview";

describe("native cover drop routing", () => {
  const rect = { left: 600, right: 900, top: 100, bottom: 300 };
  it("maps physical native positions to fractional-scale CSS coordinates", () => {
    expect(
      coverDropHit(
        {
          paths: ["cover.avif"],
          position: { x: 700 * 0.909, y: 150 * 0.909 },
          viewport: { width: 1000 * 0.909, height: 700 * 0.909 },
        },
        rect,
        1000,
        700,
      ),
    ).toBe(true);
    expect(
      coverDropHit(
        {
          paths: ["cover.avif"],
          position: { x: 500, y: 150 },
          viewport: { width: 1000, height: 700 },
        },
        rect,
        1000,
        700,
      ),
    ).toBe(false);
  });
  it("does not treat legacy/invalid/outside drops as cover replacement", () => {
    expect(coverDropHit(["movie.mp4"], rect, 1000, 700)).toBe(false);
    expect(
      coverDropHit(
        {
          paths: ["cover"],
          position: { x: NaN, y: 150 },
          viewport: { width: 1000, height: 700 },
        },
        rect,
        1000,
        700,
      ),
    ).toBe(false);
    expect(
      coverDropHit(
        {
          paths: ["cover"],
          position: { x: 900, y: 150 },
          viewport: { width: 1000, height: 700 },
        },
        rect,
        1000,
        700,
      ),
    ).toBe(false);
  });
});
