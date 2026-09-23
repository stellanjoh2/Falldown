import { FEATURED_EMOJI, searchEmoji, type EmojiItem } from "./emojis";
import { ICON_PRESETS } from "./icons";
import {
  bundledWeights,
  defaultImageSlot,
  defaultTextSlot,
  demoState,
  FALLBACK_WEIGHTS,
  FONTS,
  type ImageSlot,
  type Slot,
  type TextSlot,
  weightName,
} from "./types";
import { activateFamily, localWeights, queryLocalCatalog } from "./localFonts";
import { mountColorPicker } from "./colorPicker";
import { pickTheme } from "./theme";
import { mountProTip } from "./proTip";
import { createThemeShelf } from "./themeShelf";
import { ensureTrims } from "./trim";
import { createWorld } from "./world";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

function freshState() {
  const next = demoState();
  const icons: ImageSlot[] = [];
  for (const fav of [
    { name: "Clovers", amount: 2, colorIndex: 3 },
    { name: "Blossoms", amount: 3, colorIndex: 0 },
    { name: "Rings", amount: 2, colorIndex: 2 },
    { name: "Stars", amount: 2, colorIndex: 1 },
  ]) {
    const icon = ICON_PRESETS.find((preset) => preset.label === fav.name);
    if (!icon) continue;
    icons.push(
      defaultImageSlot({
        src: icon.src,
        name: icon.label,
        size: 56,
        amount: fav.amount,
        colorIndex: fav.colorIndex,
      }),
    );
  }
  next.slots.splice(5, 0, ...icons);
  return next;
}

const state = freshState();
const openSlots = new Set<string>();
let focusSlotId: string | null = null;
let revealSlotId: string | null = null;
let tintPicker: { anchor: HTMLElement; close: () => void } | null = null;

const world = createWorld();

app.innerHTML = `
  <div class="app">
    <div class="stage" id="stage">
      <div class="chip-layer"></div>
      <div class="bloom-layer" aria-hidden="true"></div>
      <div class="post-grain" aria-hidden="true"></div>
      <div class="post-vignette" aria-hidden="true"></div>
    </div>
    <header class="topbar">
      <h1 class="logotype">Falldown</h1>
    </header>
    <aside class="panel">
      <div class="panel-actions">
        <button type="button" class="pill" id="play" aria-pressed="false">Play</button>
        <button type="button" class="pill" id="clear">Clear</button>
        <button type="button" class="pill" id="reset-defaults">Reset defaults</button>
        <button type="button" class="pill" id="copy-settings">Copy settings</button>
        <button type="button" class="pill" id="loop" aria-pressed="true">Loop</button>
      </div>
      <div class="panel-scroll" id="panel"></div>
    </aside>
  </div>
`;

const stage = app.querySelector<HTMLElement>("#stage")!;
const panel = app.querySelector<HTMLElement>("#panel")!;
const panelShell = app.querySelector<HTMLElement>(".panel")!;
const themeShelf = createThemeShelf({
  panel: panelShell,
  getColors: () => state.theme,
  onApply(colors, stage) {
    state.theme = [...colors];
    if (stage) {
      state.stageColor = stage;
      applyStageColor();
    }
    for (const slot of state.slots) slot.color = undefined;
    live();
    renderPanel();
  },
});

let localFamilies: string[] = [];
let machineFont = "";
let appliedFont = "";
let globalWeightPick: { reflect(family: string, weight: number | null): void } | null = null;

function fontChoices(): { id: string; label: string; group: "bundled" | "local" }[] {
  const bundled = FONTS.map((font) => ({
    id: font.id,
    label: font.label,
    group: "bundled" as const,
  }));
  const taken = new Set(bundled.map((font) => font.id.toLowerCase()));
  const local = localFamilies
    .filter((name) => !taken.has(name.toLowerCase()))
    .map((name) => ({ id: name, label: name, group: "local" as const }));
  return [...bundled, ...local];
}

type FontMenuItem = { id: string; label: string; group: "keep" | "bundled" | "local" | "extra" };

function fontMenuItems(selected: string, emptyLabel?: string): FontMenuItem[] {
  const fonts = fontChoices();
  const known = new Set(fonts.map((font) => font.id));
  const items: FontMenuItem[] = fonts.map((font) => ({
    id: font.id,
    label: font.label,
    group: font.group,
  }));
  if (selected && !known.has(selected)) {
    const bundledCount = fonts.filter((font) => font.group === "bundled").length;
    items.splice(bundledCount, 0, { id: selected, label: selected, group: "extra" });
  }
  if (emptyLabel) items.unshift({ id: "", label: emptyLabel, group: "keep" });
  return items;
}

function weightsFor(family: string): number[] {
  const bundled = bundledWeights(family);
  if (bundled) return [...bundled];
  const local = localWeights(family);
  if (local.length) return local;
  return [...FALLBACK_WEIGHTS];
}

function nearestWeight(family: string, weight: number): number {
  const weights = weightsFor(family);
  return weights.reduce((best, next) => (Math.abs(next - weight) < Math.abs(best - weight) ? next : best));
}

function chosenWeight(family: string, weight: number): number {
  const weights = weightsFor(family);
  return weights.includes(weight) ? weight : nearestWeight(family, weight);
}

function allTextSlots(): TextSlot[] {
  return state.slots.filter((slot): slot is TextSlot => slot.kind === "text");
}

function sharedFamily(): string | null {
  const slots = allTextSlots();
  if (!slots.length) return null;
  const family = slots[0].fontFamily;
  return slots.every((slot) => slot.fontFamily === family) ? family : null;
}

function sharedWeight(): number | null {
  const slots = allTextSlots();
  if (!slots.length || !sharedFamily()) return null;
  const weight = slots[0].fontWeight;
  return slots.every((slot) => slot.fontWeight === weight) ? weight : null;
}

async function settleFont(family: string, weight: number) {
  await activateFamily(family);
  await document.fonts.load(`${weight} 28px "${family}"`).catch(() => undefined);
}

function fontTriggerLabel(selected: string, emptyLabel?: string): string {
  if (!selected) return emptyLabel ?? "";
  return fontChoices().find((font) => font.id === selected)?.label ?? selected;
}

let closeFontMenu: (restoreFocus?: boolean) => void = () => {};

