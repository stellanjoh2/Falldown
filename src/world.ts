import Matter from "matter-js";
import { EMOJI_FONT } from "./emojis";
import { createColliderBody, isPresetId, presetIdForSrc } from "./iconMesh";
import { cornerRadius, measureSlot, pillPadOf, scaleSlot, textShiftEm, trackingEm, trackingOf } from "./measure";
import { fillSample, gradientEnd, pillGradient } from "./pillFill";
import { pickTheme, resolveTextColor, type ColorTheme } from "./theme";
import { peekTrim } from "./trim";
import { shapeHasFill, type ImageSlot, type PhysicsSettings, type Slot } from "./types";

const { Engine, Runner, Bodies, Composite, Body, Constraint, Sleeping, Events, Collision } = Matter;

const WALL = 120;
/** Shapes stop this far inside the canvas so the border never clips them. */
const EDGE = 1;
const FRAME_MS = 1000 / 60;
const GRAVITY_SCALE = 0.001;
const MATTER_DENSITY = 0.001;
const AIR_FRICTION = 0.01;
const GRAB_STIFFNESS = 0.2;
const SIZE_RANDOM_SPAN = 0.28;
const SETTLED_SPEED = 0.25;
const SETTLED_SPIN = 0.035;
const CLICK_SLOP = 6;
const HOLD_DRAG_MS = 220;
// Matter splits the separation push across every contact, so multi-part shapes sink into each other.
const OVERLAP_ALLOW = 0.75;
const SEPARATE_PASSES = 24;

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
  attach: (stage: HTMLElement, onPick?: (slotId: string | null) => void) => void;
  refreshFrost: () => void;
  setPicked: (slotId: string | null) => void;
  setSimulationScale: (scale: number) => void;
  setFloorOpen: (open: boolean) => void;
  purgeFallen: (limitY: number) => void;
  isSettled: () => boolean;
  isQuiet: () => boolean;
  isDragging: () => boolean;
  chipCount: () => number;
  sync: () => void;
  draws: () => ChipDraw[];
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

function meshKey(slot: Slot, width: number, height: number, chamfer: number): string {
  return `${slot.kind}|${colliderId(slot)}|${width}|${height}|${chamfer.toFixed(2)}`;
}

