import type { CanvasRatio } from "./canvas";
import { DEFAULT_STAGE, DEFAULT_THEME } from "./theme";

export type HoldingShape = "none" | "pill" | "box";

export type TextSlot = {
  id: string;
  kind: "text";
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  textHeight: number;
  /** Own pill padding. Unset follows the global slider. */
  pillPad?: number;
  /** Own tracking. Unset follows the global slider. */
  tracking?: number;
  shape: HoldingShape;
  radius: number;
  stroked: boolean;
  stroke: number;
  colorIndex: number;
  color?: string;
  /** Overlapping discs from the shape color to an end color. Off keeps a solid fill. */
  gradient?: boolean;
  /** Start color kept while a stroke is showing, so the gradient can come back. */
  gradientFromIndex?: number;
  gradientFrom?: string;
  /** End swatch. Unset uses the next theme color. */
  gradientColorIndex?: number;
  gradientColor?: string;
  /** Degrees. 90 runs left to right. Unset keeps that. */
  gradientAngle?: number;
  /** 1–100. Size of the color blend along the axis. Unset keeps the default. */
  gradientScale?: number;
  /** Looping color sweep along the gradient. Needs gradient on. */
  animatedGradient?: boolean;
  /** 1–100. Higher is faster. Unset keeps the default. */
  gradientSpeed?: number;
  /** Index into the theme, then black, then white. Unset follows the shape. */
  textColorIndex?: number;
  textColor?: string;
  scale: number;
};

export type ImageSlot = {
  id: string;
  kind: "image";
  src: string;
  name: string;
  size: number;
  amount: number;
  colorIndex: number;
  color?: string;
  /** Hue blend from the icon color to an end color. Off keeps a solid fill. */
  gradient?: boolean;
  /** End swatch. Unset uses the next theme color. */
  gradientColorIndex?: number;
  gradientColor?: string;
  /** Degrees. 90 runs left to right. Unset keeps that. */
  gradientAngle?: number;
  /** 1–100. Size of the color blend along the axis. Unset keeps the default. */
  gradientScale?: number;
  /** Looping color sweep along the gradient. Needs gradient on. */
  animatedGradient?: boolean;
  /** 1–100. Higher is faster. Unset keeps the default. */
  gradientSpeed?: number;
  emoji?: string;
  scale: number;
  /** Preset collider for an upload. Unset uses a box. An SVG is matched when the file is picked. */
  collider?: string;
};

export type Slot = TextSlot | ImageSlot;

export type PhysicsComplexity = "simple" | "normal" | "ultra";

export const PHYSICS_COMPLEXITY = [
  { id: "simple", label: "Simple" },
  { id: "normal", label: "Normal (current)" },
  { id: "ultra", label: "Ultra" },
] as const;

export function physicsComplexity(value: string | undefined): PhysicsComplexity {
  return value === "simple" || value === "ultra" ? value : "normal";
}

export type PhysicsSettings = {
  weight: number;
  gravity: number;
  speed: number;
  bounce: number;
  friction: number;
  grip: number;
  spin: number;
  hold: number;
  complexity: PhysicsComplexity;
};

export const DEFAULT_PHYSICS: PhysicsSettings = {
  weight: 1,
  gravity: 2,
  speed: 1,
  bounce: 0.15,
  friction: 0.1,
  grip: 0.5,
  spin: 0,
  hold: 0.8,
  complexity: "normal",
};

export const BLEND_MODES = [
  { id: "normal", label: "Normal" },
  { id: "plus-lighter", label: "Linear Dodge" },
  { id: "darken", label: "Darken" },
  { id: "multiply", label: "Multiply" },
  { id: "color-burn", label: "Color Burn" },
  { id: "lighten", label: "Lighten" },
  { id: "screen", label: "Screen" },
  { id: "color-dodge", label: "Color Dodge" },
  { id: "overlay", label: "Overlay" },
  { id: "soft-light", label: "Soft Light" },
  { id: "hard-light", label: "Hard Light" },
  { id: "difference", label: "Difference" },
  { id: "exclusion", label: "Exclusion" },
  { id: "hue", label: "Hue" },
  { id: "saturation", label: "Saturation" },
  { id: "color", label: "Color" },
  { id: "luminosity", label: "Luminosity" },
] as const;

export type BlendMode = (typeof BLEND_MODES)[number]["id"];

export function blendMode(value: string | undefined): BlendMode {
  return BLEND_MODES.some((mode) => mode.id === value) ? (value as BlendMode) : "normal";
}

