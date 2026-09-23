import { mountColorPicker } from "./colorPicker";
import { backgroundImage, isSvgLogo, logoFill, sampleStopColor, stopBarGradient, storeBackgroundImage, svgOriginalColor, svgSize } from "./background";
import type { AppState, GradientStop } from "./types";
import { uid } from "./types";

const MAX_STOPS = 6;
const MIN_STOPS = 2;

export type BackgroundController = {
  state(): AppState;
  remember(key?: string): void;
  endGesture(): void;
  apply(): void;
  refresh(): void;
  showing(): boolean;
};

let pickerClose: (() => void) | null = null;
let selectedStopId: string | null = null;

export function closeBackgroundUi() {
  pickerClose?.();
  pickerClose = null;
}

function backgroundOf(controller: BackgroundController) {
  return controller.state().background;
}

function selectedStop(stops: GradientStop[]): GradientStop | null {
  return stops.find((stop) => stop.id === selectedStopId) ?? stops[0] ?? null;
}

function openPicker(controller: BackgroundController, anchor: HTMLElement, value: string, onChange: (hex: string) => void, gesture: string) {
  pickerClose?.();
  const picker = mountColorPicker({
    anchor,
    value,
    onChange(hex) {
      controller.remember(gesture);
      onChange(hex);
    },
    onClose() {
      controller.endGesture();
      if (pickerClose === picker.close) pickerClose = null;
    },
  });
  pickerClose = picker.close;
}

function readImageFile(file: File): Promise<{ src: string; name: string }> {
  const name = file.name.toLowerCase();
  const png = file.type === "image/png" || name.endsWith(".png");
  const jpg = file.type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg");
  if (!png && !jpg) return Promise.reject(new Error("type"));
  return createImageBitmap(file).then((bitmap) => {
    try {
      const max = 3840;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: png });
      if (!ctx) throw new Error("canvas");
      ctx.drawImage(bitmap, 0, 0, width, height);
      const keepPng = png && opaque(ctx, width, height) === false;
      const src = keepPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.86);
      return { src, name: file.name || "image" };
    } finally {
      bitmap.close();
    }
  });
}

function opaque(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 80));
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] < 250) return false;
    }
  }
  return true;
}