function mountFontPick(
  host: HTMLElement,
  selected: string,
  onPick: (id: string) => void,
  emptyLabel?: string,
) {
  let current = selected;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "font-pick-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const value = document.createElement("span");
  value.className = "font-pick-value";
  const chevron = document.createElement("span");
  chevron.className = "font-pick-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(value, chevron);
  const syncLabel = () => {
    value.textContent = fontTriggerLabel(current, emptyLabel);
  };
  syncLabel();
  host.replaceChildren(trigger);
  trigger.addEventListener("click", () => {
    if (trigger.getAttribute("aria-expanded") === "true") {
      closeFontMenu();
      return;
    }
    openFontMenu(trigger, () => current, emptyLabel, (id) => {
      current = id;
      syncLabel();
      onPick(id);
    });
  });
}

function openFontMenu(
  trigger: HTMLButtonElement,
  getValue: () => string,
  emptyLabel: string | undefined,
  onPick: (id: string) => void,
) {
  closeFontMenu();
  const abort = new AbortController();
  const { signal } = abort;
  const menu = document.createElement("div");
  menu.className = "font-menu";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "font-menu-search";
  search.placeholder = "Search fonts";
  search.setAttribute("aria-label", "Search fonts");
  search.autocomplete = "off";
  search.spellcheck = false;
  const list = document.createElement("div");
  list.className = "font-menu-list";
  list.id = "font-menu-list";
  list.setAttribute("role", "listbox");
  menu.append(search, list);
  document.body.append(menu);
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", list.id);

  const base = fontMenuItems(getValue(), emptyLabel);
  let shown = base;
  let active = Math.max(0, shown.findIndex((item) => item.id === getValue()));

  const scrollActiveIntoView = () => {
    const btn = list.querySelectorAll<HTMLElement>(".font-menu-item")[active];
    if (!btn) return;
    const listRect = list.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    if (btnRect.top < listRect.top) list.scrollTop -= listRect.top - btnRect.top;
    else if (btnRect.bottom > listRect.bottom) list.scrollTop += btnRect.bottom - listRect.bottom;
  };

  const paint = () => {
    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.className = "font-menu-empty";
      empty.textContent = "No fonts match";
      list.append(empty);
      return;
    }
    let seenLocal = false;
    shown.forEach((item, index) => {
      if (item.group === "local" && !seenLocal) {
        seenLocal = true;
        const heading = document.createElement("div");
        heading.className = "font-menu-group";
        heading.textContent = "This computer";
        list.append(heading);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "font-menu-item";
      btn.tabIndex = -1;
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", String(item.id === getValue()));
      if (item.id === getValue()) btn.classList.add("is-on");
      if (index === active) btn.classList.add("is-active");
      btn.textContent = item.label;
      btn.addEventListener("click", () => choose(item.id));
      list.append(btn);
    });
    scrollActiveIntoView();
  };

  const markActive = () => {
    list.querySelectorAll(".font-menu-item").forEach((btn, index) => {
      btn.classList.toggle("is-active", index === active);
    });
    scrollActiveIntoView();
  };

  const choose = (id: string) => {
    const pick = onPick;
    closeFontMenu();
    pick(id);
  };

  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    shown = query
      ? base.filter(
          (item) =>
            item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query),
        )
      : base;
    active = 0;
    paint();
  }, { signal });

  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!shown.length) return;
      active = Math.min(shown.length - 1, active + 1);
      markActive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!shown.length) return;
      active = Math.max(0, active - 1);
      markActive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = shown[active];
      if (item) choose(item.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFontMenu(true);
    }
  }, { signal });

  list.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".font-menu-item")) event.preventDefault();
  });

  const place = () => {
    if (!trigger.isConnected) {
      closeFontMenu();
      return;
    }
    const panelRect = panel.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < panelRect.top || rect.top > panelRect.bottom) {
      closeFontMenu();
      return;
    }
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    menu.style.width = `${rect.width}px`;
    menu.style.maxHeight = `${Math.max(120, Math.min(280, openUp ? spaceAbove : spaceBelow))}px`;
    menu.style.left = `${Math.max(8, rect.left)}px`;
    if (openUp) {
      menu.style.top = "auto";
      menu.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    } else {
      menu.style.bottom = "auto";
      menu.style.top = `${rect.bottom + gap}px`;
    }
  };

  const closeCurrent = (restoreFocus = false) => {
    abort.abort();
    menu.remove();
    if (trigger.isConnected) {
      trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger.focus();
    }
    if (closeFontMenu === closeCurrent) closeFontMenu = () => {};
  };
  closeFontMenu = closeCurrent;

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (menu.contains(target) || trigger.contains(target)) return;
    closeFontMenu();
  }, { signal, capture: true });
  panel.addEventListener("scroll", place, { signal, passive: true });
  window.addEventListener("resize", place, { signal });

  place();
  paint();
  search.focus();
}

function mountWeightPick(
  host: HTMLElement,
  family: string,
  weight: number,
  onPick: (weight: number) => void,
  mixed = false,
) {
  let currentFamily = family;
  let current = family ? chosenWeight(family, weight) : weight;
  let showMixed = mixed || !family;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "font-pick-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", "Weight");
  const value = document.createElement("span");
  value.className = "font-pick-value";
  const chevron = document.createElement("span");
  chevron.className = "font-pick-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(value, chevron);

  const sync = () => {
    const weights = currentFamily ? weightsFor(currentFamily) : [];
    const locked = weights.length < 2;
    trigger.disabled = locked;
    value.textContent = !currentFamily || showMixed ? "Mixed" : weightName(current);
    if (locked) trigger.setAttribute("aria-expanded", "false");
  };
  sync();
  host.replaceChildren(trigger);
  trigger.addEventListener("click", () => {
    if (trigger.disabled) return;
    if (trigger.getAttribute("aria-expanded") === "true") {
      closeFontMenu();
      return;
    }
    openWeightMenu(trigger, currentFamily, () => (showMixed ? -1 : current), (next) => {
      showMixed = false;
      current = next;
      sync();
      onPick(next);
    });
  });

  return {
    setFamily(next: string) {
      currentFamily = next;
      showMixed = false;
      current = chosenWeight(next, current);
      sync();
      return current;
    },
    reflect(nextFamily: string, nextWeight: number | null) {
      currentFamily = nextFamily;
      showMixed = !nextFamily || nextWeight == null;
      if (nextFamily && nextWeight != null) current = chosenWeight(nextFamily, nextWeight);
      sync();
    },
  };
}

