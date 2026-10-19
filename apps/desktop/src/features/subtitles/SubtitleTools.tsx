import { useState } from "react";
import { call } from "../../services/desktop";
import {
  sourceStream,
  time,
  type Project,
  type PendingResource,
  type SubtitleFile,
} from "../../types";
import { ResourceSearch, type Run } from "../resources/ResourceSearch";
import type { SubtitleCue } from "./preview";
const cueTime = (ms: number) =>
  `${time(ms)}.${String(Math.round(ms) % 1000).padStart(3, "0")}`;
export interface TestedSubtitle {
  trackId: string;
  projectId: string;
  sourcePath: string;
  text: string;
  cues: SubtitleCue[];
}
export function SubtitleTools({
  project,
  previewSourcePath,
  busy,
  run,
  onQueued,
  files,
  onAdd,
  onTest,
  tested,
  onClear,
  onSeek,
}: {
  project: Project;
  previewSourcePath: string;
  busy: boolean;
  run: Run;
  onQueued: (p: PendingResource) => void;
  files: SubtitleFile[];
  onAdd: (paths: string[]) => Promise<void>;
  onTest: (id: string) => void;
  tested?: TestedSubtitle;
  onClear: () => void;
  onSeek: (ms: number) => void;
}) {
  const tracks = project.tracks.filter(
    (t) => sourceStream(project, t)?.kind === "subtitle",
  );
  const [selected, setSelected] = useState("");
  const selectedId = tracks.some((t) => t.id === selected)
    ? selected
    : tracks[0]?.id || "";
  const duration = project.assets.find(
    (a) => a.path === previewSourcePath,
  )?.duration_ms;
  const beyond =
    tested &&
    duration != null &&
    tested.cues.some((c) => c.end > duration + 500);
  return (
    <section className="subtitle-tools">
      <ResourceSearch
        kind="subtitles"
        title={project.metadata.title || project.name}
        busy={busy}
        run={run}
        onQueued={onQueued}
      />
      <div className="resource-search-row">
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run("Choose subtitle files", async () => {
              const paths = await call<string[]>("choose_subtitles");
              if (paths.length) await onAdd(paths);
            })
          }
        >
          Choose local subtitles
        </button>
        <label>
          Subtitle to test
          <select
            value={selectedId}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a subtitle track</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title ||
                  `${sourceStream(project, t)?.codec} - ${t.language}`}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || !selectedId}
          onClick={() => onTest(selectedId)}
        >
          Test subtitle with video
        </button>
      </div>
      {files.length > 0 && (
        <div className="subtitle-downloads">
          <h3>Validated subtitle downloads</h3>
          {files.map((file) => (
            <div className="resource-search-row" key={file.path}>
              <span>{file.name}</span>
              <button
                className="secondary"
                disabled={
                  busy || project.assets.some((a) => a.path === file.path)
                }
                onClick={() => void onAdd([file.path])}
              >
                Add & test subtitle
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="muted">
        Testing converts a temporary preview to WebVTT and displays it over the
        source video. Original subtitle files stay unchanged; styling and
        positioning may differ. Export conversion still requires separate
        approval. Matching the release, frame rate, language, and
        synchronization requires your review.
      </p>
      {tested && (
        <section className="subtitle-cues">
          <div className="section-heading">
            <div>
              <h3>Subtitle test: {tested.cues.length} cues</h3>
              <p>
                First cue {cueTime(tested.cues[0].start)} - last cue{" "}
                {cueTime(tested.cues[tested.cues.length - 1].end)}. Play the
                source preview to check synchronization.
              </p>
            </div>
            <button className="secondary" onClick={onClear}>
              Clear subtitle preview
            </button>
          </div>
          {beyond && (
            <p className="notice">
              Some cues extend beyond the selected video's duration. This may be
              the wrong release.
            </p>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>SEEK</th>
                  <th>START / END</th>
                  <th>CUE TEXT (PLAIN PREVIEW)</th>
                </tr>
              </thead>
              <tbody>
                {tested.cues.slice(0, 100).map((cue, index) => (
                  <tr key={index}>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => onSeek(cue.start)}
                      >
                        Cue {index + 1}
                      </button>
                    </td>
                    <td>
                      {cueTime(cue.start)} - {cueTime(cue.end)}
                    </td>
                    <td className="cue-text">{cue.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tested.cues.length > 100 && (
            <small>
              Showing the first 100 cues. The video preview uses the full
              validated cue list.
            </small>
          )}
        </section>
      )}
    </section>
  );
}
