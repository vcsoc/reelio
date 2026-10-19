import { useEffect, useRef, useState } from "react";
import { call } from "../../services/desktop";
import type { PendingResource, SearchKind } from "../../types";
export type Run = <T>(
  message: string,
  work: () => Promise<T>,
) => Promise<T | undefined>;
export function ResourceSearch({
  kind,
  title,
  busy,
  run,
  onQueued,
  downloadOnly = false,
}: {
  kind: SearchKind;
  title: string;
  busy: boolean;
  run: Run;
  onQueued: (p: PendingResource) => void;
  downloadOnly?: boolean;
}) {
  const [query, setQuery] = useState(title),
    [url, setUrl] = useState("");
  return (
    <section className="resource-search">
      <h3>
        {downloadOnly
          ? "Import another image"
          : kind === "artwork"
            ? "Find a poster or cover"
            : "Find subtitles"}
      </h3>
      {!downloadOnly && (
        <>
          <form
            className="resource-search-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run("Opening isolated search browser", () =>
                call("search_browser_open", { kind, query }),
              );
            }}
          >
            <label>
              Movie title
              <input
                value={query}
                maxLength={256}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Movie title and year"
              />
            </label>
            <button className="primary" disabled={busy || !query.trim()}>
              Search in Reelio browser
            </button>
          </form>
          <p className="muted">
            Search sends only this query to Bing, not your video. Results open
            in an isolated Reelio browser window without file or editing access.{" "}
            {kind === "subtitles"
              ? "Subtitle results focus on OpenSubtitles; accounts and provider restrictions may apply."
              : "Check image usage rights before downloading a cover."}{" "}
            Choose Download / Save image in the browser, then confirm the import
            here.
          </p>
        </>
      )}
      <form
        className="resource-search-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run("Preparing download confirmation", async () => {
            const p = await call<PendingResource>("resource_queue", {
              kind,
              url,
            });
            onQueued(p);
          });
        }}
      >
        <label>
          Direct {kind === "artwork" ? "image" : "subtitle or ZIP"} URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            maxLength={8192}
          />
        </label>
        <button className="secondary" disabled={busy || !url}>
          Review download
        </button>
      </form>
      <small>
        Direct public HTTPS downloads only. If a site uses a browser-only
        download or blocks the importer, save the file with your normal browser
        and use the file picker. Downloads are limited to 8 MiB.
      </small>
    </section>
  );
}
export function DownloadPrompt({
  pending,
  targetName,
  busy,
  onImport,
  onDismiss,
}: {
  pending?: PendingResource;
  targetName: string;
  busy: boolean;
  onImport: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pending && !ref.current?.open) ref.current?.showModal();
    if (!pending) ref.current?.close();
  }, [pending]);
  return (
    <dialog
      ref={ref}
      className="settings-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onDismiss();
      }}
      aria-labelledby="download-title"
    >
      <h2 id="download-title">
        Import this{" "}
        {pending?.kind === "artwork" ? "cover image" : "subtitle download"}?
      </h2>
      <p>
        From <strong>{pending?.host}</strong>
      </p>
      <p className="download-name">{pending?.name || "Selected download"}</p>
      <p>
        For project <strong>{targetName}</strong>. Source files remain
        unchanged.
      </p>
      <p>
        Reelio checks the file type and size before use. Images are decoded and
        normalized; subtitle ZIP files are unpacked with path and expansion
        limits. Nothing is executed or exported automatically.
      </p>
      <div className="dialog-actions">
        <button className="secondary" disabled={busy} onClick={onDismiss}>
          Cancel download
        </button>
        <button className="primary" disabled={busy} onClick={onImport}>
          {busy ? "Downloading and validating..." : "Download & import"}
        </button>
      </div>
    </dialog>
  );
}
