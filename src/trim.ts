import type { Slot } from "./types";

export type ImageTrim = {
  ratioW: number;
  ratioH: number;
  displaySrc: string;
};

const ready = new Map<string, ImageTrim>();
const pending = new Map<string, Promise<ImageTrim | null>>();

export function peekTrim(src: string): ImageTrim | undefined {
  return ready.get(src);
}

export function ensureTrim(src: string): Promise<ImageTrim | null> {
  if (!src) return Promise.resolve(null);
  const cached = ready.get(src);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(src);
  if (inflight) return inflight;

  const work = computeTrim(src).then((result) => {
    pending.delete(src);
    if (result) ready.set(src, result);
    return result;
  });
  pending.set(src, work);
  return work;
}

export function ensureTrims(slots: Slot[]): Promise<void> {
  return Promise.all(
    slots
      .filter((slot): slot is Extract<Slot, { kind: "image" }> => slot.kind === "image" && Boolean(slot.src) && !slot.emoji)
      .map((slot) => ensureTrim(slot.src)),
  ).then(() => undefined);
}

function isSvgSrc(src: string): boolean {
  return src.startsWith("data:image/svg") || src.includes("image/svg+xml") || /\.svg(\?|$)/i.test(src);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

function decodeSvgDataUri(src: string): string | null {
  if (!src.startsWith("data:image/svg")) return null;
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const meta = src.slice(0, comma);
  const payload = src.slice(comma + 1);
  if (meta.includes(";base64")) return atob(payload);
  return decodeURIComponent(payload);
}

function parseViewBox(svg: string): { x: number; y: number; w: number; h: number } | null {
  const vb = svg.match(/viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (vb) {
    return { x: Number(vb[1]), y: Number(vb[2]), w: Number(vb[3]), h: Number(vb[4]) };
  }
  const width = Number(svg.match(/<svg[^>]*\bwidth\s*=\s*["']([\d.]+)/i)?.[1]);
  const height = Number(svg.match(/<svg[^>]*\bheight\s*=\s*["']([\d.]+)/i)?.[1]);
  if (width && height) return { x: 0, y: 0, w: width, h: height };
  return null;
}

function cropSvgViewBox(
  src: string,
  nx: number,
  ny: number,
  nw: number,
  nh: number,
): string | null {
  const xml = decodeSvgDataUri(src);
  if (!xml) return null;
  const box = parseViewBox(xml);
  if (!box) return null;
  const viewBox = `${box.x + nx * box.w} ${box.y + ny * box.h} ${nw * box.w} ${nh * box.h}`;
  const cropped = xml.includes("viewBox")
    ? xml.replace(/viewBox\s*=\s*["'][^"']*["']/i, `viewBox="${viewBox}"`)
    : xml.replace(/<svg\b/i, `<svg viewBox="${viewBox}"`);
  return `data:image/svg+xml;utf8,${encodeURIComponent(cropped)}`;
}

async function computeTrim(src: string): Promise<ImageTrim | null> {
  try {
    const img = await loadImage(src);
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return null;

    const max = 128;
    const scale = max / Math.max(naturalW, naturalH);
    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] < 24) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;

    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(w - 1, maxX + 1);
    maxY = Math.min(h - 1, maxY + 1);

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const svgDisplay = isSvgSrc(src)
      ? cropSvgViewBox(src, minX / w, minY / h, cropW / w, cropH / h) ?? src
      : null;

    if (svgDisplay) {
      return { ratioW: cropW, ratioH: cropH, displaySrc: svgDisplay };
    }

    const crop = document.createElement("canvas");
    crop.width = cropW;
    crop.height = cropH;
    const cropCtx = crop.getContext("2d");
    if (!cropCtx) return null;
    cropCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    return {
      ratioW: cropW,
      ratioH: cropH,
      displaySrc: crop.toDataURL("image/png"),
    };
  } catch {
    return null;
  }
}
