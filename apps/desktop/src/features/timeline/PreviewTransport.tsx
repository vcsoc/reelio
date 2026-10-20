import { useEffect, useRef, useState, type RefObject } from "react";
import { chapterTime } from "../chapters/timing";
import { SeekScheduler } from "./seekScheduler";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  BookmarkPlus,
  Volume2,
  Gauge,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { playbackSpeeds, previewFrameMs, frameTarget } from "./playback";

type Props = {
  video: RefObject<HTMLVideoElement | null>;
  sourceKey?: string;
  duration: number;
  offset: number;
  sync: (time: number, reveal: boolean) => void;
  frameRate?: string;
  hasVideo?: boolean;
  addChapter?: (time: number) => void;
  chapterDisabled?: boolean;
  previousChapter?: () => void;
  nextChapter?: () => void;
};
export function PreviewTransport({
  video,
  sourceKey,
  duration,
  offset,
  sync,
  frameRate,
  hasVideo = true,
  addChapter,
  chapterDisabled = false,
  previousChapter,
  nextChapter,
}: Props) {
  const [position, setPosition] = useState(0),
    [scrub, setScrub] = useState<number>();
  const [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false),
    [mediaDuration, setMediaDuration] = useState(0),
    [seekError, setSeekError] = useState("");
  const dragging = useRef(false),
    syncRef = useRef(sync),
    offsetRef = useRef(offset),
    frame = useRef<number | undefined>(undefined),
    marker = useRef<number | undefined>(undefined);
  const [speed, setSpeed] = useState<number>(1),
    speedRef = useRef(speed);
  speedRef.current = speed;
  const [volume, setVolume] = useState(0.05),
    volumeRef = useRef(volume);
  syncRef.current = sync;
  offsetRef.current = offset;
  volumeRef.current = volume;
  const end = duration > 0 ? duration : mediaDuration;
  const scheduler = useRef<SeekScheduler | null>(null);
  if (!scheduler.current)
    scheduler.current = new SeekScheduler((time) => {
      const el = video.current;
      if (!el || el.readyState < 1) return;
      try {
        if (Math.abs(el.currentTime * 1000 - time) > 0.5)
          el.currentTime = time / 1000;
      } catch (error) {
        setSeekError(`Seeking failed: ${String(error)}`);
      }
    });
  const seek = (value: number, final = false) => {
    const time = Math.max(0, Math.min(end, value));
    if (!Number.isFinite(time)) return;
    setSeekError("");
    setScrub(time);
    scheduler.current!.request(time, final);
    marker.current = Math.max(0, time + offsetRef.current);
    if (final) {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      syncRef.current(marker.current, true);
    } else if (frame.current === undefined)
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        if (marker.current !== undefined) syncRef.current(marker.current, true);
      });
  };
  const at = (event: React.PointerEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.round(
      Math.max(
        0,
        Math.min(
          1,
          (event.clientX - rect.left - 6) / Math.max(1, rect.width - 12),
        ),
      ) * end,
    );
  };
  const finish = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const target = scheduler.current!.latest;
    if (target !== undefined) seek(target, true);
  };
  useEffect(() => {
    const el = video.current;
    scheduler.current!.reset();
    dragging.current = false;
    setScrub(undefined);
    setPosition(0);
    setReady(false);
    setPlaying(false);
    setMediaDuration(0);
    setSeekError("");
    if (!el) return;
    el.volume = volumeRef.current;
    try {
      el.playbackRate = speedRef.current;
    } catch {
      setSpeed(el.playbackRate);
    }
    const update = () => {
      setReady(el.readyState >= 1 && !el.error);
      setPlaying(!el.paused);
      setSpeed(el.playbackRate);
      setMediaDuration(
        Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0,
      );
      const time = Math.round(el.currentTime * 1000);
      if (
        !dragging.current &&
        scheduler.current!.settle(time, el.seeking, !el.paused)
      ) {
        setPosition(time);
        setScrub(undefined);
        syncRef.current(Math.max(0, time + offsetRef.current), false);
      }
    };
    const events = [
      "timeupdate",
      "seeking",
      "seeked",
      "play",
      "pause",
      "loadedmetadata",
      "durationchange",
      "ratechange",
      "loadeddata",
      "error",
    ];
    events.forEach((event) => el.addEventListener(event, update));
    update();
    return () => {
      events.forEach((event) => el.removeEventListener(event, update));
      scheduler.current!.reset();
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      marker.current = undefined;
    };
  }, [video, sourceKey, offset]);
  return (
    <div
      className="preview-transport"
      aria-label="Preview transport"
      onKeyDown={(event) => {
        if (
          event.code === "Space" &&
          (event.target as HTMLElement).closest("button")
        )
          event.stopPropagation();
      }}
    >
      <input
        className="preview-seek"
        type="range"
        aria-label="Preview seek bar"
        title="Drag to seek; all timeline markers follow immediately"
        min={0}
        max={Math.max(1, end)}
        step={1}
        value={Math.min(scrub ?? position, Math.max(1, end))}
        disabled={!ready}
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          seek(at(event));
        }}
        onPointerMove={(event) => {
          if (dragging.current) seek(at(event));
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          seek(at(event), true);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onBlur={finish}
        onInput={(event) => {
          if (!dragging.current) seek(Number(event.currentTarget.value), true);
        }}
        onChange={(event) => {
          if (!dragging.current) seek(Number(event.currentTarget.value), true);
        }}
      />
      <div className="preview-transport-buttons">
        <span className="preview-clock">
          {chapterTime(scrub ?? position)} / {chapterTime(end)}
        </span>
        <button
          disabled={!ready}
          className="preview-icon-button"
          title={playing ? "Pause preview" : "Play preview"}
          aria-label={playing ? "Pause preview" : "Play preview"}
          onClick={() => {
            const el = video.current;
            if (!el) return;
            if (el.paused)
              void el.play().catch((error) => {
                setPlaying(false);
                if (error?.name !== "AbortError")
                  setSeekError(`Playback failed: ${String(error)}`);
              });
            else el.pause();
          }}
        >
          {playing ? (
            <Pause size={16} aria-hidden="true" />
          ) : (
            <Play size={16} aria-hidden="true" />
          )}
        </button>
        <button
          className="preview-icon-button"
          title="Stop preview and return to beginning"
          aria-label="Stop preview"
          disabled={!ready}
          onClick={() => {
            video.current?.pause();
            seek(0, true);
          }}
        >
          <Square size={15} aria-hidden="true" />
        </button>
        <button
          className="preview-icon-button"
          title="Skip to beginning"
          aria-label="Skip to beginning"
          disabled={!ready}
          onClick={() => seek(0, true)}
        >
          <SkipBack size={16} aria-hidden="true" />
        </button>
        {([-1, 1] as const).map((direction) => (
          <button
            key={direction}
            className="preview-icon-button"
            title={`${direction < 0 ? "Previous" : "Next"} frame (nominal source rate; 25 fps fallback)`}
            aria-label={direction < 0 ? "Previous frame" : "Next frame"}
            disabled={!ready || !hasVideo}
            onClick={() => {
              const el = video.current;
              if (!el) return;
              el.pause();
              seek(
                frameTarget(
                  scheduler.current!.latest ?? el.currentTime * 1000,
                  direction,
                  previewFrameMs(frameRate),
                  end,
                ),
                true,
              );
            }}
          >
            {direction < 0 ? (
              <StepBack size={16} aria-hidden="true" />
            ) : (
              <StepForward size={16} aria-hidden="true" />
            )}
          </button>
        ))}
        <button
          className="preview-icon-button"
          title="Skip to end"
          aria-label="Skip to end"
          disabled={!ready}
          onClick={() => seek(end, true)}
        >
          <SkipForward size={16} aria-hidden="true" />
        </button>
        <button
          className="preview-icon-button"
          title="Add chapter marker at playhead"
          aria-label="Add chapter marker at playhead"
          disabled={!ready || !addChapter || chapterDisabled}
          onClick={() =>
            addChapter?.(
              Math.max(
                0,
                (scheduler.current!.latest ??
                  (video.current?.currentTime ?? 0) * 1000) + offsetRef.current,
              ),
            )
          }
        >
          <BookmarkPlus size={16} aria-hidden="true" />
        </button>
        <button
          className="preview-icon-button"
          title="Previous chapter"
          aria-label="Previous chapter"
          disabled={!ready || !previousChapter}
          onClick={previousChapter}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          className="preview-icon-button"
          title="Next chapter"
          aria-label="Next chapter"
          disabled={!ready || !nextChapter}
          onClick={nextChapter}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <label
          className="preview-speed"
          title={`Playback speed: ${speed}x (preview only)`}
        >
          <Gauge size={15} aria-hidden="true" />
          <input
            type="range"
            aria-label="Preview playback speed"
            disabled={!ready}
            aria-valuetext={`${speed}x`}
            min={0}
            max={playbackSpeeds.length - 1}
            step={1}
            value={Math.max(
              0,
              playbackSpeeds.findIndex((value) => value === speed),
            )}
            onChange={(event) => {
              const rate = playbackSpeeds[Number(event.currentTarget.value)];
              const el = video.current;
              if (!el || rate === undefined) return;
              try {
                el.playbackRate = rate;
                setSpeed(el.playbackRate);
                setSeekError("");
              } catch {
                setSeekError(
                  `This playback engine does not support ${rate}x speed.`,
                );
              }
            }}
          />
          <span>{speed}x</span>
        </label>
        <label className="preview-volume" title="Preview volume">
          <Volume2 size={15} aria-hidden="true" />
          <input
            type="range"
            aria-label="Preview volume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setVolume(value);
              if (video.current) video.current.volume = value;
            }}
          />
          <span className="preview-volume-value">
            {Math.round(volume * 100)}%
          </span>
        </label>
        <small>Seek: sync timelines</small>
      </div>
      {seekError && (
        <p className="error" role="alert">
          {seekError}
        </p>
      )}
    </div>
  );
}
