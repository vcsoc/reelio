import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PreviewTransport } from "../src/features/timeline/PreviewTransport";
import "../src/app/styles.css";
const send = (message: unknown) =>
  (window as any).webkit.messageHandlers.result.postMessage(
    JSON.stringify(message),
  );
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const wait = async (check: () => boolean) => {
  const deadline = performance.now() + 12000;
  while (!check()) {
    if (performance.now() > deadline)
      throw Error("Native transport condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const assert = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
function Harness() {
  const video = useRef<HTMLVideoElement>(null),
    [marker, setMarker] = useState(0),
    [chapter, setChapter] = useState<number>();
  const media = new URLSearchParams(location.search).get("media") || "";
  const decoded = useRef({ time: -1, frames: 0 }),
    samples = useRef<number[]>([]),
    before = useRef(0);
  useEffect(() => {
    const el = video.current!;
    let active = true;
    const onFrame: VideoFrameRequestCallback = (_, info) => {
      decoded.current = {
        time: info.mediaTime,
        frames: decoded.current.frames + 1,
      };
      if (active) el.requestVideoFrameCallback(onFrame);
    };
    el.requestVideoFrameCallback(onFrame);
    const sample = () =>
      samples.current.push(
        Number(
          document.querySelector<HTMLInputElement>(".preview-seek")!.value,
        ),
      );
    document.addEventListener("pointermove", sample);
    void wait(
      () =>
        el.readyState >= 2 &&
        !document.querySelector<HTMLInputElement>(".preview-seek")!.disabled,
    )
      .then(() => send({ kind: "ready" }))
      .catch((error) => send({ kind: "failed", message: String(error) }));
    return () => {
      active = false;
      document.removeEventListener("pointermove", sample);
    };
  }, []);
  (window as any).prepareNativeDrag = async (second: boolean) => {
    await frame();
    samples.current = [];
    before.current = decoded.current.frames;
    const rect = document
      .querySelector<HTMLInputElement>(".preview-seek")!
      .getBoundingClientRect();
    const point = (fraction: number) => [
      rect.left + 6 + (rect.width - 12) * fraction,
      rect.top + rect.height / 2,
    ];
    send({
      kind: "drag",
      tiny: second,
      innerWidth,
      devicePixelRatio,
      start: point(second ? 0.75 : 0.2),
      end: point(second ? 0.15 : 0.75),
    });
  };
  (window as any).checkNativeDrag = async (second: boolean) => {
    const el = video.current!,
      bar = document.querySelector<HTMLInputElement>(".preview-seek")!,
      target = Number(bar.value) / 1000;
    await wait(
      () =>
        decoded.current.frames > before.current &&
        Math.abs(decoded.current.time - target) < 0.075 &&
        !el.seeking,
    );
    await frame();
    assert(
      Math.abs(target - el.duration * (second ? 0.15 : 0.75)) < 0.05,
      "Thumb missed the physical release location",
    );
    assert(
      Math.abs(el.currentTime - target) < 0.075,
      "Decoded seek did not commit the latest target",
    );
    assert(
      Math.abs(
        Number(
          document.querySelector<HTMLElement>("#output-marker")!.dataset.time,
        ) -
          Number(bar.value) -
          1200,
      ) < 5,
      "Output marker lost its source offset",
    );
    assert(
      new Set(samples.current).size >= 6,
      `Thumb did not move continuously: ${JSON.stringify(samples.current)}`,
    );
    send({
      kind: "transport-evidence",
      target,
      actual: el.currentTime,
      decoded: decoded.current,
      distinctThumbPositions: new Set(samples.current).size,
      paused: el.paused,
    });
    if (!second) await (window as any).prepareNativeDrag(true);
    else {
      const initial = decoded.current.time;
      let count = decoded.current.frames;
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Next frame"]')!
        .click();
      await wait(() => decoded.current.frames > count && !el.seeking);
      assert(
        Math.abs(decoded.current.time - initial - 1 / 30) < 0.002,
        "Next-frame control did not decode the adjacent 30 fps frame",
      );
      count = decoded.current.frames;
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Previous frame"]',
        )!
        .click();
      await wait(() => decoded.current.frames > count && !el.seeking);
      assert(
        Math.abs(decoded.current.time - initial) < 0.002,
        "Previous-frame control did not return to the original decoded frame",
      );
      send({
        kind: "frame-controls-evidence",
        initial,
        decoded: decoded.current,
      });
      send({
        kind: "passed",
        message:
          "Physical forward/backward scrubbing and frame buttons commit real paused decoded frames; markers preserve source offset",
      });
    }
  };
  return (
    <main style={{ maxWidth: 900, padding: 24, margin: "auto" }}>
      <h2>Owned native transport regression</h2>
      <video
        ref={video}
        src={media}
        muted
        preload="auto"
        width={640}
        height={360}
        style={{ display: "block", maxWidth: "100%", margin: "auto" }}
      />
      <PreviewTransport
        video={video}
        sourceKey={media}
        duration={8000}
        frameRate={new URLSearchParams(location.search).get("fps") || undefined}
        offset={1200}
        sync={(time) => setMarker(time)}
        addChapter={setChapter}
      />
      <output id="chapter-marker">{chapter}</output>
      <output id="output-marker" data-time={marker}>
        Output marker: {marker} ms
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
