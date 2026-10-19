import { afterEach, describe, it, expect, vi } from "vitest";
import { SeekScheduler } from "./seekScheduler";
afterEach(() => vi.useRealTimers());
describe("responsive seeking", () => {
  it("can return to an earlier seek after playback has advanced", () => {
    const write = vi.fn(),
      scheduler = new SeekScheduler(write);
    scheduler.request(3000, true);
    expect(scheduler.settle(3000, false)).toBe(true);
    scheduler.request(3000, true);
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("coalesces intermediate moves without waiting for an old decoded frame", () => {
    vi.useFakeTimers();
    const write = vi.fn(),
      s = new SeekScheduler(write, () => Date.now());
    s.request(1000);
    s.request(2000);
    s.request(3000);
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(80);
    expect(write).toHaveBeenLastCalledWith(3000, true);
    expect(s.latest).toBe(3000);
    expect(s.settle(1000, false)).toBe(false);
  });
  it("release immediately applies the final target and cancels a queued move", () => {
    vi.useFakeTimers();
    const write = vi.fn(),
      s = new SeekScheduler(write, () => Date.now());
    s.request(1000);
    s.request(2000);
    s.request(4000, true);
    expect(write).toHaveBeenLastCalledWith(4000, false);
    expect(s.settle(1000, false)).toBe(false);
    expect(s.settle(4000, true)).toBe(false);
    expect(s.settle(4000, false)).toBe(true);
    vi.runAllTimers();
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("deduplicates input/change/release and invalidates old-source work", () => {
    vi.useFakeTimers();
    const write = vi.fn(),
      s = new SeekScheduler(write, () => Date.now());
    s.request(2000, true);
    s.request(2000, true);
    expect(write).toHaveBeenCalledTimes(1);
    s.request(3000);
    s.reset();
    vi.runAllTimers();
    expect(write).toHaveBeenCalledTimes(1);
    expect(s.latest).toBeUndefined();
    s.request(500, true);
    expect(write).toHaveBeenLastCalledWith(500, false);
  });
  it("accepts the advancing playback clock but not an unrelated stale completion", () => {
    vi.useFakeTimers();
    const s = new SeekScheduler(
      () => {},
      () => Date.now(),
    );
    s.request(3000, true);
    vi.advanceTimersByTime(500);
    expect(s.settle(1000, false, true)).toBe(false);
    expect(s.settle(3500, false, true)).toBe(true);
  });
});
