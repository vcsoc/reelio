import { useEffect } from "react";
import type { RefObject } from "react";
import type { Project } from "../../types";
import { sourceStream } from "../../types";
import { call, desktop } from "../../services/desktop";
import { clipBounds } from "./geometry";

export function useAudioPreview(
  video: RefObject<HTMLVideoElement | null>,
  p: Project,
  sourceId: string | undefined,
  url: string | undefined,
  selected: string | undefined,
  report: (text: string) => void,
) {
  const routingKey = JSON.stringify([
    p.id,
    p.assets.map((a) => [a.id, a.path, a.modified_ms, a.size]),
    p.tracks
      .filter((t) =>
        ["audio", "video"].includes(sourceStream(p, t)?.kind ?? ""),
      )
      .map((t) => [
        t.id,
        t.asset_id,
        t.stream_index,
        t.enabled,
        t.muted,
        t.audio_role,
        t.offset_ms,
        t.trim_start_ms,
        t.trim_end_ms,
      ]),
  ]);
  const auditionId = p.tracks.some(
    (t) =>
      t.id === selected &&
      sourceStream(p, t)?.kind === "audio" &&
      (t.audio_role ?? "separate") === "separate",
  )
    ? selected
    : undefined;
  useEffect(() => {
    const player = video.current;
    if (!desktop || !player || !url) return;
    const active = p.tracks.filter(
      (t) => t.enabled && !t.muted && sourceStream(p, t)?.kind === "audio",
    );
    const audition = active.find(
      (t) => t.id === selected && (t.audio_role ?? "separate") === "separate",
    );
    const mixed = active.filter((t) => t.audio_role === "mix");
    const lanes = audition
      ? [audition]
      : mixed.length
        ? mixed
        : [
            active.find((t) => t.default) ??
              active.find((t) => t.asset_id === sourceId) ??
              active[0],
          ].filter((t) => t !== undefined);
    const sourceOffset =
      p.tracks.find(
        (t) => t.asset_id === sourceId && sourceStream(p, t)?.kind === "video",
      )?.offset_ms ?? 0;
    const previousMuted = player.muted;
    player.muted = true;
    const keepSourceMuted = () => {
      if (!player.muted) player.muted = true;
    };
    player.addEventListener("volumechange", keepSourceMuted);
    let cancelled = false;
    let warned = false;
    const audios: {
      audio: HTMLAudioElement;
      offset: number;
      duration: number;
      start: number;
    }[] = [];
    const fail = (text: string) => {
      if (!cancelled && !warned) {
        warned = true;
        report(text);
      }
    };
    const sync = () => {
      const global = player.currentTime * 1000 + sourceOffset;
      for (const { audio, offset, duration, start } of audios) {
        audio.volume = player.volume / Math.max(1, lanes.length);
        const position = (global - offset) / 1000;
        const shouldPlay =
          !player.paused &&
          !player.ended &&
          position * 1000 >= start &&
          position * 1000 < duration;
        if (!shouldPlay) audio.pause();
        if (
          position * 1000 >= start &&
          position * 1000 < duration &&
          audio.readyState >= 1 &&
          Math.abs(audio.currentTime - position) > 0.12
        )
          audio.currentTime = position;
        audio.playbackRate = player.playbackRate;
        if (shouldPlay && audio.paused)
          void audio
            .play()
            .catch(() =>
              fail(
                "Audio preview could not start. Pause and play again; export mappings are unaffected.",
              ),
            );
      }
    };
    const urls = new Map<string, Promise<string>>();
    const viewerSource = p.assets.find((a) => a.id === sourceId);
    if (viewerSource && lanes.length)
      urls.set(
        viewerSource.path,
        call<string>("preview_source", { path: viewerSource.path }).catch(
          (error) => {
            fail(String(error));
            return url;
          },
        ),
      );
    for (const t of lanes.slice(0, 64)) {
      const asset = p.assets.find((a) => a.id === t.asset_id);
      if (!asset) continue;
      if (!urls.has(asset.path))
        urls.set(
          asset.path,
          call<string>("preview_source", { path: asset.path }),
        );
      void urls
        .get(asset.path)!
        .then((mediaUrl) => {
          if (cancelled) return;
          const audio = new Audio();
          audio.preload = "auto";
          audio.src = mediaUrl;
          audio.volume = player.volume / Math.max(1, lanes.length);
          audio.addEventListener("loadedmetadata", () => {
            const ordinal = asset.streams
              .filter((s) => s.kind === "audio")
              .findIndex((s) => s.index === t.stream_index);
            const tracks = (
              audio as HTMLAudioElement & {
                audioTracks?: {
                  length: number;
                  [index: number]: { enabled: boolean };
                };
              }
            ).audioTracks;
            if (
              asset.streams.filter((s) => s.kind === "audio").length > 1 &&
              !tracks
            ) {
              audio.pause();
              audio.removeAttribute("src");
              fail(
                "This WebView cannot audition individual embedded audio tracks. Export still uses the exact selected stream; external single-stream audio previews normally.",
              );
              return;
            }
            if (tracks)
              for (let i = 0; i < tracks.length; i++)
                tracks[i].enabled = i === ordinal;
            sync();
          });
          audio.addEventListener("error", () =>
            fail(
              "An audio lane cannot be decoded by this WebView. Check the source/codec; export is validated independently.",
            ),
          );
          audios.push({
            audio,
            offset: t.offset_ms,
            duration: clipBounds(p, t).end,
            start: clipBounds(p, t).start,
          });
          audio.load();
          sync();
        })
        .catch((e) => fail(String(e)));
    }
    const events = [
      "play",
      "pause",
      "seeking",
      "seeked",
      "ratechange",
      "ended",
      "timeupdate",
    ];
    for (const event of events) player.addEventListener(event, sync);
    const interval = window.setInterval(sync, 100);
    return () => {
      cancelled = true;
      clearInterval(interval);
      for (const event of events) player.removeEventListener(event, sync);
      player.removeEventListener("volumechange", keepSourceMuted);
      for (const { audio } of audios) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      player.muted = previousMuted;
    };
  }, [video, routingKey, sourceId, url, auditionId, report]);
}
