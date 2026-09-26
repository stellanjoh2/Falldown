import gsap from "gsap";
import { getPrefs, setPrefs, type AppPrefs, type ChromeTheme } from "./prefs";
import {
  defaultPillFileName,
  downloadPillJson,
  isPillFile,
  readPillFile,
} from "./project/pillFormat";
import { checkInput } from "./checkBox";
import { playCaution, playNotify, playRemove, playSwitch, playTransition } from "./uiSounds";

export type SettingsController = {
  saveProject(): void;
  loadProject(file: File): Promise<void>;
  prefsChanged(): void;
};

let panelEl: HTMLElement | null = null;
let modalRoot: HTMLElement | null = null;
let closing = false;
let status = "";
let fileInput: HTMLInputElement | null = null;
let onKey: ((event: KeyboardEvent) => void) | null = null;

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setStatus(message: string) {
  status = message;
  const node = panelEl?.querySelector<HTMLElement>("#settings-status");
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function paintVolume() {
  const prefs = getPrefs();
  const input = panelEl?.querySelector<HTMLInputElement>("#settings-volume");
  const caption = panelEl?.querySelector("[data-range-label='settings-volume']");
  if (input) {
    input.value = String(prefs.soundVolume);
    input.disabled = !prefs.soundOn;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const pct = ((prefs.soundVolume - min) / (max - min || 1)) * 100;
    input.style.setProperty("--pct", `${pct}%`);
  }
  if (caption) caption.textContent = `Volume ${prefs.soundVolume}`;
}

function paintToggles() {
  const prefs = getPrefs();
  panelEl?.querySelectorAll<HTMLInputElement>("#settings-sound, #settings-tips, #settings-tooltips, #settings-remember, #settings-performance").forEach((input) => {
    if (input.id === "settings-sound") input.checked = prefs.soundOn;
    if (input.id === "settings-tips") input.checked = prefs.tipsOn;
    if (input.id === "settings-tooltips") input.checked = prefs.tooltipsOn;
    if (input.id === "settings-remember") input.checked = prefs.rememberLast;
    if (input.id === "settings-performance") input.checked = prefs.performance;
  });
  panelEl?.querySelectorAll<HTMLButtonElement>("[data-theme-chrome]").forEach((button) => {
    const on = button.dataset.themeChrome === prefs.theme;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  paintVolume();
}

function panelHtml(prefs: AppPrefs): string {
  return `
    <section class="section">
      <h2 data-tip="Editor chrome colors">UI theme</h2>
      <div class="segment" role="group" aria-label="UI theme">
        <button type="button" class="pill${prefs.theme === "night" ? " is-on" : ""}" data-theme-chrome="night" aria-pressed="${prefs.theme === "night"}" data-tip="Dark editor chrome">Night</button>
        <button type="button" class="pill${prefs.theme === "day" ? " is-on" : ""}" data-theme-chrome="day" aria-pressed="${prefs.theme === "day"}" data-tip="Light editor chrome">Day</button>
      </div>
    </section>
    <section class="section">
      <h2 data-tip="UI and impact sound effects">Sound</h2>
      <div class="check-row">
        <label class="check" data-tip="Play UI taps and fall impacts">
          ${checkInput(`id="settings-sound" ${prefs.soundOn ? "checked" : ""}`)}
          Sound
        </label>
      </div>
      <label class="field" data-tip="Master level for UI and impact sounds"><span data-range-label="settings-volume">Volume ${prefs.soundVolume}</span>
        <input type="range" id="settings-volume" min="0" max="100" step="1" value="${prefs.soundVolume}" ${prefs.soundOn ? "" : "disabled"} />
      </label>
    </section>
    <section class="section">
      <h2 data-tip="Helpful hints and hover labels">Guidance</h2>
      <div class="check-row">
        <label class="check" data-tip="Rotating Pro Tip cards in the corner">
          ${checkInput(`id="settings-tips" ${prefs.tipsOn ? "checked" : ""}`)}
          Tips
        </label>
      </div>
      <div class="check-row">
        <label class="check" data-tip="Hover labels on controls">
          ${checkInput(`id="settings-tooltips" ${prefs.tooltipsOn ? "checked" : ""}`)}
          Tooltips
        </label>
      </div>
    </section>
    <section class="section">
      <h2 data-tip="Lighter live bloom so piles stay smoother; exports stay full quality">Performance</h2>
      <div class="check-row">
        <label class="check" data-tip="Softens live bloom for smoother playback; exports stay full quality">
          ${checkInput(`id="settings-performance" ${prefs.performance ? "checked" : ""}`)}
          Performance mode
        </label>
      </div>
    </section>
    <section class="section">
      <h2 data-tip="Reopen your last unsaved session after a refresh">Session</h2>
      <div class="check-row">
        <label class="check" data-tip="Keep a draft and offer to reconnect after a refresh">
          ${checkInput(`id="settings-remember" ${prefs.rememberLast ? "checked" : ""}`)}
          Remember last
        </label>
      </div>
    </section>
    <section class="section">
      <h2 data-tip="Save or open slots, physics, look, background, and placements">Project</h2>
      <div class="export-list">
        <button type="button" class="pill" id="settings-save" data-tip="Download the scene as a .pill file">Save .pill</button>
        <button type="button" class="pill" id="settings-load" data-tip="Open a .pill scene file">Load .pill</button>
      </div>
      <p class="hint" id="settings-status"${status ? "" : " hidden"}>${status}</p>
    </section>
  `;
}

function bindCheck(panel: HTMLElement, id: string, key: keyof AppPrefs, controller: SettingsController) {
  panel.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    setPrefs({ [key]: input.checked } as Partial<AppPrefs>);
    playSwitch(input.checked);
    paintToggles();
    controller.prefsChanged();
  });
}

function mountSettingsBody(panel: HTMLElement, controller: SettingsController) {
  panelEl = panel;
  panel.innerHTML = panelHtml(getPrefs());
  paintToggles();

  bindCheck(panel, "settings-sound", "soundOn", controller);
  bindCheck(panel, "settings-tips", "tipsOn", controller);
  bindCheck(panel, "settings-tooltips", "tooltipsOn", controller);
  bindCheck(panel, "settings-remember", "rememberLast", controller);
  bindCheck(panel, "settings-performance", "performance", controller);

  panel.querySelector<HTMLInputElement>("#settings-volume")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    setPrefs({ soundVolume: Number(input.value) });
    paintVolume();
  });

  panel.querySelectorAll<HTMLButtonElement>("[data-theme-chrome]").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = (button.dataset.themeChrome === "day" ? "day" : "night") as ChromeTheme;
      if (getPrefs().theme === theme) return;
      setPrefs({ theme });
      playSwitch(theme === "day");
      paintToggles();
      controller.prefsChanged();
    });
  });

  panel.querySelector("#settings-save")?.addEventListener("click", () => {
    try {
      controller.saveProject();
      setStatus(`Saved ${defaultPillFileName()}`);
      playNotify();
    } catch {
      setStatus("Could not save the project.");
      playCaution();
    }
  });

  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".pill,application/x-ultrapilled-project";
    fileInput.className = "bg-file";
    fileInput.hidden = true;
    document.body.append(fileInput);
  }

  fileInput.onchange = () => {
    const file = fileInput?.files?.[0];
    if (fileInput) fileInput.value = "";
    if (!file) return;
    if (!isPillFile(file)) {
      setStatus("Only .pill files can be loaded.");
      playCaution();
      return;
    }
    void (async () => {
      try {
        await controller.loadProject(file);
        setStatus(`Loaded ${file.name}`);
        playNotify();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not load this .pill file.");
        playCaution();
      }
    })();
  };

  panel.querySelector("#settings-load")?.addEventListener("click", () => {
    fileInput?.click();
  });
}

