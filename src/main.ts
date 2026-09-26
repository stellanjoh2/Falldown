import { canvasFrame, type CanvasFrame, type CanvasRatio } from "./canvas";
import { FEATURED_EMOJI, searchEmoji, type EmojiItem } from "./emojis";
import { ICON_PRESETS } from "./icons";
import { isPresetId, matchCollider, presetIdForSrc } from "./iconMesh";
import {
  bundledWeights,
  BLEND_MODES,
  blendMode,
  DEFAULT_AUDIO_REACT,
  DEFAULT_PHYSICS,
  PHYSICS_COMPLEXITY,
  physicsComplexity,
  normalizeBackground,
  defaultImageSlot,
  defaultTextSlot,
  defaultTypeSlot,
  demoState,
  shapeHasFill,
  uid,
  FALLBACK_WEIGHTS,
  FONTS,
  type AppState,
  type ImageSlot,
  type Slot,
  type TextSlot,
  weightName,
} from "./types";
import { isMicActive, sampleOnset, startMic, stopMic } from "./audioReact";
import { activateFamily, localWeights, queryLocalCatalog } from "./localFonts";
import { closeBackgroundUi, mountBackgroundPanel } from "./backgroundPanel";
import { backgroundImage, backgroundPaint, gridDivisions, logoFill, logoSize, isSvgLogo } from "./background";
import { mountColorPicker } from "./colorPicker";
import { fillSample, gradientAngleOf, gradientEnd, gradientEndIndex, gradientPeriodMs, gradientScaleOf, gradientSpeedOf, pillGradient, pillSweepGradient } from "./pillFill";
import { textAnimSpeedOf } from "./textAnim";
import { pickTheme, resolveTextColor, resolveTextSwatchIndex, textSwatches } from "./theme";
import { mountProTip } from "./proTip";
import { mountTooltips } from "./tooltip";
import { createThemeShelf } from "./themeShelf";
import { mountExportPanel } from "./export/exportPanel";
import { ensureTrim, ensureTrims, peekTrim } from "./trim";
import { pillPadOf, trackingOf } from "./measure";
import { createWorld, isColorMask } from "./world";
import { bindSlotDrag, cancelSlotDrag } from "./slotDrag";
import { bindUiClickSounds, playClick, playCreate, playInvert, playNotify, playRemove, playSwitch, setUiSoundsMuted } from "./uiSounds";
import pencilSimple from "@phosphor-icons/core/assets/regular/pencil-simple.svg?raw";
import plus from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

function freshState() {
  const next = demoState();
  const presetIcon = (name: string, amount: number, colorIndex: number, extra: Partial<ImageSlot> = {}) => {
    const icon = ICON_PRESETS.find((preset) => preset.label === name);
    if (!icon) return null;
    return defaultImageSlot({
      src: icon.src,
      name: icon.label,
      size: 56,
      amount,
      colorIndex,
      ...extra,
    });
  };
  const [techno, nope, hardcore, singleAf, noWay, dnb, gtfo, friday, tokyo, doors, oh] = next.slots;
  next.slots = [
    techno,
    nope,
    hardcore,
    singleAf,
    noWay,
    presetIcon("Stars", 3, 4, { gradient: true, gradientColorIndex: 0, gradientAngle: 253 }),
    presetIcon("Clovers", 3, 3),
    dnb,
    defaultImageSlot({ src: "", name: "Fire", emoji: "🔥", size: 56, amount: 3, colorIndex: 2, scale: 0.7 }),
    presetIcon("Stars", 2, 1),
    defaultImageSlot({ src: "", name: "Skull", emoji: "💀", size: 56, amount: 2, colorIndex: 1, scale: 0.65 }),
    defaultImageSlot({ src: "", name: "Cool", emoji: "😎", size: 56, amount: 2, colorIndex: 1, scale: 0.7 }),
    gtfo,
    friday,
    tokyo,
    doors,
    oh,
  ].filter((slot): slot is Slot => slot != null);
  return next;
}

const state = freshState();
let panelTab: "physics" | "background" | "export" = "physics";
const openSlots = new Set<string>();
let pickedSlotId: string | null = null;
let focusSlotId: string | null = null;
let revealSlotId: string | null = null;

type InsertMotion = {
  id: string;
  scroll: number;
  /** First row that should slide down. Null when the copy is the last row. */
  anchorId: string | null;
  anchorTop: number;
};

let insertMotion: InsertMotion | null = null;

const DUPLICATE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="4" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="4" y="9" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>`;
let tintPicker: { anchor: HTMLElement; close: () => void } | null = null;

const world = createWorld();

app.innerHTML = `
  <div class="app">
    <div class="stage" id="stage">
      <div class="stage-veil" id="stage-veil" hidden>
        <div data-side="top"></div>
        <div data-side="right"></div>
        <div data-side="bottom"></div>
        <div data-side="left"></div>
      </div>
        <div class="playfield" id="playfield">
        <div class="grid-layer" id="grid-layer" hidden aria-hidden="true"></div>
        <div class="logo-layer" id="logo-layer" hidden></div>
        <div class="pile">
          <div class="chip-layer"></div>
          <div class="bloom-layer" aria-hidden="true">
            <div class="bloom-blur">
              <div class="logo-layer" id="logo-bloom" hidden></div>
            </div>
          </div>
        </div>
        <div class="post-grain" aria-hidden="true"></div>
        <div class="post-vignette" aria-hidden="true"></div>
        <canvas class="phys-debug" id="phys-debug" aria-hidden="true" hidden></canvas>
      </div>
    </div>
    <header class="topbar">
      <h1 class="logotype">Ultrapilled</h1>
    </header>
    <aside class="panel">
      <div class="panel-actions">
        <button type="button" class="pill" id="play" aria-pressed="false" data-tip="Start or pause the fall">Play</button>
        <button type="button" class="pill" id="undo" disabled aria-keyshortcuts="Meta+Z Control+Z" data-tip="Undo the last change">Undo</button>
        <button type="button" class="pill" id="redo" disabled aria-keyshortcuts="Meta+Shift+Z Control+Y" data-tip="Redo the last undone change">Redo</button>
        <button type="button" class="pill" id="clear" data-tip="Clear every falling piece from the canvas">Reset canvas</button>
        <button type="button" class="pill" id="reset-defaults" data-tip="Restore default sliders and options">Reset settings</button>
        <button type="button" class="pill" id="copy-settings" data-tip="Copy the current settings as text">Copy settings</button>
        <button type="button" class="pill" id="loop" aria-pressed="false" data-tip="Keep the floor opening so the fall never ends">Loop</button>
      </div>
      <div class="panel-tabs" role="tablist" aria-label="Panel">
        <button type="button" class="panel-tabs__tab is-active" id="tab-physics" role="tab" aria-selected="true" data-tip="Build what falls and how it moves">Create</button>
        <button type="button" class="panel-tabs__tab" id="tab-background" role="tab" aria-selected="false" data-tip="Stage color, grid, and logo">Background</button>
        <button type="button" class="panel-tabs__tab" id="tab-export" role="tab" aria-selected="false" data-tip="Save stills, sequences, or video">Export</button>
        <span class="panel-tabs__line" id="tab-line" data-tab="physics" aria-hidden="true"></span>
      </div>
      <div class="panel-scroll" id="panel"></div>
    </aside>
  </div>
