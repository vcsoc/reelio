export type Proportion =
  | "any"
  | "landscape"
  | "portrait"
  | "square"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "2:3"
  | "3:2"
  | "21:9"
  | "9:21";
export const proportions: {
  value: Proportion;
  label: string;
  preview: string;
}[] = [
  { value: "any", label: "Any proportions", preview: "2 / 3" },
  { value: "landscape", label: "Landscape", preview: "16 / 9" },
  { value: "portrait", label: "Portrait", preview: "2 / 3" },
  { value: "square", label: "Square (1:1)", preview: "1" },
  ...(
    ["4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9", "9:21"] as const
  ).map((value) => ({
    value,
    label: value,
    preview: value.replace(":", " / "),
  })),
];
export function posterOrientation(
  value: Proportion,
): "landscape" | "portrait" | undefined {
  if (value === "landscape" || value === "portrait") return value;
  if (value === "any" || value === "square") return undefined;
  const [w, h] = value.split(":").map(Number);
  return w > h ? "landscape" : "portrait";
}
export function togglePosterOrientation(
  value: Proportion,
  direction: "landscape" | "portrait",
): Proportion {
  if (posterOrientation(value) === direction) return "any";
  if (
    value === "any" ||
    value === "square" ||
    value === "landscape" ||
    value === "portrait"
  )
    return direction;
  return value.split(":").reverse().join(":") as Proportion;
}
export type Poster = {
  title: string;
  source_host: string;
  image_url: string;
  thumbnail_url: string;
  width?: number | null;
  height?: number | null;
};
export type PosterBatch = {
  results: Poster[];
  next_offset: number;
  has_more: boolean;
};
export type PosterSession = {
  query: string;
  proportion: Proportion;
  pageSize: number;
  offset: number;
  providerMore: boolean;
  buffer: Poster[];
  seen: Set<string>;
  pages: Poster[][];
};
export function createPosterSession(
  query: string,
  proportion: Proportion,
  pageSize: number,
): PosterSession {
  if (![12, 24, 48].includes(pageSize))
    throw new Error("Choose 12, 24 or 48 results per page");
  return {
    query,
    proportion,
    pageSize,
    offset: 0,
    providerMore: true,
    buffer: [],
    seen: new Set(),
    pages: [],
  };
}
export function hasNextPosterPage(session: PosterSession, page: number) {
  return (
    page + 1 < session.pages.length ||
    (session.pages.length < 40 &&
      (session.buffer.length > 0 || session.providerMore))
  );
}
export async function loadPosterPage(
  session: PosterSession,
  fetchBatch: (offset: number) => Promise<PosterBatch>,
) {
  if (session.pages.length >= 40)
    throw new Error("Search page limit reached; refine the query");
  // Bounded scanning fills sparse ratio-filtered pages without an unbounded request loop.
  for (
    let i = 0;
    i < 4 && session.buffer.length < session.pageSize && session.providerMore;
    i++
  ) {
    const batch = await fetchBatch(session.offset);
    if (batch.has_more && batch.next_offset <= session.offset)
      throw new Error("The search provider did not advance to more results");
    session.offset = batch.next_offset;
    session.providerMore = batch.has_more;
    for (const poster of batch.results) {
      if (!session.seen.has(poster.image_url)) {
        session.seen.add(poster.image_url);
        session.buffer.push(poster);
      }
    }
  }
  const page = session.buffer.splice(0, session.pageSize);
  session.pages.push(page);
  return page;
}
