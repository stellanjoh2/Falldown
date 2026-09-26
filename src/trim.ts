import type { Slot } from "./types";

export type ImageTrim = {
  ratioW: number;
  ratioH: number;
  displaySrc: string;
  /** Intrinsic pixel size of the source (for import sizing). */
  nativeW: number;
  nativeH: number;
};

const ready = new Map<string, ImageTrim>();
const pending = new Map<string, Promise<ImageTrim | null>>();

export function peekTrim(src: string): ImageTrim | undefined {
  return ready.get(src);
}

export function ensureTrim(src: string, name = ""): Promise<ImageTrim | null> {
  if (!src) return Promise.resolve(null);
  const cached = ready.get(src);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(src);
  if (inflight) return inflight;

  const work = computeTrim(src, name).then((result) => {
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
      .map((slot) => ensureTrim(slot.src, slot.name)),
  ).then(() => undefined);
}

function isSvgSrc(src: string, name = ""): boolean {
  return (
    /\.svg$/i.test(name) ||
    src.startsWith("data:image/svg") ||
    src.includes("image/svg+xml") ||
    /\.svg(\?|$)/i.test(src)
  );
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

async function readSvg(src: string): Promise<string | null> {
  const inline = decodeSvgDataUri(src);
  if (inline && /<svg[\s>]/i.test(inline)) return inline;
  try {
    const text = await (await fetch(src)).text();
    return /<svg[\s>]/i.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** Masks rasterize an SVG at its width and height, so a 64px file goes soft when scaled up. */
function sharpSvg(
  xml: string,
  crop: { nx: number; ny: number; nw: number; nh: number } | null,
): string | null {
  const box = parseViewBox(xml);
  if (!box || box.w <= 0 || box.h <= 0) return null;
  const nx = crop?.nx ?? 0;
  const ny = crop?.ny ?? 0;
  const nw = crop?.nw ?? 1;
  const nh = crop?.nh ?? 1;
  const viewBox = `${box.x + nx * box.w} ${box.y + ny * box.h} ${nw * box.w} ${nh * box.h}`;
  const long = Math.max(nw * box.w, nh * box.h) || 1;
  const width = Math.max(1, Math.round(((nw * box.w) / long) * 2048));
  const height = Math.max(1, Math.round(((nh * box.h) / long) * 2048));
  const rewritten = xml.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    let rest = String(attrs)
      .replace(/\swidth\s*=\s*(["']).*?\1/i, "")
      .replace(/\sheight\s*=\s*(["']).*?\1/i, "")
      .replace(/\sviewBox\s*=\s*(["']).*?\1/i, "");
    rest = rest.replace(/\sstyle\s*=\s*(["'])(.*?)\1/i, (_style, quote: string, style: string) => {
      const cleaned = style
        .replace(/(?:^|;)\s*width\s*:[^;]*/gi, "")
        .replace(/(?:^|;)\s*height\s*:[^;]*/gi, "")
        .replace(/^;+|;+$/g, "")
        .trim();
      return cleaned ? ` style=${quote}${cleaned}${quote}` : "";
    });
    return `<svg${rest} viewBox="${viewBox}" width="${width}" height="${height}">`;
  });
  if (!rewritten.includes("viewBox=")) return null;
  return `data:image/svg+xml;utf8,${encodeURIComponent(rewritten)}`;
}

async function computeTrim(src: string, name = ""): Promise<ImageTrim | null> {
  try {
    const img = await loadImage(src);
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return null;

    const probeScale = Math.min(1, 128 / Math.max(naturalW, naturalH));
    const w = Math.max(1, Math.round(naturalW * probeScale));
    const h = Math.max(1, Math.round(naturalH * probeScale));

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
    if (maxX < 0) {
      if (!isSvgSrc(src, name)) return null;
      const xml = await readSvg(src);
      const display = xml ? sharpSvg(xml, null) : null;
      const box = xml ? parseViewBox(xml) : null;
      if (!display || !box) return null;
      return {
        ratioW: box.w,
        ratioH: box.h,
        displaySrc: display,
        nativeW: box.w,
        nativeH: box.h,
      };
    }

    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(w - 1, maxX + 1);
    maxY = Math.min(h - 1, maxY + 1);

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    if (isSvgSrc(src, name)) {
      const xml = await readSvg(src);
      const display = xml
        ? sharpSvg(xml, { nx: minX / w, ny: minY / h, nw: cropW / w, nh: cropH / h })
        : null;
      const box = xml ? parseViewBox(xml) : null;
      if (display) {
        const nativeW = box ? box.w * (cropW / w) : naturalW * (cropW / w);
        const nativeH = box ? box.h * (cropH / h) : naturalH * (cropH / h);
        return { ratioW: cropW, ratioH: cropH, displaySrc: display, nativeW, nativeH };
      }
    }

    const svg = isSvgSrc(src, name);
    if (!svg && minX === 0 && minY === 0 && maxX === w - 1 && maxY === h - 1) {
      return { ratioW: naturalW, ratioH: naturalH, displaySrc: src, nativeW: naturalW, nativeH: naturalH };
    }

    const sx = Math.max(0, Math.floor(minX / probeScale));
    const sy = Math.max(0, Math.floor(minY / probeScale));
    const sw = Math.min(naturalW - sx, Math.max(1, Math.ceil(cropW / probeScale)));
    const sh = Math.min(naturalH - sy, Math.max(1, Math.ceil(cropH / probeScale)));
    const down = svg ? 2048 / Math.max(sw, sh) : Math.min(1, 4096 / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * down));
    const outH = Math.max(1, Math.round(sh * down));

    const crop = document.createElement("canvas");
    crop.width = outW;
    crop.height = outH;
    const cropCtx = crop.getContext("2d");
    if (!cropCtx) return null;
    cropCtx.imageSmoothingEnabled = true;
    cropCtx.imageSmoothingQuality = "high";
    cropCtx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    return {
      ratioW: sw,
      ratioH: sh,
      displaySrc: crop.toDataURL("image/png"),
      nativeW: sw,
      nativeH: sh,
    };
  } catch {
    return null;
  }
}
