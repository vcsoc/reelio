import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image } from "lucide-react";
import type { Artwork } from "../../types";

export function CoverPreview({
  artwork,
  busy,
  edit,
  dropAsset,
}: {
  artwork?: Artwork | null;
  busy: boolean;
  edit: () => void;
  dropAsset: (id: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [hover, setHover] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined);
    };
    const close = () => setMenu(undefined);
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("resize", close);
    document.addEventListener("wheel", close, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("wheel", close);
    };
  }, [menu]);
  return (
    <>
      <button
        ref={button}
        data-cover-drop-target
        className={`inspector-cover ${artwork ? "has-cover" : ""} ${hover ? "cover-drop-active" : ""}`}
        disabled={busy}
        aria-label={artwork ? "Edit project cover" : "Select a cover"}
        onClick={edit}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.some(
              (type) =>
                type === "application/x-reelio-asset" || type === "Files",
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            setHover(true);
          }
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setHover(false);
          const id = event.dataTransfer.getData("application/x-reelio-asset");
          if (id && !busy) dropAsset(id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (artwork && !busy) setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (
            (event.key === "F10" && event.shiftKey) ||
            event.key === "ContextMenu"
          ) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            if (artwork && !busy)
              setMenu({ x: rect.left + 12, y: rect.top + 12 });
          }
        }}
      >
        {artwork ? (
          <img
            src={`data:image/jpeg;base64,${artwork.jpeg}`}
            alt="Project poster / cover"
          />
        ) : (
          <>
            <Image size={32} />
            <span>Select a cover</span>
            <small>Drop an image here · JPEG, PNG, WebP or AVIF</small>
          </>
        )}
      </button>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="timeline-context-menu"
            role="menu"
            aria-label="Cover actions"
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 180)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - 55)),
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setMenu(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setMenu(undefined);
                button.current?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                setMenu(undefined);
                edit();
              }}
            >
              Edit
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

export type NativeMediaDrop =
  | string[]
  | {
      paths: string[];
      position: { x: number; y: number };
      viewport?: { width: number; height: number } | null;
    };
export function coverDropHit(
  drop: NativeMediaDrop,
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom"> | undefined,
  width: number,
  height: number,
): boolean {
  if (
    Array.isArray(drop) ||
    !rect ||
    !drop.viewport ||
    drop.viewport.width <= 0 ||
    drop.viewport.height <= 0
  )
    return false;
  const x = (drop.position.x * width) / drop.viewport.width,
    y = (drop.position.y * height) / drop.viewport.height;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= rect.left &&
    x < rect.right &&
    y >= rect.top &&
    y < rect.bottom
  );
}
