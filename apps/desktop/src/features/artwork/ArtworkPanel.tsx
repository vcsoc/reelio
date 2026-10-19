import { useEffect, useRef, useState } from "react";
import { call } from "../../services/desktop";
import {
  Undo2,
  Redo2,
  RotateCcw,
  RotateCw,
  FlipHorizontal2,
  RotateCcwSquare,
  RectangleVertical,
  Square,
  RectangleHorizontal,
  Crop,
  LockKeyhole,
  UnlockKeyhole,
  Info,
} from "lucide-react";
import { sizeCrop } from "./imageGeometry";
import { CropSelection } from "./CropSelection";
import { LiveArtworkPreview } from "./LiveArtworkPreview";
const Hint = ({ text }: { text: string }) => (
  <button type="button" className="artwork-info" aria-label={text} title={text}>
    <Info size={13} />
  </button>
);
import "./editor.css";
import type {
  Artwork,
  ImageEdits,
  PendingResource,
  Project,
} from "../../types";
import { PosterBrowser } from "./PosterBrowser";
import { ResourceSearch, type Run } from "../resources/ResourceSearch";
const defaults = (): ImageEdits => ({
  crop: null,
  rotation: 0,
  flip: false,
  grayscale: false,
  negative: false,
  sepia: false,
  brightness: 1,
  contrast: 1,
  resize: null,
});
export function ArtworkPanel({
  project,
  incoming,
  busy,
  run,
  onQueued,
  onApply,
}: {
  project: Project;
  incoming?: Artwork;
  busy: boolean;
  run: Run;
  onQueued: (p: PendingResource) => void;
  onApply: (art: Artwork | null) => void;
}) {
  const [original, setOriginal] = useState<Artwork | undefined>(
    incoming || project.artwork || undefined,
  );
  const [history, setHistory] = useState({
    past: [] as ImageEdits[],
    current: defaults(),
    future: [] as ImageEdits[],
  });
  const [rendered, setRendered] = useState<{
    source: Artwork;
    edits: ImageEdits;
    image: Artwork;
  }>();
  const [error, setError] = useState("");
  const [lockAspect, setLockAspect] = useState(true);
  const [cropRatio, setCropRatio] = useState<number>();
  const [applyFeedback, setApplyFeedback] = useState("");
  const [dragCrop, setDragCrop] = useState<ImageEdits["crop"]>(null);
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const [showSources, setShowSources] = useState(false);
  const sourceArea = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ width: 300, height: 300 });
  useEffect(() => {
    const area = sourceArea.current;
    if (!area || !original) return;
    const update = () => {
      const rect = area.getBoundingClientRect();
      const scale = Math.min(
        Math.max(1, rect.width - 14) / original.width,
        Math.max(1, rect.height - 14) / original.height,
      );
      if (scale > 0)
        setDisplaySize({
          width: original.width * scale,
          height: original.height * scale,
        });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(area);
    return () => observer.disconnect();
  }, [original]);
  const edits = history.current;
  function choose(image: Artwork, keepSources = false) {
    setShowSources(keepSources);
    setOriginal(image);
    setHistory({ past: [], current: defaults(), future: [] });
    setError("");
    setApplyFeedback("");
    setCropRatio(undefined);
  }
  useEffect(() => {
    if (incoming) choose(incoming);
  }, [incoming]);
  useEffect(() => {
    if (!original) return;
    let active = true;
    setError("");
    setApplyFeedback("");
    const timer = setTimeout(
      () =>
        void call<Artwork>("artwork_edit", { artwork: original, edits })
          .then((image) => {
            if (active) setRendered({ source: original, edits, image });
          })
          .catch((e: Error) => {
            if (active) setError(e.message);
          }),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [original, edits]);
  function change(patch: Partial<ImageEdits>) {
    setApplyFeedback("");
    setHistory((h) => {
      const current = { ...h.current, ...patch };
      if (
        lockAspect &&
        original &&
        current.resize &&
        patch.resize === undefined &&
        (patch.crop !== undefined || patch.rotation !== undefined)
      ) {
        let width = current.crop?.width || original.width,
          height = current.crop?.height || original.height;
        if (current.rotation % 180) [width, height] = [height, width];
        current.resize = {
          width: current.resize.width,
          height: Math.round((current.resize.width * height) / width),
        };
      }
      return { past: [...h.past, h.current].slice(-40), current, future: [] };
    });
  }
  function cropPreset(ratio: number) {
    if (!original || original.width < 2 || original.height < 2) return;
    if (cropRatio !== undefined) setCropRatio(ratio);
    const width = Math.floor(Math.min(original.width, original.height * ratio)),
      height = Math.floor(width / ratio);
    change({
      crop: {
        x: Math.floor((original.width - width) / 2),
        y: Math.floor((original.height - height) / 2),
        width,
        height,
      },
    });
  }
  const ready =
    rendered?.source === original &&
    rendered?.edits === edits &&
    !error &&
    !dragCrop;
  const crop = dragCrop || edits.crop;
  const cropWidth = edits.crop?.width || original?.width || 1,
    cropHeight = edits.crop?.height || original?.height || 1;
  const outputWidth = edits.rotation % 180 ? cropHeight : cropWidth,
    outputHeight = edits.rotation % 180 ? cropWidth : cropHeight;
  function resize(field: "width" | "height", value: number) {
    const dimensions = edits.resize || {
      width: outputWidth,
      height: outputHeight,
    };
    const next = { ...dimensions, [field]: value };
    if (lockAspect) {
      if (field === "width")
        next.height = Math.round((value * outputHeight) / outputWidth);
      else next.width = Math.round((value * outputWidth) / outputHeight);
    }
    change({ resize: next });
  }
  function point(e: React.PointerEvent<HTMLImageElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          (original?.width || 1) - 1,
          Math.floor(((e.clientX - r.left) / r.width) * (original?.width || 1)),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          (original?.height || 1) - 1,
          Math.floor(
            ((e.clientY - r.top) / r.height) * (original?.height || 1),
          ),
        ),
      ),
    };
  }
  const sourceActions = (
    <div className="artwork-source-actions">
      <button
        type="button"
        className="secondary"
        onClick={() => setShowSources(!showSources)}
      >
        Find artwork
      </button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          void run("Choose artwork", async () => {
            const image = await call<Artwork | null>("choose_artwork");
            if (image) choose(image);
          })
        }
      >
        Choose local image
      </button>
    </div>
  );
  return (
    <section className={`artwork-panel ${original ? "has-image" : ""}`}>
      <div className="section-heading">
        <div>
          <h2>
            Poster & cover studio{" "}
            <Hint text="One cover for the output container. Crop, rotate, resize and adjust without changing source files. Imported images are normalized to JPEG at up to 2048 pixels per edge and 2 MiB. Approved artwork is embedded on export without transcoding video." />
          </h2>
        </div>
        {!original && sourceActions}
      </div>
      <div
        className="artwork-source-browser"
        hidden={!!original && !showSources}
      >
        {original && (
          <button
            type="button"
            className="secondary artwork-source-done"
            onClick={() => setShowSources(false)}
          >
            Done finding artwork
          </button>
        )}
        <PosterBrowser
          title={project.metadata.title || project.name}
          targetName={project.name}
          appliedJpeg={project.artwork?.jpeg}
          busy={busy}
          run={run}
          onSelect={(art) => {
            choose(art, true);
            onApply(art);
          }}
        />
        <ResourceSearch
          downloadOnly
          kind="artwork"
          title={project.metadata.title || project.name}
          busy={busy}
          run={run}
          onQueued={onQueued}
        />
      </div>
      {original ? (
        <div className="artwork-editor-grid">
          <figure>
            <figcaption>
              Original · {original.width} × {original.height}{" "}
              <Hint text="Drag the image to create a crop. Drag inside the crop to move it, use its handles to resize, or its corner X to clear. Arrow keys adjust a focused crop; Shift uses larger steps." />
            </figcaption>
            <div className="artwork-image-area" ref={sourceArea}>
              <div className="cover-crop-stage" style={displaySize}>
                <img
                  src={`data:image/jpeg;base64,${original.jpeg}`}
                  alt="Prepared original cover; drag to choose a crop"
                  draggable={false}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    drag.current = point(e);
                    setDragCrop(null);
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!drag.current) return;
                    const p = point(e),
                      start = drag.current;
                    setDragCrop({
                      x: Math.min(p.x, start.x),
                      y: Math.min(p.y, start.y),
                      width: Math.max(2, Math.abs(p.x - start.x)),
                      height: Math.max(2, Math.abs(p.y - start.y)),
                    });
                  }}
                  onPointerUp={(e) => {
                    if (drag.current) {
                      const p = point(e),
                        start = drag.current;
                      if (
                        Math.abs(p.x - start.x) >= 2 &&
                        Math.abs(p.y - start.y) >= 2
                      )
                        change({
                          crop: {
                            x: Math.min(p.x, start.x),
                            y: Math.min(p.y, start.y),
                            width: Math.abs(p.x - start.x),
                            height: Math.abs(p.y - start.y),
                          },
                        });
                    }
                    drag.current = undefined;
                    setDragCrop(null);
                  }}
                  onPointerCancel={() => {
                    drag.current = undefined;
                    setDragCrop(null);
                  }}
                />
                {crop && (
                  <CropSelection
                    crop={crop}
                    source={original}
                    ratio={cropRatio}
                    draft={setDragCrop}
                    commit={(crop) => change({ crop })}
                  />
                )}
              </div>
            </div>
          </figure>
          <div className="artwork-control-panel">
            {sourceActions}
            <div className="artwork-tools artwork-transform-tools">
              <button
                className="secondary"
                onClick={() =>
                  setHistory((h) =>
                    h.past.length
                      ? {
                          past: h.past.slice(0, -1),
                          current: h.past[h.past.length - 1],
                          future: [h.current, ...h.future],
                        }
                      : h,
                  )
                }
                aria-label="Undo image edit"
                title="Undo image edit"
                style={{ color: "var(--accent)" }}
                disabled={!history.past.length}
              >
                <Undo2 size={18} aria-hidden="true" />
              </button>
              <button
                className="secondary"
                onClick={() =>
                  setHistory((h) =>
                    h.future.length
                      ? {
                          past: [...h.past, h.current],
                          current: h.future[0],
                          future: h.future.slice(1),
                        }
                      : h,
                  )
                }
                aria-label="Redo image edit"
                title="Redo image edit"
                style={{ color: "var(--accent)" }}
                disabled={!history.future.length}
              >
                <Redo2 size={18} aria-hidden="true" />
              </button>
              <button
                className="secondary"
                aria-label="Rotate left"
                title="Rotate left"
                style={{ color: "var(--art-green)" }}
                onClick={() =>
                  change({ rotation: (edits.rotation + 270) % 360 })
                }
              >
                <RotateCcw size={18} aria-hidden="true" />
              </button>
              <button
                className="secondary"
                aria-label="Rotate right"
                title="Rotate right"
                style={{ color: "var(--art-green)" }}
                onClick={() =>
                  change({ rotation: (edits.rotation + 90) % 360 })
                }
              >
                <RotateCw size={18} aria-hidden="true" />
              </button>
              <button
                className="secondary"
                aria-label="Flip horizontal"
                title="Flip horizontal"
                style={{ color: "var(--art-cyan)" }}
                aria-pressed={edits.flip}
                onClick={() => change({ flip: !edits.flip })}
              >
                <FlipHorizontal2 size={18} aria-hidden="true" />
              </button>
              <button
                className="secondary"
                aria-label="Reset image edits"
                title="Reset image edits"
                style={{ color: "var(--art-amber)" }}
                onClick={() => change(defaults())}
              >
                <RotateCcwSquare size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="form-grid artwork-controls">
              <fieldset disabled={original.width < 2 || original.height < 2}>
                <legend>
                  Crop{" "}
                  <Hint text="Choose a ratio, draw a crop, or adjust its size. Lock keeps the current crop proportions while resizing." />
                </legend>
                <div className="artwork-tools artwork-apply-tools">
                  <button
                    className="secondary"
                    aria-label="Poster 2:3"
                    title="Crop to poster 2:3"
                    style={{ color: "var(--accent)" }}
                    onClick={() => cropPreset(2 / 3)}
                  >
                    <RectangleVertical size={18} aria-hidden="true" />
                  </button>
                  <button
                    className="secondary"
                    aria-label="Square"
                    title="Crop to square 1:1"
                    style={{ color: "var(--art-green)" }}
                    onClick={() => cropPreset(1)}
                  >
                    <Square size={18} aria-hidden="true" />
                  </button>
                  <button
                    className="secondary"
                    aria-label="Wide 16:9"
                    title="Crop to wide 16:9"
                    style={{ color: "var(--art-cyan)" }}
                    onClick={() => cropPreset(16 / 9)}
                  >
                    <RectangleHorizontal size={18} aria-hidden="true" />
                  </button>
                  <button
                    className="secondary"
                    aria-label="Wide 3:2"
                    title="Crop to wide 3:2"
                    style={{ color: "var(--art-cyan)" }}
                    onClick={() => cropPreset(3 / 2)}
                  >
                    <RectangleHorizontal size={18} />
                  </button>
                  <button
                    className="secondary"
                    aria-label="Poster 9:16"
                    title="Crop to poster 9:16"
                    style={{ color: "var(--accent)" }}
                    onClick={() => cropPreset(9 / 16)}
                  >
                    <RectangleVertical size={18} />
                  </button>
                  <button
                    className="secondary"
                    aria-label="Clear crop"
                    title="Clear crop"
                    style={{ color: "var(--art-amber)" }}
                    onClick={() => change({ crop: null })}
                  >
                    <Crop size={18} aria-hidden="true" />
                  </button>
                  <button
                    className="secondary aspect-toggle"
                    aria-label="Lock crop aspect ratio"
                    title="Keep crop proportions when changing width or height"
                    aria-pressed={cropRatio !== undefined}
                    onClick={() =>
                      setCropRatio(
                        cropRatio === undefined
                          ? cropWidth / cropHeight
                          : undefined,
                      )
                    }
                  >
                    {cropRatio === undefined ? (
                      <UnlockKeyhole size={18} />
                    ) : (
                      <LockKeyhole size={18} />
                    )}
                  </button>
                </div>
                <div className="artwork-number-row">
                  {(["width", "height"] as const).map((field) => (
                    <label key={field}>
                      Crop {field}
                      <input
                        type="number"
                        min={2}
                        max={original[field]}
                        value={
                          crop?.[field] ??
                          {
                            x: 0,
                            y: 0,
                            width: original.width,
                            height: original.height,
                          }[field]
                        }
                        onChange={(e) => {
                          const value = e.target.valueAsNumber;
                          if (Number.isFinite(value) && value > 0)
                            change({
                              crop: sizeCrop(
                                original,
                                edits.crop,
                                field,
                                value,
                                cropRatio,
                              ),
                            });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>
                  Adjustments{" "}
                  <Hint text="Filters and sliders update the preview immediately. Double-click a brightness or contrast control to reset it. Resize is applied after crop, rotation and color adjustments." />
                </legend>
                <div className="artwork-filter-row">
                  {(
                    [
                      ["grayscale", "Black and white"],
                      ["negative", "Negative"],
                      ["sepia", "Sepia"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      type="button"
                      className="artwork-filter"
                      key={key}
                      aria-label={label}
                      title={label}
                      aria-pressed={edits[key]}
                      onClick={() => change({ [key]: !edits[key] })}
                    >
                      <img
                        src={`data:image/jpeg;base64,${original.jpeg}`}
                        style={{
                          filter:
                            key === "grayscale"
                              ? "grayscale(1)"
                              : key === "negative"
                                ? "invert(1)"
                                : "sepia(1)",
                        }}
                        alt=""
                      />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <div className="artwork-number-row">
                  {(["brightness", "contrast"] as const).map((field) => (
                    <label
                      key={field}
                      onDoubleClick={() => change({ [field]: 1 })}
                    >
                      {field} ({edits[field].toFixed(1)})
                      <input
                        aria-label={`Image ${field}`}
                        title="Double-click to reset to 1.0"
                        type="range"
                        min="0.1"
                        max="3"
                        step="0.1"
                        value={edits[field]}
                        onChange={(e) =>
                          change({ [field]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="artwork-resize-row">
                  <button
                    type="button"
                    className="secondary aspect-toggle"
                    aria-label="Lock resize aspect ratio"
                    title="Keep resize proportions"
                    aria-pressed={lockAspect}
                    onClick={() => setLockAspect(!lockAspect)}
                  >
                    {lockAspect ? (
                      <LockKeyhole size={18} />
                    ) : (
                      <UnlockKeyhole size={18} />
                    )}
                  </button>
                  <label>
                    Resize width
                    <input
                      type="number"
                      min="2"
                      max="4096"
                      value={edits.resize?.width ?? outputWidth}
                      onChange={(e) => resize("width", Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Resize height
                    <input
                      type="number"
                      min="2"
                      max="4096"
                      value={edits.resize?.height ?? outputHeight}
                      onChange={(e) => resize("height", Number(e.target.value))}
                    />
                  </label>
                  <button
                    className="secondary"
                    aria-label="Reset resize"
                    title="Reset resize"
                    onClick={() => change({ resize: null })}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </fieldset>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="artwork-tools artwork-apply-tools">
              <button
                className="primary"
                disabled={busy || !ready}
                onClick={() => {
                  if (ready && rendered) {
                    onApply(rendered.image);
                    setApplyFeedback("Cover applied to this project.");
                  }
                }}
              >
                Apply cover to project
              </button>
              {project.artwork && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => onApply(null)}
                >
                  Remove project cover
                </button>
              )}
            </div>
            {applyFeedback && (
              <p className="artwork-apply-feedback" role="status">
                {applyFeedback}
              </p>
            )}
          </div>
          <figure>
            <figcaption>
              Live preview{" "}
              <Hint text="Updates locally before painting; export-quality JPEG is verified separately before Apply becomes available. Original files are never changed." />
            </figcaption>
            <div className="artwork-image-area">
              <LiveArtworkPreview
                artwork={original}
                edits={{ ...edits, crop }}
              />
            </div>
          </figure>
        </div>
      ) : (
        <p className="empty-inline">
          Choose artwork to begin{" "}
          <Hint text="Find a poster or choose a local JPEG, PNG, WebP or AVIF image. The studio supports crop, rotation, flip, resize, filters and image-edit undo/redo." />
        </p>
      )}
    </section>
  );
}