`;

bindUiClickSounds(app);

const stage = app.querySelector<HTMLElement>("#stage")!;
const playfield = app.querySelector<HTMLElement>("#playfield")!;
const stageVeil = app.querySelector<HTMLElement>("#stage-veil")!;
const physDebugCanvas = app.querySelector<HTMLCanvasElement>("#phys-debug")!;
let physDebugOn = false;
const panel = app.querySelector<HTMLElement>("#panel")!;
const panelShell = app.querySelector<HTMLElement>(".panel")!;
const themeShelf = createThemeShelf({
  panel: panelShell,
  getColors: () => state.theme,
  onApply(colors, stage) {
    remember();
    state.theme = [...colors];
    if (stage) {
      state.stageColor = stage;
      state.background.kind = "solid";
      applyBackground();
    }
    for (const slot of state.slots) {
      slot.color = undefined;
      if (slot.kind !== "text") continue;
      slot.textColor = undefined;
      slot.textColorIndex = undefined;
    }
    applyLogo();
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

const bundledFamilies = new Set<string>(FONTS.map((font) => font.id));

/** Canvas measureText uses fallback metrics until the face is loaded. */
async function ensureTextFonts(slots: Slot[]): Promise<void> {
  const textSlots = slots.filter((slot): slot is TextSlot => slot.kind === "text");
  const families = [...new Set(textSlots.map((slot) => slot.fontFamily).filter(Boolean))];
  await Promise.all(
    families.filter((family) => !bundledFamilies.has(family)).map((family) => activateFamily(family)),
  );
  const groups = new Map<string, { weight: number; family: string; sample: string }>();
  for (const slot of textSlots) {
    const key = `${slot.fontWeight}\0${slot.fontFamily}`;
    const group = groups.get(key) ?? { weight: slot.fontWeight, family: slot.fontFamily, sample: "" };
    group.sample += `${slot.text || " "} `;
    groups.set(key, group);
  }
  await Promise.all(
    [...groups.values()].map((group) =>
      document.fonts.load(`${group.weight} 28px "${group.family}"`, group.sample).catch(() => undefined),
    ),
  );
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

function applyBackground() {
  const paint = backgroundPaint(state.background, state.canvas, state.stageColor);
  stage.style.background = state.stageColor;
  playfield.style.backgroundColor = paint.color;
  playfield.style.backgroundImage = paint.image;
  playfield.style.backgroundSize = paint.size;
  playfield.style.backgroundPosition = paint.position;
  playfield.style.backgroundRepeat = paint.repeat;
  applyGrid();
  applyLogo();
}

function applyGrid() {
  const layer = playfield.querySelector<HTMLElement>("#grid-layer");
  if (!layer) return;
  const { background, canvas } = state;
  const on = background.grid;
  layer.hidden = !on;
  if (!on) return;
  const { cols, rows } = gridDivisions(canvas, background.gridDensity === "fine" ? "fine" : "base");
  layer.style.setProperty("--grid-color", background.gridColor || "#ffffff");
  layer.style.setProperty("--grid-opacity", `${(background.gridOpacity ?? 0) / 100}`);
  layer.style.setProperty("--grid-cols", String(cols));
  layer.style.setProperty("--grid-rows", String(rows));
}

const logoImages = new Map<string, HTMLImageElement>();
let logoNode: HTMLElement | null = null;
let logoGlow: HTMLElement | null = null;

function applyLogo() {
  const layer = playfield.querySelector<HTMLElement>("#logo-layer");
  const glowLayer = playfield.querySelector<HTMLElement>("#logo-bloom");
  if (!layer) return;
  const background = state.background;
  const file = backgroundImage(background.logoId ?? "");
  const clearGlow = () => {
    if (!glowLayer) return;
    glowLayer.hidden = true;
    glowLayer.replaceChildren();
    logoGlow = null;
  };
  if (!file) {
    layer.hidden = true;
    layer.replaceChildren();
    logoNode = null;
    clearGlow();
    return;
  }
  const draw = (image: HTMLImageElement) => {
    if (background.logoId !== state.background.logoId) return;
    const imgW = file.width || image.naturalWidth || image.width || 1;
    const imgH = file.height || image.naturalHeight || image.height || 1;
    const size = logoSize(playfield.clientWidth, playfield.clientHeight, imgW, imgH, background.logoScale || 1);
    const svg = isSvgLogo(file.name, file.src);
    const fill = svg ? logoFill(state.background, state.theme) : null;
    const mode = fill ? "mask" : "image";
    const place = (host: HTMLElement, node: HTMLElement | null) => {
      host.hidden = false;
      if (!node || node.dataset.mode !== mode || node.dataset.id !== background.logoId) {
        const next = document.createElement(fill ? "div" : "img");
        next.className = "logo-mark";
        next.dataset.mode = mode;
        next.dataset.id = background.logoId;
        if (next instanceof HTMLImageElement) {
          next.src = file.src;
          next.alt = "";
          next.draggable = false;
        }
        node = next;
        host.replaceChildren(next);
      }
      node.style.width = `${size.width}px`;
      node.style.height = `${size.height}px`;
      if (fill) {
        node.style.background = fill;
        const mask = `url("${file.src}")`;
        node.style.maskImage = mask;
        node.style.webkitMaskImage = mask;
      }
      return node;
    };
    logoNode = place(layer, logoNode);
    if (svg && glowLayer) logoGlow = place(glowLayer, logoGlow);
    else clearGlow();
  };
  const cached = logoImages.get(background.logoId);
  if (cached?.complete) {
    draw(cached);
    return;
  }
  const image = new Image();
  image.onload = () => {
    logoImages.set(background.logoId, image);
    draw(image);
  };
  image.src = file.src;
}

function applyPost() {
  const amount = state.post.bloom / 100;
  const bloom = amount * 48;
  const bloomOpacity = `${(state.post.bloomOpacity / 100) * amount}`;
  document.documentElement.style.setProperty("--bloom", `${bloom}px`);
  document.documentElement.style.setProperty("--bloom-opacity", bloomOpacity);
  stage.style.setProperty("--bloom", `${bloom}px`);
  stage.style.setProperty("--bloom-opacity", bloomOpacity);
  stage.style.setProperty("--post-blend", state.post.blend);
  stage.style.setProperty("--post-grain", `${state.post.grain / 100}`);
  stage.style.setProperty("--post-vig", `${state.post.vignette / 140}`);
  stage.style.setProperty("--post-sat", `${state.post.saturate / 100}`);
  const hueDeg = Math.round(state.post.hue + audioHueOffset);
  const hue = `${((hueDeg % 360) + 360) % 360}deg`;
  document.documentElement.style.setProperty("--post-hue", hue);
  stage.style.setProperty("--post-hue", hue);
  stage.classList.toggle("has-bloom", state.post.bloom > 0 && state.post.bloomOpacity > 0);
  stage.classList.toggle("has-sat", state.post.saturate !== 100);
  stage.classList.toggle("has-hue", hueDeg % 360 !== 0);
}

const RESET_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M3 3v5h5"/></svg>';

const exportController = {
  prepare: async () => {
    await Promise.all([ensureTrims(state.slots), ensureTextFonts(state.slots)]);
  },
  stageSize: () => {
    const frame = currentFrame();
    return { width: frame.width, height: frame.height, scale: layoutScale(frame) };
  },
  draws: () => world.draws(),
  state: () => state,
};

function paintPanelTabs() {
  const tabs = [
    ["physics", document.querySelector("#tab-physics")],
    ["background", document.querySelector("#tab-background")],
    ["export", document.querySelector("#tab-export")],
  ] as const;
  for (const [id, tab] of tabs) {
    tab?.classList.toggle("is-active", panelTab === id);
    tab?.setAttribute("aria-selected", String(panelTab === id));
  }
  document.querySelector("#tab-line")?.setAttribute("data-tab", panelTab);
}

function fallingImages(): ImageSlot[] {
  return state.slots.filter((slot): slot is ImageSlot => slot.kind === "image" && Boolean(slot.src || slot.emoji));
}

function clampImageAmounts() {
  for (const slot of fallingImages()) {
    slot.amount = Math.max(1, Math.min(AMOUNT_SOFT_CAP, Math.round(slot.amount)));
  }
}

function recountShapes() {
  clampImageAmounts();
  state.shapeAmount = fallingImages().reduce((sum, slot) => sum + Math.max(1, Math.round(slot.amount)), 0);
}

/** Soft limits keep live play near 60 fps; export still uses the same amounts. */
const AMOUNT_SOFT_CAP = 8;
const SHAPE_TOTAL_SOFT_CAP = 36;
const SCALE_PERF_WARN = 5;
const SHAPE_PERF_WARN = 20;

function shapeAmountRange() {
  const count = fallingImages().length;
  const per = AMOUNT_SOFT_CAP;
  return { min: count, max: Math.max(12, Math.min(count * per, SHAPE_TOTAL_SOFT_CAP)) };
}

/** Split `total` whole items across weights. The returned counts add up to `total`. */
function shareTotal(weights: number[], total: number): number[] {
  const count = weights.length;
  if (count === 0 || total <= 0) return weights.map(() => 0);
  const safe = weights.map((weight) => Math.max(0, weight));
  const sum = safe.reduce((acc, weight) => acc + weight, 0);
  const exact = sum > 0 ? safe.map((weight) => (total * weight) / sum) : safe.map(() => total / count);
  const counts = exact.map((value) => Math.floor(value));
  let left = total - counts.reduce((acc, value) => acc + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  let cursor = 0;
  while (left > 0) {
    counts[order[cursor % count].index] += 1;
    left -= 1;
    cursor += 1;
  }
  return counts;
}

/** Scale per-shape amounts so they sum to `total`, keeping at least 1 and at most the soft cap. */
function scaleShapeAmounts(weights: number[], total: number): number[] {
  const count = weights.length;
  const cap = AMOUNT_SOFT_CAP;
  if (count === 0) return [];
  const goal = Math.max(count, Math.min(count * cap, Math.round(total)));
  const counts = shareTotal(weights.map((weight) => Math.max(1, weight)), goal - count).map((extra) => extra + 1);
  for (let pass = 0; pass < count + 1; pass++) {
    let overflow = 0;
    for (let i = 0; i < count; i++) {
      if (counts[i] > cap) {
        overflow += counts[i] - cap;
        counts[i] = cap;
      }
    }
    if (overflow === 0) return counts;
    const room = counts.map((amount, index) => (amount < cap ? index : -1)).filter((index) => index >= 0);
    if (room.length === 0) return counts;
    const give = shareTotal(
      room.map((index) => Math.max(1, cap - counts[index])),
      overflow,
    );
    room.forEach((index, slot) => {
      counts[index] += give[slot];
    });
  }
  return counts.map((amount) => Math.max(1, Math.min(cap, amount)));
}

function paintImageAmounts() {
  for (const slot of fallingImages()) {
    const card = panel.querySelector<HTMLElement>(`.slot-card[data-id="${slot.id}"]`);
    if (!card) continue;
    const input = card.querySelector<HTMLInputElement>('[data-key="amount"]');
    if (input) {
      input.value = String(slot.amount);
      paintRange(input);
    }
    const caption = card.querySelector("[data-range-label='amount']");
    if (caption) caption.textContent = `Amount ${slot.amount}`;
    paintFieldReset(card, slot, "amount");
  }
}

function paintPerfHints() {
  const scaleHint = panel.querySelector<HTMLElement>("#scale-perf-hint");
  if (scaleHint) scaleHint.hidden = state.masterScale < SCALE_PERF_WARN;
  const amountHint = panel.querySelector<HTMLElement>("#amount-perf-hint");
  if (amountHint) amountHint.hidden = state.shapeAmount < SHAPE_PERF_WARN;
}

function scaleFallingAmounts(total: number) {
  const images = fallingImages();
  if (!images.length) {
    state.shapeAmount = 0;
    return;
  }
  const counts = scaleShapeAmounts(images.map((slot) => slot.amount), total);
  images.forEach((slot, index) => {
    slot.amount = counts[index];
  });
  recountShapes();
  paintImageAmounts();
}

function renderPanel() {
  const inserted = insertMotion;
  insertMotion = null;
  cancelSlotDrag();
  const scroll = panel.scrollTop;
  closeFontMenu();
  closeSlotMenu();
  closeBackgroundUi();
  tintPicker?.close();
  paintPanelTabs();
  recountShapes();
  if (panelTab === "export") {
    mountExportPanel(panel, exportController, scroll);
    return;
  }
  if (panelTab === "background") {
    mountBackgroundPanel(panel, {
      state: () => state,
      remember,
      endGesture,
      apply: applyBackground,
      refresh: renderPanel,
      showing: () => panelTab === "background",
    }, scroll);
    return;
  }
  const shapes = shapeAmountRange();
  panel.innerHTML = `
    <section class="section">
      <h2 data-tip="Widescreen or vertical frame">Canvas</h2>
      <div class="segment" role="group" aria-label="Canvas">
        <button type="button" class="pill${state.canvas === "16:9" ? " is-on" : ""}" data-canvas="16:9" aria-pressed="${state.canvas === "16:9"}" data-tip="Landscape frame">16:9</button>
        <button type="button" class="pill${state.canvas === "9:16" ? " is-on" : ""}" data-canvas="9:16" aria-pressed="${state.canvas === "9:16"}" data-tip="Portrait frame">9:16</button>
      </div>
    </section>
    <section class="section">
      <div class="section-head">
        <h2 data-tip="Overall size and spacing of pieces">Composition</h2>
        <button type="button" class="section-reset" id="reset-master" aria-label="Reset composition" data-tip="Reset composition sliders">${RESET_ICON}</button>
      </div>
      <label class="field" data-tip="Overall size of every piece"><span data-range-label="masterScale">Scale ${(state.masterScale * 10).toFixed(0)}</span>
        <input type="range" id="masterScale" min="4" max="100" step="1" value="${state.masterScale * 10}" />
      </label>
      <p class="hint" id="scale-perf-hint"${state.masterScale >= SCALE_PERF_WARN ? "" : " hidden"}>High scale can drop below 60 fps with many shapes.</p>
      <label class="field" data-tip="How much piece sizes vary"><span data-range-label="sizeRandom">Size random ${state.sizeRandom}</span>
        <input type="range" id="sizeRandom" min="0" max="100" step="1" value="${state.sizeRandom}" />
      </label>
      <label class="field" data-tip="Space inside text holding shapes"><span data-range-label="pillPad">Shape padding ${state.pillPad}</span>
        <input type="range" id="pillPad" min="0" max="100" step="1" value="${state.pillPad}" />
      </label>
      <label class="field" data-tip="Letter spacing for text"><span data-range-label="textTracking">Tracking ${state.textTracking}</span>
        <input type="range" id="textTracking" min="-100" max="100" step="1" value="${state.textTracking}" />
      </label>
      <label class="field" data-tip="How many pieces drop into the frame"><span data-range-label="shapeAmount">Amount of shapes ${state.shapeAmount}</span>
        <input type="range" id="shapeAmount" min="${shapes.min}" max="${shapes.max}" step="1" value="${state.shapeAmount}" />
      </label>
      <p class="hint" id="amount-perf-hint"${state.shapeAmount >= SHAPE_PERF_WARN ? "" : " hidden"}>Many shapes can drop below 60 fps.</p>
    </section>
    <section class="section">
      <h2 data-tip="Colors used by pills and shapes">Color theme</h2>
      <button type="button" class="pill theme-launch" id="view-themes" data-tip="Browse ready-made color palettes">View Themes</button>
      <div class="theme-row" style="--theme-count:${state.theme.length}">
        ${state.theme
          .map(
            (color, i) =>
              `<button type="button" class="theme-swatch" data-theme="${i}" style="background:${color}" aria-label="Theme color ${i + 1}" data-tip="Edit theme color ${i + 1}"></button>`,
          )
          .join("")}
      </div>
    </section>
    <section class="section">
      <h2 data-tip="Fonts for all text pills">Typeface</h2>
      <div class="field" data-tip="Apply one font to every text piece">All text
        <div class="font-pick" id="global-font"></div>
      </div>
      <div class="field" data-tip="Default weight for all text">Weight
        <div class="font-pick" id="global-weight"></div>
      </div>
      <div class="row">
        <div class="field" data-tip="Type a font name installed on this computer">Font from this computer
          <input type="text" id="machine-font" list="local-font-list" placeholder="e.g. Helvetica Neue" value="${escapeAttr(machineFont)}" />
        </div>
      </div>
      <datalist id="local-font-list">
        ${localFamilies.map((name) => `<option value="${escapeAttr(name)}"></option>`).join("")}
      </datalist>
      <button type="button" class="pill" id="load-local-fonts" data-tip="Let the browser list fonts installed on this computer">Load local fonts</button>
    </section>
    <section class="section">
      <h2 data-tip="The pieces that drop into the frame">What falls down</h2>
      <div class="slot-stack" id="slots"></div>
      <div class="slot-adds">
        <button type="button" class="pill slot-add" id="add-text" data-tip="Add a text label inside a rounded pill">
          <span class="slot-add__icon" aria-hidden="true">${plus}</span>
          Add pill
        </button>
        <button type="button" class="pill slot-add" id="add-type" data-tip="Add bare text without a pill shape">
          <span class="slot-add__icon" aria-hidden="true">${plus}</span>
          Add Text
        </button>
        <button type="button" class="pill slot-add" id="add-image" data-tip="Add a shape or emoji icon">
          <span class="slot-add__icon" aria-hidden="true">${plus}</span>
          Add icon
        </button>
      </div>
    </section>
    <section class="section">
      <div class="section-head">
        <h2 data-tip="How pieces fall, bounce, and settle">Physics</h2>
        <button type="button" class="section-reset" id="reset-physics" aria-label="Reset physics" data-tip="Reset physics sliders">${RESET_ICON}</button>
      </div>
      <label class="field" data-tip="Simple = boxes, Normal = circle/box, Ultra = traced icon shapes. Higher is heavier on the CPU.">Physics complexity
        <select id="physics-complexity">
          ${PHYSICS_COMPLEXITY.map((tier) => `<option value="${tier.id}"${state.physics.complexity === tier.id ? " selected" : ""}>${tier.label}</option>`).join("")}
        </select>
      </label>
      <div class="row">
        <label class="field" data-tip="How hard pieces pull downward"><span data-range-label="gravity">Gravity ${state.physics.gravity.toFixed(2)}</span>
          <input type="range" id="gravity" min="0" max="3" step="0.05" value="${state.physics.gravity}" />
        </label>
      </div>
      <div class="row">
        <label class="field" data-tip="How fast the simulation runs"><span data-range-label="speed">Speed ${state.physics.speed.toFixed(2)}</span>
          <input type="range" id="speed" min="0.2" max="2" step="0.05" value="${state.physics.speed}" />
        </label>
      </div>
      <div class="row">
        <label class="field" data-tip="How springy collisions are"><span data-range-label="bounce">Bounciness ${state.physics.bounce.toFixed(2)}</span>
          <input type="range" id="bounce" min="0" max="1" step="0.05" value="${state.physics.bounce}" />
        </label>
      </div>
      <div class="row">
        <label class="field" data-tip="Slide resistance when pieces touch"><span data-range-label="friction">Friction ${state.physics.friction.toFixed(2)}</span>
          <input type="range" id="friction" min="0" max="1" step="0.05" value="${state.physics.friction}" />
        </label>
      </div>
      <div class="row">
        <label class="field" data-tip="How much pieces stick while sliding"><span data-range-label="grip">Grip ${state.physics.grip.toFixed(2)}</span>
          <input type="range" id="grip" min="0" max="1" step="0.05" value="${state.physics.grip}" />
        </label>
      </div>
      <div class="row">
        <label class="field" data-tip="How quickly spinning slows down"><span data-range-label="spin">Spin drag ${state.physics.spin.toFixed(2)}</span>
          <input type="range" id="spin" min="0" max="0.12" step="0.01" value="${state.physics.spin}" />
        </label>
      </div>
      <label class="field" data-tip="How long the floor stays closed before opening"><span data-range-label="hold">Floor pause ${state.physics.hold.toFixed(2)}s</span>
        <input type="range" id="hold" min="0.2" max="4" step="0.05" value="${state.physics.hold}" />
      </label>
    </section>
    <section class="section">
      <h2 data-tip="Post-process color and glow on the whole frame">Look</h2>
      <label class="field" data-tip="Shift all colors around the wheel"><span data-range-label="hue">Hue ${state.post.hue}°</span>
        <input type="range" id="hue" min="0" max="360" step="1" value="${state.post.hue}" />
      </label>
      <label class="field" data-tip="Soft glow around bright areas"><span data-range-label="bloom">Bloom ${state.post.bloom}</span>
        <input type="range" id="bloom" min="0" max="100" step="1" value="${state.post.bloom}" />
      </label>
      <label class="field" data-tip="Strength of the glow"><span data-range-label="bloomOpacity">Bloom opacity ${state.post.bloomOpacity}</span>
        <input type="range" id="bloomOpacity" min="0" max="100" step="1" value="${state.post.bloomOpacity}" />
      </label>
      <label class="field" data-tip="Film-grain texture over the frame"><span data-range-label="grain">Grain ${state.post.grain}</span>
        <input type="range" id="grain" min="0" max="100" step="1" value="${state.post.grain}" />
      </label>
      <label class="field" data-tip="Darken the edges of the frame"><span data-range-label="vignette">Vignette ${state.post.vignette}</span>
        <input type="range" id="vignette" min="0" max="100" step="1" value="${state.post.vignette}" />
      </label>
      <label class="field" data-tip="Color intensity"><span data-range-label="saturate">Saturate ${state.post.saturate}</span>
        <input type="range" id="saturate" min="40" max="180" step="1" value="${state.post.saturate}" />
      </label>
      <label class="field" data-tip="How overlapping pieces mix colors">Blending mode
        <select id="blend">
          ${BLEND_MODES.map((mode) => `<option value="${mode.id}"${state.post.blend === mode.id ? " selected" : ""}>${mode.label}</option>`).join("")}
        </select>
      </label>
    </section>
    <section class="section">
      <div class="section-head">
        <h2 data-tip="Bass swells pills; sharp hits make icons hop">Audio react</h2>
        <button type="button" class="section-reset" id="reset-audio-react" aria-label="Reset audio react" data-tip="Reset audio react">${RESET_ICON}</button>
      </div>
      <div class="check-row">
        <label class="check" data-tip="Ask for mic access and drive scale from live audio">
          <input type="checkbox" id="audio-mic" ${state.audioReact.enabled ? "checked" : ""} />
          Microphone
        </label>
      </div>
      <label class="field" data-tip="How easily quiet sounds trigger a reaction"><span data-range-label="audioSensitivity">Sensitivity ${Math.round(state.audioReact.sensitivity)}</span>
        <input type="range" id="audioSensitivity" min="0" max="100" step="1" value="${state.audioReact.sensitivity}" />
      </label>
      <label class="field" data-tip="How hard pieces hop on a hit"><span data-range-label="audioBounce">Bounce intensity ${state.audioReact.bounce.toFixed(1)}×</span>
        <input type="range" id="audioBounce" min="1" max="4" step="0.1" value="${state.audioReact.bounce}" />
      </label>
      <label class="field" data-tip="How much text pills swell on bass hits"><span data-range-label="audioBassBoost">Bass boost +${Math.round(state.audioReact.bassBoost)}%</span>
        <input type="range" id="audioBassBoost" min="5" max="20" step="1" value="${state.audioReact.bassBoost}" />
      </label>
      <label class="field" data-tip="Small color-wheel kick on sharp hits that snaps back"><span data-range-label="audioHueNudge">Hue nudge ${Math.round(state.audioReact.hueNudge)}°</span>
        <input type="range" id="audioHueNudge" min="0" max="30" step="1" value="${state.audioReact.hueNudge}" />
      </label>
      <p class="hint audio-react-hint" id="audio-react-hint" aria-live="polite">${
        state.audioReact.enabled
          ? isMicActive()
            ? "Listening — bass → pills, sharp → icon hop."
            : "Waiting for microphone…"
          : "Turn on the mic to react to kicks and sharp hits."
      }</p>
    </section>
    <p class="hint">Cmd+Z undoes. Space pauses. Loop keeps the floor opening. H hides the UI.</p>
    <footer class="panel-credit">
      <span class="panel-credit__s" aria-hidden="true"></span>
      <p>
        Ultrapilled is created by<br />
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
        <a href="https://github.com/stellanjoh2/Ultrapilled" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
          <svg viewBox="0 0 98 96" aria-hidden="true">
            <path fill="currentColor" d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z" />
          </svg>
        </a>
      </p>
    </footer>
  `;

  panel.querySelectorAll<HTMLButtonElement>("[data-canvas]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.canvas;
      if (next === "16:9" || next === "9:16") selectCanvas(next);
    });
  });

  const slotStack = panel.querySelector<HTMLElement>("#slots")!;
  for (const slot of state.slots) slotStack.append(renderSlotCard(slot));
  bindSlotDrag(slotStack, panel, applySlotOrder);

  panel.querySelector("#add-text")?.addEventListener("click", () => {
    remember();
    const font: Partial<TextSlot> = {};
    if (appliedFont) {
      font.fontFamily = appliedFont;
      const weight = sharedFamily() === appliedFont ? sharedWeight() : null;
      font.fontWeight = chosenWeight(appliedFont, weight ?? 700);
    }
    const slot = defaultTextSlot({ colorIndex: state.slots.length % state.theme.length, ...font });
    captureBaseline(slot);
    state.slots.push(slot);
    openOnly(slot.id);
    focusSlotId = slot.id;
    revealSlotId = slot.id;
    playCreate();
    renderPanel();
    live();
  });
  panel.querySelector("#add-type")?.addEventListener("click", () => {
    remember();
    const font: Partial<TextSlot> = {};
    if (appliedFont) {
      font.fontFamily = appliedFont;
      const weight = sharedFamily() === appliedFont ? sharedWeight() : null;
      font.fontWeight = chosenWeight(appliedFont, weight ?? 700);
    }
    const slot = defaultTypeSlot({ colorIndex: state.slots.length % state.theme.length, ...font });
    captureBaseline(slot);
    state.slots.push(slot);
    openOnly(slot.id);
    focusSlotId = slot.id;
    revealSlotId = slot.id;
    playCreate();
    renderPanel();
    live();
  });
  panel.querySelector("#add-image")?.addEventListener("click", () => {
    remember();
    const slot = defaultImageSlot({ colorIndex: state.slots.length % state.theme.length });
    captureBaseline(slot);
    state.slots.push(slot);
    openOnly(slot.id);
    revealSlotId = slot.id;
    playCreate();
    renderPanel();
    live();
  });

  bindRange("masterScale", "Scale", (v) => {
    state.masterScale = v / 10;
    paintPerfHints();
    live();
  }, (v) => `${v.toFixed(0)}`);
  bindRange("sizeRandom", "Size random", (v) => {
    state.sizeRandom = Math.round(v);
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("pillPad", "Shape padding", (v) => {
    state.pillPad = Math.round(v);
    syncInheritedPillPads();
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("textTracking", "Tracking", (v) => {
    state.textTracking = Math.round(v);
    syncInheritedTracking();
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("shapeAmount", "Amount of shapes", (v) => {
    scaleFallingAmounts(Math.round(v));
    const input = panel.querySelector<HTMLInputElement>("#shapeAmount");
    if (input && Number(input.value) !== state.shapeAmount) {
      input.value = String(state.shapeAmount);
      paintRange(input);
    }
    paintPerfHints();
    live();
  }, () => `${state.shapeAmount}`);
  panel.querySelector("#reset-master")?.addEventListener("click", () => {
    remember();
    const next = demoState();
    state.masterScale = next.masterScale;
    state.sizeRandom = next.sizeRandom;
    state.pillPad = next.pillPad;
    state.textTracking = next.textTracking;
    scaleFallingAmounts(next.shapeAmount);
    live();
    renderPanel();
  });

  const globalFont = panel.querySelector<HTMLElement>("#global-font");
  if (globalFont) {
    mountFontPick(globalFont, appliedFont, (family) => {
      if (family) void applyFontEverywhere(family);
      else appliedFont = "";
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
    if (!family) {
      machineFont = "";
      return;
    }
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
  panel.querySelector("#reset-physics")?.addEventListener("click", () => {
    remember();
    state.physics = { ...DEFAULT_PHYSICS };
    live();
    renderPanel();
  });
  panel.querySelector<HTMLSelectElement>("#physics-complexity")?.addEventListener("change", (e) => {
    remember();
    state.physics.complexity = physicsComplexity((e.target as HTMLSelectElement).value);
    playClick();
    live();
  });
  panel.querySelector<HTMLInputElement>("#audio-mic")?.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    remember();
    void setAudioReactEnabled(on);
  });
  bindRange("audioSensitivity", "Sensitivity", (v) => {
    state.audioReact.sensitivity = Math.round(v);
  }, (v) => `${Math.round(v)}`);
  bindRange("audioBounce", "Bounce intensity", (v) => {
    state.audioReact.bounce = Math.round(v * 10) / 10;
  }, (v) => `${(Math.round(v * 10) / 10).toFixed(1)}×`);
  bindRange("audioBassBoost", "Bass boost", (v) => {
    state.audioReact.bassBoost = Math.round(v);
  }, (v) => `+${Math.round(v)}%`);
  bindRange("audioHueNudge", "Hue nudge", (v) => {
    state.audioReact.hueNudge = Math.round(v);
  }, (v) => `${Math.round(v)}°`);
  panel.querySelector("#reset-audio-react")?.addEventListener("click", () => {
    remember();
    void setAudioReactEnabled(false).then(() => {
      state.audioReact = { ...DEFAULT_AUDIO_REACT };
      renderPanel();
    });
  });
  bindRange("bloom", "Bloom", (v) => {
    state.post.bloom = Math.round(v);
    applyPost();
  }, (v) => `${Math.round(v)}`);
  bindRange("bloomOpacity", "Bloom opacity", (v) => {
    state.post.bloomOpacity = Math.round(v);
    applyPost();
  }, (v) => `${Math.round(v)}`);
  panel.querySelector<HTMLSelectElement>("#blend")?.addEventListener("change", (e) => {
    remember();
    state.post.blend = blendMode((e.target as HTMLSelectElement).value);
    playClick();
    applyPost();
  });
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
  bindRange("hue", "Hue", (v) => {
    state.post.hue = Math.round(v);
    applyPost();
  }, (v) => `${Math.round(v)}°`);

  panel.querySelector<HTMLButtonElement>("#view-themes")?.addEventListener("click", () => themeShelf.open());
  panel.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((swatch) => {
    swatch.addEventListener("click", () => openThemeSwatch(swatch));
  });
  panel.scrollTop = scroll;
  if (revealSlotId) {
    const card = panel.querySelector<HTMLElement>(`[data-id="${revealSlotId}"]`);
    if (!inserted) {
      card?.scrollIntoView({ block: "nearest" });
      if (card && !card.nextElementSibling) {
        card.parentElement?.nextElementSibling?.scrollIntoView({ block: "nearest" });
      }
    }
    if (card && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      card.classList.add("is-new");
      const clearNew = (event: AnimationEvent) => {
        if (event.animationName !== "slot-born") return;
        card.classList.remove("is-new");
        card.removeEventListener("animationend", clearNew);
      };
      card.addEventListener("animationend", clearNew);
    }
    revealSlotId = null;
  }
  if (inserted) growInsertedSlot(inserted);
  focusSlotId = null;
}

function syncInheritedPillPads() {
  panel.querySelectorAll<HTMLInputElement>('[data-key="pillPad"]').forEach((input) => {
    const id = input.closest<HTMLElement>("[data-id]")?.dataset.id;
    const slot = state.slots.find((item) => item.id === id);
    if (!slot || slot.kind !== "text" || slot.pillPad != null) return;
    input.value = String(state.pillPad);
    paintRange(input);
    const caption = input.closest("label")?.querySelector("[data-range-label]");
    if (caption) caption.textContent = `Shape padding ${state.pillPad}`;
  });
}

function syncInheritedTracking() {
  panel.querySelectorAll<HTMLInputElement>('[data-key="tracking"]').forEach((input) => {
    const id = input.closest<HTMLElement>("[data-id]")?.dataset.id;
    const slot = state.slots.find((item) => item.id === id);
    if (!slot || slot.kind !== "text" || slot.tracking != null) return;
    input.value = String(state.textTracking);
    paintRange(input);
    const caption = input.closest("label")?.querySelector("[data-range-label]");
    if (caption) caption.textContent = `Tracking ${state.textTracking}`;
  });
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
    remember(`range:${id}`);
    const value = Number(input.value);
    paintRange(input);
    onChange(value);
    if (caption) caption.textContent = `${label} ${format(value)}`;
  });
  const finish = () => {
    if (pointerHeld || gesture !== `range:${id}`) return;
    endGesture();
  };
  input?.addEventListener("change", finish);
  input?.addEventListener("blur", () => {
    if (pointerHeld) return;
    finish();
  });
}

function renderSlotCard(slot: Slot): HTMLElement {
  const card = document.createElement("article");
  const open = openSlots.has(slot.id);
  card.className = `slot-card${open ? " is-open" : ""}${slot.id === pickedSlotId ? " is-picked" : ""}`;
  card.dataset.id = slot.id;
  card.addEventListener("contextmenu", (event) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, select, [contenteditable='true']")
    ) {
      return;
    }
    event.preventDefault();
    openSlotMenu(event.clientX, event.clientY, slot.id);
  });

  if (slot.kind === "text") {
    card.append(textFields(slot, open));
  } else {
    card.append(imageFields(slot, open));
  }

  return card;
}

function textColorChip(slot: TextSlot): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "slot-mark";
  mark.setAttribute("aria-hidden", "true");
  const chip = document.createElement("span");
  chip.className = "slot-chip";
  chip.style.background = chipPreview(slot);
  if (slot.gradient && slot.animatedGradient && !slot.stroked && slot.shape !== "none") {
    chip.classList.add("is-gradient-animated");
    chip.style.setProperty("--sweep-duration", `${gradientPeriodMs(slot.gradientSpeed) / 1000}s`);
    chip.style.setProperty("--grad-angle", String(gradientAngleOf(slot.gradientAngle)));
  }
  mark.append(chip);
  return mark;
}

function paintTextHeadline(toggle: HTMLElement, slot: TextSlot, open: boolean, focus: boolean) {
  toggle.replaceChildren();
  const chip = textColorChip(slot);
  if (!open) {
    const name = document.createElement("span");
    name.className = "slot-name";
    const title = document.createElement("span");
    title.className = "slot-title";
    const word = slot.text.trim();
    title.textContent = word || "Empty";
    if (!word) title.classList.add("is-empty");
    const pen = document.createElement("span");
    pen.className = "slot-pen";
    pen.setAttribute("aria-hidden", "true");
    pen.innerHTML = pencilSimple;
    name.append(title, pen);
    toggle.append(chip, name);
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
    remember(`text:${slot.id}`);
    slot.text = input.value;
    live();
  });
  input.addEventListener("blur", () => {
    if (pointerHeld) return;
    if (gesture === `text:${slot.id}`) endGesture();
  });
  toggle.append(chip, input);
  if (focus) {
    queueMicrotask(() => {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
  }
}

function closeOtherSlots(id: string) {
  for (const otherId of [...openSlots]) {
    if (otherId === id) continue;
    const card = panel.querySelector<HTMLElement>(`[data-id="${otherId}"]`);
    card?.classList.remove("is-picked");
    const other = state.slots.find((item) => item.id === otherId);
    const toggle = card?.querySelector<HTMLElement>(".slot-toggle");
    if (other && toggle) setSlotOpen(toggle, other, false, false);
    else {
      openSlots.delete(otherId);
      releasePick(otherId);
    }
  }
}

function openOnly(id: string) {
  openSlots.clear();
  openSlots.add(id);
  pickedSlotId = id;
  world.setPicked(id);
}

function setSlotOpen(toggle: HTMLElement, slot: Slot, open: boolean, focus: boolean) {
  if (open) {
    openSlots.add(slot.id);
    closeOtherSlots(slot.id);
  } else {
    openSlots.delete(slot.id);
    releasePick(slot.id);
  }
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
    } else if (slot.src && isColorMask(slot)) {
      mark.append(shapeSwatch(iconSrc(slot), iconPreviewFill(slot)));
    } else if (slot.src) {
      const img = document.createElement("img");
      img.src = slot.src;
      img.alt = "";
      img.draggable = false;
      mark.append(img);
    }
    const title = document.createElement("span");
    title.className = "slot-title";
    title.textContent = slot.emoji || slot.src ? slot.name : "Empty";
    if (!slot.emoji && !slot.src) title.classList.add("is-empty");
    toggle.append(mark, title);
  }

  const toggleOpen = (focus: boolean) => {
    const open = !openSlots.has(slot.id);
    setSlotOpen(toggle, slot, open, focus);
    playSwitch();
    if (open) showPick(slot.id);
  };
  toggle.addEventListener("click", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    toggleOpen(true);
  });
  toggle.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleOpen(true);
  });

  const duplicate = document.createElement("button");
  duplicate.type = "button";
  duplicate.className = "ghost icon-btn";
  duplicate.setAttribute("aria-label", "Duplicate");
  duplicate.dataset.tip = "Duplicate this piece";
  duplicate.innerHTML = DUPLICATE_ICON;
  duplicate.addEventListener("click", () => duplicateSlot(slot.id));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost icon-btn";
  remove.dataset.remove = "";
  remove.setAttribute("aria-label", "Remove");
  remove.dataset.tip = "Remove this piece";
  remove.textContent = "✕";
  remove.addEventListener("click", () => removeSlot(slot.id));
  head.append(toggle, duplicate, remove);
  return head;
}

function textFields(slot: TextSlot, open: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "slot-body";
  wrap.append(slotHead(slot, open));
  const editor = document.createElement("div");
  editor.className = "slot-editor";
  slot.fontWeight = chosenWeight(slot.fontFamily, slot.fontWeight);
  editor.innerHTML = `
    <div class="slot-group">
      <p class="slot-label">Text</p>
      <div class="field">${settingLabel(slot, "Typeface", "fontFamily")}
        <div class="font-pick" data-font-pick></div>
      </div>
      <div class="row">
        <div class="field">${settingLabel(slot, "Weight", "fontWeight")}
          <div class="font-pick" data-weight-pick></div>
        </div>
        <label class="field">${settingLabel(slot, "Size", "fontSize")}
          <input type="number" data-key="fontSize" min="12" max="96" value="${slot.fontSize}" />
        </label>
      </div>
      <label class="field">${settingLabel(slot, "Text scale", "scale", slot.scale.toFixed(2))}
        <input type="range" data-key="scale" min="0.25" max="4" step="0.05" value="${slot.scale}" />
      </label>
      <label class="field">${settingLabel(slot, "Text height", "textHeight", String(slot.textHeight))}
        <input type="range" data-key="textHeight" min="0" max="100" step="1" value="${slot.textHeight}" />
      </label>
      <label class="field">${settingLabel(slot, "Tracking", "tracking", String(trackingOf(slot, state.textTracking)))}
        <input type="range" data-key="tracking" min="-100" max="100" step="1" value="${trackingOf(slot, state.textTracking)}" />
      </label>
      <div class="field">${settingLabel(slot, "Text color", "textColor")}
        ${textTintRow(slot)}
      </div>
    </div>
    <div class="slot-group">
      <p class="slot-label">Shape</p>
      ${
        slot.shape !== "none"
          ? `<label class="field">${settingLabel(slot, "Shape padding", "pillPad", String(pillPadOf(slot, state.pillPad)))}
        <input type="range" data-key="pillPad" min="0" max="100" step="1" value="${pillPadOf(slot, state.pillPad)}" />
      </label>`
          : ""
      }
      <div class="row">
        <label class="field">${settingLabel(slot, "Holding shape", "shape")}
          <select data-key="shape">
            <option value="none" ${slot.shape === "none" ? "selected" : ""}>None</option>
            <option value="pill" ${slot.shape === "pill" ? "selected" : ""}>Pill</option>
            <option value="box" ${slot.shape === "box" ? "selected" : ""}>Box</option>
          </select>
        </label>
        <label class="field">${settingLabel(slot, "Radius", "radius")}
          <input type="range" data-key="radius" min="0" max="40" value="${slot.radius}" ${slot.shape !== "box" ? "disabled" : ""} />
        </label>
      </div>
      ${
        slot.shape !== "none"
          ? `<div class="check-row">
        <label class="check">
          <input type="checkbox" data-key="stroked" ${slot.stroked ? "checked" : ""} />
          Stroked
        </label>
        ${resetControl("Stroked", "stroked", fieldDirty(slot, "stroked"))}
      </div>
      ${slot.stroked ? `<label class="field">${settingLabel(slot, "Stroke", "stroke", String(slot.stroke))}
        <input type="range" data-key="stroke" min="1" max="16" step="1" value="${slot.stroke}" />
      </label>` : ""}
      <div class="check-row">
        <label class="check">
          <input type="checkbox" data-key="gradient" ${slot.gradient ? "checked" : ""} />
          Gradient
        </label>
        ${resetControl("Gradient", "gradient", fieldDirty(slot, "gradient"))}
      </div>`
          : ""
      }
      <div class="field">${settingLabel(slot, slot.shape === "none" ? "Color" : slot.gradient ? "Start color" : "Shape color", "color")}
        ${tintRow(slot, slot.shape === "none" ? "Color" : "Shape color")}
      </div>
      ${
        slot.shape !== "none" && slot.gradient
          ? `<div class="field">${settingLabel(slot, "End color", "gradientColor")}
        ${gradientTintRow(slot)}
      </div>
      <label class="field">${settingLabel(slot, "Gradient angle", "gradientAngle", String(gradientAngleOf(slot.gradientAngle)))}
        <input type="range" data-key="gradientAngle" min="0" max="360" step="1" value="${gradientAngleOf(slot.gradientAngle)}" />
      </label>
      <label class="field">${settingLabel(slot, "Gradient scale", "gradientScale", String(gradientScaleOf(slot.gradientScale)))}
        <input type="range" data-key="gradientScale" min="1" max="100" step="1" value="${gradientScaleOf(slot.gradientScale)}" />
      </label>`
          : ""
      }
    </div>
    <div class="slot-group">
      <p class="slot-label">Animation</p>
      <div class="check-row">
        <label class="check">
          <input type="checkbox" data-key="textAnim" ${slot.textAnim ? "checked" : ""} />
          Text animation
        </label>
        ${resetControl("Text animation", "textAnim", fieldDirty(slot, "textAnim"))}
      </div>
      ${
        slot.textAnim
          ? `<label class="field">${settingLabel(slot, "Text anim speed", "textAnimSpeed", String(textAnimSpeedOf(slot.textAnimSpeed)))}
        <input type="range" data-key="textAnimSpeed" min="1" max="100" step="1" value="${textAnimSpeedOf(slot.textAnimSpeed)}" />
      </label>`
          : ""
      }
      ${
        slot.shape !== "none" && slot.gradient
          ? `<div class="check-row">
        <label class="check">
          <input type="checkbox" data-key="animatedGradient" ${slot.animatedGradient ? "checked" : ""} />
          Animated Gradient
        </label>
        ${resetControl("Animated Gradient", "animatedGradient", fieldDirty(slot, "animatedGradient"))}
      </div>
      ${
        slot.animatedGradient
          ? `<label class="field">${settingLabel(slot, "Animation speed", "gradientSpeed", String(gradientSpeedOf(slot.gradientSpeed)))}
        <input type="range" data-key="gradientSpeed" min="1" max="100" step="1" value="${gradientSpeedOf(slot.gradientSpeed)}" />
      </label>`
          : ""
      }`
          : ""
      }
    </div>
  `;
  placeFold(wrap, editor, open);

  const weightHost = editor.querySelector<HTMLElement>("[data-weight-pick]");
  const weightPick = weightHost
    ? mountWeightPick(weightHost, slot.fontFamily, slot.fontWeight, (weight) => {
        remember();
        slot.fontWeight = weight;
        reflectGlobalWeight();
        paintFieldReset(editor, slot, "fontWeight");
        void settleFont(slot.fontFamily, weight).then(() => liveChip(slot.id));
      })
    : null;

  const fontPick = editor.querySelector<HTMLElement>("[data-font-pick]");
  if (fontPick) {
    mountFontPick(fontPick, slot.fontFamily, (family) => {
      remember();
      slot.fontFamily = family;
      if (weightPick) slot.fontWeight = weightPick.setFamily(family);
      reflectGlobalWeight();
      paintFieldReset(editor, slot, "fontFamily");
      paintFieldReset(editor, slot, "fontWeight");
      void settleFont(family, slot.fontWeight).then(() => liveChip(slot.id));
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
    <div class="pick-now">${pickPreview(slot)}${resetControl("Icon", "icon", fieldDirty(slot, "icon"))}</div>
    <div class="field">${settingLabel(slot, slot.gradient && iconCanGradient(slot) ? "Start color" : "Color", "color")}
      ${tintRow(slot)}
    </div>
    ${
      iconCanGradient(slot)
        ? `<div class="check-row">
      <label class="check">
        <input type="checkbox" data-key="gradient" ${slot.gradient ? "checked" : ""} />
        Gradient
      </label>
      ${resetControl("Gradient", "gradient", fieldDirty(slot, "gradient"))}
    </div>
    ${
      slot.gradient
        ? `<div class="field">${settingLabel(slot, "End color", "gradientColor")}
      ${gradientTintRow(slot)}
    </div>
    <label class="field">${settingLabel(slot, "Gradient angle", "gradientAngle", String(gradientAngleOf(slot.gradientAngle)))}
      <input type="range" data-key="gradientAngle" min="0" max="360" step="1" value="${gradientAngleOf(slot.gradientAngle)}" />
    </label>
    <label class="field">${settingLabel(slot, "Gradient scale", "gradientScale", String(gradientScaleOf(slot.gradientScale)))}
      <input type="range" data-key="gradientScale" min="1" max="100" step="1" value="${gradientScaleOf(slot.gradientScale)}" />
    </label>
    <div class="check-row">
      <label class="check">
        <input type="checkbox" data-key="animatedGradient" ${slot.animatedGradient ? "checked" : ""} />
        Animated Gradient
      </label>
      ${resetControl("Animated Gradient", "animatedGradient", fieldDirty(slot, "animatedGradient"))}
    </div>
    ${
      slot.animatedGradient
        ? `<label class="field">${settingLabel(slot, "Animation speed", "gradientSpeed", String(gradientSpeedOf(slot.gradientSpeed)))}
      <input type="range" data-key="gradientSpeed" min="1" max="100" step="1" value="${gradientSpeedOf(slot.gradientSpeed)}" />
    </label>`
        : ""
    }`
        : ""
    }`
        : ""
    }
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
    ${
      uploadedShape(slot)
        ? `<label class="field">${settingLabel(slot, "Collision", "collider")}
      <select data-key="collider">
        ${ICON_PRESETS.map((icon) => `<option value="${icon.id}"${colliderOf(slot) === icon.id ? " selected" : ""}>${icon.label}</option>`).join("")}
      </select>
    </label>`
        : ""
    }
    <label class="field">${settingLabel(slot, "Shape scale", "scale", slot.scale.toFixed(2))}
      <input type="range" data-key="scale" min="0.25" max="4" step="0.05" value="${slot.scale}" />
    </label>
    <label class="field">${settingLabel(slot, "Amount", "amount", String(slot.amount))}
      <input type="range" data-key="amount" min="1" max="${AMOUNT_SOFT_CAP}" value="${slot.amount}" />
    </label>
  `;
  placeFold(wrap, editor, open);

  const grid = editor.querySelector("[data-presets]")!;
  const swatchColor = iconPreviewFill(slot);
  for (const icon of ICON_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = icon.label;
    btn.className = !slot.emoji && slot.src === icon.src ? "is-on" : "";
    btn.setAttribute("aria-pressed", String(!slot.emoji && slot.src === icon.src));
    btn.append(shapeSwatch(icon.src, swatchColor));
    btn.addEventListener("click", () => {
      remember();
      slot.src = icon.src;
      slot.name = icon.label;
      slot.emoji = undefined;
      slot.collider = undefined;
      renderPanel();
      live();
    });
    grid.append(btn);
  }

  const pickEmoji = (item: EmojiItem) => {
    remember();
    slot.emoji = item.char;
    slot.name = item.name;
    slot.src = "";
    slot.collider = undefined;
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
    const url = URL.createObjectURL(file);
    const svg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
    remember();
    slot.src = url;
    slot.name = file.name;
    slot.emoji = undefined;
    slot.collider = undefined;
    playCreate();
    if (!svg) {
      renderPanel();
      live();
      return;
    }
    void ensureTrim(url, file.name)
      .then(() => {
        if (slot.src !== url) return null;
        return matchCollider(peekTrim(url)?.displaySrc ?? url);
      })
      .then((id: string | null) => {
        if (slot.src !== url) return;
        if (id) slot.collider = id;
        renderPanel();
        live();
      })
      .catch(() => {
        if (slot.src !== url) return;
        renderPanel();
        live();
      });
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

function iconSrc(slot: ImageSlot): string {
  return peekTrim(slot.src)?.displaySrc ?? slot.src;
}

function uploadedShape(slot: ImageSlot): boolean {
  return Boolean(slot.src) && !slot.emoji && !presetIdForSrc(slot.src);
}

function colliderOf(slot: ImageSlot): string {
  return slot.collider && isPresetId(slot.collider) ? slot.collider : "block";
}

function iconCanGradient(slot: ImageSlot): boolean {
  return !slot.emoji && isColorMask(slot);
}

function iconPreviewFill(slot: ImageSlot): string {
  const fill = slotColor(slot);
  if (!slot.gradient || !iconCanGradient(slot)) return fill;
  if (slot.animatedGradient) return pillSweepGradient(fill, gradientEnd(state.theme, slot), slot.gradientAngle, slot.gradientScale);
  return pillGradient(fill, gradientEnd(state.theme, slot), slot.gradientAngle, slot.gradientScale);
}

function paintIconSwatches(root: HTMLElement, slot: ImageSlot) {
  const fill = iconPreviewFill(slot);
  const sweep = Boolean(slot.gradient && slot.animatedGradient && iconCanGradient(slot));
  const duration = `${gradientPeriodMs(slot.gradientSpeed) / 1000}s`;
  root.closest(".slot-card")?.querySelectorAll<HTMLElement>(".shape-swatch").forEach((swatch) => {
    swatch.style.background = fill;
    swatch.classList.toggle("is-gradient-animated", sweep);
    if (sweep) {
      swatch.style.setProperty("--sweep-duration", duration);
      swatch.style.setProperty("--grad-angle", String(gradientAngleOf(slot.gradientAngle)));
    } else {
      swatch.style.removeProperty("--sweep-duration");
      swatch.style.removeProperty("--grad-angle");
    }
  });
}

function chipPreview(slot: TextSlot): string {
  if (!slot.gradient || slot.stroked || slot.shape === "none") return slotColor(slot);
  if (slot.animatedGradient) return pillSweepGradient(slotColor(slot), gradientEnd(state.theme, slot), slot.gradientAngle, slot.gradientScale);
  return pillGradient(slotColor(slot), gradientEnd(state.theme, slot), slot.gradientAngle, slot.gradientScale);
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
  if (slot.src && isColorMask(slot)) {
    const color = iconPreviewFill(slot);
    const src = iconSrc(slot);
    return `<span class="pick-glyph shape-swatch" style="background:${color};-webkit-mask-image:url(&quot;${src}&quot;);mask-image:url(&quot;${src}&quot;)"></span><span>Selected <b>${escapeAttr(slot.name)}</b></span>`;
  }
  if (slot.src) {
    return `<img class="pick-glyph" src="${iconSrc(slot)}" alt="" /><span>Selected <b>${escapeAttr(slot.name)}</b></span>`;
  }
  return `<span class="pick-empty">Nothing selected</span>`;
}

function tintRow(slot: Slot, legend = "Color"): string {
  return swatchRow(state.theme, slot.colorIndex ?? 0, slot.color, "tint", legend);
}

function textTintRow(slot: TextSlot): string {
  const colors = textSwatches(state.theme);
  const filled = shapeHasFill(slot);
  const index = resolveTextSwatchIndex(state.theme, fillSample(state.theme, slot), filled, slot.colorIndex ?? 0, slot.textColorIndex);
  const custom =
    slot.textColor ??
    (slot.textColorIndex == null && !filled && slot.color ? slot.color : undefined);
  return swatchRow(colors, index, custom, "text-tint", "Text color");
}

function gradientTintRow(slot: Slot): string {
  return swatchRow(state.theme, gradientEndIndex(state.theme, slot), slot.gradientColor, "grad-tint", "End color");
}

function swatchRow(
  colors: string[],
  selectedIndex: number,
  custom: string | undefined,
  dataName: string,
  legend: string,
): string {
  return `<div class="tint-row" style="--theme-count:${colors.length}">${colors
    .map((color, index) => {
      const selected = selectedIndex === index;
      const fill = selected && custom ? custom : color;
      const name =
        dataName === "text-tint" && index === colors.length - 2
          ? "black"
          : dataName === "text-tint" && index === colors.length - 1
            ? "white"
            : String(index + 1);
      return `<button type="button" class="tint${selected ? " is-on" : ""}" data-${dataName}="${index}" style="background:${fill}" aria-pressed="${selected}" aria-label="${legend} ${name}"></button>`;
    })
    .join("")}</div>`;
}

function bindTint(root: HTMLElement, slot: Slot) {
  root.querySelectorAll<HTMLButtonElement>("[data-tint]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.tint);
      if ((slot.colorIndex ?? 0) === index) {
        openTintPicker(root, btn, slot, index, "shape");
        return;
      }
      remember();
      slot.colorIndex = index;
      slot.color = undefined;
      renderPanel();
      liveChip(slot.id);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-grad-tint]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.gradTint);
      if (gradientEndIndex(state.theme, slot) === index) {
        openTintPicker(root, btn, slot, index, "gradient");
        return;
      }
      remember();
      slot.gradientColorIndex = index;
      slot.gradientColor = undefined;
      renderPanel();
      liveChip(slot.id);
    });
  });
  if (slot.kind !== "text") return;
  const text = slot;
  root.querySelectorAll<HTMLButtonElement>("[data-text-tint]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.textTint);
      const solid = text.shape !== "none" && !text.stroked;
      const current = resolveTextSwatchIndex(state.theme, slotColor(text), solid, text.colorIndex ?? 0, text.textColorIndex);
      if (current === index) {
        openTintPicker(root, btn, text, index, "text");
        return;
      }
      remember();
      text.textColorIndex = index;
      text.textColor = undefined;
      renderPanel();
      liveChip(slot.id);
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
      remember(`theme:${index}`);
      state.theme[index] = hex;
      btn.style.background = hex;
      for (const slot of state.slots) {
        const start = !slot.color && (slot.colorIndex ?? 0) === index;
        const end = Boolean(slot.gradient) && !slot.gradientColor && gradientEndIndex(state.theme, slot) === index;
        if (!start && !end) continue;
        if (slot.kind === "text") {
          const chip = panel.querySelector<HTMLElement>(`[data-id="${slot.id}"] .slot-chip`);
          if (chip) chip.style.background = chipPreview(slot);
        } else if (iconCanGradient(slot)) {
          const card = panel.querySelector<HTMLElement>(`[data-id="${slot.id}"]`);
          if (card) paintIconSwatches(card, slot);
        }
      }
      themeShelf.refresh();
      applyLogo();
      live();
    },
    onClose() {
      if (gesture === `theme:${index}`) endGesture();
      if (tintPicker?.anchor === btn) tintPicker = null;
    },
  });
  tintPicker = { anchor: btn, close: picker.close };
}

