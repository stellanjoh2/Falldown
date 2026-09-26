const SHOW_MS = 380;
const GAP = 8;
const EDGE = 8;

let enabled = true;
let tip: HTMLElement | null = null;
let active: HTMLElement | null = null;
let timer = 0;
let tipId = "";
let rootEl: ParentNode | null = null;

function tipTarget(node: EventTarget | null, root: ParentNode): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest("[data-tip]");
  if (!(el instanceof HTMLElement) || !root.contains(el)) return null;
  if (!el.getAttribute("data-tip")?.trim()) return null;
  return el;
}

function hide() {
  window.clearTimeout(timer);
  timer = 0;
  if (active && tipId) active.removeAttribute("aria-describedby");
  active = null;
  tipId = "";
  if (tip) {
    tip.removeAttribute("id");
    tip.hidden = true;
    tip.textContent = "";
  }
}

function place(el: HTMLElement) {
  if (!tip) return;
  const text = el.getAttribute("data-tip")?.trim();
  if (!text) {
    hide();
    return;
  }
  tip.textContent = text;
  tip.hidden = false;
  const rect = el.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = rect.left + rect.width / 2 - tw / 2;
  left = Math.max(EDGE, Math.min(left, window.innerWidth - tw - EDGE));
  let top = rect.top - th - GAP;
  if (top < EDGE) top = rect.bottom + GAP;
  if (top + th > window.innerHeight - EDGE) {
    top = Math.max(EDGE, window.innerHeight - th - EDGE);
  }
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function show(el: HTMLElement) {
  if (!tip || !enabled) return;
  if (active && tipId) active.removeAttribute("aria-describedby");
  active = el;
  tipId = `ui-tip-${Math.random().toString(36).slice(2, 9)}`;
  tip.id = tipId;
  el.setAttribute("aria-describedby", tipId);
  place(el);
}

function entering(el: HTMLElement, related: EventTarget | null) {
  if (!enabled) return;
  if (related instanceof Node && el.contains(related)) return;
  if (el === active) return;
  window.clearTimeout(timer);
  timer = 0;
  if (active && tipId) active.removeAttribute("aria-describedby");
  active = null;
  if (tip) tip.hidden = true;
  timer = window.setTimeout(() => show(el), SHOW_MS);
}

function leaving(el: HTMLElement, related: EventTarget | null) {
  if (!rootEl) return;
  if (related instanceof Node && el.contains(related)) return;
  if (related instanceof Element && tipTarget(related, rootEl) === el) return;
  if (el === active || timer) hide();
}

export function setTooltipsEnabled(on: boolean) {
  enabled = on;
  if (!on) hide();
}

export function mountTooltips(root: ParentNode): void {
  rootEl = root;
  tip = document.createElement("div");
  tip.className = "ui-tip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);

  root.addEventListener("pointerover", (event) => {
    const el = tipTarget(event.target, root);
    if (!el) return;
    entering(el, event instanceof PointerEvent ? event.relatedTarget : null);
  });

  root.addEventListener("pointerout", (event) => {
    const el = tipTarget(event.target, root);
    if (!el) return;
    leaving(el, event instanceof PointerEvent ? event.relatedTarget : null);
  });

  root.addEventListener("focusin", (event) => {
    const el = tipTarget(event.target, root);
    if (!el) return;
    entering(el, event instanceof FocusEvent ? event.relatedTarget : null);
  });

  root.addEventListener("focusout", (event) => {
    const el = tipTarget(event.target, root);
    if (!el) return;
    leaving(el, event instanceof FocusEvent ? event.relatedTarget : null);
  });

  root.addEventListener("pointerdown", hide);
  root.addEventListener("scroll", hide, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
}