function openWeightMenu(
  trigger: HTMLButtonElement,
  family: string,
  getValue: () => number,
  onPick: (weight: number) => void,
) {
  closeFontMenu();
  const abort = new AbortController();
  const { signal } = abort;
  const weights = weightsFor(family);
  const menu = document.createElement("div");
  menu.className = "font-menu";
  const list = document.createElement("div");
  list.className = "font-menu-list";
  list.tabIndex = -1;
  list.setAttribute("role", "listbox");
  menu.append(list);
  document.body.append(menu);
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", "weight-menu-list");
  list.id = "weight-menu-list";

  let active = Math.max(0, weights.indexOf(getValue()));
  const buttons: HTMLButtonElement[] = [];

  const markActive = () => {
    buttons.forEach((btn, index) => btn.classList.toggle("is-active", index === active));
    buttons[active]?.scrollIntoView({ block: "nearest" });
  };

  weights.forEach((weight, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "font-menu-item";
    btn.tabIndex = -1;
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", String(weight === getValue()));
    if (weight === getValue()) btn.classList.add("is-on");
    if (index === active) btn.classList.add("is-active");
    btn.textContent = weightName(weight);
    btn.style.fontFamily = `"${family}", sans-serif`;
    btn.style.fontWeight = String(weight);
    btn.addEventListener("click", () => {
      const pick = onPick;
      closeFontMenu();
      pick(weight);
    });
    list.append(btn);
    buttons.push(btn);
  });

  list.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".font-menu-item")) event.preventDefault();
  }, { signal });

  list.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(weights.length - 1, active + 1);
      markActive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(0, active - 1);
      markActive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      buttons[active]?.click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFontMenu(true);
    }
  }, { signal });

  const place = () => {
    if (!trigger.isConnected) {
      closeFontMenu();
      return;
    }
    const panelRect = panel.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < panelRect.top || rect.top > panelRect.bottom) {
      closeFontMenu();
      return;
    }
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    menu.style.width = `${rect.width}px`;
    menu.style.maxHeight = `${Math.max(120, Math.min(280, openUp ? spaceAbove : spaceBelow))}px`;
    menu.style.left = `${Math.max(8, rect.left)}px`;
    if (openUp) {
      menu.style.top = "auto";
      menu.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    } else {
      menu.style.bottom = "auto";
      menu.style.top = `${rect.bottom + gap}px`;
    }
  };

  const closeCurrent = (restoreFocus = false) => {
    abort.abort();
    menu.remove();
    if (trigger.isConnected) {
      trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger.focus();
    }
    if (closeFontMenu === closeCurrent) closeFontMenu = () => {};
  };
  closeFontMenu = closeCurrent;

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (menu.contains(target) || trigger.contains(target)) return;
    closeFontMenu();
  }, { signal, capture: true });
  panel.addEventListener("scroll", place, { signal, passive: true });
  window.addEventListener("resize", place, { signal });

  place();
  buttons[active]?.scrollIntoView({ block: "nearest" });
  list.focus();
}

function applyStageColor() {
  stage.style.background = state.stageColor;
}

function applyPost() {
  const amount = state.post.bloom / 100;
  const bloom = amount * 48;
  stage.style.setProperty("--bloom", `${bloom}px`);
  stage.style.setProperty("--bloom-opacity", `${(state.post.bloomOpacity / 100) * amount}`);
  stage.style.setProperty("--post-grain", `${state.post.grain / 100}`);
  stage.style.setProperty("--post-vig", `${state.post.vignette / 140}`);
  stage.style.setProperty("--post-sat", `${state.post.saturate / 100}`);
  stage.classList.toggle("has-bloom", state.post.bloom > 0 && state.post.bloomOpacity > 0);
  stage.classList.toggle("has-sat", state.post.saturate !== 100);
}

