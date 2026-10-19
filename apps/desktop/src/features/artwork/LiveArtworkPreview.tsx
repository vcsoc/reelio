import { useLayoutEffect, useRef, useState } from "react";
import type { Artwork, ImageEdits } from "../../types";

export function adjustPixels(
  data: Uint8ClampedArray,
  edits: Pick<
    ImageEdits,
    "grayscale" | "negative" | "sepia" | "brightness" | "contrast"
  >,
) {
  const channel = (value: number) =>
    Math.max(
      0,
      Math.min(
        255,
        Math.round(
          (Math.max(0, Math.min(255, value)) * edits.brightness - 128) *
            edits.contrast +
            128,
        ),
      ),
    );
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (edits.grayscale) r = g = b = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (edits.negative) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    if (edits.sepia) {
      const red = r,
        green = g,
        blue = b;
      r = red * 0.393 + green * 0.769 + blue * 0.189;
      g = red * 0.349 + green * 0.686 + blue * 0.168;
      b = red * 0.272 + green * 0.534 + blue * 0.131;
    }
    data[i] = channel(r);
    data[i + 1] = channel(g);
    data[i + 2] = channel(b);
  }
}
export function LiveArtworkPreview({
  artwork,
  edits,
}: {
  artwork: Artwork;
  edits: ImageEdits;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [decoded, setDecoded] = useState<{
    source: string;
    image: HTMLImageElement;
  }>();
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    let active = true;
    setFailed(false);
    const image = new Image();
    image.onload = () => {
      if (active) setDecoded({ source: artwork.jpeg, image });
    };
    image.onerror = () => {
      if (active) setFailed(true);
    };
    image.src = `data:image/jpeg;base64,${artwork.jpeg}`;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [artwork.jpeg]);
  const key = JSON.stringify(edits);
  useLayoutEffect(() => {
    if (!canvas.current || decoded?.source !== artwork.jpeg) return;
    const box = edits.crop || {
      x: 0,
      y: 0,
      width: artwork.width,
      height: artwork.height,
    };
    if (box.width < 1 || box.height < 1) return;
    const rotated = edits.rotation % 180 !== 0,
      width = rotated ? box.height : box.width,
      height = rotated ? box.width : box.height;
    const sample = Math.min(1, 1280 / Math.max(width, height));
    const work = document.createElement("canvas");
    work.width = Math.max(1, Math.round(width * sample));
    work.height = Math.max(1, Math.round(height * sample));
    const context = work.getContext("2d");
    if (!context) return;
    context.translate(work.width / 2, work.height / 2);
    context.scale(sample, sample);
    if (edits.flip) context.scale(-1, 1);
    context.rotate((edits.rotation * Math.PI) / 180);
    context.drawImage(
      decoded.image,
      box.x,
      box.y,
      box.width,
      box.height,
      -box.width / 2,
      -box.height / 2,
      box.width,
      box.height,
    );
    if (
      edits.grayscale ||
      edits.negative ||
      edits.sepia ||
      edits.brightness !== 1 ||
      edits.contrast !== 1
    ) {
      const pixels = context.getImageData(0, 0, work.width, work.height);
      adjustPixels(pixels.data, edits);
      context.putImageData(pixels, 0, 0);
    }
    const target = edits.resize || { width, height };
    const scale = Math.min(1, 1280 / Math.max(target.width, target.height));
    canvas.current.width = Math.max(1, Math.round(target.width * scale));
    canvas.current.height = Math.max(1, Math.round(target.height * scale));
    const output = canvas.current.getContext("2d");
    if (output) {
      output.imageSmoothingQuality = "high";
      output.drawImage(work, 0, 0, canvas.current.width, canvas.current.height);
    }
  }, [decoded, artwork.jpeg, key]);
  return (
    <>
      {failed ? (
        <p role="alert">Could not decode the local image preview.</p>
      ) : (
        <canvas
          ref={canvas}
          className="cover-result live-artwork-preview"
          role="img"
          aria-label="Edited cover preview"
          data-edits={key}
        />
      )}
    </>
  );
}
