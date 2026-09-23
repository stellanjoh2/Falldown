import { zipSync } from "fflate";
import type { AppState } from "../types";
import type { ChipDraw } from "../world";
import { paintFrame } from "./paint";
import { renderLoop, yieldToUi } from "./simulate";
import { frameSize, type FrameRate, type GifPreset, type LoopCount, type SizePreset } from "./size";

const GIF_QUALITY = 90;

export type LoopResult = { frames: number; limited: boolean; truncated: boolean };

type LoopRequest = {
  state: AppState;
  stageWidth: number;
  stageHeight: number;
  width: number;
  height: number;
  fps: FrameRate;
  loops: LoopCount;
  transparent: boolean;
  canvas?: HTMLCanvasElement;
  onFrame: (canvas: HTMLCanvasElement, index: number) => Promise<void | false> | void | false;
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Export failed"));
    }, type, quality);
  });
}

function frameName(index: number, ext: string): string {
  return `falldown-frame${String(index).padStart(4, "0")}.${ext}`;
}

function sceneOf(
  state: AppState,
  stageWidth: number,
  stageHeight: number,
  width: number,
  height: number,
  transparent: boolean,
) {
  return {
    width,
    height,
    stageWidth,
    stageHeight,
    stageColor: state.stageColor,
    background: state.background,
    canvas: state.canvas,
    theme: state.theme,
    post: state.post,
    transparent,
  };
}

export async function exportStill(options: {
  draws: ChipDraw[];
  state: AppState;
  stageWidth: number;
  stageHeight: number;
  preset: SizePreset;
  kind: "png" | "jpg";
  transparent: boolean;
}): Promise<void> {
  const { width, height } = frameSize(options.stageWidth, options.stageHeight, options.preset);
  const canvas = document.createElement("canvas");
  await paintFrame(
    canvas,
    options.draws,
    sceneOf(options.state, options.stageWidth, options.stageHeight, width, height, options.transparent),
  );
  if (options.kind === "jpg") {
    downloadBlob(await canvasBlob(canvas, "image/jpeg", 0.92), "falldown.jpg");
    return;
  }
  downloadBlob(
    await canvasBlob(canvas, "image/png"),
    options.transparent ? "falldown-transparent.png" : "falldown.png",
  );
}

async function runLoop(options: LoopRequest): Promise<{ frames: number; limited: boolean }> {
  return renderLoop(options);
}

export async function exportSequence(options: {
  state: AppState;
  stageWidth: number;
  stageHeight: number;
  preset: SizePreset;
  kind: "png" | "jpg";
  transparent: boolean;
  fps: FrameRate;
  loops: LoopCount;
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
}): Promise<LoopResult> {
  const { width, height } = frameSize(options.stageWidth, options.stageHeight, options.preset);
  const ext = options.kind === "jpg" ? "jpg" : "png";
  const type = options.kind === "jpg" ? "image/jpeg" : "image/png";
  const files: Record<string, Uint8Array> = {};
  const result = await runLoop({
    state: options.state,
    stageWidth: options.stageWidth,
    stageHeight: options.stageHeight,
    width,
    height,
    fps: options.fps,
    loops: options.loops,
    transparent: options.kind === "png" && options.transparent,
    shouldStop: options.shouldStop,
    onProgress: options.onProgress,
    onFrame: async (canvas, index) => {
      const blob = await canvasBlob(canvas, type, options.kind === "jpg" ? 0.92 : undefined);
      files[frameName(index, ext)] = new Uint8Array(await blob.arrayBuffer());
    },
  });
  if (result.frames === 0) throw new Error("Export failed");
  options.onProgress?.("Packaging…");
  await yieldToUi();
  const zipped = zipSync(files, { level: 0 });
  const copy = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
  downloadBlob(new Blob([copy]), options.kind === "jpg" ? "falldown-jpg.zip" : "falldown-png.zip");
  return { ...result, truncated: false };
}

