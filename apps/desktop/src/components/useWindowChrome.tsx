import { useEffect, useState, type MouseEvent } from "react";
import { Copy, Minus, Square, X, Maximize2, Minimize2 } from "lucide-react";
import { call, desktop } from "../services/desktop";

type WindowAction = "state" | "drag" | "minimize" | "toggle_maximize" | "close";

export function useWindowChrome(
  onError: (message: string) => void,
  mayClose: () => boolean,
) {
  const [maximized, setMaximized] = useState(false);
  const [platform, setPlatform] = useState({ os: "windows", tiling: false });
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void call<boolean>("window_action", { action: "state" })
          .then((value) => {
            if (alive) setMaximized(!!value);
          })
          .catch((error: Error) => {
            if (alive) onError(error.message);
          });
      }, 80);
    };
    void call<{ os: string; tiling: boolean }>("window_platform")
      .then((value) => {
        if (alive && value?.os) setPlatform(value);
      })
      .catch((error: Error) => {
        if (alive) onError(error.message);
      });
    refresh();
    window.addEventListener("resize", refresh);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("resize", refresh);
    };
  }, [onError]);

  const act = async (action: WindowAction) => {
    try {
      const value = await call<boolean>("window_action", { action });
      if (action === "toggle_maximize") setMaximized(!!value);
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const onMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (!desktop || event.button !== 0) return;
    const target = event.target as Element;
    // Only unused chrome and the inert brand move the window, never toolbar tools or dialogs.
    if (
      !target.closest(".brand") &&
      target.closest(
        "button, a, input, select, textarea, [role=tab], [role=menu], dialog, [role=dialog]",
      )
    )
      return;
    event.preventDefault();
    void act(event.detail === 2 ? "toggle_maximize" : "drag");
  };
  const requestClose = () => {
    if (desktop && mayClose()) void act("close");
  };
  const controls =
    desktop && !platform.tiling ? (
      <div
        className={`window-controls ${platform.os === "macos" ? "macos-controls" : ""}`}
        data-platform={platform.os}
        role="group"
        aria-label="Window controls"
      >
        <button
          type="button"
          aria-label="Minimize window"
          title="Minimize"
          onClick={() => void act("minimize")}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => void act("toggle_maximize")}
        >
          {platform.os === "windows" ? (
            maximized ? (
              <Copy size={14} />
            ) : (
              <Square size={14} />
            )
          ) : maximized ? (
            <Minimize2 size={14} />
          ) : (
            <Maximize2 size={14} />
          )}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="Close window"
          title="Close Reelio"
          onClick={requestClose}
        >
          <X size={16} />
        </button>
      </div>
    ) : null;
  return {
    onMouseDown,
    requestClose,
    leadingControls: platform.os === "macos" ? controls : null,
    controls: platform.os === "macos" ? null : controls,
  };
}
