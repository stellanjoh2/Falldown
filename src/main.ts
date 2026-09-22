import { FEATURED_EMOJI, searchEmoji, type EmojiItem } from "./emojis";
import { ICON_PRESETS } from "./icons";
import {
  defaultImageSlot,
  defaultTextSlot,
  demoState,
  FONTS,
  type ImageSlot,
  type Slot,
  type TextSlot,
} from "./types";
import { activateFamily, queryLocalCatalog } from "./localFonts";
import { ensureTrims } from "./trim";
import { createWorld } from "./world";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

function freshState() {
  const next = demoState();
  for (const fav of [
    { name: "Rings", amount: 2, colorIndex: 2 },
    { name: "Flowers", amount: 2, colorIndex: 3 },
    { name: "Clovers", amount: 3, colorIndex: 0 },
  ]) {
    const icon = ICON_PRESETS.find((preset) => preset.label === fav.name);
    if (!icon) continue;
    next.slots.push(
      defaultImageSlot({
        src: icon.src,
        name: icon.label,
        size: 56,
        amount: fav.amount,
        colorIndex: fav.colorIndex,
      }),
    );
  }
  return next;
}

const state = freshState();

const world = createWorld();

app.innerHTML = `
  <div class="app">
    <div class="stage" id="stage">
      <div class="chip-layer"></div>
      <div class="bloom-layer" aria-hidden="true"></div>
      <div class="post-grain" aria-hidden="true"></div>
      <div class="post-vignette" aria-hidden="true"></div>
    </div>
    <div class="toolbar">
      <h1>Falldown</h1>
      <span class="spacer"></span>
      <button type="button" id="clear">Clear</button>
      <button type="button" id="reset-defaults">Reset defaults</button>
      <button type="button" id="copy-settings">Copy settings</button>
      <button type="button" class="primary" id="play">Play</button>
    </div>
    <aside class="panel">
      <div class="panel-scroll" id="panel"></div>
    </aside>
  </div>
`;

const stage = app.querySelector<HTMLElement>("#stage")!;
const panel = app.querySelector<HTMLElement>("#panel")!;

let localFamilies: string[] = [];

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

function fontOptionsHtml(selected: string): string {
  const fonts = fontChoices();
  const bundled = fonts.filter((font) => font.group === "bundled");
  const local = fonts.filter((font) => font.group === "local");
  const known = new Set(fonts.map((font) => font.id));
  const extra =
    selected && !known.has(selected)
      ? `<option value="${escapeAttr(selected)}" selected>${escapeAttr(selected)}</option>`
      : "";
  const option = (font: { id: string; label: string }) =>
    `<option value="${escapeAttr(font.id)}" ${font.id === selected ? "selected" : ""}>${escapeAttr(font.label)}</option>`;
  return `
    ${bundled.map(option).join("")}
    ${extra}
    ${local.length ? `<optgroup label="This computer">${local.map(option).join("")}</optgroup>` : ""}
  `;
}

function applyStageColor() {
  stage.style.background = state.stageColor;
}

function applyPost() {
  const bloom = (state.post.bloom / 100) * 48;
  stage.style.setProperty("--bloom", `${bloom}px`);
  stage.style.setProperty("--bloom-opacity", `${state.post.bloomOpacity / 100}`);
  stage.style.setProperty("--post-grain", `${state.post.grain / 100}`);
  stage.style.setProperty("--post-vig", `${state.post.vignette / 140}`);
  stage.style.setProperty("--post-sat", `${state.post.saturate / 100}`);
  stage.classList.toggle("has-bloom", state.post.bloom > 0 && state.post.bloomOpacity > 0);
  stage.classList.toggle("has-sat", state.post.saturate !== 100);
}

