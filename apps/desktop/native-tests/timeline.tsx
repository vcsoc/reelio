import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Timeline } from "../src/features/timeline/Timeline";
import { emptyProject, addAsset } from "../src/stores/projectStore";
import { timelineViewportDuration } from "../src/features/timeline/geometry";
import "../src/app/styles.css";

const send = (message: unknown) =>
  (window as any).webkit.messageHandlers.result.postMessage(
    JSON.stringify(message),
  );
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
function fixture(tiny: boolean) {
  const p = addAsset(emptyProject(), {
    id: "native-fixture",
    path: "/synthetic/fixture.mkv",
    format: "matroska",
    size: 1,
    modified_ms: 1,
    duration_ms: 9029354,
    streams: [
      {
        index: 0,
        kind: "video",
        codec: "h264",
        duration_ms: 13931,
        title: "Video",
        language: "und",
        default: true,
        forced: false,
        properties: {},
      },
      {
        index: 1,
        kind: "subtitle",
        codec: "subrip",
        duration_ms: 9029354,
        title: "Subtitle",
        language: "und",
        default: true,
        forced: false,
        properties: {},
      },
      ...(tiny
        ? [
            {
              index: 2,
              kind: "audio" as const,
              codec: "aac",
              duration_ms: 9029354,
              title: "Excluded reference",
              language: "und",
              default: false,
              forced: false,
              properties: {},
            },
          ]
        : []),
    ],
    metadata: {},
    chapters: [],
  });
  p.tracks[1].trim_end_ms = 18070;
  if (tiny) p.tracks[2].enabled = false;
  return p;
}
function Harness() {
  const [p, setProject] = useState(() => fixture(false));
  const [patches, setPatches] = useState(0);
  const [playhead, seek] = useState(7000);
  (window as any).fixtureDebug = { trim: p.tracks[1].trim_end_ms, patches };
  useEffect(() => {
    void frame().then(() => send({ kind: "ready" }));
  }, []);
  (window as any).prepareNativeDrag = async (tiny: boolean) => {
    setProject(fixture(tiny));
    setPatches(0);
    await frame();
    await frame();
    const lane = document.querySelectorAll<HTMLElement>(".timeline-lane")[1];
    const handle = lane.querySelector<HTMLElement>(".trim-end")!;
    handle.scrollIntoView();
    await frame();
    const viewport = lane.querySelector<HTMLElement>(".lane-viewport")!;
    const zoom = Number(viewport.dataset.zoom);
    const scale =
      (viewport.clientWidth / timelineViewportDuration(fixture(tiny))) * zoom;
    const rect = handle.getBoundingClientRect();
    const x = rect.left + rect.width / 2,
      y = rect.top + rect.height / 2;
    assert(
      tiny || timelineViewportDuration(p) < 25000,
      "trimmed long subtitle still expands the viewport",
    );
    send({
      kind: "drag",
      innerWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio,

      tiny,
      start: [x, y],
      end: [tiny ? x + 5 : x + (13931 - 18070) * scale + 3, y],
    });
  };
  (window as any).checkNativeDrag = async (tiny: boolean) => {
    await frame();
    assert(
      p.tracks[1].trim_end_ms === 13931,
      `native ${tiny ? "minimum-width" : "retained"} drag failed: ${p.tracks[1].trim_end_ms}`,
    );
    assert(
      patches === 1,
      `native drag created ${patches} edits instead of one`,
    );
    assert(
      p.tracks[1].offset_ms === 0 && !p.tracks[1].trim_start_ms,
      "native drag changed source origin",
    );
    if (!tiny) {
      await (window as any).prepareNativeDrag(true);
      return;
    }
    const viewport = document.querySelector<HTMLElement>(".lane-viewport")!;
    const point = viewport.getBoundingClientRect();
    const pointer = point.width * 0.6;
    const duration = timelineViewportDuration(p);
    const at = () =>
      (viewport.scrollLeft + pointer) /
      ((viewport.clientWidth / duration) * Number(viewport.dataset.zoom));
    const original = at();
    document.addEventListener(
      "wheel",
      (event) =>
        send({
          kind: "wheel-coordinate",
          requested: point.left + pointer,
          actual: event.clientX,
          left: point.left,
        }),
      { once: true },
    );
    const before = {
      pointer,
      original,
      scroll: viewport.scrollLeft,
      viewScroll: viewport.dataset.viewScroll,
      width: viewport.clientWidth,
      rectWidth: point.width,
      zoom: viewport.dataset.zoom,
    };
    for (let i = 0; i < 8; i++)
      viewport.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          altKey: true,
          deltaY: -25,
          clientX: point.left + pointer,
          clientY: point.top + 10,
        }),
      );
    await frame();
    await frame();
    const pixelDrift =
      ((Math.abs(at() - original) * viewport.clientWidth) / duration) *
      Number(viewport.dataset.zoom);
    send({
      kind: "zoom",
      before,
      after: {
        scroll: viewport.scrollLeft,
        viewScroll: viewport.dataset.viewScroll,
        zoom: viewport.dataset.zoom,
      },
      pixelDrift,
    });
    assert(
      pixelDrift < 2,
      `native WebKit cursor zoom drift: ${pixelDrift} pixels`,
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 0,
        clientY: 0,
        bubbles: true,
      }),
    );
    document
      .querySelector<HTMLButtonElement>('[aria-label="Zoom timeline in"]')!
      .click();
    await frame();
    await frame();
    const marker = viewport
      .querySelector<HTMLElement>(".lane-playhead")!
      .getBoundingClientRect();
    assert(
      marker.left >= point.left - 1 && marker.left < point.right,
      "native playback marker left the viewport",
    );
    send({
      kind: "passed",
      message:
        "physical Wayland drags snap retained and minimum-width clips; one edit each; WebKit cursor zoom and marker fallback pass",
      pixelDrift,
    });
  };
  return (
    <div style={{ height: "95vh", display: "flex", flexDirection: "column" }}>
      <Timeline
        project={p}
        playhead={playhead}
        seek={seek}
        select={() => {}}
        patch={(id, changes) => {
          setPatches((value) => value + 1);
          setProject((value) => ({
            ...value,
            tracks: value.tracks.map((track) =>
              track.id === id ? { ...track, ...changes } : track,
            ),
          }));
        }}
        chapter={() => {}}
        addChapter={() => {}}
        addAsset={() => {}}
      />
    </div>
  );
}
for (const type of ["pointerdown", "pointerup"])
  document.addEventListener(
    type,
    (event) => {
      const e = event as PointerEvent;
      send({
        kind: "input",
        type,
        x: e.clientX,
        y: e.clientY,
        target: (e.target as HTMLElement).className,
        button: e.button,
      });
    },
    true,
  );
createRoot(document.getElementById("root")!).render(<Harness />);