export function mountBackgroundPanel(panel: HTMLElement, controller: BackgroundController, scroll: number) {
  const { background, canvas, stageColor } = controller.state();
  const file = backgroundImage(background.imageId);
  const stop = selectedStop(background.stops);
  if (stop) selectedStopId = stop.id;
  const linear = background.shape !== "radial";
  const shapeHint = linear
    ? "Linear runs the colors from the top of the frame to the bottom."
    : "Radial blends evenly from the center out to the corners.";

  panel.innerHTML = `
    <section class="section">
      <h2>Background</h2>
      <div class="segment is-3" role="group" aria-label="Background type">
        <button type="button" class="pill${background.kind === "solid" ? " is-on" : ""}" data-kind="solid" aria-pressed="${background.kind === "solid"}">Solid</button>
        <button type="button" class="pill${background.kind === "gradient" ? " is-on" : ""}" data-kind="gradient" aria-pressed="${background.kind === "gradient"}">Gradient</button>
        <button type="button" class="pill${background.kind === "image" ? " is-on" : ""}" data-kind="image" aria-pressed="${background.kind === "image"}">Image</button>
      </div>
      ${
        background.kind === "solid"
          ? `<button type="button" class="bg-swatch" id="bg-solid" style="background:${stageColor}" aria-label="Solid color"></button>`
          : ""
      }
      ${
        background.kind === "gradient"
          ? `<div class="segment" role="group" aria-label="Gradient shape">
              <button type="button" class="pill${background.shape === "radial" ? " is-on" : ""}" data-shape="radial" aria-pressed="${background.shape === "radial"}">Radial</button>
              <button type="button" class="pill${linear ? " is-on" : ""}" data-shape="linear" aria-pressed="${linear}">Linear</button>
            </div>
            <p class="hint">${shapeHint}</p>
            <div class="grad" id="grad">
              <div class="grad__bar" id="grad-bar"></div>
            </div>
            <p class="hint">Click the bar to add a color. Drag a color away to remove it.</p>
            <div class="field">Color
              <button type="button" class="bg-swatch" id="bg-stop" style="background:${stop?.color ?? "#000"}" aria-label="Gradient color"></button>
            </div>`
          : ""
      }
      ${
        background.kind === "image"
          ? `<button type="button" class="pill" id="bg-upload">${file ? "Replace image" : "Upload image"}</button>
            <input class="bg-file" id="bg-file" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" />
            ${
              file
                ? `<div class="bg-photo" id="bg-photo"></div>
                  <p class="hint" id="bg-name"></p>
                  <button type="button" class="pill" id="bg-clear">Remove image</button>`
                : ""
            }
            <p class="hint" id="bg-note">${canvas === "9:16" ? "On 9:16 the image meets the top and bottom. Wider photos crop at the sides." : "JPG or PNG. The image covers the frame. Switch to 9:16 and it meets the top and bottom."}</p>`
          : ""
      }
    </section>
  `;

  const name = panel.querySelector("#bg-name");
  if (name && file) name.textContent = file.name;
  const photo = panel.querySelector<HTMLElement>("#bg-photo");
  if (photo && file) photo.style.backgroundImage = `url("${file.src}")`;

  panel.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind;
      if (kind !== "solid" && kind !== "gradient" && kind !== "image") return;
      if (backgroundOf(controller).kind === kind) return;
      controller.remember();
      backgroundOf(controller).kind = kind;
      controller.apply();
      controller.refresh();
    });
  });

  panel.querySelectorAll<HTMLButtonElement>("[data-shape]").forEach((button) => {
    button.addEventListener("click", () => {
      const shape = button.dataset.shape;
      if (shape !== "radial" && shape !== "linear") return;
      if (backgroundOf(controller).shape === shape) return;
      controller.remember();
      backgroundOf(controller).shape = shape;
      controller.apply();
      controller.refresh();
    });
  });

  const solid = panel.querySelector<HTMLButtonElement>("#bg-solid");
  solid?.addEventListener("click", () => {
    openPicker(controller, solid, controller.state().stageColor, (hex) => {
      controller.state().stageColor = hex;
      solid.style.background = hex;
      controller.apply();
    }, "bg-solid");
  });

  if (background.kind === "gradient") mountStops(panel, controller);

  const stopSwatch = panel.querySelector<HTMLButtonElement>("#bg-stop");
  stopSwatch?.addEventListener("click", () => {
    const current = selectedStop(backgroundOf(controller).stops);
    if (!current) return;
    openPicker(controller, stopSwatch, current.color, (hex) => {
      current.color = hex;
      stopSwatch.style.background = hex;
      paintBar(panel, backgroundOf(controller).stops);
      const knob = panel.querySelector<HTMLElement>(`[data-stop="${current.id}"]`);
      if (knob) knob.style.background = hex;
      controller.apply();
    }, `bg-stop:${current.id}`);
  });

  const input = panel.querySelector<HTMLInputElement>("#bg-file");
  panel.querySelector("#bg-upload")?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", () => {
    const picked = input.files?.[0];
    input.value = "";
    if (!picked) return;
    const note = panel.querySelector("#bg-note");
    void readImageFile(picked)
      .then((image) => {
        controller.remember();
        const next = backgroundOf(controller);
        next.imageId = storeBackgroundImage(image.src, image.name);
        next.kind = "image";
        controller.apply();
        if (controller.showing()) controller.refresh();
      })
      .catch(() => {
        if (note) note.textContent = "Use a JPG or PNG.";
      });
  });
  panel.querySelector("#bg-clear")?.addEventListener("click", () => {
    controller.remember();
    const next = backgroundOf(controller);
    next.imageId = "";
    controller.apply();
    controller.refresh();
  });

  mountLogo(panel, controller);
  panel.scrollTop = scroll;
}

