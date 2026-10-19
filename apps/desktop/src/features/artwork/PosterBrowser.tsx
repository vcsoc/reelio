import { useEffect, useRef, useState } from "react";
import { RectangleHorizontal, RectangleVertical, X, Info } from "lucide-react";
import { call } from "../../services/desktop";
import type { Artwork } from "../../types";
import type { Run } from "../resources/ResourceSearch";
import {
  createPosterSession,
  hasNextPosterPage,
  loadPosterPage,
  proportions,
  posterOrientation,
  togglePosterOrientation,
  type Poster,
  type PosterBatch,
  type PosterSession,
  type Proportion,
} from "./posterSearch";

// Keep thumbnail requests bounded, including when the user changes pages.
const lanes: Promise<unknown>[] = Array.from({ length: 3 }, () =>
  Promise.resolve(),
);
let nextLane = 0;
function thumbnail(work: () => Promise<Artwork | undefined>) {
  const index = nextLane++ % lanes.length;
  const result = lanes[index].then(work);
  lanes[index] = result.catch(() => undefined);
  return result;
}
function PosterThumbnail({
  poster,
  proportion,
}: {
  poster: Poster;
  proportion: Proportion;
}) {
  const [image, setImage] = useState<Artwork>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void thumbnail(async () => {
      if (!active) return undefined;
      return call<Artwork>("poster_image", {
        url: poster.thumbnail_url,
        proportion: "any",
      });
    })
      .then((art) => {
        if (active && art) setImage(art);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [poster.thumbnail_url]);
  const preview = proportions.find((p) => p.value === proportion)?.preview;
  return (
    <div className="poster-thumbnail" style={{ aspectRatio: preview }}>
      {image ? (
        <img
          src={`data:image/jpeg;base64,${image.jpeg}`}
          alt={`${poster.title} poster`}
        />
      ) : (
        <span>{failed ? "Preview unavailable" : "Loading poster..."}</span>
      )}
    </div>
  );
}
export function PosterBrowser({
  title,
  targetName,
  appliedJpeg,
  busy,
  run,
  onSelect,
}: {
  title: string;
  targetName: string;
  appliedJpeg?: string;
  busy: boolean;
  run: Run;
  onSelect: (art: Artwork) => void;
}) {
  const [query, setQuery] = useState(title);
  const [proportion, setProportion] = useState<Proportion>("any");
  const [pageSize, setPageSize] = useState(12);
  const [session, setSession] = useState<PosterSession>();
  const [page, setPage] = useState(0);
  const [applying, setApplying] = useState<string>();
  const [selected, setSelected] = useState<{ url: string; jpeg: string }>();
  const alive = useRef(true);
  const titleInput = useRef<HTMLInputElement>(null);
  const selectOnMouseUp = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function fetchBatch(s: PosterSession, offset: number) {
    return call<PosterBatch>("poster_search", {
      query: s.query,
      proportion: s.proportion,
      offset,
    });
  }
  async function search(filter = proportion, size = pageSize) {
    setSession(undefined);
    setPage(0);
    if (!query.trim()) return;
    const next = createPosterSession(query, filter, size);
    const success = await run(
      "Searching the internal poster browser",
      async () => {
        await loadPosterPage(next, (offset) => fetchBatch(next, offset));
        return next;
      },
    );
    if (alive.current && success) setSession(success);
  }
  async function nextPage() {
    if (!session) return;
    if (page + 1 < session.pages.length) {
      setPage(page + 1);
      return;
    }
    const current = session;
    const success = await run("Finding more matching posters", async () => {
      await loadPosterPage(current, (offset) => fetchBatch(current, offset));
      return true;
    });
    if (alive.current && success) setPage(current.pages.length - 1);
  }
  async function usePoster(poster: Poster) {
    setApplying(poster.image_url);
    const art = await run("Downloading and applying the selected cover", () =>
      call<Artwork>("poster_image", {
        url: poster.image_url,
        proportion: session?.proportion || "any",
      }),
    );
    if (alive.current) setApplying(undefined);
    if (alive.current && art) {
      setSelected({ url: poster.image_url, jpeg: art.jpeg });
      onSelect(art);
    }
  }
  function changeOrientation(direction: "landscape" | "portrait") {
    const next = togglePosterOrientation(proportion, direction);
    setProportion(next);
    void search(next, pageSize);
  }
  const orientation = posterOrientation(proportion);
  const results = session?.pages[page];
  return (
    <section
      className="resource-search poster-browser"
      aria-label="Internal poster browser"
    >
      <h3>
        Internal poster browser{" "}
        <button
          type="button"
          className="artwork-info"
          aria-label="About poster search"
          title={`Use this cover downloads, validates and applies artwork to ${targetName}. Ratios and page sizes refresh automatically. Exact ratios match reported dimensions within 4%, are rechecked after download and center-cropped without stretching. Orientation filters preserve the original ratio. Only your query and thumbnails go to Bing/providers, never your video. Check image usage rights; some hosts block downloads.`}
        >
          <Info size={13} />
        </button>
      </h3>
      <form
        className="poster-search-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="poster-title-field">
          <label htmlFor="poster-movie-title">Movie title</label>
          <div className="poster-title-input">
            <input
              id="poster-movie-title"
              ref={titleInput}
              value={query}
              maxLength={256}
              onFocus={(e) => {
                e.currentTarget.select();
                selectOnMouseUp.current = true;
              }}
              onMouseUp={(e) => {
                if (selectOnMouseUp.current) {
                  e.preventDefault();
                  e.currentTarget.select();
                  selectOnMouseUp.current = false;
                }
              }}
              onBlur={() => {
                selectOnMouseUp.current = false;
              }}
              onKeyDown={() => {
                selectOnMouseUp.current = false;
              }}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Movie title and year"
            />
            {query.length > 0 && (
              <button
                type="button"
                className="poster-title-clear"
                aria-label="Clear movie title"
                title="Clear movie title"
                disabled={busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setSession(undefined);
                  setPage(0);
                  titleInput.current?.focus();
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <button
          type="submit"
          className="primary"
          disabled={busy || !query.trim()}
        >
          Search posters
        </button>
        <div
          className="poster-orientation"
          role="group"
          aria-label="Image orientation"
        >
          <button
            type="button"
            className="secondary"
            aria-label="Landscape"
            title="Landscape"
            aria-pressed={orientation === "landscape"}
            disabled={busy}
            onClick={() => changeOrientation("landscape")}
          >
            <RectangleHorizontal size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="secondary"
            aria-label="Portrait"
            title="Portrait"
            aria-pressed={orientation === "portrait"}
            disabled={busy}
            onClick={() => changeOrientation("portrait")}
          >
            <RectangleVertical size={18} aria-hidden="true" />
          </button>
        </div>
        <label>
          Image proportions
          <select
            value={
              proportion === "landscape" || proportion === "portrait"
                ? "any"
                : proportion
            }
            disabled={busy}
            onChange={(e) => {
              const ratio = e.target.value as Proportion;
              const value = ratio === "any" ? orientation || "any" : ratio;
              setProportion(value);
              void search(value, pageSize);
            }}
          >
            {proportions
              .filter((p) => p.value !== "landscape" && p.value !== "portrait")
              .map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Results per page
          <select
            value={pageSize}
            disabled={busy}
            onChange={(e) => {
              const size = Number(e.target.value);
              setPageSize(size);
              void search(proportion, size);
            }}
          >
            {[12, 24, 48].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </form>
      {session && (
        <>
          <nav className="poster-pagination" aria-label="Poster result pages">
            <button
              className="secondary"
              disabled={busy || page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous page
            </button>
            <span role="status">
              Page {page + 1} - {results?.length || 0} results (up to{" "}
              {session.pageSize})
            </span>
            <button
              className="secondary"
              disabled={busy || !hasNextPosterPage(session, page)}
              onClick={() => void nextPage()}
            >
              Next page
            </button>
          </nav>
          {results?.length === 0 && (
            <p className="muted">
              No matching posters in this group.{" "}
              {hasNextPosterPage(session, page)
                ? "Try Next page to search further, or broaden the proportions."
                : "Try a different query or broader proportions."}
            </p>
          )}
          <button
            type="button"
            className="artwork-info"
            aria-label="About poster pagination"
            title="Pages may contain fewer matches. Up to four provider batches are checked per new page, duplicate image URLs are removed and previous pages are cached. Provider totals are unavailable."
          >
            <Info size={13} />
          </button>
        </>
      )}
      {session && (session.offset >= 1400 || session.pages.length >= 40) && (
        <p className="muted">
          Search safety limit reached. Refine the title or proportions to see a
          different set of results.
        </p>
      )}
      <div
        className="poster-results"
        key={`${session?.query}:${session?.proportion}:${session?.pageSize}:${page}`}
      >
        {results?.map((poster) => (
          <article className="poster-result" key={poster.image_url}>
            <PosterThumbnail
              poster={poster}
              proportion={session?.proportion || "any"}
            />
            <strong>{poster.title}</strong>
            <span className="muted">{poster.source_host}</span>
            <span className="muted">
              {poster.width && poster.height
                ? `Reported ${poster.width} x ${poster.height}`
                : "Dimensions unavailable"}
            </span>
            <button
              className={
                selected?.url === poster.image_url &&
                selected.jpeg === appliedJpeg
                  ? "secondary"
                  : "primary"
              }
              disabled={busy}
              aria-label={`Use cover for ${poster.title}`}
              onClick={() => void usePoster(poster)}
            >
              {selected?.url === poster.image_url &&
              selected.jpeg === appliedJpeg
                ? "Applied - use again"
                : applying === poster.image_url
                  ? "Applying..."
                  : "Use this cover"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
