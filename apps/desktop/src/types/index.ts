export type Container = "mp4" | "m4v" | "matroska";
export type Kind = "video" | "audio" | "subtitle" | "attachment" | "data";
export interface Stream {
  index: number;
  kind: Kind;
  codec: string;
  title: string;
  language: string;
  duration_ms: number | null;
  default: boolean;
  forced: boolean;
  properties: Record<string, string>;
}
export interface Asset {
  id: string;
  path: string;
  format: string;
  size: number;
  modified_ms: number;
  duration_ms: number | null;
  streams: Stream[];
  metadata: Record<string, string>;
  chapters: Chapter[];
}
export function isImageAsset(asset: Asset | undefined): boolean {
  return (
    !!asset &&
    !asset.streams.some(
      (stream) =>
        stream.kind === "audio" || Number(stream.properties.nb_frames) > 1,
    ) &&
    (["jpeg_pipe", "png_pipe", "webp_pipe"].includes(asset.format) ||
      asset.metadata.major_brand?.trim() === "avif" ||
      asset.streams.some((stream) => stream.properties.still_image === "1"))
  );
}
export interface Track {
  id: string;
  asset_id: string;
  stream_index: number;
  enabled: boolean;
  title: string;
  language: string;
  default: boolean;
  forced: boolean;
  commentary: boolean;
  descriptive: boolean;
  offset_ms: number;
  trim_start_ms?: number;
  trim_end_ms?: number | null;
  muted?: boolean;
  audio_role?: "mix" | "separate";
}
export interface Chapter {
  start_ms: number;
  end_ms: number;
  title: string;
}
export interface Artwork {
  jpeg: string;
  width: number;
  height: number;
  source_label: string;
}
export interface ImageEdits {
  crop: { x: number; y: number; width: number; height: number } | null;
  rotation: number;
  flip: boolean;
  grayscale: boolean;
  negative: boolean;
  sepia: boolean;
  brightness: number;
  contrast: number;
  resize: { width: number; height: number } | null;
}
export type SearchKind = "artwork" | "subtitles";
export interface PendingResource {
  id: string;
  kind: SearchKind;
  host: string;
  name: string;
}
export interface SubtitleFile {
  path: string;
  name: string;
}
export type ResourceResult =
  | { kind: "artwork"; artwork: Artwork }
  | { kind: "subtitles"; files: SubtitleFile[] };
export interface Project {
  main_video_track_id?: string | null;
  artwork?: Artwork | null;
  schema_version: number;
  id: string;
  name: string;
  container: Container;
  assets: Asset[];
  tracks: Track[];
  metadata: Record<string, string>;
  chapters: Chapter[];
}
export interface Compatibility {
  action:
    | "copy"
    | "bitstream_filter"
    | "convert_subtitle"
    | "render_audio"
    | "render_video"
    | "transcode"
    | "unsupported";
  reason: string;
  warning: string | null;
  target_codec: string | null;
}
export interface Plan {
  tracks: {
    track_id: string;
    output_index: number;
    source_index: number;
    asset_id: string;
    compatibility: Compatibility;
    default: boolean;
    mix_sources?: string[];
  }[];
  errors: string[];
  warnings: string[];
  duration_ms: number | null;
  estimated_bytes: number;
}
export interface Progress {
  phase: string;
  processed_ms: number;
  percent: number | null;
  bytes: number;
  elapsed_ms: number;
  notices?: string[];
}
export interface Job {
  id: string;
  sequence: number;
  status: string;
  destination: string;
  progress: Progress | null;
  error: string | null;
  created_at: string;
}
export interface RuntimeDependencies {
  preview_available: boolean;
  network_available: boolean;
  backend_available: boolean;
  missing_components: string[];
  repair_supported: boolean;
  repair_hint: string;
  packages: string[];
}
export interface Backend {
  ffmpeg_version: string;
  ffprobe_version: string;
  muxers: string[];
  subtitle_encoders: string[];
}
export const basename = (path: string) => path.split(/[\\/]/).pop() || path;
export const time = (ms: number | null | undefined) =>
  ms == null
    ? "--:--"
    : `${Math.floor(ms / 3600000)
        .toString()
        .padStart(2, "0")}:${Math.floor((ms / 60000) % 60)
        .toString()
        .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
        .toString()
        .padStart(2, "0")}`;
export const bytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
export const sourceStream = (p: Project, t: Track | undefined) =>
  t
    ? p.assets
        .find((a) => a.id === t.asset_id)
        ?.streams.find((s) => s.index === t.stream_index)
    : undefined;