function readLogoFile(file: File): Promise<{ src: string; name: string; width: number; height: number; color: string; svg: boolean }> {
  const name = file.name.toLowerCase();
  const svg = file.type === "image/svg+xml" || name.endsWith(".svg");
  const png = file.type === "image/png" || name.endsWith(".png");
  if (svg) {
    return file.text().then((text) => {
      if (!/<svg[\s>]/i.test(text)) throw new Error("type");
      const clean = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/javascript:/gi, "");
      const size = svgSize(clean);
      const sized = /\bwidth\s*=/i.test(clean) && /\bheight\s*=/i.test(clean)
        ? clean
        : clean.replace(/<svg\b/i, `<svg width="${size.width}" height="${size.height}"`);
      return {
        src: `data:image/svg+xml;utf8,${encodeURIComponent(sized)}`,
        name: file.name || "logo.svg",
        width: size.width,
        height: size.height,
        color: svgOriginalColor(clean),
        svg: true,
      };
    });
  }
  if (!png) return Promise.reject(new Error("type"));
  return createImageBitmap(file).then((bitmap) => {
    try {
      const max = 2048;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.drawImage(bitmap, 0, 0, width, height);
      return { src: canvas.toDataURL("image/png"), name: file.name || "logo.png", width, height, color: "", svg: false };
    } finally {
      bitmap.close();
    }
  });
}

function paintSlider(input: HTMLInputElement) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const pct = ((Number(input.value) - min) / (max - min || 1)) * 100;
  input.style.setProperty("--pct", `${pct}%`);
}

