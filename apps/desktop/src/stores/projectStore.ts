import { create } from "zustand";
import { isImageAsset } from "../types";
import type { Asset, Project, Track } from "../types";

export function emptyProject(): Project {
  return {
    schema_version: 3,
    id: crypto.randomUUID(),
    name: "Untitled project",
    container: "mp4",
    assets: [],
    tracks: [],
    metadata: {},
    chapters: [],
  };
}
export function assetTracks(p: Project, asset: Asset): Track[] {
  if (isImageAsset(asset)) return [];
  return asset.streams.map((s) => ({
    id: crypto.randomUUID(),
    asset_id: asset.id,
    stream_index: s.index,
    enabled:
      ["video", "audio", "subtitle"].includes(s.kind) &&
      !s.properties.attached_pic &&
      !(
        asset.streams.some(
          (x) => x.kind === "video" && !x.properties.attached_pic,
        ) &&
        p.assets.some((a) =>
          a.streams.some(
            (x) => x.kind === "video" && !x.properties.attached_pic,
          ),
        )
      ),
    title: s.title,
    language: s.language,
    default:
      s.default &&
      !p.tracks.some(
        (t) =>
          t.enabled &&
          t.default &&
          p.assets
            .find((a) => a.id === t.asset_id)
            ?.streams.find((x) => x.index === t.stream_index)?.kind === s.kind,
      ),
    forced: s.forced,
    commentary: s.properties.comment === "1",
    descriptive: s.properties.visual_impaired === "1",
    offset_ms: 0,
    trim_start_ms: 0,
    trim_end_ms: null,
    muted: false,
    audio_role: (s.kind === "audio" &&
    asset.streams.find((x) => x.kind === "audio")?.index === s.index
      ? "mix"
      : "separate") as "mix" | "separate",
  }));
}
export function addAsset(p: Project, asset: Asset): Project {
  if (p.assets.some((a) => a.path === asset.path))
    throw new Error(
      "This file is already in the project. No duplicate tracks were added.",
    );
  const hasMedia =
    isImageAsset(asset) || p.assets.some((item) => !isImageAsset(item));
  return {
    ...p,
    name: hasMedia
      ? p.name
      : asset.path
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, "") || p.name,
    metadata: hasMedia ? p.metadata : { ...asset.metadata },
    chapters: hasMedia ? p.chapters : structuredClone(asset.chapters),
    assets: [...p.assets, asset],
    tracks: [...p.tracks, ...assetTracks(p, asset)],
  };
}
interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  saved: string;
  edit: (fn: (p: Project) => void) => void;
  replace: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (snapshot: Project) => void;
}
const initialProject = emptyProject();
export const useEditor = create<EditorState>((set) => ({
  project: initialProject,
  past: [],
  future: [],
  saved: JSON.stringify(initialProject),
  edit: (fn) =>
    set((s) => {
      // Image bytes are immutable strings; do not duplicate them in every undo snapshot.
      const { artwork, ...base } = s.project;
      const next: Project = structuredClone(base);
      if (artwork !== undefined) next.artwork = artwork ? { ...artwork } : null;
      fn(next);
      if (JSON.stringify(next) === JSON.stringify(s.project)) return s;
      return {
        project: next,
        past: [...s.past.slice(-99), s.project],
        future: [],
      };
    }),
  replace: (project) =>
    set({ project, past: [], future: [], saved: JSON.stringify(project) }),
  undo: () =>
    set((s) =>
      s.past.length
        ? {
            project: s.past.at(-1)!,
            past: s.past.slice(0, -1),
            future: [s.project, ...s.future],
          }
        : s,
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            project: s.future[0],
            past: [...s.past, s.project],
            future: s.future.slice(1),
          }
        : s,
    ),
  markSaved: (snapshot) => set({ saved: JSON.stringify(snapshot) }),
}));
