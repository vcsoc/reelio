import { describe, it, expect } from "vitest";
import { sizeCrop } from "./imageGeometry";
describe("crop size controls", () => {
  it("never creates a one-pixel crop rejected by the backend", () => {
    expect(sizeCrop({ width: 100, height: 100 }, null, "width", 0).width).toBe(
      2,
    );
    expect(
      sizeCrop({ width: 100, height: 100 }, null, "height", -1).height,
    ).toBe(2);
  });
  it("centers width and height without exposing coordinates", () =>
    expect(sizeCrop({ width: 1200, height: 1600 }, null, "width", 600)).toEqual(
      { x: 300, y: 0, width: 600, height: 1600 },
    ));
  it("locks ratio and fits inside the source", () => {
    expect(
      sizeCrop({ width: 1200, height: 1600 }, null, "width", 600, 0.75),
    ).toEqual({ x: 300, y: 400, width: 600, height: 800 });
    expect(
      sizeCrop({ width: 1200, height: 1600 }, null, "height", 3200, 0.75),
    ).toEqual({ x: 0, y: 0, width: 1200, height: 1600 });
  });
  it("keeps an existing edge crop inside its bounds", () =>
    expect(
      sizeCrop(
        { width: 100, height: 100 },
        { x: 80, y: 80, width: 20, height: 20 },
        "width",
        80,
      ),
    ).toEqual({ x: 20, y: 80, width: 80, height: 20 }));
});