function openTintPicker(root: HTMLElement, btn: HTMLButtonElement, slot: Slot, index: number, target: "shape" | "text" | "gradient") {
  if (tintPicker?.anchor === btn) {
    tintPicker.close();
    return;
  }
  tintPicker?.close();
  const textSlot = slot.kind === "text" ? slot : null;
  const gestureKey = target === "text" ? `ink:${slot.id}` : target === "gradient" ? `grad:${slot.id}` : `tint:${slot.id}`;
  const picker = mountColorPicker({
    anchor: btn,
    value:
      target === "text" && textSlot
        ? resolveTextColor(state.theme, fillSample(state.theme, textSlot), shapeHasFill(textSlot), textSlot.textColorIndex, textSlot.textColor)
        : target === "gradient"
          ? gradientEnd(state.theme, slot)
          : (slot.color ?? pickTheme(state.theme, index)),
    onChange(hex) {
      remember(gestureKey);
      if (target === "text" && textSlot) {
        textSlot.textColorIndex = index;
        textSlot.textColor = hex;
        btn.style.background = hex;
        paintFieldReset(root, textSlot, "textColor");
        liveChip(slot.id);
        return;
      }
      if (target === "gradient") {
        slot.gradientColorIndex = index;
        slot.gradientColor = hex;
        btn.style.background = hex;
        if (textSlot) {
          const chip = root.closest(".slot-card")?.querySelector<HTMLElement>(".slot-chip");
          if (chip) chip.style.background = chipPreview(textSlot);
          syncImplicitTextRow(root, textSlot, slotColor(textSlot));
        } else if (slot.kind === "image") {
          paintIconSwatches(root, slot);
        }
        paintFieldReset(root, slot, "gradientColor");
        liveChip(slot.id);
        return;
      }
      slot.color = hex;
      btn.style.background = hex;
      if (textSlot) {
        const chip = root.closest(".slot-card")?.querySelector<HTMLElement>(".slot-chip");
        if (chip) chip.style.background = chipPreview(textSlot);
      } else if (slot.kind === "image") {
        paintIconSwatches(root, slot);
      }
      syncImplicitTextRow(root, slot, hex);
      paintFieldReset(root, slot, "color");
      liveChip(slot.id);
    },
    onClose() {
      if (gesture === gestureKey) endGesture();
      if (tintPicker?.anchor === btn) tintPicker = null;
    },
  });
  tintPicker = { anchor: btn, close: picker.close };
}