export function isSettingsOpen(): boolean {
  return Boolean(modalRoot);
}

export function closeSettings(): void {
  if (!modalRoot || closing) return;
  closing = true;
  const root = modalRoot;
  const scrim = root.querySelector<HTMLElement>(".settings-modal__scrim");
  const sheet = root.querySelector<HTMLElement>(".settings-modal__sheet");
  if (onKey) window.removeEventListener("keydown", onKey);
  onKey = null;
  playRemove();

  const done = () => {
    root.remove();
    modalRoot = null;
    panelEl = null;
    closing = false;
  };

  if (reducedMotion() || !scrim || !sheet) {
    done();
    return;
  }

  const tl = gsap.timeline({ onComplete: done });
  tl.to(sheet, { x: 48, autoAlpha: 0, duration: 0.28, ease: "power2.in" }, 0);
  tl.to(scrim, { autoAlpha: 0, duration: 0.28, ease: "power1.in" }, 0);
}

export function openSettings(controller: SettingsController): void {
  if (modalRoot || closing) return;

  const root = document.createElement("div");
  root.className = "settings-modal";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "settings-modal-title");
  root.innerHTML = `
    <div class="settings-modal__scrim" data-settings-close></div>
    <div class="settings-modal__sheet">
      <header class="settings-modal__head">
        <h2 class="settings-modal__title" id="settings-modal-title">Settings</h2>
      </header>
      <div class="settings-modal__body" id="settings-modal-body"></div>
      <footer class="settings-modal__foot">
        <button type="button" class="pill is-on settings-modal__done" data-settings-close data-tip="Close settings">Done</button>
      </footer>
    </div>
  `;

  const scrim = root.querySelector<HTMLElement>(".settings-modal__scrim")!;
  const sheet = root.querySelector<HTMLElement>(".settings-modal__sheet")!;
  const body = root.querySelector<HTMLElement>(".settings-modal__body")!;
  const doneBtn = root.querySelector<HTMLButtonElement>(".settings-modal__done")!;

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("[data-settings-close]")) closeSettings();
  });

  onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
    }
  };
  window.addEventListener("keydown", onKey);

  document.body.append(root);
  modalRoot = root;
  mountSettingsBody(body, controller);
  playTransition(true);
  doneBtn.focus({ preventScroll: true });

  gsap.set(scrim, { autoAlpha: 0 });
  gsap.set(sheet, { autoAlpha: 0, x: 56 });

  if (reducedMotion()) {
    gsap.set([scrim, sheet], { clearProps: "all", autoAlpha: 1, x: 0 });
    return;
  }

  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.to(scrim, { autoAlpha: 1, duration: 0.32 }, 0);
  tl.to(sheet, { autoAlpha: 1, x: 0, duration: 0.42 }, 0.04);
}

export { readPillFile, downloadPillJson, defaultPillFileName };
