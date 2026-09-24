const SHOW_DELAY_MS = 1400;
const HOLD_MS = 4000;

type Hint = {
  text: string;
  key?: string;
};

const HINTS: Hint[] = [{ text: "View fullscreen canvas with shortcut", key: "H" }];

function frostPlate(): HTMLElement {
  const frost = document.createElement("div");
  frost.className = "frost";
  frost.setAttribute("aria-hidden", "true");
  frost.innerHTML = `<div class="frost__scene"><div class="frost__chips"></div><div class="frost__glow"></div></div>`;
  return frost;
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

export function mountProTip(host: Element): void {
  const hint = HINTS[0];
  if (!hint) return;

  let tip: HTMLElement | null = null;
  let hold = 0;
  let removeTimer = 0;

  const remove = () => {
    window.clearTimeout(removeTimer);
    tip?.remove();
    tip = null;
    document.removeEventListener("keydown", onKey);
  };

  const dismiss = () => {
    if (!tip) return;
    window.clearTimeout(hold);
    const node = tip;
    node.classList.remove("is-in");
    const finish = () => {
      if (tip !== node) return;
      remove();
    };
    node.addEventListener("transitionend", finish, { once: true });
    removeTimer = window.setTimeout(finish, 360);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (typing(event.target)) return;
    if (event.key === "Escape" || event.key === "h" || event.key === "H") dismiss();
  };

  window.setTimeout(() => {
    const node = document.createElement("div");
    node.className = "pro-tip";
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

    node.append(frostPlate(), title, body);
    host.append(node);
    document.dispatchEvent(new Event("falldown-frost"));
    tip = node;
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => node.classList.add("is-in"));
    });
    hold = window.setTimeout(dismiss, HOLD_MS);
  }, SHOW_DELAY_MS);
}
