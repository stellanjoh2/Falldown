import Matter from "matter-js";
import { cornerRadius, measureSlot, scaleSlot, trackingEm } from "./measure";
import { inkOn, pickTheme, type ColorTheme } from "./theme";
import { peekTrim } from "./trim";
import type { PhysicsSettings, Slot } from "./types";

const { Engine, Runner, Bodies, Composite, Body, Sleeping } = Matter;

const WALL = 120;

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
  ) => void;
  refresh: (
    slots: Slot[],
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
  ) => void;
  clear: () => void;
  resize: (width: number, height: number) => void;
  setRunning: (on: boolean) => void;
  attach: (stage: HTMLElement, onPoke: () => void) => void;
  setFloorOpen: (open: boolean) => void;
  purgeFallen: (limitY: number) => void;
  isSettled: () => boolean;
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
    friction: 0.35,
    frictionAir: 0.012,
    density: 0.002,
    sleepThreshold: 30,
    angle,
    chamfer: chamfer > 0 ? { radius: chamfer } : undefined,
  };
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
) {
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.borderRadius = `${radius}px`;
  el.style.maskImage = "";
  el.style.webkitMaskImage = "";

  if (slot.kind === "text") {
    el.classList.remove("chip-image");
    el.classList.toggle("chip-bare", slot.shape === "none");
    el.style.background = slot.shape === "none" ? "transparent" : fill;
    el.style.color = bloom || slot.shape === "none" ? fill : inkOn(fill);
    el.style.fontFamily = `"${slot.fontFamily}", sans-serif`;
    el.style.fontSize = `${slot.fontSize}px`;
    el.style.letterSpacing = `${tracking}em`;
    el.textContent = bloom && slot.shape !== "none" ? "" : slot.text;
    return;
  }

  const src = peekTrim(slot.src)?.displaySrc ?? slot.src;
  el.classList.add("chip-image");
  el.classList.remove("chip-bare");
  el.replaceChildren();
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
  return slots.filter((slot) => slot.kind === "text" || slot.src);
}

