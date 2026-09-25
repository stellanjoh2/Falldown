import { backgroundImage, storeBackgroundImage } from "../background";
import {
  blendMode,
  DEFAULT_AUDIO_REACT,
  DEFAULT_PHYSICS,
  normalizeBackground,
  physicsComplexity,
  type AppState,
  type BackgroundSettings,
} from "../types";

export type BgFile = { src: string; name: string; width: number; height: number };

export type SyncedDoc = {
  slots: AppState["slots"];
  physics: AppState["physics"];
  audioReact: AppState["audioReact"];
  post: AppState["post"];
  stageColor: string;
  background: BackgroundSettings & {
    image?: BgFile | null;
    logo?: BgFile | null;
  };
  canvas: AppState["canvas"];
  masterScale: number;
  sizeRandom: number;
  pillPad: number;
  textTracking: number;
  shapeAmount: number;
  theme: string[];
};

export function serializeDoc(state: AppState): SyncedDoc {
  return {
    stageColor: state.stageColor,
    background: {
      ...state.background,
      image: backgroundImage(state.background.imageId),
      logo: backgroundImage(state.background.logoId),
    },
    canvas: state.canvas,
    masterScale: state.masterScale,
    sizeRandom: state.sizeRandom,
    pillPad: state.pillPad,
    textTracking: state.textTracking,
    shapeAmount: state.shapeAmount,
    theme: [...state.theme],
    physics: { ...state.physics },
    audioReact: { ...state.audioReact },
    post: { ...state.post },
    slots: structuredClone(state.slots),
  };
}

/** Turn a wire doc into plain AppState, storing embedded background files. */
export function hydrateDoc(raw: SyncedDoc): AppState {
  const image = raw.background?.image;
  const logo = raw.background?.logo;
  const imageId =
    image && image.src ? storeBackgroundImage(image.src, image.name || "image", image.width || 0, image.height || 0) : "";
  const logoId =
    logo && logo.src ? storeBackgroundImage(logo.src, logo.name || "logo", logo.width || 0, logo.height || 0) : "";

  const { image: _image, logo: _logo, ...bgRest } = (raw.background ?? {}) as SyncedDoc["background"] & {
    image?: BgFile | null;
    logo?: BgFile | null;
  };

  return {
    stageColor: raw.stageColor,
    background: normalizeBackground({
      ...bgRest,
      imageId: imageId || ("imageId" in bgRest ? String(bgRest.imageId ?? "") : ""),
      logoId: logoId || ("logoId" in bgRest ? String(bgRest.logoId ?? "") : ""),
    }),
    canvas: raw.canvas === "9:16" ? "9:16" : "16:9",
    masterScale: raw.masterScale,
    sizeRandom: raw.sizeRandom,
    pillPad: raw.pillPad,
    textTracking: raw.textTracking,
    shapeAmount: raw.shapeAmount,
    theme: Array.isArray(raw.theme) ? [...raw.theme] : [],
    physics: {
      ...DEFAULT_PHYSICS,
      ...raw.physics,
      complexity: physicsComplexity(raw.physics?.complexity),
    },
    audioReact: {
      ...DEFAULT_AUDIO_REACT,
      ...raw.audioReact,
      enabled: Boolean(raw.audioReact?.enabled),
      sensitivity:
        typeof raw.audioReact?.sensitivity === "number"
          ? Math.min(100, Math.max(0, raw.audioReact.sensitivity))
          : DEFAULT_AUDIO_REACT.sensitivity,
    },
    post: {
      ...raw.post,
      bloomOpacity: raw.post?.bloomOpacity ?? 80,
      hue: raw.post?.hue ?? 0,
      blend: blendMode(raw.post?.blend),
    },
    slots: Array.isArray(raw.slots) ? structuredClone(raw.slots) : [],
  };
}
