import { useRef, type PointerEvent } from "react";
import { X } from "lucide-react";
import type { ImageEdits } from "../../types";
export type CropBox = NonNullable<ImageEdits["crop"]>;
export type CropHandle =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";
export function transformCrop(
  box: CropBox,
  dx: number,
  dy: number,
  handle: CropHandle,
  source: { width: number; height: number },
  ratio?: number,
): CropBox {
  if (handle === "move")
    return {
      ...box,
      x: Math.round(
        Math.max(0, Math.min(source.width - box.width, box.x + dx)),
      ),
      y: Math.round(
        Math.max(0, Math.min(source.height - box.height, box.y + dy)),
      ),
    };
  const west = handle.includes("w"),
    north = handle.includes("n"),
    horizontal = west || handle.includes("e"),
    vertical = north || handle.includes("s");
  const right = box.x + box.width,
    bottom = box.y + box.height;
  const maxWidth = west ? right : source.width - box.x,
    maxHeight = north ? bottom : source.height - box.y;
  let width = Math.max(2, box.width + (horizontal ? (west ? -dx : dx) : 0)),
    height = Math.max(2, box.height + (vertical ? (north ? -dy : dy) : 0));
  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    if (
      !horizontal ||
      (vertical && Math.abs(dy / box.height) > Math.abs(dx / box.width))
    )
      width = height * ratio;
    else height = width / ratio;
    const minimum = Math.max(1, 2 / width, 2 / height);
    width *= minimum;
    height *= minimum;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    width *= scale;
    height *= scale;
  }
  width = Math.max(2, Math.min(maxWidth, Math.round(width)));
  height = Math.max(2, Math.min(maxHeight, Math.round(height)));
  return {
    x: west ? right - width : box.x,
    y: north ? bottom - height : box.y,
    width,
    height,
  };
}
const handles: { edge: CropHandle; name: string }[] = [
  { edge: "nw", name: "top left" },
  { edge: "n", name: "top" },
  { edge: "ne", name: "top right" },
  { edge: "e", name: "right" },
  { edge: "se", name: "bottom right" },
  { edge: "s", name: "bottom" },
  { edge: "sw", name: "bottom left" },
  { edge: "w", name: "left" },
];
export function CropSelection({
  crop,
  source,
  ratio,
  draft,
  commit,
}: {
  crop: CropBox;
  source: { width: number; height: number };
  ratio?: number;
  draft: (crop: ImageEdits["crop"]) => void;
  commit: (crop: ImageEdits["crop"]) => void;
}) {
  const drag = useRef<
    | {
        x: number;
        y: number;
        box: CropBox;
        handle: CropHandle;
        rect: DOMRect;
        pointer: number;
      }
    | undefined
  >(undefined);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const image = event.currentTarget.parentElement?.querySelector("img");
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      box: { ...crop },
      handle: ((event.target as HTMLElement).closest<HTMLElement>(
        "[data-crop-handle]",
      )?.dataset.cropHandle || "move") as CropHandle,
      rect: image.getBoundingClientRect(),
      pointer: event.pointerId,
    };
    const focus =
      (event.target as HTMLElement).closest<HTMLElement>(
        "[data-crop-handle]",
      ) || event.currentTarget;
    focus.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const next = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return undefined;
    if (event.clientX === d.x && event.clientY === d.y) return d.box;
    return transformCrop(
      d.box,
      ((event.clientX - d.x) * source.width) / d.rect.width,
      ((event.clientY - d.y) * source.height) / d.rect.height,
      d.handle,
      source,
      ratio,
    );
  };
  const cancel = () => {
    drag.current = undefined;
    draft(null);
  };
  return (
    <div
      className="cover-crop-selection"
      role="group"
      aria-label="Move crop selection"
      tabIndex={0}
      style={{
        left: `${(crop.x / source.width) * 100}%`,
        top: `${(crop.y / source.height) * 100}%`,
        width: `${(crop.width / source.width) * 100}%`,
        height: `${(crop.height / source.height) * 100}%`,
      }}
      onPointerDown={start}
      onPointerMove={(event) => {
        const box = next(event);
        if (box) draft(box);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        const original = drag.current.box;
        const box = next(event);
        drag.current = undefined;
        draft(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (
          box &&
          (box.x !== original.x ||
            box.y !== original.y ||
            box.width !== original.width ||
            box.height !== original.height)
        )
          commit(box);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          const pointer = drag.current?.pointer;
          cancel();
          if (
            pointer !== undefined &&
            event.currentTarget.hasPointerCapture(pointer)
          )
            event.currentTarget.releasePointerCapture(pointer);
          return;
        }
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 10 : 1,
          edge = (event.target as HTMLElement).dataset.cropHandle as
            | CropHandle
            | undefined;
        commit(
          transformCrop(
            crop,
            event.key === "ArrowLeft"
              ? -step
              : event.key === "ArrowRight"
                ? step
                : 0,
            event.key === "ArrowUp"
              ? -step
              : event.key === "ArrowDown"
                ? step
                : 0,
            edge || "move",
            source,
            ratio,
          ),
        );
      }}
    >
      {handles.map(({ edge, name }) => (
        <button
          key={edge}
          type="button"
          className={`crop-handle crop-${edge}`}
          data-crop-handle={edge}
          aria-label={`Resize crop ${name}`}
          title={`Resize crop ${name}`}
        />
      ))}
      <button
        type="button"
        className="crop-clear"
        title="Clear crop selection"
        aria-label="Clear crop selection"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          cancel();
          commit(null);
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
