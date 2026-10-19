import { describe, expect, it } from "vitest";
import { workspaceLayout } from "./workspaceLayout";

const defaults = {
  fullHeightLeft: false,
  leftCollapsed: false,
  rightCollapsed: false,
};
describe("persisted workspace layout", () => {
  it("defaults missing, malformed and oversized preferences", () => {
    for (const value of [
      null,
      "",
      "{",
      "null",
      "[]",
      "true",
      "1",
      "x".repeat(513),
    ])
      expect(workspaceLayout(value)).toEqual(defaults);
  });
  it("retains each independent boolean preference", () => {
    for (const fullHeightLeft of [false, true])
      for (const leftCollapsed of [false, true])
        for (const rightCollapsed of [false, true]) {
          const layout = { fullHeightLeft, leftCollapsed, rightCollapsed };
          expect(workspaceLayout(JSON.stringify(layout))).toEqual(layout);
        }
  });
  it("defaults missing fields without coercing values or retaining unrelated data", () => {
    expect(
      workspaceLayout(
        '{"fullHeightLeft":true,"leftCollapsed":"true","rightCollapsed":1,"project":"ignored"}',
      ),
    ).toEqual({ ...defaults, fullHeightLeft: true });
    expect(workspaceLayout('{"rightCollapsed":true}')).toEqual({
      ...defaults,
      rightCollapsed: true,
    });
  });
});
