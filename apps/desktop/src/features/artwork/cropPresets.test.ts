import { expect, it } from "vitest";
import { cropPresets } from "./cropPresets";
it("orders all portrait, square and landscape crop ratios with reciprocal presets", () => {
  expect(cropPresets.map((p) => p.name)).toEqual([
    "Poster 9:16",
    "Poster 2:3",
    "Poster 3:4",
    "Square",
    "Wide 4:3",
    "Wide 3:2",
    "Wide 16:9",
  ]);
  const ratios = cropPresets.map((p) => p.width / p.height);
  expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
  expect(ratios[2]).toBe(3 / 4);
  expect(ratios[4]).toBe(4 / 3);
});
