import { backgroundImage, isSvgLogo, paintBackdrop, paintLogo } from "../background";
import { gradientEnd, gradientLine, pillGradientStops } from "../pillFill";
import type { CanvasRatio } from "../canvas";
import { EMOJI_FONT } from "../emojis";
import { peekTrim } from "../trim";
import { canvasBlend, type BackgroundSettings, type ImageSlot, type PostSettings, type TextSlot } from "../types";
import { isColorMask, type ChipDraw } from "../world";

const GRAIN_URL =
  "data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

const images = new Map<string, Promise<HTMLImageElement | null>>();
const maskCanvas = document.createElement("canvas");
const chipBuffer = document.createElement("canvas");
const bloomBuffer = document.createElement("canvas");
const grainTile = document.createElement("canvas");

export type PaintScene = {
  width: number;
  height: number;
  stageWidth: number;
  stageHeight: number;
  stageColor: string;
  background: BackgroundSettings;
  canvas: CanvasRatio;
  theme: string[];
  post: PostSettings;
  transparent: boolean;
};

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  let pending = images.get(src);
  if (!pending) {
    pending = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    images.set(src, pending);
  }
  return pending;
}

function imageSrc(slot: ImageSlot): string {
  return peekTrim(slot.src)?.displaySrc ?? slot.src;
}

async function preload(draws: ChipDraw[], post: PostSettings): Promise<Map<string, HTMLImageElement>> {
  const ready = new Map<string, HTMLImageElement>();
  const srcs = new Set<string>();
  for (const chip of draws) {
    if (chip.slot.kind === "image" && !chip.slot.emoji) srcs.add(imageSrc(chip.slot));
  }
  await Promise.all(
    [...srcs].map(async (src) => {
      const img = await loadImage(src);
      if (img) ready.set(src, img);
    }),
  );
  if (post.grain > 0) await loadImage(GRAIN_URL);
  return ready;
}

