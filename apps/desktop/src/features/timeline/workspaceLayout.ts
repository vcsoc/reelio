import { useEffect, useState } from "react";

export const WORKSPACE_LAYOUT_KEY = "reelio.workspace-layout.v1";
export type WorkspaceLayout = {
  fullHeightLeft: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};
export function workspaceLayout(value: string | null): WorkspaceLayout {
  const defaults = {
    fullHeightLeft: false,
    leftCollapsed: false,
    rightCollapsed: false,
  };
  if (!value || value.length > 512) return defaults;
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data))
      return defaults;
    const fields = data as Record<string, unknown>;
    return {
      fullHeightLeft: fields.fullHeightLeft === true,
      leftCollapsed: fields.leftCollapsed === true,
      rightCollapsed: fields.rightCollapsed === true,
    };
  } catch {
    return defaults;
  }
}
export function useWorkspaceLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      return workspaceLayout(localStorage.getItem(WORKSPACE_LAYOUT_KEY));
    } catch {
      return workspaceLayout(null);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* Layout controls remain usable when storage is unavailable. */
    }
  }, [layout]);
  return [layout, setLayout] as const;
}
