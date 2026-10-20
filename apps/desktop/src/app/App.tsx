import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Timeline } from "../features/timeline/Timeline";
import { MediaPool } from "../features/timeline/MediaPool";
import { ProjectMenu } from "../components/ProjectMenu";
import {
  CoverPreview,
  coverDropHit,
  type NativeMediaDrop,
} from "../features/artwork/CoverPreview";
import { useWindowChrome } from "../components/useWindowChrome";
import { useWorkspaceLayout } from "../features/timeline/workspaceLayout";
import { useInterfaceZoom } from "../features/timeline/useInterfaceZoom";
import { PoolDivider, usePoolWidth } from "../features/timeline/PoolDivider";
import { PreviewTransport } from "../features/timeline/PreviewTransport";
import {
  InspectorDivider,
  useInspectorWidth,
} from "../features/timeline/InspectorDivider";
import {
  subtitleAtOffset,
  timelineDuration,
  videoTimelineEnd,
} from "../features/timeline/geometry";
import {
  WorkspaceDivider,
  useViewerHeight,
} from "../features/timeline/WorkspaceDivider";
import { useAudioPreview } from "../features/timeline/useAudioPreview";
import * as Tabs from "@radix-ui/react-tabs";
import { ChapterTime } from "../features/chapters/ChapterTime";
import { chapterEnds, chapterTime } from "../features/chapters/timing";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Download,
  FileVideo2,
  FilePlus2,
  Film,
  Image as ImageIcon,
  FolderOpen,
  Layers3,
  ListOrdered,
  LoaderCircle,
  Moon,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelsTopLeft,
  Plus,
  Redo2,
  Save,
  Settings2,
  ShieldCheck,
  Subtitles,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { call, desktop } from "../services/desktop";
import {
  addAsset,
  assetTracks,
  emptyProject,
  useEditor,
} from "../stores/projectStore";
import { basename, bytes, sourceStream, time, isImageAsset } from "../types";
import type {
  Asset,
  Artwork,
  PendingResource,
  ResourceResult,
  SubtitleFile,
  Backend,
  Job,
  Plan,
  Project,
  Track,
} from "../types";
import { TrackIcon as IconTrack } from "../components/TrackIcon";
import { MetadataEditor } from "../features/metadata/MetadataEditor";
import { DependencyNotice } from "../features/dependencies/DependencyNotice";
import { useDependencies } from "../features/dependencies/useDependencies";
import { ArtworkPanel } from "../features/artwork/ArtworkPanel";
import { DownloadPrompt } from "../features/resources/ResourceSearch";
import {
  SubtitleTools,
  type TestedSubtitle,
} from "../features/subtitles/SubtitleTools";
import { SubtitleEditor } from "../features/subtitles/SubtitleEditor";
import { StudioInfo } from "../features/subtitles/StudioInfo";
import { inspectVtt, bindSubtitlePreview } from "../features/subtitles/preview";
import "./styles.css";
import "../features/resources/styles.css";

const sections = [
  { id: "timeline", label: "Timeline", icon: Layers3 },
  { id: "media", label: "Media information", icon: FileVideo2 },
  { id: "tracks", label: "All tracks", icon: Layers3 },
  { id: "subtitles", label: "Subtitle Studio", icon: Subtitles },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "metadata", label: "Metadata", icon: ListOrdered },
  { id: "artwork", label: "Poster & cover", icon: ImageIcon },
  { id: "chapters", label: "Chapters", icon: Clapperboard },
  { id: "export", label: "Export & history", icon: Download },
];
const actions: Record<string, string> = {
  copy: "Stream copy",
  bitstream_filter: "Bitstream filter",
  convert_subtitle: "Convert subtitle",
  render_audio: "Render audio",
  render_video: "Render video",
  transcode: "Needs transcoding",
  unsupported: "Unsupported",
};
const languages = [
  "und",
  "eng",
  "spa",
  "fra",
  "deu",
  "ita",
  "por",
  "jpn",
  "kor",
  "zho",
  "ara",
  "hin",
  "rus",
  "nld",
];

