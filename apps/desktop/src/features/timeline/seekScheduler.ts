// Keep UI intent independent of a decoder's asynchronous seeking/seeked cycle.
export class SeekScheduler {
  latest: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastTime = -Infinity;
  private lastTarget: number | undefined;
  private lastFast = false;
  constructor(
    private write: (time: number, fast: boolean) => void,
    private now: () => number = () => performance.now(),
  ) {}
  request(time: number, final = false) {
    this.latest = time;
    if (final) {
      this.clearTimer();
      this.dispatch(false);
      return;
    }
    const wait = 80 - (this.now() - this.lastTime);
    if (wait <= 0) {
      this.clearTimer();
      this.dispatch(true);
    } else if (this.timer === undefined)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.dispatch(true);
      }, wait);
  }
  private dispatch(fast: boolean) {
    if (this.latest === undefined) return;
    if (this.latest === this.lastTarget && (!this.lastFast || fast)) return;
    this.lastTime = this.now();
    this.lastTarget = this.latest;
    this.lastFast = fast;
    this.write(this.latest, fast);
  }
  settle(actual: number, seeking: boolean, playing = false) {
    if (this.latest === undefined) return true;
    const tolerance = playing
      ? Math.max(75, this.now() - this.lastTime + 75)
      : 75;
    if (!seeking && Math.abs(actual - this.latest) <= tolerance) {
      this.latest = undefined;
      this.lastTarget = undefined;
      return true;
    }
    return false;
  }
  flush() {
    this.clearTimer();
    this.dispatch(false);
  }
  reset() {
    this.clearTimer();
    this.latest = undefined;
    this.lastTarget = undefined;
    this.lastTime = -Infinity;
    this.lastFast = false;
  }
  private clearTimer() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
