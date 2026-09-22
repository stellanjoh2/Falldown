export type HoldingShape = "none" | "pill" | "box";

export type TextSlot = {
  id: string;
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  shape: HoldingShape;
  radius: number;
};

export type ImageSlot = {
  id: string;
  kind: "image";
  src: string;
  name: string;
  size: number;
  amount: number;
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
    post: { bloom: 0, bloomOpacity: 80, grain: 0, vignette: 0, saturate: 100 },
    physics: { gravity: 1, speed: 1, bounce: 0.35, hold: 0.8 },
    slots: [
      defaultTextSlot({ text: "ACID", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "TECHNO", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "JUNGLE", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "HARDCORE", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "RAWSTYLE", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "DNB", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "172 BPM", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "IDM", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "ELECTRO", fontFamily: "Akira Expanded" }),
      defaultTextSlot({ text: "HYPNOTIC", fontFamily: "Akira Expanded" }),
    ],
  };
}
