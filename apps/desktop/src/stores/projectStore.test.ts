import { beforeEach, describe, expect, it } from "vitest";
import { addAsset, assetTracks, emptyProject, useEditor } from "./projectStore";
import type { Asset } from "../types";
const asset: Asset = {
  id: "source",
  path: "/media/movie.mkv",
  format: "matroska",
  size: 1024,
  modified_ms: 1,
  duration_ms: 1000,
  metadata: { title: "Original" },
  chapters: [],
  streams: [
    {
      index: 4,
      kind: "audio",
      codec: "aac",
      title: "Main",
      language: "eng",
      duration_ms: 1000,
      default: true,
      forced: false,
      properties: {},
    },
  ],
};
beforeEach(() => useEditor.getState().replace(emptyProject()));
describe("Project editing", () => {
  it("classifies still AVIF resources without creating video tracks or replacing movie metadata", () => {
    const image: Asset = {
      ...asset,
      id: "image",
      path: "/media/cover.avif",
      format: "mov,mp4,m4a,3gp,3g2,mj2",
      metadata: { major_brand: "avif" },
      streams: [
        { ...asset.streams[0], kind: "video", codec: "av1", duration_ms: null },
      ],
    };
    const images = addAsset(emptyProject(), image);
    expect(images.tracks).toEqual([]);
    expect(images.metadata).toEqual({});
    expect(images.name).toBe("Untitled project");
    const media = addAsset(images, asset);
    expect(media.metadata).toEqual(asset.metadata);
    expect(media.tracks).toHaveLength(1);
    expect(media.tracks[0].asset_id).toBe(asset.id);
  });
  it("removes lanes undoably, retains sources, and can regenerate a missing stream by stable asset/index", () => {
    const state = useEditor.getState();
    state.replace(addAsset(emptyProject(), asset));
    const original = useEditor.getState().project.tracks[0];
    state.edit((project) => {
      project.tracks = project.tracks.filter(
        (track) => track.id !== original.id,
      );
    });
    expect(useEditor.getState().project.assets[0].id).toBe(asset.id);
    expect(useEditor.getState().project.tracks).toEqual([]);
    const replacement = assetTracks(useEditor.getState().project, asset)[0];
    expect(replacement.id).not.toBe(original.id);
    expect([replacement.asset_id, replacement.stream_index]).toEqual([
      original.asset_id,
      original.stream_index,
    ]);
    state.undo();
    expect(useEditor.getState().project.tracks[0]).toEqual(original);
    state.redo();
    expect(useEditor.getState().project.tracks).toEqual([]);
  });
  it("starts a clean new project without carrying sources, covers or undo history", () => {
    const state = useEditor.getState();
    state.replace(addAsset(emptyProject(), asset));
    const previousId = useEditor.getState().project.id;
    state.edit((p) => {
      p.name = "Unsaved";
      p.artwork = {
        jpeg: "cover",
        width: 1,
        height: 1,
        source_label: "fixture",
      };
    });
    state.replace(emptyProject());
    const next = useEditor.getState();
    expect(next.project.id).not.toBe(previousId);
    expect(next.project.name).toBe("Untitled project");
    expect(next.project.container).toBe("mp4");
    expect(next.project.assets).toEqual([]);
    expect(next.project.tracks).toEqual([]);
    expect(next.project.artwork).toBeUndefined();
    expect(next.past).toEqual([]);
    expect(next.future).toEqual([]);
    expect(next.saved).toBe(JSON.stringify(next.project));
    state.edit((p) => {
      p.name = "Named empty project";
    });
    expect(useEditor.getState().saved).not.toBe(
      JSON.stringify(useEditor.getState().project),
    );
  });
  it("preserves explicit saved output formats when opening projects", () => {
    for (const container of ["matroska", "mp4", "m4v"] as const) {
      const project = { ...emptyProject(), container };
      useEditor.getState().replace(JSON.parse(JSON.stringify(project)));
      expect(useEditor.getState().project.container).toBe(container);
    }
  });
  it("uses stable source indices rather than display positions", () => {
    const p = addAsset(emptyProject(), asset);
    expect(p.tracks[0].stream_index).toBe(4);
    expect(p.tracks[0].asset_id).toBe(asset.id);
  });
  it("persists trims in schema 3 and undoes each committed edge drag atomically", () => {
    const p = addAsset(emptyProject(), asset);
    useEditor.getState().replace(p);
    useEditor.getState().edit((d) => {
      d.tracks[0].trim_start_ms = 200;
    });
    const trimmed = structuredClone(useEditor.getState().project);
    expect(trimmed.schema_version).toBe(3);
    expect(useEditor.getState().past).toHaveLength(1);
    expect(trimmed.tracks[0].trim_start_ms).toBe(200);
    expect(p.tracks[0].trim_start_ms).toBe(0);
    useEditor.getState().undo();
    expect(useEditor.getState().project.tracks[0].trim_start_ms).toBe(0);
    useEditor.getState().redo();
    expect(useEditor.getState().project).toEqual(trimmed);
    useEditor.getState().markSaved(trimmed);
    expect(JSON.parse(useEditor.getState().saved).tracks[0].trim_start_ms).toBe(
      200,
    );
  });
  it("rejects duplicate sources without adding tracks", () => {
    const p = addAsset(emptyProject(), asset);
    expect(() => addAsset(p, asset)).toThrow(/already/);
    expect(p.tracks).toHaveLength(1);
  });
  it("supports undo and redo without mutating prior snapshots", () => {
    const s = useEditor.getState();
    s.replace(addAsset(emptyProject(), asset));
    s.edit((p) => {
      p.tracks[0].enabled = false;
      p.metadata.title = "Edited";
    });
    expect(useEditor.getState().project.metadata.title).toBe("Edited");
    s.undo();
    expect(useEditor.getState().project.tracks[0].enabled).toBe(true);
    expect(useEditor.getState().project.metadata.title).toBe("Original");
    s.redo();
    expect(useEditor.getState().project.metadata.title).toBe("Edited");
  });
  it("clears redo history after a branching edit", () => {
    const s = useEditor.getState();
    s.edit((p) => {
      p.name = "A";
    });
    s.undo();
    s.edit((p) => {
      p.name = "B";
    });
    s.redo();
    expect(useEditor.getState().project.name).toBe("B");
    expect(useEditor.getState().future).toHaveLength(0);
  });
  it("does not mark later edits saved when an earlier async save finishes", () => {
    const s = useEditor.getState();
    const snapshot = s.project;
    s.edit((p) => {
      p.name = "After save started";
    });
    s.markSaved(snapshot);
    expect(JSON.stringify(useEditor.getState().project)).not.toBe(
      useEditor.getState().saved,
    );
  });
  it("keeps cover edits isolated across undo snapshots", () => {
    const s = useEditor.getState();
    s.edit((p) => {
      p.artwork = {
        jpeg: "immutable-image-payload",
        width: 160,
        height: 240,
        source_label: "fixture",
      };
    });
    s.edit((p) => {
      p.artwork!.width = 240;
    });
    expect(useEditor.getState().project.artwork?.width).toBe(240);
    s.undo();
    expect(useEditor.getState().project.artwork?.width).toBe(160);
    expect(useEditor.getState().project.artwork?.jpeg).toBe(
      "immutable-image-payload",
    );
  });
  it("excludes attached cover art from normal video mapping", () => {
    const a = structuredClone(asset);
    a.streams[0].kind = "video";
    a.streams[0].properties.attached_pic = "1";
    expect(addAsset(emptyProject(), a).tracks[0].enabled).toBe(false);
  });
});
