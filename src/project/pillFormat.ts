import { backgroundImage, putBackgroundImage } from "../background";
import {
  blendMode,
  DEFAULT_AUDIO_REACT,
  DEFAULT_PHYSICS,
  normalizeBackground,
  physicsComplexity,
  type AppState,
  type Slot,
} from "../types";
import type { ChipPose } from "../world";

export const PILL_EXTENSION = ".pill";
export const PILL_MIME = "application/x-ultrapilled-project";

export type PillEmbeddedImage = {
  id: string;
  src: string;
  name: string;
  width: number;
  height: number;
};

export type PillProject = {
  state: AppState;
  poses: ChipPose[];
  frame: { width: number; height: number };
  images: PillEmbeddedImage[];
  loop: boolean;
};

type PillPayload = {
  v: 1;
  ultrapilled: "project";
  state: AppState;
  poses?: ChipPose[];
  frame?: { width: number; height: number };
  images?: PillEmbeddedImage[];
  loop?: boolean;
};

export function isPillFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(PILL_EXTENSION);
}

export function defaultPillFileName(): string {
  return `ultrapilled${PILL_EXTENSION}`;
}

function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

function cloneSlot(slot: Slot): Slot {
  return structuredClone(slot);
}

function collectImages(state: AppState): PillEmbeddedImage[] {
  const out: PillEmbeddedImage[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!id || seen.has(id)) return;
    const file = backgroundImage(id);
    if (!file?.src) return;
    seen.add(id);
    out.push({
      id,
      src: file.src,
      name: file.name,
      width: file.width,
      height: file.height,
    });
  };
  add(state.background.imageId);
  add(state.background.logoId);
  return out;
}

export function serializePillProject(project: PillProject): string {
  const payload: PillPayload = {
    v: 1,
    ultrapilled: "project",
    state: {
      ...structuredClone(project.state),
      slots: project.state.slots.map(cloneSlot),
    },
    poses: project.poses.map((pose) => ({ ...pose })),
    frame: { ...project.frame },
    images: project.images.length ? project.images : collectImages(project.state),
    loop: project.loop,
  };
  return JSON.stringify(payload);
}

function parsePose(value: unknown): ChipPose | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.slotId !== "string" || !record.slotId) return null;
  const x = Number(record.x);
  const y = Number(record.y);
  const angle = Number(record.angle);
  const sizeUnit = Number(record.sizeUnit);
  const seqIndex = Number(record.seqIndex);
  if (![x, y, angle, sizeUnit, seqIndex].every(Number.isFinite)) return null;
  return {
    slotId: record.slotId,
    seqIndex: Math.max(0, Math.round(seqIndex)),
    sizeUnit,
    scaleMul: Number.isFinite(Number(record.scaleMul)) ? Math.max(0.1, Math.min(8, Number(record.scaleMul))) : undefined,
    x,
    y,
    angle,
  };
}

function parseSlots(value: unknown): Slot[] | null {
  if (!Array.isArray(value)) return null;
  const slots: Slot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (record.kind !== "text" && record.kind !== "image") return null;
    if (typeof record.id !== "string" || !record.id) return null;
    slots.push(structuredClone(item) as Slot);
  }
  return slots;
}

function parseState(value: unknown): AppState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const slots = parseSlots(record.slots);
  if (!slots) return null;
  const theme = Array.isArray(record.theme)
    ? record.theme.filter((color): color is string => typeof color === "string")
    : [];
  if (theme.length === 0) return null;

  const physicsRaw = (record.physics ?? {}) as Record<string, unknown>;
  const audioRaw = (record.audioReact ?? {}) as Record<string, unknown>;
  const postRaw = (record.post ?? {}) as Record<string, unknown>;

  return {
    slots,
    physics: {
      ...DEFAULT_PHYSICS,
      ...physicsRaw,
      complexity: physicsComplexity(
        typeof physicsRaw.complexity === "string" ? physicsRaw.complexity : undefined,
      ),
    },
    audioReact: {
      ...DEFAULT_AUDIO_REACT,
      ...audioRaw,
      enabled: Boolean(audioRaw.enabled),
    },
    post: {
      bloom: Number(postRaw.bloom) || 0,
      bloomOpacity: Number(postRaw.bloomOpacity ?? 80),
      grain: Number(postRaw.grain) || 0,
      vignette: Number(postRaw.vignette) || 0,
      saturate: Number(postRaw.saturate ?? 100),
      hue: Number(postRaw.hue) || 0,
      blend: blendMode(typeof postRaw.blend === "string" ? postRaw.blend : undefined),
    },
    stageColor: typeof record.stageColor === "string" ? record.stageColor : "#080808",
    background: normalizeBackground(record.background as AppState["background"]),
    canvas: record.canvas === "9:16" ? "9:16" : "16:9",
    masterScale: Number(record.masterScale) || 4,
    sizeRandom: Number(record.sizeRandom) || 0,
    pillPad: Number(record.pillPad) || 14,
    textTracking: Number(record.textTracking) || 0,
    shapeAmount: Number(record.shapeAmount) || 0,
    theme,
  };
}

export function parsePillProject(raw: string): PillProject | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (record.ultrapilled !== "project" || record.v !== 1) return null;
    const state = parseState(record.state);
    if (!state) return null;

    const poses: ChipPose[] = [];
    if (Array.isArray(record.poses)) {
      for (const item of record.poses) {
        const pose = parsePose(item);
        if (pose) poses.push(pose);
      }
    }

    const frameRaw = (record.frame ?? {}) as Record<string, unknown>;
    const frame = {
      width: Math.max(1, Number(frameRaw.width) || 1),
      height: Math.max(1, Number(frameRaw.height) || 1),
    };

    const images: PillEmbeddedImage[] = [];
    if (Array.isArray(record.images)) {
      for (const item of record.images) {
        if (!item || typeof item !== "object") continue;
        const image = item as Record<string, unknown>;
        if (typeof image.id !== "string" || !image.id || !isDataUrl(image.src)) continue;
        images.push({
          id: image.id,
          src: image.src,
          name: typeof image.name === "string" ? image.name : "image",
          width: Number(image.width) || 0,
          height: Number(image.height) || 0,
        });
      }
    }

    return {
      state,
      poses,
      frame,
      images,
      loop: Boolean(record.loop),
    };
  } catch {
    return null;
  }
}

/** Rehydrate embedded background/logo blobs into the in-memory image store. */
export function hydratePillImages(images: PillEmbeddedImage[]) {
  for (const image of images) {
    putBackgroundImage(image.id, image.src, image.name, image.width, image.height);
  }
}

export function readPillFile(file: File): Promise<PillProject> {
  if (!isPillFile(file)) {
    return Promise.reject(new Error("Only .pill project files can be loaded."));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result;
      if (typeof raw !== "string") {
        reject(new Error("Could not read project file."));
        return;
      }
      const project = parsePillProject(raw);
      if (!project) {
        reject(new Error("This .pill file is invalid or corrupted."));
        return;
      }
      resolve(project);
    };
    reader.onerror = () => reject(new Error("Could not read project file."));
    reader.readAsText(file);
  });
}

export function downloadPillJson(json: string, filename = defaultPillFileName()) {
  const blob = new Blob([json], { type: PILL_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
