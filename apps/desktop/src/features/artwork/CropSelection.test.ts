import { describe, it, expect } from "vitest";
import { transformCrop, type CropHandle } from "./CropSelection";
const source = { width: 400, height: 600 },
  box = { x: 100, y: 100, width: 100, height: 200 };
describe("interactive crop geometry", () => {
  it("moves without resizing and clamps every source edge", () => {
    expect(transformCrop(box, 999, -999, "move", source)).toEqual({
      ...box,
      x: 300,
      y: 0,
    });
  });
  it.each(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as CropHandle[])(
    "keeps %s resizing bounded and at least two pixels",
    (edge) => {
      for (const delta of [-999, -30, 30, 999]) {
        const crop = transformCrop(box, delta, delta, edge, source);
        expect(crop.x).toBeGreaterThanOrEqual(0);
        expect(crop.y).toBeGreaterThanOrEqual(0);
        expect(crop.x + crop.width).toBeLessThanOrEqual(source.width);
        expect(crop.y + crop.height).toBeLessThanOrEqual(source.height);
        expect(crop.width).toBeGreaterThanOrEqual(2);
        expect(crop.height).toBeGreaterThanOrEqual(2);
      }
    },
  );
  it("preserves the opposite corner and a locked ratio while fitting the source", () => {
    const crop = transformCrop(box, -999, -999, "nw", source, 0.5);
    expect(crop.x + crop.width).toBe(200);
    expect(crop.y + crop.height).toBe(300);
    expect(crop.width / crop.height).toBe(0.5);
  });
  it("resizes a focused edge without changing the other dimension", () => {
    expect(transformCrop(box, 10, 0, "w", source)).toEqual({
      x: 110,
      y: 100,
      width: 90,
      height: 200,
    });
  });
});
