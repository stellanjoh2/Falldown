export type CanvasRatio = "16:9" | "9:16";

export type CanvasBox = { x: number; y: number; width: number; height: number };

export type CanvasFrame = CanvasBox & { scale: number };

const PORTRAIT = 9 / 16;

/** Fit a canvas in the work area. 16:9 is the full stage. 9:16 is a portrait frame scaled from a 16:9 of the same height. */
export function canvasFrame(
  stageWidth: number,
  stageHeight: number,
  ratio: CanvasRatio,
  work?: CanvasBox,
): CanvasFrame {
  if (ratio !== "9:16" || stageWidth < 2 || stageHeight < 2) {
    return { x: 0, y: 0, width: stageWidth, height: stageHeight, scale: 1 };
  }
  const area = work ?? { x: 0, y: 0, width: stageWidth, height: stageHeight };
  let width = area.height * PORTRAIT;
  let height = area.height;
  if (width > area.width) {
    width = area.width;
    height = width / PORTRAIT;
  }
  width = Math.max(2, Math.round(width));
  height = Math.max(2, Math.round(height));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
    scale: width / (height * (16 / 9)),
  };
}