function syncImplicitTextRow(root: HTMLElement, slot: Slot, shapeHex: string) {
  if (slot.kind !== "text" || slot.textColor || slot.textColorIndex != null) return;
  const filled = shapeHasFill(slot);
  if (!filled) {
    const btn = root.querySelector<HTMLElement>(`[data-text-tint="${slot.colorIndex ?? 0}"]`);
    if (btn) btn.style.background = shapeHex;
    return;
  }
  const index = resolveTextSwatchIndex(state.theme, fillSample(state.theme, slot), true, slot.colorIndex ?? 0, undefined);
  const swatches = textSwatches(state.theme);
  root.querySelectorAll<HTMLButtonElement>("[data-text-tint]").forEach((btn) => {
    const chip = Number(btn.dataset.textTint);
    const on = chip === index;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.style.background = swatches[chip] ?? "";
  });
}

type TextBaseline = Pick<
  TextSlot,
  | "fontFamily"
  | "fontWeight"
  | "fontSize"
  | "textHeight"
  | "shape"
  | "radius"
  | "stroked"
  | "stroke"
  | "colorIndex"
  | "color"
  | "gradient"
  | "gradientColorIndex"
  | "gradientColor"
  | "gradientAngle"
  | "gradientScale"
  | "animatedGradient"
  | "gradientSpeed"
  | "textAnim"
  | "textAnimSpeed"
  | "textColorIndex"
  | "textColor"
  | "scale"
