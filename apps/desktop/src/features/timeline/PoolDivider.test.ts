import { describe, expect, it } from "vitest";
import { poolWidth } from "./PoolDivider";

describe("persisted media pool width", () => {
  it("defaults missing or malformed preferences without breaking startup", () => {
    expect(poolWidth(null)).toBe(280);
    expect(poolWidth("not-a-number")).toBe(280);
    expect(poolWidth("Infinity")).toBe(280);
  });
  it("retains valid widths and bounds out-of-range preferences", () => {
    expect(poolWidth("326")).toBe(326);
    expect(poolWidth("-40")).toBe(180);
    expect(poolWidth("10000000")).toBe(520);
  });
});
