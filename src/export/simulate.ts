import { canvasFrame } from "../canvas";
import type { AppState } from "../types";
import { paintFrame } from "./paint";
import { createWorld } from "../world";

const STEP_MS = 1000 / 60;
const MIN_CYCLE_MS = 1200;
const SETTLE_CONFIRM_MS = 900;
const MAX_FRAMES = 7200;

export class ExportCancelled extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelled";
  }
}

export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export async function renderLoop(options: {
  state: AppState;
  stageWidth: number;
  stageHeight: number;
  width: number;
  height: number;
  fps: 30 | 60;
  loops: 1 | 2;
  transparent: boolean;
  canvas?: HTMLCanvasElement;
  onFrame: (canvas: HTMLCanvasElement, index: number) => Promise<void | false> | void | false;
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
}): Promise<{ frames: number; limited: boolean }> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-16000px;top:0;width:${options.stageWidth}px;height:${options.stageHeight}px;overflow:hidden;pointer-events:none;opacity:0`;
  host.innerHTML = `<div class="chip-layer"></div><div class="bloom-layer"><div class="bloom-blur"></div></div>`;
  document.body.appendChild(host);

  const sim = createWorld({ paused: true });
  sim.setSimulationScale(canvasFrame(options.stageWidth, options.stageHeight, options.state.canvas).scale);
  const canvas = options.canvas ?? document.createElement("canvas");
  if (canvas.width !== options.width || canvas.height !== options.height) {
    canvas.width = options.width;
    canvas.height = options.height;
  }

  const stepsPerFrame = options.fps === 60 ? 1 : 2;
  const frameMs = stepsPerFrame * STEP_MS;
  const holdMs = options.state.physics.hold * 1000;

  let frames = 0;
  let limited = false;
  let timeMs = 0;

  try {
    const stageWidth = host.clientWidth || options.stageWidth;
    const stageHeight = host.clientHeight || options.stageHeight;
    if (stageWidth < 2 || stageHeight < 2) throw new Error("Export failed");
    const scene = {
      width: options.width,
      height: options.height,
      stageWidth,
      stageHeight,
      stageColor: options.state.stageColor,
      background: options.state.background,
      canvas: options.state.canvas,
      theme: options.state.theme,
      post: options.state.post,
      transparent: options.transparent,
    };

    for (let loop = 0; loop < options.loops; loop++) {
      if (options.shouldStop?.()) throw new ExportCancelled();
      sim.play(
        options.state.slots,
        options.state.physics,
        host,
        options.state.masterScale,
        options.state.theme,
        options.state.pillPad,
        options.state.textTracking,
        options.state.sizeRandom,
      );

      if (sim.chipCount() === 0) {
        await paintFrame(canvas, sim.draws(), scene, timeMs);
        if ((await options.onFrame(canvas, frames)) === false) return { frames, limited };
        frames += 1;
        timeMs += frameMs;
        options.onProgress?.(`Rendering frame ${frames}`);
        continue;
      }

      let phase: "falling" | "holding" = "falling";
      let elapsed = 0;
      let settledFor = 0;
      let holdFor = 0;

      while (true) {
        if (options.shouldStop?.()) throw new ExportCancelled();
        if (frames >= MAX_FRAMES) {
          limited = true;
          return { frames, limited };
        }

        for (let step = 0; step < stepsPerFrame; step++) sim.step(STEP_MS);
        sim.purgeFallen(stageHeight);
        await paintFrame(canvas, sim.draws(), scene, timeMs);
        if ((await options.onFrame(canvas, frames)) === false) return { frames, limited };
        frames += 1;
        timeMs += frameMs;
        options.onProgress?.(`Rendering frame ${frames}`);
        elapsed += frameMs;

        if (phase === "falling") {
          const settled = elapsed >= MIN_CYCLE_MS && sim.isSettled();
          if (settled && settledFor >= SETTLE_CONFIRM_MS) {
            phase = "holding";
            holdFor = 0;
          } else if (settled) {
            settledFor += frameMs;
          } else {
            settledFor = 0;
          }
        } else {
          holdFor += frameMs;
          if (holdFor >= holdMs) break;
        }

        await yieldToUi();
      }
    }
    return { frames, limited };
  } finally {
    sim.destroy();
    host.remove();
  }
}