function shapeCopies(slot: Slot, shapeAmount: number): number {
  if (slot.kind !== "image") return 1;
  return Math.max(1, Math.round(slot.amount) * Math.max(1, Math.round(shapeAmount)));
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function expandSlots(slots: Slot[], shapeAmount: number): Slot[] {
  const expanded: Slot[] = [];
  for (const slot of readySlots(slots)) {
    const copies = shapeCopies(slot, shapeAmount);
    for (let i = 0; i < copies; i++) expanded.push(slot);
  }
  return shuffle(expanded);
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
    gravity: { x: 0, y: 1, scale: 0.001 },
  });
  const runner = Runner.create();
  let running = false;
  let sides: Matter.Body[] = [];
  let floor: Matter.Body | null = null;
  let floorOpen = false;
  let bounds = { width: 0, height: 0 };
  let chips: DroppedChip[] = [];
  let layer: HTMLElement | null = null;
  let bloomLayer: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let onPoke: (() => void) | null = null;
  let drag: { chip: DroppedChip; pointerId: number; x: number; y: number } | null = null;

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

  function buildSides(width: number, height: number) {
    Composite.remove(engine.world, sides);
    sides = [
      Bodies.rectangle(-WALL / 2, height / 2, WALL, height * 4, { isStatic: true }),
      Bodies.rectangle(width + WALL / 2, height / 2, WALL, height * 4, { isStatic: true }),
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
      floor = Bodies.rectangle(bounds.width / 2, bounds.height + WALL / 2, bounds.width + WALL * 4, WALL, {
        isStatic: true,
        friction: 0.8,
      });
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
      if (chip.body.position.y - reach < limitY + 480) return true;
      Composite.remove(engine.world, chip.body);
      chip.el.remove();
      chip.glow.remove();
      return false;
    });
  }

  function clear() {
    for (const chip of chips) {
      Composite.remove(engine.world, chip.body);
      chip.el.remove();
      chip.glow.remove();
    }
    chips = [];
  }

  function applyPhysics(physics: PhysicsSettings) {
    engine.gravity.y = physics.gravity;
    engine.gravity.scale = 0.001;
    engine.timing.timeScale = physics.speed;
    for (const chip of chips) {
      chip.body.restitution = physics.bounce;
    }
  }

  function replaceBody(
    chip: DroppedChip,
    size: { width: number; height: number },
    chamfer: number,
    physics: PhysicsSettings,
  ) {
    const { position, angle, velocity, angularVelocity } = chip.body;
    Composite.remove(engine.world, chip.body);
    const body = Bodies.rectangle(
      position.x,
      position.y,
      size.width,
      size.height,
      bodyProps(physics, chamfer, angle),
    );
    Body.setVelocity(body, velocity);
    Body.setAngularVelocity(body, angularVelocity);
    Composite.add(engine.world, body);
    chip.body = body;
    chip.width = size.width;
    chip.height = size.height;
    chip.chamfer = chamfer;
    seat(chip);
  }

  function refresh(
    slots: Slot[],
    physics: PhysicsSettings,
    scale: number,
    theme: ColorTheme,
    pillPad: number,
    tracking: number,
  ) {
    applyPhysics(physics);
    const byId = new Map(slots.map((slot) => [slot.id, slot]));

    chips = chips.filter((chip) => {
      const slot = byId.get(chip.slotId);
      if (!slot || (slot.kind === "image" && !slot.src)) {
        Composite.remove(engine.world, chip.body);
        chip.el.remove();
        chip.glow.remove();
        return false;
      }

      const { scaled, size, radius, chamfer } = layoutOf(slot, scale, pillPad, tracking);
      paint(chip, scaled, size, radius, pickTheme(theme, chip.seqIndex), trackingEm(tracking));
      if (chip.width !== size.width || chip.height !== size.height || chip.chamfer !== chamfer) {
        replaceBody(chip, size, chamfer, physics);
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
  ) {
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-layer");
    if (!layer || !bloomLayer) return;

    setFloorOpen(false);
    clear();
    applyPhysics(physics);

    const falling = expandSlots(slots, shapeAmount);
    const stageW = stage.clientWidth;
    const margin = 80;
    let spawnY = -40;

    falling.forEach((slot, index) => {
      const { scaled, size, radius, chamfer } = layoutOf(slot, scale, pillPad, tracking);
      const x = margin + Math.random() * Math.max(40, stageW - margin * 2);
      spawnY -= size.height / 2 + 16;
      const y = spawnY;
      spawnY -= size.height / 2;
      const body = Bodies.rectangle(x, y, size.width, size.height, {
        ...bodyProps(physics, chamfer),
        angle: (Math.random() - 0.5) * 0.8,
      });
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
      };
      paint(chip, scaled, size, radius, pickTheme(theme, index), trackingEm(tracking));
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
    const body = drag.chip.body;
    Sleeping.set(body, false);
    Body.setVelocity(body, {
      x: (drag.x - body.position.x) * 0.45,
      y: (drag.y - body.position.y) * 0.45,
    });
  }

  function onPointerDown(event: PointerEvent) {
    const el = (event.target as HTMLElement | null)?.closest?.(".chip");
    if (!(el instanceof HTMLElement)) return;
    const chip = chips.find((item) => item.el === el);
    if (!chip) return;
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    const point = stagePoint(event);
    drag = { chip, pointerId: event.pointerId, x: point.x, y: point.y };
    el.classList.add("is-held");
    wakeAll();
    setRunning(true);
    onPoke?.();
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
    drag.chip.el.classList.remove("is-held");
    drag = null;
  }

  function attach(stage: HTMLElement, poke: () => void) {
    stageEl = stage;
    layer = stage.querySelector(".chip-layer");
    bloomLayer = stage.querySelector(".bloom-layer");
    onPoke = poke;
    stage.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function isSettled() {
    if (drag || chips.length === 0) return false;
    return chips.every((chip) => {
      const still =
        chip.body.speed < 0.012 && Math.abs(chip.body.angularVelocity) < 0.002;
      return chip.body.isSleeping || still;
    });
  }

  function place(el: HTMLElement, body: Matter.Body, width: number, height: number) {
    const { x, y } = body.position;
    el.style.transform = `translate(${x - width / 2}px, ${y - height / 2}px) rotate(${body.angle}rad)`;
  }

  function seat(chip: DroppedChip) {
    place(chip.el, chip.body, chip.width, chip.height);
    place(chip.glow, chip.body, chip.width, chip.height);
  }

  function paint(
    chip: DroppedChip,
    slot: Slot,
    size: { width: number; height: number },
    radius: number,
    fill: string,
    tracking: number,
  ) {
    applyVisual(chip.el, slot, size.width, size.height, radius, fill, tracking);
    applyVisual(chip.glow, slot, size.width, size.height, radius, fill, tracking, true);
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
    chipCount: () => chips.length,
    sync,
    destroy,
  };
}