>;

type ImageBaseline = Pick<
  ImageSlot,
  | "src"
  | "name"
  | "emoji"
  | "scale"
  | "amount"
  | "colorIndex"
  | "color"
  | "gradient"
  | "gradientColorIndex"
  | "gradientColor"
  | "gradientAngle"
  | "gradientScale"
  | "animatedGradient"
  | "gradientSpeed"
  | "collider"
>;

const textBaselines = new Map<string, TextBaseline>();
const imageBaselines = new Map<string, ImageBaseline>();

function copyBaseline(source: Slot, copy: Slot) {
  if (source.kind === "text" && copy.kind === "text") {
    textBaselines.set(copy.id, { ...textBaseline(source) });
    return;
  }
  if (source.kind === "image" && copy.kind === "image") {
    imageBaselines.set(copy.id, { ...imageBaseline(source) });
  }
}

function captureBaseline(slot: Slot) {
  if (slot.kind === "text") {
    if (textBaselines.has(slot.id)) return;
    textBaselines.set(slot.id, {
      fontFamily: slot.fontFamily,
      fontWeight: slot.fontWeight,
      fontSize: slot.fontSize,
      textHeight: slot.textHeight,
      shape: slot.shape,
      radius: slot.radius,
      stroked: slot.stroked,
      stroke: slot.stroke,
      colorIndex: slot.colorIndex,
      color: slot.color,
      gradient: slot.gradient,
      gradientColorIndex: slot.gradientColorIndex,
      gradientColor: slot.gradientColor,
      gradientAngle: slot.gradientAngle,
      gradientScale: slot.gradientScale,
      animatedGradient: slot.animatedGradient,
      gradientSpeed: slot.gradientSpeed,
      textAnim: slot.textAnim,
      textAnimSpeed: slot.textAnimSpeed,
      textColorIndex: slot.textColorIndex,
      textColor: slot.textColor,
      scale: slot.scale,
    });
    return;
  }
  if (imageBaselines.has(slot.id)) return;
  imageBaselines.set(slot.id, {
    src: slot.src,
    name: slot.name,
    emoji: slot.emoji,
    scale: slot.scale,
    amount: slot.amount,
    colorIndex: slot.colorIndex,
    color: slot.color,
    gradient: slot.gradient,
    gradientColorIndex: slot.gradientColorIndex,
    gradientColor: slot.gradientColor,
    gradientAngle: slot.gradientAngle,
    gradientScale: slot.gradientScale,
    animatedGradient: slot.animatedGradient,
    gradientSpeed: slot.gradientSpeed,
    collider: slot.collider,
  });
}

for (const slot of state.slots) captureBaseline(slot);

function textBaseline(slot: TextSlot): TextBaseline {
  const saved = textBaselines.get(slot.id);
  if (saved) return saved;
  const seed = defaultTextSlot();
  const base: TextBaseline = {
    fontFamily: seed.fontFamily,
    fontWeight: seed.fontWeight,
    fontSize: seed.fontSize,
    textHeight: seed.textHeight,
    shape: seed.shape,
    radius: seed.radius,
    stroked: seed.stroked,
    stroke: seed.stroke,
    colorIndex: seed.colorIndex,
    color: seed.color,
    gradient: seed.gradient,
    gradientColorIndex: seed.gradientColorIndex,
    gradientColor: seed.gradientColor,
    gradientAngle: seed.gradientAngle,
    gradientScale: seed.gradientScale,
    animatedGradient: seed.animatedGradient,
    gradientSpeed: seed.gradientSpeed,
    textAnim: seed.textAnim,
    textAnimSpeed: seed.textAnimSpeed,
    textColorIndex: seed.textColorIndex,
    textColor: seed.textColor,
    scale: seed.scale,
  };
  textBaselines.set(slot.id, base);
  return base;
}

function imageBaseline(slot: ImageSlot): ImageBaseline {
  const saved = imageBaselines.get(slot.id);
  if (saved) return saved;
  const seed = defaultImageSlot();
  const base: ImageBaseline = {
    src: seed.src,
    name: seed.name,
    emoji: seed.emoji,
    scale: seed.scale,
    amount: seed.amount,
    colorIndex: seed.colorIndex,
    color: seed.color,
    gradient: seed.gradient,
    gradientColorIndex: seed.gradientColorIndex,
    gradientColor: seed.gradientColor,
    gradientAngle: seed.gradientAngle,
    gradientScale: seed.gradientScale,
    animatedGradient: seed.animatedGradient,
    gradientSpeed: seed.gradientSpeed,
    collider: seed.collider,
  };
  imageBaselines.set(slot.id, base);
  return base;
}

function colorsDiffer(
  index: number,
  color: string | undefined,
  baseIndex: number,
  baseColor: string | undefined,
): boolean {
  return index !== baseIndex || (color ?? "") !== (baseColor ?? "");
}

function fieldDirty(slot: Slot, key: string): boolean {
  if (slot.kind === "text") {
    const base = textBaseline(slot);
    switch (key) {
      case "fontFamily":
        return slot.fontFamily !== base.fontFamily;
      case "fontWeight":
        return slot.fontWeight !== base.fontWeight;
      case "fontSize":
        return slot.fontSize !== base.fontSize;
      case "textHeight":
        return slot.textHeight !== base.textHeight;
      case "pillPad":
        return slot.pillPad != null;
      case "tracking":
        return slot.tracking != null;
      case "shape":
        return slot.shape !== base.shape;
      case "radius":
        return slot.radius !== base.radius;
      case "stroked":
        return slot.stroked !== base.stroked;
      case "stroke":
        return slot.stroke !== base.stroke;
      case "scale":
        return Math.abs(slot.scale - base.scale) >= 0.001;
      case "color":
        return colorsDiffer(slot.colorIndex, slot.color, base.colorIndex, base.color);
      case "gradient":
        return Boolean(slot.gradient) !== Boolean(base.gradient);
      case "gradientColor":
        return (slot.gradientColorIndex ?? null) !== (base.gradientColorIndex ?? null) || (slot.gradientColor ?? "") !== (base.gradientColor ?? "");
      case "gradientAngle":
        return gradientAngleOf(slot.gradientAngle) !== gradientAngleOf(base.gradientAngle);
      case "gradientScale":
        return gradientScaleOf(slot.gradientScale) !== gradientScaleOf(base.gradientScale);
      case "animatedGradient":
        return Boolean(slot.animatedGradient) !== Boolean(base.animatedGradient);
      case "gradientSpeed":
        return gradientSpeedOf(slot.gradientSpeed) !== gradientSpeedOf(base.gradientSpeed);
      case "textAnim":
        return Boolean(slot.textAnim) !== Boolean(base.textAnim);
      case "textAnimSpeed":
        return textAnimSpeedOf(slot.textAnimSpeed) !== textAnimSpeedOf(base.textAnimSpeed);
      case "textColor":
        return slot.textColorIndex !== base.textColorIndex || (slot.textColor ?? "") !== (base.textColor ?? "");
      default:
        return false;
    }
  }
  const base = imageBaseline(slot);
  switch (key) {
    case "icon":
      return slot.src !== base.src || slot.name !== base.name || (slot.emoji ?? "") !== (base.emoji ?? "");
    case "scale":
      return Math.abs(slot.scale - base.scale) >= 0.001;
    case "amount":
      return slot.amount !== base.amount;
    case "color":
      return colorsDiffer(slot.colorIndex, slot.color, base.colorIndex, base.color);
    case "gradient":
      return Boolean(slot.gradient) !== Boolean(base.gradient);
    case "gradientColor":
      return (slot.gradientColorIndex ?? null) !== (base.gradientColorIndex ?? null) || (slot.gradientColor ?? "") !== (base.gradientColor ?? "");
    case "gradientAngle":
      return gradientAngleOf(slot.gradientAngle) !== gradientAngleOf(base.gradientAngle);
    case "gradientScale":
      return gradientScaleOf(slot.gradientScale) !== gradientScaleOf(base.gradientScale);
    case "animatedGradient":
      return Boolean(slot.animatedGradient) !== Boolean(base.animatedGradient);
    case "gradientSpeed":
      return gradientSpeedOf(slot.gradientSpeed) !== gradientSpeedOf(base.gradientSpeed);
    case "collider":
      return colliderOf(slot) !== (base.collider && isPresetId(base.collider) ? base.collider : "block");
    default:
      return false;
  }
}

function paintFieldReset(root: ParentNode, slot: Slot, key: string) {
  const btn = root.querySelector<HTMLButtonElement>(`[data-reset="${key}"]`);
  if (btn) btn.hidden = !fieldDirty(slot, key);
}

function resetControl(name: string, key: string, dirty: boolean): string {
  return `<button type="button" class="field-reset" data-reset="${key}" aria-label="Reset ${escapeAttr(name.toLowerCase())}"${dirty ? "" : " hidden"}>${RESET_ICON}</button>`;
}

function settingLabel(slot: Slot, name: string, key: string, value?: string): string {
  const shown = value == null ? name : `${name} ${value}`;
  const marker = value == null ? "" : ` data-range-label="${key}"`;
  return `<span class="field-label"><span${marker}>${shown}</span>${resetControl(name, key, fieldDirty(slot, key))}</span>`;
}

function applyFieldReset(slot: Slot, key: string) {
  remember();
  if (slot.kind === "text") {
    const base = textBaseline(slot);
    if (key === "fontFamily") {
      slot.fontFamily = base.fontFamily;
      slot.fontWeight = chosenWeight(base.fontFamily, slot.fontWeight);
    } else if (key === "fontWeight") slot.fontWeight = chosenWeight(slot.fontFamily, base.fontWeight);
    else if (key === "fontSize") slot.fontSize = base.fontSize;
    else if (key === "textHeight") slot.textHeight = base.textHeight;
    else if (key === "pillPad") slot.pillPad = undefined;
    else if (key === "tracking") slot.tracking = undefined;
    else if (key === "shape") slot.shape = base.shape;
    else if (key === "radius") slot.radius = base.radius;
    else if (key === "stroked") slot.stroked = base.stroked;
    else if (key === "stroke") slot.stroke = base.stroke;
    else if (key === "scale") slot.scale = base.scale;
    else if (key === "color") {
      slot.colorIndex = base.colorIndex;
      slot.color = base.color;
    } else if (key === "gradient") slot.gradient = base.gradient;
    else if (key === "gradientColor") {
      slot.gradientColorIndex = base.gradientColorIndex;
      slot.gradientColor = base.gradientColor;
    } else if (key === "gradientAngle") slot.gradientAngle = base.gradientAngle;
    else if (key === "gradientScale") slot.gradientScale = base.gradientScale;
    else if (key === "animatedGradient") slot.animatedGradient = base.animatedGradient;
    else if (key === "gradientSpeed") slot.gradientSpeed = base.gradientSpeed;
    else if (key === "textAnim") slot.textAnim = base.textAnim;
    else if (key === "textAnimSpeed") slot.textAnimSpeed = base.textAnimSpeed;
    else if (key === "textColor") {
      slot.textColorIndex = base.textColorIndex;
      slot.textColor = base.textColor;
    }
    if (key === "fontFamily" || key === "fontWeight") {
      reflectGlobalWeight();
      void settleFont(slot.fontFamily, slot.fontWeight).then(() => liveChip(slot.id));
      renderPanel();
      return;
    }
  } else {
    const base = imageBaseline(slot);
    if (key === "icon") {
      slot.src = base.src;
      slot.name = base.name;
      slot.emoji = base.emoji;
    } else if (key === "scale") slot.scale = base.scale;
    else if (key === "amount") slot.amount = base.amount;
    else if (key === "color") {
      slot.colorIndex = base.colorIndex;
      slot.color = base.color;
    } else if (key === "gradient") slot.gradient = base.gradient;
    else if (key === "gradientColor") {
      slot.gradientColorIndex = base.gradientColorIndex;
      slot.gradientColor = base.gradientColor;
    } else if (key === "gradientAngle") slot.gradientAngle = base.gradientAngle;
    else if (key === "gradientScale") slot.gradientScale = base.gradientScale;
    else if (key === "animatedGradient") slot.animatedGradient = base.animatedGradient;
    else if (key === "gradientSpeed") slot.gradientSpeed = base.gradientSpeed;
    else if (key === "collider") slot.collider = base.collider;
  }
  if (slot.kind === "image" && key === "amount") live();
  else liveChip(slot.id);
  renderPanel();
}

function storeGradient(slot: TextSlot) {
  slot.gradientFromIndex = slot.colorIndex;
  slot.gradientFrom = slot.color;
  if (slot.gradientColorIndex == null) slot.gradientColorIndex = gradientEndIndex(state.theme, slot);
}

function recallGradient(slot: TextSlot) {
  if (slot.gradientFromIndex == null && !slot.gradientFrom) return;
  if (slot.gradientFromIndex != null) slot.colorIndex = slot.gradientFromIndex;
  slot.color = slot.gradientFrom;
}