function renderPanel() {
  const scroll = panel.scrollTop;
  closeFontMenu();
  panel.innerHTML = `
    <section class="section">
      <h2>Master size</h2>
      <label class="field"><span data-range-label="masterScale">Scale ${(state.masterScale * 10).toFixed(0)}</span>
        <input type="range" id="masterScale" min="4" max="100" step="1" value="${state.masterScale * 10}" />
      </label>
      <label class="field"><span data-range-label="sizeRandom">Size random ${state.sizeRandom}</span>
        <input type="range" id="sizeRandom" min="0" max="100" step="1" value="${state.sizeRandom}" />
      </label>
      <label class="field"><span data-range-label="pillPad">Pill padding ${state.pillPad}</span>
        <input type="range" id="pillPad" min="0" max="100" step="1" value="${state.pillPad}" />
      </label>
      <label class="field"><span data-range-label="textHeight">Text height ${state.textHeight}</span>
        <input type="range" id="textHeight" min="0" max="100" step="1" value="${state.textHeight}" />
      </label>
      <label class="field"><span data-range-label="textTracking">Tracking ${state.textTracking}</span>
        <input type="range" id="textTracking" min="0" max="100" step="1" value="${state.textTracking}" />
      </label>
      <label class="field"><span data-range-label="shapeAmount">Amount of shapes ${state.shapeAmount}</span>
        <input type="range" id="shapeAmount" min="1" max="12" step="1" value="${state.shapeAmount}" />
      </label>
    </section>
    <section class="section">
      <h2>Color theme</h2>
      <button type="button" class="pill theme-launch" id="view-themes">View Themes</button>
      <div class="theme-row" style="--theme-count:${state.theme.length}">
        ${state.theme
          .map(
            (color, i) =>
              `<button type="button" class="theme-swatch" data-theme="${i}" style="background:${color}" aria-label="Theme color ${i + 1}"></button>`,
          )
          .join("")}
      </div>
      <label class="field">Stage
        <input type="color" id="stage-color" value="${state.stageColor}" />
      </label>
    </section>
    <section class="section">
      <h2>Typeface</h2>
      <div class="field">All text
        <div class="font-pick" id="global-font"></div>
      </div>
      <div class="field">Weight
        <div class="font-pick" id="global-weight"></div>
      </div>
      <div class="row">
        <div class="field">Font from this computer
          <input type="text" id="machine-font" list="local-font-list" placeholder="e.g. Helvetica Neue" value="${escapeAttr(machineFont)}" />
        </div>
      </div>
      <datalist id="local-font-list">
        ${localFamilies.map((name) => `<option value="${escapeAttr(name)}"></option>`).join("")}
      </datalist>
      <button type="button" class="pill" id="load-local-fonts">Load local fonts</button>
    </section>
    <section class="section">
      <h2>What falls down</h2>
      <div class="slot-group">
        <div class="slot-stack" id="text-slots"></div>
        <button type="button" class="pill" id="add-text">Add text</button>
      </div>
      <div class="slot-group">
        <div class="slot-stack" id="image-slots"></div>
        <button type="button" class="pill" id="add-image">Add icon</button>
      </div>
    </section>
    <section class="section">
      <h2>Physics</h2>
      <div class="row">
        <label class="field"><span data-range-label="gravity">Gravity ${state.physics.gravity.toFixed(2)}</span>
          <input type="range" id="gravity" min="0" max="3" step="0.05" value="${state.physics.gravity}" />
        </label>
      </div>
      <div class="row">
        <label class="field"><span data-range-label="speed">Speed ${state.physics.speed.toFixed(2)}</span>
          <input type="range" id="speed" min="0.2" max="2" step="0.05" value="${state.physics.speed}" />
        </label>
      </div>
      <div class="row">
        <label class="field"><span data-range-label="bounce">Bounciness ${state.physics.bounce.toFixed(2)}</span>
          <input type="range" id="bounce" min="0" max="1" step="0.05" value="${state.physics.bounce}" />
        </label>
      </div>
      <div class="row">
        <label class="field"><span data-range-label="friction">Friction ${state.physics.friction.toFixed(2)}</span>
          <input type="range" id="friction" min="0" max="1" step="0.05" value="${state.physics.friction}" />
        </label>
      </div>
      <div class="row">
        <label class="field"><span data-range-label="grip">Grip ${state.physics.grip.toFixed(2)}</span>
          <input type="range" id="grip" min="0" max="1" step="0.05" value="${state.physics.grip}" />
        </label>
      </div>
      <div class="row">
        <label class="field"><span data-range-label="spin">Spin drag ${state.physics.spin.toFixed(2)}</span>
          <input type="range" id="spin" min="0" max="0.12" step="0.01" value="${state.physics.spin}" />
        </label>
      </div>
      <label class="field"><span data-range-label="hold">Floor pause ${state.physics.hold.toFixed(2)}s</span>
        <input type="range" id="hold" min="0.2" max="4" step="0.05" value="${state.physics.hold}" />
      </label>
    </section>
    <section class="section">
      <h2>Post</h2>
      <label class="field"><span data-range-label="bloom">Bloom ${state.post.bloom}</span>
        <input type="range" id="bloom" min="0" max="100" step="1" value="${state.post.bloom}" />
      </label>
      <label class="field"><span data-range-label="bloomOpacity">Bloom opacity ${state.post.bloomOpacity}</span>
        <input type="range" id="bloomOpacity" min="0" max="100" step="1" value="${state.post.bloomOpacity}" />
      </label>
      <label class="field"><span data-range-label="grain">Grain ${state.post.grain}</span>
        <input type="range" id="grain" min="0" max="100" step="1" value="${state.post.grain}" />
      </label>
      <label class="field"><span data-range-label="vignette">Vignette ${state.post.vignette}</span>
        <input type="range" id="vignette" min="0" max="100" step="1" value="${state.post.vignette}" />
      </label>
      <label class="field"><span data-range-label="saturate">Saturate ${state.post.saturate}</span>
        <input type="range" id="saturate" min="40" max="180" step="1" value="${state.post.saturate}" />
      </label>
    </section>
    <p class="hint">Space plays. Loop keeps the floor opening. H hides the UI.</p>
    <footer class="panel-credit">
      <span class="panel-credit__s" aria-hidden="true"></span>
      <p>
        Falldown is created by<br />
        <a class="panel-credit__author" href="https://www.linkedin.com/in/stellanj/" target="_blank" rel="noopener noreferrer">Stellan Johansson</a>
      </p>
      <p>
        Shapes provided by
        <a class="panel-credit__source" href="https://www.shapes.gallery/" target="_blank" rel="noopener noreferrer">shapes.gallery</a>
      </p>
      <p class="panel-credit__social">
        <a href="https://x.com/johstell" target="_blank" rel="noopener noreferrer" aria-label="X">
          <span class="panel-credit__icon panel-credit__icon--x" aria-hidden="true"></span>
        </a>
        <a href="https://github.com/stellanjoh2/Falldown" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
          <svg viewBox="0 0 98 96" aria-hidden="true">
            <path fill="currentColor" d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z" />
          </svg>
        </a>
      </p>
    </footer>
  `;

  const textSlots = panel.querySelector("#text-slots")!;
  const imageSlots = panel.querySelector("#image-slots")!;
  for (const slot of state.slots) {
    (slot.kind === "text" ? textSlots : imageSlots).append(renderSlotCard(slot));
  }

  panel.querySelector("#add-text")?.addEventListener("click", () => {
    const slot = defaultTextSlot({ colorIndex: state.slots.length % state.theme.length });
    state.slots.push(slot);
    openSlots.add(slot.id);
    focusSlotId = slot.id;
    revealSlotId = slot.id;
    renderPanel();
  });
  panel.querySelector("#add-image")?.addEventListener("click", () => {
    const slot = defaultImageSlot({ colorIndex: state.slots.length % state.theme.length });
    state.slots.push(slot);
    openSlots.add(slot.id);
    revealSlotId = slot.id;
    renderPanel();
  });

  bindRange("masterScale", "Scale", (v) => {
    state.masterScale = v / 10;
    live();
  }, (v) => `${v.toFixed(0)}`);
  bindRange("sizeRandom", "Size random", (v) => {
    state.sizeRandom = Math.round(v);
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("pillPad", "Pill padding", (v) => {
    state.pillPad = Math.round(v);
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("textHeight", "Text height", (v) => {
    state.textHeight = Math.round(v);
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("textTracking", "Tracking", (v) => {
    state.textTracking = Math.round(v);
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("shapeAmount", "Amount of shapes", (v) => {
    state.shapeAmount = Math.round(v);
  }, (v) => `${Math.round(v)}`);

  const globalFont = panel.querySelector<HTMLElement>("#global-font");
  if (globalFont) {
    mountFontPick(globalFont, appliedFont, (family) => {
      appliedFont = family;
      if (family) void applyFontEverywhere(family);
    }, "Keep per-slot fonts");
  }
  const globalWeight = panel.querySelector<HTMLElement>("#global-weight");
  const family = sharedFamily() ?? "";
  const weight = sharedWeight();
  globalWeightPick = globalWeight
    ? mountWeightPick(
        globalWeight,
        family,
        weight ?? 700,
        (next) => {
          void applyWeightEverywhere(next);
        },
        !family || weight == null,
      )
    : null;
  panel.querySelector<HTMLInputElement>("#machine-font")?.addEventListener("change", (e) => {
    const family = (e.target as HTMLInputElement).value.trim();
    machineFont = family;
    if (!family) return;
    appliedFont = family;
    void applyFontEverywhere(family);
  });
  panel.querySelector("#load-local-fonts")?.addEventListener("click", () => {
    void loadLocalFonts();
  });
  bindRange("gravity", "Gravity", (v) => {
    state.physics.gravity = v;
    live();
  });
  bindRange("speed", "Speed", (v) => {
    state.physics.speed = v;
    live();
  });
  bindRange("bounce", "Bounciness", (v) => {
    state.physics.bounce = v;
    live();
  });
  bindRange("friction", "Friction", (v) => {
    state.physics.friction = v;
    live();
  });
  bindRange("grip", "Grip", (v) => {
    state.physics.grip = v;
    live();
  });
  bindRange("spin", "Spin drag", (v) => {
    state.physics.spin = v;
    live();
  });
  bindRange("hold", "Floor pause", (v) => {
    state.physics.hold = v;
  }, (v) => `${v.toFixed(2)}s`);
  bindRange("bloom", "Bloom", (v) => {
    state.post.bloom = Math.round(v);
    applyPost();
  }, (v) => `${Math.round(v)}`);
  bindRange("bloomOpacity", "Bloom opacity", (v) => {
    state.post.bloomOpacity = Math.round(v);
    applyPost();
  }, (v) => `${Math.round(v)}`);
  bindRange("grain", "Grain", (v) => {
    state.post.grain = Math.round(v);
    applyPost();
  }, (v) => `${Math.round(v)}`);
  bindRange("vignette", "Vignette", (v) => {
    state.post.vignette = Math.round(v);
    applyPost();
  }, (v) => `${Math.round(v)}`);
  bindRange("saturate", "Saturate", (v) => {
    state.post.saturate = Math.round(v);
    applyPost();
  }, (v) => `${Math.round(v)}`);

  panel.querySelector<HTMLButtonElement>("#view-themes")?.addEventListener("click", () => themeShelf.open());
  panel.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((swatch) => {
    swatch.addEventListener("click", () => openThemeSwatch(swatch));
  });
  panel.querySelector<HTMLInputElement>("#stage-color")?.addEventListener("input", (e) => {
    state.stageColor = (e.target as HTMLInputElement).value;
    applyStageColor();
  });
  panel.scrollTop = scroll;
  if (revealSlotId) {
    const card = panel.querySelector<HTMLElement>(`[data-id="${revealSlotId}"]`);
    card?.scrollIntoView({ block: "nearest" });
    card?.parentElement?.nextElementSibling?.scrollIntoView({ block: "nearest" });
    revealSlotId = null;
  }
  focusSlotId = null;
}

function paintRange(input: HTMLInputElement) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const pct = ((Number(input.value) - min) / (max - min || 1)) * 100;
  input.style.setProperty("--pct", `${pct}%`);
}

function bindRange(
  id: string,
  label: string,
  onChange: (value: number) => void,
  format: (value: number) => string = (value) => value.toFixed(2),
) {
  const input = panel.querySelector<HTMLInputElement>(`#${id}`);
  const caption = panel.querySelector(`[data-range-label="${id}"]`);
  if (input) paintRange(input);
  input?.addEventListener("input", () => {
    const value = Number(input.value);
    paintRange(input);
    onChange(value);
    if (caption) caption.textContent = `${label} ${format(value)}`;
  });
}

function renderSlotCard(slot: Slot): HTMLElement {
  const card = document.createElement("article");
  const open = openSlots.has(slot.id);
  card.className = open ? "slot-card is-open" : "slot-card";
  card.dataset.id = slot.id;

  if (slot.kind === "text") {
    card.append(textFields(slot, open));
  } else {
    card.append(imageFields(slot, open));
  }

  return card;
}

function paintTextHeadline(toggle: HTMLElement, slot: TextSlot, open: boolean, focus: boolean) {
  toggle.replaceChildren();
  if (!open) {
    const title = document.createElement("span");
    title.className = "slot-title";
    const word = slot.text.trim();
    title.textContent = word || "Empty";
    if (!word) title.classList.add("is-empty");
    toggle.append(title);
    return;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "slot-live";
  input.value = slot.text;
  input.setAttribute("aria-label", "Text");
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSlotOpen(toggle, slot, false, false);
    }
  });
  input.addEventListener("input", () => {
    slot.text = input.value;
    live();
  });
  toggle.append(input);
  if (focus) {
    queueMicrotask(() => {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
  }
}

function setSlotOpen(toggle: HTMLElement, slot: Slot, open: boolean, focus: boolean) {
  if (open) openSlots.add(slot.id);
  else openSlots.delete(slot.id);
  const card = toggle.closest(".slot-card");
  card?.classList.toggle("is-open", open);
  const fold = toggle.parentElement?.parentElement?.querySelector<HTMLElement>(".slot-fold");
  if (fold) {
    fold.inert = !open;
    fold.setAttribute("aria-hidden", String(!open));
  }
  toggle.tabIndex = open ? -1 : 0;
  toggle.setAttribute("role", open ? "presentation" : "button");
  toggle.setAttribute("aria-expanded", String(open));
  if (slot.kind === "text") paintTextHeadline(toggle, slot, open, focus);
}

function slotHead(slot: Slot, open: boolean): HTMLElement {
  const head = document.createElement("div");
  head.className = "slot-head";
  const toggle = document.createElement("div");
  toggle.className = "slot-toggle";
  toggle.tabIndex = open ? -1 : 0;
  toggle.setAttribute("role", open ? "presentation" : "button");
  toggle.setAttribute("aria-expanded", String(open));

  if (slot.kind === "text") {
    paintTextHeadline(toggle, slot, open, focusSlotId === slot.id);
  } else {
    const mark = document.createElement("span");
    mark.className = "slot-mark";
    if (slot.emoji) {
      mark.textContent = slot.emoji;
    } else if (slot.src && ICON_PRESETS.some((icon) => icon.src === slot.src)) {
      mark.append(shapeSwatch(slot.src, slotColor(slot)));
    } else if (slot.src) {
      const img = document.createElement("img");
      img.src = slot.src;
      img.alt = "";
      mark.append(img);
    }
    const title = document.createElement("span");
    title.className = "slot-title";
    title.textContent = slot.emoji || slot.src ? slot.name : "Empty";
    if (!slot.emoji && !slot.src) title.classList.add("is-empty");
    toggle.append(mark, title);
  }

  toggle.addEventListener("click", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    setSlotOpen(toggle, slot, !openSlots.has(slot.id), true);
  });
  toggle.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSlotOpen(toggle, slot, !openSlots.has(slot.id), true);
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost icon-btn";
  remove.dataset.remove = "";
  remove.setAttribute("aria-label", "Remove");
  remove.textContent = "✕";
  remove.addEventListener("click", () => removeSlot(slot.id));
  head.append(toggle, remove);
  return head;
}

function textFields(slot: TextSlot, open: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "slot-body";
  wrap.append(slotHead(slot, open));
  const editor = document.createElement("div");
  editor.className = "slot-editor";
  editor.innerHTML = `
    <div class="field">Typeface
      <div class="font-pick" data-font-pick></div>
    </div>
    <div class="row">
      <div class="field">Weight
        <div class="font-pick" data-weight-pick></div>
      </div>
      <label class="field">Size
        <input type="number" data-key="fontSize" min="12" max="96" value="${slot.fontSize}" />
      </label>
    </div>
    <div class="row">
      <label class="field">Holding shape
        <select data-key="shape">
          <option value="none" ${slot.shape === "none" ? "selected" : ""}>None</option>
          <option value="pill" ${slot.shape === "pill" ? "selected" : ""}>Pill</option>
          <option value="box" ${slot.shape === "box" ? "selected" : ""}>Box</option>
        </select>
      </label>
      <label class="field">Radius
        <input type="range" data-key="radius" min="0" max="40" value="${slot.radius}" ${slot.shape !== "box" ? "disabled" : ""} />
      </label>
    </div>
    <label class="check">
      <input type="checkbox" data-key="stroked" ${slot.stroked ? "checked" : ""} />
      Stroked
    </label>
    ${slot.stroked ? `<label class="field"><span data-range-label="stroke">Stroke ${slot.stroke}</span>
      <input type="range" data-key="stroke" min="1" max="16" step="1" value="${slot.stroke}" />
    </label>` : ""}
    ${tintRow(slot)}
  `;
  placeFold(wrap, editor, open);

  const weightHost = editor.querySelector<HTMLElement>("[data-weight-pick]");
  const weightPick = weightHost
    ? mountWeightPick(weightHost, slot.fontFamily, slot.fontWeight, (weight) => {
        slot.fontWeight = weight;
        reflectGlobalWeight();
        void settleFont(slot.fontFamily, weight).then(() => live());
      })
    : null;
  slot.fontWeight = chosenWeight(slot.fontFamily, slot.fontWeight);

  const fontPick = editor.querySelector<HTMLElement>("[data-font-pick]");
  if (fontPick) {
    mountFontPick(fontPick, slot.fontFamily, (family) => {
      slot.fontFamily = family;
      if (weightPick) slot.fontWeight = weightPick.setFamily(family);
      reflectGlobalWeight();
      void settleFont(family, slot.fontWeight).then(() => live());
    });
  }
  bindSlotInputs(editor, slot);
  bindTint(editor, slot);
  return wrap;
}

function imageFields(slot: ImageSlot, open: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "slot-body";
  wrap.append(slotHead(slot, open));
  const editor = document.createElement("div");
  editor.className = "slot-editor";
  editor.innerHTML = `
    <div class="pick-now">${pickPreview(slot)}</div>
    <p class="slot-label">Shapes</p>
    <div class="icon-grid" data-presets></div>
    <p class="slot-label">Emoji</p>
    <div class="emoji-grid" data-emoji-featured></div>
    <label class="field">Search emoji
      <input type="search" data-emoji-search placeholder="heart, fire, cat…" />
    </label>
    <div class="emoji-grid" data-emoji-results></div>
    <label class="field">Upload SVG / PNG / JPG
      <input type="file" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg" data-file />
    </label>
    <label class="field">Size ${slot.size}px
      <input type="range" data-key="size" min="32" max="160" value="${slot.size}" />
    </label>
    <label class="field">Amount ${slot.amount}
      <input type="range" data-key="amount" min="1" max="16" value="${slot.amount}" />
    </label>
    ${tintRow(slot)}
  `;
  placeFold(wrap, editor, open);

  const grid = editor.querySelector("[data-presets]")!;
  const swatchColor = slotColor(slot);
  for (const icon of ICON_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = icon.label;
    btn.className = !slot.emoji && slot.src === icon.src ? "is-on" : "";
    btn.setAttribute("aria-pressed", String(!slot.emoji && slot.src === icon.src));
    btn.append(shapeSwatch(icon.src, swatchColor));
    btn.addEventListener("click", () => {
      slot.src = icon.src;
      slot.name = icon.label;
      slot.emoji = undefined;
      renderPanel();
      live();
    });
    grid.append(btn);
  }

  const pickEmoji = (item: EmojiItem) => {
    slot.emoji = item.char;
    slot.name = item.name;
    slot.src = "";
    renderPanel();
    live();
  };

  const featured = wrap.querySelector("[data-emoji-featured]")!;
  for (const item of FEATURED_EMOJI) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = item.name;
    btn.className = slot.emoji === item.char ? "is-on" : "";
    btn.setAttribute("aria-pressed", String(slot.emoji === item.char));
    btn.textContent = item.char;
    btn.addEventListener("click", () => pickEmoji(item));
    featured.append(btn);
  }

  const results = wrap.querySelector("[data-emoji-results]")!;
  const paintResults = (items: EmojiItem[]) => {
    results.replaceChildren();
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = item.name;
      btn.className = slot.emoji === item.char ? "is-on" : "";
      btn.setAttribute("aria-pressed", String(slot.emoji === item.char));
      btn.textContent = item.char;
      btn.addEventListener("click", () => pickEmoji(item));
      results.append(btn);
    }
  };

  wrap.querySelector<HTMLInputElement>("[data-emoji-search]")?.addEventListener("input", (e) => {
    paintResults(searchEmoji((e.target as HTMLInputElement).value));
  });

  bindTint(editor, slot);
  editor.querySelector<HTMLInputElement>("[data-file]")?.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    slot.src = URL.createObjectURL(file);
    slot.name = file.name;
    slot.emoji = undefined;
    renderPanel();
    live();
  });
  bindSlotInputs(editor, slot);
  return wrap;
}

function placeFold(wrap: HTMLElement, editor: HTMLElement, open: boolean) {
  const fold = document.createElement("div");
  fold.className = "slot-fold";
  if (!open) {
    fold.inert = true;
    fold.setAttribute("aria-hidden", "true");
  }
  const clip = document.createElement("div");
  clip.className = "slot-fold-clip";
  clip.append(editor);
  fold.append(clip);
  wrap.append(fold);
}

function slotColor(slot: Slot): string {
  return slot.color ?? pickTheme(state.theme, slot.colorIndex ?? 0);
}

function shapeSwatch(src: string, color: string): HTMLElement {
  const glyph = document.createElement("span");
  glyph.className = "shape-swatch";
  glyph.style.background = color;
  const mask = `url("${src}")`;
  glyph.style.maskImage = mask;
  glyph.style.webkitMaskImage = mask;
  return glyph;
}

function pickPreview(slot: ImageSlot): string {
  if (slot.emoji) {
    return `<span class="pick-glyph">${slot.emoji}</span><span>Selected <b>${escapeAttr(slot.name)}</b></span>`;
  }
  if (slot.src && ICON_PRESETS.some((icon) => icon.src === slot.src)) {
    const color = slotColor(slot);
    return `<span class="pick-glyph shape-swatch" style="background:${color};-webkit-mask-image:url(&quot;${slot.src}&quot;);mask-image:url(&quot;${slot.src}&quot;)"></span><span>Selected <b>${escapeAttr(slot.name)}</b></span>`;
  }
  if (slot.src) {
    return `<img class="pick-glyph" src="${slot.src}" alt="" /><span>Selected <b>${escapeAttr(slot.name)}</b></span>`;
  }
  return `<span class="pick-empty">Nothing selected</span>`;
}

function tintRow(slot: Slot): string {
  return `<div class="tint-row" style="--theme-count:${state.theme.length}">${state.theme
    .map((color, index) => {
      const selected = (slot.colorIndex ?? 0) === index;
      const fill = selected && slot.color ? slot.color : color;
      return `<button type="button" class="tint${selected ? " is-on" : ""}" data-tint="${index}" style="background:${fill}" aria-pressed="${selected}" aria-label="Color ${index + 1}"></button>`;
    })
    .join("")}</div>`;
}

function bindTint(root: HTMLElement, slot: Slot) {
  root.querySelectorAll<HTMLButtonElement>("[data-tint]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.tint);
      if ((slot.colorIndex ?? 0) === index) {
        openTintPicker(root, btn, slot, index);
        return;
      }
      slot.colorIndex = index;
      slot.color = undefined;
      renderPanel();
      live();
    });
  });
}

