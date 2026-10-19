import { describe, it, expect } from "vitest";
import { adjustPixels } from "./LiveArtworkPreview";
const base = {
  grayscale: false,
  negative: false,
  sepia: false,
  brightness: 1,
  contrast: 1,
};
describe("immediate artwork color preview", () => {
  it("leaves neutral pixels and alpha untouched", () => {
    const data = new Uint8ClampedArray([20, 80, 160, 128]);
    adjustPixels(data, base);
    expect([...data]).toEqual([20, 80, 160, 128]);
  });
  it("matches backend grayscale then negative ordering", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    adjustPixels(data, { ...base, grayscale: true, negative: true });
    expect([...data]).toEqual([201, 201, 201, 255]);
  });
  it("applies sepia before brightness/contrast and clamps channels", () => {
    const data = new Uint8ClampedArray([100, 50, 0, 255]);
    adjustPixels(data, { ...base, sepia: true, brightness: 2, contrast: 1.5 });
    expect([...data]).toEqual([169, 144, 98, 255]);
    const white = new Uint8ClampedArray([255, 255, 255, 9]);
    adjustPixels(white, { ...base, brightness: 3, contrast: 3 });
    expect([...white]).toEqual([255, 255, 255, 9]);
  });
});
