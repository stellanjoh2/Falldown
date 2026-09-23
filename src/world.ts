import Matter from "matter-js";
import { EMOJI_FONT } from "./emojis";
import { createPresetBody, presetIdForSrc } from "./iconMesh";
import { cornerRadius, measureSlot, scaleSlot, textShiftEm, trackingEm } from "./measure";
import { inkOn, pickTheme, type ColorTheme } from "./theme";
import { peekTrim } from "./trim";
import type { PhysicsSettings, Slot } from "./types";

const { Engine, Runner, Bodies, Composite, Body, Constraint, Sleeping, Events } = Matter;

const WALL = 120;
const MATTER_DENSITY = 0.001;
const AIR_FRICTION = 0.01;
const GRAB_STIFFNESS = 0.2;
const SIZE_RANDOM_SPAN = 0.28;
const SETTLED_SPEED = 0.25;
const SETTLED_SPIN = 0.035;
const WAKE_SPEED = 1;
const WAKE_SPIN = 0.12;

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
  sizeUnit: number;
  moved: boolean;
  resting: boolean;
  restX: number;
  restY: number;
  restA: number;
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
    sizeRandom: number,
  ) => void;
  refresh: (
    slots: Slot[],
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
    textHeight: number,
    sizeRandom: number,
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

function chipWeight(physics: PhysicsSettings) {
  return physics.weight > 0 ? physics.weight : 1;
}

function bodyProps(physics: PhysicsSettings, chamfer: number, angle = 0) {
  return {
    restitution: physics.bounce,
    friction: physics.friction,
    frictionStatic: physics.grip,
    frictionAir: AIR_FRICTION,
    density: MATTER_DENSITY * chipWeight(physics),
    angle,
    chamfer: chamfer > 0 ? { radius: chamfer } : undefined,
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
  applyWeight(body, chipWeight(physics));
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

function sizeJitter(unit: number, amount: number): number {
  const spread = (Math.max(0, Math.min(100, amount)) / 100) * SIZE_RANDOM_SPAN;
  return 1 + unit * spread;
}

function layoutOf(slot: Slot, scale: number, pillPad: number, tracking: number) {
  const scaled = scaleSlot(slot, scale);
  const size = measureSlot(scaled, pillPad / 50, trackingEm(tracking));
  const radius = cornerRadius(scaled, size);
  return { scaled, size, radius, chamfer: chamferFor(radius, size.width, size.height) };
}

export function createWorld(): WorldHandle {
  const engine = Engine.create({ enableSleeping: true });
  const runner = Runner.create();
  let running = false;
  let spinDrag = 0;
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
    const weight = chipWeight(physics);
    const key = `${weight}|${physics.gravity}|${physics.speed}|${physics.bounce}|${physics.friction}|${physics.grip}|${physics.spin}`;
    const changed = key !== physicsKey;
    physicsKey = key;
    engine.gravity.y = physics.gravity;
    engine.gravity.scale = 0.001;
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

  Events.on(engine, "beforeUpdate", () => {
    if (spinDrag <= 0) return;
    const keep = 1 - spinDrag;
    for (const chip of chips) {
      if (!chip.body.isSleeping) Body.setAngularVelocity(chip.body, chip.body.angularVelocity * keep);
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
    chip.resting = false;
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
    sizeRandom: number,
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

      const { scaled, size, radius, chamfer } = layoutOf(
        slot,
        scale * sizeJitter(chip.sizeUnit, sizeRandom),
        pillPad,
        tracking,
      );
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
    sizeRandom: number,
  ) {
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-layer");
    if (!layer || !bloomLayer) return;

    clear();
    applyPhysics(physics);

    const falling = expandSlots(slots, shapeAmount);
    const stageW = stage.clientWidth;
    const sizeUnits = falling.map(() => Math.random() * 2 - 1);
    const layouts = falling.map((slot, index) =>
      layoutOf(slot, scale * sizeJitter(sizeUnits[index], sizeRandom), pillPad, tracking),
    );
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
        width: size.width,
        height: size.height,
        chamfer,
        anchorX: anchor.x,
        anchorY: anchor.y,
        meshKey: meshKey(slot, size.width, size.height, chamfer),
        sizeUnit: sizeUnits[index],
        moved: false,
        resting: false,
        restX: 0,
        restY: 0,
        restA: 0,
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
      stiffness: GRAB_STIFFNESS,
      damping: 0,
      length: 0.01,
    });
    Object.assign(pin, { angularStiffness: 1 });
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
    return motionLow(SETTLED_SPEED, SETTLED_SPIN);
  }

  function isQuiet() {
    return motionLow(1.1, 0.1);
  }

  function isDragging() {
    return Boolean(drag);
  }

  function place(el: HTMLElement, x: number, y: number, angle: number, width: number, height: number, anchorX: number, anchorY: number) {
    const originX = width / 2 - anchorX;
    const originY = height / 2 - anchorY;
    el.style.transformOrigin = `${originX}px ${originY}px`;
    el.style.transform = `translate(${x - originX}px, ${y - originY}px) rotate(${angle}rad)`;
  }

  function park(chip: DroppedChip) {
    const body = chip.body;
    if (body.position.x === chip.restX && body.position.y === chip.restY && body.angle === chip.restA) return;
    Body.setPosition(body, { x: chip.restX, y: chip.restY });
    Body.setAngle(body, chip.restA);
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
  }

  function seat(chip: DroppedChip) {
    const body = chip.body;
    const held = drag?.chip === chip;
    const spin = Math.abs(body.angularVelocity);
    if (body.speed > WAKE_SPEED || spin > WAKE_SPIN) chip.moved = true;

    if (held || floorOpen) {
      if (chip.resting) park(chip);
      chip.resting = false;
    } else if (chip.resting) {
      const wake = !body.isSleeping && (body.speed > WAKE_SPEED || spin > WAKE_SPIN);
      if (wake) chip.resting = false;
      else if (body.isSleeping) park(chip);
    } else if (chip.moved && (body.isSleeping || (body.speed < SETTLED_SPEED && spin < SETTLED_SPIN))) {
      chip.resting = true;
      chip.restX = body.position.x;
      chip.restY = body.position.y;
      chip.restA = body.angle;
    }

    const x = chip.resting ? chip.restX : body.position.x;
    const y = chip.resting ? chip.restY : body.position.y;
    const angle = chip.resting ? chip.restA : body.angle;
    place(chip.el, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY);
    place(chip.glow, x, y, angle, chip.width, chip.height, chip.anchorX, chip.anchorY);
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
