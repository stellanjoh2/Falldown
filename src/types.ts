import { DEFAULT_STAGE, DEFAULT_THEME } from "./theme";

export type HoldingShape = "none" | "pill" | "box";

export type TextSlot = {
  id: string;
  kind: "text";
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  shape: HoldingShape;
  radius: number;
  stroked: boolean;
  stroke: number;
  colorIndex: number;
  color?: string;
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

export type PostSettings = {
  bloom: number;
  bloomOpacity: number;
  grain: number;
  vignette: number;
  saturate: number;
};

export type AppState = {
  slots: Slot[];
  physics: PhysicsSettings;
  post: PostSettings;
  stageColor: string;
  masterScale: number;
  sizeRandom: number;
  pillPad: number;
  textHeight: number;
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
    shape: "pill",
    radius: 12,
    stroked: false,
    stroke: 4,
    colorIndex: 0,
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
    ...partial,
  };
}

export function demoState(): AppState {
  return {
    stageColor: DEFAULT_STAGE,
    masterScale: 5.3,
    sizeRandom: 100,
    pillPad: 14,
    textHeight: 50,
    textTracking: 41,
    shapeAmount: 1,
    theme: [...DEFAULT_THEME],
    post: { bloom: 0, bloomOpacity: 60, grain: 0, vignette: 0, saturate: 100 },
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
