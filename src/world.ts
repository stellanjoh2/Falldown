import Matter from "matter-js";
import { EMOJI_FONT } from "./emojis";
import { createPresetBody, presetIdForSrc } from "./iconMesh";
import { cornerRadius, measureSlot, scaleSlot, textShiftEm, trackingEm } from "./measure";
import { inkOn, pickTheme, type ColorTheme } from "./theme";
import { peekTrim } from "./trim";
import type { PhysicsSettings, Slot } from "./types";

const { Engine, Runner, Bodies, Composite, Body, Constraint, Sleeping, Events } = Matter;

const WALL = 120;
const AIR_DRAG = 0.012;
const MASS_DENSITY = 0.002;
const MASS_KNEE = 16;
const SLEEP_THRESHOLD = 60;

type DroppedChip = {
  slotId: string;
  seqIndex: number;
  seqTotal: number;
  body: Matter.Body;
  el: HTMLElement;
  glow: HTMLElement;
  width: number;
  height: number;
  chamfer: number;
  anchorX: number;
  anchorY: number;
  meshKey: string;
};

export type WorldHandle = {
  engine: Matter.Engine;
  play: (
    slots: Slot[],
    physics: PhysicsSettings,
    stage: HTMLElement,
    scale: number,
    theme: ColorTheme,
    shapeAmount: number,
    pillPad: number,
    tracking: number,
    textHeight: number,
  ) => void;
  refresh: (
    slots: Slot[],
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    textHeight: number,
  ) => void;
  clear: () => void;
  resize: (width: number, height: number) => void;
  setRunning: (on: boolean) => void;
  attach: (stage: HTMLElement) => void;
  setFloorOpen: (open: boolean) => void;
  purgeFallen: (limitY: number) => void;
  isSettled: () => boolean;
  isQuiet: () => boolean;
  isDragging: () => boolean;
  chipCount: () => number;
  sync: () => void;
  destroy: () => void;
};

function chamferFor(radius: number, width: number, height: number): number {
  const max = Math.min(width, height) / 2 - 0.5;
  return Math.min(radius, Math.max(0, max));
}

function bodyProps(physics: PhysicsSettings, chamfer: number, angle = 0) {
  return {
    restitution: physics.bounce,
    friction: physics.friction,
    frictionStatic: physics.grip,
    frictionAir: AIR_DRAG,
    density: MASS_DENSITY,
    sleepThreshold: SLEEP_THRESHOLD,
    angle,
    chamfer: chamfer > 0 ? { radius: chamfer } : undefined,
  };
}

function surfaceProps() {
  return { isStatic: true, friction: 1, frictionStatic: 0, restitution: 0 };
}

function softenMass(body: Matter.Body) {
  const raw = body.mass;
  if (raw <= MASS_KNEE) return;
  Body.setMass(body, MASS_KNEE * (2 - MASS_KNEE / raw));
}

function meshKey(slot: Slot, width: number, height: number, chamfer: number): string {
  const preset = slot.kind === "image" && !slot.emoji ? presetIdForSrc(slot.src) ?? "" : "";
  return `${slot.kind}|${preset}|${width}|${height}|${chamfer.toFixed(2)}`;
}

function chipBody(
  slot: Slot,
  x: number,
  y: number,
  width: number,
  height: number,
  physics: PhysicsSettings,
  chamfer: number,
  angle = 0,
) {
  const preset = slot.kind === "image" && !slot.emoji
    ? createPresetBody(slot.src, x, y, width, height, bodyProps(physics, 0, 0))
    : null;
  const body = preset?.body ?? Bodies.rectangle(x, y, width, height, bodyProps(physics, chamfer, 0));
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
  softenMass(body);
  return { body, anchor };
}

