import Matter from "matter-js";
import { EMOJI_FONT } from "./emojis";
import { createColliderBody, isPresetId, presetIdForSrc, simpleColliderKind } from "./iconMesh";
import {
  cornerRadius,
  measureSlot,
  measureTextInk,
  paintTextInk,
  pillPadOf,
  scaleSlot,
  textShiftEm,
  trackingEm,
  trackingOf,
} from "./measure";
import { fillSample, gradientAngleOf, gradientEnd, gradientPeriodMs, pillGradient, pillSweepBand, sweepBandMetrics } from "./pillFill";
import { applyTextAnim, stopTextAnim, stopTextAnimIn } from "./textAnim";
import { pickTheme, resolveTextColor, type ColorTheme } from "./theme";
import { peekTrim } from "./trim";
import { physicsComplexity, shapeHasFill, type ImageSlot, type PhysicsComplexity, type PhysicsSettings, type Slot, type TextSlot } from "./types";
import { playImpact } from "./uiSounds";

const { Engine, Runner, Bodies, Composite, Body, Constraint, Sleeping, Events, Collision } = Matter;

const WALL = 120;
/** Shapes stop this far inside the canvas so the border never clips them. */
const EDGE = 1;
const FRAME_MS = 1000 / 60;
const GRAVITY_SCALE = 0.001;
const MATTER_DENSITY = 0.001;
const AIR_FRICTION = 0.01;
const GRAB_STIFFNESS = 0.2;
/** Softens the grab spring so release doesn't sling chips into the pile. */
const GRAB_DAMPING = 0.12;
const SIZE_RANDOM_SPAN = 0.28;
/** Must be low enough that friction slides still count as "moving". */
const SETTLED_SPEED = 0.06;
const SETTLED_SPIN = 0.01;
const CLICK_SLOP = 6;
const HOLD_DRAG_MS = 220;
/** Match the Create panel scale slider. */
const SCALE_MIN = 0.25;
const SCALE_MAX = 4;
const SCALE_CORNERS = ["nw", "ne", "se", "sw"] as const;
/** Closing speed along the contact normal before an impact sound plays. */
const IMPACT_SPEED = 3.2;
/** Closing speed that maps to full impact volume. */
const IMPACT_FULL_SPEED = 9;
/** Min gap between impact sounds so pile settle doesn't chatter. */
const IMPACT_COOLDOWN_MS = 90;

type PhysicsQuality = {
  separatePasses: number;
  maxContactSteps: number;
  positionSingle: number;
  positionMulti: number;
  velocitySingle: number;
  velocityMulti: number;
  overlapAllow: number;
  /** Max pixels of positional correction per pair per pass. */
  maxPush: number;
};

const PHYSICS_QUALITY: Record<PhysicsComplexity, PhysicsQuality> = {
  simple: {
    separatePasses: 12,
    maxContactSteps: 2,
    positionSingle: 6,
    positionMulti: 16,
    velocitySingle: 4,
    velocityMulti: 6,
    // Tiny slop only — larger allow left chips visually stacked after settle.
    overlapAllow: 0.12,
    maxPush: 5,
  },
  normal: {
    separatePasses: 20,
    maxContactSteps: 4,
    positionSingle: 6,
    positionMulti: 32,
    velocitySingle: 4,
    velocityMulti: 8,
    overlapAllow: 0.12,
    maxPush: 7,
  },
  ultra: {
    separatePasses: 32,
    maxContactSteps: 4,
    positionSingle: 12,
    positionMulti: 40,
    velocitySingle: 6,
    velocityMulti: 12,
    overlapAllow: 0.08,
    maxPush: 10,
  },
};

/** Below this, only soft position nudges — no velocity kicks that re-wake the pile. */
const QUIET_SEPARATE_SPEED = 0.2;
/** Start bleeding residual motion below this so settle/floor always arrives. */
const SETTLE_DAMP_SPEED = 0.35;

type ChipMirror = { face: HTMLElement; glow: HTMLElement };

type DroppedChip = {
  slotId: string;
  seqIndex: number;
  seqTotal: number;
  body: Matter.Body;
  el: HTMLElement;
  glow: HTMLElement;
  mirrors: ChipMirror[];
  width: number;
  height: number;
  chamfer: number;
  anchorX: number;
  anchorY: number;
  meshKey: string;
  sizeUnit: number;
  look: ChipLook | null;
  /** Physics/visual audio pulse currently applied to this chip (1 = base). */
  audioMul: number;
};

export type ChipDraw = {
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  slot: Slot;
  radius: number;
  fill: string;
  ink: string;
  tracking: number;
  shiftEm: number;
};

/** Saved body pose for .pill / draft restore. */
export type ChipPose = {
  slotId: string;
  seqIndex: number;
  sizeUnit: number;
  x: number;
  y: number;
  angle: number;
};

type ChipLook = {
  slot: Slot;
  radius: number;
  fill: string;
  ink: string;
  tracking: number;
  shiftEm: number;
};

export type WorldHandle = {
  engine: Matter.Engine;
  play: (
    slots: Slot[],
    physics: PhysicsSettings,
    stage: HTMLElement,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
  ) => void;
  refresh: (
    slots: Slot[],
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
  ) => void;
  clear: () => void;
  resize: (width: number, height: number) => void;
  refit: (width: number, height: number, factor: number) => void;
  setRunning: (on: boolean) => void;
  attach: (
    stage: HTMLElement,
    onPick?: (slotId: string | null) => void,
    onMenu?: (slotId: string, x: number, y: number) => void,
    onEdit?: (slotId: string) => void,
    scaleOf?: (slotId: string) => number,
    onScale?: (slotId: string, scale: number, phase: "start" | "move" | "end") => void,
  ) => void;
  refreshFrost: () => void;
  setPicked: (slotId: string | null) => void;
  setEditing: (slotId: string | null) => void;
  editingId: () => string | null;
  chipEl: (slotId: string) => HTMLElement | null;
  /** Remeasure + repaint one slot's chips only (typing / light edits). */
  refreshSlot: (
    slotId: string,
    slots: Slot[],
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
    opts?: { quiet?: boolean },
  ) => void;
  setSimulationScale: (scale: number) => void;
  /** Scale pulse per slot id (1 = normal). Grows dig out overlaps. */
  setAudioScales: (scales: ReadonlyMap<string, number> | null) => void;
  /** Upward hop for matching slot ids (sharp / icon hits). */
  impulseAudioJump: (slotIds: Iterable<string>, speed?: number) => void;
  setFloorOpen: (open: boolean) => void;
  freezePile: () => void;
  purgeFallen: (limitY: number) => void;
  isSettled: () => boolean;
  isQuiet: () => boolean;
  isDragging: () => boolean;
  chipCount: () => number;
  sync: () => void;
  draws: () => ChipDraw[];
  poses: () => ChipPose[];
  /** Place chips at saved poses (scaled from `frame` to the current playfield). */
  restore: (
    slots: Slot[],
    physics: PhysicsSettings,
    stage: HTMLElement,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
    poses: ChipPose[],
    frame: { width: number; height: number },
  ) => void;
  /** Convex hulls of each solid collider part, in stage pixels. */
  wireframes: () => { x: number; y: number }[][];
  step: (delta?: number) => void;
  destroy: () => void;
};

function chamferFor(radius: number, width: number, height: number): number {
  const max = Math.min(width, height) / 2 - 0.5;
  return Math.min(radius, Math.max(0, max));
}

function chipWeight(physics: PhysicsSettings) {
  return physics.weight > 0 ? physics.weight : 1;
}

function bodyProps(physics: PhysicsSettings, angle = 0) {
  return {
    restitution: physics.bounce,
    friction: physics.friction,
    frictionStatic: physics.grip,
    frictionAir: AIR_FRICTION,
    density: MATTER_DENSITY * chipWeight(physics),
    angle,
  };
}

function surfaceProps() {
  return { isStatic: true };
}

function applyWeight(body: Matter.Body, weight: number) {
  const density = MATTER_DENSITY * weight;
  if (body.parts.length > 1) {
    let mass = 0;
    for (let i = 1; i < body.parts.length; i++) {
      Body.setDensity(body.parts[i], density);
      mass += body.parts[i].mass;
    }
    Body.setMass(body, mass);
    return;
  }
  Body.setDensity(body, density);
}

function colliderId(slot: Slot): string {
  if (slot.kind !== "image" || slot.emoji || !slot.src) return "";
  const own = presetIdForSrc(slot.src);
  if (own) return own;
  return slot.collider && isPresetId(slot.collider) ? slot.collider : "block";
}

function meshKey(
  slot: Slot,
  width: number,
  height: number,
  chamfer: number,
  complexity: PhysicsComplexity,
): string {
  return `${slot.kind}|${colliderId(slot)}|${width}|${height}|${chamfer.toFixed(2)}|${complexity}`;
}

function chipBody(
  slot: Slot,
  x: number,
  y: number,
  width: number,
  height: number,
  physics: PhysicsSettings,
  chamfer = 0,
  angle = 0,
) {
  const id = colliderId(slot);
  const props = bodyProps(physics, 0);
  const complexity = physicsComplexity(physics.complexity);
  // simple → AABB; normal → circle/box proxy; ultra → traced mesh parts
  const preset =
    id && complexity === "ultra" ? createColliderBody(id, x, y, width, height, props) : null;
  let body = preset?.body ?? null;
  let anchor = preset?.anchor ?? { x: 0, y: 0 };
  if (!body && id && complexity !== "simple" && simpleColliderKind(id) === "circle") {
    const radius = Math.min(width, height) / 2;
    body = Bodies.circle(x, y, Math.max(1, radius), props);
  }
  if (!body) {
    const rounded =
      chamfer > 0 ? { ...props, chamfer: { radius: chamfer } } : props;
    body = Bodies.rectangle(x, y, width, height, rounded);
  }
  if (angle) {
    Body.setAngle(body, angle);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = anchor.x * cos - anchor.y * sin;
    const ry = anchor.x * sin + anchor.y * cos;
    Body.setPosition(body, {
      x: body.position.x + anchor.x - rx,
      y: body.position.y + anchor.y - ry,
    });
  }
  applyWeight(body, chipWeight(physics));
  return { body, anchor };
}

