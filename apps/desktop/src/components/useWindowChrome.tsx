import { useEffect, useState, type MouseEvent } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { call, desktop } from "../services/desktop";

type WindowAction = "state" | "drag" | "minimize" | "toggle_maximize" | "close";

export function useWindowChrome(
  onError: (message: string) => void,
  mayClose: () => boolean,
) {
  const [maximized, setMaximized] = useState(false);
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
  return {
    onMouseDown,
    controls: desktop ? (
      <div
        className="window-controls"
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
          {maximized ? <Copy size={14} /> : <Square size={14} />}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="Close window"
          title="Close Reelio"
          onClick={() => {
            if (mayClose()) void act("close");
          }}
        >
          <X size={16} />
        </button>
      </div>
    ) : null,
  };
}