function mountLogo(panel: HTMLElement, controller: BackgroundController) {
  const background = backgroundOf(controller);
  const file = backgroundImage(background.logoId ?? "");
  const svg = file ? isSvgLogo(file.name, file.src) : false;
  const theme = controller.state().theme;
  const scale = background.logoScale ?? 1;
  const original = background.logoOriginal || "#000000";
  const current = background.logoColor || (background.logoTint == null ? original : theme[background.logoTint % theme.length] || original);
  const originalOn = svg && !background.logoColor && background.logoTint == null;
  const section = document.createElement("section");
  section.className = "section";
  section.innerHTML = `
    <h2>Logotype</h2>
    <button type="button" class="pill" id="logo-upload">${file ? "Replace logo" : "Upload logo"}</button>
    <input class="bg-file" id="logo-file" type="file" accept="image/svg+xml,image/png,.svg,.png" />
    ${
      file
        ? `<div class="logo-preview" id="logo-preview"></div>
          <p class="hint" id="logo-name"></p>
          <label class="field"><span id="logo-scale-label">Scale ${scale.toFixed(2)}</span>
            <input type="range" id="logo-scale" min="0.25" max="4" step="0.05" value="${scale}" />
          </label>
          ${
            svg
              ? `<div class="field">Color
                  <button type="button" class="bg-swatch" id="logo-color" style="background:${current}" aria-label="Logo color"></button>
                </div>
                <div class="tint-row" style="--theme-count:${theme.length + 1}">
                  <button type="button" class="tint${originalOn ? " is-on" : ""}" id="logo-original" style="background:${original}" aria-pressed="${originalOn}" aria-label="Original color"></button>
                  ${theme
                    .map((color, index) => {
                      const on = !background.logoColor && background.logoTint === index;
                      return `<button type="button" class="tint${on ? " is-on" : ""}" data-logo-tint="${index}" style="background:${color}" aria-pressed="${on}" aria-label="Theme color ${index + 1}"></button>`;
                    })
                    .join("")}
                </div>
                <p class="hint">The first swatch is the file's own color. The rest follow the Physics theme.</p>`
              : ""
          }
          <button type="button" class="pill" id="logo-clear">Remove logo</button>`
        : ""
    }
    <p class="hint" id="logo-note">SVG or PNG. It stays in the center, behind what falls.</p>
  `;
  panel.append(section);

  const name = section.querySelector("#logo-name");
  if (name && file) name.textContent = file.name;
  const preview = section.querySelector<HTMLElement>("#logo-preview");
  if (preview && file) {
    const fill = svg ? logoFill(background, theme) : null;
    const mark = document.createElement(fill ? "div" : "img");
    mark.className = "logo-mark";
    const box = 72;
    const ratio = file.width > 0 && file.height > 0 ? file.width / file.height : 1;
    mark.style.width = `${ratio >= 1 ? box : box * ratio}px`;
    mark.style.height = `${ratio >= 1 ? box / ratio : box}px`;
    if (mark instanceof HTMLImageElement) {
      mark.src = file.src;
      mark.alt = "";
    } else if (fill) {
      mark.style.background = fill;
      const mask = `url("${file.src}")`;
      mark.style.maskImage = mask;
      mark.style.webkitMaskImage = mask;
    }
    preview.append(mark);
  }

  const slider = section.querySelector<HTMLInputElement>("#logo-scale");
  const sliderLabel = section.querySelector("#logo-scale-label");
  if (slider) paintSlider(slider);
  slider?.addEventListener("input", () => {
    controller.remember("logo-scale");
    const value = Number(slider.value);
    backgroundOf(controller).logoScale = value;
    paintSlider(slider);
    if (sliderLabel) sliderLabel.textContent = `Scale ${value.toFixed(2)}`;
    controller.apply();
  });

  const colorBtn = section.querySelector<HTMLButtonElement>("#logo-color");
  colorBtn?.addEventListener("click", () => {
    const next = backgroundOf(controller);
    const shown = logoFill(next, controller.state().theme) ?? (next.logoOriginal || "#000000");
    openPicker(controller, colorBtn, shown, (hex) => {
      next.logoColor = hex;
      next.logoTint = null;
      colorBtn.style.background = hex;
      section.querySelectorAll(".tint.is-on").forEach((swatch) => {
        swatch.classList.remove("is-on");
        swatch.setAttribute("aria-pressed", "false");
      });
      const preview = section.querySelector("#logo-preview");
      if (preview && file) {
        let mark = preview.querySelector<HTMLElement>(".logo-mark");
        if (!(mark instanceof HTMLElement) || mark instanceof HTMLImageElement) {
          const previous = mark;
          mark = document.createElement("div");
          mark.className = "logo-mark";
          if (previous) {
            mark.style.width = previous.style.width;
            mark.style.height = previous.style.height;
          }
          preview.replaceChildren(mark);
        }
        mark.style.background = hex;
        const mask = `url("${file.src}")`;
        mark.style.maskImage = mask;
        mark.style.webkitMaskImage = mask;
      }
      controller.apply();
    }, "logo-color");
  });

  section.querySelector("#logo-original")?.addEventListener("click", () => {
    const next = backgroundOf(controller);
    if (!next.logoColor && next.logoTint == null) return;
    controller.remember();
    next.logoColor = "";
    next.logoTint = null;
    controller.apply();
    controller.refresh();
  });
  section.querySelectorAll<HTMLButtonElement>("[data-logo-tint]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.logoTint);
      const next = backgroundOf(controller);
      if (next.logoTint === index && !next.logoColor) return;
      controller.remember();
      next.logoTint = index;
      next.logoColor = "";
      controller.apply();
      controller.refresh();
    });
  });

  const input = section.querySelector<HTMLInputElement>("#logo-file");
  section.querySelector("#logo-upload")?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", () => {
    const picked = input.files?.[0];
    input.value = "";
    if (!picked) return;
    const note = section.querySelector("#logo-note");
    void readLogoFile(picked)
      .then((logo) => {
        controller.remember();
        const next = backgroundOf(controller);
        next.logoId = storeBackgroundImage(logo.src, logo.name, logo.width, logo.height);
        next.logoOriginal = logo.color;
        next.logoTint = null;
        next.logoColor = "";
        controller.apply();
        if (controller.showing()) controller.refresh();
      })
      .catch(() => {
        if (note) note.textContent = "Use an SVG or PNG.";
      });
  });
  section.querySelector("#logo-clear")?.addEventListener("click", () => {
    controller.remember();
    const next = backgroundOf(controller);
    next.logoId = "";
    next.logoOriginal = "";
    next.logoTint = null;
    next.logoColor = "";
    controller.apply();
    controller.refresh();
  });
}