/** Canvas has no plus-lighter. Lighter is the add blend the export already used. */
export function canvasBlend(mode: BlendMode): GlobalCompositeOperation {
  if (mode === "normal") return "source-over";
  if (mode === "plus-lighter") return "lighter";
  return mode;
}

export type PostSettings = {
  bloom: number;
  bloomOpacity: number;
  grain: number;
  vignette: number;
  saturate: number;
  /** Degrees. 0 leaves the picture as painted. */
  hue: number;
  blend: BlendMode;
};

export type BackgroundKind = "solid" | "gradient" | "image";
export type GradientShape = "radial" | "linear";

export type GradientStop = {
  id: string;
  color: string;
  /** 0 is the center of the gradient, 100 is the rim. */
  at: number;
};

/** Base fits 16×9 (or 9×16) perfect squares; fine is half that cell size. */
export type GridDensity = "base" | "fine";

export type BackgroundSettings = {
  kind: BackgroundKind;
  shape: GradientShape;
  stops: GradientStop[];
  imageId: string;
  logoId: string;
  logoScale: number;
  /** SVG fill the file was drawn with. Empty for a PNG. */
  logoOriginal: string;
  /** Theme swatch on the Create tab. Null keeps the file's own pixels. */
  logoTint: number | null;
  /** Custom color from the picker. Empty follows logoTint or the original. */
  logoColor: string;
  grid: boolean;
  gridDensity: GridDensity;
  gridColor: string;
  /** 0–100. */
  gridOpacity: number;
};

export function defaultBackground(): BackgroundSettings {
  return {
    kind: "solid",
    shape: "radial",
    stops: [
      { id: uid(), color: "#02006c", at: 0 },
      { id: uid(), color: DEFAULT_STAGE, at: 100 },
    ],
    imageId: "",
    logoId: "",
    logoScale: 1,
    logoOriginal: "",
    logoTint: null,
    logoColor: "",
    grid: true,
    gridDensity: "fine",
    gridColor: "#ffffff",
    gridOpacity: 24,
  };
}

export function normalizeBackground(raw: Partial<BackgroundSettings> | null | undefined): BackgroundSettings {
  const base = defaultBackground();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    stops: Array.isArray(raw.stops) && raw.stops.length >= 2 ? raw.stops : base.stops,
    grid: Boolean(raw.grid),
    gridDensity: raw.gridDensity === "fine" ? "fine" : "base",
    gridColor: typeof raw.gridColor === "string" && raw.gridColor ? raw.gridColor : base.gridColor,
    gridOpacity: typeof raw.gridOpacity === "number" ? Math.min(100, Math.max(0, raw.gridOpacity)) : base.gridOpacity,
  };
}

export type AppState = {
  slots: Slot[];
  physics: PhysicsSettings;
  post: PostSettings;
  stageColor: string;
  background: BackgroundSettings;
  canvas: CanvasRatio;
  masterScale: number;
  sizeRandom: number;
  pillPad: number;
  textTracking: number;
  shapeAmount: number;
  theme: string[];
};

export const FONTS = [
  { id: "Inter", label: "Inter", weights: [300, 400, 600, 700] },
  { id: "Space Grotesk", label: "Space Grotesk", weights: [600, 700] },
  { id: "Space Mono", label: "Space Mono", weights: [400, 700] },
  { id: "Syne", label: "Syne", weights: [400, 500, 600, 700, 800] },
  { id: "Bricolage Grotesque", label: "Bricolage Grotesque", weights: [200, 300, 400, 500, 600, 700, 800] },
  { id: "Outfit", label: "Outfit", weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: "Sora", label: "Sora", weights: [100, 200, 300, 400, 500, 600, 700, 800] },
  { id: "Fraunces", label: "Fraunces", weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: "Archivo Black", label: "Archivo Black", weights: [400] },
  { id: "Bebas Neue", label: "Bebas Neue", weights: [400] },
  { id: "Impact", label: "Impact", weights: [400] },
  { id: "Georgia", label: "Georgia", weights: [400, 700] },
  { id: "system-ui", label: "System UI", weights: [400, 500, 600, 700] },
] as const;

export const FALLBACK_WEIGHTS = [400, 500, 600, 700, 800] as const;

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

export function weightName(weight: number): string {
  return WEIGHT_NAMES[weight] ?? String(weight);
}

export function bundledWeights(family: string): readonly number[] | undefined {
  return FONTS.find((font) => font.id === family)?.weights;
}

