import { useEffect, useRef, useState } from "react";

const KEY = "reelio.media-pool-width.v1";
export function poolWidth(value: string | null) {
  const number = value === null ? 280 : Number(value);
  return Number.isFinite(number) ? Math.max(180, Math.min(520, number)) : 280;
}
export function usePoolWidth() {
  const [width, setWidth] = useState(() => {
    try {
      return poolWidth(localStorage.getItem(KEY));
    } catch {
      return 280;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(width));
    } catch {
      /* Keep resizing available when storage is unavailable. */
    }
  }, [width]);
  return [width, setWidth] as const;
}
export function PoolDivider({
  width,
  resize,
  hidden,
}: {
  width: number;
  resize: (width: number) => void;
  hidden?: boolean;
}) {
  const drag = useRef<
    { x: number; width: number; original: number } | undefined
  >(undefined);
  const bound = (value: number) =>
    Math.max(180, Math.min(520, window.innerWidth - 620, value));
  return (
    <div
      className="pool-divider"
      hidden={hidden}
      role="separator"
      aria-label="Resize media pool"
      aria-orientation="vertical"
      aria-valuemin={180}
      aria-valuemax={520}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = {
          x: e.clientX,
          width:
            e.currentTarget.previousElementSibling?.getBoundingClientRect()
              .width ?? width,
          original: width,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current)
          resize(bound(drag.current.width + e.clientX - drag.current.x));
      }}
      onPointerUp={(e) => {
        drag.current = undefined;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) resize(drag.current.original);
        drag.current = undefined;
      }}
      onLostPointerCapture={() => {
        drag.current = undefined;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          resize(
            bound(
              width + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 40 : 10),
            ),
          );
        } else if (e.key === "Home") {
          e.preventDefault();
          resize(280);
        }
      }}
      onDoubleClick={() => resize(280)}
    />
  );
}