function chipBody(
  slot: Slot,
  x: number,
  y: number,
  width: number,
  height: number,
  physics: PhysicsSettings,
  angle = 0,
) {
  const id = colliderId(slot);
  const preset = id ? createColliderBody(id, x, y, width, height, bodyProps(physics, 0)) : null;
  const body = preset?.body ?? Bodies.rectangle(x, y, width, height, bodyProps(physics, 0));
  const anchor = preset?.anchor ?? { x: 0, y: 0 };
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

function paintFill(el: HTMLElement, on: boolean, from: string, to: string, angle?: number) {
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
  fill.replaceChildren();
  fill.style.background = pillGradient(from, to, angle);
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
) {
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.borderRadius = `${radius}px`;
  el.style.maskImage = "";
  el.style.webkitMaskImage = "";

  if (slot.kind === "text") {
    const ring = slot.stroked && slot.shape !== "none";
    const gradient = Boolean(slot.gradient) && slot.shape !== "none" && !ring;
    const hideText = bloom && slot.shape !== "none";
    el.classList.remove("chip-image", "chip-emoji");
    el.classList.toggle("chip-bare", slot.shape === "none" || ring);
    el.style.background = slot.shape === "none" || ring || gradient ? "transparent" : fill;
    el.style.color = hideText ? fill : ink;
    el.style.border = "none";
    el.style.fontFamily = `"${slot.fontFamily}", sans-serif`;
    el.style.fontWeight = String(slot.fontWeight);
    el.style.fontSize = `${slot.fontSize}px`;
    el.style.letterSpacing = `${tracking}em`;
    const found = el.querySelector(":scope > .chip-label");
    const label = found instanceof HTMLElement ? found : document.createElement("span");
    if (label.parentElement !== el) {
      label.className = "chip-label";
      el.replaceChildren(label);
    } else {
      for (const child of [...el.children]) {
        if (child === label || child.classList.contains("chip-fill") || child.classList.contains("chip-ring")) continue;
        child.remove();
      }
    }
    paintFill(el, gradient, fill, gradientTo || fill, slot.gradientAngle);
    paintStroke(el, ring, gradient, slot.stroke, fill, label);
    label.textContent = hideText ? "" : slot.text;
    label.style.transform = `translateY(${shiftEm}em)`;
    return;
  }

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
  face.style.background = slot.gradient && gradientTo ? pillGradient(fill, gradientTo, slot.gradientAngle) : fill;
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
  const maxSpan = stageW - 8;
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
  let pickedId: string | null = null;
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
  let holdTimer = 0;
  let blank: { pointerId: number; x: number; y: number } | null = null;

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
    const { chip, pointerId, x, y } = armed;
    const body = chip.body;
    dropPin();
    const pin = Constraint.create({
      pointA: { x, y },
      bodyB: body,
      pointB: { x: x - body.position.x, y: y - body.position.y },
      stiffness: GRAB_STIFFNESS,
      damping: 0,
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
    for (const chip of chips) {
      Composite.remove(engine.world, chip.body);
      chip.el.remove();
      chip.glow.remove();
      for (const mirror of chip.mirrors) {
        mirror.face.remove();
        mirror.glow.remove();
      }
    }
    chips = [];
    maxSpan = 0;
  }

  function applyPhysics(physics: PhysicsSettings) {
    const weight = chipWeight(physics);
    const key = `${weight}|${physics.gravity}|${physics.speed}|${physics.bounce}|${physics.friction}|${physics.grip}|${physics.spin}`;
    const changed = key !== physicsKey;
    physicsKey = key;
    engine.gravity.y = physics.gravity;
    engine.gravity.scale = GRAVITY_SCALE;
    engine.timing.timeScale = physics.speed;
    spinDrag = physics.spin;
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

  function pushScale(body: Matter.Body): number {
    if (body.isStatic || body === drag?.chip.body) return 0;
    return body.inverseMass;
  }

  function separateOverlaps() {
    const bodies: Matter.Body[] = [];
    for (const chip of chips) bodies.push(chip.body);
    for (const side of sides) bodies.push(side);
    if (floor) bodies.push(floor);

    for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
      let moved = false;
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          if ((a.isStatic || a === drag?.chip.body) && (b.isStatic || b === drag?.chip.body)) continue;
          if (boundsMiss(a, b)) continue;

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
          if (!best || best.depth <= OVERLAP_ALLOW) continue;

          const parentA = best.parentA;
          const parentB = best.parentB;
          const invA = pushScale(parentA);
          const invB = pushScale(parentB);
          const share = invA + invB;
          if (share === 0) continue;

          const nx = best.normal.x;
          const ny = best.normal.y;
          const push = (best.depth - OVERLAP_ALLOW) / share;
          if (invA) Body.setPosition(parentA, { x: parentA.position.x + nx * push * invA, y: parentA.position.y + ny * push * invA });
          if (invB) Body.setPosition(parentB, { x: parentB.position.x - nx * push * invB, y: parentB.position.y - ny * push * invB });

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
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  Events.on(engine, "beforeUpdate", () => {
    if (spinDrag <= 0) return;
    const keep = Math.pow(1 - spinDrag, 1 / contactSteps);
    for (const chip of chips) {
      if (!chip.body.isSleeping) Body.setAngularVelocity(chip.body, chip.body.angularVelocity * keep);
    }
  });

  Events.on(engine, "afterUpdate", () => {
    separateOverlaps();
  });

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
    const { body, anchor } = chipBody(slot, visualX, visualY, size.width, size.height, physics, angle);
    Body.setVelocity(body, velocity);
    Body.setAngularVelocity(body, angularVelocity);
    Composite.add(engine.world, body);
    chip.body = body;
    chip.anchorX = anchor.x;
    chip.anchorY = anchor.y;
    chip.meshKey = meshKey(slot, size.width, size.height, chamfer);
    chip.width = size.width;
    chip.height = size.height;
    chip.chamfer = chamfer;
    noteSpan(size.width, size.height);
    buildSides(bounds.width, bounds.height);
    setFloorOpen(floorOpen);
    seat(chip);
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

    chips = chips.filter((chip) => {
      const slot = byId.get(chip.slotId);
      if (!slot || (slot.kind === "image" && !slot.src && !slot.emoji)) {
        Composite.remove(engine.world, chip.body);
        chip.el.remove();
        chip.glow.remove();
        for (const mirror of chip.mirrors) {
          mirror.face.remove();
          mirror.glow.remove();
        }
        return false;
      }

      const { scaled, size, radius, chamfer } = contained(
        slot,
        scale * sizeJitter(chip.sizeUnit, sizeRandom),
        pillPad,
        tracking,
        bounds.width,
      );
      paint(chip, scaled, size, radius, theme, trackingEm(trackingOf(slot, tracking)), glyphShift(slot));
      if (chip.meshKey !== meshKey(slot, size.width, size.height, chamfer)) {
        replaceBody(chip, slot, size, chamfer, physics);
      }
      return true;
    });
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
    bloomLayer = stage.querySelector(".bloom-blur");
    stageEl = stage;
    mirrorScenes = frostScenes();
    if (!layer || !bloomLayer) return;

    clear();
    applyPhysics(physics);

    const falling = expandSlots(slots);
    const field = layer.parentElement ?? stage;
    const stageW = field.clientWidth || stage.clientWidth;
    const stageH = field.clientHeight || stage.clientHeight;
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
      const { scaled, size, radius, chamfer } = layouts[index];
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
      const { body, anchor } = chipBody(
        slot,
        x,
        y,
        size.width,
        size.height,
        physics,
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
        seqIndex: index,
        seqTotal: falling.length,
        body,
        el,
        glow,
        mirrors: [],
        width: size.width,
        height: size.height,
        chamfer,
        anchorX: anchor.x,
        anchorY: anchor.y,
        meshKey: meshKey(slot, size.width, size.height, chamfer),
        sizeUnit: sizeUnits[index],
        look: null,
      };
      mountMirrors(chip);
      paint(chip, scaled, size, radius, theme, trackingEm(trackingOf(slot, tracking)), glyphShift(slot));
      seat(chip);
      layer!.append(el);
      bloomLayer!.append(glow);
      Composite.add(engine.world, body);
      chips.push(chip);
    });
    paintPicked();
  }

  function paintPicked() {
    for (const chip of chips) chip.el.classList.toggle("is-picked", chip.slotId === pickedId);
  }

  function setPicked(slotId: string | null) {
    pickedId = slotId;
    paintPicked();
  }

  function wakeAll() {
    for (const chip of chips) Sleeping.set(chip.body, false);
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
    const el = (event.target as HTMLElement | null)?.closest?.(".chip");
    if (!(el instanceof HTMLElement) || el.closest(".bloom-layer")) {
      if (event.currentTarget === stageEl) blank = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    const chip = chips.find((item) => item.el === el);
    if (!chip) return;
    event.preventDefault();
    blank = null;
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

  function onPointerMove(event: PointerEvent) {
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
    if (blank && event.pointerId === blank.pointerId) {
      blank = null;
      onPick?.(null);
      return;
    }
    if (pending && event.pointerId === pending.pointerId) {
      const slotId = pending.chip.slotId;
      cancelPending();
      onPick?.(slotId);
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    dropPin();
  }

  function onPointerCancel(event: PointerEvent) {
    if (blank && event.pointerId === blank.pointerId) blank = null;
    if (pending && event.pointerId === pending.pointerId) cancelPending();
    if (!drag || event.pointerId !== drag.pointerId) return;
    dropPin();
  }

  function attach(stage: HTMLElement, pick?: (slotId: string | null) => void) {
    onPick = pick ?? null;
    stageEl = stage;
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-blur");
    stage.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function motionLow(speedLimit: number, spinLimit: number) {
    if (drag || chips.length === 0) return false;
    return chips.every((chip) => {
      if (chip.body.isSleeping) return true;
      return chip.body.speed < speedLimit && Math.abs(chip.body.angularVelocity) < spinLimit;
    });
  }

  function isSettled() {
    return motionLow(SETTLED_SPEED, SETTLED_SPIN);
  }

  function isQuiet() {
    return motionLow(1.1, 0.1);
  }

  function isDragging() {
    return Boolean(drag);
  }

  function frostScenes(): HTMLElement[] {
    if (!stageEl?.closest("#app")) return [];
    return [...document.querySelectorAll<HTMLElement>("#app .frost__scene, .theme-shelf .frost__scene")];
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
    chip.mirrors = mirrorScenes.flatMap((scene) => {
      const faces = scene.querySelector(".frost__chips");
      const glows = scene.querySelector(".frost__glow");
      if (!faces || !glows) return [];
      const face = document.createElement("div");
      const glow = document.createElement("div");
      face.className = "chip is-mirror";
      glow.className = "chip is-mirror";
      faces.append(face);
      glows.append(glow);
      return [{ face, glow }];
    });
  }

  function refreshFrost() {
    const next = frostScenes();
    const same = next.length === mirrorScenes.length && next.every((scene, index) => scene === mirrorScenes[index]);
    if (same) return;
    for (const chip of chips) {
      for (const mirror of chip.mirrors) {
        mirror.face.remove();
        mirror.glow.remove();
      }
      chip.mirrors = [];
    }
    mirrorScenes = next;
    for (const chip of chips) {
      mountMirrors(chip);
      for (const mirror of chip.mirrors) {
        copyLook(chip.el, mirror.face);
        copyLook(chip.glow, mirror.glow);
      }
      seat(chip);
    }
  }

  function place(el: HTMLElement, x: number, y: number, angle: number, width: number, height: number, anchorX: number, anchorY: number) {
    const originX = width / 2 - anchorX;
    const originY = height / 2 - anchorY;
    el.style.transformOrigin = `${originX}px ${originY}px`;
    el.style.transform = `translate(${x - originX}px, ${y - originY}px) rotate(${angle}rad)`;
  }

  function seat(chip: DroppedChip) {
    const body = chip.body;
    const x = body.position.x;
    const y = body.position.y;
    const angle = body.angle;
    place(chip.el, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY);
    place(chip.glow, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY);
    for (const mirror of chip.mirrors) {
      place(mirror.face, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY);
      place(mirror.glow, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY);
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
    applyVisual(chip.el, slot, size.width, size.height, radius, fill, ink, tracking, false, shiftEm, gradientTo);
    applyVisual(chip.glow, slot, size.width, size.height, radius, fill, ink, tracking, true, shiftEm, gradientTo);
    for (const mirror of chip.mirrors) {
      copyLook(chip.el, mirror.face);
      copyLook(chip.glow, mirror.glow);
    }
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

  function setSimulationScale(scale: number) {
    const safe = Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : 1;
    // Same pixel speed on a smaller body tunnels and rests inside neighbors.
    // Shorter steps keep the fall distance and let contacts resolve.
    contactSteps = Math.min(4, Math.max(1, Math.ceil(1 / safe)));
    runner.delta = FRAME_MS / contactSteps;
    engine.positionIterations = contactSteps > 1 ? 32 : 6;
    engine.velocityIterations = contactSteps > 1 ? 8 : 4;
  }

  function step(delta = FRAME_MS) {
    const slice = delta / contactSteps;
    for (let i = 0; i < contactSteps; i++) Engine.update(engine, slice);
  }

  function sync() {
    pullDrag();
    separateOverlaps();
    refreshFrost();
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
    purgeFallen,
    isSettled,
    isQuiet,
    isDragging,
    chipCount: () => chips.length,
    setPicked,
    setSimulationScale,
    sync,
    draws,
    step,
    destroy,
  };
}
