import type { AppState } from "../types";
import type { ChipDraw } from "../world";
import { exportGif, exportMov, exportMp4, exportSequence, exportStill, type LoopResult } from "./exportMedia";
import { ExportCancelled } from "./simulate";
import {
  frameSize,
  GIF_PRESETS,
  SIZE_PRESETS,
  type FrameRate,
  type GifPreset,
  type LoopCount,
  type SizePreset,
} from "./size";
import { playNotify, playRemove } from "../uiSounds";

export type ExportController = {
  prepare(): Promise<void>;
  stageSize(): { width: number; height: number; scale: number };
  draws(): ChipDraw[];
  state(): AppState;
};

type ExportKind = "png" | "png-alpha" | "png-seq" | "jpg" | "jpg-seq" | "mp4" | "gif" | "mov" | "mov-alpha";

let frameRate: FrameRate = 30;
let loops: LoopCount = 1;
let sizePreset: SizePreset = "screen";
let gifPreset: GifPreset = "480p";
let busy = false;
let cancelRequested = false;
let lastStatus = "";
let panelEl: HTMLElement | null = null;
let mountAbort = new AbortController();

function setStatus(message: string) {
  lastStatus = message;
  const node = panelEl?.querySelector("#export-status");
  if (node) node.textContent = message;
}

function applyBusy() {
  panelEl?.querySelectorAll<HTMLButtonElement>("[data-export], [data-fps], [data-loops]").forEach((button) => {
    button.disabled = busy;
  });
  panelEl?.querySelectorAll<HTMLSelectElement>("select").forEach((select) => {
    select.disabled = busy;
  });
  const cancel = panelEl?.querySelector<HTMLButtonElement>("#export-cancel");
  if (cancel) cancel.hidden = !busy;
}

function paintChoices() {
  panelEl?.querySelectorAll<HTMLButtonElement>("[data-fps]").forEach((button) => {
    const on = Number(button.dataset.fps) === frameRate;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  panelEl?.querySelectorAll<HTMLButtonElement>("[data-loops]").forEach((button) => {
    const on = Number(button.dataset.loops) === loops;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  });
}

function sizeLine(controller: ExportController, preset: SizePreset | GifPreset): string {
  const stage = controller.stageSize();
  const { width, height } = frameSize(stage.width, stage.height, preset);
  return `${width}×${height}`;
}

function paintSizes(controller: ExportController) {
  const size = panelEl?.querySelector("#export-size-meta");
  const gif = panelEl?.querySelector("#gif-size-meta");
  if (size) size.textContent = sizeLine(controller, sizePreset);
  if (gif) gif.textContent = sizeLine(controller, gifPreset);
}

function doneMessage(note: LoopResult, fps: FrameRate): string {
  const count = `${note.frames} ${note.frames === 1 ? "frame" : "frames"} at ${fps} fps`;
  if (note.truncated) return `Exported ${count}. GIF stopped early so the tab could encode it.`;
  if (note.limited) return `Exported ${count}. Stopped at the frame limit.`;
  return `Exported ${count}.`;
}

function sizeLabel(preset: SizePreset): string {
  return preset === "screen" ? "Screen" : preset;
}

function panelHtml(): string {
  const sizes = SIZE_PRESETS.map(
    (preset) =>
      `<option value="${preset}"${preset === sizePreset ? " selected" : ""}>${sizeLabel(preset)}</option>`,
  ).join("");
  const gifs = GIF_PRESETS.map(
    (preset) => `<option value="${preset}"${preset === gifPreset ? " selected" : ""}>${preset}</option>`,
  ).join("");
  return `
    <section class="section">
      <h2>Frame rate</h2>
      <div class="segment" role="group" aria-label="Frame rate">
        <button type="button" class="pill${frameRate === 30 ? " is-on" : ""}" data-fps="30" aria-pressed="${frameRate === 30}">30 fps</button>
        <button type="button" class="pill${frameRate === 60 ? " is-on" : ""}" data-fps="60" aria-pressed="${frameRate === 60}">60 fps</button>
      </div>
      <h2>Loops</h2>
      <div class="segment" role="group" aria-label="Loops">
        <button type="button" class="pill${loops === 1 ? " is-on" : ""}" data-loops="1" aria-pressed="${loops === 1}">1 loop</button>
        <button type="button" class="pill${loops === 2 ? " is-on" : ""}" data-loops="2" aria-pressed="${loops === 2}">2 loops</button>
      </div>
      <label class="field">Resolution
        <select id="export-size">${sizes}</select>
      </label>
      <p class="hint" id="export-size-meta"></p>
      <p class="hint">Stills are the canvas right now. Sequences, MP4, GIF, and MOV render a new loop. 60 fps files are much larger.</p>
    </section>
    <section class="section">
      <h2>PNG</h2>
      <div class="export-list">
        <button type="button" class="pill" data-export="png">Export PNG frame</button>
        <button type="button" class="pill" data-export="png-alpha">Export transparent PNG</button>
        <button type="button" class="pill" data-export="png-seq">Export PNG sequence</button>
      </div>
    </section>
    <section class="section">
      <h2>JPG</h2>
      <div class="export-list">
        <button type="button" class="pill" data-export="jpg">Export JPG frame</button>
        <button type="button" class="pill" data-export="jpg-seq">Export JPG sequence</button>
      </div>
    </section>
    <section class="section">
      <h2>MP4</h2>
      <div class="export-list">
        <button type="button" class="pill" data-export="mp4">Export MP4</button>
      </div>
    </section>
    <section class="section">
      <h2>GIF</h2>
      <label class="field">Resolution
        <select id="gif-size">${gifs}</select>
      </label>
      <p class="hint" id="gif-size-meta"></p>
      <p class="hint">Same frame rate. If the loop is long, the GIF stops before it gets too large. The sequence and video keep the full loop.</p>
      <div class="export-list">
        <button type="button" class="pill" data-export="gif">Export GIF</button>
      </div>
    </section>
    <section class="section">
      <h2>MOV</h2>
      <div class="export-list">
        <button type="button" class="pill" data-export="mov">Export MOV</button>
        <button type="button" class="pill" data-export="mov-alpha">Export transparent MOV</button>
      </div>
    </section>
    <p class="hint" id="export-status" role="status"></p>
    <button type="button" class="pill" id="export-cancel" hidden>Cancel</button>
  `;
}

export function mountExportPanel(panel: HTMLElement, controller: ExportController, scroll: number) {
  panelEl = panel;
  panel.innerHTML = panelHtml();
  setStatus(lastStatus);
  paintChoices();
  paintSizes(controller);
  applyBusy();
  panel.scrollTop = scroll;

  mountAbort.abort();
  mountAbort = new AbortController();
  const signal = mountAbort.signal;
  window.addEventListener("resize", () => paintSizes(controller), { signal });

  panel.querySelectorAll<HTMLButtonElement>("[data-fps]").forEach((button) => {
    button.addEventListener("click", () => {
      frameRate = Number(button.dataset.fps) === 60 ? 60 : 30;
      paintChoices();
    }, { signal });
  });
  panel.querySelectorAll<HTMLButtonElement>("[data-loops]").forEach((button) => {
    button.addEventListener("click", () => {
      loops = Number(button.dataset.loops) === 2 ? 2 : 1;
      paintChoices();
    }, { signal });
  });
  panel.querySelector<HTMLSelectElement>("#export-size")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if ((SIZE_PRESETS as readonly string[]).includes(value)) sizePreset = value as SizePreset;
    paintSizes(controller);
  }, { signal });
  panel.querySelector<HTMLSelectElement>("#gif-size")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value === "480p" || value === "720p") gifPreset = value;
    paintSizes(controller);
  }, { signal });
  panel.querySelector("#export-cancel")?.addEventListener("click", () => {
    cancelRequested = true;
    setStatus("Cancelling…");
  }, { signal });
  panel.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-export]");
    if (!button || busy) return;
    const kind = button.dataset.export;
    if (!kind) return;
    void runExport(kind as ExportKind, controller);
  }, { signal });
}

