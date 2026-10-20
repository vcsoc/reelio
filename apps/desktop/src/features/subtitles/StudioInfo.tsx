import { Info } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
export function StudioInfo({ title, text }: { title: string; text: string }) {
  const id = useId(),
    tooltip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 12, top: 12, width: 320 });
  function show(button: HTMLButtonElement) {
    if (open) return;
    const rect = button.getBoundingClientRect(),
      width = Math.min(340, window.innerWidth - 24);
    setPosition({
      width,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: rect.bottom + 6,
    });
    setOpen(true);
  }
  useLayoutEffect(() => {
    if (open && tooltip.current) {
      const height = tooltip.current.getBoundingClientRect().height;
      setPosition((p) => ({
        ...p,
        top: Math.max(12, Math.min(p.top, window.innerHeight - height - 12)),
      }));
    }
  }, [open, text]);
  return (
    <button
      type="button"
      className="studio-info"
      aria-label={`${title} information`}
      aria-describedby={id}
      onClick={(event) => {
        event.preventDefault();
        show(event.currentTarget);
      }}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setOpen(false)}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={(event) => {
        if (document.activeElement !== event.currentTarget) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Info size={14} aria-hidden="true" />
      <span
        className="studio-info-tooltip"
        id={id}
        role="tooltip"
        hidden={!open}
        style={position}
      >
        {text}
      </span>
    </button>
  );
}