function renderPanel() {
  panel.innerHTML = `
    <section class="section">
      <h2>Master size</h2>
      <label class="field"><span data-range-label="masterScale">Scale ${(state.masterScale * 10).toFixed(0)}</span>
        <input type="range" id="masterScale" min="4" max="100" step="1" value="${state.masterScale * 10}" />
      </label>
      <label class="field"><span data-range-label="pillPad">Pill padding ${state.pillPad}</span>
        <input type="range" id="pillPad" min="0" max="100" step="1" value="${state.pillPad}" />
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
      <div class="theme-row">
        ${state.theme
          .map(
            (color, i) =>
              `<label class="field">
                <input type="color" data-theme="${i}" value="${color}" />
              </label>`,
          )
          .join("")}
      </div>
      <label class="field">Stage
        <input type="color" id="stage-color" value="${state.stageColor}" />
      </label>
    </section>
    <section class="section">
      <h2>Typeface</h2>
      <label class="field">All text
        <select id="global-font">
          <option value="">Keep per-slot fonts</option>
          ${fontOptionsHtml("")}
        </select>
      </label>
      <div class="row">
        <label class="field">Font from this computer
          <input type="text" id="machine-font" list="local-font-list" placeholder="e.g. Helvetica Neue" />
        </label>
      </div>
      <datalist id="local-font-list">
        ${localFamilies.map((name) => `<option value="${escapeAttr(name)}"></option>`).join("")}
      </datalist>
      <button type="button" id="load-local-fonts">Load local fonts</button>
    </section>
    <section class="section">
      <h2>What falls down</h2>
      <div class="row">
        <button type="button" id="add-text">Add text</button>
        <button type="button" id="add-image">Add icon / image</button>
      </div>
      <div id="slots"></div>
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
    <p class="hint">After they settle, the floor opens. Space loops. H hides the UI.</p>
  `;

  const slotsEl = panel.querySelector("#slots")!;
  for (const slot of state.slots) {
    slotsEl.append(renderSlotCard(slot));
  }

  panel.querySelector("#add-text")?.addEventListener("click", () => {
    state.slots.push(defaultTextSlot({ colorIndex: state.slots.length % 4 }));
    renderPanel();
  });
  panel.querySelector("#add-image")?.addEventListener("click", () => {
    state.slots.push(defaultImageSlot({ colorIndex: state.slots.length % 4 }));
    renderPanel();
  });

  bindRange("masterScale", "Scale", (v) => {
    state.masterScale = v / 10;
    live();
  }, (v) => `${v.toFixed(0)}`);
  bindRange("pillPad", "Pill padding", (v) => {
    state.pillPad = Math.round(v);
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("textTracking", "Tracking", (v) => {
    state.textTracking = Math.round(v);
    live();
  }, (v) => `${Math.round(v)}`);
  bindRange("shapeAmount", "Amount of shapes", (v) => {
    state.shapeAmount = Math.round(v);
  }, (v) => `${Math.round(v)}`);

  panel.querySelector<HTMLSelectElement>("#global-font")?.addEventListener("change", (e) => {
    const family = (e.target as HTMLSelectElement).value;
    if (family) void applyFontEverywhere(family);
  });
  panel.querySelector<HTMLInputElement>("#machine-font")?.addEventListener("change", (e) => {
    const family = (e.target as HTMLInputElement).value.trim();
    if (family) void applyFontEverywhere(family);
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

  panel.querySelectorAll<HTMLInputElement>("[data-theme]").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.theme);
      state.theme[index] = input.value;
      live();
    });
  });
  panel.querySelector<HTMLInputElement>("#stage-color")?.addEventListener("input", (e) => {
    state.stageColor = (e.target as HTMLInputElement).value;
    applyStageColor();
  });
}

function bindRange(
  id: string,
  label: string,
  onChange: (value: number) => void,
  format: (value: number) => string = (value) => value.toFixed(2),
) {
  const input = panel.querySelector<HTMLInputElement>(`#${id}`);
  const caption = panel.querySelector(`[data-range-label="${id}"]`);
  input?.addEventListener("input", () => {
    const value = Number(input.value);
    onChange(value);
    if (caption) caption.textContent = `${label} ${format(value)}`;
  });
}

function renderSlotCard(slot: Slot): HTMLElement {
  const card = document.createElement("article");
  card.className = "slot-card";
  card.dataset.id = slot.id;

  if (slot.kind === "text") {
    card.append(textFields(slot));
  } else {
    card.append(imageFields(slot));
  }

  return card;
}

function textFields(slot: TextSlot): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="slot-head">
      <strong>Text</strong>
      <button type="button" class="ghost icon-btn" data-remove>✕</button>
    </div>
    <label class="field">Copy
      <input type="text" data-key="text" value="${escapeAttr(slot.text)}" />
    </label>
    <div class="row">
      <label class="field">Typeface
        <select data-key="fontFamily">
          ${fontOptionsHtml(slot.fontFamily)}
        </select>
      </label>
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

  wrap.querySelector("[data-remove]")?.addEventListener("click", () => removeSlot(slot.id));
  bindSlotInputs(wrap, slot);
  bindTint(wrap, slot);
  return wrap;
}

function imageFields(slot: ImageSlot): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="slot-head">
      <strong>Icon / image</strong>
      <button type="button" class="ghost icon-btn" data-remove>✕</button>
    </div>
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

  const grid = wrap.querySelector("[data-presets]")!;
  for (const icon of ICON_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = icon.label;
    btn.className = !slot.emoji && slot.src === icon.src ? "is-on" : "";
    btn.setAttribute("aria-pressed", String(!slot.emoji && slot.src === icon.src));
    btn.innerHTML = `<img src="${icon.src}" alt="${icon.label}" />`;
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

  wrap.querySelector("[data-remove]")?.addEventListener("click", () => removeSlot(slot.id));
  bindTint(wrap, slot);
  wrap.querySelector<HTMLInputElement>("[data-file]")?.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    slot.src = URL.createObjectURL(file);
    slot.name = file.name;
    slot.emoji = undefined;
    renderPanel();
    live();
  });
  bindSlotInputs(wrap, slot);
  return wrap;
}

