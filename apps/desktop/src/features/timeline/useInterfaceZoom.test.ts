import { describe, expect, it } from "vitest";
import { interfaceZoom } from "./useInterfaceZoom";
describe("persisted interface zoom", () => {
  it("defaults malformed or missing preferences", () => {
    for (const value of [
      null,
      "",
      " ",
      "NaN",
      "Infinity",
      "bad",
      "1".repeat(65),
    ])
      expect(interfaceZoom(value)).toBe(100);
  });
  it("bounds zoom without accepting extreme scales", () => {
    expect(interfaceZoom("-100")).toBe(50);
    expect(interfaceZoom("9999")).toBe(200);
    expect(interfaceZoom("50")).toBe(50);
    expect(interfaceZoom("200")).toBe(200);
  });
  it("retains rounded ten-percent steps", () => {
    expect(interfaceZoom("110")).toBe(110);
    expect(interfaceZoom("119.9")).toBe(120);
    expect(interfaceZoom("91")).toBe(90);
  });
});
