import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { call, desktop } from "../../services/desktop";
import {
  cueClock,
  documentKey,
  parseCueClock,
  cueIssues,
  shiftCues,
  splitCue,
  mergeCue,
  replaceText,
  maxTime,
  type SrtDocument,
  type SrtCue,
} from "./editorModel";
import "./subtitleEditor.css";
type Job = {
  id: string;
  kind: string;
  status: string;
  done: number;
  total: number;
  message: string;
};
type Translation = { id: string; text: string };
type Review = {
  document: SrtDocument;
  translations: Translation[];
  language?: string;
  model?: string;
};
const empty = (): SrtDocument => ({ cues: [] });
const languages = [
  "English",
  "Afrikaans",
  "Arabic",
  "Chinese",
  "Dutch",
  "French",
  "German",
  "Hindi",
  "Italian",
  "Japanese",
  "Korean",
  "Polish",
  "Portuguese",
  "Russian",
  "Spanish",
  "Swahili",
  "Turkish",
  "Ukrainian",
  "Zulu",
];
export function openSubtitleEditor() {
  window.dispatchEvent(new Event("reelio:subtitle-editor"));
}
export function SubtitleEditor({
  videoUrl,
  onOpen,
  onAdd,
  sources,
  projectBusy,
}: {
  videoUrl?: string;
  projectBusy?: boolean;
  onOpen: () => void;
  onAdd: (paths: string[]) => Promise<void>;
  sources: { path: string; label: string }[];
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    player = useRef<HTMLVideoElement>(null),
    textArea = useRef<HTMLTextAreaElement>(null),
    persist = useRef<Promise<unknown>>(Promise.resolve()),
    started = useRef(false),
    openRef = useRef(onOpen);
  openRef.current = onOpen;
  const [history, setHistory] = useState<{
      past: SrtDocument[];
      doc: SrtDocument;
      future: SrtDocument[];
    }>({ past: [], doc: empty(), future: [] }),
    [baseline, setBaseline] = useState(documentKey(empty())),
    [forcedDraft, setForcedDraft] = useState(false),
    [ready, setReady] = useState(!desktop),
    [opened, setOpened] = useState(false),
    [selected, setSelected] = useState(""),
    [marked, setMarked] = useState<Set<string>>(new Set()),
    [page, setPage] = useState(0),
    [filter, setFilter] = useState(""),
    [work, setWork] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [savedPath, setSavedPath] = useState(""),
    [sourcePath, setSourcePath] = useState(""),
    [trackPath, setTrackPath] = useState(""),
    [shift, setShift] = useState("0"),
    [scope, setScope] = useState("selected"),
    [find, setFind] = useState(""),
    [replacement, setReplacement] = useState(""),
    [model, setModel] = useState("gemma3:4b"),
    [language, setLanguage] = useState("English"),
    [installed, setInstalled] = useState<string[]>([]),
    [modelError, setModelError] = useState(""),
    [job, setJob] = useState<Job>(),
    [review, setReview] = useState<Review>(),
    [reviewPage, setReviewPage] = useState(0),
    [accepted, setAccepted] = useState<Set<string>>(new Set()),
    [time, setTime] = useState(0),
    [splitAt, setSplitAt] = useState("");
  const doc = history.doc,
    serialized = useMemo(() => documentKey(doc), [doc]),
    dirty = serialized !== baseline || forcedDraft,
    running = job?.status === "running",
    locked = !!work || running || !ready;
  const cue = doc.cues.find((c) => c.id === selected),
    issues = useMemo(() => cueIssues(doc), [doc]),
    filtered = useMemo(
      () =>
        doc.cues
          .map((c, index) => ({ cue: c, index }))
          .filter(
            ({ cue, index }) =>
              !filter ||
              `${index + 1} ${cue.text}`
                .toLocaleLowerCase()
                .includes(filter.toLocaleLowerCase()),
          ),
      [doc, filter],
    ),
    pages = Math.max(1, Math.ceil(filtered.length / 100)),
    actualPage = Math.min(page, pages - 1);
  const targets = () => {
    const ids = new Set(doc.cues.map((c) => c.id)),
      checked = new Set([...marked].filter((id) => ids.has(id)));
    return scope === "all"
      ? ids
      : checked.size
        ? checked
        : new Set(ids.has(selected) ? [selected] : []);
  };
  useEffect(() => {
    if (selected && !doc.cues.some((c) => c.id === selected))
      setSelected(doc.cues[0]?.id || "");
  }, [doc, selected]);
  useEffect(() => {
    if (cue) setSplitAt(cueClock(Math.floor((cue.start_ms + cue.end_ms) / 2)));
  }, [cue?.id, cue?.start_ms, cue?.end_ms]);
  const enqueue = (action: () => Promise<unknown>) => {
    persist.current = persist.current.catch(() => undefined).then(action);
    return persist.current;
  };
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  function commit(transform: (doc: SrtDocument) => SrtDocument) {
    if (locked) return;
    setError("");
    try {
      const next = transform(doc);
      if (
        next.cues.length > 10000 ||
        next.cues.some(
          (c) => new TextEncoder().encode(c.text).length > 16384,
        ) ||
        next.cues.reduce(
          (sum, c) => sum + new TextEncoder().encode(c.text).length + 128,
          0,
        ) >
          4 * 1024 * 1024
      )
        throw Error("Document exceeds the editor's 4 MiB / 10,000-cue limits.");
      if (documentKey(next) === serialized) return;
      setReview(undefined);
      setSavedPath("");
      void call("subtitle_editor_dirty", { dirty: true }).catch(fail);
      setHistory((old) => ({
        past: [...old.past, old.doc].slice(-40),
        doc: next,
        future: [],
      }));
    } catch (e) {
      fail(e);
    }
  }
  function patch(changes: Partial<SrtCue>) {
    if (!cue) return;
    commit((d) => ({
      cues: d.cues.map((c) => (c.id === cue.id ? { ...c, ...changes } : c)),
    }));
  }
  function seek(ms: number) {
    if (player.current) {
      player.current.currentTime = ms / 1000;
      setTime(ms);
    }
  }
  function captureTime(end: boolean) {
    if (!cue || !player.current) return;
    const at = Math.round(player.current.currentTime * 1000);
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at > maxTime ||
      (end ? at <= cue.start_ms : at >= cue.end_ms)
    ) {
      setError(
        "Playhead must define a positive cue interval within the supported time range.",
      );
      return;
    }
    patch(end ? { end_ms: at } : { start_ms: at });
  }
  function show() {
    openRef.current();
    setOpened(true);
    if (!dialog.current?.open) dialog.current?.showModal();
  }
  useEffect(() => {
    const open = () => show();
    window.addEventListener("reelio:subtitle-editor", open);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (desktop)
      void listen("subtitle:close-blocked", () => {
        show();
        setNotice(
          "Save or explicitly discard the subtitle draft, and finish/cancel the local model operation before closing Reelio.",
        );
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      window.removeEventListener("reelio:subtitle-editor", open);
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!desktop || started.current) return;
    started.current = true;
    void call<SrtDocument | null>("subtitle_editor_draft", { clear: false })
      .then((recovered) => {
        if (recovered) {
          setHistory({ past: [], doc: recovered, future: [] });
          setBaseline("");
          setSelected(recovered.cues[0]?.id || "");
          setNotice(
            "Recovered an unsaved subtitle draft. Original SRT files were not changed.",
          );
        }
      })
      .then(() => setReady(true))
      .catch((e) => {
        fail(e);
        setNotice(
          "Recovery could not be read. The draft was preserved; back it up before explicitly discarding it.",
        );
      });
  }, []);
  useEffect(() => {
    if (!desktop || !ready) return;
    if (dirty) void call("subtitle_editor_dirty", { dirty: true }).catch(fail);
    if (work) return;
    const timer = setTimeout(() => {
      void enqueue(() =>
        call(
          "subtitle_editor_draft",
          dirty ? { document: doc, clear: false } : { clear: true },
        ),
      ).catch((e) => {
        fail(e);
        setNotice(
          "Draft recovery could not be saved. Keep the editor open and save an SRT copy.",
        );
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [doc, dirty, ready, work]);
  useEffect(() => {
    if (!opened || work) return;
    let active = true;
    const poll = () =>
      void call<Job>("subtitle_model_status")
        .then((value) => {
          if (active && value) setJob(value);
        })
        .catch(fail);
    poll();
    const timer = setInterval(poll, 700);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [opened, work]);
  async function models() {
    setModelError("");
    try {
      const data = await call<{ installed: { name: string }[] }>(
        "subtitle_models",
      );
      setInstalled(data.installed.map((m) => m.name));
    } catch (e) {
      setModelError(String(e instanceof Error ? e.message : e));
    }
  }
  async function reset(next: SrtDocument, path = "", unsaved = false) {
    await enqueue(() => call("subtitle_editor_draft", { clear: true }));
    setHistory({ past: [], doc: next, future: [] });
    setBaseline(unsaved ? "" : documentKey(next));
    setForcedDraft(false);
    setSelected(next.cues[0]?.id || "");
    setMarked(new Set());
    setPage(0);
    setSourcePath(path);
    setSavedPath("");
    setReview(undefined);
    setError("");
  }
  async function load(path?: string) {
    if (
      dirty &&
      !window.confirm(
        "Discard the current subtitle draft and open another SRT?",
      )
    )
      return;
    setWork("Opening SRT");
    try {
      const result = await call<{ document: SrtDocument; path: string } | null>(
        "subtitle_editor_open",
        path ? { path } : {},
      );
      if (result) await reset(result.document, result.path);
    } catch (e) {
      fail(e);
    } finally {
      setWork("");
    }
  }
  async function save() {
    setWork("Saving new SRT copy");
    setError("");
    try {
      await persist.current;
      const path = await call<string | null>("subtitle_editor_save", {
        document: doc,
      });
      if (path) {
        await enqueue(() => call("subtitle_editor_draft", { clear: true }));
        setBaseline(serialized);
        setForcedDraft(false);
        setSavedPath(path);
        setNotice(`Saved SRT copy: ${path}. The original is unchanged.`);
      }
    } catch (e) {
      fail(e);
    } finally {
      setWork("");
    }
  }
  async function close() {
    if (running || work) {
      setNotice(
        "Finish or cancel the running operation before closing the editor.",
      );
      return;
    }
    if (dirty) {
      if (
        !window.confirm(
          "Discard the unsaved subtitle draft? Save a new SRT copy first to keep it.",
        )
      )
        return;
      setWork("Discarding draft");
      try {
        await enqueue(() => call("subtitle_editor_draft", { clear: true }));
        const restored = baseline
          ? (JSON.parse(baseline) as SrtDocument)
          : empty();
        setHistory({ past: [], doc: restored, future: [] });
        setBaseline(documentKey(restored));
        setForcedDraft(false);
        setSelected(restored.cues[0]?.id || "");
      } catch (e) {
        fail(e);
        setWork("");
        return;
      }
      setWork("");
    }
    player.current?.pause();
    dialog.current?.close();
    setOpened(false);
  }
  async function start(translate: boolean) {
    const previousForced = forcedDraft;
    setWork(translate ? "Starting translation" : "Starting model download");
    setError("");
    setReview(undefined);
    try {
      if (translate) {
        setForcedDraft(true);
        await enqueue(() =>
          call("subtitle_editor_draft", { document: doc, clear: false }),
        );
      }
      const next = await call<Job>("subtitle_model_start", {
        model,
        document: translate ? doc : null,
        language: translate ? language : "",
      });
      setJob(next);
    } catch (e) {
      setForcedDraft(previousForced);
      fail(e);
    } finally {
      setWork("");
    }
  }
  async function reviewResults() {
    setWork("Loading translation review");
    try {
      const result = await call<Review>("subtitle_model_results", {
        id: job?.id,
      });
      if (!result.document)
        throw Error("This job has no source snapshot to review.");
      if (documentKey(result.document) !== serialized) {
        if (
          !window.confirm(
            "This document differs from the translation source. Replace the editor contents with the saved source snapshot for review? Current unsaved editor changes will be discarded; original SRT files are never changed.",
          )
        )
          return;
        await reset(result.document, "", true);
      }
      setReview(result);
      setReviewPage(0);
      setAccepted(new Set(result.translations.map((t) => t.id)));
    } catch (e) {
      fail(e);
    } finally {
      setWork("");
    }
  }
  const active = doc.cues
    .filter((c) => time >= c.start_ms && time < c.end_ms)
    .slice(0, 5);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog subtitle-editor"
      aria-labelledby="subtitle-editor-title"
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (!["s", "z", "y"].includes(key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (locked) return;
        if (key === "s") {
          void save();
          return;
        }
        const redo = key === "y" || event.shiftKey;
        if (redo ? !history.future.length : !history.past.length) return;
        setSavedPath("");
        setReview(undefined);
        void call("subtitle_editor_dirty", { dirty: true }).catch(fail);
        setHistory((h) =>
          redo
            ? h.future.length
              ? {
                  past: [...h.past, h.doc].slice(-40),
                  doc: h.future[0],
                  future: h.future.slice(1),
                }
              : h
            : h.past.length
              ? {
                  past: h.past.slice(0, -1),
                  doc: h.past[h.past.length - 1],
                  future: [h.doc, ...h.future].slice(0, 40),
                }
              : h,
        );
      }}
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <header className="subtitle-editor-heading">
        <div>
          <h2 id="subtitle-editor-title">SRT subtitle editor</h2>
          <small>
            {doc.cues.length} cues ·{" "}
            {dirty ? "Unsaved draft" : "Saved / unchanged"}
            {sourcePath ? ` · ${sourcePath}` : ""}
          </small>
        </div>
        <button
          type="button"
          onClick={() => void close()}
          disabled={!!work || running}
        >
          Close editor
        </button>
      </header>
      <div className="subtitle-editor-toolbar">
        <button
          disabled={locked}
          onClick={() => {
            if (
              dirty &&
              !confirm("Discard this draft and create new subtitles?")
            )
              return;
            setWork("New subtitles");
            void reset(
              {
                cues: [
                  {
                    id: crypto.randomUUID(),
                    start_ms: 0,
                    end_ms: 2000,
                    text: "",
                  },
                ],
              },
              "",
              true,
            )
              .catch(fail)
              .finally(() => setWork(""));
          }}
        >
          New SRT
        </button>
        <button disabled={locked} onClick={() => void load()}>
          Open SRT
        </button>
        <button
          className="primary"
          disabled={locked || !doc.cues.length}
          onClick={() => void save()}
        >
          Save SRT copy
        </button>
        <button
          disabled={locked || !history.past.length}
          onClick={() => {
            setSavedPath("");
            setReview(undefined);
            setHistory((h) => ({
              past: h.past.slice(0, -1),
              doc: h.past[h.past.length - 1],
              future: [h.doc, ...h.future].slice(0, 40),
            }));
          }}
        >
          Undo subtitle edit
        </button>
        <button
          disabled={locked || !history.future.length}
          onClick={() => {
            setSavedPath("");
            setReview(undefined);
            setHistory((h) => ({
              past: [...h.past, h.doc].slice(-40),
              doc: h.future[0],
              future: h.future.slice(1),
            }));
          }}
        >
          Redo subtitle edit
        </button>
        {savedPath && (
          <button
            disabled={locked || projectBusy}
            onClick={() => {
              setWork("Adding saved SRT");
              void onAdd([savedPath])
                .then(() =>
                  setNotice(
                    "Saved SRT added to the project. Close the editor to inspect its track, test synchronization and review export settings.",
                  ),
                )
                .catch(fail)
                .finally(() => setWork(""));
            }}
          >
            Add saved SRT to project
          </button>
        )}
      </div>
      {sources.length > 0 && (
        <div className="subtitle-editor-toolbar">
          <label>
            Project SRT source
            <select
              value={trackPath}
              onChange={(e) => setTrackPath(e.target.value)}
            >
              <option value="">Choose source</option>
              {sources.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={locked || !trackPath}
            onClick={() => void load(trackPath)}
          >
            Edit project SRT copy
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!ready && error && (
        <button
          onClick={() => {
            if (
              !window.confirm(
                "Permanently discard the unreadable subtitle draft? Back up draft.json in Reelio's application-data subtitles directory first if you need it.",
              )
            )
              return;
            setWork("Discarding unreadable draft");
            void enqueue(() => call("subtitle_editor_draft", { clear: true }))
              .then(() => {
                setReady(true);
                setError("");
              })
              .catch(fail)
              .finally(() => setWork(""));
          }}
          disabled={!!work}
        >
          Discard unreadable subtitle draft
        </button>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {work && <p role="status">{work}...</p>}
      <div className="subtitle-editor-grid">
        <section
          className="subtitle-cue-browser"
          aria-label="Subtitle cue list"
        >
          <label>
            Find cues
            <input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
              maxLength={512}
            />
          </label>
          <div className="subtitle-editor-toolbar">
            <button
              disabled={locked || !doc.cues.length}
              onClick={() => setMarked(new Set(doc.cues.map((c) => c.id)))}
            >
              Select all cues
            </button>
            <button onClick={() => setMarked(new Set())}>
              Clear selection
            </button>
          </div>
          <div className="subtitle-cue-list">
            {filtered
              .slice(actualPage * 100, actualPage * 100 + 100)
              .map(({ cue: c, index }) => (
                <div
                  className={`subtitle-cue-row ${selected === c.id ? "selected" : ""}`}
                  key={c.id}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select cue ${index + 1}`}
                    checked={marked.has(c.id)}
                    onChange={(e) =>
                      setMarked((old) => {
                        const next = new Set(old);
                        e.target.checked ? next.add(c.id) : next.delete(c.id);
                        return next;
                      })
                    }
                  />
                  <button
                    aria-label={`Edit cue ${index + 1}`}
                    aria-pressed={selected === c.id}
                    onClick={() => {
                      setSelected(c.id);
                      setSplitAt(
                        cueClock(Math.floor((c.start_ms + c.end_ms) / 2)),
                      );
                      seek(c.start_ms);
                    }}
                  >
                    <b>
                      {index + 1} · {cueClock(c.start_ms)}
                    </b>
                    <span>{c.text.slice(0, 100) || "(new cue)"}</span>
                  </button>
                </div>
              ))}
          </div>
          <div className="subtitle-editor-toolbar">
            <button
              disabled={actualPage === 0}
              onClick={() => setPage(actualPage - 1)}
            >
              Previous cues
            </button>
            <span>
              {actualPage + 1} / {pages}
            </span>
            <button
              disabled={actualPage + 1 >= pages}
              onClick={() => setPage(actualPage + 1)}
            >
              Next cues
            </button>
          </div>
        </section>
        <section className="subtitle-cue-editor" aria-label="Cue editing">
          <div className="subtitle-editor-player">
            {videoUrl ? (
              <>
                <video
                  ref={player}
                  src={videoUrl}
                  controls
                  preload="metadata"
                  onTimeUpdate={(e) =>
                    setTime(e.currentTarget.currentTime * 1000)
                  }
                  onLoadedMetadata={(e) => {
                    e.currentTarget.volume = 0.05;
                  }}
                />
                <div className="subtitle-editor-caption" aria-live="off">
                  {active.map((c) => (
                    <div key={c.id}>{c.text.replace(/<[^>]*>/g, "")}</div>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                Open/select a video in the project to preview these cues. SRT
                editing does not require video or a model.
              </p>
            )}
          </div>
          <div className="subtitle-editor-toolbar">
            <button
              disabled={locked}
              onClick={() => {
                const last = doc.cues[doc.cues.length - 1],
                  start = Math.min(
                    maxTime - 1000,
                    Math.round(
                      player.current
                        ? player.current.currentTime * 1000
                        : last?.end_ms || 0,
                    ),
                  ),
                  c = {
                    id: crypto.randomUUID(),
                    start_ms: start,
                    end_ms: Math.min(maxTime, start + 2000),
                    text: "",
                  };
                commit((d) => ({ cues: [...d.cues, c] }));
                setSelected(c.id);
                setPage(Math.floor(doc.cues.length / 100));
              }}
            >
              Add cue
            </button>
            <button
              disabled={locked || (!selected && !marked.size)}
              onClick={() => {
                const ids = targets();
                commit((d) => ({ cues: d.cues.filter((c) => !ids.has(c.id)) }));
                setMarked(new Set());
                setSelected("");
              }}
            >
              Delete selected cues
            </button>
            <button
              disabled={locked}
              onClick={() =>
                commit((d) => ({
                  cues: [...d.cues].sort(
                    (a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms,
                  ),
                }))
              }
            >
              Sort by start
            </button>
          </div>
          {cue ? (
            <>
              <div className="subtitle-editor-toolbar">
                <label>
                  Start time
                  <input
                    key={`${cue.id}:start:${cue.start_ms}`}
                    aria-label="Cue start time"
                    defaultValue={cueClock(cue.start_ms)}
                    disabled={locked}
                    onBlur={(e) => {
                      try {
                        const value = parseCueClock(e.currentTarget.value);
                        if (value >= cue.end_ms)
                          throw Error("Start must be before end.");
                        patch({ start_ms: value });
                      } catch (error) {
                        fail(error);
                        e.currentTarget.value = cueClock(cue.start_ms);
                      }
                    }}
                  />
                </label>
                <label>
                  End time
                  <input
                    key={`${cue.id}:end:${cue.end_ms}`}
                    aria-label="Cue end time"
                    defaultValue={cueClock(cue.end_ms)}
                    disabled={locked}
                    onBlur={(e) => {
                      try {
                        const value = parseCueClock(e.currentTarget.value);
                        if (value <= cue.start_ms)
                          throw Error("End must be after start.");
                        patch({ end_ms: value });
                      } catch (error) {
                        fail(error);
                        e.currentTarget.value = cueClock(cue.end_ms);
                      }
                    }}
                  />
                </label>
                <button disabled={!videoUrl} onClick={() => seek(cue.start_ms)}>
                  Seek to cue
                </button>
                <button
                  disabled={locked || !videoUrl}
                  onClick={() => captureTime(false)}
                >
                  Set start at playhead
                </button>
                <button
                  disabled={locked || !videoUrl}
                  onClick={() => captureTime(true)}
                >
                  Set end at playhead
                </button>
              </div>
              <label>
                Cue text
                <textarea
                  ref={textArea}
                  aria-label="Subtitle cue text"
                  rows={5}
                  value={cue.text}
                  maxLength={16384}
                  disabled={locked}
                  onChange={(e) => patch({ text: e.target.value })}
                />
              </label>
              <small>
                {Array.from(cue.text).length} characters ·{" "}
                {(
                  Array.from(cue.text).length /
                  ((cue.end_ms - cue.start_ms) / 1000)
                ).toFixed(1)}{" "}
                characters/second · {cue.end_ms - cue.start_ms} ms
              </small>
              <div className="subtitle-editor-toolbar">
                <label>
                  Split time
                  <input
                    value={
                      splitAt ||
                      cueClock(Math.floor((cue.start_ms + cue.end_ms) / 2))
                    }
                    onChange={(e) => setSplitAt(e.target.value)}
                    disabled={locked}
                  />
                </label>
                <button
                  disabled={locked}
                  onClick={() => {
                    try {
                      const at = parseCueClock(
                          splitAt ||
                            cueClock(
                              Math.floor((cue.start_ms + cue.end_ms) / 2),
                            ),
                        ),
                        caret = textArea.current?.selectionStart || 0;
                      commit((d) => splitCue(d, cue.id, at, caret));
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  Split at text cursor
                </button>
                <button
                  disabled={
                    locked ||
                    doc.cues.findIndex((c) => c.id === cue.id) ===
                      doc.cues.length - 1
                  }
                  onClick={() => commit((d) => mergeCue(d, cue.id))}
                >
                  Merge with next
                </button>
              </div>
            </>
          ) : (
            <p>Select a cue or add one to begin.</p>
          )}
          <details>
            <summary>Timing, find & replace</summary>
            <div className="subtitle-editor-toolbar">
              <label>
                Apply to
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="selected">Checked / current cues</option>
                  <option value="all">All cues</option>
                </select>
              </label>
              <label>
                Shift milliseconds
                <input
                  type="number"
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                />
              </label>
              <button
                disabled={locked}
                onClick={() =>
                  commit((d) => shiftCues(d, targets(), Number(shift)))
                }
              >
                Shift timing
              </button>
            </div>
            <div className="subtitle-editor-toolbar">
              <label>
                Find text
                <input
                  value={find}
                  maxLength={512}
                  onChange={(e) => setFind(e.target.value)}
                />
              </label>
              <label>
                Replace with
                <input
                  value={replacement}
                  maxLength={512}
                  onChange={(e) => setReplacement(e.target.value)}
                />
              </label>
              <button
                disabled={locked || !find}
                onClick={() =>
                  commit((d) => replaceText(d, find, replacement, targets()))
                }
              >
                Replace text
              </button>
            </div>
          </details>
          <details>
            <summary>Validation & reading speed ({issues.length})</summary>
            {issues.length ? (
              <ul>
                {issues.slice(0, 40).map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            ) : (
              <p>No timing/text/readability issues found.</p>
            )}
            {issues.length > 40 && <p>Showing the first 40 issues.</p>}
            <small>
              Overlaps, long lines and reading speed are review warnings.
              Invalid intervals and empty/blank-line cues block saving.
            </small>
          </details>
        </section>
      </div>
      <section
        className="subtitle-translation"
        aria-label="Local subtitle translation"
      >
        <h3>Local model translation</h3>
        <p className="muted">
          Optional Ollama model plugin. Reelio contacts only 127.0.0.1:11434;
          use a trusted Ollama service configured for local inference, not a
          cloud proxy. Model downloads need internet and several GB of disk/RAM.
          Cue timings never go to the model; returned cue identities are
          checked. Translation requires human review.
        </p>
        <div className="subtitle-editor-toolbar">
          <label>
            Model plugin
            <select
              value={model}
              disabled={locked}
              onChange={(e) => setModel(e.target.value)}
            >
              {["gemma3:4b", "qwen3.5:2b", "qwen3.5:4b"].map((m) => (
                <option key={m} value={m}>
                  {m}
                  {installed.includes(m) ? " (installed)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!!work || running} onClick={() => void models()}>
            Refresh local models
          </button>
          <button disabled={locked} onClick={() => void start(false)}>
            Download model plugin
          </button>
          <label>
            Translate into
            <input
              list="subtitle-target-languages"
              value={language}
              maxLength={64}
              disabled={locked}
              onChange={(e) => setLanguage(e.target.value)}
            />
            <datalist id="subtitle-target-languages">
              {languages.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>
          <button
            disabled={locked || !doc.cues.length}
            onClick={() => void start(true)}
          >
            Translate document
          </button>
          {running && (
            <button
              onClick={() => void call("subtitle_model_cancel").catch(fail)}
            >
              Cancel model operation
            </button>
          )}
        </div>
        {modelError && (
          <p role="status">
            {modelError} Install/start Ollama separately, then refresh. Manual
            SRT editing remains available.
          </p>
        )}
        {job?.id && (
          <div role="status">
            <p>
              {job.kind}: {job.status} · {job.message}
            </p>
            {job.total > 0 && (
              <progress
                aria-label="Local model progress"
                max={job.total}
                value={job.done}
              />
            )}
            <span>
              {" "}
              {job.done} / {job.total}
            </span>
            {!running && job.kind === "translate" && job.done > 0 && (
              <button disabled={!!work} onClick={() => void reviewResults()}>
                Review translated cues
              </button>
            )}
          </div>
        )}
        {review && (
          <section aria-label="Translation review">
            <h3>Review translations ({accepted.size} selected)</h3>
            <div className="subtitle-editor-toolbar">
              <button
                onClick={() =>
                  setAccepted(new Set(review.translations.map((t) => t.id)))
                }
              >
                Accept all for review
              </button>
              <button onClick={() => setAccepted(new Set())}>
                Clear translation selection
              </button>
              <button
                disabled={locked || !accepted.size}
                onClick={() => {
                  if (documentKey(review.document) !== serialized) {
                    setError(
                      "Document changed; translate the current version again.",
                    );
                    return;
                  }
                  const map = new Map(
                    review.translations
                      .filter((t) => accepted.has(t.id))
                      .map((t) => [t.id, t.text]),
                  );
                  commit((d) => ({
                    cues: d.cues.map((c) =>
                      map.has(c.id) ? { ...c, text: map.get(c.id)! } : c,
                    ),
                  }));
                  setNotice(
                    "Selected translations applied as one undoable edit. Original files and cue timings are unchanged; save a new SRT copy.",
                  );
                }}
              >
                Apply selected translations
              </button>
              <button onClick={() => setReview(undefined)}>
                Discard translation review
              </button>
            </div>
            <div className="subtitle-editor-toolbar">
              <button
                disabled={reviewPage === 0}
                onClick={() => setReviewPage((p) => p - 1)}
              >
                Previous translations
              </button>
              <span>
                {reviewPage + 1} /{" "}
                {Math.max(1, Math.ceil(review.translations.length / 100))}
              </span>
              <button
                disabled={(reviewPage + 1) * 100 >= review.translations.length}
                onClick={() => setReviewPage((p) => p + 1)}
              >
                Next translations
              </button>
            </div>
            <div className="subtitle-review-list">
              {review.translations
                .slice(reviewPage * 100, reviewPage * 100 + 100)
                .map((t) => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      aria-label={`Accept translation ${doc.cues.findIndex((c) => c.id === t.id) + 1}`}
                      checked={accepted.has(t.id)}
                      onChange={(e) =>
                        setAccepted((old) => {
                          const next = new Set(old);
                          e.target.checked ? next.add(t.id) : next.delete(t.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <b>Original</b>
                      <p>{doc.cues.find((c) => c.id === t.id)?.text}</p>
                    </span>
                    <span>
                      <b>{review.language || "Translation"}</b>
                      <p>{t.text}</p>
                    </span>
                  </label>
                ))}
            </div>
          </section>
        )}
      </section>
      <p className="muted">
        UTF-8 SubRip · Maximum 4 MiB / 10,000 cues · Original files are never
        overwritten · Draft recovery is stored locally.
      </p>
    </dialog>
  );
}
