import { describe, expect, it } from "vitest";
import { inspectorWidth } from "./InspectorDivider";

describe("persisted right inspector width", () => {
  it("defaults missing and malformed preferences", () => {
    expect(inspectorWidth(null)).toBe(440);
    expect(inspectorWidth("NaN")).toBe(440);
    expect(inspectorWidth("Infinity")).toBe(440);
  });
  it("retains widths within safe bounds", () => {
    expect(inspectorWidth("560")).toBe(560);
    expect(inspectorWidth("-1")).toBe(300);
    expect(inspectorWidth("999999")).toBe(900);
  });
});