function applyVisual(
  el: HTMLElement,
  slot: Slot,
  width: number,
  height: number,
  radius: number,
  fill: string,
  tracking = 0.02,
  bloom = false,
  shiftEm = 0,
) {
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.borderRadius = `${radius}px`;
  el.style.maskImage = "";
  el.style.webkitMaskImage = "";

  if (slot.kind === "text") {
    const ink = inkOn(fill);
    const ring = slot.stroked && slot.shape !== "none";
    el.classList.remove("chip-image", "chip-emoji");
    el.classList.toggle("chip-bare", slot.shape === "none" || ring);
    el.style.background = slot.shape === "none" || ring ? "transparent" : fill;
    el.style.color = ring || bloom || slot.shape === "none" ? fill : ink;
    el.style.border = "none";
    el.style.boxShadow = ring ? `inset 0 0 0 ${Math.max(1, slot.stroke)}px ${fill}` : "none";
    el.style.fontFamily = `"${slot.fontFamily}", sans-serif`;
    el.style.fontWeight = String(slot.fontWeight);
    el.style.fontSize = `${slot.fontSize}px`;
    el.style.letterSpacing = `${tracking}em`;
    const found = el.querySelector(".chip-label");
    const label = found instanceof HTMLElement ? found : document.createElement("span");
    if (label.parentElement !== el) {
      label.className = "chip-label";
      el.replaceChildren(label);
    }
    label.textContent = bloom && slot.shape !== "none" ? "" : slot.text;
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
  el.style.background = fill;
  el.style.webkitMaskImage = `url("${src}")`;
  el.style.maskImage = `url("${src}")`;
  el.style.webkitMaskSize = "contain";
  el.style.maskSize = "contain";
  el.style.webkitMaskRepeat = "no-repeat";
  el.style.maskRepeat = "no-repeat";
  el.style.webkitMaskPosition = "center";
  el.style.maskPosition = "center";
}

function readySlots(slots: Slot[]): Slot[] {
  return slots.filter((slot) => slot.kind === "text" || Boolean(slot.src || slot.emoji));
}

function shapeCopies(slot: Slot, shapeAmount: number): number {
  if (slot.kind !== "image") return 1;
  return Math.max(1, Math.round(slot.amount) * Math.max(1, Math.round(shapeAmount)));
}

function expandSlots(slots: Slot[], shapeAmount: number): Slot[] {
  const expanded: Slot[] = [];
  for (const slot of readySlots(slots)) {
    const copies = shapeCopies(slot, shapeAmount);
    for (let i = 0; i < copies; i++) expanded.push(slot);
  }
  return expanded;
}

function slotFill(theme: ColorTheme, slot: Slot): string {
  return slot.color ?? pickTheme(theme, slot.colorIndex ?? 0);
}

function layoutOf(slot: Slot, scale: number, pillPad: number, tracking: number) {
  const scaled = scaleSlot(slot, scale);
  const size = measureSlot(scaled, pillPad / 50, trackingEm(tracking));
  const radius = cornerRadius(scaled, size);
  return { scaled, size, radius, chamfer: chamferFor(radius, size.width, size.height) };
}

export function createWorld(): WorldHandle {
  const engine = Engine.create({
    enableSleeping: true,
    positionIterations: 12,
    velocityIterations: 8,
    gravity: { x: 0, y: 1, scale: 0.001 },
  });
  const runner = Runner.create();
  let running = false;
  let spinDrag = 0;
  let sides: Matter.Body[] = [];
  let floor: Matter.Body | null = null;
  let floorOpen = false;
  let bounds = { width: 0, height: 0 };
  let maxSpan = 0;
  let chips: DroppedChip[] = [];
  let layer: HTMLElement | null = null;
  let bloomLayer: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let drag: {
    chip: DroppedChip;
    pointerId: number;
    x: number;
    y: number;
    pin: Matter.Constraint;
  } | null = null;

  function setRunning(on: boolean) {
    if (on && !running) {
      Runner.run(runner, engine);
      running = true;
    } else if (!on && running) {
      Runner.stop(runner);
      running = false;
    }
  }

  setRunning(true);

  function noteSpan(width: number, height: number) {
    maxSpan = Math.max(maxSpan, Math.hypot(width, height));
  }

  function wallThick() {
    return Math.max(WALL, maxSpan * 0.55, 160);
  }

  function buildSides(width: number, height: number) {
    const t = wallThick();
    const tall = height + maxSpan * 4 + 800;
    Composite.remove(engine.world, sides);
    sides = [
      Bodies.rectangle(-t / 2, height / 2, t, tall, surfaceProps()),
      Bodies.rectangle(width + t / 2, height / 2, t, tall, surfaceProps()),
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
      floor = Bodies.rectangle(bounds.width / 2, bounds.height + t / 2, bounds.width + t * 4, t, surfaceProps());
      Composite.add(engine.world, floor);
    }
    if (open) wakeAll();
  }

  function resize(width: number, height: number) {
    bounds = { width, height };
    buildSides(width, height);
    setFloorOpen(floorOpen);
  }

  function purgeFallen(limitY: number) {
    chips = chips.filter((chip) => {
      const reach = Math.hypot(chip.width, chip.height) / 2;
      if (chip.body.position.y - reach < limitY + Math.max(480, reach + 240)) return true;
      if (drag?.chip === chip) dropPin();
      Composite.remove(engine.world, chip.body);
      chip.el.remove();
      chip.glow.remove();
      return false;
    });
  }

  function dropPin() {
    if (!drag) return;
    Composite.remove(engine.world, drag.pin);
    drag.chip.el.classList.remove("is-held");
    drag = null;
  }

  function clear() {
    dropPin();
    for (const chip of chips) {
      Composite.remove(engine.world, chip.body);
      chip.el.remove();
      chip.glow.remove();
    }
    chips = [];
    maxSpan = 0;
  }

  function applyPhysics(physics: PhysicsSettings) {
    engine.gravity.y = physics.gravity;
    engine.gravity.scale = 0.001;
    engine.timing.timeScale = physics.speed;
    spinDrag = physics.spin;
    for (const chip of chips) {
      for (const part of chip.body.parts) {
        part.restitution = physics.bounce;
        part.friction = physics.friction;
        part.frictionStatic = physics.grip;
        part.sleepThreshold = SLEEP_THRESHOLD;
      }
    }
  }

  Events.on(engine, "beforeUpdate", () => {
    if (spinDrag <= 0) return;
    const keep = 1 - spinDrag;
    for (const chip of chips) {
      const body = chip.body;
      if (body.isSleeping) continue;
      Body.setAngularVelocity(body, Body.getAngularVelocity(body) * keep);
    }
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
    const { body, anchor } = chipBody(slot, visualX, visualY, size.width, size.height, physics, chamfer, angle);
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
    textHeight: number,
  ) {
    applyPhysics(physics);
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const shift = textShiftEm(textHeight);

    chips = chips.filter((chip) => {
      const slot = byId.get(chip.slotId);
      if (!slot || (slot.kind === "image" && !slot.src && !slot.emoji)) {
        Composite.remove(engine.world, chip.body);
        chip.el.remove();
        chip.glow.remove();
        return false;
      }

      const { scaled, size, radius, chamfer } = layoutOf(slot, scale, pillPad, tracking);
      paint(chip, scaled, size, radius, slotFill(theme, slot), trackingEm(tracking), shift);
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
    shapeAmount: number,
    pillPad: number,
    tracking: number,
    textHeight: number,
  ) {
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-layer");
    if (!layer || !bloomLayer) return;

    clear();
    applyPhysics(physics);

    const falling = expandSlots(slots, shapeAmount);
    const stageW = stage.clientWidth;
    const layouts = falling.map((slot) => layoutOf(slot, scale, pillPad, tracking));
    maxSpan = 0;
    for (const { size } of layouts) noteSpan(size.width, size.height);
    floorOpen = false;
    resize(stage.clientWidth, stage.clientHeight);

    let spawnY = -160;

    falling.forEach((slot, index) => {
      const { scaled, size, radius, chamfer } = layouts[index];
      const reach = Math.hypot(size.width, size.height) / 2;
      const inset = Math.min(Math.max(reach + 12, 24), Math.max(24, stageW / 2 - 8));
      const span = Math.max(0, stageW - inset * 2);
      const x = inset + Math.random() * span;
      spawnY -= size.height / 2 + 16;
      const y = spawnY;
      spawnY -= size.height / 2;
      const tight = size.width > stageW * 0.65;
      const { body, anchor } = chipBody(
        slot,
        x,
        y,
        size.width,
        size.height,
        physics,
        chamfer,
        (Math.random() - 0.5) * (tight ? 0.12 : 0.8),
      );
      Body.setVelocity(body, { x: 0, y: 4 });
      Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.06);

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
        width: size.width,
        height: size.height,
        chamfer,
        anchorX: anchor.x,
        anchorY: anchor.y,
        meshKey: meshKey(slot, size.width, size.height, chamfer),
      };
      paint(chip, scaled, size, radius, slotFill(theme, slot), trackingEm(tracking), textShiftEm(textHeight));
      seat(chip);
      layer!.append(el);
      bloomLayer!.append(glow);
      Composite.add(engine.world, body);
      chips.push(chip);
    });
  }

  function wakeAll() {
    for (const chip of chips) Sleeping.set(chip.body, false);
  }

  function stagePoint(event: PointerEvent) {
    const rect = (stageEl ?? layer)?.getBoundingClientRect();
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
    if (!(el instanceof HTMLElement) || el.closest(".bloom-layer")) return;
    const chip = chips.find((item) => item.el === el);
    if (!chip) return;
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    const point = stagePoint(event);
    const body = chip.body;
    dropPin();
    const pin = Constraint.create({
      pointA: { x: point.x, y: point.y },
      bodyB: body,
      pointB: { x: point.x - body.position.x, y: point.y - body.position.y },
      stiffness: 0.14,
      damping: 0.08,
      length: 0.01,
    });
    Object.assign(pin, { angularStiffness: 0.55 });
    Composite.add(engine.world, pin);
    drag = { chip, pointerId: event.pointerId, x: point.x, y: point.y, pin };
    el.classList.add("is-held");
    Sleeping.set(body, false);
    setRunning(true);
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = stagePoint(event);
    drag.x = point.x;
    drag.y = point.y;
    pullDrag();
  }

  function onPointerUp(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    dropPin();
  }

  function attach(stage: HTMLElement) {
    stageEl = stage;
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-layer");
    stage.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function motionLow(speedLimit: number, spinLimit: number) {
    if (drag || chips.length === 0) return false;
    return chips.every((chip) => {
      if (chip.body.isSleeping) return true;
      return chip.body.speed < speedLimit && Math.abs(chip.body.angularVelocity) < spinLimit;
    });
  }

  function isSettled() {
    return motionLow(0.25, 0.035);
  }

  function isQuiet() {
    return motionLow(1.1, 0.1);
  }

  function isDragging() {
    return Boolean(drag);
  }

  function place(el: HTMLElement, body: Matter.Body, width: number, height: number, anchorX: number, anchorY: number) {
    const originX = width / 2 - anchorX;
    const originY = height / 2 - anchorY;
    el.style.transformOrigin = `${originX}px ${originY}px`;
    el.style.transform = `translate(${body.position.x - originX}px, ${body.position.y - originY}px) rotate(${body.angle}rad)`;
  }

  function seat(chip: DroppedChip) {
    place(chip.el, chip.body, chip.width, chip.height, chip.anchorX, chip.anchorY);
    place(chip.glow, chip.body, chip.width, chip.height, chip.anchorX, chip.anchorY);
  }

  function paint(
    chip: DroppedChip,
    slot: Slot,
    size: { width: number; height: number },
    radius: number,
    fill: string,
    tracking: number,
    shiftEm = 0,
  ) {
    applyVisual(chip.el, slot, size.width, size.height, radius, fill, tracking, false, shiftEm);
    applyVisual(chip.glow, slot, size.width, size.height, radius, fill, tracking, true, shiftEm);
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
    setRunning,
    attach,
    setFloorOpen,
    purgeFallen,
    isSettled,
    isQuiet,
    isDragging,
    chipCount: () => chips.length,
    sync,
    destroy,
  };
}
