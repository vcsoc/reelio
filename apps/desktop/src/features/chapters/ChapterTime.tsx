import { useEffect, useState } from "react";
import { chapterTime, parseChapterTime } from "./timing";
export function ChapterTime({
  value,
  index,
  onCommit,
}: {
  value: number;
  index: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(chapterTime(value));
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(chapterTime(value));
    setError("");
  }, [value]);
  return (
    <label>
      <input
        aria-label={`Chapter ${index + 1} start time`}
        aria-describedby={error ? `chapter-time-error-${index}` : undefined}
        type="text"
        inputMode="text"
        placeholder="00:00:00.000"
        maxLength={14}
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(chapterTime(value));
            setError("");
          }
        }}
        onBlur={() => {
          const next = parseChapterTime(draft);
          if (next === undefined) {
            setDraft(chapterTime(value));
            setError("Use HH:MM:SS.mmm. Previous start time restored.");
          } else {
            onCommit(next);
            setError("");
          }
        }}
      />
      {error && (
        <span
          className="chapter-time-error"
          id={`chapter-time-error-${index}`}
          role="alert"
        >
          {error}
        </span>
      )}
    </label>
  );
}
