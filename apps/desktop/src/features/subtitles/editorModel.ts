export type SrtCue = {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
};
export type SrtDocument = { cues: SrtCue[] };
export const maxTime = 359999999;
export function documentKey(doc: SrtDocument) {
  return JSON.stringify({
    cues: doc.cues.map((c) => ({
      id: c.id,
      start_ms: c.start_ms,
      end_ms: c.end_ms,
      text: c.text,
    })),
  });
}
export function cueClock(ms: number) {
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export function parseCueClock(value: string) {
  if (!/^\d{2}:\d{2}:\d{2}[,.]\d{3}$/.test(value))
    throw Error("Use HH:MM:SS,mmm");
  const [h, m, s, ms] = value.split(/[:,.]/).map(Number);
  if (m > 59 || s > 59) throw Error("Minutes and seconds must be below 60");
  return ((h * 60 + m) * 60 + s) * 1000 + ms;
}
export function cueIssues(doc: SrtDocument) {
  const issues: string[] = [];
  if (!doc.cues.length) issues.push("Add at least one cue before saving.");
  if (doc.cues.length > 10000) issues.push("Maximum 10,000 cues.");
  let previous: SrtCue | undefined;
  for (const [c, cue] of doc.cues.entries()) {
    const label = `Cue ${c + 1}`;
    if (cue.start_ms < 0 || cue.end_ms <= cue.start_ms || cue.end_ms > maxTime)
      issues.push(`${label}: invalid timing.`);
    if (!cue.text.trim()) issues.push(`${label}: enter subtitle text.`);
    if (/\n\s*\n|\r|\0/.test(cue.text))
      issues.push(
        `${label}: blank text lines/control characters cannot be saved in SRT.`,
      );
    if (previous && cue.start_ms < previous.start_ms)
      issues.push(
        `${label}: starts before the previous cue (sort if unintended).`,
      );
    else if (previous && cue.start_ms < previous.end_ms)
      issues.push(`${label}: overlaps the previous cue.`);
    if (
      cue.text.length / Math.max(0.001, (cue.end_ms - cue.start_ms) / 1000) >
      25
    )
      issues.push(`${label}: more than 25 characters per second.`);
    if (cue.text.split("\n").some((l) => Array.from(l).length > 42))
      issues.push(`${label}: a line exceeds 42 characters.`);
    previous = cue;
  }
  return issues;
}
export function shiftCues(
  doc: SrtDocument,
  ids: Set<string>,
  offset: number,
): SrtDocument {
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > 86400000)
    throw Error("Shift must be whole milliseconds within 24 hours.");
  const cues = doc.cues.map((c) =>
    ids.has(c.id)
      ? { ...c, start_ms: c.start_ms + offset, end_ms: c.end_ms + offset }
      : c,
  );
  if (cues.some((c) => c.start_ms < 0 || c.end_ms > maxTime))
    throw Error("Shift would place a cue outside supported time bounds.");
  return { cues };
}
export function splitCue(
  doc: SrtDocument,
  id: string,
  at: number,
  caret: number,
): SrtDocument {
  const index = doc.cues.findIndex((c) => c.id === id),
    cue = doc.cues[index];
  if (
    !cue ||
    !Number.isSafeInteger(at) ||
    at <= cue.start_ms ||
    at >= cue.end_ms
  )
    throw Error("Split time must be inside the selected cue.");
  if (
    !Number.isInteger(caret) ||
    caret < 0 ||
    caret > cue.text.length ||
    (caret > 0 &&
      /[\uD800-\uDBFF]/.test(cue.text[caret - 1]) &&
      /[\uDC00-\uDFFF]/.test(cue.text[caret] || ""))
  )
    throw Error(
      "Place the cursor between complete characters before splitting.",
    );
  const left = cue.text.slice(0, caret).trim(),
    right = cue.text.slice(caret).trim();
  if (!left || !right)
    throw Error(
      "Place the text cursor between the two parts before splitting.",
    );
  const cues = [...doc.cues];
  cues.splice(
    index,
    1,
    { ...cue, end_ms: at, text: left },
    { id: crypto.randomUUID(), start_ms: at, end_ms: cue.end_ms, text: right },
  );
  return { cues };
}
export function mergeCue(doc: SrtDocument, id: string): SrtDocument {
  const index = doc.cues.findIndex((c) => c.id === id),
    a = doc.cues[index],
    b = doc.cues[index + 1];
  if (!a || !b) throw Error("Select a cue with a following cue to merge.");
  const cues = [...doc.cues];
  cues.splice(index, 2, {
    ...a,
    start_ms: Math.min(a.start_ms, b.start_ms),
    end_ms: Math.max(a.end_ms, b.end_ms),
    text: `${a.text}\n${b.text}`.trim(),
  });
  return { cues };
}
export function replaceText(
  doc: SrtDocument,
  find: string,
  replacement: string,
  ids: Set<string>,
): SrtDocument {
  if (!find) throw Error("Enter text to find.");
  return {
    cues: doc.cues.map((c) =>
      ids.has(c.id) ? { ...c, text: c.text.split(find).join(replacement) } : c,
    ),
  };
}
