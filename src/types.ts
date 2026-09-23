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
  shape: HoldingShape;
  radius: number;
  stroked: boolean;
  stroke: number;
  colorIndex: number;
  color?: string;
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
  emoji?: string;
  scale: number;
};

export type Slot = TextSlot | ImageSlot;

export type PhysicsSettings = {
  weight: number;
  gravity: number;
  speed: number;
  bounce: number;
  friction: number;
  grip: number;
  spin: number;
  hold: number;
};

export const DEFAULT_PHYSICS: PhysicsSettings = {
  weight: 1,
  gravity: 1,
  speed: 1,
  bounce: 0,
  friction: 0.1,
  grip: 0.5,
  spin: 0,
  hold: 0.8,
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

export type BackgroundSettings = {
  kind: BackgroundKind;
  shape: GradientShape;
  stops: GradientStop[];
  imageId: string;
  logoId: string;
  logoScale: number;
  /** SVG fill the file was drawn with. Empty for a PNG. */
  logoOriginal: string;
  /** Theme swatch on the Physics tab. Null keeps the file's own pixels. */
  logoTint: number | null;
  /** Custom color from the picker. Empty follows logoTint or the original. */
  logoColor: string;
};

export function defaultBackground(): BackgroundSettings {
  return {
    kind: "solid",
    shape: "radial",
    stops: [
      { id: uid(), color: "#3b00ff", at: 0 },
      { id: uid(), color: DEFAULT_STAGE, at: 100 },
    ],
    imageId: "",
    logoId: "",
    logoScale: 1,
    logoOriginal: "",
    logoTint: null,
    logoColor: "",
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
    masterScale: 4.7,
    sizeRandom: 100,
    pillPad: 14,
    textTracking: 0,
    shapeAmount: 1,
    theme: [...DEFAULT_THEME],
    post: { bloom: 23, bloomOpacity: 86, grain: 0, vignette: 0, saturate: 100, blend: "normal" },
    physics: { ...DEFAULT_PHYSICS },
    slots: [
      { text: "TECHNO", colorIndex: 1 },
      { text: "JUNGLE", colorIndex: 2 },
      { text: "HARDCORE", colorIndex: 3, stroked: true, stroke: 1 },
      { text: "RAWSTYLE", colorIndex: 0 },
      { text: "DNB", colorIndex: 1 },
      { text: "170 BPM", colorIndex: 4 },
      { text: "FRIDAY", colorIndex: 0 },
      { text: "ACID", colorIndex: 1 },
    ].map((slot) => defaultTextSlot({ ...slot, fontFamily: "Syne", fontWeight: 800 })),
  };
}