function buffer(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Export failed");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

function withChip(ctx: CanvasRenderingContext2D, chip: ChipDraw, scale: number, draw: () => void) {
  const originX = (chip.width / 2 - chip.anchorX) * scale;
  const originY = (chip.height / 2 - chip.anchorY) * scale;
  ctx.save();
  ctx.translate(chip.x * scale, chip.y * scale);
  ctx.rotate(chip.angle);
  ctx.translate(-originX, -originY);
  draw();
  ctx.restore();
}

function round(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, Math.max(0, Math.min(radius, width / 2, height / 2)));
}

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, width: number, height: number) {
  const ratio = img.width / img.height;
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  const box = width / height;
  const dw = ratio > box ? width : height * ratio;
  const dh = ratio > box ? width / ratio : height;
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

function drawMask(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  fill: string,
  width: number,
  height: number,
  to = "",
  angle?: number,
) {
  const sw = Math.max(1, Math.round(width));
  const sh = Math.max(1, Math.round(height));
  maskCanvas.width = sw;
  maskCanvas.height = sh;
  const scratch = maskCanvas.getContext("2d");
  if (!scratch) return;
  if (to) {
    const line = gradientLine(sw, sh, angle);
    const gradient = scratch.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
    for (const stop of pillGradientStops(fill, to)) gradient.addColorStop(stop.at, stop.color);
    scratch.fillStyle = gradient;
  } else {
    scratch.fillStyle = fill;
  }
  scratch.fillRect(0, 0, sw, sh);
  scratch.globalCompositeOperation = "destination-in";
  drawContain(scratch, img, sw, sh);
  ctx.drawImage(maskCanvas, 0, 0, width, height);
}

function drawGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
  from: string,
  to: string,
  angle?: number,
) {
  ctx.save();
  round(ctx, width, height, radius);
  ctx.clip();
  const line = gradientLine(width, height, angle);
  const gradient = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
  for (const stop of pillGradientStops(from, to)) gradient.addColorStop(stop.at, stop.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  chip: ChipDraw,
  slot: TextSlot,
  width: number,
  height: number,
  scale: number,
  bloom: boolean,
  theme: string[],
) {
  const radius = chip.radius * scale;
  const ring = slot.stroked && slot.shape !== "none";
  const bare = slot.shape === "none";
  const gradient = Boolean(slot.gradient) && !bare && !ring;
  if (gradient) drawGradient(ctx, width, height, radius, chip.fill, gradientEnd(theme, slot), slot.gradientAngle);
  else if (!bare && !ring) {
    round(ctx, width, height, radius);
    ctx.fillStyle = chip.fill;
    ctx.fill();
  }
  if (ring) {
    ctx.save();
    round(ctx, width, height, radius);
    ctx.clip();
    round(ctx, width, height, radius);
    ctx.lineWidth = Math.max(1, slot.stroke) * scale * 2;
    ctx.strokeStyle = chip.fill;
    ctx.stroke();
    ctx.restore();
  }
  if (bloom && !bare) return;
  ctx.font = `${slot.fontWeight} ${slot.fontSize * scale}px "${slot.fontFamily}", sans-serif`;
  ctx.fillStyle = chip.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = `${chip.tracking}em`;
  ctx.fillText(slot.text || "", width / 2, height / 2 + chip.shiftEm * slot.fontSize * scale);
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  chip: ChipDraw,
  scale: number,
  bloom: boolean,
  ready: Map<string, HTMLImageElement>,
  theme: string[],
) {
  const width = chip.width * scale;
  const height = chip.height * scale;
  if (width < 1 || height < 1) return;
  withChip(ctx, chip, scale, () => {
    const slot = chip.slot;
    if (slot.kind === "text") {
      drawText(ctx, chip, slot, width, height, scale, bloom, theme);
      return;
    }
    if (slot.emoji) {
      ctx.font = `${slot.size * scale}px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(slot.emoji, width / 2, height / 2);
      return;
    }
    const img = ready.get(imageSrc(slot));
    if (!img) return;
    if (isColorMask(slot)) {
      drawMask(ctx, img, chip.fill, width, height, slot.gradient ? gradientEnd(theme, slot) : "", slot.gradientAngle);
    }
    else drawContain(ctx, img, width, height);
  });
}

async function grainImage(): Promise<HTMLImageElement | null> {
  return loadImage(GRAIN_URL);
}

function paintVignette(ctx: CanvasRenderingContext2D, width: number, height: number, amount: number) {
  if (amount <= 0) return;
  const alpha = amount / 140;
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(width / 2, height / 2);
  const corner = Math.SQRT2;
  const gradient = ctx.createRadialGradient(0, 0, corner * 0.42, 0, 0, corner);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, `rgba(0, 0, 0, ${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

export async function paintFrame(canvas: HTMLCanvasElement, draws: ChipDraw[], scene: PaintScene): Promise<void> {
  const ready = await preload(draws, scene.post);
  if (canvas.width !== scene.width || canvas.height !== scene.height) {
    canvas.width = scene.width;
    canvas.height = scene.height;
  }
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!ctx) throw new Error("Export failed");
  const scaleX = scene.stageWidth > 0 ? scene.width / scene.stageWidth : 1;
  const scaleY = scene.stageHeight > 0 ? scene.height / scene.stageHeight : 1;
  const scale = Math.min(scaleX, scaleY);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.clearRect(0, 0, scene.width, scene.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (!scene.transparent) {
    const file = scene.background.kind === "image" ? backgroundImage(scene.background.imageId) : null;
    const backdrop = file ? await loadImage(file.src) : null;
    paintBackdrop(ctx, scene.width, scene.height, scene.stageColor, scene.background, scene.canvas, backdrop);
  }
  const logoFile = backgroundImage(scene.background.logoId);
  const logo = logoFile ? await loadImage(logoFile.src) : null;
  paintLogo(ctx, scene.width, scene.height, scene.background, scene.theme, logo);

  const blend = canvasBlend(scene.post.blend);
  const isolate = blend !== "source-over";
  const pile = isolate ? buffer(chipBuffer, scene.width, scene.height) : ctx;

  const saturate = scene.post.saturate / 100;
  if (saturate !== 1) {
    const layer = buffer(bloomBuffer, scene.width, scene.height);
    for (const chip of draws) drawChip(layer, chip, scale, false, ready, scene.theme);
    pile.save();
    pile.filter = `saturate(${saturate})`;
    pile.drawImage(bloomBuffer, 0, 0);
    pile.restore();
  } else {
    for (const chip of draws) drawChip(pile, chip, scale, false, ready, scene.theme);
  }

  const bloom = scene.post.bloom / 100;
  const bloomOpacity = (scene.post.bloomOpacity / 100) * bloom;
  if (bloom > 0 && bloomOpacity > 0) {
    const layer = buffer(bloomBuffer, scene.width, scene.height);
    for (const chip of draws) drawChip(layer, chip, scale, true, ready, scene.theme);
    if (logo && logoFile && isSvgLogo(logoFile.name, logoFile.src)) {
      paintLogo(layer, scene.width, scene.height, scene.background, scene.theme, logo);
    }
    pile.save();
    pile.filter = `blur(${bloom * 48 * scale}px)`;
    pile.globalAlpha = bloomOpacity;
    pile.globalCompositeOperation = "lighter";
    pile.drawImage(bloomBuffer, 0, 0);
    pile.restore();
  }

  if (isolate) {
    ctx.save();
    ctx.globalCompositeOperation = blend;
    ctx.drawImage(chipBuffer, 0, 0);
    ctx.restore();
  }

  if (!scene.transparent && scene.post.grain > 0) {
    const grain = await grainImage();
    if (grain) {
      const tile = Math.max(1, Math.round(180 * scale));
      grainTile.width = tile;
      grainTile.height = tile;
      const tileCtx = grainTile.getContext("2d");
      if (tileCtx) {
        tileCtx.clearRect(0, 0, tile, tile);
        tileCtx.drawImage(grain, 0, 0, tile, tile);
        const sized = ctx.createPattern(grainTile, "repeat");
        if (sized) {
          ctx.save();
          ctx.globalCompositeOperation = "overlay";
          ctx.globalAlpha = scene.post.grain / 100;
          ctx.fillStyle = sized;
          ctx.fillRect(0, 0, scene.width, scene.height);
          ctx.restore();
        }
      }
    }
  }

  if (!scene.transparent) paintVignette(ctx, scene.width, scene.height, scene.post.vignette);

  const hue = Math.round(scene.post.hue ?? 0);
  if (hue % 360 !== 0) {
    const layer = buffer(bloomBuffer, scene.width, scene.height);
    layer.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.filter = `hue-rotate(${hue}deg)`;
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(bloomBuffer, 0, 0);
    ctx.restore();
  }
}
