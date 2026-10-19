import { useEffect, useState } from "react";
import { call, desktop } from "../../services/desktop";
import type { RuntimeDependencies } from "../../types";

export function useDependencies(
  sourcePath: string | undefined,
  revision: number,
) {
  const [checked, setChecked] = useState<{
    sourcePath: string | undefined;
    revision: number;
    report: RuntimeDependencies;
  }>();
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void call<RuntimeDependencies>("dependencies_status")
      .then((report) => {
        if (active) setChecked({ sourcePath, revision, report });
      })
      .catch((error: Error) => {
        if (active)
          setChecked({
            sourcePath,
            revision,
            report: {
              preview_available: false,
              network_available: false,
              backend_available: false,
              missing_components: [`Dependency check failed: ${error.message}`],
              repair_supported: false,
              repair_hint:
                "Preview stays disabled until a successful component check. Restart Reelio or check your installation.",
              packages: [],
            },
          });
      });
    return () => {
      active = false;
    };
  }, [sourcePath, revision]);
  const current =
    checked?.sourcePath === sourcePath && checked?.revision === revision;
  return {
    report: checked?.report,
    checking: desktop && !current,
    previewReady: current && checked?.report?.preview_available === true,
  };
}