function openThemeSwatch(btn: HTMLButtonElement) {
  const index = Number(btn.dataset.theme);
  if (tintPicker?.anchor === btn) {
    tintPicker.close();
    return;
  }
  tintPicker?.close();
  const picker = mountColorPicker({
    anchor: btn,
    value: state.theme[index] ?? "#000000",
    onChange(hex) {
      state.theme[index] = hex;
      btn.style.background = hex;
      themeShelf.refresh();
      live();
    },
    onClose() {
      if (tintPicker?.anchor === btn) tintPicker = null;
    },
  });
  tintPicker = { anchor: btn, close: picker.close };
}

function openTintPicker(root: HTMLElement, btn: HTMLButtonElement, slot: Slot, index: number) {
  if (tintPicker?.anchor === btn) {
    tintPicker.close();
    return;
  }
  tintPicker?.close();
  const picker = mountColorPicker({
    anchor: btn,
    value: slot.color ?? pickTheme(state.theme, index),
    onChange(hex) {
      slot.color = hex;
      btn.style.background = hex;
      root.closest(".slot-card")?.querySelectorAll<HTMLElement>(".shape-swatch").forEach((swatch) => {
        swatch.style.background = hex;
      });
      live();
    },
    onClose() {
      if (tintPicker?.anchor === btn) tintPicker = null;
    },
  });
  tintPicker = { anchor: btn, close: picker.close };
}

