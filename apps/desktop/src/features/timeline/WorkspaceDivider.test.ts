import { describe, it, expect } from "vitest";
import { boundViewerHeight, viewerHeightPreference } from "./WorkspaceDivider";
describe("viewer versus lower-workspace layout", () => {
  it("restores only bounded finite preferences", () => {
    expect(viewerHeightPreference(null)).toBeUndefined();
    expect(viewerHeightPreference("no")).toBeUndefined();
    expect(viewerHeightPreference("Infinity")).toBeUndefined();
    expect(viewerHeightPreference("-1")).toBe(220);
    expect(viewerHeightPreference("9000")).toBe(1600);
    expect(viewerHeightPreference("450")).toBe(450);
  });
  it("reserves usable space above and below the divider", () => {
    expect(boundViewerHeight(900, 900)).toBe(640);
    expect(boundViewerHeight(-20, 900)).toBe(220);
    expect(boundViewerHeight(420, 900)).toBe(420);
    expect(boundViewerHeight(900, 300)).toBe(220);
  });
});