function bindSlotInputs(root: HTMLElement, slot: Slot) {
  root.querySelectorAll<HTMLButtonElement>("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = btn.dataset.reset;
      if (!key) return;
      applyFieldReset(slot, key);
    });
  });
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-key]").forEach((input) => {
    const key = input.dataset.key;
    if (!key) return;
    if (input instanceof HTMLInputElement && input.type === "range") paintRange(input);
    const gestureKey = `slot:${slot.id}:${key}`;
    const continuous = input instanceof HTMLInputElement && (input.type === "range" || input.type === "number");
    input.addEventListener("input", () => {
      if (continuous) remember(gestureKey);
      else remember();
      if (input instanceof HTMLInputElement && input.type === "range") paintRange(input);
      const value =
        input.type === "checkbox"
          ? (input as HTMLInputElement).checked
          : input.type === "number" || input.type === "range"
            ? Number(input.value)
            : input.value;
      if (input instanceof HTMLInputElement && input.type === "checkbox") playSwitch();
      else if (input instanceof HTMLSelectElement) playClick();
      (slot as Record<string, unknown>)[key] = value;
      if (slot.kind === "image" && key === "amount") {
        slot.amount = Math.max(1, Math.min(AMOUNT_SOFT_CAP, Math.round(Number(value))));
        recountShapes();
      }
      if (slot.kind === "text" && key === "gradient") {
        if (slot.gradient) {
          slot.stroked = false;
          recallGradient(slot);
        } else storeGradient(slot);
      }
      if (slot.kind === "text" && key === "stroked" && slot.stroked && slot.gradient) {
        storeGradient(slot);
        slot.gradient = false;
      }
      if (key === "gradientAngle" || key === "gradientScale") {
        const caption = input.closest("label")?.querySelector("[data-range-label]");
        if (caption) {
          caption.textContent =
            key === "gradientAngle"
              ? `Gradient angle ${Math.round(Number(input.value))}`
              : `Gradient scale ${Math.round(Number(input.value))}`;
        }
        const card = input.closest(".slot-card");
        if (card instanceof HTMLElement) {
          if (slot.kind === "text") {
            const chip = card.querySelector<HTMLElement>(".slot-chip");
            if (chip) {
              chip.style.background = chipPreview(slot);
              const sweep = Boolean(slot.gradient && slot.animatedGradient && !slot.stroked && slot.shape !== "none");
              chip.classList.toggle("is-gradient-animated", sweep);
              if (sweep) {
                chip.style.setProperty("--sweep-duration", `${gradientPeriodMs(slot.gradientSpeed) / 1000}s`);
                chip.style.setProperty("--grad-angle", String(gradientAngleOf(slot.gradientAngle)));
              } else {
                chip.style.removeProperty("--sweep-duration");
                chip.style.removeProperty("--grad-angle");
              }
            }
          } else {
            paintIconSwatches(card, slot);
          }
        }
      }
      if (key === "gradientSpeed") {
        const caption = input.closest("label")?.querySelector("[data-range-label]");
        if (caption) caption.textContent = `Animation speed ${Math.round(Number(input.value))}`;
        const card = input.closest(".slot-card");
        if (card instanceof HTMLElement) {
          const duration = `${gradientPeriodMs(slot.gradientSpeed) / 1000}s`;
          card.querySelectorAll<HTMLElement>(".slot-chip.is-gradient-animated, .shape-swatch.is-gradient-animated").forEach((el) => {
            el.style.setProperty("--sweep-duration", duration);
          });
        }
      }
      if (key === "textAnimSpeed") {
        const caption = input.closest("label")?.querySelector("[data-range-label]");
        if (caption) caption.textContent = `Text anim speed ${Math.round(Number(input.value))}`;
      }
      if (key === "textHeight" || key === "stroke" || key === "amount" || key === "pillPad" || key === "tracking") {
        const caption = input.closest("label")?.querySelector("[data-range-label]");
        if (caption) {
          const name =
            key === "textHeight" ? "Text height" : key === "stroke" ? "Stroke" : key === "pillPad" ? "Shape padding" : key === "tracking" ? "Tracking" : "Amount";
          caption.textContent = `${name} ${Math.round(Number(input.value))}`;
        }
      }
      if (key === "scale") {
        const caption = input.closest("label")?.querySelector("[data-range-label]");
        if (caption) {
          const name = slot.kind === "text" ? "Text scale" : "Shape scale";
          caption.textContent = `${name} ${Number(input.value).toFixed(2)}`;
        }
      }
      paintFieldReset(input.closest(".field, .check-row") ?? root, slot, key);
      if (
        key === "shape" ||
        key === "amount" ||
        key === "stroked" ||
        key === "gradient" ||
        key === "animatedGradient" ||
        key === "textAnim"
      ) {
        renderPanel();
      }
      if (key === "fontFamily") {
        void activateFamily(String(value)).then(() => liveChip(slot.id));
        return;
      }
      // Amount adds/removes chip copies — needs a full refresh. Everything else is
      // slot-local so other pills can keep their gradient / text animations rolling.
      if (slot.kind === "image" && key === "amount") live();
      else liveChip(slot.id);
    });
    if (continuous) {
      const finish = () => {
        if (pointerHeld || gesture !== gestureKey) return;
        endGesture();
      };
      input.addEventListener("change", finish);
      input.addEventListener("blur", finish);
    }
  });
}

function applySlotOrder(ids: string[]) {
  if (ids.length !== state.slots.length) return;
  if (ids.every((id, index) => id === state.slots[index]?.id)) return;
  const byId = new Map(state.slots.map((slot) => [slot.id, slot]));
  const ordered: Slot[] = [];
  for (const id of ids) {
    const slot = byId.get(id);
    if (!slot) return;
    ordered.push(slot);
  }
  remember();
  state.slots = ordered;
  playClick();
}

let closeSlotMenu = () => {};
let chipEditAbort: AbortController | null = null;

function endChipEdit(commit = true) {
  const id = world.editingId();
  if (!id) return;
  chipEditAbort?.abort();
  chipEditAbort = null;
  if (gesture === `canvas-text:${id}`) endGesture();
  world.setEditing(null);
  if (commit) {
    live();
    renderPanel();
  }
}

function liveChip(id: string) {
  world.refreshSlot(
    id,
    state.slots,
    state.physics,
    fitScale(),
    state.theme,
    state.pillPad,
    state.textTracking,
    state.sizeRandom,
  );
}

function editChipText(id: string, wipe: boolean) {
  const slot = state.slots.find((item) => item.id === id);
  if (!slot || slot.kind !== "text") return;
  closeSlotMenu();
  if (world.editingId() === id && !wipe) {
    const edit = world.chipEl(id)?.querySelector<HTMLElement>(":scope > .chip-edit");
    edit?.focus();
    selectChipEdit(edit, false);
    return;
  }
  endChipEdit();
  if (wipe) {
    remember();
    slot.text = "";
  }
  world.setEditing(id);
  // Drop the pick outline so it doesn't read as an edit chrome box.
  world.setPicked(null);
  pickedSlotId = null;
  panel.querySelector(".slot-card.is-picked")?.classList.remove("is-picked");
  liveChip(id);

  const edit = world.chipEl(id)?.querySelector<HTMLElement>(":scope > .chip-edit");
  if (!edit) {
    world.setEditing(null);
    // No chip on stage yet — fall back to the panel text field.
    focusSlotId = id;
    openSlots.add(id);
    panelTab = "physics";
    renderPanel();
    const card = panel.querySelector<HTMLElement>(`[data-id="${id}"]`);
    const toggle = card?.querySelector<HTMLElement>(".slot-toggle");
    if (slot && toggle) setSlotOpen(toggle, slot, true, true);
    return;
  }
  edit.textContent = slot.text;
  const abort = new AbortController();
  chipEditAbort = abort;
  const { signal } = abort;
  const panelInput = panel.querySelector<HTMLInputElement>(`[data-id="${id}"] .slot-live`);

  edit.addEventListener(
    "input",
    () => {
      remember(`canvas-text:${id}`);
      slot.text = (edit.textContent ?? "").replace(/\n/g, "");
      if (edit.textContent !== slot.text) edit.textContent = slot.text;
      if (panelInput) panelInput.value = slot.text;
      liveChip(id);
    },
    { signal },
  );
  edit.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        endChipEdit();
      }
    },
    { signal },
  );
  edit.addEventListener(
    "blur",
    () => {
      queueMicrotask(() => {
        if (world.editingId() !== id) return;
        if (document.activeElement?.closest?.(".chip-edit, .slot-menu")) return;
        endChipEdit();
      });
    },
    { signal },
  );

  queueMicrotask(() => {
    if (world.editingId() !== id) return;
    edit.focus();
    selectChipEdit(edit, wipe);
  });
}

function selectChipEdit(edit: HTMLElement | null | undefined, caretOnly: boolean) {
  if (!edit) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(edit);
  if (caretOnly) range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function invertHex(hex: string): string {
  const raw = hex.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((channel) => channel + channel).join("") : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length < 6) return "#000000";
  const channel = (byte: number) => (255 - byte).toString(16).padStart(2, "0");
  return `#${channel((value >> 16) & 255)}${channel((value >> 8) & 255)}${channel(value & 255)}`;
}

function invertSlot(id: string) {
  const slot = state.slots.find((item) => item.id === id);
  if (!slot) return;
  remember();
  slot.color = invertHex(slotColor(slot));
  if (slot.gradient) {
    slot.gradientColor = invertHex(gradientEnd(state.theme, slot));
  }
  playInvert();
  // Color-only: refresh this slot's chips. Avoid renderPanel/live — they remount or
  // repaint enough to make the open context menu flicker.
  liveChip(id);
}

function menuColorRow(
  label: string,
  selectedIndex: number | null,
  onPick: (index: number) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "slot-menu__colors";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);

  const title = document.createElement("p");
  title.className = "slot-menu__label";
  title.textContent = label;
  row.append(title);

  const dots = document.createElement("div");
  dots.className = "slot-menu__dots";
  let onBtn: HTMLButtonElement | null = null;
  state.theme.forEach((color, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-menu__dot";
    btn.style.background = color;
    btn.setAttribute("aria-label", `${label} ${index + 1}`);
    const selected = selectedIndex === index;
    btn.setAttribute("aria-pressed", String(selected));
    if (selected) {
      btn.classList.add("is-on");
      onBtn = btn;
    }
    btn.addEventListener("click", () => {
      onPick(index);
      if (onBtn === btn) return;
      onBtn?.classList.remove("is-on");
      onBtn?.setAttribute("aria-pressed", "false");
      btn.classList.add("is-on");
      btn.setAttribute("aria-pressed", "true");
      onBtn = btn;
    });
    dots.append(btn);
  });
  row.append(dots);
  return row;
}

function menuCheckRow(label: string, checked: boolean, onToggle: (next: boolean) => void): HTMLElement {
  const row = document.createElement("label");
  row.className = "slot-menu__check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => {
    playSwitch();
    onToggle(input.checked);
  });
  row.append(input, document.createTextNode(label));
  return row;
}

function openSlotMenu(x: number, y: number, id: string) {
  closeSlotMenu();
  // Select first (panel jump) before the menu listens for scroll-to-close.
  pickSlot(id, { force: true });
  const slot = state.slots.find((item) => item.id === id);
  const abort = new AbortController();
  const { signal } = abort;
  const menu = document.createElement("div");
  menu.className = "slot-menu";
  menu.setAttribute("role", "menu");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Panel scroll closes the menu; ignore scrolls caused by in-menu updates.
  let ignoreScroll = 0;
  const holdScrollClose = (fn: () => void) => {
    ignoreScroll += 1;
    try {
      fn();
    } finally {
      requestAnimationFrame(() => {
        ignoreScroll -= 1;
      });
    }
  };

  // Solid select stroke while the menu is open; clear chip outline on option/close.
  let menuStroke = true;
  const paintMenuStroke = () => {
    if (!menuStroke) return;
    world.setPicked(id);
    world.chipEl(id)?.classList.add("is-menu-picked");
  };
  const clearMenuStroke = () => {
    if (!menuStroke) return;
    menuStroke = false;
    world.chipEl(id)?.classList.remove("is-menu-picked");
    world.setPicked(null);
  };
  paintMenuStroke();

  if (slot) {
    const shapeSelected = slot.color ? null : (slot.colorIndex ?? 0);
    const paintColor = (index: number, target: "shape" | "text" | "bare") => {
      remember();
      if (target === "text" && slot.kind === "text") {
        slot.textColorIndex = index;
        slot.textColor = undefined;
      } else {
        slot.colorIndex = index;
        slot.color = undefined;
        if (target === "bare" && slot.kind === "text") {
          slot.textColorIndex = undefined;
          slot.textColor = undefined;
        }
      }
      clearMenuStroke();
      holdScrollClose(() => liveChip(slot.id));
    };

    if (slot.kind === "image") {
      menu.append(menuColorRow("Color:", shapeSelected, (index) => paintColor(index, "shape")));
    } else if (slot.shape === "none") {
      menu.append(menuColorRow("Color:", shapeSelected, (index) => paintColor(index, "bare")));
    } else {
      const textSelected =
        slot.textColor || slot.textColorIndex == null || slot.textColorIndex >= state.theme.length
          ? null
          : slot.textColorIndex;
      const shapeRow = menuColorRow(
        slot.stroked ? "Stroke Color:" : "Shape Color:",
        shapeSelected,
        (index) => paintColor(index, "shape"),
      );
      menu.append(
        menuColorRow("Text Color:", textSelected, (index) => paintColor(index, "text")),
        shapeRow,
        menuCheckRow("Stroked", slot.stroked, (next) => {
          remember();
          slot.stroked = next;
          if (next && slot.gradient) {
            storeGradient(slot);
            slot.gradient = false;
          }
          const title = next ? "Stroke Color:" : "Shape Color:";
          const label = shapeRow.querySelector(".slot-menu__label");
          if (label) label.textContent = title;
          shapeRow.setAttribute("aria-label", title);
          clearMenuStroke();
          holdScrollClose(() => liveChip(slot.id));
        }),
      );
    }
  }

  const actions: { label: string; run: () => void; stay?: boolean }[] = [];
  if (slot?.kind === "text") {
    actions.push({ label: "Edit text", run: () => editChipText(id, false) });
  }
  actions.push(
    { label: "Duplicate", run: () => duplicateSlot(id) },
    {
      label: "Invert",
      stay: true,
      run: () => {
        holdScrollClose(() => invertSlot(id));
        menu.querySelectorAll<HTMLElement>(".slot-menu__colors").forEach((row) => {
          const name = row.getAttribute("aria-label") || "";
          if (/^Text /i.test(name)) return;
          row.querySelectorAll(".slot-menu__dot.is-on").forEach((dot) => {
            dot.classList.remove("is-on");
            dot.setAttribute("aria-pressed", "false");
          });
        });
      },
    },
    { label: "Remove", run: () => removeSlot(id) },
  );
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-menu__item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      clearMenuStroke();
      if (!action.stay) closeSlotMenu();
      action.run();
    });
    menu.append(btn);
  }

  document.body.append(menu);
  const gap = 8;
  const left = Math.max(gap, Math.min(x, window.innerWidth - menu.offsetWidth - gap));
  const top = Math.max(gap, Math.min(y, window.innerHeight - menu.offsetHeight - gap));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  if (reduceMotion) menu.classList.add("is-in");
  else requestAnimationFrame(() => menu.classList.add("is-in"));

  const closeCurrent = () => {
    abort.abort();
    if (closeSlotMenu === closeCurrent) closeSlotMenu = () => {};
    clearMenuStroke();
    menu.remove();
  };
  closeSlotMenu = closeCurrent;

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Node) || menu.contains(target)) return;
      closeSlotMenu();
    },
    { signal, capture: true },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") closeSlotMenu();
    },
    { signal },
  );
  window.addEventListener("resize", closeCurrent, { signal });
  panel.addEventListener(
    "scroll",
    () => {
      // ignoreScroll covers liveChip layout; panelScrollFrame covers select jump.
      if (ignoreScroll || panelScrollFrame) return;
      closeCurrent();
    },
    { signal, passive: true },
  );
}