export default function App() {
  const {
    project: p,
    edit,
    replace,
    undo,
    redo,
    past,
    future,
    saved,
    markSaved,
  } = useEditor();
  const [tab, setActiveTab] = useState("timeline");
  const [layout, setLayout] = useWorkspaceLayout();
  const setTab = React.useCallback(
    (section: string) => {
      setActiveTab(section);
      if (
        section !== "timeline" &&
        section !== "artwork" &&
        section !== "subtitles"
      )
        setLayout((current) =>
          current.rightCollapsed
            ? { ...current, rightCollapsed: false }
            : current,
        );
    },
    [setLayout],
  );
  const priorTab = useRef(tab);
  useEffect(() => {
    if (tab === "subtitles") video.current?.pause();
    if (priorTab.current === tab) return;
    priorTab.current = tab;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(
          tab === "timeline"
            ? ".timeline-viewer"
            : tab === "artwork"
              ? ".artwork-workspace"
              : tab === "subtitles"
                ? ".subtitle-studio-dock"
                : ".workspace",
        )
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [tab]);
  const [selected, setSelected] = useState<string>();
  const [plan, setPlan] = useState<Plan>();
  const [backend, setBackend] = useState<Backend>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [interfacePercent, resetInterfaceZoom] = useInterfaceZoom(setError);
  const [busy, setBusy] = useState("");
  const importLock = useRef(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const notifyingExport = useRef<string | undefined>(undefined);
  useEffect(() => {
    const job = jobs.find((job) => job.id === notifyingExport.current);
    if (!job || !["completed", "failed", "cancelled"].includes(job.status))
      return;
    notifyingExport.current = undefined;
    if (job.status === "completed") {
      const count = job.progress?.notices?.length || 0;
      setNotice(
        count
          ? `Export completed with ${count} timeline adjustment${count === 1 ? "" : "s"} to fit the video. See Export history for every cropped or omitted item. Sources are unchanged.`
          : "Export completed. Sources are unchanged.",
      );
    } else {
      setNotice(undefined);
      setError(job.error || `Export ${job.status}. Sources are unchanged.`);
    }
  }, [jobs]);
  const [theme, setTheme] = useState("dark");
  const [settings, setSettings] = useState(false);
  const [recent, setRecent] = useState<{ path: string; kind: string }[]>([]);
  const [ffmpeg, setFfmpeg] = useState("");
  const [ffprobe, setFfprobe] = useState("");
  const [defaultFolder, setDefaultFolder] = useState("");
  const [savedFolder, setSavedFolder] = useState("");
  const [imageFormat, setImageFormat] = useState("png");
  const [folderError, setFolderError] = useState("");
  useEffect(() => {
    if (settings) {
      setDefaultFolder(savedFolder);
      setFolderError("");
    }
  }, [settings, savedFolder]);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (settings && !settingsDialog.current?.open)
      settingsDialog.current?.showModal();
  }, [settings]);
  const [previewError, setPreviewError] = useState<string>();
  const [previewUrl, setPreviewUrl] = useState<{ path: string; url: string }>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const [incomingArtwork, setIncomingArtwork] = useState<Artwork>();
  const [coverAssetId, setCoverAssetId] = useState<string>();
  useEffect(() => {
    const track = p.tracks.find((track) => track.id === p.main_video_track_id);
    if (track) setPreviewAssetId(track.asset_id);
  }, [p.id, p.main_video_track_id]);
  const [resourceQueue, setResourceQueue] = useState<PendingResource[]>([]);
  const pendingResource = resourceQueue[0];
  const queueResource = (resource: PendingResource) =>
    setResourceQueue((q) =>
      q.some((item) => item.id === resource.id)
        ? q
        : [...q, resource].slice(0, 9),
    );
  const dismissResource = () => {
    if (pendingResource)
      void call("resource_cancel", { id: pendingResource.id }).catch((e) =>
        setError(String(e)),
      );
    setResourceQueue((q) => q.slice(1));
  };
  const [subtitleFiles, setSubtitleFiles] = useState<SubtitleFile[]>([]);
  const [testedSubtitle, setTestedSubtitle] = useState<TestedSubtitle>();
  const video = useRef<HTMLVideoElement>(null);
  const [viewerTarget, setViewerTarget] = useState<HTMLElement | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<HTMLElement | null>(
    null,
  );
  const [playhead, setPlayhead] = useState(0);
  const [poolWidth, setPoolWidth] = usePoolWidth();
  const [inspectorWidth, setInspectorWidth] = useInspectorWidth();
  const [viewerHeight, setViewerHeight] = useViewerHeight();
  const [timelineReveal, setTimelineReveal] = useState<{
    time: number;
    revision: number;
  }>();
  const dirty = JSON.stringify(p) !== saved;
  const windowChrome = useWindowChrome(
    setError,
    () =>
      !busy &&
      (!dirty ||
        confirm(
          "Close Reelio and discard unsaved changes? Choose Cancel to save your project first.",
        )),
  );
  const [previewAssetId, setPreviewAssetId] = useState<string>();
  const previewSources = p.assets.filter(
    (a) =>
      !isImageAsset(a) &&
      a.streams.some(
        (s) =>
          (s.kind === "video" && !s.properties.attached_pic) ||
          s.kind === "audio",
      ),
  );
  const source =
    previewSources.find((a) => a.id === previewAssetId) ||
    previewSources.find((a) =>
      a.streams.some((s) => s.kind === "video" && !s.properties.attached_pic),
    ) ||
    previewSources[0] ||
    p.assets.find((asset) => !isImageAsset(asset));
  const [dependencyRevision, setDependencyRevision] = useState(0);
  const dependencies = useDependencies(source?.path, dependencyRevision);
  const recheckDependencies = () => setDependencyRevision((value) => value + 1);
  const repairDependencies = () =>
    void run(
      "Installing required components. Follow the system authentication prompt; do not close Reelio.",
      async () => {
        const report = await call<import("../types").RuntimeDependencies>(
          "dependencies_repair",
        );
        recheckDependencies();
        if (report.backend_available)
          setBackend(await call<Backend>("backend_status"));
        if (report.missing_components.length)
          setError(
            `Some components still need attention: ${report.missing_components.join(", ")}. Check any custom backend paths in Preferences.`,
          );
        else
          setNotice(
            "Required components are installed and verified. Preview is ready.",
          );
      },
    );
  const current = p.tracks.find((t) => t.id === selected);
  const currentStream = current && sourceStream(p, current);
  const active = jobs.find((j) =>
    ["queued", "processing", "verifying"].includes(j.status),
  );
  const enabled = p.tracks.filter((t) => t.enabled).length;
  async function run<T>(
    message: string,
    work: () => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(message);
    setError(undefined);
    setNotice(undefined);
    try {
      return await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function testSubtitle(trackId: string) {
    await run("Converting a temporary subtitle preview", async () => {
      const snapshot = useEditor.getState().project;
      const text = await call<string>("subtitle_preview", {
        project: snapshot,
        trackId,
      });
      const cues = inspectVtt(text);
      if (useEditor.getState().project.id !== snapshot.id) return;
      setTestedSubtitle({
        trackId,
        projectId: snapshot.id,
        sourcePath: source.path,
        text,
        cues,
      });
      setNotice(
        "Subtitle preview loaded. Play the source video and review synchronization; no source file was changed.",
      );
    });
  }
  async function addSubtitles(paths: string[], requireImport = false) {
    if (importLock.current) {
      if (requireImport)
        throw Error(
          "An import is already running; the saved SRT copy is unchanged.",
        );
      setError("An import is already running");
      return;
    }
    importLock.current = true;
    try {
      let trackId: string | undefined;
      await run("Inspecting subtitle files", async () => {
        for (const path of paths) {
          const asset = await call<Asset>("media_probe", { path });
          if (
            !asset.streams.length ||
            asset.streams.some((s) => s.kind !== "subtitle")
          )
            throw new Error(
              "Choose a standalone text subtitle file, not a movie or archive",
            );
          const next = addAsset(useEditor.getState().project, asset);
          for (const track of next.tracks) {
            if (track.asset_id === asset.id && !track.title)
              track.title = "External subtitles";
          }
          const importedId = next.assets.find((a) => a.path === asset.path)?.id;
          trackId = next.tracks.find((t) => t.asset_id === importedId)?.id;
          edit((d) => Object.assign(d, next));
        }
      });
      if (requireImport && !trackId)
        throw Error(
          "Could not add the saved SRT to the project. Your copy is safe; close the editor to inspect the project's import error.",
        );
      if (trackId) await testSubtitle(trackId);
    } finally {
      importLock.current = false;
    }
  }
  const importResource = () =>
    void run("Downloading and validating selected resource", async () => {
      if (!pendingResource) return;
      const id = pendingResource.id;
      try {
        const result = await call<ResourceResult>("resource_download", { id });
        if (result.kind === "artwork") {
          setIncomingArtwork(result.artwork);
          setTab("artwork");
          setNotice(
            "Cover downloaded and validated. Edit it if needed, then apply it to the project.",
          );
        } else {
          setSubtitleFiles(result.files);
          setTab("subtitles");
          setNotice(
            "Subtitles downloaded and validated. Choose Add & test subtitle to check a file with this video.",
          );
        }
      } finally {
        setResourceQueue((q) => q.filter((item) => item.id !== id));
      }
    });
  async function importPaths(paths: string[]) {
    if (importLock.current) {
      setError(
        "An import is already running. Wait for it to finish before adding more files.",
      );
      return;
    }
    importLock.current = true;
    try {
      for (const [i, path] of paths.entries()) {
        await run(
          `Inspecting ${i + 1} of ${paths.length}: ${basename(path)}`,
          async () => {
            const asset = await call<Asset>("media_probe", { path });
            if (isImageAsset(asset)) {
              await loadCover(path);
              return;
            }
            const next = addAsset(useEditor.getState().project, asset);
            edit((draft) => Object.assign(draft, next));
          },
        );
      }
    } finally {
      importLock.current = false;
    }
  }
  async function loadCover(path: string) {
    const projectId = useEditor.getState().project.id;
    const result = await call<{ asset: Asset; artwork: Artwork }>(
      "artwork_import",
      { path },
    );
    if (useEditor.getState().project.id !== projectId) return;
    let id = result.asset.id;
    edit((draft) => {
      const existing = draft.assets.find(
        (asset) => asset.path === result.asset.path,
      );
      if (existing) id = existing.id;
      else Object.assign(draft, addAsset(draft, result.asset));
      if (
        draft.tracks.some(
          (track) =>
            track.id === draft.main_video_track_id && track.asset_id === id,
        )
      )
        delete draft.main_video_track_id;
      draft.tracks = draft.tracks.filter((track) => track.asset_id !== id);
      draft.artwork = result.artwork;
    });
    setCoverAssetId(id);
    setIncomingArtwork(result.artwork);
    setNotice(
      "Cover applied. Its C lane is container artwork, not a video stream; the original image is unchanged.",
    );
  }
  async function dropCover(paths: string[]) {
    if (paths.length !== 1) {
      setError(
        "Drop one cover image at a time; the existing cover is unchanged.",
      );
      return;
    }
    if (importLock.current) {
      setError("An import is already running");
      return;
    }
    importLock.current = true;
    try {
      await run("Loading cover image", () => loadCover(paths[0]));
    } finally {
      importLock.current = false;
    }
  }
  function editCover() {
    const cover = useEditor.getState().project.artwork;
    setIncomingArtwork(cover ? { ...cover } : undefined);
    setTab("artwork");
  }
  const openMedia = (folder = false) =>
    run("Choose media", async () => {
      const paths = await call<string[]>("choose_media", { folder });
      if (paths.length) await importPaths(paths);
    });
  const save = () =>
    run("Saving project", async () => {
      const snapshot = useEditor.getState().project;
      const path = await call<string | null>("project_save", {
        project: snapshot,
      });
      if (path) {
        markSaved(snapshot);
        setNotice(`Project saved: ${basename(path)}`);
      }
    });
  function resetProjectResources() {
    for (const item of resourceQueue)
      void call("resource_cancel", { id: item.id }).catch(() => {});
    setResourceQueue([]);
    setCoverAssetId(undefined);
    setIncomingArtwork(undefined);
    setSubtitleFiles([]);
    setTestedSubtitle(undefined);
    setTimelineReveal(undefined);
    setPlayhead(0);
  }
  function activateProject(project: Project) {
    resetProjectResources();
    replace(project);
    setSelected(undefined);
    setPreviewAssetId(undefined);
    setPreviewRevision((n) => n + 1);
    setPlan(undefined);
    setTab("timeline");
    setSettings(false);
    setError(undefined);
  }
  const newProject = () => {
    if (busy || importLock.current) return;
    const current = useEditor.getState();
    if (
      JSON.stringify(current.project) !== current.saved &&
      !confirm(
        "Create a new project and discard unsaved changes? Choose Cancel to save your current project first.",
      )
    )
      return;
    activateProject(emptyProject());
    setNotice(
      "New project ready. Open media or drop files to get started; existing files are unchanged.",
    );
  };
  const openProject = () => {
    if (busy || importLock.current) return;
    const current = useEditor.getState();
    if (
      JSON.stringify(current.project) !== current.saved &&
      !confirm(
        "Discard unsaved edits and open another project? Choose Cancel to save your current project first.",
      )
    )
      return;
    return run("Opening project", async () => {
      const project = await call<Project | null>("project_open");
      if (project) {
        activateProject(project);
        setNotice("Project opened. Sources are checked again before export.");
      }
    });
  };
  async function validateExport() {
    setTab("export");
    await run("Validating sources and output plan", async () => {
      const result = await call<Plan>("export_plan", { project: p });
      setPlan(result);
      if (!result.errors.length)
        setNotice(
          "Export plan validated. Review the summary before choosing an output file.",
        );
    });
  }
  async function refreshJobs() {
    try {
      const result = await call<Job[]>("jobs_list");
      setJobs((old) =>
        result.map((j) => {
          const previous = old.find((x) => x.id === j.id);
          return previous && previous.sequence > j.sequence ? previous : j;
        }),
      );
    } catch {
      /* Startup error is shown by backend discovery. */
    }
  }
  const patchTrack = (id: string, patch: Partial<Track>) =>
    edit((draft) => {
      const t = draft.tracks.find((t) => t.id === id);
      if (t) {
        if (patch.default) {
          const kind = sourceStream(draft, t)?.kind;
          draft.tracks
            .filter((other) => sourceStream(draft, other)?.kind === kind)
            .forEach((other) => {
              other.default = false;
            });
        }
        Object.assign(t, patch);
        if ("trim_start_ms" in patch || "trim_end_ms" in patch)
          chapterEnds(draft.chapters, timelineDuration(draft));
      }
    });
  const move = (id: string, direction: number) =>
    edit((draft) => {
      const i = draft.tracks.findIndex((t) => t.id === id);
      const target = i + direction;
      if (target >= 0 && target < draft.tracks.length)
        [draft.tracks[i], draft.tracks[target]] = [
          draft.tracks[target],
          draft.tracks[i],
        ];
    });
  const seekChapter = (direction: number) => {
    const v = video.current;
    if (!v) return;
    const pos = v.currentTime * 1000;
    const list = p.chapters.map((c) => c.start_ms);
    const target =
      direction > 0
        ? list.find((t) => t > pos + 500)
        : [...list].reverse().find((t) => t < pos - 500);
    if (target != null) v.currentTime = target / 1000;
  };
  useEffect(() => {
    if (!desktop) return;
    void call<Backend>("backend_status")
      .then(setBackend)
      .catch((e) => setError(String(e.message)));
    void call<{
      theme: string;
      recents: typeof recent;
      backend: { ffmpeg?: string; ffprobe?: string } | null;
      default_folder?: string;
      image_format?: string;
    }>("settings_get")
      .then((s) => {
        setTheme(s.theme);
        setRecent(s.recents);
        setFfmpeg(s.backend?.ffmpeg || "");
        setFfprobe(s.backend?.ffprobe || "");
        setSavedFolder(s.default_folder || "");
        setImageFormat(s.image_format || "png");
        setDefaultFolder(s.default_folder || "");
      })
      .catch((e) => setError(String(e.message)));
    void refreshJobs();
    const interval = setInterval(() => void refreshJobs(), 1000);
    const cleanups = [
      listen<NativeMediaDrop>("media:dropped", (event) => {
        const drop = event.payload;
        const paths = Array.isArray(drop) ? drop : drop.paths;
        const rect = document
          .querySelector("[data-cover-drop-target]")
          ?.getBoundingClientRect();
        if (coverDropHit(drop, rect, window.innerWidth, window.innerHeight))
          void dropCover(paths);
        else void importPaths(paths);
      }),
      listen<PendingResource>("resource:download-requested", (e) =>
        queueResource(e.payload),
      ),
      listen<string>("resource:error", (e) => setError(e.payload)),
      listen("dependencies:changed", () => recheckDependencies()),
      listen("app:close-blocked", () =>
        setError(
          "An export, component installation or update download is running. Wait for completion or cancel the operation before closing Reelio.",
        ),
      ),
    ];
    return () => {
      clearInterval(interval);
      for (const cleanup of cleanups) void cleanup.then((fn) => fn());
    };
  }, []);
  useEffect(() => {
    setPlan(undefined);
    let active = true;
    const timeout = setTimeout(() => {
      if (desktop)
        void call<Plan>("project_validate", { project: p })
          .then((plan) => {
            if (active) setPlan(plan);
          })
          .catch((e) => {
            if (active) setError(e.message);
          });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [p]);
  useEffect(() => {
    resetProjectResources();
  }, [p.id]);
  useAudioPreview(
    video,
    p,
    source?.id,
    previewError ? undefined : previewUrl?.url,
    selected,
    setError,
  );
  const videoOffset =
    p.tracks.find(
      (t) => t.asset_id === source?.id && sourceStream(p, t)?.kind === "video",
    )?.offset_ms ?? 0;
  function selectTimelineTrack(id: string) {
    setSelected(id);
    const track = p.tracks.find((t) => t.id === id);
    if (track && sourceStream(p, track)?.kind === "video")
      setPreviewAssetId(track.asset_id);
    if (
      track &&
      sourceStream(p, track)?.kind === "subtitle" &&
      testedSubtitle?.trackId !== id &&
      desktop &&
      source &&
      dependencies.previewReady
    )
      void testSubtitle(id);
  }
  function includeAsset(id: string) {
    const asset = useEditor
      .getState()
      .project.assets.find((item) => item.id === id);
    if (!asset) return;
    if (isImageAsset(asset)) {
      void dropCover([asset.path]);
      return;
    }
    edit((d) => {
      d.tracks.push(
        ...assetTracks(d, asset).filter(
          (track) =>
            !d.tracks.some(
              (prior) =>
                prior.asset_id === track.asset_id &&
                prior.stream_index === track.stream_index,
            ),
        ),
      );
      const hasVideo = d.assets
        .find((a) => a.id === id)
        ?.streams.some((s) => s.kind === "video" && !s.properties.attached_pic);
      if (hasVideo) {
        const priorVideo = new Set(
          d.tracks
            .filter(
              (t) =>
                t.enabled &&
                t.asset_id !== id &&
                sourceStream(d, t)?.kind === "video",
            )
            .map((t) => t.asset_id),
        );
        for (const t of d.tracks)
          if (
            priorVideo.has(t.asset_id) &&
            (sourceStream(d, t)?.kind === "video" || t.audio_role === "mix")
          )
            t.enabled = false;
      }
      for (const t of d.tracks)
        if (
          t.asset_id === id &&
          ["video", "audio", "subtitle"].includes(
            sourceStream(d, t)?.kind ?? "",
          ) &&
          !sourceStream(d, t)?.properties.attached_pic
        )
          t.enabled = true;
    });
    setPreviewAssetId(id);
  }
  function moveChapter(index: number, ms: number) {
    edit((d) => {
      const c = d.chapters[index];
      if (!c) return;
      const value = Math.max(
        0,
        Math.min(timelineDuration(d) - 1, Math.round(ms)),
      );
      if (
        d.chapters.some((other, i) => i !== index && other.start_ms === value)
      )
        return;
      c.start_ms = value;
      d.chapters.sort((a, b) => a.start_ms - b.start_ms);
      chapterEnds(d.chapters, timelineDuration(d));
    });
  }
  function addTimelineChapter(ms: number) {
    edit((d) => {
      const value = Math.max(
        0,
        Math.min(timelineDuration(d) - 1, Math.round(ms)),
      );
      if (d.chapters.some((c) => c.start_ms === value)) return;
      d.chapters.push({
        start_ms: value,
        end_ms: value + 1,
        title: `Chapter ${d.chapters.length + 1}`,
      });
      d.chapters.sort((a, b) => a.start_ms - b.start_ms);
      chapterEnds(d.chapters, timelineDuration(d));
    });
  }
  const validSubtitleTest =
    testedSubtitle?.projectId === p.id &&
    testedSubtitle?.sourcePath === source?.path &&
    p.tracks.some((t) => t.id === testedSubtitle?.trackId && t.enabled)
      ? testedSubtitle
      : undefined;
  useEffect(() => {
    if (
      !validSubtitleTest ||
      !dependencies.previewReady ||
      previewError ||
      !video.current
    )
      return;
    const offset =
      (p.tracks.find((t) => t.id === validSubtitleTest.trackId)?.offset_ms ??
        0) - videoOffset;
    return bindSubtitlePreview(
      video.current,
      subtitleAtOffset(
        validSubtitleTest.cues,
        offset,
        p.tracks.find((t) => t.id === validSubtitleTest.trackId)
          ?.trim_start_ms ?? 0,
        p.tracks.find((t) => t.id === validSubtitleTest.trackId)?.trim_end_ms ??
          Infinity,
      ),
      setError,
    );
  }, [
    validSubtitleTest,
    dependencies.previewReady,
    previewError,
    previewUrl,
    p,
    videoOffset,
  ]);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (query.matches ? "dark" : "light") : theme);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    setPreviewError(undefined);
    setPreviewUrl(undefined);
    if (
      !source ||
      !desktop ||
      !dependencies.previewReady ||
      !previewSources.length
    )
      return;
    let active = true;
    void call<string>("preview_source", { path: source.path })
      .then((url) => {
        if (active) setPreviewUrl({ path: source.path, url });
      })
      .catch((e) => {
        if (active)
          setPreviewError(
            `Could not prepare source playback: ${e instanceof Error ? e.message : String(e)}`,
          );
      });
    return () => {
      active = false;
    };
  }, [
    source?.path,
    p.id,
    desktop,
    dependencies.previewReady,
    dependencyRevision,
    previewRevision,
  ]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest(".subtitle-studio")) return;
      const editing = (e.target as HTMLElement)?.matches(
        "input,textarea,select,[contenteditable]",
      );
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (["n", "o", "s", "e", "z", "y", "f", "t"].includes(k))
          e.preventDefault();
        if (busy) return;
        if (k === "n") newProject();
        if (k === "o") void (e.shiftKey ? openProject() : openMedia());
        if (k === "s") void save();
        if (k === "e") void validateExport();
        if (k === "t") void openMedia();
        if (!editing && k === "z") e.shiftKey ? redo() : undo();
        if (!editing && k === "y") redo();
        if (k === "f") {
          setTab("metadata");
          setTimeout(
            () => document.getElementById("metadata-title")?.focus(),
            0,
          );
        }
      } else if (!editing && e.code === "Space" && video.current) {
        e.preventDefault();
        if (video.current.paused)
          void video.current
            .play()
            .catch(() =>
              setPreviewError(
                "Playback could not start. Retry the preview or check its required components.",
              ),
            );
        else video.current.pause();
      } else if (!editing && e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        seekChapter(1);
      } else if (!editing && e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        seekChapter(-1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const visibleTracks = p.tracks.filter((t) =>
    tab === "audio"
      ? sourceStream(p, t)?.kind === "audio"
      : tab === "subtitles"
        ? sourceStream(p, t)?.kind === "subtitle"
        : true,
  );
  return (
    <Tabs.Root
      value={tab}
      onValueChange={setTab}
      orientation="horizontal"
      className="app-shell"
      data-native-window={desktop}
      style={
        {
          "--pool-width": `${poolWidth}px`,
          "--inspector-width": `${inspectorWidth}px`,
          "--viewer-height":
            viewerHeight === undefined ? undefined : `${viewerHeight}px`,
        } as React.CSSProperties
      }
    >
      <header
        className="toolbar"
        aria-label="Window top bar"
        onMouseDown={windowChrome.onMouseDown}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Reelio home"
        >
          <span className="brand-mark">
            <Film size={22} />
          </span>
          <span>
            reelio<span className="brand-dot">.</span>
          </span>
        </a>
        <ProjectMenu
          actions={[
            {
              label: "New project",
              shortcut: "Ctrl/Cmd+N",
              icon: <FilePlus2 size={17} />,
              disabled: !!busy,
              select: newProject,
            },
            {
              label: "Open project",
              shortcut: "Ctrl/Cmd+Shift+O",
              icon: <FolderOpen size={17} />,
              disabled: !!busy,
              select: () => void openProject(),
            },
            {
              label: "Open media",
              shortcut: "Ctrl/Cmd+O",
              icon: <FileVideo2 size={17} />,
              disabled: !!busy,
              select: () => void openMedia(),
            },
            {
              label: "Save project",
              shortcut: "Ctrl/Cmd+S",
              icon: <Save size={17} />,
              disabled: !!busy,
              select: () => void save(),
            },
          ]}
        />
        <button
          className="icon-button"
          title={
            layout.leftCollapsed
              ? "Expand left sidebar"
              : "Collapse left sidebar"
          }
          aria-label={
            layout.leftCollapsed
              ? "Expand left sidebar"
              : "Collapse left sidebar"
          }
          aria-controls="reelio-left-panel"
          aria-expanded={!layout.leftCollapsed}
          onClick={() =>
            setLayout((current) => ({
              ...current,
              leftCollapsed: !current.leftCollapsed,
            }))
          }
        >
          {layout.leftCollapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
        <span className="toolbar-separator" />
        <nav className="toolbar-project-tools" aria-label="Project tools">
          <Tabs.List className="project-tools" aria-label="Project tools">
            {sections.map(({ id, label, icon: Icon }) => (
              <Tabs.Trigger
                value={id}
                key={id}
                onClick={() => setTab(id)}
                title={label}
                aria-label={
                  id === "tracks" ? `${label} ${p.tracks.length}` : label
                }
              >
                <Icon size={16} />
                <span className="tool-label">{label}</span>
                {id === "tracks" && (
                  <span className="count">{p.tracks.length}</span>
                )}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </nav>
        <div className="toolbar-inspector-actions">
          <button
            className="icon-button"
            title={
              layout.rightCollapsed
                ? "Expand right sidebar"
                : "Collapse right sidebar"
            }
            aria-label={
              layout.rightCollapsed
                ? "Expand right sidebar"
                : "Collapse right sidebar"
            }
            aria-controls="reelio-right-panel"
            aria-expanded={!layout.rightCollapsed}
            onClick={() =>
              setLayout((current) => ({
                ...current,
                rightCollapsed: !current.rightCollapsed,
              }))
            }
          >
            {layout.rightCollapsed ? (
              <PanelRightOpen size={18} />
            ) : (
              <PanelRightClose size={18} />
            )}
          </button>
          <div className="toolbar-inspector-spacer" />
          <button
            className="icon-button"
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
            disabled={!past.length}
            onClick={undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-button"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Settings"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
          </button>
          <button
            className="primary"
            onClick={() => void validateExport()}
            disabled={!source || !!busy}
          >
            <Download size={17} />
            Export
            <ArrowUpRight size={15} />
          </button>
        </div>
        {windowChrome.controls}
      </header>
      <div className="global-feedback" ref={setFeedbackTarget} />
      {!desktop && (
        <div className="browser-banner">
          <CircleHelp size={15} />
          Browser preview only. Local media operations require the Tauri desktop
          app. <code>npm run tauri dev</code>
        </div>
      )}
      <main
        className="main-layout timeline-layout"
        role="main"
        aria-label="Editor workspace"
        data-section={tab}
        data-has-media={p.assets.length > 0}
        data-pool-height={layout.fullHeightLeft ? "full" : "upper"}
        data-left-collapsed={layout.leftCollapsed}
        data-right-collapsed={layout.rightCollapsed}
      >
        <aside
          className="sidebar"
          id="reelio-left-panel"
          aria-label="Media sidebar"
          hidden={layout.leftCollapsed}
        >
          <MediaPool
            project={p}
            selected={
              tab === "artwork" && coverAssetId
                ? coverAssetId
                : (current?.asset_id ?? source?.id)
            }
            busy={!!busy}
            open={() => void openMedia()}
            preview={(id) => {
              const asset = p.assets.find((a) => a.id === id);
              if (isImageAsset(asset)) {
                void run("Opening image in Poster & cover", async () => {
                  const projectId = useEditor.getState().project.id;
                  const result = await call<{ artwork: Artwork }>(
                    "artwork_import",
                    { path: asset!.path },
                  );
                  if (useEditor.getState().project.id !== projectId) return;
                  setIncomingArtwork(result.artwork);
                  setCoverAssetId(id);
                  setTab("artwork");
                });
                return;
              }
              if (
                asset?.streams.some(
                  (s) => s.kind === "video" && !s.properties.attached_pic,
                ) ||
                !previewSources.some((a) =>
                  a.streams.some((s) => s.kind === "video"),
                )
              )
                setPreviewAssetId(id);
              const track = p.tracks.find((t) => t.asset_id === id);
              if (track) selectTimelineTrack(track.id);
            }}
            add={includeAsset}
            layoutControl={
              <button
                title={
                  layout.fullHeightLeft
                    ? "Keep left panel above timelines"
                    : "Make left panel full height"
                }
                aria-label={
                  layout.fullHeightLeft
                    ? "Keep left panel above timelines"
                    : "Make left panel full height"
                }
                aria-pressed={layout.fullHeightLeft}
                onClick={() =>
                  setLayout((current) => ({
                    ...current,
                    fullHeightLeft: !current.fullHeightLeft,
                  }))
                }
              >
                {layout.fullHeightLeft ? (
                  <PanelsTopLeft size={15} />
                ) : (
                  <PanelLeft size={15} />
                )}
              </button>
            }
          />
          <div className="sidebar-bottom">
            <div className="local-badge">
              <span className="status-dot" />
              LOCAL BY DESIGN
            </div>
            <p>
              Your media stays on
              <br />
              your machine.
            </p>
            <button className="text-button" onClick={() => setSettings(true)}>
              <Settings2 size={15} />
              Preferences
            </button>
            <span className="version">REELIO / 0.2.0 PREVIEW</span>
          </div>
        </aside>
        <PoolDivider
          width={poolWidth}
          resize={setPoolWidth}
          hidden={layout.leftCollapsed}
        />
        <section
          className="timeline-viewer"
          ref={setViewerTarget}
          aria-label="Video viewer"
        />
        <section className="lower-workspace" aria-label="Lower workspace">
          <WorkspaceDivider height={viewerHeight} resize={setViewerHeight} />
          <Tabs.Content
            value="subtitles"
            forceMount
            className="subtitle-studio-dock"
            hidden={tab !== "subtitles"}
          >
            {" "}
            <SubtitleEditor
              embedded
              visible={tab === "subtitles"}
              onClose={() => setTab("timeline")}
              videoUrl={
                !previewError && previewUrl?.path === source?.path
                  ? previewUrl?.url
                  : undefined
              }
              onOpen={() => {
                video.current?.pause();
                setTab("subtitles");
              }}
              onAdd={(paths) => addSubtitles(paths, true)}
              projectBusy={!!busy}
              sources={p.assets
                .filter((a) => /\.srt$/i.test(a.path))
                .map((a) => ({ path: a.path, label: basename(a.path) }))}
            >
              <SubtitleTools
                project={p}
                previewSourcePath={source?.path ?? ""}
                busy={!!busy}
                run={run}
                onQueued={queueResource}
                files={subtitleFiles}
                onAdd={addSubtitles}
                onTest={(id) => void testSubtitle(id)}
                tested={validSubtitleTest}
                onClear={() => setTestedSubtitle(undefined)}
                onSeek={(ms) => {
                  if (video.current) video.current.currentTime = ms / 1000;
                }}
              />
            </SubtitleEditor>
          </Tabs.Content>
          <div
            className="timeline-dock"
            hidden={tab === "artwork" || tab === "subtitles"}
          >
            <Timeline
              key={p.id}
              project={p}
              selected={selected}
              select={selectTimelineTrack}
              patch={(id, changes) =>
                edit((d) => {
                  const track = d.tracks.find((t) => t.id === id);
                  if (track) Object.assign(track, changes);
                })
              }
              chapter={moveChapter}
              addChapter={addTimelineChapter}
              seek={(ms) => {
                setPlayhead(ms);
                if (video.current)
                  video.current.currentTime = Math.max(
                    0,
                    (ms - videoOffset) / 1000,
                  );
              }}
              playhead={playhead}
              reveal={timelineReveal}
              addAsset={includeAsset}
              addTracks={() => void openMedia()}
              busy={!!busy}
              editCover={editCover}
              setMainVideo={(id) => {
                edit((draft) => {
                  if (id) draft.main_video_track_id = id;
                  else delete draft.main_video_track_id;
                });
                if (id) {
                  const track = p.tracks.find((track) => track.id === id);
                  if (track) setPreviewAssetId(track.asset_id);
                }
              }}
              deleteChapter={(index) =>
                edit((draft) => {
                  draft.chapters.splice(index, 1);
                  chapterEnds(
                    draft.chapters,
                    videoTimelineEnd(draft) ??
                      source?.duration_ms ??
                      timelineDuration(draft),
                  );
                })
              }
              removeCover={() =>
                edit((draft) => {
                  draft.artwork = null;
                })
              }
              removeTrack={(id) => {
                edit((draft) => {
                  draft.tracks = draft.tracks.filter(
                    (track) => track.id !== id,
                  );
                  if (draft.main_video_track_id === id)
                    delete draft.main_video_track_id;
                });
                if (selected === id) setSelected(undefined);
                if (testedSubtitle?.trackId === id)
                  setTestedSubtitle(undefined);
              }}
            />
          </div>
          <Tabs.Content
            value="artwork"
            forceMount
            hidden={tab !== "artwork"}
            className="artwork-workspace"
          >
            <ArtworkPanel
              key={p.id}
              project={p}
              incoming={incomingArtwork}
              busy={!!busy}
              run={run}
              onQueued={queueResource}
              onApply={(artwork) => {
                if (useEditor.getState().project.id !== p.id) return;
                edit((d) => {
                  d.artwork = artwork;
                });
                setIncomingArtwork(undefined);
                if (artwork) setTab("timeline");
                setError(undefined);
                setNotice(
                  artwork
                    ? "Cover applied to this project. Export to a new file to embed it; sources are unchanged."
                    : "Project cover removed.",
                );
              }}
            />
          </Tabs.Content>
        </section>
        <InspectorDivider
          width={inspectorWidth}
          pool={layout.leftCollapsed ? 0 : poolWidth}
          resize={setInspectorWidth}
          hidden={layout.rightCollapsed}
        />
        <aside
          className="inspector"
          id="reelio-right-panel"
          aria-label="Right inspector"
          hidden={layout.rightCollapsed}
        >
          <div className="inspector-title">POSTER / COVER</div>
          <CoverPreview
            artwork={p.artwork}
            busy={!!busy}
            edit={editCover}
            dropAsset={(id) => {
              const asset = useEditor
                .getState()
                .project.assets.find((asset) => asset.id === id);
              if (asset) void dropCover([asset.path]);
            }}
          />
          <section
            className="workspace"
            aria-label="Project tools"
            hidden={tab === "artwork" || tab === "subtitles"}
          >
            <div className="breadcrumb">
              Workspace
              <ChevronRight size={13} />
              {source ? basename(source.path) : "New project"}
            </div>
            <div className="page-heading">
              <div>
                <div className="eyebrow">MEDIA CONTAINER EDITOR</div>
                <h2>{p.name}</h2>
                <p>
                  {source
                    ? `${p.assets.length} source${p.assets.length > 1 ? "s" : ""} · ${p.tracks.length} tracks · ${time(source.duration_ms)}`
                    : "Video, audio, subtitles and chapters in one project."}
                </p>
              </div>
              <span className="outline-badge">
                <ShieldCheck size={14} />
                Non-destructive
              </span>
            </div>
            <div className="workspace-feedback">
              {feedbackTarget &&
                createPortal(
                  <>
                    <DependencyNotice
                      report={dependencies.report}
                      busy={!!busy}
                      repair={repairDependencies}
                      recheck={recheckDependencies}
                    />
                    {error && (
                      <div className="notice error" role="alert">
                        <div>
                          <strong>
                            That operation could not be completed.
                          </strong>
                          <p>{error}</p>
                        </div>
                        <button
                          aria-label="Dismiss error"
                          onClick={() => setError(undefined)}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                    {notice && (
                      <div className="notice" role="status">
                        <span>{notice}</span>
                        <button
                          aria-label="Dismiss notification"
                          onClick={() => setNotice(undefined)}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                    {busy && (
                      <div className="working" role="status">
                        <LoaderCircle size={16} className="spin" />
                        {busy}
                      </div>
                    )}
                  </>,
                  feedbackTarget,
                )}
            </div>
            {!source ? (
              <section className="empty-state" hidden={tab === "export"}>
                <div className="empty-illustration">
                  <Film size={52} strokeWidth={1} />
                  <span>
                    <Plus size={18} />
                  </span>
                </div>
                <div className="eyebrow">START WITH YOUR SOURCE</div>
                <h1>No media in this project</h1>
                <p>
                  Open media files to inspect and organize their tracks, or drop
                  them here to get started. Your source files stay untouched.
                </p>
                <button
                  className="primary"
                  onClick={() => void openMedia()}
                  disabled={!!busy}
                >
                  <FolderOpen size={18} />
                  Open media files
                </button>
                <span className="drop-hint">
                  or drop local files anywhere in this window
                </span>
                <div className="empty-formats">
                  MP4 / M4V / MKV / MOV / AUDIO / SUBTITLES
                </div>
                <div className="empty-links">
                  <button onClick={() => void openProject()}>
                    Open a .reelio project
                    <ArrowUpRight size={14} />
                  </button>
                  <button onClick={() => void openMedia(true)}>
                    Import folder (non-recursive)
                  </button>
                </div>
                {recent.length > 0 && (
                  <details className="recent-list">
                    <summary>Recent files and projects</summary>
                    {recent.slice(0, 6).map((r) => (
                      <div key={r.path}>
                        <span>{basename(r.path)}</span>
                        <small>{r.kind} · Reopen using the file dialog</small>
                      </div>
                    ))}
                  </details>
                )}
              </section>
            ) : (
              <>
                {["tracks", "audio"].map((section) => (
                  <Tabs.Content value={section} key={section}>
                    <div className="section-heading">
                      <div>
                        <h2>
                          {section === "tracks"
                            ? "Build your track list"
                            : section === "audio"
                              ? "Audio tracks"
                              : "Subtitle tracks"}
                        </h2>
                        <p>
                          Choose what stays. Everything else stays in your
                          source.
                        </p>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => void openMedia()}
                        disabled={!!busy}
                      >
                        <Plus size={15} />
                        Add tracks
                      </button>
                    </div>

                    <div className="table-scroll">
                      <table className="track-table">
                        <thead>
                          <tr>
                            <th>
                              <span className="sr-only">Enabled</span>
                            </th>
                            <th>TRACK / CODEC</th>
                            <th>LANGUAGE</th>
                            <th>DEFAULT</th>
                            <th>OUTPUT</th>
                            <th>
                              <span className="sr-only">Order</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleTracks.map((t) => {
                            const s = sourceStream(p, t);
                            const mapped = plan?.tracks.find(
                              (x) => x.track_id === t.id,
                            );
                            const c = mapped?.compatibility;
                            const automaticDefault =
                              !t.default && mapped?.default === true;
                            return (
                              <tr
                                key={t.id}
                                className={`${!t.enabled ? "disabled-track" : ""} ${selected === t.id ? "selected-track" : ""}`}
                              >
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`Include ${t.title || s?.codec} track ${t.stream_index}`}
                                    checked={t.enabled}
                                    onChange={(e) =>
                                      patchTrack(t.id, {
                                        enabled: e.target.checked,
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    className="track-name"
                                    onClick={() => setSelected(t.id)}
                                  >
                                    <span className={`track-icon ${s?.kind}`}>
                                      <IconTrack kind={s?.kind} />
                                    </span>
                                    <span>
                                      <strong>
                                        {t.title ||
                                          `${s?.kind} ${t.stream_index + 1}`}
                                      </strong>
                                      <small>
                                        {s?.codec.toUpperCase()}{" "}
                                        {s?.properties.width
                                          ? `· ${s.properties.width} × ${s.properties.height}`
                                          : s?.properties.channels
                                            ? `· ${s.properties.channels} channels`
                                            : ""}
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <label
                                    className="sr-only"
                                    htmlFor={`lang-${t.id}`}
                                  >
                                    Track language
                                  </label>
                                  <input
                                    id={`lang-${t.id}`}
                                    className="language-input"
                                    list="languages"
                                    maxLength={3}
                                    value={t.language}
                                    onChange={(e) =>
                                      patchTrack(t.id, {
                                        language: e.target.value.toLowerCase(),
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`Default ${t.title || s?.codec}`}
                                    checked={t.default || automaticDefault}
                                    title={
                                      automaticDefault
                                        ? "Automatically selected for MP4/M4V. Select another included track to change the default."
                                        : "Use this as the default track"
                                    }
                                    onChange={(e) =>
                                      patchTrack(t.id, {
                                        default: e.target.checked,
                                      })
                                    }
                                  />
                                  {automaticDefault && (
                                    <small className="default-auto-label">
                                      Auto
                                    </small>
                                  )}
                                </td>
                                <td>
                                  <span
                                    className={`compatibility ${c?.action || "excluded"}`}
                                    title={c?.reason}
                                  >
                                    {!t.enabled
                                      ? "Excluded"
                                      : c
                                        ? actions[c.action]
                                        : "Checking"}
                                  </span>
                                </td>
                                <td>
                                  <div className="order-buttons">
                                    <button
                                      aria-label={`Move track ${t.stream_index} up`}
                                      disabled={p.tracks[0].id === t.id}
                                      onClick={() => move(t.id, -1)}
                                    >
                                      <ArrowUp size={14} />
                                    </button>
                                    <button
                                      aria-label={`Move track ${t.stream_index} down`}
                                      disabled={p.tracks.at(-1)?.id === t.id}
                                      onClick={() => move(t.id, 1)}
                                    >
                                      <ArrowDown size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!visibleTracks.length && (
                        <p className="inset-note">
                          No {section} tracks yet. Add a source file to get
                          started.
                        </p>
                      )}
                    </div>
                    <div className="table-footer">
                      <span>
                        {enabled} of {p.tracks.length} tracks included
                      </span>
                      <span>
                        <span className="status-dot" />
                        Explicit stream mapping
                      </span>
                    </div>
                    <div className="info-card">
                      <ShieldCheck size={20} />
                      <div>
                        <strong>Same quality. A better container.</strong>
                        <p>
                          Compatible streams are copied without re-encoding.
                          Conversions are always shown before export.
                        </p>
                      </div>
                    </div>
                    {current && (
                      <section className="editor-card">
                        <div className="section-heading">
                          <h3>Selected track</h3>
                          <button
                            className="danger text-button"
                            onClick={() => {
                              edit((d) => {
                                d.tracks = d.tracks.filter(
                                  (t) => t.id !== current.id,
                                );
                                if (d.main_video_track_id === current.id)
                                  delete d.main_video_track_id;
                              });
                              setSelected(undefined);
                            }}
                          >
                            <Trash2 size={14} />
                            Remove from project
                          </button>
                        </div>
                        <div className="form-grid">
                          <label>
                            Track title
                            <input
                              value={current.title}
                              onChange={(e) =>
                                patchTrack(current.id, {
                                  title: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Offset (milliseconds)
                            <input
                              type="number"
                              step="1"
                              min="-86400000"
                              max="86400000"
                              value={current.offset_ms}
                              onChange={(e) =>
                                patchTrack(current.id, {
                                  offset_ms: Number(e.target.value),
                                })
                              }
                            />
                            <small>
                              Positive delays the lane; negative trims its
                              beginning. Audio/video positioning requires render
                              approval.
                            </small>
                          </label>
                        </div>
                        <div className="inline-options">
                          {currentStream?.kind === "subtitle" && (
                            <label>
                              <input
                                type="checkbox"
                                checked={current.forced}
                                onChange={(e) =>
                                  patchTrack(current.id, {
                                    forced: e.target.checked,
                                  })
                                }
                              />
                              Forced subtitle
                            </label>
                          )}
                          {currentStream?.kind === "audio" && (
                            <>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={current.commentary}
                                  onChange={(e) =>
                                    patchTrack(current.id, {
                                      commentary: e.target.checked,
                                    })
                                  }
                                />
                                Commentary
                              </label>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={current.descriptive}
                                  onChange={(e) =>
                                    patchTrack(current.id, {
                                      descriptive: e.target.checked,
                                    })
                                  }
                                />
                                Descriptive audio
                              </label>
                            </>
                          )}
                        </div>
                        <details>
                          <summary>Read-only source properties</summary>
                          <dl className="properties">
                            {Object.entries(
                              currentStream?.properties || {},
                            ).map(([k, v]) => (
                              <React.Fragment key={k}>
                                <dt>{k.replaceAll("_", " ")}</dt>
                                <dd>{v}</dd>
                              </React.Fragment>
                            ))}
                          </dl>
                        </details>
                      </section>
                    )}
                  </Tabs.Content>
                ))}
                <Tabs.Content value="media">
                  <div className="section-heading">
                    <div>
                      <h2>Source media</h2>
                      <p>
                        Read-only facts from FFprobe. Project edits do not
                        change these files.
                      </p>
                    </div>
                    <button onClick={() => void openMedia(true)}>
                      Import folder
                    </button>
                  </div>
                  {p.assets.map((a) => (
                    <section className="editor-card" key={a.id}>
                      <h3>
                        <FileVideo2 size={18} />
                        {basename(a.path)}
                      </h3>
                      <code className="source-path">{a.path}</code>
                      <dl className="properties">
                        <dt>Container</dt>
                        <dd>{a.format}</dd>
                        <dt>Size</dt>
                        <dd>{bytes(a.size)}</dd>
                        <dt>Duration</dt>
                        <dd>{time(a.duration_ms)}</dd>
                        <dt>Streams</dt>
                        <dd>{a.streams.length}</dd>
                      </dl>
                      <details>
                        <summary>Original metadata</summary>
                        <dl className="properties">
                          {Object.entries(a.metadata).map(([k, v]) => (
                            <React.Fragment key={k}>
                              <dt>{k}</dt>
                              <dd>{v}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      </details>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          void run("Relinking source", async () => {
                            const paths = await call<string[]>("choose_media", {
                              folder: false,
                            });
                            if (paths.length !== 1)
                              throw new Error(
                                "Select exactly one replacement source.",
                              );
                            const next = await call<Asset>("media_probe", {
                              path: paths[0],
                            });
                            const tracks = p.tracks.filter(
                              (t) => t.asset_id === a.id,
                            );
                            if (
                              tracks.some(
                                (t) =>
                                  !next.streams.some(
                                    (s) =>
                                      s.index === t.stream_index &&
                                      s.kind ===
                                        a.streams.find(
                                          (x) => x.index === t.stream_index,
                                        )?.kind,
                                  ),
                              )
                            )
                              throw new Error(
                                "Replacement stream indices/types do not match. Add this source as new media instead.",
                              );
                            edit((d) => {
                              d.assets[
                                d.assets.findIndex((x) => x.id === a.id)
                              ] = { ...next, id: a.id };
                            });
                            setNotice(
                              "Source relinked. Review codecs and validate export again.",
                            );
                          })
                        }
                      >
                        Relink source
                      </button>
                    </section>
                  ))}
                </Tabs.Content>
                <Tabs.Content value="metadata">
                  <MetadataEditor />
                </Tabs.Content>
                <Tabs.Content value="chapters">
                  <div className="section-heading">
                    <div>
                      <h2>Give every moment a place</h2>
                      <p>
                        Millisecond timing. Ordered chapters. Clear navigation.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        edit((d) => {
                          const start = Math.round(
                            (video.current?.currentTime || 0) * 1000,
                          );
                          d.chapters.push({
                            start_ms: start,
                            end_ms: Math.max(
                              start + 1,
                              source.duration_ms || start + 1000,
                            ),
                            title: `Chapter ${d.chapters.length + 1}`,
                          });
                          d.chapters.sort((a, b) => a.start_ms - b.start_ms);
                          chapterEnds(d.chapters, p.assets[0]?.duration_ms);
                        })
                      }
                    >
                      <Plus size={15} />
                      At playhead
                    </button>
                  </div>
                  <div
                    className="chapter-timeline"
                    aria-label="Chapter timeline"
                  >
                    {p.chapters.map((c, i) => (
                      <button
                        key={i}
                        style={{
                          left: `${source?.duration_ms ? Math.min((c.start_ms / source.duration_ms) * 100, 98) : 0}%`,
                        }}
                        title={`${c.title}: ${chapterTime(c.start_ms)}`}
                        onClick={() => {
                          if (video.current)
                            video.current.currentTime = c.start_ms / 1000;
                        }}
                      >
                        <span>{i + 1}</span>
                      </button>
                    ))}
                  </div>
                  {p.chapters.map((c, i) => (
                    <div className="chapter-row" key={i}>
                      <span className="chapter-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <label>
                        <input
                          aria-label={`Chapter ${i + 1} title`}
                          value={c.title}
                          onChange={(e) =>
                            edit((d) => {
                              d.chapters[i].title = e.target.value;
                            })
                          }
                        />
                      </label>
                      <ChapterTime
                        value={c.start_ms}
                        index={i}
                        onCommit={(value) =>
                          edit((d) => {
                            d.chapters[i].start_ms = value;
                            chapterEnds(d.chapters, p.assets[0]?.duration_ms);
                          })
                        }
                      />
                      <button
                        aria-label={`Delete chapter ${i + 1}`}
                        onClick={() =>
                          edit((d) => {
                            d.chapters.splice(i, 1);
                            chapterEnds(d.chapters, p.assets[0]?.duration_ms);
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {!p.chapters.length && (
                    <p className="inset-note">
                      No chapters. Add one at the current preview position.
                    </p>
                  )}
                  <button
                    onClick={() =>
                      edit((d) => {
                        d.chapters.sort((a, b) => a.start_ms - b.start_ms);
                        chapterEnds(d.chapters, p.assets[0]?.duration_ms);
                      })
                    }
                  >
                    Sort by timestamp
                  </button>
                  <span
                    className="chapter-help"
                    tabIndex={0}
                    role="img"
                    aria-label="Chapter timing information"
                    title="Start times use HH:MM:SS.mmm and must be unique and increasing. Chapter ends follow the next start or the source duration automatically. The backend validates and verifies chapter timing before finalization."
                  >
                    <CircleHelp size={15} />
                  </span>
                </Tabs.Content>
              </>
            )}
            <Tabs.Content value="export">
              <div className="section-heading">
                <div>
                  <h2>Ready for a new container</h2>
                  <p>Review the plan. Keep your originals.</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => void validateExport()}
                  disabled={!!busy}
                >
                  Validate sources
                </button>
              </div>
              <section className="editor-card">
                {current && (
                  <section
                    className="inspector-section selected-lane-inspector"
                    aria-label="Selected lane inspector"
                  >
                    <div className="inspector-title">
                      SELECTED {currentStream?.kind.toUpperCase()} LANE
                    </div>
                    <label>
                      Title
                      <input
                        aria-label="Selected lane title"
                        value={current.title}
                        onChange={(e) =>
                          patchTrack(current.id, { title: e.target.value })
                        }
                      />
                    </label>
                    {(currentStream?.kind === "audio" ||
                      currentStream?.kind === "subtitle") && (
                      <label>
                        Language
                        <input
                          aria-label="Selected lane language"
                          list="languages"
                          maxLength={3}
                          value={current.language}
                          onChange={(e) =>
                            patchTrack(current.id, {
                              language: e.target.value.toLowerCase(),
                            })
                          }
                        />
                      </label>
                    )}
                    {currentStream?.kind === "audio" && (
                      <label>
                        Output role
                        <select
                          aria-label="Selected lane output role"
                          value={current.audio_role ?? "separate"}
                          onChange={(e) =>
                            patchTrack(current.id, {
                              audio_role: e.target.value as "mix" | "separate",
                            })
                          }
                        >
                          <option value="mix">Mix into main audio</option>
                          <option value="separate">
                            Separate language track
                          </option>
                        </select>
                      </label>
                    )}
                    <small>
                      Position: {current.offset_ms} ms. Drag the clip or edit
                      its timeline offset. Drag either clip edge to trim; extend
                      an edge to restore source material.
                    </small>
                    {((current.trim_start_ms ?? 0) > 0 ||
                      current.trim_end_ms != null) && (
                      <button
                        className="secondary"
                        onClick={() =>
                          patchTrack(current.id, {
                            trim_start_ms: 0,
                            trim_end_ms: null,
                          })
                        }
                      >
                        Reset clip trims
                      </button>
                    )}
                  </section>
                )}
                <div className="inspector-section">
                  <div className="inspector-title">OUTPUT CONTAINER</div>
                  <div className="container-options">
                    {(["matroska", "mp4", "m4v"] as const).map((c) => (
                      <button
                        key={c}
                        aria-pressed={p.container === c}
                        onClick={() =>
                          edit((d) => {
                            d.container = c;
                          })
                        }
                      >
                        {c === "matroska" ? "MKV" : c.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <p>
                    {p.container === "matroska"
                      ? "Flexible stream preservation."
                      : "Broad compatibility. Codec restrictions apply."}
                  </p>
                </div>
                <div className="export-stats">
                  <div>
                    <strong>{enabled}</strong>
                    <span>selected tracks</span>
                  </div>
                  <div>
                    <strong>
                      {plan?.tracks.filter((t) =>
                        ["copy", "bitstream_filter"].includes(
                          t.compatibility.action,
                        ),
                      ).length || 0}
                    </strong>
                    <span>without re-encoding</span>
                  </div>
                  <div>
                    <strong>{bytes(plan?.estimated_bytes || 0)}</strong>
                    <span>source size, not output estimate</span>
                  </div>
                </div>
                {plan?.tracks
                  .filter((track) =>
                    p.tracks.some((current) => current.id === track.track_id),
                  )
                  .map((t) => (
                    <div className="plan-track" key={t.track_id}>
                      <span>
                        #{t.output_index + 1}{" "}
                        {p.tracks.find((x) => x.id === t.track_id)?.title ||
                          sourceStream(
                            p,
                            p.tracks.find((x) => x.id === t.track_id),
                          )?.codec}
                      </span>
                      <span
                        className={`compatibility ${t.compatibility.action}`}
                      >
                        {actions[t.compatibility.action]}
                      </span>
                    </div>
                  ))}
              </section>
              {plan?.errors.map((e, i) => (
                <div className="validation-error" key={i}>
                  <X size={15} />
                  {e}
                </div>
              ))}
              <button
                className="primary export-button"
                disabled={!!busy || !!active || !plan || !!plan.errors.length}
                onClick={() => {
                  if (!plan) return;
                  const conversions = plan.tracks.filter((track) =>
                    [
                      "convert_subtitle",
                      "render_audio",
                      "render_video",
                    ].includes(track.compatibility.action),
                  );
                  const approveConversion = conversions.length > 0;
                  const review = [
                    ...plan.warnings,
                    ...conversions.map(
                      (track) =>
                        `Output track #${track.output_index + 1}: ${actions[track.compatibility.action]} - ${track.compatibility.reason}`,
                    ),
                    ...(approveConversion
                      ? [
                          "Continuing authorizes the listed subtitle conversions (including possible styling loss) and timeline audio/video rendering.",
                        ]
                      : []),
                  ];
                  if (
                    review.length &&
                    !confirm(
                      `Export review\n\n${review.join("\n\n")}\n\nContinue with export?`,
                    )
                  )
                    return;
                  void run("Starting export", async () => {
                    const id = await call<string | null>("export_start", {
                      project: p,
                      approveConversion,
                    });
                    if (id) {
                      notifyingExport.current = id;
                      setNotice(
                        "Export started. Sources are unchanged; the destination appears only after verification.",
                      );
                      await refreshJobs();
                    }
                  });
                }}
              >
                <Download size={17} />
                Choose destination & export
              </button>
              <section className="job-history">
                <h3>Export history</h3>
                <p>
                  One supervised job at a time. Interrupted jobs never resume
                  automatically.
                </p>
                {jobs.filter((j) => j.project_id === p.id).length === 0 && (
                  <p className="inset-note">
                    Your completed and failed exports will appear here.
                  </p>
                )}
                {jobs
                  .filter((j) => j.project_id === p.id)
                  .map((j) => (
                    <article className="job" key={j.id}>
                      <div className="job-top">
                        <strong>{basename(j.destination)}</strong>
                        <span className={`job-status ${j.status}`}>
                          {j.status === "completed" && <Check size={13} />}{" "}
                          {j.status}
                        </span>
                      </div>
                      {["processing", "verifying", "queued"].includes(
                        j.status,
                      ) && (
                        <>
                          <progress
                            max="100"
                            value={j.progress?.percent ?? undefined}
                            aria-label="Export progress"
                          />
                          <div className="job-top">
                            <small>
                              {j.progress
                                ? `${bytes(j.progress.bytes)} · ${time(j.progress.elapsed_ms)} elapsed · ${time(j.progress.processed_ms)} processed`
                                : "Starting media backend..."}
                            </small>
                            <button
                              onClick={() =>
                                void run("Cancelling export", () =>
                                  call("export_cancel", { id: j.id }),
                                )
                              }
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                      {j.error && <p className="job-error">{j.error}</p>}
                      {j.status === "completed" &&
                        !!j.progress?.notices?.length && (
                          <details className="job-adjustments" open>
                            <summary>
                              {j.progress.notices.length} timeline adjustments
                              to fit video
                            </summary>
                            <ul>
                              {j.progress.notices.map((notice, index) => (
                                <li key={index}>{notice}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      {["failed", "interrupted", "cancelled"].includes(
                        j.status,
                      ) && (
                        <button
                          onClick={() => {
                            if (
                              dirty &&
                              !confirm(
                                "Replace current edits with this job snapshot?",
                              )
                            )
                              return;
                            void run(
                              "Restoring selected job settings",
                              async () => {
                                const snapshot = await call<Project>(
                                  "job_project",
                                  { id: j.id },
                                );
                                replace(snapshot);
                                setNotice(
                                  "Job settings restored with source authorization. Relink missing sources if needed, validate, and choose a new destination.",
                                );
                              },
                            );
                          }}
                        >
                          Restore settings to retry
                        </button>
                      )}
                      <small>
                        {j.created_at} · revision {j.sequence}
                      </small>
                    </article>
                  ))}
              </section>
            </Tabs.Content>
          </section>
          {viewerTarget &&
            createPortal(
              <>
                <div className="inspector-title">
                  VIDEO VIEWER
                  <input
                    aria-label="Project name"
                    className="viewer-project-name"
                    value={p.name}
                    onChange={(e) =>
                      edit((d) => {
                        d.name = e.target.value;
                      })
                    }
                  />
                  <span className="outline-badge small">WEBVIEW</span>
                </div>
                {previewSources.length > 1 && (
                  <label className="preview-source-label">
                    Source to preview
                    <select
                      value={source.id}
                      onChange={(e) => setPreviewAssetId(e.target.value)}
                    >
                      {previewSources.map((a) => (
                        <option key={a.id} value={a.id}>
                          {basename(a.path)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="preview-frame">
                  {source &&
                  previewSources.length > 0 &&
                  desktop &&
                  dependencies.previewReady &&
                  !previewError &&
                  previewUrl?.path === source.path ? (
                    <video
                      key={previewUrl.url}
                      ref={video}
                      src={previewUrl.url}
                      preload="metadata"
                      onError={(e) => {
                        const code = e.currentTarget.error?.code;
                        setPreviewError(
                          code === 2
                            ? "The source stream could not be read. Retry the preview; the original file is unchanged."
                            : code === 3
                              ? "The WebView decoder could not decode this source. Compatible exports can still use stream copy."
                              : code === 4
                                ? "The WebView could not open this media format or codec. Retry playback or check the required components."
                                : "Playback was interrupted. Retry to reopen the source.",
                        );
                      }}
                      aria-label="Source media preview"
                    ></video>
                  ) : (
                    <div className="preview-placeholder">
                      <Film size={32} strokeWidth={1} />
                      <span>
                        {previewError
                          ? "Source playback failed"
                          : source && !dependencies.previewReady
                            ? dependencies.checking
                              ? "Checking preview components..."
                              : "Preview disabled: required components unavailable"
                            : desktop && source && previewSources.length
                              ? "Preparing source playback..."
                              : "Open video or audio to preview"}
                      </span>
                    </div>
                  )}
                </div>
                {source && (
                  <PreviewTransport
                    video={video}
                    sourceKey={`${previewUrl?.url}:${!!previewError}:${dependencies.previewReady}`}
                    duration={source.duration_ms ?? 0}
                    offset={videoOffset}
                    sync={(time, reveal) => {
                      setPlayhead(time);
                      if (reveal)
                        setTimelineReveal((old) => ({
                          time,
                          revision: (old?.revision ?? 0) + 1,
                        }));
                    }}
                  />
                )}
                <p className="preview-disclaimer">
                  {previewError
                    ? previewError
                    : source && !dependencies.previewReady
                      ? "Preview is disabled until its required components are verified. Compatible remuxing remains available."
                      : "Source video with synchronized timeline audio and selected subtitle audition. Select a language lane to audition it separately. Rendered video lead-in/trimming is applied at export; codec support varies by platform."}
                </p>
                <div className="preview-chapters">
                  {source && desktop && (
                    <button
                      className="secondary preview-retry"
                      disabled={!dependencies.previewReady}
                      onClick={() => setPreviewRevision((n) => n + 1)}
                    >
                      Retry preview
                    </button>
                  )}
                  <button
                    aria-label="Previous chapter"
                    onClick={() => seekChapter(-1)}
                  >
                    Previous chapter
                  </button>
                  <button
                    aria-label="Next chapter"
                    onClick={() => seekChapter(1)}
                  >
                    Next chapter
                  </button>
                </div>
              </>,
              viewerTarget,
            )}
          <div className="inspector-section">
            <div className="inspector-title">AT A GLANCE</div>
            <dl className="properties">
              <dt>Duration</dt>
              <dd>{time(plan?.duration_ms ?? source?.duration_ms)}</dd>
              <dt>Source size</dt>
              <dd>
                {source
                  ? bytes(p.assets.reduce((n, a) => n + a.size, 0))
                  : "--"}
              </dd>
              <dt>Output tracks</dt>
              <dd>{plan?.tracks.length ?? enabled}</dd>
              <dt>Video processing</dt>
              <dd className="green-text">
                {plan?.tracks.some(
                  (t) => t.compatibility.action === "render_video",
                )
                  ? "H.264 render"
                  : plan?.tracks.some(
                        (t) => t.compatibility.action === "transcode",
                      )
                    ? "Blocked"
                    : "Stream copy"}
              </dd>
            </dl>
          </div>
          <div className="inspector-section">
            <div className="inspector-title">VALIDATION</div>
            {!source ? (
              <p>Import media to inspect compatibility.</p>
            ) : plan?.errors.length ? (
              <>
                <div className="validation-status bad">
                  <CircleHelp size={16} />
                  {plan.errors.length} items need attention
                </div>
                <button
                  className="text-button"
                  onClick={() => setTab("export")}
                >
                  Review export plan
                  <ChevronRight size={14} />
                </button>
              </>
            ) : (
              <div className="validation-status">
                <ShieldCheck size={17} />{" "}
                {plan
                  ? "Track settings look compatible"
                  : "Checking project..."}
              </div>
            )}
            <p>
              Sources and backend capabilities are checked again when export
              starts.
            </p>
          </div>
          <div className="inspector-note">
            <Layers3 size={21} />
            <p>
              A new container.
              <br />
              <strong>Originals stay intact.</strong>
            </p>
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          {busy || (active ? `Export ${active.status}` : "Ready when you are")}
        </span>
        <div>
          <button
            className="interface-zoom"
            onClick={resetInterfaceZoom}
            aria-label={`Interface zoom ${interfacePercent}%, reset to 100%`}
            title="Interface zoom: Ctrl/Cmd + or -, Ctrl/Cmd+0 to reset"
          >
            {interfacePercent}%
          </button>
          <span>
            {p.container === "matroska" ? "MKV" : p.container.toUpperCase()}
          </span>
          <span>
            {dirty
              ? "Unsaved changes"
              : source
                ? "Project saved"
                : "New project"}
          </span>
          <span>{backend ? "FFmpeg connected" : "Backend not connected"}</span>
        </div>
      </footer>
      <datalist id="languages">
        {languages.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <DownloadPrompt
        pending={pendingResource}
        targetName={p.name}
        busy={!!busy}
        onImport={importResource}
        onDismiss={dismissResource}
      />
      {settings && (
        <dialog
          ref={settingsDialog}
          className="settings-dialog"
          aria-labelledby="settings-title"
          onCancel={() => setSettings(false)}
          onClose={() => setSettings(false)}
        >
          <div className="section-heading">
            <h2 id="settings-title">Make yourself at home</h2>
            <button
              autoFocus
              onClick={() => setSettings(false)}
              aria-label="Close settings"
            >
              <X size={20} />
            </button>
          </div>
          <label>
            Appearance
            <select
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value);
                void run("Saving preference", () =>
                  call("settings_update", {
                    key: "theme",
                    value: e.target.value,
                  }),
                );
              }}
            >
              <option value="system">Follow system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <div className="theme-icons">
            <Sun size={17} />
            <Moon size={17} />
            <span>Stored locally in SQLite</span>
          </div>
          <h3>
            Files & folders{" "}
            <StudioInfo
              title="Files and folders"
              text="Defaults to your operating system's Videos folder. Save an existing folder to use it immediately for media, project, artwork, subtitle and export file dialogs. Unavailable folders fall back to Videos. Existing files, application caches and model storage are not moved."
            />
          </h3>
          <label>
            Default folder
            <input
              value={defaultFolder}
              placeholder="Your Videos folder"
              spellCheck={false}
              onChange={(event) => {
                setDefaultFolder(event.target.value);
                setFolderError("");
              }}
            />
          </label>
          <div className="subtitle-editor-toolbar">
            <button
              disabled={!desktop || !!busy}
              onClick={() =>
                void run("Choosing default folder", async () => {
                  try {
                    const folder = await call<string | null>(
                      "settings_choose_folder",
                    );
                    if (folder) setDefaultFolder(folder);
                    setFolderError("");
                  } catch (e) {
                    setFolderError(e instanceof Error ? e.message : String(e));
                  }
                })
              }
            >
              Browse folder
            </button>
            <button
              disabled={
                !desktop ||
                !!busy ||
                !defaultFolder ||
                defaultFolder === savedFolder
              }
              onClick={() =>
                void run("Saving default folder", async () => {
                  try {
                    await call("settings_update", {
                      key: "default_folder",
                      value: defaultFolder,
                    });
                    setSavedFolder(defaultFolder);
                    setNotice(
                      "Default folder saved. File dialogs use it immediately.",
                    );
                    setSettings(false);
                  } catch (e) {
                    setFolderError(e instanceof Error ? e.message : String(e));
                  }
                })
              }
            >
              Save default folder
            </button>
            <button
              disabled={!desktop || !!busy}
              onClick={() =>
                void run("Resetting default folder", async () => {
                  try {
                    await call("settings_update", {
                      key: "default_folder",
                      value: null,
                    });
                    const result = await call<{ default_folder: string }>(
                      "settings_get",
                    );
                    setSavedFolder(result.default_folder);
                    setDefaultFolder(result.default_folder);
                    setFolderError("");
                  } catch (e) {
                    setFolderError(e instanceof Error ? e.message : String(e));
                  }
                })
              }
            >
              Reset to Videos
            </button>
          </div>
          {folderError && (
            <p role="alert" className="error">
              {folderError}
            </p>
          )}
          <label>
            Default image format
            <select
              value={imageFormat}
              disabled={!desktop || !!busy}
              onChange={(event) => {
                const format = event.target.value;
                void run("Saving image format", async () => {
                  try {
                    await call("settings_update", {
                      key: "image_format",
                      value: format,
                    });
                    setImageFormat(format);
                    setFolderError("");
                  } catch (e) {
                    setFolderError(e instanceof Error ? e.message : String(e));
                  }
                });
              }}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <h3>Required components</h3>
          <p>
            {dependencies.checking
              ? "Checking required components..."
              : dependencies.report?.missing_components.length
                ? "Components need attention; use the repair control in the workspace."
                : "Required components verified."}
          </p>
          <button
            className="secondary"
            disabled={!!busy}
            onClick={recheckDependencies}
          >
            Check required components
          </button>
          {dependencies.report?.repair_supported && (
            <button
              className="secondary"
              disabled={!!busy}
              onClick={repairDependencies}
            >
              Install or repair components
            </button>
          )}
          <h3>Media backend</h3>
          <p>
            {backend?.ffmpeg_version ||
              "FFmpeg not connected. Install FFmpeg and make it available on PATH, or configure it here."}
          </p>
          <label>
            FFmpeg executable (absolute path)
            <input
              value={ffmpeg}
              onChange={(e) => setFfmpeg(e.target.value)}
              placeholder="/usr/bin/ffmpeg"
            />
          </label>
          <label>
            FFprobe executable (absolute path)
            <input
              value={ffprobe}
              onChange={(e) => setFfprobe(e.target.value)}
              placeholder="/usr/bin/ffprobe"
            />
          </label>
          <button
            className="secondary"
            onClick={() =>
              void run("Saving backend paths", async () => {
                await call("settings_update", {
                  key: "backend",
                  value: { ffmpeg, ffprobe },
                });
                setNotice("Backend paths saved. Restart Reelio to apply them.");
                setSettings(false);
              })
            }
          >
            Save backend paths
          </button>
          <p className="inset-note">
            New project and Open project are available in the toolbar's Project
            menu. Reelio is a developer preview; metadata provider APIs, full
            batch scheduling remain unavailable. No account or network access is
            required for local editing.
          </p>
        </dialog>
      )}
    </Tabs.Root>
  );
}
