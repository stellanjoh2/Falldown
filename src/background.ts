import type { CanvasRatio } from "./canvas";
import type { BackgroundSettings, GradientStop } from "./types";

const LOGO_BOX = 0.5;
const images = new Map<string, { src: string; name: string; width: number; height: number }>();
const logoScratch = document.createElement("canvas");

export function storeBackgroundImage(src: string, name: string, width = 0, height = 0): string {
  const id = crypto.randomUUID();
  images.set(id, { src, name, width, height });
  return id;
}

export function backgroundImage(id: string): { src: string; name: string; width: number; height: number } | null {
  if (!id) return null;
  return images.get(id) ?? null;
}

export function isSvgLogo(name: string, src: string): boolean {
  return name.toLowerCase().endsWith(".svg") || src.startsWith("data:image/svg");
}

/** Most common fill in the file, so the picker opens on the mark's own color. */
export function svgOriginalColor(svg: string): string {
  const found: string[] = [];
  const re = /fill\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-zA-Z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg))) {
    const color = cssColor(match[1]);
    if (color) found.push(color);
  }
  if (!found.length) return "#000000";
  const counts = new Map<string, number>();
  for (const color of found) counts.set(color, (counts.get(color) ?? 0) + 1);
  let best = found[0];
  let amount = 0;
  for (const [color, count] of counts) {
    if (count > amount) {
      best = color;
      amount = count;
    }
  }
  return best;
}

export function svgSize(svg: string): { width: number; height: number } {
  const box = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)/i);
  const width = Number(box?.[1] ?? svg.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1]);
  const height = Number(box?.[2] ?? svg.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1]);
  if (width > 0 && height > 0) return { width, height };
  return { width: 1, height: 1 };
}

function cssColor(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw || raw === "none" || raw === "transparent" || raw === "currentcolor" || raw === "inherit") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#010101";
  ctx.fillStyle = raw;
  const next = String(ctx.fillStyle).toLowerCase();
  if (next === "#010101" && raw !== "#010101") return null;
  if (next.startsWith("#")) return next.slice(0, 7);
  const rgb = next.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!rgb) return null;
  const channel = (value: string) => Math.round(Number(value)).toString(16).padStart(2, "0");
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
}

/** Null keeps the file's own pixels. A theme index follows the Create palette. */
export function logoFill(background: BackgroundSettings, theme: string[]): string | null {
  if (background.logoColor) return background.logoColor;
  if (background.logoTint == null || !theme.length) return null;
  return theme[background.logoTint % theme.length] ?? null;
}

/** The logo's long side is half the shorter frame edge at scale 1, then clamped inside the frame. */
export function logoSize(
  frameW: number,
  frameH: number,
  imgW: number,
  imgH: number,
  scale: number,
): { width: number; height: number } {
  const max = Math.min(frameW, frameH) * LOGO_BOX * Math.max(0.05, scale);
  const ratio = imgW > 0 && imgH > 0 ? imgW / imgH : 1;
  const width = ratio >= 1 ? max : max * ratio;
  const height = ratio >= 1 ? max / ratio : max;
  const fit = Math.min(1, (frameW * 0.9) / width, (frameH * 0.9) / height);
  return { width: width * fit, height: height * fit };
}

export function paintLogo(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: BackgroundSettings,
  theme: string[],
  image: HTMLImageElement | null,
) {
  const file = backgroundImage(background.logoId);
  if (!file || !image) return;
  const imgW = file.width || image.width;
  const imgH = file.height || image.height;
  if (imgW < 1 || imgH < 1) return;
  const size = logoSize(width, height, imgW, imgH, background.logoScale || 1);
  const x = (width - size.width) / 2;
  const y = (height - size.height) / 2;
  const fill = isSvgLogo(file.name, file.src) ? logoFill(background, theme) : null;
  if (!fill) {
    ctx.drawImage(image, x, y, size.width, size.height);
    return;
  }
  const sw = Math.max(1, Math.round(size.width));
  const sh = Math.max(1, Math.round(size.height));
  if (logoScratch.width !== sw || logoScratch.height !== sh) {
    logoScratch.width = sw;
    logoScratch.height = sh;
  }
  const scratch = logoScratch.getContext("2d");
  if (!scratch) return;
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.globalCompositeOperation = "source-over";
  scratch.clearRect(0, 0, sw, sh);
  scratch.fillStyle = fill;
  scratch.fillRect(0, 0, sw, sh);
  scratch.globalCompositeOperation = "destination-in";
  scratch.drawImage(image, 0, 0, sw, sh);
  ctx.drawImage(logoScratch, x, y, size.width, size.height);
}

