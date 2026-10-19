import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Plus, Crosshair } from "lucide-react";
import type { Project, Track } from "../../types";
import { basename, sourceStream, isImageAsset } from "../../types";
import { chapterTime } from "../chapters/timing";
import {
  MAX_OFFSET,
  MIN_CLIP_WIDTH,
  clipBounds,
  clipToVideo,
  videoTrimSnap,
  sourceDuration,
  trimAfterDrag,
  offsetAfterDrag,
  rulerInterval,
  timelineDuration,
  trackDuration,
  timelineViewportDuration,
  zoomTimeline,
  applyTimelineScroll,
} from "./geometry";
import "./timeline.css";

type Props = {
  project: Project;
  selected?: string;
  select: (id: string) => void;
  patch: (id: string, changes: Partial<Track>) => void;
  chapter: (index: number, time: number) => void;
  addChapter: (time: number) => void;
  seek: (time: number) => void;
  playhead: number;
  addAsset: (id: string) => void;
  addTracks?: () => void;
  busy?: boolean;
  removeTrack?: (id: string) => void;
  setMainVideo?: (id: string | null) => void;
  editCover?: () => void;
  removeCover?: () => void;
  deleteChapter?: (index: number) => void;
  reveal?: { time: number; revision: number };
};
type View = { zoom: number; scroll: number };
export function Timeline(props: Props) {
  const [view, setView] = useState<View>({ zoom: 1, scroll: 0 });
  const editorRef = useRef<HTMLElement>(null);
  const sharedView = useRef(view);
  const cursor = useRef<{ x: number; y: number } | undefined>(undefined);
  const setSharedView = useCallback<React.Dispatch<React.SetStateAction<View>>>(
    (action) => {
      const next =
        typeof action === "function" ? action(sharedView.current) : action;
      sharedView.current = next;
      setView(next);
    },
    [],
  );
  const zoomRequest = useRef<
    (delta: number, position?: { x: number; y: number }) => void
  >(() => {});
  const [menu, setMenu] = useState<{
    id: string;
    x: number;
    y: number;
    chapter?: number;
  }>();
  useEffect(() => setMenu(undefined), [props.project]);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    const dismiss = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(undefined);
    };
    const close = () => setMenu(undefined);
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("resize", close);
    document.addEventListener("wheel", close, { passive: true });
    document.addEventListener("touchmove", close, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("wheel", close);
      document.removeEventListener("touchmove", close);
    };
  }, [menu]);
  const tracks = props.project.tracks.filter(
    (t) =>
      !isImageAsset(
        props.project.assets.find((asset) => asset.id === t.asset_id),
      ) &&
      ["video", "audio", "subtitle"].includes(
        sourceStream(props.project, t)?.kind ?? "",
      ) &&
      !sourceStream(props.project, t)?.properties.attached_pic,
  );
  const menuTrack = props.project.tracks.find((track) => track.id === menu?.id);
  const clipAction = menuTrack
    ? clipToVideo(props.project, menuTrack)
    : undefined;
  // Keep excluded clips in view without changing the planned output duration.
  const end = timelineViewportDuration(props.project);
  zoomRequest.current = (delta, position = cursor.current) => {
    const lanes = Array.from(
      editorRef.current?.querySelectorAll<HTMLDivElement>(".lane-viewport") ??
        [],
    );
    const primary = lanes.find(
      (lane) => lane.getBoundingClientRect().width > 0,
    );
    if (!primary) return;
    const hovered =
      position &&
      lanes.find((lane) => {
        const rect = lane.getBoundingClientRect();
        return (
          position.x >= rect.left &&
          position.x < rect.right &&
          position.y >= rect.top &&
          position.y < rect.bottom
        );
      });
    const pointer =
      hovered && position
        ? position.x - hovered.getBoundingClientRect().left
        : undefined;
    const current = sharedView.current;
    setSharedView(
      zoomTimeline(
        current.zoom,
        delta,
        current.scroll,
        primary.clientWidth,
        end,
        props.playhead,
        pointer,
      ),
    );
  };
  useEffect(() => {
    const remember = (event: PointerEvent) => {
      cursor.current = { x: event.clientX, y: event.clientY };
    };
    const forget = () => {
      cursor.current = undefined;
    };
    const wheel = (event: WheelEvent) => {
      if (!event.altKey || !editorRef.current?.getBoundingClientRect().height)
        return;
      event.preventDefault();
      zoomRequest.current(event.deltaY, { x: event.clientX, y: event.clientY });
    };
    document.addEventListener("pointermove", remember, true);
    window.addEventListener("blur", forget);
    document.addEventListener("mouseleave", forget);
    document.addEventListener("wheel", wheel, { passive: false });
    return () => {
      document.removeEventListener("pointermove", remember, true);
      window.removeEventListener("blur", forget);
      document.removeEventListener("mouseleave", forget);
      document.removeEventListener("wheel", wheel);
    };
  }, []);
  return (
    <section
      className="timeline-editor"
      ref={editorRef}
      aria-label="Timeline editor"
      tabIndex={-1}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-reelio-asset"))
          e.preventDefault();
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("application/x-reelio-asset");
        if (id) {
          e.preventDefault();
          props.addAsset(id);
        }
      }}
    >
      <header className="timeline-toolbar">
        <strong>OUTPUT TIMELINE</strong>
        {props.addTracks && (
          <button
            className="timeline-add-tracks"
            onClick={props.addTracks}
            disabled={props.busy}
            title="Add tracks from media files"
          >
            <Plus size={14} aria-hidden="true" />
            Add tracks
          </button>
        )}
        <span>{chapterTime(props.playhead)}</span>
        <small>
          Drag clips to position · Drag edges to trim · Alt + wheel to zoom all
          tracks
        </small>
        <div className="timeline-zoom-controls">
          <button
            aria-label="Zoom timeline out"
            title="Zoom timeline out; keep cursor time or playback marker in view"
            onClick={() => zoomRequest.current(100)}
          >
            -
          </button>
          <button
            aria-label="Zoom timeline in"
            title="Zoom timeline in; keep cursor time or playback marker in view"
            onClick={() => zoomRequest.current(-100)}
          >
            +
          </button>
          <button
            className="timeline-zoom"
            title="Reset all timeline zoom"
            onClick={() => setSharedView({ zoom: 1, scroll: 0 })}
          >
            {Math.round(view.zoom * 100)}%
          </button>
        </div>
      </header>
      <div className="timeline-lanes">
        {tracks.length ? (
          tracks.map((t) => (
            <Lane
              key={`${props.project.id}:${t.id}`}
              {...props}
              track={t}
              view={view}
              end={end}
              setView={setSharedView}
              lead={t === tracks[0]}
              chapterContext={(index, x, y) =>
                setMenu({ id: t.id, x, y, chapter: index })
              }
              context={(x, y) => {
                props.select(t.id);
                setMenu({ id: t.id, x, y });
              }}
            />
          ))
        ) : !props.project.artwork ? (
          <div className="timeline-empty">
            Drop media into the media pool to begin. Every audio and subtitle
            stream gets its own lane.
          </div>
        ) : null}
        {props.project.artwork && (
          <article
            className="timeline-lane lane-cover"
            data-track-id="project-cover"
            aria-label="cover timeline"
            onDoubleClick={() => {
              setMenu(undefined);
              props.editCover?.();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({
                id: "project-cover",
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <div className="lane-heading">
              <div className="lane-name">
                <b>C</b>
                <span>Cover</span>
              </div>
              <small>Container artwork</small>
            </div>
            <button
              className="cover-timeline-clip"
              aria-label="Project cover"
              onKeyDown={(event) => {
                if (
                  (event.shiftKey && event.key === "F10") ||
                  event.key === "ContextMenu"
                ) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({
                    id: "project-cover",
                    x: rect.left + 12,
                    y: rect.top + 12,
                  });
                }
              }}
            >
              <img
                src={`data:image/jpeg;base64,${props.project.artwork.jpeg}`}
                alt="Cover thumbnail"
              />
              <span>
                {props.project.artwork.source_label || "Project cover"}
                <small>Container artwork · Not a video overlay</small>
              </span>
            </button>
          </article>
        )}
      </div>
      {menu &&
        (menu.id === "project-cover" ? !!props.project.artwork : !!menuTrack) &&
        (menu.chapter === undefined ||
          !!props.project.chapters[menu.chapter]) &&
        createPortal(
          <div
            className="timeline-context-menu"
            role="menu"
            aria-label={
              menu.chapter === undefined
                ? "Timeline clip actions"
                : "Chapter marker actions"
            }
            ref={menuRef}
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 190)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - 115)),
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setMenu(undefined);
            }}
            onKeyDown={(e) => {
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const buttons = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                );
                const current = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (current +
                          (e.key === "ArrowUp" ? -1 : 1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(undefined);
                document
                  .querySelector<HTMLButtonElement>(
                    `[data-track-id="${CSS.escape(menu.id)}"] .timeline-clip`,
                  )
                  ?.focus();
              }
            }}
          >
            {menu.chapter !== undefined ? (
              <button
                role="menuitem"
                disabled={!props.deleteChapter || props.busy}
                onClick={() => {
                  const index = menu.chapter!;
                  setMenu(undefined);
                  props.deleteChapter?.(index);
                  editorRef.current?.focus({ preventScroll: true });
                }}
              >
                Delete
              </button>
            ) : (
              <>
                {menu.id === "project-cover" ? (
                  <button
                    role="menuitem"
                    disabled={!props.editCover || props.busy}
                    onClick={() => {
                      setMenu(undefined);
                      props.editCover?.();
                    }}
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        const track = props.project.tracks.find(
                          (t) => t.id === menu.id,
                        );
                        if (track)
                          props.patch(track.id, { enabled: !track.enabled });
                        setMenu(undefined);
                        document
                          .querySelector<HTMLButtonElement>(
                            `[data-track-id="${CSS.escape(menu.id)}"] .timeline-clip`,
                          )
                          ?.focus({ preventScroll: true });
                      }}
                    >
                      {props.project.tracks.find((t) => t.id === menu.id)
                        ?.enabled
                        ? "Exclude"
                        : "Include"}
                    </button>
                    <button
                      role="menuitem"
                      disabled={!clipAction?.changes}
                      title={clipAction?.reason}
                      onClick={() => {
                        if (menuTrack && clipAction?.changes)
                          props.patch(menuTrack.id, clipAction.changes);
                        setMenu(undefined);
                        document
                          .querySelector<HTMLButtonElement>(
                            `[data-track-id="${CSS.escape(menu.id)}"] .timeline-clip`,
                          )
                          ?.focus({ preventScroll: true });
                      }}
                    >
                      Clip to video
                    </button>
                  </>
                )}
                <button
                  role="menuitem"
                  className="remove-action"
                  disabled={
                    props.busy ||
                    (menu.id === "project-cover"
                      ? !props.removeCover
                      : !props.removeTrack)
                  }
                  onClick={() => {
                    if (menu.id === "project-cover") props.removeCover?.();
                    else props.removeTrack?.(menu.id);
                    setMenu(undefined);
                    editorRef.current?.focus({ preventScroll: true });
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </section>
  );
}
function Lane(
  props: Props & {
    track: Track;
    view: View;
    end: number;
    setView: React.Dispatch<React.SetStateAction<View>>;
    lead: boolean;
    context: (x: number, y: number) => void;
    chapterContext: (index: number, x: number, y: number) => void;
  },
) {
  const { project: p, track: t } = props;
  const stream = sourceStream(p, t);
  const kind = stream?.kind;
  const canTrim =
    kind !== "subtitle" ||
    ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"].includes(
      stream?.codec ?? "",
    );
  const duration = trackDuration(p, t);
  const end = props.end;
  const { zoom } = props.view;
  const [draft, setDraft] = useState<number>();
  const [trimDraft, setTrimDraft] = useState<Partial<Track>>();
  const trimDrag = useRef<
    | {
        pointerId: number;
        x: number;
        edge: "start" | "end";
        start: number;
        end: number;
        duration: number;
        scale: number;
        snap?: { end: number; tolerance: number; activationEnd?: number };
        current?: Partial<Track>;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const suppressSurfaceClick = useRef(false);
  const [offsetText, setOffsetText] = useState<string>();
  const [chapterDraft, setChapterDraft] = useState<{
    index: number;
    time: number;
  }>();
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [scrollPosition, setScrollPosition] = useState(0);
  const appliedScroll = useRef<number | undefined>(undefined);
  const scale = (width / end) * zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const drag = useRef<
    | {
        x: number;
        original: number;
        current: number;
        chapter?: number;
        moved: boolean;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(100, entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (
      viewport.current &&
      Math.abs(viewport.current.scrollLeft - props.view.scroll) > 0.5
    ) {
      applyTimelineScroll(viewport.current, props.view.scroll);
      // WebKit rounds CSS scroll offsets at fractional display scales. Do not feed
      // these programmatic scroll events back through every synchronized lane.
      appliedScroll.current = viewport.current.scrollLeft;
    }
  }, [zoom, props.view.scroll, width]);
  useEffect(() => {
    if (props.lead && props.reveal && viewport.current) {
      const element = viewport.current,
        point = props.reveal.time * scaleRef.current;
      if (
        point >= element.scrollLeft + 16 &&
        point <= element.scrollLeft + element.clientWidth - 16
      )
        return;
      const next = Math.max(
        0,
        Math.min(
          end * scaleRef.current - element.clientWidth,
          point - element.clientWidth / 2,
        ),
      );
      props.setView((view) =>
        Math.abs(view.scroll - next) <= 0.5 ? view : { ...view, scroll: next },
      );
    }
  }, [props.reveal, props.lead, props.setView]);
  const at = (clientX: number) =>
    Math.max(
      0,
      Math.round(
        (clientX -
          (viewport.current?.getBoundingClientRect().left ?? 0) +
          (viewport.current?.scrollLeft ?? 0)) /
          scale,
      ),
    );
  const start = (e: React.PointerEvent<HTMLElement>, index?: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    suppressSurfaceClick.current = true;
    props.select(t.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const original =
      index === undefined ? t.offset_ms : p.chapters[index].start_ms;
    drag.current = {
      x: e.clientX,
      original,
      current: original,
      chapter: index,
      moved: false,
    };
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    d.moved ||= Math.abs(e.clientX - d.x) > 3;
    const value = offsetAfterDrag(
      d.original,
      e.clientX - d.x,
      scaleRef.current,
    );
    d.current =
      d.chapter === undefined
        ? value
        : Math.max(0, Math.min(timelineDuration(p) - 1, value));
    if (d.chapter === undefined) setDraft(d.current);
    else setChapterDraft({ index: d.chapter, time: d.current });
  };
  const finish = (e: React.PointerEvent<HTMLElement>, cancel = false) => {
    const d = drag.current;
    if (!d) return;
    drag.current = undefined;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setDraft(undefined);
    setChapterDraft(undefined);
    if (cancel) return;
    if (d.chapter !== undefined) {
      if (d.current !== d.original) props.chapter(d.chapter, d.current);
      else props.seek(d.current);
    } else if (d.moved) props.patch(t.id, { offset_ms: d.current });
    else if (kind === "video") props.addChapter(at(e.clientX));
  };
  const beginTrim = (
    e: React.PointerEvent<HTMLButtonElement>,
    edge: "start" | "end",
  ) => {
    if (e.button !== 0 || trimDrag.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressSurfaceClick.current = true;
    props.select(t.id);
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const bounds = clipBounds(p, t);
    trimDrag.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      edge,
      ...bounds,
      duration,
      scale,
      snap: videoTrimSnap(p, t, scale),
      moved: false,
    };
  };
  const moveTrim = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = trimDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.moved ||= Math.abs(e.clientX - d.x) > 3;
    d.current = trimAfterDrag(
      d.edge,
      d.start,
      d.end,
      d.duration,
      t.offset_ms,
      (e.clientX - d.x) / d.scale,
      d.snap,
    );
    setTrimDraft(d.current);
  };
  const finishTrim = (
    e: React.PointerEvent<HTMLButtonElement>,
    cancel = false,
  ) => {
    const d = trimDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!cancel) {
      d.moved ||= Math.abs(e.clientX - d.x) > 3;
      d.current = trimAfterDrag(
        d.edge,
        d.start,
        d.end,
        d.duration,
        t.offset_ms,
        (e.clientX - d.x) / d.scale,
        d.snap,
      );
    }
    trimDrag.current = undefined;
    setTrimDraft(undefined);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancel && d.moved && d.current) props.patch(t.id, d.current);
  };
  const bounds = clipBounds(p, { ...t, ...trimDraft });
  const knownDuration = sourceDuration(p, t);
  const offset = draft ?? t.offset_ms;
  const clipLeft = Math.max(0, offset + bounds.start) * scale;
  const clipWidth = Math.max(
    MIN_CLIP_WIDTH,
    (bounds.end + offset - Math.max(0, bounds.start + offset)) * scale,
  );
  const rulerStep = rulerInterval(scale);
  const firstTick = Math.max(
    0,
    Math.floor(scrollPosition / scale / rulerStep) - 1,
  );
  const tickCount = Math.max(
    0,
    Math.min(
      64,
      Math.ceil(width / (rulerStep * scale)) + 4,
      Math.ceil(end / rulerStep) + 1 - firstTick,
    ),
  );
  const asset = p.assets.find((a) => a.id === t.asset_id);
  return (
    <article
      className={`timeline-lane lane-${kind} ${props.selected === t.id ? "selected" : ""} ${!t.enabled || t.muted ? "excluded" : ""}`}
      data-track-id={t.id}
      onContextMenu={(e) => {
        if (
          e.target instanceof Element &&
          e.target.closest("input, select, textarea")
        )
          return;
        e.preventDefault();
        props.context(e.clientX, e.clientY);
      }}
      aria-label={`${kind} timeline ${t.title || basename(asset?.path ?? "")}`}
    >
      <div className="lane-heading">
        <div className="lane-name">
          <b>{kind === "video" ? "V" : kind === "audio" ? "A" : "S"}</b>
          <button
            className="lane-select"
            title={asset?.path}
            onClick={() => props.select(t.id)}
          >
            {t.title || basename(asset?.path ?? "Media")}
          </button>
        </div>
        <div className="lane-options">
          {kind === "video" && (
            <button
              className="lane-reference"
              disabled={props.busy || !props.setMainVideo}
              aria-label={`Set ${t.title || basename(asset?.path ?? "video")} as main video`}
              aria-pressed={p.main_video_track_id === t.id}
              title={
                p.main_video_track_id === t.id
                  ? "Main video reference. Click to return to automatic timing. Does not change export inclusion."
                  : "Use this clip as the main/source reference for fitting and snapping, even when excluded. Does not change export inclusion."
              }
              onClick={() =>
                props.setMainVideo?.(
                  p.main_video_track_id === t.id ? null : t.id,
                )
              }
            >
              <Crosshair size={14} />
            </button>
          )}
          {kind === "audio" && (
            <>
              <button
                className="lane-mute"
                aria-label={`${t.muted ? "Unmute" : "Mute"} ${t.title || basename(asset?.path ?? "audio")}`}
                aria-pressed={!!t.muted}
                onClick={() => props.patch(t.id, { muted: !t.muted })}
              >
                {t.muted ? "Muted" : "Mute"}
              </button>
              <select
                aria-label={`Audio output ${t.id}`}
                value={t.audio_role ?? "separate"}
                onChange={(e) =>
                  props.patch(t.id, {
                    audio_role: e.target.value as "mix" | "separate",
                  })
                }
              >
                <option value="mix">Mix into main audio</option>
                <option value="separate">Separate language track</option>
              </select>
            </>
          )}
          {(kind === "audio" || kind === "subtitle") && (
            <input
              className="lane-language"
              aria-label={`Timeline language ${t.id}`}
              list="languages"
              maxLength={3}
              value={t.language}
              onChange={(e) =>
                props.patch(t.id, { language: e.target.value.toLowerCase() })
              }
            />
          )}
          <label className="lane-offset">
            Offset ms
            <input
              aria-label={`Timeline offset ${t.id}`}
              type="number"
              min={-MAX_OFFSET}
              max={MAX_OFFSET}
              step={10}
              value={offsetText ?? offset}
              onFocus={() => setOffsetText(String(offset))}
              onChange={(e) => setOffsetText(e.target.value)}
              onBlur={(e) => {
                if (
                  e.target.value !== "" &&
                  Number.isFinite(e.target.valueAsNumber)
                )
                  props.patch(t.id, {
                    offset_ms: Math.max(
                      -MAX_OFFSET,
                      Math.min(MAX_OFFSET, Math.round(e.target.valueAsNumber)),
                    ),
                  });
                setOffsetText(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = String(t.offset_ms);
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
      </div>
      <div
        className="lane-viewport"
        ref={viewport}
        data-zoom={zoom}
        data-view-scroll={props.view.scroll}
        onScroll={(e) => {
          const left = e.currentTarget.scrollLeft;
          setScrollPosition(left);
          if (
            appliedScroll.current !== undefined &&
            Math.abs(left - appliedScroll.current) < 0.01
          )
            return;
          appliedScroll.current = undefined;
          if (Math.abs(left - props.view.scroll) > 0.5)
            props.setView((v) => ({ ...v, scroll: left }));
        }}
      >
        <div
          className="lane-world"
          style={{ width: Math.max(width, end * scale) }}
        >
          <div
            className="lane-ruler"
            aria-label="Seek timeline"
            onClick={(e) => props.seek(at(e.clientX))}
          >
            {Array.from({ length: tickCount }, (_, n) => (
              <span
                key={n + firstTick}
                style={{ left: (n + firstTick) * rulerStep * scale }}
              >
                {chapterTime((n + firstTick) * rulerStep)}
              </span>
            ))}
          </div>
          <div
            className="lane-surface"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget)
                suppressSurfaceClick.current = false;
            }}
            onClick={(e) => {
              // Pointer capture/cancellation can retarget the synthesized click to the lane.
              if (suppressSurfaceClick.current) {
                suppressSurfaceClick.current = false;
                return;
              }
              if (kind === "video" && e.target === e.currentTarget)
                props.addChapter(at(e.clientX));
            }}
          >
            <button
              className="timeline-clip"
              aria-label={`Move ${t.title || kind} clip`}
              title="Drag to position. Ctrl+Alt+click: clip to video. Arrow keys: 100 ms; Shift: 1 second; Alt: 10 ms."
              style={{
                left: clipLeft,
                width: clipWidth,
              }}
              onPointerDown={(e) => {
                if (e.button === 0 && e.ctrlKey && e.altKey) {
                  e.stopPropagation();
                  return;
                }
                start(e);
              }}
              onClick={(e) => {
                if (!e.ctrlKey || !e.altKey) return;
                e.preventDefault();
                e.stopPropagation();
                suppressSurfaceClick.current = false;
                props.select(t.id);
                const action = clipToVideo(p, t);
                if (action.changes) props.patch(t.id, action.changes);
              }}
              onPointerMove={move}
              onPointerUp={(e) => finish(e)}
              onPointerCancel={(e) => finish(e, true)}
              onKeyDown={(e) => {
                if (e.key === "F10" && e.shiftKey) {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  props.context(rect.left + 20, rect.top + 20);
                  return;
                }
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                props.patch(t.id, {
                  offset_ms: Math.max(
                    -MAX_OFFSET,
                    Math.min(
                      MAX_OFFSET,
                      t.offset_ms +
                        (e.key === "ArrowLeft" ? -1 : 1) *
                          (e.altKey ? 10 : e.shiftKey ? 1000 : 100),
                    ),
                  ),
                });
              }}
            >
              {!t.enabled && (
                <span className="clip-excluded-pill">Excluded</span>
              )}
              {t.enabled && t.muted && (
                <span className="clip-excluded-pill">Muted</span>
              )}
              <span>{t.title || basename(asset?.path ?? "Media")}</span>
              <small>
                Start {chapterTime(Math.max(0, offset + bounds.start))}
                {" · "}
                {chapterTime(bounds.end - Math.max(bounds.start, -offset))}
              </small>
            </button>
            {knownDuration !== null &&
              knownDuration >= 10 &&
              bounds.end > Math.max(0, -offset) &&
              (["start", "end"] as const).map((edge) => (
                <button
                  key={edge}
                  className={`clip-trim-handle trim-${edge}${edge === "end" && trimDraft && trimDrag.current?.edge === "end" && trimDrag.current?.snap?.end === (trimDraft.trim_end_ms ?? duration) ? " snap-aligned" : ""}`}
                  role="slider"
                  disabled={!canTrim}
                  aria-label={`Trim ${edge} ${t.title || kind} clip`}
                  aria-orientation="horizontal"
                  aria-valuemin={
                    edge === "start"
                      ? Math.max(0, -offset)
                      : Math.max(bounds.start, -offset) + 10
                  }
                  aria-valuemax={
                    edge === "start" ? bounds.end - 10 : knownDuration
                  }
                  aria-valuenow={
                    edge === "start"
                      ? Math.max(bounds.start, -offset)
                      : bounds.end
                  }
                  aria-valuetext={chapterTime(
                    edge === "start"
                      ? Math.max(bounds.start, -offset)
                      : bounds.end,
                  )}
                  title={
                    canTrim
                      ? `Drag to trim ${edge}; ${kind !== "video" ? "end snaps to video within 8 pixels. " : ""}Arrow keys adjust, Shift: 1 second, Alt: 10 ms. Double-click restores this source boundary.`
                      : "Image-subtitle trimming is not supported; source remains unchanged."
                  }
                  style={{
                    left: clipLeft + (edge === "end" ? clipWidth - 10 : 0),
                  }}
                  onPointerDown={(e) => beginTrim(e, edge)}
                  onPointerMove={moveTrim}
                  onPointerUp={(e) => finishTrim(e)}
                  onPointerCancel={(e) => finishTrim(e, true)}
                  onLostPointerCapture={(e) => finishTrim(e, true)}
                  onDoubleClick={() =>
                    props.patch(
                      t.id,
                      edge === "start"
                        ? { trim_start_ms: 0 }
                        : { trim_end_ms: null },
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      const pointer = trimDrag.current?.pointerId;
                      trimDrag.current = undefined;
                      setTrimDraft(undefined);
                      if (
                        pointer !== undefined &&
                        e.currentTarget.hasPointerCapture(pointer)
                      )
                        e.currentTarget.releasePointerCapture(pointer);
                      return;
                    }
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        e.key,
                      )
                    )
                      return;
                    e.preventDefault();
                    props.select(t.id);
                    const delta =
                      e.key === "Home"
                        ? -Infinity
                        : e.key === "End"
                          ? Infinity
                          : (e.key === "ArrowLeft" ? -1 : 1) *
                            (e.altKey ? 10 : e.shiftKey ? 1000 : 100);
                    props.patch(
                      t.id,
                      trimAfterDrag(
                        edge,
                        bounds.start,
                        bounds.end,
                        knownDuration,
                        t.offset_ms,
                        delta,
                      ),
                    );
                  }}
                />
              ))}
            {kind === "video" &&
              p.container !== "matroska" &&
              p.chapters[0]?.start_ms > 0 && (
                <span
                  className="chapter-pin auto-opening"
                  role="img"
                  aria-label="Automatic Opening chapter"
                  title="Opening chapter at zero is added automatically for MP4/M4V playback"
                  style={{ left: 0 }}
                >
                  0
                </span>
              )}
            {kind === "video" &&
              p.chapters.map((c, i) => (
                <button
                  key={i}
                  className="chapter-pin"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.chapterContext(i, event.clientX, event.clientY);
                  }}
                  aria-label={`Chapter marker ${c.title}`}
                  title={`${c.title} · ${chapterTime(c.start_ms)} · Drag to reposition`}
                  style={{
                    left:
                      (chapterDraft?.index === i
                        ? chapterDraft.time
                        : c.start_ms) * scale,
                  }}
                  onPointerDown={(e) => start(e, i)}
                  onPointerMove={move}
                  onPointerUp={(e) => finish(e)}
                  onPointerCancel={(e) => finish(e, true)}
                  onKeyDown={(e) => {
                    if (
                      (e.shiftKey && e.key === "F10") ||
                      e.key === "ContextMenu"
                    ) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      props.chapterContext(i, rect.left + 10, rect.top + 10);
                      return;
                    }
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      props.chapter(
                        i,
                        Math.max(
                          0,
                          c.start_ms + (e.key === "ArrowLeft" ? -100 : 100),
                        ),
                      );
                    }
                  }}
                >
                  ◆
                </button>
              ))}
            <span
              className="lane-playhead"
              data-time={props.playhead}
              aria-label="Playback marker"
              style={{ left: props.playhead * scale }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
