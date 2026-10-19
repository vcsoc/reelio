import { AudioLines, Film, Layers3, Subtitles } from "lucide-react";
import type { Kind } from "../types";
export function TrackIcon({ kind }: { kind?: Kind }) {
  const Icon =
    kind === "video"
      ? Film
      : kind === "audio"
        ? AudioLines
        : kind === "subtitle"
          ? Subtitles
          : Layers3;
  return <Icon size={17} aria-hidden="true" />;
}
