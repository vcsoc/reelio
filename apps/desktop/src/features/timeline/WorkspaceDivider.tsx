import { useEffect, useRef, useState } from "react";
export function viewerHeightPreference(value: string | null) {
  const n = value === null ? NaN : Number(value);
  return Number.isFinite(n) ? Math.max(220, Math.min(1600, n)) : undefined;
}
export function boundViewerHeight(value: number, available: number) {
  return Math.max(220, Math.min(1600, Math.max(220, available - 260), value));
}
export function useViewerHeight() {
  const [height, setHeight] = useState<number | undefined>(() => {
    try {
      return viewerHeightPreference(
        localStorage.getItem("reelio.viewer-height.v1"),
      );
    } catch {
      return undefined;
    }
  });
  useEffect(() => {
    try {
      if (height === undefined)
        localStorage.removeItem("reelio.viewer-height.v1");
      else localStorage.setItem("reelio.viewer-height.v1", String(height));
    } catch {
      /* Layout remains usable when storage is unavailable. */
    }
  }, [height]);
  return [height, setHeight] as const;
}
export function WorkspaceDivider({
  height,
  resize,
}: {
  height: number | undefined;
  resize: (height: number | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | {
        y: number;
        height: number;
        original: number | undefined;
        pointer: number;
      }
    | undefined
  >(undefined);
  const viewer = () =>
    ref.current?.closest(".timeline-layout")?.querySelector(".timeline-viewer");
  const bound = (n: number) =>
    boundViewerHeight(
      n,
      ref.current?.closest(".timeline-layout")?.getBoundingClientRect()
        .height || window.innerHeight,
    );
  const heightRef = useRef(height);
  heightRef.current = height;
  useEffect(() => {
    const parent = ref.current?.closest(".timeline-layout");
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      if (heightRef.current !== undefined)
        resize(
          boundViewerHeight(
            heightRef.current,
            parent.getBoundingClientRect().height,
          ),
        );
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [resize]);
  const cancel = () => {
    const active = drag.current;
    drag.current = undefined;
    if (active) {
      resize(active.original);
      if (ref.current?.hasPointerCapture(active.pointer))
        ref.current.releasePointerCapture(active.pointer);
    }
  };
  return (
    <div
      ref={ref}
      className="workspace-divider"
      role="separator"
      aria-label="Resize viewer and lower workspace"
      aria-orientation="horizontal"
      aria-valuemin={220}
      aria-valuemax={1600}
      aria-valuenow={Math.round(
        height ??
          viewer()?.getBoundingClientRect().height ??
          window.innerHeight * 0.46,
      )}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        drag.current = {
          pointer: event.pointerId,
          y: event.clientY,
          height: viewer()?.getBoundingClientRect().height || height || 360,
          original: height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          resize(bound(drag.current.height + event.clientY - drag.current.y));
      }}
      onPointerUp={(event) => {
        drag.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onDoubleClick={() => resize(undefined)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancel();
          return;
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const current =
          viewer()?.getBoundingClientRect().height || height || 360;
        resize(
          event.key === "Home"
            ? undefined
            : event.key === "End"
              ? bound(1600)
              : bound(
                  current +
                    (event.key === "ArrowUp" ? -1 : 1) *
                      (event.shiftKey ? 50 : 10),
                ),
        );
      }}
    />
  );
}