function pickPreview(slot: ImageSlot): string {
  if (slot.emoji) {
    return `<span class="pick-glyph">${slot.emoji}</span><span>Selected <b>${escapeAttr(slot.name)}</b></span>`;
  }
  if (slot.src) {
    return `<img class="pick-glyph" src="${slot.src}" alt="" /><span>Selected <b>${escapeAttr(slot.name)}</b></span>`;
  }
  return `<span class="pick-empty">Nothing selected</span>`;
}

function tintRow(slot: Slot): string {
  return `<div class="tint-row">${state.theme
    .map(
      (color, index) =>
        `<button type="button" class="tint${(slot.colorIndex ?? 0) === index ? " is-on" : ""}" data-tint="${index}" style="background:${color}" aria-label="Color ${index + 1}"></button>`,
    )
    .join("")}</div>`;
}

function bindTint(root: HTMLElement, slot: Slot) {
  root.querySelectorAll<HTMLButtonElement>("[data-tint]").forEach((btn) => {
    btn.addEventListener("click", () => {
      slot.colorIndex = Number(btn.dataset.tint);
      renderPanel();
      live();
    });
  });
}

function bindSlotInputs(root: HTMLElement, slot: Slot) {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-key]").forEach((input) => {
    const key = input.dataset.key;
    if (!key) return;
    input.addEventListener("input", () => {
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
  state.slots = state.slots.filter((slot) => slot.id !== id);
  renderPanel();
  live();
}

async function applyFontEverywhere(family: string) {
  await activateFamily(family);
  for (const slot of state.slots) {
    if (slot.kind === "text") slot.fontFamily = family;
  }
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
    );
  });
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

const shell = app.querySelector(".app")!;
const playBtn = app.querySelector<HTMLButtonElement>("#play")!;

let looping = false;
let droppedAt = 0;
let settledSince = 0;
let holdStarted = 0;
let dumpStarted = 0;
let lastInteractAt = 0;
let phase: "idle" | "falling" | "holding" | "dumping" = "idle";

const MIN_CYCLE_MS = 1200;
const SETTLE_CONFIRM_MS = 400;
const MAX_FALL_MS = 5500;
const MAX_DUMP_MS = 4000;
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
  );
  droppedAt = performance.now();
  settledSince = 0;
  holdStarted = 0;
  dumpStarted = 0;
  lastInteractAt = 0;
  phase = "falling";
}

function setLooping(on: boolean) {
  looping = on;
  world.setRunning(on);
  playBtn.textContent = on ? "Stop" : "Play";
  if (on) {
    drop();
    return;
  }
  phase = "idle";
  world.setFloorOpen(false);
}

function toggleLoop() {
  setLooping(!looping);
}

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function adoptState(next: typeof state) {
  state.slots = next.slots;
  state.physics = next.physics;
  state.stageColor = next.stageColor;
  state.masterScale = next.masterScale;
  state.pillPad = next.pillPad;
  state.textTracking = next.textTracking;
  state.shapeAmount = next.shapeAmount;
  state.theme = next.theme;
  state.post = { ...next.post, bloomOpacity: next.post.bloomOpacity ?? 80 };
}

playBtn.addEventListener("click", toggleLoop);
app.querySelector("#clear")?.addEventListener("click", () => {
  setLooping(false);
  world.clear();
});
app.querySelector("#reset-defaults")?.addEventListener("click", () => {
  setLooping(false);
  world.clear();
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
    pillPad: state.pillPad,
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
    toggleLoop();
    return;
  }
  if (event.key === "h" || event.key === "H") {
    shell.classList.toggle("ui-hidden");
    resize();
  }
});

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

  if (looping && playing) {
    droppedAt += dt;
    if (settledSince) settledSince += dt;
    if (holdStarted) holdStarted += dt;
    if (dumpStarted) dumpStarted += dt;
    if (phase === "holding") {
      phase = "falling";
      settledSince = 0;
      holdStarted = 0;
    }
    return requestAnimationFrame(frame);
  }

  if (looping) {
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
      world.setFloorOpen(true);
      dumpStarted = now;
      phase = "dumping";
    } else if (phase === "dumping" && (world.chipCount() === 0 || now - dumpStarted >= MAX_DUMP_MS)) {
      if (world.chipCount() > 0) world.clear();
      void drop();
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