function paintBar(panel: HTMLElement, stops: GradientStop[]) {
  const bar = panel.querySelector<HTMLElement>("#grad-bar");
  if (bar) bar.style.background = stopBarGradient(stops);
}

function mountStops(panel: HTMLElement, controller: BackgroundController) {
  const bar = panel.querySelector<HTMLElement>("#grad-bar");
  if (!bar) return;
  const stops = () => backgroundOf(controller).stops;

  const paint = () => {
    bar.style.background = stopBarGradient(stops());
    bar.replaceChildren();
    for (const stop of stops()) {
      const knob = document.createElement("button");
      knob.type = "button";
      knob.className = `grad__stop${stop.id === selectedStopId ? " is-on" : ""}`;
      knob.dataset.stop = stop.id;
      knob.style.left = `${stop.at}%`;
      knob.style.background = stop.color;
      knob.setAttribute("aria-label", `Color at ${Math.round(stop.at)}%`);
      knob.addEventListener("pointerdown", (event) => onStopDown(event, knob, stop.id));
      bar.append(knob);
    }
  };

  const select = (id: string) => {
    selectedStopId = id;
    for (const knob of bar.querySelectorAll<HTMLElement>(".grad__stop")) {
      knob.classList.toggle("is-on", knob.dataset.stop === id);
    }
    const current = stops().find((stop) => stop.id === id);
    const swatch = panel.querySelector<HTMLElement>("#bg-stop");
    if (current && swatch) swatch.style.background = current.color;
  };

  const onStopDown = (event: PointerEvent, knob: HTMLElement, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    select(id);
    const pointer = event.pointerId;
    const startY = event.clientY;
    let moved = false;
    let removing = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const rect = bar.getBoundingClientRect();
      const dx = ev.clientX - event.clientX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) controller.remember("bg-drag");
      moved = true;
      const at = Math.round(Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100)));
      const stop = stops().find((item) => item.id === id);
      if (!stop) return;
      stop.at = at;
      knob.style.left = `${at}%`;
      knob.setAttribute("aria-label", `Color at ${at}%`);
      bar.style.background = stopBarGradient(stops());
      removing = stops().length > MIN_STOPS && Math.abs(dy) > 28;
      knob.classList.toggle("is-gone", removing);
      controller.apply();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", up);
      knob.removeEventListener("pointercancel", up);
      if (removing) {
        const next = stops().filter((item) => item.id !== id);
        backgroundOf(controller).stops = next;
        if (selectedStopId === id) selectedStopId = next[0]?.id ?? null;
        controller.refresh();
        return;
      }
      knob.classList.remove("is-gone");
      if (!moved) {
        const stop = stops().find((item) => item.id === id);
        if (!stop) return;
        openPicker(controller, knob, stop.color, (hex) => {
          stop.color = hex;
          knob.style.background = hex;
          const swatch = panel.querySelector<HTMLElement>("#bg-stop");
          if (swatch && selectedStopId === id) swatch.style.background = hex;
          bar.style.background = stopBarGradient(stops());
          controller.apply();
        }, `bg-stop:${id}`);
      }
    };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
    try {
      knob.setPointerCapture(pointer);
    } catch {
      // A real pointer always captures. Ignore synthetic events.
    }
  };

  bar.addEventListener("pointerdown", (event) => {
    if (event.target !== bar) return;
    const rect = bar.getBoundingClientRect();
    const at = Math.round(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
    const near = stops().find((stop) => Math.abs(stop.at - at) <= 3);
    if (near) {
      select(near.id);
      return;
    }
    if (stops().length >= MAX_STOPS) return;
    controller.remember();
    const created: GradientStop = { id: uid(), color: sampleStopColor(stops(), at), at };
    backgroundOf(controller).stops = [...stops(), created];
    selectedStopId = created.id;
    controller.apply();
    controller.refresh();
  });

  paint();
}
