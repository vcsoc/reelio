import { CircleHelp } from "lucide-react";
import { useEditor } from "../../stores/projectStore";

const fields = [
  "title",
  "artist",
  "album",
  "date",
  "genre",
  "description",
  "synopsis",
  "copyright",
  "comment",
  "show",
  "season_number",
  "episode_sort",
  "episode_id",
  "network",
  "director",
  "cast",
  "studio",
  "content_rating",
  "sort_title",
  "original_title",
  "external_id",
];
const projectOnly = new Set([
  "director",
  "cast",
  "studio",
  "content_rating",
  "sort_title",
  "original_title",
  "external_id",
]);
const mp4Only = new Set([
  "synopsis",
  "show",
  "season_number",
  "episode_sort",
  "episode_id",
  "network",
]);

export function MetadataEditor() {
  const p = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  function update(key: string, value: string) {
    edit((draft) => {
      if (value) draft.metadata[key] = value;
      else delete draft.metadata[key];
    });
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Tell the whole story</h2>
          <p>Container-aware metadata. Your source tags remain untouched.</p>
        </div>
      </div>
      <div className="info-card">
        <CircleHelp size={20} />
        <div>
          <strong>Only supported fields are written</strong>
          <p>
            Director, cast, ratings, sort titles, and external IDs are
            project-only. Metadata lookup and reusable templates are not yet
            implemented.
          </p>
        </div>
      </div>
      <div className="form-grid metadata-grid">
        {fields.map((key) => (
          <label key={key} htmlFor={`metadata-${key}`}>
            <span>
              {key.replaceAll("_", " ")}
              {projectOnly.has(key) ||
              (p.container === "matroska" && mp4Only.has(key)) ? (
                <small>project-only</small>
              ) : null}
            </span>
            {["description", "synopsis", "comment"].includes(key) ? (
              <textarea
                id={`metadata-${key}`}
                value={p.metadata[key] || ""}
                rows={3}
                onChange={(e) => update(key, e.target.value)}
              />
            ) : (
              <input
                id={`metadata-${key}`}
                value={p.metadata[key] || ""}
                onChange={(e) => update(key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <details>
        <summary>
          Other source tags (project-only unless explicitly mapped)
        </summary>
        {Object.keys(p.metadata)
          .filter((key) => !fields.includes(key))
          .map((key) => (
            <label key={key}>
              {key}
              <input
                value={p.metadata[key]}
                onChange={(e) => update(key, e.target.value)}
              />
            </label>
          ))}
      </details>
    </>
  );
}