async function exportVideo(options: {
  state: AppState;
  stageWidth: number;
  stageHeight: number;
  preset: SizePreset;
  fps: FrameRate;
  loops: LoopCount;
  transparent: boolean;
  format: "mp4" | "mov";
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
}): Promise<LoopResult> {
  const { width, height } = frameSize(options.stageWidth, options.stageHeight, options.preset);
  const {
    Output,
    Mp4OutputFormat,
    MovOutputFormat,
    BufferTarget,
    CanvasSource,
    Quality,
    canEncodeVideo,
  } = await import("mediabunny");

  const quality = new Quality("high");
  const codec = options.transparent
    ? await (async () => {
        for (const next of ["prores", "hevc", "vp9"] as const) {
          if (await canEncodeVideo(next, { alpha: "keep", quality, width, height })) return next;
        }
        throw new Error("Transparent MOV needs a browser codec with alpha (ProRes, HEVC, or VP9)");
      })()
    : "avc";
  if (!options.transparent && !(await canEncodeVideo("avc", { width, height }))) {
    throw new Error(
      options.format === "mp4"
        ? "MP4 export needs H.264 in this browser"
        : "MOV export needs H.264 in this browser",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const output = new Output({
    format: options.format === "mp4" ? new Mp4OutputFormat() : new MovOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, {
    codec,
    quality,
    keyFrameInterval: 1 / options.fps,
    ...(options.transparent ? { alpha: "keep" as const } : {}),
  });
  output.addVideoTrack(video, { frameRate: options.fps });
  await output.start();

  try {
    const frameDuration = 1 / options.fps;
    const result = await runLoop({
      state: options.state,
      stageWidth: options.stageWidth,
      stageHeight: options.stageHeight,
      width,
      height,
      fps: options.fps,
      loops: options.loops,
      transparent: options.transparent,
      canvas,
      shouldStop: options.shouldStop,
      onProgress: options.onProgress,
      onFrame: async (_frame, index) => {
        await video.add(index * frameDuration, frameDuration);
      },
    });
    if (result.frames === 0) throw new Error("Export failed");
    options.onProgress?.("Packaging…");
    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Export failed");
    const filename = options.transparent ? "falldown-transparent.mov" : `falldown.${options.format}`;
    const mime = options.format === "mp4" ? "video/mp4" : "video/quicktime";
    downloadBlob(new Blob([buffer], { type: mime }), filename);
    return { ...result, truncated: false };
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
}

export function exportMp4(options: {
  state: AppState;
  stageWidth: number;
  stageHeight: number;
  preset: SizePreset;
  fps: FrameRate;
  loops: LoopCount;
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
}): Promise<LoopResult> {
  return exportVideo({ ...options, format: "mp4", transparent: false });
}

export function exportMov(options: {
  state: AppState;
  stageWidth: number;
  stageHeight: number;
  preset: SizePreset;
  fps: FrameRate;
  loops: LoopCount;
  transparent: boolean;
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
}): Promise<LoopResult> {
  return exportVideo({ ...options, format: "mov" });
}

type GifWorkerResult = { ok: true; bytes: ArrayBuffer } | { ok: false; message: string };

function encodeGif(frames: ImageData[], width: number, height: number, fps: FrameRate): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./gifskiEncoder.worker.ts", import.meta.url), { type: "module" });
    const buffers = frames.map((frame) => frame.data.buffer);
    if (buffers.length === 1) buffers.push(buffers[0].slice(0));
    worker.onmessage = (event: MessageEvent<GifWorkerResult>) => {
      worker.terminate();
      if (event.data.ok) {
        resolve(new Uint8Array(event.data.bytes));
        return;
      }
      reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("GIF export failed"));
    };
    worker.postMessage({ frames: buffers, width, height, fps, quality: GIF_QUALITY }, buffers);
  });
}

export async function exportGif(options: {
  state: AppState;
  stageWidth: number;
  stageHeight: number;
  preset: GifPreset;
  fps: FrameRate;
  loops: LoopCount;
  shouldStop?: () => boolean;
  onProgress?: (message: string) => void;
}): Promise<LoopResult> {
  const { width, height } = frameSize(options.stageWidth, options.stageHeight, options.preset);
  const frames: ImageData[] = [];
  const result = await runLoop({
    state: options.state,
    stageWidth: options.stageWidth,
    stageHeight: options.stageHeight,
    width,
    height,
    fps: options.fps,
    loops: options.loops,
    transparent: false,
    shouldStop: options.shouldStop,
    onProgress: options.onProgress,
    onFrame: (canvas) => {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("GIF export failed");
      frames.push(ctx.getImageData(0, 0, width, height));
    },
  });
  if (frames.length === 0) throw new Error("GIF export failed");
  options.onProgress?.("Encoding GIF…");
  await yieldToUi();
  const bytes = await encodeGif(frames, width, height, options.fps);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  downloadBlob(new Blob([copy], { type: "image/gif" }), "falldown.gif");
  return { frames: frames.length, limited: result.limited, truncated: false };
}
