import {
  palettePresetsForCategory,
  sortColorsForPreview,
  type PaletteCategory,
  type PalettePreset,
} from "./palettePresets";

const TAB_KEY = "falldown.paletteTab";
const TABS: PaletteCategory[] = ["common", "retro", "feral"];
const TAB_LABEL: Record<PaletteCategory, string> = {
  common: "Common",
  retro: "Retro",
  feral: "Feral",
};
const SLIDE_MS = 450;

function frostPlate(): HTMLElement {
  const frost = document.createElement("div");
  frost.className = "frost";
  frost.setAttribute("aria-hidden", "true");
  frost.innerHTML = `<div class="frost__scene"><div class="frost__chips"></div><div class="frost__glow"></div></div>`;
  return frost;
}

function readTab(): PaletteCategory {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    if (stored === "retro" || stored === "feral") return stored;
  } catch {
    /* ignore */
  }
  return "common";
}

function writeTab(tab: PaletteCategory): void {
  try {
    if (tab === "common") localStorage.removeItem(TAB_KEY);
    else localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* ignore */
  }
}

function samePalette(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((color, index) => color.toLowerCase() === b[index]?.toLowerCase());
}

export function createThemeShelf(options: {
  panel: HTMLElement;
  getColors: () => readonly string[];
  onApply: (colors: string[], stage?: string) => void;
}): {
  open: () => void;
  refresh: () => void;
} {
  const { panel, getColors, onApply } = options;
  let root: HTMLElement | null = null;
  let tab: PaletteCategory = "common";
  let line: HTMLElement | null = null;
  let gallery: HTMLElement | null = null;
  let scroll: HTMLElement | null = null;
  let closing = false;

  const setJoined = (joined: boolean) => {
    panel.classList.toggle("is-shelf", joined);
  };

  const paintLine = (animate: boolean) => {
    if (!line) return;
    line.style.transition = animate ? "" : "none";
    line.style.transform = `translateX(${TABS.indexOf(tab) * 100}%)`;
    if (!animate) {
      line.getBoundingClientRect();
      line.style.transition = "";
    }
  };

  const paintTabs = () => {
    root?.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
      const on = button.dataset.tab === tab;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-selected", String(on));
    });
  };

  const paintGallery = () => {
    if (!gallery) return;
    const colors = getColors();
    gallery.replaceChildren();
    for (const preset of palettePresetsForCategory(tab)) {
      gallery.append(presetButton(preset, samePalette(colors, preset.colors)));
    }
  };

  const presetButton = (preset: PalettePreset, active: boolean) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `theme-gallery__item${active ? " is-active" : ""}`;
    item.setAttribute("role", "listitem");
    item.setAttribute("aria-pressed", String(active));
    item.setAttribute("aria-label", `Apply ${preset.label} palette`);

    const swatch = document.createElement("span");
    swatch.className = "theme-gallery__swatch";
    swatch.setAttribute("aria-hidden", "true");
    for (const color of sortColorsForPreview(preset.colors)) {
      const band = document.createElement("span");
      band.className = "theme-gallery__band";
      band.style.backgroundColor = color;
      swatch.append(band);
    }

    const label = document.createElement("span");
    label.className = "theme-gallery__label";
    label.textContent = preset.label;

    item.append(swatch, label);
    item.addEventListener("click", () => {
      onApply([...preset.colors], preset.stage);
      paintGallery();
    });
    return item;
  };

  const selectTab = (next: PaletteCategory) => {
    if (next === tab) return;
    tab = next;
    writeTab(tab);
    if (scroll) scroll.scrollTop = 0;
    paintTabs();
    paintGallery();
    paintLine(true);
  };

  const unmount = () => {
    root?.remove();
    root = null;
    line = null;
    gallery = null;
    scroll = null;
    closing = false;
    setJoined(false);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
  };

  const close = () => {
    if (!root || closing) return;
    closing = true;
    root.classList.remove("is-open");
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.setTimeout(() => {
      if (closing) unmount();
    }, SLIDE_MS + 40);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !root) return;
    if (document.querySelector(".color-pop")) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !root) return;
    if (target.closest(".theme-shelf, #view-themes")) return;
    event.preventDefault();
    event.stopPropagation();
    const swallow = (click: Event) => {
      click.preventDefault();
      click.stopPropagation();
    };
    document.addEventListener("click", swallow, { capture: true, once: true });
    close();
  };

  const onSlideEnd = (event: TransitionEvent) => {
    if (event.target !== root) return;
    if (event.propertyName !== "height") return;
    if (closing) unmount();
  };

  const armDismiss = () => {
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
  };

  const open = () => {
    if (root) {
      closing = false;
      root.classList.add("is-open");
      armDismiss();
      return;
    }
    tab = readTab();
    closing = false;

    root = document.createElement("aside");
    root.className = "theme-shelf";
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Colour themes");

    const inner = document.createElement("div");
    inner.className = "theme-shelf__inner";

    const head = document.createElement("header");
    head.className = "theme-shelf__head";
    const title = document.createElement("h2");
    title.className = "theme-shelf__title";
    title.textContent = "Pick a Theme";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "theme-shelf__x";
    dismiss.setAttribute("aria-label", "Close");
    dismiss.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6V4z"/></svg>';
    dismiss.addEventListener("click", close);
    head.append(title, dismiss);

    const tabs = document.createElement("div");
    tabs.className = "theme-shelf__tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Theme categories");
    for (const name of TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "theme-shelf__tab";
      button.dataset.tab = name;
      button.setAttribute("role", "tab");
      button.textContent = TAB_LABEL[name];
      button.addEventListener("click", () => selectTab(name));
      tabs.append(button);
    }
    line = document.createElement("span");
    line.className = "theme-shelf__line";
    line.setAttribute("aria-hidden", "true");
    tabs.append(line);

    scroll = document.createElement("div");
    scroll.className = "theme-shelf__scroll";
    gallery = document.createElement("div");
    gallery.className = "theme-gallery";
    gallery.setAttribute("role", "list");
    gallery.setAttribute("aria-label", "Palette presets");
    scroll.append(gallery);

    const foot = document.createElement("footer");
    foot.className = "theme-shelf__foot";
    const done = document.createElement("button");
    done.type = "button";
    done.className = "theme-shelf__done";
    done.textContent = "Close";
    done.addEventListener("click", close);
    foot.append(done);

    inner.append(frostPlate(), head, tabs, scroll, foot);
    root.append(inner);
    root.addEventListener("transitionend", onSlideEnd);
    root.addEventListener("pointerdown", (event) => event.stopPropagation());
    document.body.append(root);
    document.dispatchEvent(new Event("falldown-frost"));

    paintTabs();
    paintGallery();
    paintLine(false);
    setJoined(true);

    root.getBoundingClientRect();
    window.requestAnimationFrame(() => {
      if (!root || closing) return;
      root.classList.add("is-open");
      root.focus();
      armDismiss();
    });
  };

  return {
    open,
    refresh: () => {
      if (root && !closing) paintGallery();
    },
  };
}
