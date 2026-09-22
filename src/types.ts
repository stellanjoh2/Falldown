export type HoldingShape = "none" | "pill" | "box";

export type TextSlot = {
  id: string;
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  shape: HoldingShape;
  radius: number;
  stroked: boolean;
  stroke: number;
  colorIndex: number;
};

export type ImageSlot = {
  id: string;
  kind: "image";
  src: string;
  name: string;
  size: number;
  amount: number;
  colorIndex: number;
  emoji?: string;
};

export type Slot = TextSlot | ImageSlot;

export type PhysicsSettings = {
  gravity: number;
  speed: number;
  bounce: number;
  hold: number;
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
  pillPad: number;
  textTracking: number;
  shapeAmount: number;
  theme: [string, string, string, string];
};

export const FONTS = [
  { id: "Inter", label: "Inter" },
  { id: "Space Grotesk", label: "Space Grotesk" },
  { id: "Archivo Black", label: "Archivo Black" },
  { id: "Bebas Neue", label: "Bebas Neue" },
  { id: "Impact", label: "Impact" },
  { id: "Georgia", label: "Georgia" },
  { id: "system-ui", label: "System UI" },
] as const;

export function uid(): string {
  return crypto.randomUUID();
}

export function defaultTextSlot(partial: Partial<TextSlot> = {}): TextSlot {
  return {
    id: uid(),
    kind: "text",
    text: "HELLO",
    fontFamily: "Inter",
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
    stageColor: "#2b00ff",
    masterScale: 5.8,
    pillPad: 50,
    textTracking: 41,
    shapeAmount: 1,
    theme: ["#000000", "#39ff14", "#8c00ff", "#ffffff"],
    post: { bloom: 20, bloomOpacity: 39, grain: 0, vignette: 0, saturate: 100 },
    physics: { gravity: 1, speed: 1, bounce: 0, hold: 0.8 },
    slots: [
      "ACID",
      "TECHNO",
      "JUNGLE",
      "HARDCORE",
      "RAWSTYLE",
      "DNB",
      "172 BPM",
      "IDM",
      "ELECTRO",
      "HYPNOTIC",
    ].map((text, index) =>
      defaultTextSlot({ text, fontFamily: "Akira Expanded", colorIndex: index % 4 }),
    ),
  };
}
