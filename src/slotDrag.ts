const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const LIFT_MS = 160;
const SLIDE_MS = 280;
const DROP_MS = 220;
const THRESHOLD = 6;
const SHADOW = "0 18px 44px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)";

type Phase = "pending" | "dragging" | "settling";

type Drag = {
  phase: Phase;
  pointerId: number;
  card: HTMLElement;
  stack: HTMLElement;
  scroller: HTMLElement;
  placeholder: HTMLElement | null;
  originLeft: number;
  width: number;
  grabY: number;
  pointerX: number;
  pointerY: number;
  lastY: number;
  lastT: number;
  tilt: number;
  targetTilt: number;
  liftedAt: number;
  frame: number;
  reduced: boolean;
  onReorder: (ids: string[]) => void;
  onMove: (event: PointerEvent) => void;
  onUp: (event: PointerEvent) => void;
  swallow: ((event: MouseEvent) => void) | null;
};

let drag: Drag | null = null;
let generation = 0;

export function cancelSlotDrag() {
  const current = drag;
  if (!current) return;
  generation += 1;
  drag = null;
  release(current);
  current.card.getAnimations().forEach((anim) => anim.cancel());
  if (current.phase === "dragging") {
    park(current);
    return;
  }
  if (current.phase === "settling") {
    current.card.remove();
    current.placeholder?.remove();
  }
}

export function bindSlotDrag(
  stack: HTMLElement,
  scroller: HTMLElement,
  onReorder: (ids: string[]) => void,
) {
  stack.addEventListener("pointerdown", (event) => {
    if (drag || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, input, textarea, select, a")) return;
    const card = target.closest(".slot-card");
    if (!(card instanceof HTMLElement) || !stack.contains(card)) return;
    if (target.closest(".slot-fold")) return;

    const current = begin(card, stack, scroller, onReorder, event);
    const token = generation;
    current.onMove = (move) => {
      if (!drag || drag !== current || move.pointerId !== current.pointerId) return;
      if (current.phase === "pending") {
        if (Math.hypot(move.clientX - current.pointerX, move.clientY - current.pointerY) < THRESHOLD) return;
        lift(current, move);
      }
      if (current.phase !== "dragging") return;
      move.preventDefault();
      track(current, move);
      place(current);
      moveGap(current);
    };
    current.onUp = (end) => {
      if (!drag || drag !== current || end.pointerId !== current.pointerId) return;
      if (end.type === "pointercancel" || current.phase !== "dragging") {
        generation += 1;
        drag = null;
        release(current);
        if (current.phase === "dragging") park(current);
        return;
      }
      settle(current, token);
    };
    window.addEventListener("pointermove", current.onMove, { passive: false });
    window.addEventListener("pointerup", current.onUp);
    window.addEventListener("pointercancel", current.onUp);
    drag = current;
  });
}

function begin(
  card: HTMLElement,
  stack: HTMLElement,
  scroller: HTMLElement,
  onReorder: (ids: string[]) => void,
  event: PointerEvent,
): Drag {
  return {
    phase: "pending",
    pointerId: event.pointerId,
    card,
    stack,
    scroller,
    placeholder: null,
    originLeft: 0,
    width: 0,
    grabY: 0,
    pointerX: event.clientX,
    pointerY: event.clientY,
    lastY: event.clientY,
    lastT: performance.now(),
    tilt: 0,
    targetTilt: 0,
    liftedAt: 0,
    frame: 0,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    onReorder,
    onMove: () => {},
    onUp: () => {},
    swallow: null,
  };
}

function lift(current: Drag, event: PointerEvent) {
  const rect = current.card.getBoundingClientRect();
  const placeholder = document.createElement("div");
  placeholder.className = "slot-gap";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.style.height = `${current.card.offsetHeight}px`;
  current.card.replaceWith(placeholder);
  document.body.append(current.card);
  current.placeholder = placeholder;
  current.phase = "dragging";
  current.originLeft = rect.left;
  current.width = rect.width;
  current.grabY = event.clientY - rect.top;
  current.pointerX = event.clientX;
  current.pointerY = event.clientY;
  current.lastY = event.clientY;
  current.lastT = performance.now();
  current.liftedAt = current.lastT;
  current.card.classList.add("is-lifted");
  current.card.setAttribute("aria-grabbed", "true");
  document.body.classList.add("is-reordering");
  armSwallow(current);
  place(current);
  current.frame = requestAnimationFrame(() => tick(current));
}

function track(current: Drag, event: PointerEvent) {
  const now = performance.now();
  const dt = Math.max(8, now - current.lastT);
  const velocity = (event.clientY - current.lastY) / dt;
  current.lastY = event.clientY;
  current.lastT = now;
  current.pointerX = event.clientX;
  current.pointerY = event.clientY;
  if (!current.reduced) current.targetTilt = clamp(velocity * 7, -2.5, 2.5);
}

function tick(current: Drag) {
  if (drag !== current || current.phase !== "dragging") return;
  const bounds = current.scroller.getBoundingClientRect();
  const edge = 56;
  let speed = 0;
  if (current.pointerY < bounds.top + edge) {
    speed = -((edge - (current.pointerY - bounds.top)) / edge) * 14;
  } else if (current.pointerY > bounds.bottom - edge) {
    speed = ((current.pointerY - (bounds.bottom - edge)) / edge) * 14;
  }
  if (speed) current.scroller.scrollTop += speed;
  current.targetTilt *= 0.82;
  current.tilt += (current.targetTilt - current.tilt) * 0.4;
  place(current);
  moveGap(current);
  current.frame = requestAnimationFrame(() => tick(current));
}

function place(current: Drag) {
  const grew = current.reduced ? 1 : Math.min(1, (performance.now() - current.liftedAt) / LIFT_MS);
  const eased = 1 - (1 - grew) ** 3;
  const scale = current.reduced ? 1 : 1 + 0.04 * eased;
  const tilt = current.reduced ? 0 : current.tilt;
  current.card.style.width = `${current.width}px`;
  current.card.style.left = `${current.originLeft}px`;
  current.card.style.top = `${current.pointerY - current.grabY}px`;
  current.card.style.transform = `scale(${scale}) rotate(${tilt}deg)`;
}

function moveGap(current: Drag) {
  const placeholder = current.placeholder;
  if (!placeholder?.isConnected) return;
  const cards = slotCards(current.stack);
  let before: HTMLElement | null = null;
  for (const other of cards) {
    if (current.pointerY < layoutCenterY(other)) {
      before = other;
      break;
    }
  }
  const next = placeholder.nextElementSibling;
  if (before === next || (!before && next === null)) return;
  slide(cards, current.reduced, () => {
    if (before) before.before(placeholder);
    else current.stack.append(placeholder);
  });
}

function settle(current: Drag, token: number) {
  const placeholder = current.placeholder;
  if (!placeholder?.isConnected) {
    generation += 1;
    drag = null;
    release(current);
    park(current);
    return;
  }
  current.phase = "settling";
  cancelAnimationFrame(current.frame);
  window.removeEventListener("pointermove", current.onMove);
  window.removeEventListener("pointerup", current.onUp);
  window.removeEventListener("pointercancel", current.onUp);
  document.body.classList.remove("is-reordering");
  window.setTimeout(() => detachSwallow(current), 0);
  const ids = orderIds(current);
  const to = placeholder.getBoundingClientRect();
  const fromTop = current.card.style.top;
  const fromLeft = current.card.style.left;
  const fromTransform = current.card.style.transform || "scale(1) rotate(0deg)";
  const duration = current.reduced ? 0 : DROP_MS;
  const anim = current.card.animate(
    [
      { top: fromTop, left: fromLeft, transform: fromTransform, boxShadow: SHADOW },
      { top: `${to.top}px`, left: `${to.left}px`, transform: "scale(1) rotate(0deg)", boxShadow: "0 0 0 rgba(0, 0, 0, 0)" },
    ],
    { duration, easing: EASE, fill: "forwards" },
  );
  current.onReorder(ids);
  anim.finished.then(() => {
    if (generation !== token || drag !== current) return;
    drag = null;
    anim.cancel();
    clearCard(current.card);
    if (placeholder.isConnected) placeholder.replaceWith(current.card);
  }).catch(() => {});
}

function orderIds(current: Drag): string[] {
  const ids: string[] = [];
  for (const child of current.stack.children) {
    if (child === current.placeholder) {
      const id = current.card.dataset.id;
      if (id) ids.push(id);
    } else if (child instanceof HTMLElement && child.classList.contains("slot-card")) {
      const id = child.dataset.id;
      if (id) ids.push(id);
    }
  }
  return ids;
}

function slide(cards: HTMLElement[], reduced: boolean, mutate: () => void) {
  const visual = new Map(cards.map((el) => [el, el.getBoundingClientRect().top]));
  for (const el of cards) {
    for (const anim of el.getAnimations()) anim.cancel();
  }
  mutate();
  const duration = reduced ? 0 : SLIDE_MS;
  for (const el of cards) {
    const dy = (visual.get(el) ?? 0) - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) continue;
    const anim = el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration, easing: EASE, fill: "both" },
    );
    anim.finished.then(() => anim.cancel()).catch(() => {});
  }
}