function duplicateSlot(id: string) {
  const index = state.slots.findIndex((slot) => slot.id === id);
  const source = state.slots[index];
  if (!source) return;
  const next = panel.querySelector<HTMLElement>(`[data-id="${id}"]`)?.nextElementSibling;
  const anchor = next instanceof HTMLElement ? next : panel.querySelector<HTMLElement>(".slot-adds");
  const anchorId = anchor?.classList.contains("slot-card") ? anchor.dataset.id ?? null : null;
  remember();
  const copy = structuredClone(source);
  copy.id = uid();
  copyBaseline(source, copy);
  state.slots.splice(index + 1, 0, copy);
  revealSlotId = copy.id;
  insertMotion = {
    id: copy.id,
    scroll: panel.scrollTop,
    anchorId,
    anchorTop: anchor?.getBoundingClientRect().top ?? 0,
  };
  playCreate();
  renderPanel();
  live();
}

const INSERT_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const INSERT_MS = 280;

function growInsertedSlot(motion: InsertMotion) {
  const card = panel.querySelector<HTMLElement>(`[data-id="${motion.id}"]`);
  if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const gap = parseFloat(getComputedStyle(card.parentElement ?? card).rowGap) || 0;
  const box = getComputedStyle(card);
  const full = card.getBoundingClientRect().height;
  const padTop = box.paddingTop;
  const padBottom = box.paddingBottom;
  card.style.overflow = "hidden";
  card.style.minHeight = "0px";
  card.style.height = "0px";
  card.style.paddingTop = "0px";
  card.style.paddingBottom = "0px";
  card.style.marginBottom = `${-gap}px`;

  const anchor = motion.anchorId
    ? panel.querySelector<HTMLElement>(`[data-id="${motion.anchorId}"]`)
    : panel.querySelector<HTMLElement>(".slot-adds");
  if (anchor) {
    const scrollDelta = panel.scrollTop - motion.scroll;
    const error = anchor.getBoundingClientRect().top - (motion.anchorTop - scrollDelta);
    if (Math.abs(error) > 0.5) card.style.marginBottom = `${-gap - error}px`;
  }

  const anim = card.animate(
    [
      {
        height: "0px",
        paddingTop: "0px",
        paddingBottom: "0px",
        marginBottom: card.style.marginBottom,
      },
      {
        height: `${full}px`,
        paddingTop: padTop,
        paddingBottom: padBottom,
        marginBottom: "0px",
      },
    ],
    { duration: INSERT_MS, easing: INSERT_EASE, fill: "forwards" },
  );
  anim.finished
    .then(() => {
      card.style.height = "";
      card.style.minHeight = "";
      card.style.paddingTop = "";
      card.style.paddingBottom = "";
      card.style.marginBottom = "";
      card.style.overflow = "";
      anim.cancel();
      card.scrollIntoView({ block: "nearest" });
    })
    .catch(() => {});
}

function removeSlot(id: string) {
  if (world.editingId() === id) endChipEdit(false);
  remember();
  openSlots.delete(id);
  releasePick(id);
  state.slots = state.slots.filter((slot) => slot.id !== id);
  playRemove();
  renderPanel();
  live();
}

function reflectGlobalWeight() {
  globalWeightPick?.reflect(sharedFamily() ?? "", sharedWeight());
}

async function applyWeightEverywhere(weight: number) {
  const family = sharedFamily();
  if (!family) return;
  remember();
  const chosen = chosenWeight(family, weight);
  for (const slot of allTextSlots()) slot.fontWeight = chosen;
  await settleFont(family, chosen);
  renderPanel();
  live();
}

async function applyFontEverywhere(family: string) {
  remember();
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

/** Pills swell on bass; icons on sharp (−20%) with a stronger hop. */
const AUDIO_SHARP_SCALE = 0.8;
const AUDIO_ICON_JUMP = 13;
const AUDIO_TEXT_JUMP = AUDIO_ICON_JUMP / 3;
const AUDIO_PEAK_COOLDOWN_MS = 160;
const AUDIO_JUMP_COOLDOWN_MS = 340;
const AUDIO_HOLD_MS = 220;
const AUDIO_ANIM_MS = 100;
const AUDIO_HUE_UP_MS = 70;
const AUDIO_HUE_DOWN_MS = 220;
let audioTargetMul = new Map<string, number>();
let audioFromMul = new Map<string, number>();
let audioDisplayMul = new Map<string, number>();
let audioAnimAt = 0;
let audioBassAt = 0;
let audioSharpAt = 0;
let audioIconJumpAt = 0;
let audioTextJumpAt = 0;
let audioClearAt = 0;
let audioHintAt = 0;
let audioReturning = false;
let audioHueOffset = 0;
let audioHueFrom = 0;
let audioHueTarget = 0;
let audioHueAnimAt = 0;
let audioHuePhase: "idle" | "up" | "down" = "idle";

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function isIconSlot(slot: Slot) {
  return slot.kind === "image";
}

/** Bass swell is for holding pills only — not bare type, boxes, or icons. */
function isBassBoostSlot(slot: Slot) {
  return slot.kind === "text" && slot.shape === "pill";
}

/** Pulse one group; leave the other group's in-flight targets alone. */
function pushAudioGroup(group: "text" | "icon", mul: number) {
  const next = new Map(audioTargetMul);
  audioFromMul = new Map(audioDisplayMul);

  for (const slot of state.slots) {
    const current = audioDisplayMul.get(slot.id) ?? 1;
    if (!audioFromMul.has(slot.id)) audioFromMul.set(slot.id, current);

    const match = group === "icon" ? isIconSlot(slot) : isBassBoostSlot(slot);
    if (match) next.set(slot.id, mul);
    else if (!next.has(slot.id)) next.set(slot.id, current);
  }

  audioTargetMul = next;
  audioReturning = false;
  audioAnimAt = performance.now();
  audioClearAt = performance.now() + AUDIO_HOLD_MS;

  if (phase === "holding") {
    phase = "falling";
    settledSince = 0;
    holdStarted = 0;
  }
  lastInteractAt = performance.now();

  const bounce = state.audioReact.bounce;
  if (group === "icon") {
    const ids = state.slots.filter(isIconSlot).map((slot) => slot.id);
    const now = performance.now();
    if (now - audioIconJumpAt >= AUDIO_JUMP_COOLDOWN_MS) {
      audioIconJumpAt = now;
      world.impulseAudioJump(ids, AUDIO_ICON_JUMP * bounce);
    }
  } else {
    const ids = state.slots.filter(isBassBoostSlot).map((slot) => slot.id);
    const now = performance.now();
    if (now - audioTextJumpAt >= AUDIO_JUMP_COOLDOWN_MS) {
      audioTextJumpAt = now;
      world.impulseAudioJump(ids, AUDIO_TEXT_JUMP * bounce);
    }
  }
}

function returnAudioTargets() {
  if (audioTargetMul.size === 0) return;
  let anyOff = false;
  for (const mul of audioTargetMul.values()) {
    if (mul !== 1) {
      anyOff = true;
      break;
    }
  }
  if (!anyOff && audioDisplayMul.size === 0) return;
  audioFromMul = new Map(audioDisplayMul);
  audioTargetMul = new Map();
  for (const slot of state.slots) {
    if (!audioFromMul.has(slot.id)) audioFromMul.set(slot.id, 1);
    audioTargetMul.set(slot.id, 1);
  }
  audioReturning = true;
  audioAnimAt = performance.now();
  lastInteractAt = performance.now();
}

function clearAudioScale() {
  audioTargetMul = new Map();
  audioFromMul = new Map();
  audioDisplayMul = new Map();
  audioReturning = false;
  world.setAudioScales(null);
  clearAudioHue();
}

function pushAudioHue(now: number) {
  const peak = state.audioReact.hueNudge;
  if (peak <= 0) return;
  audioHueFrom = audioHueOffset;
  audioHueTarget = peak;
  audioHueAnimAt = now;
  audioHuePhase = "up";
}

function clearAudioHue() {
  if (audioHuePhase === "idle" && audioHueOffset === 0) return;
  audioHueOffset = 0;
  audioHueFrom = 0;
  audioHueTarget = 0;
  audioHuePhase = "idle";
  applyPost();
}

function paintAudioHue(now: number) {
  if (audioHuePhase === "idle") return;

  const duration = audioHuePhase === "up" ? AUDIO_HUE_UP_MS : AUDIO_HUE_DOWN_MS;
  const t = Math.min(1, (now - audioHueAnimAt) / duration);
  const e = easeOutCubic(t);
  audioHueOffset = audioHueFrom + (audioHueTarget - audioHueFrom) * e;
  applyPost();

  if (t < 1) return;
  if (audioHuePhase === "up") {
    audioHueFrom = audioHueOffset;
    audioHueTarget = 0;
    audioHueAnimAt = now;
    audioHuePhase = "down";
    return;
  }
  audioHueOffset = 0;
  audioHuePhase = "idle";
  applyPost();
}

function paintAudioScales(now: number) {
  paintAudioHue(now);
  if (audioTargetMul.size === 0 && audioDisplayMul.size === 0) return;

  const t = Math.min(1, (now - audioAnimAt) / AUDIO_ANIM_MS);
  const e = easeOutCubic(t);
  const next = new Map<string, number>();
  let anyActive = false;

  for (const [id, target] of audioTargetMul) {
    const from = audioFromMul.get(id) ?? 1;
    const value = from + (target - from) * e;
    if (Math.abs(value - 1) > 0.001) {
      next.set(id, value);
      anyActive = true;
    }
  }

  audioDisplayMul = next;
  world.setAudioScales(anyActive ? next : null);

  if (t >= 1 && audioReturning) {
    clearAudioScale();
  }
}

async function setAudioReactEnabled(on: boolean) {
  state.audioReact.enabled = on;
  setUiSoundsMuted(on);
  if (!on) {
    stopMic();
    clearAudioScale();
    renderPanel();
    return;
  }
  renderPanel();
  const ok = await startMic();
  if (!ok) {
    state.audioReact.enabled = false;
    setUiSoundsMuted(false);
    window.alert("Microphone access was blocked or unavailable.");
    renderPanel();
    return;
  }
  renderPanel();
}

function tickAudioReact(now: number) {
  if (!state.audioReact.enabled) {
    paintAudioScales(now);
    return;
  }
  if (!isMicActive()) {
    paintAudioScales(now);
    if (now - audioHintAt < 200) return;
    audioHintAt = now;
    const hint = panel.querySelector("#audio-react-hint");
    if (hint) hint.textContent = "Waiting for microphone…";
    return;
  }

  const bands = sampleOnset(state.audioReact.sensitivity);
  const onsetThresh = 0.055 - (state.audioReact.sensitivity / 100) * 0.035;
  const bassHit = bands.bassFlux >= onsetThresh && now - audioBassAt >= AUDIO_PEAK_COOLDOWN_MS;
  const sharpHit = bands.sharpFlux >= onsetThresh && now - audioSharpAt >= AUDIO_PEAK_COOLDOWN_MS;

  if (bassHit) {
    audioBassAt = now;
    pushAudioGroup("text", 1 + state.audioReact.bassBoost / 100);
  }
  if (sharpHit) {
    audioSharpAt = now;
    pushAudioGroup("icon", AUDIO_SHARP_SCALE);
    pushAudioHue(now);
  }
  if (!bassHit && !sharpHit && !audioReturning && audioTargetMul.size > 0 && now >= audioClearAt) {
    returnAudioTargets();
  }

  paintAudioScales(now);

  if (now - audioHintAt < 100) return;
  audioHintAt = now;
  const hint = panel.querySelector("#audio-react-hint");
  if (!hint) return;
  const pct = (v: number) => Math.round(v * 100);
  hint.textContent = `Listening · Bass ${pct(bands.bassFlux)} · Sharp ${pct(bands.sharpFlux)}`;
}

function relayout() {
  world.refresh(
    state.slots,
    state.physics,
    fitScale(),
    state.theme,
    state.pillPad,
    state.textTracking,
    state.sizeRandom,
  );
}

function refreshUploadPreviews() {
  for (const slot of state.slots) {
    if (slot.kind !== "image" || !slot.src || slot.emoji || presetIdForSrc(slot.src)) continue;
    const src = peekTrim(slot.src)?.displaySrc;
    if (!src) continue;
    const card = panel.querySelector<HTMLElement>(`[data-id="${slot.id}"]`);
    if (!card) continue;
    const mask = `url("${src}")`;
    card.querySelectorAll<HTMLElement>(".slot-mark .shape-swatch, .pick-glyph.shape-swatch").forEach((swatch) => {
      swatch.style.webkitMaskImage = mask;
      swatch.style.maskImage = mask;
    });
    card.querySelectorAll<HTMLImageElement>(".slot-mark img, img.pick-glyph").forEach((img) => {
      if (img.getAttribute("src") !== src) img.src = src;
    });
  }
}

function live() {
  const bump = () => {
    refreshUploadPreviews();
    const before = world.chipCount();
    relayout();
    // Additions and removals should keep the frame loop syncing and wake a held pile.
    if (world.chipCount() !== before) {
      lastInteractAt = performance.now();
      if (phase === "holding") {
        phase = "falling";
        settledSince = 0;
        holdStarted = 0;
      }
    }
  };
  bump();
  void Promise.all([ensureTrims(state.slots), ensureTextFonts(state.slots)]).then(bump);
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

const shell = app.querySelector(".app")!;
const playBtn = app.querySelector<HTMLButtonElement>("#play")!;
const loopBtn = app.querySelector<HTMLButtonElement>("#loop")!;

let running = false;
let paused = false;
let repeat = false;
let droppedAt = 0;
let settledSince = 0;
let holdStarted = 0;
let lastInteractAt = 0;
let phase: "idle" | "preparing" | "falling" | "holding" | "dumping" = "idle";
let dropTicket = 0;

const MIN_CYCLE_MS = 1200;
const SETTLE_CONFIRM_MS = 900;
const PLAY_IDLE_MS = 3000;

let shownScale = 1;
let frameKey = "";

function workBox() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const full = { x: 0, y: 0, width, height };
  if (shell.classList.contains("ui-hidden")) return full;
  const stageRect = stage.getBoundingClientRect();
  let limitRight = width;
  let limitBottom = height;
  const blockers = [panelShell, shell.querySelector(".theme-shelf.is-open")].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  for (const el of blockers) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2) continue;
    const left = rect.left - stageRect.left;
    const top = rect.top - stageRect.top;
    if (left > width * 0.3 && top < height * 0.5) limitRight = Math.min(limitRight, left);
    else if (top > height * 0.3) limitBottom = Math.min(limitBottom, top);
  }
  return {
    x: 0,
    y: 0,
    width: Math.max(120, limitRight),
    height: Math.max(120, limitBottom),
  };
}

function currentFrame() {
  return canvasFrame(stage.clientWidth, stage.clientHeight, state.canvas, workBox());
}

function layoutScale(frame: CanvasFrame): number {
  return state.canvas === "9:16" ? frame.scale : 1;
}

function fitScale() {
  const scale = layoutScale(currentFrame());
  shownScale = scale;
  world.setSimulationScale(scale);
  return state.masterScale * scale;
}

function placeFrame(frame: ReturnType<typeof currentFrame>) {
  playfield.style.left = `${frame.x}px`;
  playfield.style.top = `${frame.y}px`;
  playfield.style.width = `${frame.width}px`;
  playfield.style.height = `${frame.height}px`;
  applyBackground();
  const portrait = state.canvas === "9:16";
  stage.classList.toggle("is-portrait", portrait);
  stageVeil.hidden = !portrait;
  if (!portrait) return;
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const side = (name: string) => stageVeil.querySelector<HTMLElement>(`[data-side="${name}"]`);
  const top = side("top");
  const rightEl = side("right");
  const bottomEl = side("bottom");
  const left = side("left");
  if (top) top.style.cssText = `left:${frame.x}px;top:0;width:${frame.width}px;height:${frame.y}px`;
  if (rightEl) rightEl.style.cssText = `left:${right}px;top:0;right:0;bottom:0`;
  if (bottomEl) bottomEl.style.cssText = `left:${frame.x}px;top:${bottom}px;width:${frame.width}px;bottom:0`;
  if (left) left.style.cssText = `left:0;top:0;width:${frame.x}px;bottom:0`;
}

