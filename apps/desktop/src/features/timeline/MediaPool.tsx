import {
  AudioLines,
  Film,
  FolderOpen,
  Plus,
  Subtitles,
  Image,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Asset, Project } from "../../types";
import { basename, isImageAsset } from "../../types";
export function MediaPool({
  project,
  selected,
  open,
  preview,
  add,
  busy,
  layoutControl,
}: {
  project: Project;
  selected?: string;
  open: () => void;
  preview: (id: string) => void;
  add: (id: string) => void;
  busy: boolean;
  layoutControl?: ReactNode;
}) {
  return (
    <section className="media-pool" aria-label="Media pool">
      <header>
        <strong>
          MEDIA POOL <span className="pool-count">{project.assets.length}</span>
        </strong>
        <div className="pool-header-actions">
          {layoutControl}
          <button aria-label="Add media to pool" onClick={open} disabled={busy}>
            <Plus size={15} />
          </button>
        </div>
      </header>
      <button
        className="media-dropbox"
        data-has-media={project.assets.length > 0}
        onClick={open}
        disabled={busy}
      >
        <FolderOpen size={22} />
        <span>Add video, audio or subtitles</span>
        <small>Drop files here or browse</small>
      </button>
      <div className="media-pool-items">
        {project.assets.map((asset) => (
          <PoolAsset
            key={asset.id}
            asset={asset}
            selected={selected === asset.id}
            preview={() => preview(asset.id)}
            add={() => add(asset.id)}
          />
        ))}
      </div>
      <small
        className="pool-hint"
        title="Drag a file onto the timeline or use its + button to include it. Source files are never changed."
      >
        Drag to timeline · Sources stay untouched
      </small>
    </section>
  );
}
function PoolAsset({
  asset,
  selected,
  preview,
  add,
}: {
  asset: Asset;
  selected: boolean;
  preview: () => void;
  add: () => void;
}) {
  const kind = isImageAsset(asset)
    ? "IMAGE"
    : asset.streams.some(
          (s) => s.kind === "video" && !s.properties.attached_pic,
        )
      ? "VIDEO"
      : asset.streams.some((s) => s.kind === "audio")
        ? "AUDIO"
        : "SUBTITLE";
  return (
    <article
      className={`pool-asset ${selected ? "selected" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-reelio-asset", asset.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <button className="pool-preview" title={asset.path} onClick={preview}>
        {kind === "IMAGE" ? (
          <Image size={22} />
        ) : kind === "AUDIO" ? (
          <AudioLines size={22} />
        ) : kind === "SUBTITLE" ? (
          <Subtitles size={22} />
        ) : (
          <Film size={22} />
        )}
        <span className="pool-file-detail">
          <span className="pool-file-name">{basename(asset.path)}</span>
          <small>{kind}</small>
        </span>
      </button>
      <button
        className="pool-add"
        title="Include this file's tracks in the output timeline"
        aria-label={`Add ${basename(asset.path)} to timeline`}
        onClick={add}
      >
        <Plus size={13} />
      </button>
    </article>
  );
}
