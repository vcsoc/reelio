import { useEffect, useState, useRef } from "react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";
export function Toast({
  message,
  error = false,
  onDismiss,
}: {
  message: string;
  error?: boolean;
  onDismiss: () => void;
}) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismiss.current(), error ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [message, error, paused]);
  return (
    <div
      className={`notice toast${error ? " error" : ""}`}
      role={error ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setPaused(false);
      }}
    >
      {error ? (
        <TriangleAlert size={19} aria-hidden="true" />
      ) : (
        <CircleCheck size={19} aria-hidden="true" />
      )}
      <div className="toast-message">{message}</div>
      <button
        title="Dismiss notification"
        aria-label={error ? "Dismiss error" : "Dismiss notification"}
        onClick={onDismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}