function bindSlotInputs(root: HTMLElement, slot: Slot) {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-key]").forEach((input) => {
    const key = input.dataset.key;
    if (!key) return;
    if (input instanceof HTMLInputElement && input.type === "range") paintRange(input);
    input.addEventListener("input", () => {
      if (input instanceof HTMLInputElement && input.type === "range") paintRange(input);
      const value =
        input.type === "checkbox"
          ? (input as HTMLInputElement).checked
          : input.type === "number" || input.type === "range"
            ? Number(input.value)
            : input.value;
      (slot as Record<string, unknown>)[key] = value;
      if (key === "shape" || key === "size" || key === "amount" || key === "stroked") renderPanel();
      if (key === "fontFamily") {
        void activateFamily(String(value)).then(() => live());
        return;
      }
      live();
    });
  });
}

function removeSlot(id: string) {
  openSlots.delete(id);
  state.slots = state.slots.filter((slot) => slot.id !== id);
  renderPanel();
  live();
}

function reflectGlobalWeight() {
  globalWeightPick?.reflect(sharedFamily() ?? "", sharedWeight());
}

async function applyWeightEverywhere(weight: number) {
  const family = sharedFamily();
  if (!family) return;
  const chosen = chosenWeight(family, weight);
  for (const slot of allTextSlots()) slot.fontWeight = chosen;
  await settleFont(family, chosen);
  renderPanel();
  live();
}

