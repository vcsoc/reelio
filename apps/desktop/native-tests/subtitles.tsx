import React from "react";
import { createRoot } from "react-dom/client";
import {
  SubtitleEditor,
  openSubtitleEditor,
} from "../src/features/subtitles/SubtitleEditor";
import "../src/app/styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <button onClick={openSubtitleEditor}>Open subtitle editor</button>
    <SubtitleEditor
      videoUrl={new URLSearchParams(location.search).get("video") || undefined}
      onOpen={() => {}}
      onAdd={async (paths) => {
        localStorage.setItem("subtitle-test-added", JSON.stringify(paths));
      }}
      sources={[{ path: "/media/original.srt", label: "Original.srt" }]}
    />
  </React.StrictMode>,
);
