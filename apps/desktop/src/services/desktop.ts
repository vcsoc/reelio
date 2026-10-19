import { invoke, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
export async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop)
    throw new Error(
      "Open Reelio as a desktop application to access local files. Run npm run tauri dev from apps/desktop.",
    );
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : String(e));
  }
}