function paintSweepBand(
  host: HTMLElement,
  from: string,
  to: string,
  width: number,
  height: number,
  radius: number,
  angle?: number,
  scale?: number,
) {
  const { coverPx, tilePx } = sweepBandMetrics(width, height, angle, scale);
  host.style.clipPath = `inset(0 round ${Math.max(0, radius)}px)`;
  const found = host.querySelector(":scope > .chip-fill-band");
  const band = found instanceof HTMLElement ? found : document.createElement("div");
  if (band.parentElement !== host) {
    band.className = "chip-fill-band";
    host.replaceChildren(band);
  }
  band.style.width = `${coverPx}px`;
  band.style.height = `${coverPx}px`;
  band.style.setProperty("--sweep-tile", `${tilePx}px`);
  band.style.backgroundImage = pillSweepBand(from, to);
}

function setSweepDuration(el: HTMLElement, speed?: number) {
  const next = `${gradientPeriodMs(speed) / 1000}s`;
  // Re-setting duration restarts the CSS animation — only touch it when it changes.
  if (el.style.getPropertyValue("--sweep-duration") !== next) {
    el.style.setProperty("--sweep-duration", next);
  }
}

function paintFill(
  el: HTMLElement,
  on: boolean,
  from: string,
  to: string,
  width: number,
  height: number,
  radius: number,
  angle?: number,
  scale?: number,
  animated = false,
  speed?: number,
) {
  const existing = el.querySelector(":scope > .chip-fill");
  if (!on) {
    existing?.remove();
    return;
  }
  const fill = existing instanceof HTMLElement ? existing : document.createElement("div");
  if (fill.parentElement !== el) {
    fill.className = "chip-fill";
    fill.setAttribute("aria-hidden", "true");
    el.prepend(fill);
  }
  if (animated) {
    fill.classList.add("is-gradient-animated");
    fill.style.background = "transparent";
    setSweepDuration(fill, speed);
    fill.style.setProperty("--grad-angle", String(gradientAngleOf(angle)));
    // Reuse the band node so other pills keep rolling when this chip is repainted.
    paintSweepBand(fill, from, to, width, height, radius, angle, scale);
  } else {
    fill.replaceChildren();
    fill.classList.remove("is-gradient-animated");
    fill.style.removeProperty("--sweep-duration");
    fill.style.removeProperty("--grad-angle");
    fill.style.clipPath = "";
    fill.style.background = pillGradient(from, to, angle, scale);
  }
}

function paintStroke(el: HTMLElement, ring: boolean, gradient: boolean, stroke: number, fill: string, label: HTMLElement) {
  const existing = el.querySelector(":scope > .chip-ring");
  if (!ring || !gradient) {
    existing?.remove();
    el.style.boxShadow = ring ? `inset 0 0 0 ${Math.max(1, stroke)}px ${fill}` : "none";
    return;
  }
  el.style.boxShadow = "none";
  const ringEl = existing instanceof HTMLElement ? existing : document.createElement("div");
  if (ringEl.parentElement !== el) {
    ringEl.className = "chip-ring";
    ringEl.setAttribute("aria-hidden", "true");
    el.insertBefore(ringEl, label);
  }
  ringEl.style.boxShadow = `inset 0 0 0 ${Math.max(1, stroke)}px ${fill}`;
}

