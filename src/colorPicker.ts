const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const RECENT_KEY = "falldown.recentColors";
const MAX_RECENT = 14;

type Hsv = { h: number; s: number; v: number };
type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };
type Scale = "hex" | "rgb" | "hsl";

export function mountColorPicker(options: {
  anchor: HTMLElement;
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}): { close: () => void } {
  const { anchor, onChange, onClose } = options;
  let hsv = hexToHsv(normalizeHex(options.value));
  let scale: Scale = "hex";
  let closed = false;
  const recents = readRecentColors();

  const root = document.createElement("div");
  root.className = "color-pop";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Select color");

  const head = document.createElement("div");
  head.className = "color-pop-head";
  const title = document.createElement("p");
  title.className = "color-pop-title";
  title.textContent = "Select color";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "color-pop-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  head.append(title, closeBtn);

  const sv = document.createElement("div");
  sv.className = "color-pop-sv";
  const svThumb = document.createElement("div");
  svThumb.className = "color-pop-thumb";
  sv.append(svThumb);

  const hue = document.createElement("div");
  hue.className = "color-pop-hue";
  const hueThumb = document.createElement("div");
  hueThumb.className = "color-pop-thumb";
  hue.append(hueThumb);

  const inputs = document.createElement("div");
  inputs.className = "color-pop-inputs";
  const eye = document.createElement("button");
  eye.type = "button";
  eye.className = "color-pop-eye";
  eye.setAttribute("aria-label", "Pick a color from the screen");
  eye.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M16.2 3.3a2.4 2.4 0 0 1 3.4 3.4l-1.2 1.2-3.4-3.4 1.2-1.2zM14.6 6.3 17.7 9.4 8.4 18.7c-.3.3-.6.4-1 .5l-3.2.6.6-3.2c.1-.4.2-.7.5-1L14.6 6.3z"/></svg>';
  const fields = document.createElement("div");
  fields.className = "color-pop-fields";
  const scaleSelect = document.createElement("select");
  scaleSelect.className = "color-pop-scale";
  scaleSelect.setAttribute("aria-label", "Color values");
  for (const option of ["hex", "rgb", "hsl"] as const) {
    const item = document.createElement("option");
    item.value = option;
    item.textContent = option.toUpperCase();
    scaleSelect.append(item);
  }
  const eyeDropper = "EyeDropper" in window;
  if (eyeDropper) inputs.append(eye);
  inputs.append(fields, scaleSelect);
  if (!eyeDropper) inputs.classList.add("is-plain");

  root.append(head, sv, hue, inputs);

  let recentRow: HTMLElement | null = null;
  if (recents.length) {
    recentRow = document.createElement("div");
    recentRow.className = "color-pop-recent";
    for (const color of recents) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "color-pop-recent-swatch";
      swatch.style.background = color;
      swatch.setAttribute("aria-label", color);
      swatch.addEventListener("click", () => applyHex(color));
      recentRow.append(swatch);
    }
    root.append(recentRow);
  }

  document.body.append(root);

  const place = () => {
    if (!anchor.isConnected) {
      close();
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = root.getBoundingClientRect();
    const gap = 8;
    const width = panelRect.width || 280;
    const height = panelRect.height || 360;
    let left = anchorRect.left - width - gap;
    if (left < gap) left = Math.min(anchorRect.right + gap, window.innerWidth - width - gap);
    left = Math.max(gap, Math.min(left, window.innerWidth - width - gap));
    let top = anchorRect.top;
    if (top + height > window.innerHeight - gap) top = Math.max(gap, window.innerHeight - height - gap);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };

  const paintFields = () => {
    const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
    if (scale === "hex") {
      const input = fields.querySelector("input");
      if (input && document.activeElement !== input) input.value = hex;
      return;
    }
    fields.querySelectorAll("input").forEach((input) => {
      if (document.activeElement === input) return;
      if (scale === "rgb") {
        const rgb = hexToRgb(hex);
        input.value = String(Math.round(rgb[input.dataset.channel as "r" | "g" | "b"]));
      } else {
        const hsl = hexToHsl(hex);
        const channel = input.dataset.channel as "h" | "s" | "l";
        input.value = String(Math.round(hsl[channel]));
      }
    });
  };

  const paint = () => {
    const hueHex = hsvToHex(hsv.h, 1, 1);
    sv.style.setProperty("--hue", hueHex);
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    paintFields();
  };

  const emit = () => {
    onChange(hsvToHex(hsv.h, hsv.s, hsv.v));
    paint();
  };

  const applyHex = (hex: string) => {
    if (closed) return;
    hsv = hexToHsv(normalizeHex(hex, hsvToHex(hsv.h, hsv.s, hsv.v)));
    emit();
  };

  const mountFields = () => {
    fields.replaceChildren();
    if (scale === "hex") {
      const input = document.createElement("input");
      input.type = "text";
      input.spellcheck = false;
      input.setAttribute("aria-label", "Hex");
      input.value = hsvToHex(hsv.h, hsv.s, hsv.v);
      input.addEventListener("input", () => {
        if (HEX_RE.test(input.value.trim())) applyHex(input.value.trim());
      });
      input.addEventListener("change", () => applyHex(input.value));
      fields.append(input);
      return;
    }
    const spec: [string, number][] =
      scale === "rgb"
        ? [
            ["r", 255],
            ["g", 255],
            ["b", 255],
          ]
        : [
            ["h", 360],
            ["s", 100],
            ["l", 100],
          ];
    for (const [channel, max] of spec) {
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = String(max);
      input.dataset.channel = channel;
      input.setAttribute("aria-label", channel.toUpperCase());
      input.addEventListener("input", () => {
        const next = Number(input.value);
        if (!Number.isFinite(next)) return;
        const clamped = Math.min(max, Math.max(0, next));
        if (scale === "rgb") {
          const rgb = hexToRgb(hsvToHex(hsv.h, hsv.s, hsv.v));
          rgb[channel as "r" | "g" | "b"] = clamped;
          applyHex(rgbToHex(rgb.r, rgb.g, rgb.b));
        } else {
          const hsl = hexToHsl(hsvToHex(hsv.h, hsv.s, hsv.v));
          hsl[channel as "h" | "s" | "l"] = clamped;
          applyHex(hslToHex(hsl.h, hsl.s, hsl.l));
        }
      });
      fields.append(input);
    }
    paintFields();
  };

  const sample = (mode: "sv" | "hue", clientX: number, clientY: number) => {
    const rect = (mode === "sv" ? sv : hue).getBoundingClientRect();
    if (mode === "hue") {
      hsv = { ...hsv, h: clamp01((clientX - rect.left) / Math.max(1, rect.width)) * 360 };
    } else {
      hsv = {
        ...hsv,
        s: clamp01((clientX - rect.left) / Math.max(1, rect.width)),
        v: 1 - clamp01((clientY - rect.top) / Math.max(1, rect.height)),
      };
    }
    emit();
  };

  let drag: "sv" | "hue" | null = null;
  const onPointerDown = (mode: "sv" | "hue") => (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    drag = mode;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    sample(mode, event.clientX, event.clientY);
  };
  sv.addEventListener("pointerdown", onPointerDown("sv"));
  hue.addEventListener("pointerdown", onPointerDown("hue"));

  const onMove = (event: PointerEvent) => {
    if (!drag) return;
    sample(drag, event.clientX, event.clientY);
  };
  const onUp = () => {
    drag = null;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    pushRecentColor(hsvToHex(hsv.h, hsv.s, hsv.v));
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("resize", place);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    for (const target of scrollers) target.removeEventListener("scroll", place);
    root.remove();
    onClose();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const onDocPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (root.contains(target) || anchor.contains(target)) return;
    close();
  };

  closeBtn.addEventListener("click", () => close());
  scaleSelect.addEventListener("change", () => {
    scale = scaleSelect.value as Scale;
    mountFields();
  });
  eye.addEventListener("click", async () => {
    const Ctor = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!Ctor) return;
    try {
      const result = await new Ctor().open();
      applyHex(result.sRGBHex);
    } catch {
      /* cancelled */
    }
  });

  const scrollers: EventTarget[] = [];
  let node: HTMLElement | null = anchor;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) || /(auto|scroll|overlay)/.test(style.overflowX)) {
      scrollers.push(node);
    }
    node = node.parentElement;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", place);
  for (const target of scrollers) target.addEventListener("scroll", place, { passive: true });
  requestAnimationFrame(() => {
    if (closed) return;
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDocPointerDown, true);
  });

  mountFields();
  paint();
  place();

  return { close };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeHex(color: string, fallback = "#000000"): string {
  const raw = color.trim();
  if (HEX_RE.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .slice(1)
      .split("")
      .map((part) => part + part)
      .join("")}`.toLowerCase();
  }
  return fallback.toLowerCase();
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-9) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max <= 1e-9 ? 0 : delta / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const val = Math.min(1, Math.max(0, v));
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lit = Math.min(100, Math.max(0, l)) / 100;
  if (sat <= 1e-9) {
    const gray = lit * 255;
    return rgbToHex(gray, gray, gray);
  }
  const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
  const p = 2 * lit - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return rgbToHex(channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255);
}

function readRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((color): color is string => typeof color === "string" && HEX_RE.test(color))
      .map((color) => color.toLowerCase())
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function pushRecentColor(hex: string) {
  const next = normalizeHex(hex);
  const list = [next, ...readRecentColors().filter((color) => color !== next)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}
