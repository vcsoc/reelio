import { useEffect, useRef, useState } from "react";

export function inspectorWidth(value: string | null) {
  const width = value === null ? 440 : Number(value);
  return Number.isFinite(width) ? Math.max(300, Math.min(900, width)) : 440;
}
export function useInspectorWidth() {
  const [width, resize] = useState(() => {
    try {
      return inspectorWidth(localStorage.getItem("reelio.inspector-width.v1"));
    } catch {
      return 440;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("reelio.inspector-width.v1", String(width));
    } catch {
      /* Resizing remains available without persistent storage. */
    }
  }, [width]);
  return [width, resize] as const;
}
export function InspectorDivider({
  width,
  pool,
  resize,
  hidden,
}: {
  width: number;
  pool: number;
  resize: (width: number) => void;
  hidden?: boolean;
}) {
  const drag = useRef<
    { x: number; width: number; original: number } | undefined
  >(undefined);
  const bound = (value: number) =>
    Math.max(
      300,
      Math.min(
        900,
        window.innerWidth * 0.55,
        window.innerWidth - pool - 320,
        value,
      ),
    );
  return (
    <div
      className="inspector-divider"
      hidden={hidden}
      role="separator"
      aria-label="Resize right inspector"
      aria-orientation="vertical"
      aria-valuemin={300}
      aria-valuemax={900}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = {
          x: e.clientX,
          width:
            e.currentTarget.nextElementSibling?.getBoundingClientRect().width ??
            width,
          original: width,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current)
          resize(bound(drag.current.width + drag.current.x - e.clientX));
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
              width + (e.key === "ArrowLeft" ? 1 : -1) * (e.shiftKey ? 40 : 10),
            ),
          );
        }
        if (e.key === "Home") {
          e.preventDefault();
          resize(440);
        }
      }}
      onDoubleClick={() => resize(440)}
    />
  );
}