export type BackgroundPaint = {
  color: string;
  image: string;
  size: string;
  position: string;
  repeat: string;
};

function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((channel) => channel + channel).join("") : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const amount = Math.min(1, Math.max(0, t));
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * amount);
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, "0")).join("")}`;
}

export function sortedStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** Color along the stop ray. `at` uses the same 0–100 scale as the stops. */
export function sampleStopColor(stops: GradientStop[], at: number): string {
  const sorted = sortedStops(stops);
  if (!sorted.length) return "#000000";
  if (at <= sorted[0].at) return sorted[0].color;
  const last = sorted[sorted.length - 1];
  if (at >= last.at) return last.color;
  let index = 1;
  while (index < sorted.length && sorted[index].at < at) index += 1;
  const left = sorted[index - 1];
  const right = sorted[index];
  const span = right.at - left.at || 1;
  return mixHex(left.color, right.color, (at - left.at) / span);
}

function stopList(stops: { color: string; at: number }[]): string {
  return stops.map((stop) => `${stop.color} ${(Math.round(stop.at * 100) / 100)}%`).join(", ");
}

function addCanvasStops(gradient: CanvasGradient, stops: { color: string; at: number }[]) {
  let last = -1;
  for (const stop of stops) {
    let offset = Math.min(1, Math.max(0, stop.at / 100));
    if (offset <= last) offset = Math.min(1, last + 0.0001);
    last = offset;
    gradient.addColorStop(offset, stop.color);
  }
}

/** Anything other than radial is linear, including an older spherical setting. */
function linearShape(shape: string): boolean {
  return shape !== "radial";
}

function cssUrl(src: string): string {
  return `url("${src.replace(/["\\\n\r()]/g, "")}")`;
}

/** 9:16 meets the top and bottom and crops the sides. 16:9 covers the frame. */
export function imageFrame(ratio: CanvasRatio): { size: string; position: string } {
  if (ratio === "9:16") return { size: "auto 100%", position: "center center" };
  return { size: "cover", position: "center center" };
}

export function backgroundPaint(background: BackgroundSettings, ratio: CanvasRatio, solid: string): BackgroundPaint {
  if (background.kind === "image") {
    const file = backgroundImage(background.imageId);
    if (file) {
      const frame = imageFrame(ratio);
      return {
        color: solid,
        image: cssUrl(file.src),
        size: frame.size,
        position: frame.position,
        repeat: "no-repeat",
      };
    }
  }
  if (background.kind === "gradient" && background.stops.length >= 2) {
    const list = stopList(sortedStops(background.stops));
    const image = linearShape(background.shape)
      ? `linear-gradient(to bottom, ${list})`
      : `radial-gradient(circle farthest-corner at 50% 50%, ${list})`;
    return {
      color: solid,
      image,
      size: "cover",
      position: "center center",
      repeat: "no-repeat",
    };
  }
  return {
    color: solid,
    image: "none",
    size: "auto",
    position: "center center",
    repeat: "no-repeat",
  };
}

export function stopBarGradient(stops: GradientStop[]): string {
  const sorted = sortedStops(stops);
  if (sorted.length < 2) return "transparent";
  return `linear-gradient(90deg, ${stopList(sorted)})`;
}

export function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  solid: string,
  background: BackgroundSettings,
  ratio: CanvasRatio,
  image: HTMLImageElement | null,
) {
  ctx.fillStyle = solid;
  ctx.fillRect(0, 0, width, height);
  if (background.kind === "gradient" && background.stops.length >= 2) {
    const stops = sortedStops(background.stops);
    const gradient = linearShape(background.shape)
      ? ctx.createLinearGradient(0, 0, 0, height)
      : ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(1, Math.hypot(width, height) / 2));
    addCanvasStops(gradient, stops);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (background.kind !== "image" || !image || image.width < 1 || image.height < 1) return;
  const cover = ratio !== "9:16";
  const scale = cover
    ? Math.max(width / image.width, height / image.height)
    : height / image.height;
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (width - dw) / 2, cover ? (height - dh) / 2 : 0, dw, dh);
}
