import { measureEmojiBox } from "./emojis";
import { peekTrim } from "./trim";
import type { ImageSlot, Slot, TextSlot } from "./types";

export type ChipSize = { width: number; height: number };

const measureCtx = document.createElement("canvas").getContext("2d");

export function trackingEm(slider: number): number {
  return (slider / 50) * 0.02;
}

export function measureTextSlot(slot: TextSlot, pad = 1, tracking = 0.02): ChipSize {
  if (!measureCtx) return { width: 80, height: 40 };
  measureCtx.font = `700 ${slot.fontSize}px "${slot.fontFamily}", sans-serif`;
  const text = slot.text || " ";
  const metrics = measureCtx.measureText(text);
  const tracked = metrics.width + slot.fontSize * tracking * Math.max(0, text.length - 1);
  const bounds =
    (metrics.actualBoundingBoxLeft ?? 0) + (metrics.actualBoundingBoxRight ?? 0);
  const textW = Math.max(tracked, bounds);

  const padY =
    slot.shape === "none" ? 1 : Math.max(1, Math.round(slot.fontSize * 0.45 * pad));
  const height = Math.ceil(slot.fontSize + padY * 2);

  const extraX =
    slot.shape === "none" ? 2 : Math.max(0, Math.round(slot.fontSize * 0.85 * pad));
  const cap = slot.shape === "pill" ? height / 2 : 0;
  const padX = Math.max(extraX, cap, 4);

  return {
    width: Math.ceil(textW + padX * 2),
    height,
  };
}

export function measureImageSlot(slot: ImageSlot): ChipSize {
  const size = Math.max(24, slot.size);
  if (slot.emoji) return measureEmojiBox(slot.emoji, size);
  const trim = peekTrim(slot.src);
  if (!trim) return { width: size, height: size };
  const fit = size / Math.max(trim.ratioW, trim.ratioH);
  return {
    width: Math.max(8, Math.round(trim.ratioW * fit)),
    height: Math.max(8, Math.round(trim.ratioH * fit)),
  };
}

export function measureSlot(slot: Slot, pad = 1, tracking = 0.02): ChipSize {
  return slot.kind === "text" ? measureTextSlot(slot, pad, tracking) : measureImageSlot(slot);
}

export function scaleSlot(slot: Slot, scale: number): Slot {
  if (slot.kind === "text") {
    return {
      ...slot,
      fontSize: slot.fontSize * scale,
      radius: slot.radius * scale,
      stroke: slot.stroke * scale,
    };
  }
  return { ...slot, size: slot.size * scale };
}

export function cornerRadius(slot: Slot, size: ChipSize): number {
  if (slot.kind === "image") return 0;
  if (slot.shape === "none") return 0;
  if (slot.shape === "pill") return size.height / 2;
  const max = Math.min(size.width, size.height) / 2;
  return Math.min(max, Math.max(0, slot.radius));
}