function paintBareText(
  el: HTMLElement,
  slot: TextSlot,
  width: number,
  height: number,
  tracking: number,
  color: string,
  shiftEm: number,
) {
  const found = el.querySelector(":scope > canvas");
  const canvas = found instanceof HTMLCanvasElement ? found : document.createElement("canvas");
  if (canvas.parentElement !== el) el.replaceChildren(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.ceil(width * dpr));
  const h = Math.max(1, Math.ceil(height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const ink = measureTextInk(slot, tracking);
  paintTextInk(ctx, slot, tracking, color, shiftEm, ink);
}

function textLabel(el: HTMLElement, editing: boolean): HTMLElement {
  const found = el.querySelector(":scope > .chip-label, :scope > .chip-edit");
  const label = found instanceof HTMLElement ? found : document.createElement("span");
  label.className = editing ? "chip-edit" : "chip-label";
  if (editing) {
    label.setAttribute("contenteditable", "plaintext-only");
    if (label.contentEditable !== "plaintext-only") label.contentEditable = "true";
    label.setAttribute("role", "textbox");
    label.setAttribute("aria-label", "Edit text");
    label.spellcheck = false;
  } else if (label.isContentEditable) {
    label.removeAttribute("contenteditable");
    label.removeAttribute("role");
    label.removeAttribute("aria-label");
    label.contentEditable = "inherit";
  }
  return label;
}

function applyVisual(
  el: HTMLElement,
  slot: Slot,
  width: number,
  height: number,
  radius: number,
  fill: string,
  ink: string,
  tracking = 0.02,
  bloom = false,
  shiftEm = 0,
  gradientTo = "",
  editing = false,
) {
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.borderRadius = `${radius}px`;
  el.style.maskImage = "";
  el.style.webkitMaskImage = "";

  if (slot.kind === "text") {
    const ring = slot.stroked && slot.shape !== "none";
    const bare = slot.shape === "none";
    const gradient = Boolean(slot.gradient) && !bare && !ring;
    const hideText = bloom && !bare;
    const liveEdit = editing && !bloom;
    el.classList.remove("chip-image", "chip-emoji");
    el.classList.toggle("chip-bare", bare || ring);
    el.classList.toggle("is-editing", liveEdit);
    el.style.background = bare || ring || gradient ? "transparent" : fill;
    el.style.color = hideText ? fill : ink;
    el.style.border = "none";
    el.style.fontFamily = `"${slot.fontFamily}", sans-serif`;
    el.style.fontWeight = String(slot.fontWeight);
    el.style.fontSize = `${slot.fontSize}px`;
    el.style.letterSpacing = `${tracking}em`;

    if (bare && !liveEdit && !slot.textAnim) {
      paintBareText(el, slot, width, height, tracking, ink, shiftEm);
      return;
    }

    if (liveEdit) el.querySelector(":scope > canvas")?.remove();

    const label = textLabel(el, liveEdit);
    if (label.parentElement !== el) {
      el.replaceChildren(label);
    } else {
      for (const child of [...el.children]) {
        if (
          child === label ||
          child.classList.contains("chip-fill") ||
          child.classList.contains("chip-ring") ||
          child.classList.contains("chip-scale-handle")
        ) {
          continue;
        }
        child.remove();
      }
    }

    if (bare) {
      el.querySelector(":scope > .chip-fill")?.remove();
      el.querySelector(":scope > .chip-ring")?.remove();
      el.style.boxShadow = "none";
    } else {
      paintFill(el, gradient, fill, gradientTo || fill, width, height, radius, slot.gradientAngle, slot.gradientScale, Boolean(slot.animatedGradient), slot.gradientSpeed);
      paintStroke(el, ring, gradient, slot.stroke, fill, label);
    }
    // While editing, the caret owns the text — don't clobber it from slot.
    if (!liveEdit) {
      if (hideText) {
        stopTextAnim(label);
        label.textContent = "";
      } else if (!applyTextAnim(label, slot)) {
        label.textContent = slot.text;
      }
    } else if (label.classList.contains("is-text-anim")) {
      stopTextAnim(label);
      label.textContent = slot.text;
    }
    label.style.transform = `translateY(${shiftEm}em)`;
    return;
  }

  el.classList.remove("is-editing");

  el.replaceChildren();
  el.style.border = "none";
  el.style.boxShadow = "none";
  el.style.color = "";
  el.style.fontFamily = "";
  el.style.fontWeight = "";
  el.style.fontSize = "";
  el.style.letterSpacing = "";

  if (slot.emoji) {
    el.classList.add("chip-emoji");
    el.classList.remove("chip-image", "chip-bare");
    el.style.background = "transparent";
    el.style.webkitMaskImage = "";
    el.style.maskImage = "";
    el.style.fontFamily = EMOJI_FONT;
    el.style.fontSize = `${Math.round(slot.size)}px`;
    el.textContent = slot.emoji;
    return;
  }

  const src = peekTrim(slot.src)?.displaySrc ?? slot.src;
  el.classList.add("chip-image");
  el.classList.remove("chip-bare", "chip-emoji");

  if (!isColorMask(slot)) {
    el.style.background = "transparent";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.draggable = false;
    el.append(img);
    return;
  }

  el.style.background = "transparent";
  const face = document.createElement("div");
  face.className = "chip-face";
  const sweep = Boolean(slot.gradient && gradientTo && slot.animatedGradient);
  if (slot.gradient && gradientTo && sweep) {
    face.classList.add("is-gradient-animated");
    face.style.background = "transparent";
    face.style.setProperty("--sweep-duration", `${gradientPeriodMs(slot.gradientSpeed) / 1000}s`);
    face.style.setProperty("--grad-angle", String(gradientAngleOf(slot.gradientAngle)));
    paintSweepBand(face, fill, gradientTo, width, height, radius, slot.gradientAngle, slot.gradientScale);
  } else {
    face.style.clipPath = "";
    face.style.background = slot.gradient && gradientTo ? pillGradient(fill, gradientTo, slot.gradientAngle, slot.gradientScale) : fill;
  }
  const mask = `url("${src}")`;
  face.style.webkitMaskImage = mask;
  face.style.maskImage = mask;
  face.style.webkitMaskSize = "contain";
  face.style.maskSize = "contain";
  face.style.webkitMaskRepeat = "no-repeat";
  face.style.maskRepeat = "no-repeat";
  face.style.webkitMaskPosition = "center";
  face.style.maskPosition = "center";
  el.append(face);
}

function readySlots(slots: Slot[]): Slot[] {
  return slots.filter((slot) => slot.kind === "text" || Boolean(slot.src || slot.emoji));
}

function shapeCopies(slot: Slot): number {
  if (slot.kind !== "image") return 1;
  return Math.max(1, Math.round(slot.amount));
}

function expandSlots(slots: Slot[]): Slot[] {
  const expanded: Slot[] = [];
  for (const slot of readySlots(slots)) {
    const copies = shapeCopies(slot);
    for (let i = 0; i < copies; i++) expanded.push(slot);
  }
  return expanded;
}

function glyphShift(slot: Slot): number {
  return slot.kind === "text" ? textShiftEm(slot.textHeight) : 0;
}

function slotFill(theme: ColorTheme, slot: Slot): string {
  return slot.color ?? pickTheme(theme, slot.colorIndex ?? 0);
}

function slotInk(theme: ColorTheme, slot: Slot): string {
  if (slot.kind !== "text") return slotFill(theme, slot);
  return resolveTextColor(theme, fillSample(theme, slot), shapeHasFill(slot), slot.textColorIndex, slot.textColor);
}

/** Built-in shapes and uploaded SVGs are silhouettes. Photos keep their pixels. */
export function isColorMask(slot: ImageSlot): boolean {
  if (presetIdForSrc(slot.src)) return true;
  if (/\.svg$/i.test(slot.name)) return true;
  return (
    slot.src.startsWith("data:image/svg") ||
    slot.src.includes("image/svg+xml") ||
    /\.svg(\?|$)/i.test(slot.src)
  );
}

function sizeJitter(unit: number, amount: number): number {
  const spread = (Math.max(0, Math.min(100, amount)) / 100) * SIZE_RANDOM_SPAN;
  return 1 + unit * spread;
}

/** Vertical half-extent of a rotated rectangle. Upright height underestimates a tilt. */
function tiltedHalfHeight(width: number, height: number, angle: number): number {
  return (width * Math.abs(Math.sin(angle)) + height * Math.abs(Math.cos(angle))) / 2;
}

/** Horizontal half-extent of a rotated rectangle. Upright width underestimates a tilt. */
function tiltedHalfWidth(width: number, height: number, angle: number): number {
  return (width * Math.abs(Math.cos(angle)) + height * Math.abs(Math.sin(angle))) / 2;
}

function layoutOf(slot: Slot, scale: number, pillPad: number, tracking: number) {
  const scaled = scaleSlot(slot, scale);
  const size = measureSlot(scaled, pillPadOf(slot, pillPad) / 50, trackingEm(trackingOf(slot, tracking)));
  const radius = cornerRadius(scaled, size);
  return { scaled, size, radius, chamfer: chamferFor(radius, size.width, size.height) };
}

function turnedSpan(size: { width: number; height: number }) {
  return Math.hypot(size.width, size.height);
}

/** Shrink until the chip fits between the side walls at any angle. */
function contained(
  slot: Slot,
  scale: number,
  pillPad: number,
  tracking: number,
  stageW: number,
) {
  const layout = layoutOf(slot, scale, pillPad, tracking);
  // Keep a few px inside the hard walls so growth never paints into the side void.
  const maxSpan = stageW - Math.max(8, EDGE * 2 + 6);
  if (stageW < 16 || turnedSpan(layout.size) <= maxSpan) return layout;
  const factor = maxSpan / turnedSpan(layout.size);
  const fitted = layoutOf(slot, scale * factor, pillPad, tracking);
  if (turnedSpan(fitted.size) <= maxSpan || fitted.size.width < 1) return fitted;
  return layoutOf(slot, scale * factor * (maxSpan / turnedSpan(fitted.size)), pillPad, tracking);
}

export function createWorld(options?: { paused?: boolean }): WorldHandle {
  const engine = Engine.create({ enableSleeping: true });
  const runner = Runner.create();
  let running = false;
  let spinDrag = 0;
  let contactSteps = 1;
  let physicsKey = "";
  let quality = PHYSICS_QUALITY.normal;
  let simScale = 1;
  let audioScaleBySlot = new Map<string, number>();
  let sides: Matter.Body[] = [];
  let floor: Matter.Body | null = null;
  let floorOpen = false;
  let bounds = { width: 0, height: 0 };
  let maxSpan = 0;
  let chips: DroppedChip[] = [];
  let layer: HTMLElement | null = null;
  let bloomLayer: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let mirrorScenes: HTMLElement[] = [];
  let onPick: ((slotId: string | null) => void) | null = null;
  let onMenu: ((slotId: string, x: number, y: number) => void) | null = null;
  let onEdit: ((slotId: string) => void) | null = null;
  let scaleOf: ((slotId: string) => number) | null = null;
  let onScale: ((slotId: string, scale: number, phase: "start" | "move" | "end") => void) | null = null;
  let pickedId: string | null = null;
  let editingId: string | null = null;
  let clickId: string | null = null;
  let drag: {
    chip: DroppedChip;
    pointerId: number;
    x: number;
    y: number;
    pin: Matter.Constraint;
  } | null = null;
  let pending: {
    chip: DroppedChip;
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null = null;
  let scaleDrag: {
    chip: DroppedChip;
    slotId: string;
    pointerId: number;
    startDist: number;
    startScale: number;
    lastScale: number;
    /** Body scale applied so far relative to drag start (1 = unchanged). */
    bodyFactor: number;
  } | null = null;
  let holdTimer = 0;
  let blank: { pointerId: number; x: number; y: number } | null = null;
  const prevVel = new Map<number, { x: number; y: number }>();
  const bounceCount = new Map<number, number>();
  let lastImpactAt = 0;

  function setRunning(on: boolean) {
    if (on && !running) {
      Runner.run(runner, engine);
      running = true;
    } else if (!on && running) {
      Runner.stop(runner);
      running = false;
    }
  }

  if (!options?.paused) setRunning(true);

  function noteSpan(width: number, height: number) {
    maxSpan = Math.max(maxSpan, Math.hypot(width, height));
  }

  function wallThick() {
    return Math.max(WALL, maxSpan * 0.55, 160);
  }

  /** Playfield CSS box — never the full stage (portrait letterbox is outside this). */
  function playfieldBox(stage: HTMLElement, chipLayer: HTMLElement | null) {
    const found = chipLayer?.closest(".playfield");
    const field = found instanceof HTMLElement ? found : null;
    return {
      width: field?.clientWidth || chipLayer?.parentElement?.clientWidth || stage.clientWidth,
      height: field?.clientHeight || chipLayer?.parentElement?.clientHeight || stage.clientHeight,
    };
  }

  /** Keep a chip fully between the hard side walls (no roof). */
  function pinInsideWalls(chip: DroppedChip) {
    if (bounds.width < 16) return;
    const mul = Math.max(chip.audioMul, 1) * scalePreviewFactor(chip.slotId);
    const reach = tiltedHalfWidth(chip.width, chip.height, chip.body.angle) * mul;
    const inset = EDGE + 1;
    const minX = inset + reach;
    const maxX = bounds.width - inset - reach;
    const { x, y } = chip.body.position;
    const nextX = minX > maxX ? bounds.width / 2 : Math.min(maxX, Math.max(minX, x));
    if (Math.abs(nextX - x) > 0.05) Body.setPosition(chip.body, { x: nextX, y });
  }

  /**
   * After a chip widens (typing / scale), stay inside the side walls and shove
   * overlapping neighbors up — never out into the side void.
   */
  function releaseGrowth(grown: DroppedChip[]) {
    if (grown.length === 0 || bounds.width < 16) return;
    for (const chip of grown) pinInsideWalls(chip);

    for (const chip of grown) {
      const gx = chip.body.position.x;
      const gy = chip.body.position.y;
      const gReach = Math.hypot(chip.width, chip.height) * 0.5 * Math.max(chip.audioMul, 1);
      for (const other of chips) {
        if (other === chip || other.body.isStatic) continue;
        const dx = other.body.position.x - gx;
        const dy = other.body.position.y - gy;
        const dist = Math.hypot(dx, dy) || 0.01;
        const reach = gReach + Math.hypot(other.width, other.height) * 0.5 * Math.max(other.audioMul, 1);
        if (dist >= reach) continue;
        const overlap = reach - dist;
        Sleeping.set(other.body, false);
        Body.setPosition(other.body, {
          x: other.body.position.x + (dx / dist) * overlap * 0.15,
          y: other.body.position.y - Math.max(overlap, 6) * 0.9,
        });
      }
    }

    wakeAll();
    if (!running) setRunning(true);
    separateOverlaps(true);
    for (const chip of chips) pinInsideWalls(chip);
  }

  function buildSides(width: number, height: number) {
    const t = wallThick();
    // No roof. Sides run far above the canvas so a tall pile stays walled in.
    const above = Math.max(height * 6, maxSpan * 8, 6000);
    const below = Math.max(height, 1200);
    const top = -above;
    const bottom = height + below;
    const tall = bottom - top;
    const midY = top + tall / 2;
    Composite.remove(engine.world, sides);
    sides = [
      Bodies.rectangle(EDGE - t / 2, midY, t, tall, surfaceProps()),
      Bodies.rectangle(width - EDGE + t / 2, midY, t, tall, surfaceProps()),
    ];
    Composite.add(engine.world, sides);
  }

  function setFloorOpen(open: boolean) {
    floorOpen = open;
    if (floor) {
      Composite.remove(engine.world, floor);
      floor = null;
    }
    if (!open && bounds.width > 0) {
      const t = wallThick();
      floor = Bodies.rectangle(bounds.width / 2, bounds.height - EDGE + t / 2, bounds.width + t * 4, t, surfaceProps());
      Composite.add(engine.world, floor);
    }
    if (open) wakeAll();
  }

  function resize(width: number, height: number) {
    bounds = { width, height };
    buildSides(width, height);
    setFloorOpen(floorOpen);
  }

  function refit(width: number, height: number, factor: number) {
    dropPin();
    cancelPending();
    const oldW = Math.max(1, bounds.width);
    const oldH = Math.max(1, bounds.height);
    const uniform = Math.abs(height - oldH) < 2 && Math.abs(factor - 1) > 0.0001;
    for (const chip of chips) {
      const { x, y } = chip.body.position;
      Body.setPosition(
        chip.body,
        uniform
          ? { x: width / 2 + (x - oldW / 2) * factor, y: height + (y - oldH) * factor }
          : { x: (x / oldW) * width, y: (y / oldH) * height },
      );
    }
    resize(width, height);
  }

  function purgeFallen(limitY: number) {
    chips = chips.filter((chip) => {
      const reach = Math.hypot(chip.width, chip.height) / 2;
      if (chip.body.position.y - reach < limitY + Math.max(480, reach + 240)) return true;
      if (pending?.chip === chip) cancelPending();
      if (drag?.chip === chip) dropPin();
      Composite.remove(engine.world, chip.body);
      stopTextAnimIn(chip.el);
      stopTextAnimIn(chip.glow);
      chip.el.remove();
      chip.glow.remove();
      for (const mirror of chip.mirrors) {
        mirror.face.remove();
        mirror.glow.remove();
      }
      return false;
    });
  }

  function dropPin() {
    if (!drag) return;
    Composite.remove(engine.world, drag.pin);
    drag.chip.el.classList.remove("is-held");
    drag = null;
  }

  function cancelPending() {
    window.clearTimeout(holdTimer);
    pending = null;
  }

  function beginDrag() {
    const armed = pending;
    if (!armed) return;
    window.clearTimeout(holdTimer);
    pending = null;
    clickId = null;
    const { chip, pointerId, x, y } = armed;
    const body = chip.body;
    dropPin();
    const pin = Constraint.create({
      pointA: { x, y },
      bodyB: body,
      pointB: { x: x - body.position.x, y: y - body.position.y },
      stiffness: GRAB_STIFFNESS,
      damping: GRAB_DAMPING,
      length: 0.01,
    });
    Object.assign(pin, { angularStiffness: 1 });
    Composite.add(engine.world, pin);
    drag = { chip, pointerId, x, y, pin };
    chip.el.classList.add("is-held");
    Sleeping.set(body, false);
    setRunning(true);
  }

  function clear() {
    cancelPending();
    dropPin();
    endScaleDrag();
    editingId = null;
    clickId = null;
    for (const chip of chips) {
      Composite.remove(engine.world, chip.body);
      stopTextAnimIn(chip.el);
      stopTextAnimIn(chip.glow);
      chip.el.remove();
      chip.glow.remove();
      for (const mirror of chip.mirrors) {
        mirror.face.remove();
        mirror.glow.remove();
      }
    }
    chips = [];
    bounceCount.clear();
    prevVel.clear();
    maxSpan = 0;
  }

  function applyPhysics(physics: PhysicsSettings) {
    const weight = chipWeight(physics);
    const complexity = physicsComplexity(physics.complexity);
    const key = `${weight}|${physics.gravity}|${physics.speed}|${physics.bounce}|${physics.friction}|${physics.grip}|${physics.spin}|${complexity}`;
    const changed = key !== physicsKey;
    physicsKey = key;
    quality = PHYSICS_QUALITY[complexity];
    engine.gravity.y = physics.gravity;
    engine.gravity.scale = GRAVITY_SCALE;
    engine.timing.timeScale = physics.speed;
    spinDrag = physics.spin;
    setSimulationScale(simScale);
    for (const chip of chips) {
      if (changed) applyWeight(chip.body, weight);
      chip.body.frictionAir = AIR_FRICTION;
      for (const part of chip.body.parts) {
        part.restitution = physics.bounce;
        part.friction = physics.friction;
        part.frictionStatic = physics.grip;
        part.frictionAir = AIR_FRICTION;
      }
      if (changed) Sleeping.set(chip.body, false);
    }
  }

  function solidParts(body: Matter.Body): Matter.Body[] {
    return body.parts.length > 1 ? body.parts.slice(1) : body.parts;
  }

  function boundsMiss(a: Matter.Body, b: Matter.Body): boolean {
    return a.bounds.max.x < b.bounds.min.x || a.bounds.min.x > b.bounds.max.x
      || a.bounds.max.y < b.bounds.min.y || a.bounds.min.y > b.bounds.max.y;
  }

  function pushScale(body: Matter.Body, hard = false): number {
    if (body.isStatic || body === drag?.chip.body || isScaleBody(body)) return 0;
    // Soft passes leave sleepers alone so settle/loop aren't fought awake.
    if (!hard && body.isSleeping) return 0;
    return body.inverseMass;
  }

  function isScaleBody(body: Matter.Body) {
    if (!scaleDrag) return false;
    return chips.some((chip) => chip.slotId === scaleDrag!.slotId && chip.body === body);
  }

  function resolveOverlap(a: Matter.Body, b: Matter.Body, hard = false): boolean {
    if ((a.isStatic || a === drag?.chip.body || isScaleBody(a)) && (b.isStatic || b === drag?.chip.body || isScaleBody(b))) {
      return false;
    }
    if (boundsMiss(a, b)) return false;

    let best: Matter.Collision | null = null;
    const aParts = solidParts(a);
    const bParts = solidParts(b);
    for (let pa = 0; pa < aParts.length; pa++) {
      const partA = aParts[pa];
      for (let pb = 0; pb < bParts.length; pb++) {
        const partB = bParts[pb];
        if (boundsMiss(partA, partB)) continue;
        const hit = Collision.collides(partA, partB);
        if (hit && (!best || hit.depth > best.depth)) best = hit;
      }
    }
    if (!best || best.depth <= (hard ? 0 : quality.overlapAllow)) return false;

    const parentA = best.parentA;
    const parentB = best.parentB;
    // A lively chip into a sleeping island: wake neighbors so soft pushes share
    // instead of slamming 100% into the thrown body (reads as settle jitter).
    const scaling = Boolean(scaleDrag);
    const incoming =
      hard ||
      scaling ||
      parentA.speed > QUIET_SEPARATE_SPEED ||
      parentB.speed > QUIET_SEPARATE_SPEED ||
      parentA === drag?.chip.body ||
      parentB === drag?.chip.body;

    // Sleep-island dig: fix frozen intersections with position only — never wake.
    // Waking here used to reset the settle clock every frame so Loop never opened.
    const sleepIsland =
      !hard &&
      !scaling &&
      parentA.isSleeping &&
      parentB.isSleeping &&
      parentA !== drag?.chip.body &&
      parentB !== drag?.chip.body;

    const invA = sleepIsland
      ? (parentA.isStatic ? 0 : parentA.inverseMass)
      : pushScale(parentA, hard);
    const invB = sleepIsland
      ? (parentB.isStatic ? 0 : parentB.inverseMass)
      : pushScale(parentB, hard);
    const share = invA + invB;
    if (share === 0) return false;

    if (incoming && !sleepIsland) {
      if (parentA.isSleeping && !parentA.isStatic) Sleeping.set(parentA, false);
      if (parentB.isSleeping && !parentB.isStatic) Sleeping.set(parentB, false);
    }

    const nx = best.normal.x;
    const ny = best.normal.y;
    // Soft correction for normal settle; hard digs out audio-growth penetration fully.
    // Scale-drag prefers position nudges only — velocity kicks read as bounce jitter.
    const allow = hard ? 0 : quality.overlapAllow;
    const remainder = best.depth - allow;
    const soft = hard
      ? remainder
      : Math.min(remainder * (sleepIsland ? 0.9 : 0.4), quality.maxPush);
    const push = soft / share;
    if (invA) Body.setPosition(parentA, { x: parentA.position.x + nx * push * invA, y: parentA.position.y + ny * push * invA });
    if (invB) Body.setPosition(parentB, { x: parentB.position.x - nx * push * invB, y: parentB.position.y - ny * push * invB });

    // Near rest / sleep islands / live scale: position nudges only — velocity kicks re-wake the pile.
    if (!incoming || sleepIsland || scaling) return true;

    const relN = (parentB.velocity.x - parentA.velocity.x) * nx + (parentB.velocity.y - parentA.velocity.y) * ny;
    if (relN > 0) {
      if (invA) {
        Body.setVelocity(parentA, {
          x: parentA.velocity.x + nx * relN * invA / share,
          y: parentA.velocity.y + ny * relN * invA / share,
        });
      }
      if (invB) {
        Body.setVelocity(parentB, {
          x: parentB.velocity.x - nx * relN * invB / share,
          y: parentB.velocity.y - ny * relN * invB / share,
        });
      }
    }
    return true;
  }

  function separateOverlaps(hard: false | true | "audio" = false) {
    if (chips.length === 0) return;
    const intense = hard === "audio";
    const force = Boolean(hard);
    // Soft digs on a fully sleeping pile desync DOM during hold (no sync) and
    // flash as a snap the frame Loop opens the floor.
    if (!force && !drag && !scaleDrag && chips.every((chip) => chip.body.isSleeping)) return;

    const bodies: Matter.Body[] = [];
    for (const chip of chips) bodies.push(chip.body);
    for (const side of sides) bodies.push(side);
    if (floor) bodies.push(floor);

    const cell = Math.max(48, maxSpan * 0.35);
    const n = bodies.length;

    // Full multi-pass separation while calm blows the Matter runner budget and
    // deferred steps read as frameskip during settle after a throw.
    let passes = quality.separatePasses;
    if (intense) {
      // Audio growth can dig many bodies into each other at once — need room to Gauss-Seidel out.
      passes = Math.max(passes, 48);
    } else if (force) {
      passes = Math.max(passes, 18);
    } else if (!drag) {
      let peak = 0;
      let allSleeping = true;
      for (const chip of chips) {
        peak = Math.max(peak, chip.body.speed, Math.abs(chip.body.angularVelocity) * 10);
        if (!chip.body.isSleeping) allSleeping = false;
      }
      // Calm piles still dig out residual overlaps (position only) — never leave
      // intersections frozen in a sleep island — but keep the pass budget small.
      if (allSleeping || peak < QUIET_SEPARATE_SPEED) passes = Math.min(passes, 6);
      else if (peak < 2) passes = Math.min(passes, 10);
    }

    for (let pass = 0; pass < passes; pass++) {
      let moved = false;
      const grid = new Map<string, number[]>();
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        const x0 = Math.floor(b.bounds.min.x / cell);
        const y0 = Math.floor(b.bounds.min.y / cell);
        const x1 = Math.floor(b.bounds.max.x / cell);
        const y1 = Math.floor(b.bounds.max.y / cell);
        for (let gx = x0; gx <= x1; gx++) {
          for (let gy = y0; gy <= y1; gy++) {
            const key = `${gx},${gy}`;
            const bucket = grid.get(key);
            if (bucket) bucket.push(i);
            else grid.set(key, [i]);
          }
        }
      }

      const seen = new Set<number>();
      for (const bucket of grid.values()) {
        for (let a = 0; a < bucket.length; a++) {
          for (let b = a + 1; b < bucket.length; b++) {
            const i = bucket[a];
            const j = bucket[b];
            const lo = i < j ? i : j;
            const hi = i < j ? j : i;
            const id = lo * n + hi;
            if (seen.has(id)) continue;
            seen.add(id);
            if (resolveOverlap(bodies[i], bodies[j], force)) moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

  /** Bleed leftover motion once the pile is nearly still so sleep always arrives. */
  function dampTowardSleep() {
    if (drag || chips.length === 0) return;
    let peak = 0;
    for (const chip of chips) {
      if (chip.body.isSleeping) continue;
      peak = Math.max(peak, chip.body.speed, Math.abs(chip.body.angularVelocity) * 8);
    }
    if (peak === 0 || peak > SETTLE_DAMP_SPEED) return;
    // Light ease only — strong kills read as a hard brake before hold/freeze.
    const t = 1 - peak / SETTLE_DAMP_SPEED;
    const keep = Math.pow(1 - (0.03 + 0.1 * t), 1 / contactSteps);
    for (const chip of chips) {
      if (chip.body.isSleeping) continue;
      const body = chip.body;
      Body.setVelocity(body, { x: body.velocity.x * keep, y: body.velocity.y * keep });
      Body.setAngularVelocity(body, body.angularVelocity * keep);
    }
  }

  Events.on(engine, "beforeUpdate", () => {
    prevVel.clear();
    for (const chip of chips) {
      const { x, y } = chip.body.velocity;
      prevVel.set(chip.body.id, { x, y });
    }
    if (spinDrag > 0) {
      const keep = Math.pow(1 - spinDrag, 1 / contactSteps);
      for (const chip of chips) {
        if (!chip.body.isSleeping) Body.setAngularVelocity(chip.body, chip.body.angularVelocity * keep);
      }
    }
    // Once the pile is nearly still, bleed residual slide/spin so Matter sleep
    // (and the floor/loop settle gate) always arrives — even on low friction.
    dampTowardSleep();
  });

  Events.on(engine, "collisionStart", (event) => {
    let best = 0;
    let bestBody: Matter.Body | null = null;
    for (const pair of event.pairs) {
      const { bodyA, bodyB, collision } = pair;
      const va = bodyA.isStatic ? { x: 0, y: 0 } : (prevVel.get(bodyA.id) ?? bodyA.velocity);
      const vb = bodyB.isStatic ? { x: 0, y: 0 } : (prevVel.get(bodyB.id) ?? bodyB.velocity);
      const closing = Math.abs((va.x - vb.x) * collision.normal.x + (va.y - vb.y) * collision.normal.y);
      if (closing < best) continue;
      best = closing;
      const speedA = bodyA.isStatic ? 0 : Math.hypot(va.x, va.y);
      const speedB = bodyB.isStatic ? 0 : Math.hypot(vb.x, vb.y);
      bestBody = speedA >= speedB ? (bodyA.isStatic ? bodyB : bodyA) : bodyB.isStatic ? bodyA : bodyB;
    }
    if (best < IMPACT_SPEED || !bestBody || bestBody.isStatic) return;
    const chip = chips.find((item) => item.body === bestBody || item.body.id === bestBody.id);
    if (!chip) return;
    const now = performance.now();
    if (now - lastImpactAt < IMPACT_COOLDOWN_MS) return;
    lastImpactAt = now;
    const bounceIndex = bounceCount.get(chip.body.id) ?? 0;
    bounceCount.set(chip.body.id, bounceIndex + 1);
    const speedFactor = Math.min(1, best / IMPACT_FULL_SPEED);
    playImpact(chip.slotId, bounceIndex, speedFactor);
  });

  Events.on(engine, "afterUpdate", () => {
    // While bass/sharp scale is live, keep hard-depenetrating so Matter soft contacts
    // can't leave the enlarged pile intersecting.
    if (chips.some((chip) => Math.abs(chip.audioMul - 1) > 0.002)) separateOverlaps(true);
    else separateOverlaps();
  });

  function discardChip(chip: DroppedChip) {
    if (pending?.chip === chip) cancelPending();
    if (drag?.chip === chip) dropPin();
    if (editingId === chip.slotId) editingId = null;
    bounceCount.delete(chip.body.id);
    Composite.remove(engine.world, chip.body);
    const nodes = [chip.el, chip.glow, ...chip.mirrors.flatMap((mirror) => [mirror.face, mirror.glow])];
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
    if (duration === 0) {
      for (const node of nodes) node.remove();
      return;
    }
    for (const node of nodes) {
      node.style.pointerEvents = "none";
      const anim = node.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration,
        easing: "ease",
        fill: "forwards",
      });
      anim.finished.then(() => node.remove()).catch(() => node.remove());
    }
  }

  function replaceBody(
    chip: DroppedChip,
    slot: Slot,
    size: { width: number; height: number },
    chamfer: number,
    physics: PhysicsSettings,
  ) {
    if (drag?.chip === chip) dropPin();
    const { position, angle, velocity, angularVelocity } = chip.body;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const visualX = position.x + chip.anchorX * cos - chip.anchorY * sin;
    const visualY = position.y + chip.anchorX * sin + chip.anchorY * cos;
    Composite.remove(engine.world, chip.body);
    const { body, anchor } = chipBody(
      slot,
      visualX,
      visualY,
      size.width,
      size.height,
      physics,
      chamfer,
      angle,
    );
    Body.setVelocity(body, velocity);
    Body.setAngularVelocity(body, angularVelocity);
    Composite.add(engine.world, body);
    const priorBounces = bounceCount.get(chip.body.id) ?? 0;
    bounceCount.delete(chip.body.id);
    bounceCount.set(body.id, priorBounces);
    chip.body = body;
    chip.anchorX = anchor.x;
    chip.anchorY = anchor.y;
    chip.meshKey = meshKey(slot, size.width, size.height, chamfer, physicsComplexity(physics.complexity));
    chip.width = size.width;
    chip.height = size.height;
    chip.chamfer = chamfer;
    if (chip.audioMul !== 1) Body.scale(body, chip.audioMul, chip.audioMul);
    if (chip.slotId === editingId) Body.setStatic(body, true);
    noteSpan(size.width, size.height);
    buildSides(bounds.width, bounds.height);
    setFloorOpen(floorOpen);
    seat(chip);
  }

  function spawnChip(
    slot: Slot,
    x: number,
    y: number,
    angle: number,
    sizeUnit: number,
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
    seqIndex: number,
    seqTotal: number,
  ) {
    const { scaled, size, radius, chamfer } = contained(
      slot,
      scale * sizeJitter(sizeUnit, sizeRandom),
      pillPad,
      tracking,
      bounds.width,
    );
    noteSpan(size.width, size.height);
    const { body, anchor } = chipBody(
      slot,
      x,
      y,
      size.width,
      size.height,
      physics,
      chamfer,
      angle,
    );
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);

    const el = document.createElement("div");
    const glow = document.createElement("div");
    el.className = "chip";
    glow.className = "chip";
    const chip: DroppedChip = {
      slotId: slot.id,
      seqIndex,
      seqTotal,
      body,
      el,
      glow,
      mirrors: [],
      width: size.width,
      height: size.height,
      chamfer,
      anchorX: anchor.x,
      anchorY: anchor.y,
      meshKey: meshKey(slot, size.width, size.height, chamfer, physicsComplexity(physics.complexity)),
      sizeUnit,
      look: null,
      audioMul: 1,
    };
    mountMirrors(chip);
    paint(chip, scaled, size, radius, theme, trackingEm(trackingOf(slot, tracking)), glyphShift(slot));
    seat(chip);
    layer!.append(el);
    bloomLayer!.append(glow);
    Composite.add(engine.world, body);
    chips.push(chip);
    return chip;
  }

  function refresh(
    slots: Slot[],
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
  ) {
    applyPhysics(physics);
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const falling = expandSlots(slots);
    const want = new Map<string, number>();
    for (const slot of falling) {
      want.set(slot.id, (want.get(slot.id) ?? 0) + 1);
    }

    let removed = 0;
    const grown: DroppedChip[] = [];
    chips = chips.filter((chip) => {
      const slot = byId.get(chip.slotId);
      if (!slot || (slot.kind === "image" && !slot.src && !slot.emoji)) {
        discardChip(chip);
        removed += 1;
        return false;
      }

      const prevW = chip.width;
      const prevH = chip.height;
      const { scaled, size, radius, chamfer } = contained(
        slot,
        scale * sizeJitter(chip.sizeUnit, sizeRandom),
        pillPad,
        tracking,
        bounds.width,
      );
      paint(chip, scaled, size, radius, theme, trackingEm(trackingOf(slot, tracking)), glyphShift(slot));
      if (chip.meshKey !== meshKey(slot, size.width, size.height, chamfer, physicsComplexity(physics.complexity))) {
        replaceBody(chip, slot, size, chamfer, physics);
        if (size.width > prevW + 1 || size.height > prevH + 1) grown.push(chip);
      }
      return true;
    });

    const kept = new Map<string, number>();
    chips = chips.filter((chip) => {
      const n = (kept.get(chip.slotId) ?? 0) + 1;
      if (n > (want.get(chip.slotId) ?? 0)) {
        discardChip(chip);
        removed += 1;
        return false;
      }
      kept.set(chip.slotId, n);
      return true;
    });

    if (!layer || !bloomLayer || bounds.width < 8) {
      paintPicked();
      return;
    }

    // Keep new chips on-screen (playfield clips overflow). Drop them just above the
    // pile — or into the upper field when empty — so one seat() already shows them.
    const pileTop =
      chips.length > 0
        ? Math.min(
            ...chips.map(
              (chip) => chip.body.position.y - Math.hypot(chip.width, chip.height) / 2,
            ),
          )
        : bounds.height * 0.35;
    let spawnY = Math.max(48, Math.min(pileTop - 28, bounds.height * 0.45));
    let added = 0;

    for (const [id, need] of want) {
      const slot = byId.get(id);
      if (!slot) continue;
      let have = kept.get(id) ?? 0;
      while (have < need) {
        const sizeUnit = Math.random() * 2 - 1;
        const layout = contained(
          slot,
          scale * sizeJitter(sizeUnit, sizeRandom),
          pillPad,
          tracking,
          bounds.width,
        );
        const reach = Math.hypot(layout.size.width, layout.size.height) / 2;
        const inset = Math.min(Math.max(reach + 12, 24), Math.max(24, bounds.width / 2 - 8));
        const span = Math.max(0, bounds.width - inset * 2);
        const x = inset + Math.random() * span;
        const tight = layout.size.width > bounds.width * 0.65;
        const angle = (Math.random() - 0.5) * (tight ? 0.12 : 0.8);
        const half = tiltedHalfHeight(layout.size.width, layout.size.height, angle);
        const y = Math.max(half + 8, spawnY);
        spawnY = y - half - 12;
        const chip = spawnChip(
          slot,
          x,
          y,
          angle,
          sizeUnit,
          physics,
          scale,
          theme,
          pillPad,
          tracking,
          sizeRandom,
          chips.length,
          falling.length,
        );
        // Nudge so the frame loop treats the pile as busy and keeps syncing.
        Body.setVelocity(chip.body, { x: (Math.random() - 0.5) * 2, y: 2 });
        have += 1;
        kept.set(id, have);
        added += 1;
      }
    }

    if (added > 0 || removed > 0) {
      buildSides(bounds.width, bounds.height);
      setFloorOpen(floorOpen);
      wakeAll();
      // Live edits should still disturb a stopped pile.
      if (!running) setRunning(true);
    }
    if (grown.length > 0) releaseGrowth(grown);
    // seat() alone is enough for the first paint; sync again so any body nudges show up
    // even when main's phase is idle and the frame loop skips sync.
    sync();
    paintPicked();
  }

  function refreshSlot(
    slotId: string,
    slots: Slot[],
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
    opts?: { quiet?: boolean },
  ) {
    const slot = slots.find((item) => item.id === slotId);
    if (!slot) return;
    applyPhysics(physics);
    const grown: DroppedChip[] = [];
    for (const chip of chips) {
      if (chip.slotId !== slotId) continue;
      const prevW = chip.width;
      const prevH = chip.height;
      const { scaled, size, radius, chamfer } = contained(
        slot,
        scale * sizeJitter(chip.sizeUnit, sizeRandom),
        pillPad,
        tracking,
        bounds.width,
      );
      paint(chip, scaled, size, radius, theme, trackingEm(trackingOf(slot, tracking)), glyphShift(slot));
      if (chip.meshKey !== meshKey(slot, size.width, size.height, chamfer, physicsComplexity(physics.complexity))) {
        replaceBody(chip, slot, size, chamfer, physics);
        if (size.width > prevW + 1 || size.height > prevH + 1) grown.push(chip);
      }
    }
    if (grown.length > 0) {
      // Quiet: live scale already depenetrated — remesh without the upward shove.
      if (opts?.quiet) {
        for (const chip of grown) pinInsideWalls(chip);
        separateOverlaps(true);
      } else {
        releaseGrowth(grown);
      }
    }
    sync();
  }

  function play(
    slots: Slot[],
    physics: PhysicsSettings,
    stage: HTMLElement,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
  ) {
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-inner") ?? stage.querySelector(".bloom-blur");
    stageEl = stage;
    mirrorScenes = frostScenes();
    if (!layer || !bloomLayer) return;

    clear();
    applyPhysics(physics);

    const falling = expandSlots(slots);
    const box = playfieldBox(stage, layer);
    const stageW = box.width;
    const stageH = box.height;
    const sizeUnits = falling.map(() => Math.random() * 2 - 1);
    const layouts = falling.map((slot, index) =>
      contained(slot, scale * sizeJitter(sizeUnits[index], sizeRandom), pillPad, tracking, stageW),
    );
    maxSpan = 0;
    for (const { size } of layouts) noteSpan(size.width, size.height);
    floorOpen = false;
    resize(stageW, stageH);

    let spawnY = -160;

    falling.forEach((slot, index) => {
      const { size } = layouts[index];
      const reach = Math.hypot(size.width, size.height) / 2;
      const inset = Math.min(Math.max(reach + 12, 24), Math.max(24, stageW / 2 - 8));
      const span = Math.max(0, stageW - inset * 2);
      const x = inset + Math.random() * span;
      const tight = size.width > stageW * 0.65;
      const angle = (Math.random() - 0.5) * (tight ? 0.12 : 0.8);
      const half = tiltedHalfHeight(size.width, size.height, angle);
      spawnY -= half + 16;
      const y = spawnY;
      spawnY -= half;
      spawnChip(
        slot,
        x,
        y,
        angle,
        sizeUnits[index],
        physics,
        scale,
        theme,
        pillPad,
        tracking,
        sizeRandom,
        index,
        falling.length,
      );
    });
    paintPicked();
  }

  function poses(): ChipPose[] {
    return chips.map((chip) => ({
      slotId: chip.slotId,
      seqIndex: chip.seqIndex,
      sizeUnit: chip.sizeUnit,
      x: chip.body.position.x,
      y: chip.body.position.y,
      angle: chip.body.angle,
    }));
  }

  function restore(
    slots: Slot[],
    physics: PhysicsSettings,
    stage: HTMLElement,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    sizeRandom: number,
    saved: ChipPose[],
    frame: { width: number; height: number },
  ) {
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-inner") ?? stage.querySelector(".bloom-blur");
    stageEl = stage;
    mirrorScenes = frostScenes();
    if (!layer || !bloomLayer) return;

    clear();
    applyPhysics(physics);

    const box = playfieldBox(stage, layer);
    const stageW = box.width;
    const stageH = box.height;
    const sx = frame.width > 0 ? stageW / frame.width : 1;
    const sy = frame.height > 0 ? stageH / frame.height : 1;

    floorOpen = false;
    maxSpan = 0;
    resize(stageW, stageH);

    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const total = saved.length;

    saved.forEach((pose) => {
      const slot = byId.get(pose.slotId);
      if (!slot || (slot.kind === "image" && !slot.src && !slot.emoji)) return;
      spawnChip(
        slot,
        pose.x * sx,
        pose.y * sy,
        pose.angle,
        pose.sizeUnit,
        physics,
        scale,
        theme,
        pillPad,
        tracking,
        sizeRandom,
        pose.seqIndex,
        total,
      );
      const chip = chips[chips.length - 1];
      if (!chip) return;
      Body.setVelocity(chip.body, { x: 0, y: 0 });
      Body.setAngularVelocity(chip.body, 0);
      Sleeping.set(chip.body, true);
      seat(chip);
    });
    paintPicked();
  }

  function paintPicked() {
    for (const chip of chips) {
      const on = chip.slotId === pickedId;
      chip.el.classList.toggle("is-picked", on);
      if (on) ensureScaleHandles(chip.el);
    }
  }

  function ensureScaleHandles(el: HTMLElement) {
    if (el.querySelector(":scope > .chip-scale-handle")) return;
    for (const corner of SCALE_CORNERS) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `chip-scale-handle chip-scale-handle--${corner}`;
      handle.dataset.corner = corner;
      handle.tabIndex = -1;
      handle.setAttribute("aria-label", "Scale");
      el.append(handle);
    }
  }

  function clampScale(value: number) {
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value * 100) / 100));
  }

  function endScaleDrag() {
    if (!scaleDrag) return;
    const { lastScale, slotId } = scaleDrag;
    scaleDrag = null;
    for (const item of chips) {
      if (item.slotId !== slotId) continue;
      item.el.classList.remove("is-scaling");
      item.el.style.removeProperty("--scale-preview");
      if (item.slotId !== editingId && item.body.isStatic) Body.setStatic(item.body, false);
    }
    onScale?.(slotId, lastScale, "end");
  }

  function lockScale(slotId: string) {
    dropPin();
    cancelPending();
    for (const chip of chips) {
      if (chip.slotId !== slotId) continue;
      Body.setVelocity(chip.body, { x: 0, y: 0 });
      Body.setAngularVelocity(chip.body, 0);
      Body.setStatic(chip.body, true);
      chip.el.classList.add("is-scaling");
      seat(chip);
    }
  }

  function scalePreviewFactor(slotId: string) {
    if (!scaleDrag || scaleDrag.slotId !== slotId) return 1;
    return scaleDrag.bodyFactor;
  }

  /** Grow/shrink the held chip's collider in place and gently depenetrate neighbors. */
  function applyLiveScale(next: number) {
    if (!scaleDrag) return;
    const nextFactor = next / scaleDrag.startScale;
    const delta = nextFactor / scaleDrag.bodyFactor;
    if (Math.abs(delta - 1) > 0.0005) {
      for (const chip of chips) {
        if (chip.slotId !== scaleDrag.slotId) continue;
        Body.scale(chip.body, delta, delta);
        pinInsideWalls(chip);
      }
      scaleDrag.bodyFactor = nextFactor;
      if (!running) setRunning(true);
      // Hard position dig (no releaseGrowth shove) — neighbors slide away as we swell.
      separateOverlaps(true);
    }
    scaleDrag.lastScale = next;
    for (const chip of chips) seat(chip);
  }

  function setPicked(slotId: string | null) {
    pickedId = slotId;
    paintPicked();
  }

  function chipEl(slotId: string): HTMLElement | null {
    return chips.find((chip) => chip.slotId === slotId)?.el ?? null;
  }

  function unlockEdit(chip: DroppedChip) {
    if (chip.body.isStatic) Body.setStatic(chip.body, false);
  }

  function lockEdit(chip: DroppedChip) {
    dropPin();
    cancelPending();
    Body.setVelocity(chip.body, { x: 0, y: 0 });
    Body.setAngularVelocity(chip.body, 0);
    Body.setStatic(chip.body, true);
    seat(chip);
  }

  function setEditing(slotId: string | null) {
    if (editingId === slotId) return;
    if (editingId) {
      const prev = chips.find((item) => item.slotId === editingId);
      if (prev) unlockEdit(prev);
    }
    editingId = slotId;
    if (!slotId) return;
    const chip = chips.find((item) => item.slotId === slotId);
    if (!chip) {
      editingId = null;
      return;
    }
    lockEdit(chip);
  }

  function wakeAll() {
    for (const chip of chips) Sleeping.set(chip.body, false);
  }

  /** Lock the pile in place for the floor-pause / end-of-run hold. */
  function freezePile() {
    dropPin();
    cancelPending();
    endScaleDrag();
    for (const chip of chips) {
      Body.setVelocity(chip.body, { x: 0, y: 0 });
      Body.setAngularVelocity(chip.body, 0);
      Sleeping.set(chip.body, true);
      seat(chip);
    }
  }

  function stagePoint(event: PointerEvent) {
    const rect = (layer?.parentElement ?? stageEl)?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pullDrag() {
    if (!drag) return;
    Sleeping.set(drag.chip.body, false);
    drag.pin.pointA = { x: drag.x, y: drag.y };
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".chip-edit")) return;

    const handle = target?.closest?.(".chip-scale-handle");
    if (handle instanceof HTMLElement) {
      const el = handle.closest(".chip");
      if (!(el instanceof HTMLElement) || el.closest(".bloom-layer")) return;
      const chip = chips.find((item) => item.el === el);
      if (!chip || chip.slotId === editingId) return;
      event.preventDefault();
      event.stopPropagation();
      blank = null;
      clickId = null;
      cancelPending();
      dropPin();
      endScaleDrag();
      const point = stagePoint(event);
      const dx = point.x - chip.body.position.x;
      const dy = point.y - chip.body.position.y;
      const startDist = Math.max(8, Math.hypot(dx, dy));
      const startScale = clampScale(scaleOf?.(chip.slotId) ?? 1);
      scaleDrag = {
        chip,
        slotId: chip.slotId,
        pointerId: event.pointerId,
        startDist,
        startScale,
        lastScale: startScale,
        bodyFactor: 1,
      };
      lockScale(chip.slotId);
      handle.setPointerCapture(event.pointerId);
      onScale?.(chip.slotId, startScale, "start");
      return;
    }

    const el = target?.closest?.(".chip");
    if (!(el instanceof HTMLElement) || el.closest(".bloom-layer")) {
      clickId = null;
      if (event.currentTarget === stageEl) blank = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    const chip = chips.find((item) => item.el === el);
    if (!chip) return;
    if (chip.slotId === editingId) return;
    blank = null;
    clickId = null;
    el.setPointerCapture(event.pointerId);
    const point = stagePoint(event);
    cancelPending();
    dropPin();
    pending = {
      chip,
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
      originX: event.clientX,
      originY: event.clientY,
    };
    holdTimer = window.setTimeout(beginDrag, HOLD_DRAG_MS);
  }

  function onContextMenu(event: MouseEvent) {
    const el = (event.target as HTMLElement | null)?.closest?.(".chip");
    if (!(el instanceof HTMLElement) || el.closest(".bloom-layer")) return;
    const chip = chips.find((item) => item.el === el);
    if (!chip) return;
    event.preventDefault();
    onMenu?.(chip.slotId, event.clientX, event.clientY);
  }

  function onPointerMove(event: PointerEvent) {
    if (scaleDrag && event.pointerId === scaleDrag.pointerId) {
      const point = stagePoint(event);
      const dx = point.x - scaleDrag.chip.body.position.x;
      const dy = point.y - scaleDrag.chip.body.position.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const next = clampScale(scaleDrag.startScale * (dist / scaleDrag.startDist));
      if (next === scaleDrag.lastScale) return;
      applyLiveScale(next);
      onScale?.(scaleDrag.slotId, next, "move");
      return;
    }
    if (blank && event.pointerId === blank.pointerId) {
      const dx = event.clientX - blank.x;
      const dy = event.clientY - blank.y;
      if (dx * dx + dy * dy > CLICK_SLOP * CLICK_SLOP) blank = null;
    }
    if (pending && event.pointerId === pending.pointerId) {
      const point = stagePoint(event);
      pending.x = point.x;
      pending.y = point.y;
      const dx = event.clientX - pending.originX;
      const dy = event.clientY - pending.originY;
      if (dx * dx + dy * dy > CLICK_SLOP * CLICK_SLOP) beginDrag();
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = stagePoint(event);
    drag.x = point.x;
    drag.y = point.y;
    pullDrag();
  }

  function onPointerUp(event: PointerEvent) {
    if (scaleDrag && event.pointerId === scaleDrag.pointerId) {
      endScaleDrag();
      return;
    }
    if (blank && event.pointerId === blank.pointerId) {
      blank = null;
      onPick?.(null);
      return;
    }
    if (pending && event.pointerId === pending.pointerId) {
      clickId = pending.chip.slotId;
      cancelPending();
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    dropPin();
  }

  function onClick(event: MouseEvent) {
    if (!clickId) return;
    const id = clickId;
    clickId = null;
    if (event.detail >= 2) {
      onEdit?.(id);
      return;
    }
    onPick?.(id);
  }

  function onPointerCancel(event: PointerEvent) {
    if (scaleDrag && event.pointerId === scaleDrag.pointerId) {
      endScaleDrag();
      return;
    }
    if (blank && event.pointerId === blank.pointerId) blank = null;
    if (pending && event.pointerId === pending.pointerId) cancelPending();
    clickId = null;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dropPin();
  }

  function attach(
    stage: HTMLElement,
    pick?: (slotId: string | null) => void,
    menu?: (slotId: string, x: number, y: number) => void,
    edit?: (slotId: string) => void,
    readScale?: (slotId: string) => number,
    scale?: (slotId: string, value: number, phase: "start" | "move" | "end") => void,
  ) {
    onPick = pick ?? null;
    onMenu = menu ?? null;
    onEdit = edit ?? null;
    scaleOf = readScale ?? null;
    onScale = scale ?? null;
    stageEl = stage;
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-inner") ?? stage.querySelector(".bloom-blur");
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("click", onClick);
    stage.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function motionLow(speedLimit: number, spinLimit: number) {
    if (drag || scaleDrag || chips.length === 0) return false;
    return chips.every((chip) => {
      if (chip.body.isSleeping) return true;
      return chip.body.speed < speedLimit && Math.abs(chip.body.angularVelocity) < spinLimit;
    });
  }

  function isSettled() {
    if (drag || scaleDrag || chips.length === 0) return false;
    // Prefer Matter sleep — that's when friction has actually finished.
    if (chips.every((chip) => chip.body.isSleeping)) return true;
    return motionLow(SETTLED_SPEED, SETTLED_SPIN);
  }

  function isQuiet() {
    // Gate DOM sync on real sleep — not a high speed threshold. Syncing only
    // while speed ≥ ~1 left friction slides invisible until the next wake/snap.
    if (drag || scaleDrag) return false;
    return chips.length === 0 || chips.every((chip) => chip.body.isSleeping);
  }

  function isDragging() {
    return Boolean(drag || scaleDrag);
  }

  function frostScenes(): HTMLElement[] {
    return [];
  }

  function copyLook(from: HTMLElement, to: HTMLElement) {
    to.className = "chip is-mirror";
    if (from.classList.contains("chip-bare")) to.classList.add("chip-bare");
    if (from.classList.contains("chip-image")) to.classList.add("chip-image");
    if (from.classList.contains("chip-emoji")) to.classList.add("chip-emoji");
    to.style.cssText = from.style.cssText;
    to.replaceChildren();
    for (const child of from.childNodes) to.append(child.cloneNode(true));
  }

  function mountMirrors(chip: DroppedChip) {
    chip.mirrors = [];
  }

  function refreshFrost() {
    if (mirrorScenes.length === 0) return;
    for (const chip of chips) {
      for (const mirror of chip.mirrors) {
        mirror.face.remove();
        mirror.glow.remove();
      }
      chip.mirrors = [];
    }
    mirrorScenes = [];
  }

  function place(
    el: HTMLElement,
    x: number,
    y: number,
    angle: number,
    width: number,
    height: number,
    anchorX: number,
    anchorY: number,
    audioScale = 1,
  ) {
    const originX = width / 2 - anchorX;
    const originY = height / 2 - anchorY;
    el.style.transformOrigin = `${originX}px ${originY}px`;
    const scalePart = audioScale === 1 ? "" : ` scale(${audioScale})`;
    el.style.transform = `translate(${x - originX}px, ${y - originY}px) rotate(${angle}rad)${scalePart}`;
  }

  function seat(chip: DroppedChip) {
    const body = chip.body;
    const x = body.position.x;
    const y = body.position.y;
    const angle = body.angle;
    const preview = scalePreviewFactor(chip.slotId);
    const audioScale = (audioScaleBySlot.get(chip.slotId) ?? 1) * preview;
    if (preview !== 1) chip.el.style.setProperty("--scale-preview", String(preview));
    else chip.el.style.removeProperty("--scale-preview");
    place(chip.el, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY, audioScale);
    place(chip.glow, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY, audioScale);
    for (const mirror of chip.mirrors) {
      place(mirror.face, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY, audioScale);
      place(mirror.glow, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY, audioScale);
    }
  }

  function paint(
    chip: DroppedChip,
    slot: Slot,
    size: { width: number; height: number },
    radius: number,
    theme: ColorTheme,
    tracking: number,
    shiftEm = 0,
  ) {
    const fill = slotFill(theme, slot);
    const ink = slotInk(theme, slot);
    const gradientTo =
      slot.kind === "text" && slot.gradient && !slot.stroked
        ? gradientEnd(theme, slot)
        : slot.kind === "image" && slot.gradient && !slot.emoji && isColorMask(slot)
          ? gradientEnd(theme, slot)
          : "";
    chip.look = { slot, radius, fill, ink, tracking, shiftEm };
    const editing = chip.slotId === editingId;
    applyVisual(chip.el, slot, size.width, size.height, radius, fill, ink, tracking, false, shiftEm, gradientTo, editing);
    applyVisual(chip.glow, slot, size.width, size.height, radius, fill, ink, tracking, true, shiftEm, gradientTo, false);
    for (const mirror of chip.mirrors) {
      copyLook(chip.el, mirror.face);
      copyLook(chip.glow, mirror.glow);
    }
    if (chip.slotId === pickedId) ensureScaleHandles(chip.el);
  }

  function draws(): ChipDraw[] {
    const out: ChipDraw[] = [];
    for (const chip of chips) {
      if (!chip.look) continue;
      out.push({
        x: chip.body.position.x,
        y: chip.body.position.y,
        angle: chip.body.angle,
        width: chip.width,
        height: chip.height,
        anchorX: chip.anchorX,
        anchorY: chip.anchorY,
        slot: chip.look.slot,
        radius: chip.look.radius,
        fill: chip.look.fill,
        ink: chip.look.ink,
        tracking: chip.look.tracking,
        shiftEm: chip.look.shiftEm,
      });
    }
    return out;
  }

  function wireframes(): { x: number; y: number }[][] {
    const out: { x: number; y: number }[][] = [];
    for (const chip of chips) {
      for (const part of solidParts(chip.body)) {
        const verts = part.vertices;
        const poly: { x: number; y: number }[] = [];
        for (let i = 0; i < verts.length; i++) poly.push({ x: verts[i].x, y: verts[i].y });
        out.push(poly);
      }
    }
    return out;
  }

  function setSimulationScale(scale: number) {
    const safe = Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : 1;
    simScale = safe;
    // Same pixel speed on a smaller body tunnels and rests inside neighbors.
    // Shorter steps keep the fall distance and let contacts resolve.
    contactSteps = Math.min(quality.maxContactSteps, Math.max(1, Math.ceil(1 / safe)));
    runner.delta = FRAME_MS / contactSteps;
    engine.positionIterations = contactSteps > 1 ? quality.positionMulti : quality.positionSingle;
    engine.velocityIterations = contactSteps > 1 ? quality.velocityMulti : quality.velocitySingle;
  }

  function setAudioScales(scales: ReadonlyMap<string, number> | null) {
    audioScaleBySlot = scales && scales.size > 0 ? new Map(scales) : new Map();
    let woke = false;
    let grew = false;
    let growDelta = 0;
    for (const chip of chips) {
      const target = audioScaleBySlot.get(chip.slotId) ?? 1;
      const prev = chip.audioMul;
      if (Math.abs(target - prev) > 0.0005) {
        Body.scale(chip.body, target / prev, target / prev);
        chip.audioMul = target;
        Sleeping.set(chip.body, false);
        woke = true;
        if (target > prev) {
          grew = true;
          growDelta = Math.max(growDelta, target - prev);
        }
      }
      seat(chip);
    }
    if (woke) {
      wakeAll();
      if (!running) setRunning(true);
    }
    // Grow digs bodies into neighbors — shove them apart as hard shapes and keep
    // resolving while anything stays enlarged so the pile can't rest intersecting.
    if (grew) {
      breatheAudioGrowth(growDelta);
      separateOverlaps("audio");
      for (const chip of chips) seat(chip);
    } else if (woke) {
      for (const chip of chips) seat(chip);
    }
  }

  /** Give a packed bass-growth cluster a little outward room before depenetration. */
  function breatheAudioGrowth(delta: number) {
    if (delta < 0.0005) return;
    const grown = chips.filter((chip) => chip.audioMul > 1.002 && !chip.body.isStatic);
    if (grown.length < 2) return;
    let cx = 0;
    let cy = 0;
    for (const chip of grown) {
      cx += chip.body.position.x;
      cy += chip.body.position.y;
    }
    cx /= grown.length;
    cy /= grown.length;
    for (const chip of grown) {
      const dx = chip.body.position.x - cx;
      const dy = chip.body.position.y - cy;
      const dist = Math.hypot(dx, dy);
      const swell = delta * Math.hypot(chip.width, chip.height) * 0.35;
      if (swell < 0.05) continue;
      Sleeping.set(chip.body, false);
      if (dist < 1) {
        Body.setPosition(chip.body, {
          x: chip.body.position.x + (Math.random() - 0.5) * swell,
          y: chip.body.position.y - swell,
        });
      } else {
        Body.setPosition(chip.body, {
          x: chip.body.position.x + (dx / dist) * swell,
          y: chip.body.position.y + (dy / dist) * swell,
        });
      }
    }
  }

  function impulseAudioJump(slotIds: Iterable<string>, speed = 8) {
    const ids = slotIds instanceof Set ? slotIds : new Set(slotIds);
    if (ids.size === 0 || bounds.height < 8) return;
    const stageH = bounds.height;
    const stageW = bounds.width;
    const maxUp = Math.abs(speed) * 1.1;
    let any = false;
    for (const chip of chips) {
      if (!ids.has(chip.slotId)) continue;
      if (chip.body.isStatic) continue;

      const { x, y } = chip.body.position;
      const reach = Math.hypot(chip.width, chip.height) * 0.5;
      // Stay in the playfield — no chain-jumps off the top or sides.
      if (y < reach * 0.6) continue;
      if (y > stageH + reach) continue;
      if (x < -reach || x > stageW + reach) continue;

      const vy = chip.body.velocity.y;
      // Already rising — don't stack another kick (constant hats).
      if (vy < -maxUp * 0.4) continue;

      // Fade the hop toward the top of the canvas.
      const climb = Math.max(0, Math.min(1, (y - stageH * 0.12) / (stageH * 0.5)));
      const kick = speed * (0.85 + Math.random() * 0.3) * climb;
      if (kick < 0.35) continue;

      Sleeping.set(chip.body, false);
      Body.setVelocity(chip.body, {
        x: chip.body.velocity.x * 0.35 + (Math.random() - 0.5) * 1.2,
        y: Math.max(-maxUp, Math.min(vy, 0) - kick),
      });
      any = true;
    }
    if (!any) return;
    if (!running) setRunning(true);
  }

  function step(delta = FRAME_MS) {
    const slice = delta / contactSteps;
    for (let i = 0; i < contactSteps; i++) Engine.update(engine, slice);
  }

  function sync() {
    pullDrag();
    for (const chip of chips) seat(chip);
  }

  function destroy() {
    Runner.stop(runner);
    Engine.clear(engine);
    clear();
  }

  return {
    engine,
    play,
    refresh,
    clear,
    resize,
    refit,
    setRunning,
    attach,
    refreshFrost,
    setFloorOpen,
    freezePile,
    purgeFallen,
    isSettled,
    isQuiet,
    isDragging,
    chipCount: () => chips.length,
    setPicked,
    setEditing,
    editingId: () => editingId,
    chipEl,
    refreshSlot,
    setSimulationScale,
    setAudioScales,
    impulseAudioJump,
    sync,
    draws,
    poses,
    restore,
    wireframes,
    step,
    destroy,
  };
}