/** A holding shape paints a background behind the word. A stroke is an outline only. */
export function shapeHasFill(slot: Pick<TextSlot, "shape" | "stroked">): boolean {
  return slot.shape !== "none" && !slot.stroked;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function defaultTextSlot(partial: Partial<TextSlot> = {}): TextSlot {
  return {
    id: uid(),
    kind: "text",
    text: "HELLO",
    fontFamily: "Inter",
    fontWeight: 700,
    fontSize: 28,
    textHeight: 50,
    shape: "pill",
    radius: 12,
    stroked: false,
    stroke: 4,
    colorIndex: 0,
    scale: 1,
    ...partial,
  };
}

/** Free-standing type — no holding pill/box, ink-tight physics. */
export function defaultTypeSlot(partial: Partial<TextSlot> = {}): TextSlot {
  return defaultTextSlot({ text: "TEXT", shape: "none", ...partial });
}

export function defaultImageSlot(partial: Partial<ImageSlot> = {}): ImageSlot {
  return {
    id: uid(),
    kind: "image",
    src: "",
    name: "icon",
    size: 72,
    amount: 1,
    colorIndex: 0,
    scale: 1,
    ...partial,
  };
}

export function demoState(): AppState {
  return {
    stageColor: DEFAULT_STAGE,
    background: defaultBackground(),
    canvas: "16:9",
    masterScale: 4.3,
    sizeRandom: 100,
    pillPad: 14,
    textTracking: 37,
    shapeAmount: 15,
    theme: [...DEFAULT_THEME],
    post: { bloom: 0, bloomOpacity: 100, grain: 0, vignette: 0, saturate: 100, hue: 0, blend: "normal" },
    physics: { ...DEFAULT_PHYSICS },
    slots: [
      { text: "TECHNO", colorIndex: 1 },
      {
        text: "Nope",
        colorIndex: 2,
        fontFamily: "Outfit",
        fontWeight: 800,
        textHeight: 63,
        gradient: true,
        gradientFromIndex: 2,
        gradientColorIndex: 0,
        gradientAngle: 140,
        tracking: -61,
        pillPad: 27,
      },
      { text: "HARDCORE", colorIndex: 3, stroked: true, stroke: 2, pillPad: 24, scale: 1.35 },
      {
        text: "SINGLE AF",
        colorIndex: 0,
        pillPad: 36,
        gradient: true,
        color: "#3b00ff",
        gradientColor: "#c4ff00",
        animatedGradient: true,
        gradientScale: 90,
        gradientAngle: 152,
        gradientSpeed: 14,
      },
      { text: "NO WAY", colorIndex: 1, stroked: true, stroke: 4 },
      { text: "DNB", colorIndex: 3 },
      { text: "GTFO", colorIndex: 4, shape: "box" as const, radius: 13, scale: 0.95, pillPad: 30 },
      {
        text: "FRIDAY",
        colorIndex: 0,
        fontFamily: "Bebas Neue",
        fontWeight: 400,
        textHeight: 42,
        scale: 1.45,
        shape: "box" as const,
        radius: 4,
        stroked: true,
        stroke: 2,
        pillPad: 24,
        color: "#3b00ff",
        textColorIndex: 0,
      },
      {
        text: "TOKYO",
        colorIndex: 4,
        fontFamily: "Bebas Neue",
        fontWeight: 400,
        textHeight: 42,
        scale: 1.45,
        shape: "box" as const,
        radius: 4,
        stroked: false,
        stroke: 2,
        pillPad: 24,
        textColorIndex: 0,
        gradient: true,
        gradientColorIndex: 2,
        color: "#3b00ff",
        gradientColor: "#ff3b00",
        animatedGradient: true,
        gradientSpeed: 100,
        gradientScale: 8,
        gradientFromIndex: 4,
        gradientFrom: "#3b00ff",
      },
      {
        text: "DOORS OPEN AT 9PM",
        colorIndex: 1,
        fontFamily: "Outfit",
        fontWeight: 700,
        scale: 0.8,
        textColorIndex: 3,
        gradient: true,
        gradientColorIndex: 1,
        tracking: -100,
        pillPad: 13,
      },
      { text: "OH!", colorIndex: 0, shape: "none" as const, scale: 2.9, tracking: -30 },
    ].map((slot) => defaultTextSlot({ fontFamily: "Syne", fontWeight: 800, ...slot })),
  };
}
