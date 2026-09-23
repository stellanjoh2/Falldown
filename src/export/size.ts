export const SIZE_PRESETS = ["screen", "1080p", "1440p", "2160p"] as const;
export type SizePreset = (typeof SIZE_PRESETS)[number];

export const GIF_PRESETS = ["480p", "720p"] as const;
export type GifPreset = (typeof GIF_PRESETS)[number];

export type FrameRate = 30 | 60;
export type LoopCount = 1 | 2;

const SHORT_SIDE: Record<Exclude<SizePreset, "screen"> | GifPreset, number> = {
  "1080p": 1080,
  "1440p": 1440,
  "2160p": 2160,
  "480p": 480,
  "720p": 720,
};

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function devicePixels(): number {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
}

export function frameSize(
  stageWidth: number,
  stageHeight: number,
  preset: SizePreset | GifPreset,
): { width: number; height: number } {
  if (preset === "screen") {
    const ratio = devicePixels();
    return { width: even(stageWidth * ratio), height: even(stageHeight * ratio) };
  }
  const shortSide = SHORT_SIDE[preset];
  if (stageWidth < 2 || stageHeight < 2) return { width: even(shortSide), height: even(shortSide) };
  if (stageHeight > stageWidth && Math.abs(stageWidth / stageHeight - 9 / 16) < 0.02) {
    const width = even(shortSide);
    return { width, height: even((width * 16) / 9) };
  }
  if (stageWidth >= stageHeight) {
    const height = even(shortSide);
    return { width: even((stageWidth / stageHeight) * height), height };
  }
  const width = even(shortSide);
  return { width, height: even((stageHeight / stageWidth) * width) };
}
