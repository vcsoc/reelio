export const playbackSpeeds = [
  0.1, 0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 10,
] as const;

// Source rates are nominal for VFR media; unavailable rates use a 25 fps estimate.
export function previewFrameMs(rate?: string): number {
  const parts = rate?.split("/").map(Number) ?? [];
  const fps =
    parts.length === 2 && parts[0] > 0 && parts[1] > 0
      ? parts[0] / parts[1]
      : parts.length === 1
        ? parts[0]
        : NaN;
  return Number.isFinite(fps) && fps > 0 && fps <= 1000 ? 1000 / fps : 40;
}
export function syncPreviewAudioRate(
  media: { playbackRate: number; pause: () => void },
  rate: number,
): boolean {
  try {
    media.playbackRate = rate;
    return true;
  } catch {
    media.pause();
    return false;
  }
}
export function frameTarget(
  current: number,
  direction: number,
  frameMs: number,
  end: number,
): number {
  return Math.max(0, Math.min(end, current + direction * frameMs));
}
