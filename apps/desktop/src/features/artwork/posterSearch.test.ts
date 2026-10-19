import { describe, expect, it } from "vitest";
import {
  posterOrientation,
  togglePosterOrientation,
  createPosterSession,
  hasNextPosterPage,
  loadPosterPage,
  type Poster,
} from "./posterSearch";
const poster = (id: number): Poster => ({
  title: `Poster ${id}`,
  source_host: "example.com",
  image_url: `https://example.com/${id}.jpg`,
  thumbnail_url: `https://example.com/${id}-thumb.jpg`,
  width: 1600,
  height: 900,
});
describe("poster pagination", () => {
  it("keeps orientation icons consistent with ratios and flips reciprocal ratios", () => {
    expect(togglePosterOrientation("any", "landscape")).toBe("landscape");
    expect(togglePosterOrientation("landscape", "landscape")).toBe("any");
    expect(togglePosterOrientation("16:9", "portrait")).toBe("9:16");
    expect(togglePosterOrientation("16:9", "landscape")).toBe("any");
    expect(togglePosterOrientation("3:4", "landscape")).toBe("4:3");
    expect(togglePosterOrientation("21:9", "portrait")).toBe("9:21");
    expect(togglePosterOrientation("square", "portrait")).toBe("portrait");
    expect(posterOrientation("9:21")).toBe("portrait");
    expect(posterOrientation("square")).toBeUndefined();
  });
  it("fills 48 slots across provider batches, caches overflow and removes duplicates", async () => {
    const session = createPosterSession("Movie", "16:9", 48);
    let calls = 0;
    const fetch = async (offset: number) => {
      calls++;
      return {
        results: Array.from({ length: 35 }, (_, i) => poster(offset + i)),
        next_offset: offset + 35,
        has_more: offset < 70,
      };
    };
    const first = await loadPosterPage(session, fetch);
    expect(first).toHaveLength(48);
    expect(calls).toBe(2);
    expect(session.buffer).toHaveLength(22);
    const second = await loadPosterPage(session, fetch);
    expect(second).toHaveLength(48);
    expect(new Set([...first, ...second].map((p) => p.image_url)).size).toBe(
      96,
    );
    await loadPosterPage(session, fetch);
    expect(hasNextPosterPage(session, 2)).toBe(false);
    expect(hasNextPosterPage(session, 0)).toBe(true);
  });
  it("caps sparse searches at four batches per page and handles empty pages", async () => {
    const session = createPosterSession("Movie", "4:3", 12);
    let calls = 0;
    await loadPosterPage(session, async (offset) => {
      calls++;
      return { results: [], next_offset: offset + 35, has_more: true };
    });
    expect(calls).toBe(4);
    expect(session.pages[0]).toEqual([]);
    expect(hasNextPosterPage(session, 0)).toBe(true);
  });
  it("retains successful data after a failed continuation and avoids repeated results", async () => {
    const session = createPosterSession("Movie", "any", 12);
    await expect(
      loadPosterPage(session, async (offset) => {
        if (offset) throw Error("offline");
        return {
          results: [poster(1), poster(1)],
          next_offset: 35,
          has_more: true,
        };
      }),
    ).rejects.toThrow("offline");
    expect(session.buffer).toHaveLength(1);
    await loadPosterPage(session, async () => ({
      results: [poster(1), poster(2)],
      next_offset: 70,
      has_more: false,
    }));
    expect(session.pages[0].map((p) => p.title)).toEqual([
      "Poster 1",
      "Poster 2",
    ]);
  });
  it("rejects invalid sizes and stalled cursors", async () => {
    expect(() => createPosterSession("Movie", "any", 1000)).toThrow();
    await expect(
      loadPosterPage(createPosterSession("Movie", "any", 12), async () => ({
        results: [],
        next_offset: 0,
        has_more: true,
      })),
    ).rejects.toThrow("did not advance");
  });
});
