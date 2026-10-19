import type { ImageEdits } from "../../types";
export function sizeCrop(
  source: { width: number; height: number },
  current: ImageEdits["crop"],
  field: "width" | "height",
  value: number,
  ratio?: number,
): NonNullable<ImageEdits["crop"]> {
  const old = current || { x: 0, y: 0, ...source };
  let width = field === "width" ? value : old.width,
    height = field === "height" ? value : old.height;
  if (ratio) {
    if (field === "width") height = width / ratio;
    else width = height * ratio;
    const scale = Math.min(1, source.width / width, source.height / height);
    width *= scale;
    height *= scale;
  }
  width = Math.min(source.width, Math.max(2, Math.round(width)));
  height = Math.min(source.height, Math.max(2, Math.round(height)));
  return {
    width,
    height,
    x: Math.max(
      0,
      Math.min(
        source.width - width,
        Math.round(old.x + (old.width - width) / 2),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        source.height - height,
        Math.round(old.y + (old.height - height) / 2),
      ),
    ),
  };
}
