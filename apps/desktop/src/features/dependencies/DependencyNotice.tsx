import type { RuntimeDependencies } from "../../types";
export function DependencyNotice({
  report,
  busy,
  repair,
  recheck,
}: {
  report?: RuntimeDependencies;
  busy: boolean;
  repair: () => void;
  recheck: () => void;
}) {
  if (!report?.missing_components.length) return null;
  return (
    <section className="notice" role="status">
      <div>
        <strong>Required components need attention</strong>
        <p>{report.missing_components.join(", ")}</p>
        <p>{report.repair_hint}</p>
        <div className="inline-options">
          {report.repair_supported && (
            <button className="primary" disabled={busy} onClick={repair}>
              Install required components
            </button>
          )}
          <button className="secondary" disabled={busy} onClick={recheck}>
            Check components again
          </button>
        </div>
      </div>
    </section>
  );
}