async function applyFontEverywhere(family: string) {
  appliedFont = family;
  const listedLocal = localFamilies.some((name) => name.toLowerCase() === family.toLowerCase());
  if (listedLocal || machineFont.toLowerCase() === family.toLowerCase()) machineFont = family;
  else machineFont = "";
  await activateFamily(family);
  const weights = new Set<number>();
  for (const slot of state.slots) {
    if (slot.kind !== "text") continue;
    slot.fontFamily = family;
    slot.fontWeight = nearestWeight(family, slot.fontWeight);
    weights.add(slot.fontWeight);
  }
  await Promise.all(
    [...weights].map((weight) => document.fonts.load(`${weight} 28px "${family}"`).catch(() => undefined)),
  );
  renderPanel();
  live();
}

async function loadLocalFonts() {
  try {
    localFamilies = await queryLocalCatalog();
    renderPanel();
  } catch (error) {
    if (error instanceof Error && error.message === "unsupported") {
      window.alert("This browser can’t list local fonts. Type a font name instead.");
      return;
    }
    window.alert("Local font access was blocked. Type a font name instead.");
  }
}

function live() {
  void ensureTrims(state.slots).then(() => {
    world.refresh(
      state.slots,
      state.physics,
      state.masterScale,
      state.theme,
      state.pillPad,
      state.textTracking,
      state.textHeight,
      state.sizeRandom,
    );
  });
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

const shell = app.querySelector(".app")!;
const playBtn = app.querySelector<HTMLButtonElement>("#play")!;
const loopBtn = app.querySelector<HTMLButtonElement>("#loop")!;

let running = false;
let repeat = true;
let droppedAt = 0;
let settledSince = 0;
let holdStarted = 0;
let lastInteractAt = 0;
let phase: "idle" | "falling" | "holding" | "dumping" = "idle";

const MIN_CYCLE_MS = 1200;
const SETTLE_CONFIRM_MS = 400;
const MAX_FALL_MS = 5500;
const PLAY_IDLE_MS = 3000;

async function drop() {
  await ensureTrims(state.slots);
  world.resize(stage.clientWidth, stage.clientHeight);
  world.setFloorOpen(false);
  world.play(
    state.slots,
    state.physics,
    stage,
    state.masterScale,
    state.theme,
    state.shapeAmount,
    state.pillPad,
    state.textTracking,
    state.textHeight,
    state.sizeRandom,
  );
  droppedAt = performance.now();
  settledSince = 0;
  holdStarted = 0;
  lastInteractAt = 0;
  phase = "falling";
}

function paintTransport() {
  playBtn.textContent = running ? "Stop" : "Play";
  playBtn.classList.toggle("is-on", running);
  playBtn.setAttribute("aria-pressed", String(running));
  loopBtn.classList.toggle("is-on", repeat);
  loopBtn.setAttribute("aria-pressed", String(repeat));
}

function setRunning(on: boolean) {
  running = on;
  world.setRunning(on);
  paintTransport();
  if (on) {
    drop();
    return;
  }
  phase = "idle";
  world.setFloorOpen(false);
}

function finishRun() {
  running = false;
  phase = "idle";
  paintTransport();
}

function togglePlay() {
  setRunning(!running);
}

function toggleRepeat() {
  repeat = !repeat;
  paintTransport();
}

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], .font-pick, .font-menu, .color-pop, .theme-shelf"));
}

