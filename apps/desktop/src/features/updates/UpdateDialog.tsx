import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { call } from "../../services/desktop";

type UpdateReport = {
  current_version: string;
  latest_version: string | null;
  status: string;
  message: string;
  asset_name: string | null;
  bytes: number | null;
  offer_id: string | null;
};
export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    active = useRef(true),
    cancelled = useRef(false),
    started = useRef(false);
  const [report, setReport] = useState<UpdateReport>(),
    [version, setVersion] = useState("Loading..."),
    [busy, setBusy] = useState<"check" | "download" | null>(null),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>();
  const check = async () => {
    setBusy("check");
    setError(undefined);
    setNotice(undefined);
    setReport(undefined);
    try {
      const result = await call<UpdateReport>("update_check");
      if (active.current) {
        setReport(result);
        setVersion(result.current_version);
      }
    } catch (error) {
      if (active.current)
        setError(String(error instanceof Error ? error.message : error));
    } finally {
      if (active.current) setBusy(null);
    }
  };
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    if (started.current)
      return () => {
        active.current = false;
      };
    started.current = true;
    void call<string>("app_version")
      .then((value) => {
        if (active.current) setVersion(value);
      })
      .catch(() => {
        if (active.current) setVersion("Unavailable");
      });
    void check();
    return () => {
      active.current = false;
    };
  }, []);
  const download = async () => {
    if (!report?.offer_id) return;
    setBusy("download");
    setError(undefined);
    setNotice(undefined);
    cancelled.current = false;
    try {
      const path = await call<string | null>("update_download", {
        offerId: report.offer_id,
      });
      if (active.current)
        setNotice(
          path
            ? `Verified package saved: ${path}. Install it using your operating system's package installer.`
            : "Save cancelled; no file was written.",
        );
    } catch (error) {
      if (active.current) {
        if (cancelled.current)
          setNotice("Update download cancelled; no package was published.");
        else setError(String(error instanceof Error ? error.message : error));
      }
    } finally {
      if (active.current) setBusy(null);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="settings-dialog update-dialog"
      aria-labelledby="reelio-updates-title"
      onClose={onClose}
      onCancel={(event) => {
        if (busy === "download") event.preventDefault();
      }}
    >
      <h2>
        <span id="reelio-updates-title">Software updates</span>{" "}
        <Info
          size={14}
          aria-label="Stable releases from github.com/vcsoc/reelio. Downloads require matching size and SHA-256. Packages are unsigned; installation is not automatic."
        />
      </h2>
      <p>
        Installed: <strong>{version}</strong>
      </p>
      {report?.latest_version && (
        <p>
          Latest stable release: <strong>{report.latest_version}</strong>
        </p>
      )}
      {busy === "check" && <p role="status">Checking GitHub releases...</p>}
      {report && <p role="status">{report.message}</p>}
      {report?.asset_name && (
        <p className="update-package">
          {report.asset_name} · {((report.bytes || 0) / 1024 / 1024).toFixed(1)}{" "}
          MiB
        </p>
      )}
      {busy === "download" && (
        <p role="status">
          {cancelled.current
            ? "Cancellation requested; waiting for the current network read to finish..."
            : "Downloading and verifying SHA-256..."}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={() => void check()}
        >
          Check again
        </button>
        {report?.offer_id && (
          <button
            type="button"
            className="primary"
            disabled={!!busy}
            onClick={() => void download()}
          >
            Download package
          </button>
        )}
        {busy === "download" && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              cancelled.current = true;
              setNotice(
                "Cancellation requested. Network requests have a bounded timeout.",
              );
              void call<void>("update_cancel").catch((error) =>
                setError(String(error)),
              );
            }}
          >
            Cancel download
          </button>
        )}
        <button
          type="button"
          disabled={busy === "download"}
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