function syncCanvas(refitChips: boolean) {
  const frame = currentFrame();
  const scale = layoutScale(frame);
  const key = `${state.canvas}:${frame.x},${frame.y},${frame.width},${frame.height}`;
  if (key === frameKey) return false;
  const factor = shownScale > 0 ? scale / shownScale : 1;
  placeFrame(frame);
  const moveChips = refitChips && world.chipCount() > 0 && (state.canvas === "9:16" || Math.abs(factor - 1) > 0.0001);
  if (moveChips) world.refit(frame.width, frame.height, factor);
  else world.resize(frame.width, frame.height);
  shownScale = scale;
  world.setSimulationScale(scale);
  frameKey = key;
  return true;
}

function selectCanvas(next: CanvasRatio) {
  if (state.canvas === next) return;
  remember();
  state.canvas = next;
  if (running) {
    world.clear();
    syncCanvas(false);
    void drop();
  } else if (syncCanvas(world.chipCount() > 0) && world.chipCount() > 0) {
    relayout();
  }
  renderPanel();
}

async function drop() {
  const ticket = ++dropTicket;
  phase = "preparing";
  await Promise.all([ensureTrims(state.slots), ensureTextFonts(state.slots)]);
  if (!running || ticket !== dropTicket) return;
  syncCanvas(false);
  world.setFloorOpen(false);
  world.play(
    state.slots,
    state.physics,
    stage,
    fitScale(),
    state.theme,
    state.pillPad,
    state.textTracking,
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

function paintPhysDebug() {
  if (!physDebugOn) return;
  const width = playfield.clientWidth;
  const height = playfield.clientHeight;
  if (width < 2 || height < 2) return;
  if (physDebugCanvas.width !== width || physDebugCanvas.height !== height) {
    physDebugCanvas.width = width;
    physDebugCanvas.height = height;
  }
  const ctx = physDebugCanvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#39ff14";
  ctx.fillStyle = "rgb(57 255 20 / 0.08)";
  for (const poly of world.wireframes()) {
    if (poly.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function setPhysDebug(on: boolean) {
  physDebugOn = on;
  physDebugCanvas.hidden = !on;
  if (on) paintPhysDebug();
  else {
    const ctx = physDebugCanvas.getContext("2d");
    ctx?.clearRect(0, 0, physDebugCanvas.width, physDebugCanvas.height);
  }
}

function setRunning(on: boolean) {
  running = on;
  paused = false;
  world.setRunning(on);
  paintTransport();
  if (on) {
    void drop();
    return;
  }
  dropTicket++;
  phase = "idle";
  world.setFloorOpen(false);
}

function finishRun() {
  running = false;
  paused = false;
  phase = "idle";
  world.setRunning(false);
  paintTransport();
}

function togglePlay() {
  setRunning(!running);
}

function togglePause() {
  if (!running) {
    setRunning(true);
    return;
  }
  paused = !paused;
  world.setRunning(!paused);
}

function holdSequenceClock(dt: number) {
  droppedAt += dt;
  if (settledSince) settledSince += dt;
  if (holdStarted) holdStarted += dt;
}

function toggleRepeat() {
  repeat = !repeat;
  paintTransport();
}

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable], .font-pick, .font-menu, .slot-menu, .color-pop, .theme-shelf"));
}

function editingText(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    const type = target.type;
    return type === "text" || type === "search" || type === "url" || type === "email";
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

function adoptState(next: typeof state) {
  state.slots = next.slots;
  state.physics = {
    ...DEFAULT_PHYSICS,
    ...next.physics,
    complexity: physicsComplexity(next.physics?.complexity),
  };
  state.audioReact = {
    ...DEFAULT_AUDIO_REACT,
    ...next.audioReact,
    enabled: Boolean(next.audioReact?.enabled),
    sensitivity:
      typeof next.audioReact?.sensitivity === "number"
        ? Math.min(100, Math.max(0, next.audioReact.sensitivity))
        : DEFAULT_AUDIO_REACT.sensitivity,
    bounce:
      typeof next.audioReact?.bounce === "number"
        ? Math.min(4, Math.max(1, next.audioReact.bounce))
        : DEFAULT_AUDIO_REACT.bounce,
    bassBoost:
      typeof next.audioReact?.bassBoost === "number"
        ? Math.min(20, Math.max(5, next.audioReact.bassBoost))
        : DEFAULT_AUDIO_REACT.bassBoost,
    hueNudge:
      typeof next.audioReact?.hueNudge === "number"
        ? Math.min(30, Math.max(0, next.audioReact.hueNudge))
        : DEFAULT_AUDIO_REACT.hueNudge,
  };
  state.stageColor = next.stageColor;
  state.background = normalizeBackground(next.background);
  state.canvas = next.canvas === "9:16" ? "9:16" : "16:9";
  state.masterScale = next.masterScale;
  state.sizeRandom = next.sizeRandom;
  state.pillPad = next.pillPad;
  state.textTracking = next.textTracking;
  state.shapeAmount = next.shapeAmount;
  state.theme = next.theme;
  state.post = {
    ...next.post,
    bloomOpacity: next.post.bloomOpacity ?? 80,
    hue: next.post.hue ?? 0,
    blend: blendMode(next.post.blend),
  };
  recountShapes();
  setUiSoundsMuted(state.audioReact.enabled);
  if (state.audioReact.enabled) void startMic();
  else {
    stopMic();
    clearAudioScale();
  }
}

const UNDO_LIMIT = 50;

type Snapshot = {
  doc: AppState;
  appliedFont: string;
  machineFont: string;
};

const past: Snapshot[] = [];
const future: Snapshot[] = [];
let gesture: string | null = null;
let pointerHeld = false;

const undoBtn = app.querySelector<HTMLButtonElement>("#undo")!;
const redoBtn = app.querySelector<HTMLButtonElement>("#redo")!;

function takeSnapshot(): Snapshot {
  return {
    doc: structuredClone(state),
    appliedFont,
    machineFont,
  };
}

function paintUndo() {
  undoBtn.disabled = past.length === 0;
  redoBtn.disabled = future.length === 0;
}

function remember(key?: string) {
  if (key && key === gesture) return;
  gesture = key ?? null;
  past.push(takeSnapshot());
  if (past.length > UNDO_LIMIT) past.shift();
  future.length = 0;
  paintUndo();
}

function endGesture() {
  gesture = null;
}

function restore(snap: Snapshot) {
  tintPicker?.close();
  adoptState(snap.doc);
  appliedFont = snap.appliedFont;
  machineFont = snap.machineFont;
  applyBackground();
  applyPost();
  syncCanvas(world.chipCount() > 0);
  renderPanel();
  live();
  paintUndo();
}

function undo() {
  const snap = past.pop();
  if (!snap) return;
  endGesture();
  future.push(takeSnapshot());
  if (future.length > UNDO_LIMIT) future.shift();
  restore(snap);
  playClick();
}

function redo() {
  const snap = future.pop();
  if (!snap) return;
  endGesture();
  past.push(takeSnapshot());
  if (past.length > UNDO_LIMIT) past.shift();
  restore(snap);
  playClick();
}

undoBtn.addEventListener("click", () => undo());
redoBtn.addEventListener("click", () => redo());
window.addEventListener("pointerdown", () => {
  pointerHeld = true;
}, true);
window.addEventListener("pointerup", () => {
  pointerHeld = false;
  endGesture();
}, true);
window.addEventListener("pointercancel", () => {
  pointerHeld = false;
  endGesture();
}, true);

playBtn.addEventListener("click", togglePlay);
loopBtn.addEventListener("click", toggleRepeat);
for (const id of ["physics", "background", "export"] as const) {
  app.querySelector(`#tab-${id}`)?.addEventListener("click", () => {
    if (panelTab === id) return;
    panelTab = id;
    panel.scrollTop = 0;
    renderPanel();
  });
}
paintTransport();
app.querySelector("#clear")?.addEventListener("click", () => {
  setRunning(false);
  world.clear();
});
app.querySelector("#reset-defaults")?.addEventListener("click", () => {
  remember();
  setRunning(false);
  world.clear();
  machineFont = "";
  appliedFont = "";
  pickedSlotId = null;
  world.setPicked(null);
  adoptState(freshState());
  for (const slot of state.slots) captureBaseline(slot);
  applyBackground();
  applyPost();
  syncCanvas(false);
  renderPanel();
});

const copyBtn = app.querySelector<HTMLButtonElement>("#copy-settings")!;
copyBtn.addEventListener("click", async () => {
  const payload = {
    stageColor: state.stageColor,
    background: {
      ...state.background,
      image: backgroundImage(state.background.imageId),
      logo: backgroundImage(state.background.logoId),
    },
    canvas: state.canvas,
    masterScale: state.masterScale,
    sizeRandom: state.sizeRandom,
    pillPad: state.pillPad,
    textTracking: state.textTracking,
    shapeAmount: state.shapeAmount,
    theme: [...state.theme],
    physics: { ...state.physics },
    audioReact: { ...state.audioReact },
    post: { ...state.post },
    slots: state.slots,
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  playNotify();
  copyBtn.textContent = "Copied";
  window.setTimeout(() => {
    copyBtn.textContent = "Copy settings";
  }, 1500);
});

window.addEventListener("keydown", (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && !event.altKey && !editingText(event.target)) {
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (key === "y") {
      event.preventDefault();
      redo();
      return;
    }
  }
  if (typingInField(event.target)) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (event.repeat) return;
    playClick();
    togglePause();
    return;
  }
  if (event.key === "h" || event.key === "H") {
    shell.classList.toggle("ui-hidden");
    playSwitch();
    resize();
    return;
  }
  if (event.key === "d" || event.key === "D") {
    if (event.repeat) return;
    setPhysDebug(!physDebugOn);
  }
});

let panelScrollFrame = 0;

function stopPanelScroll() {
  if (!panelScrollFrame) return;
  cancelAnimationFrame(panelScrollFrame);
  panelScrollFrame = 0;
  panel.style.overflowAnchor = "";
}

function scrollPanelTo(card: HTMLElement, shrinkAbove = 0) {
  const pad = 12;
  const panelRect = panel.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const clip = card.querySelector<HTMLElement>(".slot-fold-clip");
  const fold = card.querySelector<HTMLElement>(".slot-fold");
  const growth = clip && fold ? Math.max(0, clip.scrollHeight - fold.getBoundingClientRect().height) : 0;
  const max = Math.max(0, panel.scrollHeight + growth - shrinkAbove - panel.clientHeight);
  const dest = Math.min(max, Math.max(0, panel.scrollTop + cardRect.top - panelRect.top - pad - shrinkAbove));
  const from = panel.scrollTop;
  const delta = dest - from;
  stopPanelScroll();
  if (Math.abs(delta) < 1) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    panel.scrollTop = dest;
    return;
  }
  const duration = Math.min(720, Math.max(280, Math.abs(delta) * 0.85));
  const start = performance.now();
  panel.style.overflowAnchor = "none";
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    panel.scrollTop = from + delta * eased;
    if (t < 1) {
      panelScrollFrame = requestAnimationFrame(step);
      return;
    }
    panelScrollFrame = 0;
    panel.style.overflowAnchor = "";
  };
  panelScrollFrame = requestAnimationFrame(step);
}

function showPick(id: string) {
  if (pickedSlotId && pickedSlotId !== id) {
    panel.querySelector<HTMLElement>(`[data-id="${pickedSlotId}"]`)?.classList.remove("is-picked");
  }
  pickedSlotId = id;
  world.setPicked(id);
  panel.querySelector<HTMLElement>(`[data-id="${id}"]`)?.classList.add("is-picked");
}

function releasePick(id: string) {
  if (pickedSlotId !== id) return;
  pickedSlotId = null;
  world.setPicked(null);
  panel.querySelector<HTMLElement>(`[data-id="${id}"]`)?.classList.remove("is-picked");
}

function dismissPick() {
  endChipEdit();
  const id = pickedSlotId;
  if (!id) return;
  const card = panel.querySelector<HTMLElement>(`[data-id="${id}"]`);
  const slot = state.slots.find((item) => item.id === id);
  const toggle = card?.querySelector<HTMLElement>(".slot-toggle");
  pickedSlotId = null;
  world.setPicked(null);
  card?.classList.remove("is-picked");
  playRemove();
  if (slot && toggle && openSlots.has(id)) setSlotOpen(toggle, slot, false, false);
}

function pickSlot(id: string | null, opts?: { force?: boolean }) {
  if (!id) {
    dismissPick();
    return;
  }
  const editing = world.editingId();
  if (editing && editing !== id) endChipEdit();
  const jumped = panelTab !== "physics";
  if (jumped) {
    panelTab = "physics";
    panel.scrollTop = 0;
    renderPanel();
  } else if (!opts?.force && id === pickedSlotId) {
    dismissPick();
    return;
  }
  const card = panel.querySelector<HTMLElement>(`[data-id="${id}"]`);
  const slot = state.slots.find((item) => item.id === id);
  const toggle = card?.querySelector<HTMLElement>(".slot-toggle");
  if (!card || !slot || !toggle) return;

  let shrinkAbove = 0;
  const cardTop = card.getBoundingClientRect().top;
  for (const otherId of openSlots) {
    if (otherId === id) continue;
    const prev = panel.querySelector<HTMLElement>(`[data-id="${otherId}"]`);
    if (prev && prev.getBoundingClientRect().top < cardTop) {
      shrinkAbove += prev.querySelector(".slot-fold")?.getBoundingClientRect().height ?? 0;
    }
  }

  pickedSlotId = id;
  world.setPicked(id);
  card.classList.add("is-picked");
  playClick();
  if (!openSlots.has(id)) setSlotOpen(toggle, slot, true, false);
  else closeOtherSlots(id);
  scrollPanelTo(card, shrinkAbove);
}

panel.addEventListener("wheel", stopPanelScroll, { passive: true });
panel.addEventListener("pointerdown", stopPanelScroll);

mountProTip(shell);
mountTooltips(document);
world.attach(
  stage,
  pickSlot,
  (id, x, y) => openSlotMenu(x, y, id),
  (id) => editChipText(id, true),
);

const resize = () => {
  if (syncCanvas(world.chipCount() > 0) && world.chipCount() > 0) relayout();
};
const frameObserver = new ResizeObserver(() => resize());
frameObserver.observe(stage);
frameObserver.observe(panelShell);
const themeShelfEl = shell.querySelector(".theme-shelf");
if (themeShelfEl) frameObserver.observe(themeShelfEl);
resize();
applyBackground();
applyPost();
renderPanel();
void ensureTrims(state.slots);
void ensureTextFonts(state.slots);
document.fonts.addEventListener("loadingdone", () => {
  if (world.chipCount() === 0) return;
  relayout();
});

let prevFrame = 0;

function frame(now: number) {
  const dt = prevFrame ? now - prevFrame : 0;
  prevFrame = now;
  tickAudioReact(now);
  if (paused) {
    world.setRunning(false);
    holdSequenceClock(dt);
    if (lastInteractAt) lastInteractAt += dt;
    requestAnimationFrame(frame);
    return;
  }

  const busy =
    world.isDragging() ||
    phase === "falling" ||
    phase === "dumping" ||
    phase === "preparing" ||
    !world.isQuiet();
  if (busy) {
    world.sync();
    world.purgeFallen(playfield.clientHeight);
  }
  paintPhysDebug();

  if (world.isDragging()) lastInteractAt = now;
  const playing = lastInteractAt > 0 && now - lastInteractAt < PLAY_IDLE_MS;

  if (running && playing) {
    holdSequenceClock(dt);
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
      const settledLongEnough =
        elapsed >= MIN_CYCLE_MS &&
        world.isSettled() &&
        settledSince !== 0 &&
        now - settledSince >= SETTLE_CONFIRM_MS;
      if (settledLongEnough) {
        phase = "holding";
        holdStarted = now;
        world.freezePile();
        world.sync();
      } else if (elapsed >= MIN_CYCLE_MS && world.isSettled()) {
        if (!settledSince) settledSince = now;
      } else {
        // Any remaining slide (even "quiet" friction) restarts the settle clock.
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
