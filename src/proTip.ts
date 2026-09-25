import { playNotify } from "./uiSounds";

const SHOW_DELAY_MS = 1400;
const HOLD_MS = 4000;
const GAP_MS = 5000;
const ANIM_MS = 1000;

type Hint = {
  text: string;
  key?: string;
  after?: string;
};

const HINTS: Hint[] = [
  { text: "Hit", key: "Space", after: "to play" },
  { text: "Hide the UI for a clean canvas", key: "H" },
  { text: "Click a piece to edit it" },
  { text: "Right-click a piece to duplicate, invert, or remove it" },
];

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

export function mountProTip(host: Element): void {
  const animMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ANIM_MS;
  let tip: HTMLElement | null = null;
  let hold = 0;
  let enterTimer = 0;
  let removeTimer = 0;
  let onEnter: ((event: TransitionEvent) => void) | null = null;

  const remove = () => {
    window.clearTimeout(removeTimer);
    if (tip && onEnter) tip.removeEventListener("transitionend", onEnter);
    onEnter = null;
    tip?.remove();
    tip = null;
    document.removeEventListener("keydown", onKey);
  };

  const dismiss = () => {
    if (!tip) return;
    window.clearTimeout(hold);
    window.clearTimeout(enterTimer);
    if (onEnter) tip.removeEventListener("transitionend", onEnter);
    onEnter = null;
    const node = tip;
    const index = Number(node.dataset.index);
    node.classList.remove("is-in");
    let done = false;
    const finish = () => {
      if (done || tip !== node) return;
      done = true;
      remove();
      if (index + 1 >= HINTS.length) return;
      window.setTimeout(() => show(index + 1), GAP_MS);
    };
    if (animMs === 0) {
      finish();
      return;
    }
    const onOut = (event: TransitionEvent) => {
      if (event.target !== node || event.propertyName !== "transform") return;
      finish();
    };
    node.addEventListener("transitionend", onOut);
    removeTimer = window.setTimeout(finish, animMs + 80);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (typing(event.target)) return;
    if (event.key === "Escape" || event.key === "h" || event.key === "H") dismiss();
  };

  const show = (index: number) => {
    const hint = HINTS[index];
    if (!hint) return;

    const node = document.createElement("div");
    node.className = "pro-tip";
    node.dataset.index = String(index);
    node.setAttribute("role", "status");

    const title = document.createElement("p");
    title.className = "pro-tip__title";
    title.textContent = "Pro Tip";

    const body = document.createElement("p");
    body.className = "pro-tip__body";
    body.append(hint.text);
    if (hint.key) {
      body.append(" ");
      const key = document.createElement("kbd");
      key.textContent = hint.key;
      body.append(key);
    }
    if (hint.after) body.append(` ${hint.after}`);

    node.append(title, body);
    host.append(node);
    tip = node;
    playNotify();
    document.addEventListener("keydown", onKey);

    let settled = false;
    const settle = () => {
      if (settled || tip !== node) return;
      settled = true;
      hold = window.setTimeout(dismiss, HOLD_MS);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (tip !== node) return;
        node.classList.add("is-in");
        if (animMs === 0) {
          settle();
          return;
        }
        const onIn = (event: TransitionEvent) => {
          if (event.target !== node || event.propertyName !== "transform") return;
          node.removeEventListener("transitionend", onIn);
          if (onEnter === onIn) onEnter = null;
          settle();
        };
        onEnter = onIn;
        node.addEventListener("transitionend", onIn);
        enterTimer = window.setTimeout(settle, animMs + 80);
      });
    });
  };

  window.setTimeout(() => show(0), SHOW_DELAY_MS);
}
