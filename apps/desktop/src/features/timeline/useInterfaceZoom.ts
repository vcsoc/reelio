import { useEffect, useRef, useState } from "react";
import { call, desktop } from "../../services/desktop";
const KEY = "reelio.interface-zoom.v1";
export function interfaceZoom(value: string | null) {
  if (!value?.trim() || value.length > 64) return 100;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(50, Math.min(200, Math.round(number / 10) * 10))
    : 100;
}
export function useInterfaceZoom(onError: (message: string) => void) {
  const [percent, setPercent] = useState(() => {
    try {
      return interfaceZoom(localStorage.getItem(KEY));
    } catch {
      return 100;
    }
  });
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(percent));
    } catch {
      /* Keep zoom available without storage. */
    }
    document.documentElement.dataset.interfaceZoom = String(percent);
    if (desktop) {
      queue.current = queue.current
        .then(() => call<void>("interface_zoom", { percent }))
        .catch((error) => {
          onError(`Interface zoom could not be applied: ${String(error)}`);
          setPercent(100);
        });
    } else {
      document.documentElement.style.setProperty("zoom", String(percent / 100));
      document.documentElement.style.setProperty(
        "--preview-interface-zoom",
        String(percent / 100),
      );
    }
  }, [percent, onError]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.isComposing
      )
        return;
      if (
        ["+", "=", "-", "0"].includes(event.key) ||
        ["NumpadAdd", "NumpadSubtract"].includes(event.code)
      ) {
        event.preventDefault();
        setPercent((current) =>
          event.key === "0"
            ? 100
            : Math.max(
                50,
                Math.min(
                  200,
                  current +
                    (event.key === "-" || event.code === "NumpadSubtract"
                      ? -10
                      : 10),
                ),
              ),
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return [percent, () => setPercent(100)] as const;
}
