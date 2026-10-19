import type { Chapter } from "../../types";
export function chapterTime(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  return `${String(Math.floor(value / 3600000)).padStart(2, "0")}:${String(Math.floor(value / 60000) % 60).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}.${String(value % 1000).padStart(3, "0")}`;
}
export function parseChapterTime(text: string): number | undefined {
  const parts = /^(\d{2,4}):([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(text);
  if (!parts) return undefined;
  const value =
    Number(parts[1]) * 3600000 +
    Number(parts[2]) * 60000 +
    Number(parts[3]) * 1000 +
    Number(parts[4]);
  return value <= 31536000000 ? value : undefined;
}
// Container chapters still require ends; users edit starts, not redundant boundaries.
export function chapterEnds(
  chapters: Chapter[],
  duration?: number | null,
): void {
  const starts = [...new Set(chapters.map((c) => c.start_ms))].sort(
    (a, b) => a - b,
  );
  const ends = new Map(
    starts.map((start, i) => [
      start,
      starts[i + 1] ?? Math.max(start + 1, duration || start + 1000),
    ]),
  );
  for (const chapter of chapters) chapter.end_ms = ends.get(chapter.start_ms)!;
}