function layoutCenterY(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const transform = getComputedStyle(el).transform;
  let shift = 0;
  if (transform && transform !== "none") shift = new DOMMatrix(transform).m42;
  return rect.top - shift + el.offsetHeight / 2;
}

function slotCards(stack: HTMLElement): HTMLElement[] {
  return [...stack.children].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains("slot-card"),
  );
}

function armSwallow(current: Drag) {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener("click", swallow, true);
    if (drag === current) current.swallow = null;
  };
  current.swallow = swallow;
  window.addEventListener("click", swallow, true);
}

function park(current: Drag) {
  clearCard(current.card);
  if (current.placeholder?.isConnected) current.placeholder.replaceWith(current.card);
  else current.placeholder?.remove();
}

function clearCard(card: HTMLElement) {
  card.classList.remove("is-lifted");
  card.removeAttribute("aria-grabbed");
  card.style.cssText = "";
}

function release(current: Drag) {
  cancelAnimationFrame(current.frame);
  window.removeEventListener("pointermove", current.onMove);
  window.removeEventListener("pointerup", current.onUp);
  window.removeEventListener("pointercancel", current.onUp);
  detachSwallow(current);
  document.body.classList.remove("is-reordering");
}

function detachSwallow(current: Drag) {
  if (!current.swallow) return;
  window.removeEventListener("click", current.swallow, true);
  current.swallow = null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