async function runExport(kind: ExportKind, controller: ExportController) {
  if (busy) return;
  busy = true;
  cancelRequested = false;
  applyBusy();
  setStatus("Rendering…");
  const fps = frameRate;
  const loopCount = loops;
  const preset = sizePreset;
  const gif = gifPreset;
  try {
    await controller.prepare();
    if (cancelRequested) throw new ExportCancelled();
    const stage = controller.stageSize();
    if (stage.width < 2 || stage.height < 2) throw new Error("Export failed");
    const state = controller.state();
    const fitted = { ...state, masterScale: state.masterScale * (stage.scale || 1) };
    const progress = (message: string) => setStatus(message);
    const shouldStop = () => cancelRequested;

    if (kind === "png" || kind === "png-alpha" || kind === "jpg") {
      await exportStill({
        draws: controller.draws(),
        state,
        stageWidth: stage.width,
        stageHeight: stage.height,
        preset,
        kind: kind === "jpg" ? "jpg" : "png",
        transparent: kind === "png-alpha",
      });
      setStatus(kind === "jpg" ? "Exported JPG." : kind === "png-alpha" ? "Exported transparent PNG." : "Exported PNG.");
      playNotify();
      return;
    }

    const shared = {
      state: fitted,
      stageWidth: stage.width,
      stageHeight: stage.height,
      fps,
      loops: loopCount,
      shouldStop,
      onProgress: progress,
    };
    const note =
      kind === "png-seq"
        ? await exportSequence({ ...shared, preset, kind: "png", transparent: false })
        : kind === "jpg-seq"
          ? await exportSequence({ ...shared, preset, kind: "jpg", transparent: false })
          : kind === "mp4"
            ? await exportMp4({ ...shared, preset })
            : kind === "gif"
              ? await exportGif({ ...shared, preset: gif })
              : await exportMov({ ...shared, preset, transparent: kind === "mov-alpha" });
    setStatus(doneMessage(note, fps));
    playNotify();
  } catch (error) {
    if (error instanceof ExportCancelled || cancelRequested) {
      setStatus("Cancelled.");
      playRemove();
    } else {
      setStatus(error instanceof Error ? error.message : "Export failed");
      playRemove();
    }
  } finally {
    busy = false;
    cancelRequested = false;
    applyBusy();
  }
}