function adoptState(next: typeof state) {
  state.slots = next.slots;
  state.physics = next.physics;
  state.stageColor = next.stageColor;
  state.masterScale = next.masterScale;
  state.sizeRandom = next.sizeRandom;
  state.pillPad = next.pillPad;
  state.textHeight = next.textHeight;
  state.textTracking = next.textTracking;
  state.shapeAmount = next.shapeAmount;
  state.theme = next.theme;
  state.post = { ...next.post, bloomOpacity: next.post.bloomOpacity ?? 80 };
}

playBtn.addEventListener("click", togglePlay);
loopBtn.addEventListener("click", toggleRepeat);
paintTransport();
app.querySelector("#clear")?.addEventListener("click", () => {
  setRunning(false);
  world.clear();
});
app.querySelector("#reset-defaults")?.addEventListener("click", () => {
  setRunning(false);
  world.clear();
  machineFont = "";
  appliedFont = "";
  adoptState(freshState());
  applyStageColor();
  applyPost();
  renderPanel();
});

const copyBtn = app.querySelector<HTMLButtonElement>("#copy-settings")!;
copyBtn.addEventListener("click", async () => {
  const payload = {
    stageColor: state.stageColor,
    masterScale: state.masterScale,
    sizeRandom: state.sizeRandom,
    pillPad: state.pillPad,
    textHeight: state.textHeight,
    textTracking: state.textTracking,
    shapeAmount: state.shapeAmount,
    theme: [...state.theme],
    physics: { ...state.physics },
    post: { ...state.post },
    slots: state.slots,
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  copyBtn.textContent = "Copied";
  window.setTimeout(() => {
    copyBtn.textContent = "Copy settings";
  }, 1500);
});

window.addEventListener("keydown", (event) => {
  if (typingInField(event.target)) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
    return;
  }
  if (event.key === "h" || event.key === "H") {
    shell.classList.toggle("ui-hidden");
    resize();
  }
});

mountProTip(shell);
world.attach(stage);

const resize = () => world.resize(stage.clientWidth, stage.clientHeight);
window.addEventListener("resize", resize);
resize();
applyStageColor();
applyPost();
renderPanel();
void ensureTrims(state.slots);

let prevFrame = 0;

function frame(now: number) {
  const dt = prevFrame ? now - prevFrame : 0;
  prevFrame = now;
  world.sync();
  world.purgeFallen(stage.clientHeight);

  if (world.isDragging()) lastInteractAt = now;
  const playing = lastInteractAt > 0 && now - lastInteractAt < PLAY_IDLE_MS;

  if (running && playing) {
    droppedAt += dt;
    if (settledSince) settledSince += dt;
    if (holdStarted) holdStarted += dt;
    if (phase === "holding") {
      phase = "falling";
      settledSince = 0;
      holdStarted = 0;
    }
    return requestAnimationFrame(frame);
  }

  if (running) {
    if (phase === "falling") {
      const elapsed = now - droppedAt;
      if (elapsed >= MAX_FALL_MS || (elapsed >= MIN_CYCLE_MS && world.isSettled() && settledSince && now - settledSince >= SETTLE_CONFIRM_MS)) {
        phase = "holding";
        holdStarted = now;
      } else if (elapsed >= MIN_CYCLE_MS && world.isSettled()) {
        if (!settledSince) settledSince = now;
      } else if (!world.isQuiet()) {
        settledSince = 0;
      }
    } else if (phase === "holding" && now - holdStarted >= state.physics.hold * 1000) {
      if (!repeat) {
        finishRun();
      } else {
        world.setFloorOpen(true);
        phase = "dumping";
      }
    } else if (phase === "dumping" && world.chipCount() === 0) {
      if (!repeat) finishRun();
      else void drop();
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
