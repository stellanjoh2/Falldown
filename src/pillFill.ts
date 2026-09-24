import { pickTheme, type ColorTheme } from "./theme";
import type { TextSlot } from "./types";

type GradientSlot = Pick<TextSlot, "color" | "colorIndex" | "shape" | "stroked" | "gradient" | "gradientColor" | "gradientColorIndex">;

const GRADIENT_STOPS = 16;

function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((channel) => channel + channel).join("") : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length < 6) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hexOf(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const delta = max - min;
  const sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === rn) hue = (gn - bn) / delta + (gn < bn ? 6 : 0);
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return [hue / 6, sat, light];
}

function hslToRgb(hue: number, sat: number, light: number): [number, number, number] {
  if (sat === 0) {
    const gray = light * 255;
    return [gray, gray, gray];
  }
  const channel = (p: number, q: number, t: number) => {
    let k = t;
    if (k < 0) k += 1;
    if (k > 1) k -= 1;
    if (k < 1 / 6) return p + (q - p) * 6 * k;
    if (k < 1 / 2) return q;
    if (k < 2 / 3) return p + (q - p) * (2 / 3 - k) * 6;
    return p;
  };
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  return [channel(p, q, hue + 1 / 3) * 255, channel(p, q, hue) * 255, channel(p, q, hue - 1 / 3) * 255];
}

/** Hue blend, so pink runs through coral into orange instead of through gray. */
export function mixHue(from: string, to: string, t: number): string {
  const amount = Math.min(1, Math.max(0, t));
  const a = rgbToHsl(...parseHex(from));
  const b = rgbToHsl(...parseHex(to));
  let dh = b[0] - a[0];
  if (dh > 0.5) dh -= 1;
  if (dh < -0.5) dh += 1;
  const [r, g, bl] = hslToRgb((a[0] + dh * amount + 1) % 1, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount);
  return hexOf(r, g, bl);
}

type GradientEnd = {
  colorIndex?: number;
  gradientColor?: string;
  gradientColorIndex?: number;
};

export function gradientEndIndex(theme: ColorTheme, slot: GradientEnd): number {
  const count = Math.max(1, theme.length);
  const index = slot.gradientColorIndex ?? (slot.colorIndex ?? 0) + 1;
  return ((index % count) + count) % count;
}

export function gradientEnd(theme: ColorTheme, slot: GradientEnd): string {
  if (slot.gradientColor) return slot.gradientColor;
  return pickTheme(theme, gradientEndIndex(theme, slot));
}

/** Color used to pick automatic text ink. Gradients sample the middle of the blend. */
export function fillSample(theme: ColorTheme, slot: GradientSlot): string {
  const fill = slot.color ?? pickTheme(theme, slot.colorIndex ?? 0);
  if (!slot.gradient || slot.stroked || slot.shape === "none") return fill;
  return mixHue(fill, gradientEnd(theme, slot), 0.5);
}

/** Even hue samples so the blend stays colorful and has no hard bands. */
export function pillGradientStops(from: string, to: string): { at: number; color: string }[] {
  const stops: { at: number; color: string }[] = [];
  for (let i = 0; i < GRADIENT_STOPS; i++) {
    const at = i / (GRADIENT_STOPS - 1);
    stops.push({ at, color: mixHue(from, to, at) });
  }
  return stops;
}

/** 90 runs left to right, matching a CSS linear-gradient. */
export const DEFAULT_GRADIENT_ANGLE = 90;

export function gradientAngleOf(angle: number | undefined): number {
  const value = angle ?? DEFAULT_GRADIENT_ANGLE;
  if (!Number.isFinite(value)) return DEFAULT_GRADIENT_ANGLE;
  return ((value % 360) + 360) % 360;
}

export function pillGradient(from: string, to: string, angle?: number): string {
  const list = pillGradientStops(from, to)
    .map((stop) => `${stop.color} ${(stop.at * 100).toFixed(2)}%`)
    .join(", ");
  return `linear-gradient(${gradientAngleOf(angle)}deg, ${list})`;
}

/** CSS angle: 0 points up, 90 points right. Ends sit on the box edges. */
export function gradientLine(width: number, height: number, angle?: number): { x0: number; y0: number; x1: number; y1: number } {
  const rad = (gradientAngleOf(angle) * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = Math.abs((width / 2) * dx) + Math.abs((height / 2) * dy);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x0: cx - dx * half,
    y0: cy - dy * half,
    x1: cx + dx * half,
    y1: cy + dy * half,
  };
}
