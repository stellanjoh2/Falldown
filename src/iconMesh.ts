import decomp from "poly-decomp";
import Matter from "matter-js";
import { ICON_PRESETS } from "./icons";
import { GALLERY_SHAPE_PATHS, GALLERY_SHAPE_VIEWBOX } from "./mosaikShapes";

const { Bodies, Body } = Matter;

type Pt = { x: number; y: number };

type RawPart =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "poly"; points: Pt[] };

type LocalPart =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "poly"; points: Pt[] };

const GRID = 128;
const presetBySrc = new Map(ICON_PRESETS.map((icon) => [icon.src, icon.id]));
const cache = new Map<string, LocalPart[]>();

const presetIds = new Set(ICON_PRESETS.map((icon) => icon.id));

export function presetIdForSrc(src: string): string | undefined {
  return presetBySrc.get(src);
}

export function isPresetId(id: string): boolean {
  return presetIds.has(id);
}

const presetMasks = new Map<string, Uint8Array>();

/** Pick the gallery collider whose silhouette overlaps the image the most. */
export function matchCollider(src: string): Promise<string> {
  return imageMask(src).then((mask) => {
    if (!mask) return "block";
    const fitted = cropMask(mask, GRID);
    let best = "block";
    let bestScore = -1;
    for (const icon of ICON_PRESETS) {
      const score = maskOverlap(fitted, presetMask(icon.id));
      if (score > bestScore) {
        best = icon.id;
        bestScore = score;
      }
    }
    return best;
  });
}

function presetMask(id: string): Uint8Array {
  const cached = presetMasks.get(id);
  if (cached) return cached;
  const mask = new Uint8Array(GRID * GRID);
  const paths = galleryPaths(id);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (filled(id, paths, (x + 0.5) / GRID, (y + 0.5) / GRID)) mask[y * GRID + x] = 1;
    }
  }
  const cropped = cropMask(mask, GRID);
  presetMasks.set(id, cropped);
  return cropped;
}

function cropMask(mask: Uint8Array, size: number): Uint8Array {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return mask;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width === size && height === size) return mask;
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = minY + Math.min(height - 1, Math.floor(((y + 0.5) * height) / size));
    for (let x = 0; x < size; x++) {
      const sx = minX + Math.min(width - 1, Math.floor(((x + 0.5) * width) / size));
      out[y * size + x] = mask[sy * size + sx];
    }
  }
  return out;
}

function maskOverlap(a: Uint8Array, b: Uint8Array): number {
  let shared = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    const onA = a[i] === 1;
    const onB = b[i] === 1;
    if (onA || onB) either++;
    if (onA && onB) shared++;
  }
  return either ? shared / either : 0;
}

function imageMask(src: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = GRID;
      canvas.height = GRID;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, GRID, GRID);
      const { data } = ctx.getImageData(0, 0, GRID, GRID);
      const mask = new Uint8Array(GRID * GRID);
      let marks = 0;
      for (let i = 0; i < mask.length; i++) {
        if (data[i * 4 + 3] < 24) continue;
        mask[i] = 1;
        marks++;
      }
      resolve(marks ? mask : null);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function createColliderBody(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Matter.IBodyDefinition,
): { body: Matter.Body; anchor: { x: number; y: number } } | null {
  if (!isPresetId(id) || width < 2 || height < 2) return null;
  const locals = localParts(id);
  if (!locals.length) return null;

  const props = { ...options, angle: 0, chamfer: undefined };
  const bodies = locals.flatMap((part) => worldParts(part, x, y, width, height, props));
  if (!bodies.length) return null;

  const body = bodies.length === 1 ? bodies[0] : Body.create({ ...props, parts: bodies });
  const center = boundsCenter(body);
  Body.setPosition(body, {
    x: body.position.x + (x - center.x),
    y: body.position.y + (y - center.y),
  });
  const placed = boundsCenter(body);
  return {
    body,
    anchor: { x: placed.x - body.position.x, y: placed.y - body.position.y },
  };
}

function covers(parts: RawPart[], u: number, v: number): boolean {
  for (const part of parts) {
    if (part.kind === "circle") {
      if (Math.hypot(u - part.x, v - part.y) <= part.r) return true;
    } else if (pointInPoly(part.points, u, v)) return true;
  }
  return false;
}

function localParts(id: string): LocalPart[] {
  const cached = cache.get(id);
  if (cached) return cached;
  const parts = normalize(meshInUnitSquare(id));
  cache.set(id, parts);
  return parts;
}

function worldParts(
  part: LocalPart,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Matter.IBodyDefinition,
): Matter.Body[] {
  if (part.kind === "circle") {
    const radius = part.r * (width + height) * 0.5;
    if (radius < 1) return [];
    return [Bodies.circle(x + part.x * width, y + part.y * height, radius, options)];
  }
  const points = part.points.map((p) => ({ x: x + p.x * width, y: y + p.y * height }));
  if (points.length < 3) return [];
  const center = polygonCentroid(points);
  const body = Bodies.fromVertices(center.x, center.y, [points], options, true, 0.01, 0, 0.01);
  return body?.vertices?.length ? [body] : [];
}

function boundsCenter(body: Matter.Body): Pt {
  const { min, max } = body.bounds;
  return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
}

function meshInUnitSquare(id: string): RawPart[] {
  const primitive = primitiveParts(id);
  if (primitive) return primitive;
  const paths = galleryPaths(id);
  if (!paths?.length) return [];
  return coarsen(paths, id);
}

/** Tight trace, then the outline nearest half the part count that still covers the icon. */
function coarsen(paths: Pt[][], id: string): RawPart[] {
  const tight = tightMesh(paths, id);
  if (tight.length <= 1) return tight;
  const tightVerts = vertCount(tight);
  let best = tight;
  let bestScore = coarseness(best, tight.length, tightVerts);
  for (const eps of [0.02, 0.03, 0.04, 0.055, 0.07]) {
    const next = buildMesh(paths, id, eps, 0.08);
    if (!next || next.length > tight.length) continue;
    const score = coarseness(next, tight.length, tightVerts);
    if (score < bestScore) {
      best = next;
      bestScore = score;
    }
  }
  return foldToward(paths, best, tight.length, tightVerts, 0.08);
}

function tightMesh(paths: Pt[][], id: string): RawPart[] {
  if (!interiorsOverlap(paths)) {
    const exact = mergeParts(paths.flatMap((loop) => exactLoop(loop, 0.012)));
    if (exact.length && pathMismatch(paths, exact) <= 0.025) return exact;
  }
  return mergeParts(rasterParts(id, 1.15 / GRID));
}

function buildMesh(paths: Pt[][], id: string, eps: number, missLimit: number): RawPart[] | null {
  if (!interiorsOverlap(paths)) {
    const exact = mergeParts(paths.flatMap((loop) => exactLoop(loop, eps)));
    if (exact.length && pathMismatch(paths, exact) <= missLimit) return exact;
  }
  const traced = mergeParts(rasterParts(id, eps));
  if (traced.length && pathMismatch(paths, traced) <= missLimit) return traced;
  return null;
}

function vertCount(parts: RawPart[]): number {
  return parts.reduce((sum, part) => sum + (part.kind === "circle" ? 0 : part.points.length), 0);
}

/** Lower is closer to half the tight mesh. Dropping far under half costs as much as staying full. */
function coarseness(parts: RawPart[], tightParts: number, tightVerts: number): number {
  const partRatio = parts.length / tightParts;
  const verts = vertCount(parts);
  const vertRatio = tightVerts > 0 ? verts / tightVerts : 1;
  return Math.abs(Math.log(partRatio / 0.5)) * 2 + Math.abs(Math.log(Math.max(vertRatio, 0.05) / 0.5));
}

function primitiveParts(id: string): RawPart[] | null {
  if (id === "block") {
    return [{
      kind: "poly",
      points: [
        { x: 2 / 24, y: 2 / 24 },
        { x: 22 / 24, y: 2 / 24 },
        { x: 22 / 24, y: 22 / 24 },
        { x: 2 / 24, y: 22 / 24 },
      ],
    }];
  }
  if (id === "sphere") return [{ kind: "circle", x: 0.5, y: 0.5, r: 11 / 24 }];
  if (id === "triangle") {
    return [{
      kind: "poly",
      points: [
        { x: 2 / 24, y: 2 / 24 },
        { x: 22 / 24, y: 2 / 24 },
        { x: 22 / 24, y: 22 / 24 },
      ],
    }];
  }
  if (id === "ring") {
    return annulus({ x: 0.5, y: 0.5, r: 12 / 24 }, { x: 0.5, y: 0.5, r: 7 / 24 }, 18);
  }
  return null;
}

function exactLoop(loop: Pt[], eps: number): RawPart[] {
  const circle = containedCircle(loop);
  if (circle) return [{ kind: "circle", ...circle }];
  const clipped = simplifyClosed(clipPoly(loop, 0, 0, 1, 1), eps);
  return clipped.length >= 3 ? decompose(clipped) : [];
}

function containedCircle(points: Pt[]): { x: number; y: number; r: number } | null {
  const circle = asCircle(points);
  if (!circle) return null;
  const pad = 0.012;
  if (circle.x - circle.r < -pad || circle.y - circle.r < -pad) return null;
  if (circle.x + circle.r > 1 + pad || circle.y + circle.r > 1 + pad) return null;
  return circle;
}

function interiorsOverlap(loops: Pt[][]): boolean {
  const boxes = loops.map(boundsOf);
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      const minX = Math.max(boxes[i].minX, boxes[j].minX);
      const minY = Math.max(boxes[i].minY, boxes[j].minY);
      const maxX = Math.min(boxes[i].maxX, boxes[j].maxX);
      const maxY = Math.min(boxes[i].maxY, boxes[j].maxY);
      if (maxX <= minX || maxY <= minY) continue;
      const steps = 5;
      for (let y = 0; y <= steps; y++) {
        for (let x = 0; x <= steps; x++) {
          const px = minX + ((maxX - minX) * x) / steps;
          const py = minY + ((maxY - minY) * y) / steps;
          if (pointInPoly(loops[i], px, py) && pointInPoly(loops[j], px, py)) return true;
        }
      }
    }
  }
  return false;
}

function rasterParts(id: string, eps: number): RawPart[] {
  const mask = raster(id);
  const loops = traceLoops(mask, GRID)
    .map((loop) => simplifyClosed(loop.map((p) => ({ x: p.x / GRID, y: p.y / GRID })), eps))
    .filter((loop) => loop.length >= 3 && Math.abs(signedArea(loop)) > 2 / (GRID * GRID));
  return loopsToParts(loops);
}

function raster(id: string): Uint8Array {
  const mask = new Uint8Array(GRID * GRID);
  const paths = galleryPaths(id);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const u = (x + 0.5) / GRID;
      const v = (y + 0.5) / GRID;
      if (filled(id, paths, u, v)) mask[y * GRID + x] = 1;
    }
  }
  return mask;
}

function galleryPaths(id: string): Pt[][] | null {
  if (!(id in GALLERY_SHAPE_PATHS)) return null;
  const d = GALLERY_SHAPE_PATHS[id as keyof typeof GALLERY_SHAPE_PATHS];
  return parsePath(d).map((loop) => loop.map((p) => ({
    x: p.x / GALLERY_SHAPE_VIEWBOX,
    y: p.y / GALLERY_SHAPE_VIEWBOX,
  })));
}

function filled(id: string, paths: Pt[][] | null, u: number, v: number): boolean {
  if (paths) {
    let hits = 0;
    for (const loop of paths) if (pointInPoly(loop, u, v)) hits++;
    return hits % 2 === 1;
  }
  if (id === "block") return u >= 2 / 24 && v >= 2 / 24 && u <= 22 / 24 && v <= 22 / 24;
  if (id === "sphere") return Math.hypot(u - 0.5, v - 0.5) <= 11 / 24;
  if (id === "triangle") {
    return pointInPoly(
      [
        { x: 2 / 24, y: 2 / 24 },
        { x: 22 / 24, y: 2 / 24 },
        { x: 22 / 24, y: 22 / 24 },
      ],
      u,
      v,
    );
  }
  if (id === "ring") {
    const dist = Math.hypot(u - 0.5, v - 0.5);
    return dist <= 12 / 24 && dist >= 7 / 24;
  }
  return false;
}

function loopsToParts(loops: Pt[][]): RawPart[] {
  const ranked = loops.map((points) => ({ points, area: Math.abs(signedArea(points)) }));
  const holes: { points: Pt[] }[] = [];
  const outers: { points: Pt[] }[] = [];
  for (const loop of ranked) {
    const c = polygonCentroid(loop.points);
    let depth = 0;
    for (const other of ranked) {
      if (other === loop || other.area <= loop.area) continue;
      if (pointInPoly(other.points, c.x, c.y)) depth++;
    }
    if (depth % 2 === 1) holes.push(loop);
    else outers.push(loop);
  }

  const parts: RawPart[] = [];
  const used = new Set<{ points: Pt[] }>();
  for (const outer of outers) {
    const mine = holes.filter((hole) => {
      if (used.has(hole)) return false;
      const c = polygonCentroid(hole.points);
      return pointInPoly(outer.points, c.x, c.y);
    });
    for (const hole of mine) used.add(hole);

    const outerCircle = asCircle(outer.points);
    if (outerCircle && mine.length === 1) {
      const innerCircle = asCircle(mine[0].points);
      if (
        innerCircle &&
        innerCircle.r < outerCircle.r * 0.92 &&
        Math.hypot(innerCircle.x - outerCircle.x, innerCircle.y - outerCircle.y) < outerCircle.r * 0.25
      ) {
        parts.push(...annulus(outerCircle, innerCircle, 16));
        continue;
      }
    }
    if (outerCircle && mine.length === 0) {
      parts.push({ kind: "circle", ...outerCircle });
      continue;
    }

    let outline = outer.points;
    for (const hole of mine) outline = bridgeHole(outline, hole.points);
    parts.push(...decompose(outline));
  }
  return parts;
}

function annulus(
  outer: { x: number; y: number; r: number },
  inner: { x: number; y: number; r: number },
  segments: number,
): RawPart[] {
  const parts: RawPart[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    parts.push({
      kind: "poly",
      points: [
        { x: inner.x + Math.cos(a0) * inner.r, y: inner.y + Math.sin(a0) * inner.r },
        { x: outer.x + Math.cos(a0) * outer.r, y: outer.y + Math.sin(a0) * outer.r },
        { x: outer.x + Math.cos(a1) * outer.r, y: outer.y + Math.sin(a1) * outer.r },
        { x: inner.x + Math.cos(a1) * inner.r, y: inner.y + Math.sin(a1) * inner.r },
      ],
    });
  }
  return parts;
}

function mergeParts(parts: RawPart[]): RawPart[] {
  const circles = parts.filter((part) => part.kind === "circle");
  let polys = parts.flatMap((part) => (part.kind === "poly" ? [part.points] : []));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < polys.length && !changed; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const merged = tryMerge(polys[i], polys[j]);
        if (!merged) continue;
        polys = [...polys.slice(0, i), ...polys.slice(i + 1, j), ...polys.slice(j + 1), merged];
        changed = true;
        break;
      }
    }
  }
  return [...circles, ...polys.map((points) => ({ kind: "poly" as const, points }))];
}

/** Merge convex pieces while that stays nearer half the tight mesh and inside the miss cap. */
function foldToward(
  paths: Pt[][],
  parts: RawPart[],
  tightParts: number,
  tightVerts: number,
  missCap: number,
): RawPart[] {
  let current = parts;
  let score = coarseness(current, tightParts, tightVerts);
  let changed = true;
  while (changed) {
    changed = false;
    const circles = current.filter((part) => part.kind === "circle");
    const polys = current.flatMap((part) => (part.kind === "poly" ? [part.points] : []));
    for (let i = 0; i < polys.length && !changed; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const hull = convexHull([...polys[i], ...polys[j]]);
        if (hull.length < 3) continue;
        const hullArea = Math.abs(signedArea(hull));
        const sum = Math.abs(signedArea(polys[i])) + Math.abs(signedArea(polys[j]));
        if (sum < 1e-6 || hullArea > sum * 1.08) continue;
        const nextPolys = [
          ...polys.slice(0, i),
          ...polys.slice(i + 1, j),
          ...polys.slice(j + 1),
          dropNear(hull, 1e-4),
        ];
        const next: RawPart[] = [
          ...circles,
          ...nextPolys.map((points) => ({ kind: "poly" as const, points })),
        ];
        if (pathMismatch(paths, next) > missCap) continue;
        const nextScore = coarseness(next, tightParts, tightVerts);
        if (nextScore >= score) continue;
        current = next;
        score = nextScore;
        changed = true;
      }
    }
  }
  return current;
}

function convexHull(points: Pt[]): Pt[] {
  const sorted = dropNear(points, 1e-4).sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function tryMerge(a: Pt[], b: Pt[]): Pt[] | null {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (!nearPt(a1, b2) || !nearPt(a2, b1)) continue;
      const poly: Pt[] = [];
      for (let k = 0; k < a.length; k++) poly.push(a[(i + 1 + k) % a.length]);
      for (let k = 1; k < b.length - 1; k++) poly.push(b[(j + 1 + k) % b.length]);
      const cleaned = dropNear(poly, 1e-4);
      if (cleaned.length >= 3 && isConvex(cleaned)) return cleaned;
    }
  }
  return null;
}

function nearPt(a: Pt, b: Pt): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-4;
}

function pathMismatch(paths: Pt[][], parts: RawPart[]): number {
  let samples = 0;
  let mismatch = 0;
  const step = 28;
  for (let y = 0; y < step; y++) {
    for (let x = 0; x < step; x++) {
      const u = (x + 0.5) / step;
      const v = (y + 0.5) / step;
      let hits = 0;
      for (const loop of paths) if (pointInPoly(loop, u, v)) hits++;
      if ((hits % 2 === 1) !== covers(parts, u, v)) mismatch++;
      samples++;
    }
  }
  return mismatch / samples;
}

function decompose(points: Pt[]): RawPart[] {
  const cleaned = dropNear(points, 0.001);
  if (cleaned.length < 3) return [];
  if (isConvex(cleaned)) return [{ kind: "poly", points: cleaned }];

  const pieces = decompPieces(cleaned);
  if (pieces.length && regionMismatch(cleaned, pieces) < 0.02) return pieces;
  const fan = fanParts(cleaned);
  if (fan && regionMismatch(cleaned, fan) < 0.02) return fan;
  if (pieces.length) return pieces;
  if (fan) return fan;
  return [{ kind: "poly", points: cleaned }];
}

function fanParts(points: Pt[]): RawPart[] | null {
  const c = polygonCentroid(points);
  if (!pointInPoly(points, c.x, c.y)) return null;
  const parts: RawPart[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const mid = { x: (c.x + a.x + b.x) / 3, y: (c.y + a.y + b.y) / 3 };
    if (!pointInPoly(points, mid.x, mid.y)) return null;
    if (Math.abs(signedArea([c, a, b])) < 1e-7) continue;
    parts.push({ kind: "poly", points: [c, a, b] });
  }
  return parts.length ? parts : null;
}

function regionMismatch(outline: Pt[], parts: RawPart[]): number {
  const box = boundsOf(outline);
  let samples = 0;
  let mismatch = 0;
  const step = 16;
  for (let y = 0; y < step; y++) {
    for (let x = 0; x < step; x++) {
      const px = box.minX + ((box.maxX - box.minX) * (x + 0.5)) / step;
      const py = box.minY + ((box.maxY - box.minY) * (y + 0.5)) / step;
      if (pointInPoly(outline, px, py) !== covers(parts, px, py)) mismatch++;
      samples++;
    }
  }
  return mismatch / samples;
}

function decompPieces(points: Pt[]): RawPart[] {
  const scale = 1000;
  const concave = points.map((p) => [p.x * scale, p.y * scale] as [number, number]);
  decomp.makeCCW(concave);
  decomp.removeDuplicatePoints(concave, 0.4);
  decomp.removeCollinearPoints(concave, 0.4);
  if (concave.length < 3) return [];

  let pieces: [number, number][][] = [];
  try {
    pieces = decomp.quickDecomp(concave);
  } catch {
    pieces = [];
  }
  return pieces
    .map((poly) => ({
      kind: "poly" as const,
      points: poly.map(([x, y]) => ({ x: x / scale, y: y / scale })),
    }))
    .filter((part) => part.points.length >= 3 && Math.abs(signedArea(part.points)) > 1e-5);
}

function bridgeHole(outer: Pt[], hole: Pt[]): Pt[] {
  if (hole.length < 3 || outer.length < 3) return outer;
  let best = Infinity;
  let hinge = 0;
  let edge = -1;
  let hit = hole[0];
  const step = Math.max(1, Math.floor(hole.length / 16));
  for (let h = 0; h < hole.length; h += step) {
    const p = hole[h];
    for (let i = 0; i < outer.length; i++) {
      const q = closestOnSegment(p, outer[i], outer[(i + 1) % outer.length]);
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      if (dist < best) {
        best = dist;
        hinge = h;
        edge = i;
        hit = q;
      }
    }
  }
  if (edge < 0) return outer;

  const slit = 0.004;
  const next: Pt[] = [];
  for (let i = 0; i <= edge; i++) next.push(outer[i]);
  next.push(hit);
  for (let i = 0; i <= hole.length; i++) next.push(hole[(hinge + i) % hole.length]);
  next.push({ x: hit.x, y: hit.y + slit });
  for (let i = edge + 1; i < outer.length; i++) next.push(outer[i]);
  return next;
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function clipPoly(poly: Pt[], minX: number, minY: number, maxX: number, maxY: number): Pt[] {
  const clip = (input: Pt[], inside: (p: Pt) => boolean, at: (a: Pt, b: Pt) => number) => {
    if (!input.length) return [];
    const out: Pt[] = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      const ain = inside(a);
      const bin = inside(b);
      if (bin) {
        if (!ain) out.push(lerp(a, b, at(a, b)));
        out.push(b);
      } else if (ain) out.push(lerp(a, b, at(a, b)));
    }
    return out;
  };
  let out = poly;
  out = clip(out, (p) => p.x >= minX, (a, b) => (minX - a.x) / (b.x - a.x || 1e-9));
  out = clip(out, (p) => p.x <= maxX, (a, b) => (maxX - a.x) / (b.x - a.x || 1e-9));
  out = clip(out, (p) => p.y >= minY, (a, b) => (minY - a.y) / (b.y - a.y || 1e-9));
  out = clip(out, (p) => p.y <= maxY, (a, b) => (maxY - a.y) / (b.y - a.y || 1e-9));
  return dropNear(out, 1e-4);
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function boundsOf(points: Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function asCircle(points: Pt[]): { x: number; y: number; r: number } | null {
  if (points.length < 10) return null;
  const c = polygonCentroid(points);
  const samples: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    samples.push(Math.hypot(a.x - c.x, a.y - c.y));
    samples.push(Math.hypot((a.x + b.x) / 2 - c.x, (a.y + b.y) / 2 - c.y));
  }
  const mean = samples.reduce((sum, r) => sum + r, 0) / samples.length;
  if (mean < 0.02) return null;
  for (const radius of samples) {
    if (Math.abs(radius - mean) / mean > 0.055) return null;
  }
  return { x: c.x, y: c.y, r: mean };
}

function normalize(parts: RawPart[]): LocalPart[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const part of parts) {
    if (part.kind === "circle") {
      grow(part.x - part.r, part.y - part.r);
      grow(part.x + part.r, part.y + part.r);
    } else {
      for (const p of part.points) grow(p.x, p.y);
    }
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (!(bw > 0) || !(bh > 0)) return [];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const square = Math.abs(bw - bh) / Math.max(bw, bh) < 0.04;

  return parts.flatMap((part): LocalPart[] => {
    if (part.kind === "circle" && square) {
      return [{
        kind: "circle",
        x: (part.x - cx) / bw,
        y: (part.y - cy) / bh,
        r: part.r / ((bw + bh) / 2),
      }];
    }
    const points = part.kind === "circle"
      ? circlePoly(part.x, part.y, part.r, 20)
      : part.points;
    return [{
      kind: "poly",
      points: points.map((p) => ({ x: (p.x - cx) / bw, y: (p.y - cy) / bh })),
    }];
  });
}

function circlePoly(cx: number, cy: number, r: number, count: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return points;
}

function traceLoops(mask: Uint8Array, n: number): Pt[][] {
  const outgoing = new Map<string, Pt[]>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const key = `${x1},${y1}`;
    const list = outgoing.get(key);
    const point = { x: x2, y: y2 };
    if (list) list.push(point);
    else outgoing.set(key, [point]);
  };
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && mask[y * n + x] === 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!on(x, y)) continue;
      if (!on(x - 1, y)) add(x, y, x, y + 1);
      if (!on(x + 1, y)) add(x + 1, y + 1, x + 1, y);
      if (!on(x, y - 1)) add(x + 1, y, x, y);
      if (!on(x, y + 1)) add(x, y + 1, x + 1, y + 1);
    }
  }

  const loops: Pt[][] = [];
  for (const [startKey, dests] of outgoing) {
    while (dests.length) {
      const start = parseKey(startKey);
      const first = dests.pop();
      if (!first) break;
      const loop = [start];
      let prev = start;
      let curr = first;
      for (let guard = 0; guard < n * n * 4; guard++) {
        loop.push(curr);
        if (curr.x === start.x && curr.y === start.y) break;
        const list = outgoing.get(`${curr.x},${curr.y}`);
        if (!list?.length) break;
        const next = takeTurn(prev, curr, list);
        prev = curr;
        curr = next;
      }
      if (
        loop.length > 3 &&
        loop[0].x === loop[loop.length - 1].x &&
        loop[0].y === loop[loop.length - 1].y
      ) {
        loop.pop();
        loops.push(loop);
      }
    }
  }
  return loops;
}

function takeTurn(prev: Pt, curr: Pt, options: Pt[]): Pt {
  const backX = prev.x - curr.x;
  const backY = prev.y - curr.y;
  let best = 0;
  let bestAngle = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const next = options[i];
    const cross = backX * (next.y - curr.y) - backY * (next.x - curr.x);
    const dot = backX * (next.x - curr.x) + backY * (next.y - curr.y);
    const angle = Math.atan2(cross, dot);
    if (angle > bestAngle) {
      bestAngle = angle;
      best = i;
    }
  }
  return options.splice(best, 1)[0];
}

function parseKey(key: string): Pt {
  const [x, y] = key.split(",");
  return { x: Number(x), y: Number(y) };
}

function parsePath(d: string): Pt[][] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
  const subpaths: Pt[][] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let current: Pt[] | null = null;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "M") {
      cx = num();
      cy = num();
      current = [{ x: cx, y: cy }];
      subpaths.push(current);
    } else if (cmd === "L") {
      cx = num();
      cy = num();
      current?.push({ x: cx, y: cy });
    } else if (cmd === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      const p0 = { x: cx, y: cy };
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        current?.push({
          x: u ** 3 * p0.x + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x,
          y: u ** 3 * p0.y + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y,
        });
      }
      cx = x;
      cy = y;
    } else if (cmd === "Z" && current && current.length > 1) {
      const first = current[0];
      const last = current[current.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 0.01) current.pop();
    }
  }
  return subpaths;
}

function simplifyClosed(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 5) return points;
  let far = 1;
  let best = -1;
  for (let i = 1; i < points.length; i++) {
    const d = (points[i].x - points[0].x) ** 2 + (points[i].y - points[0].y) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const head = rdp(points.slice(0, far + 1), epsilon);
  const tail = rdp([...points.slice(far), points[0]], epsilon);
  return dropNear([...head.slice(0, -1), ...tail.slice(0, -1)], epsilon * 0.35);
}

function rdp(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  let far = 0;
  let best = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = segmentDistance(points[i], a, b);
    if (dist > best) {
      best = dist;
      far = i;
    }
  }
  if (best <= epsilon) return [a, b];
  const left = rdp(points.slice(0, far + 1), epsilon);
  const right = rdp(points.slice(far), epsilon);
  return [...left.slice(0, -1), ...right];
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function dropNear(points: Pt[], min: number): Pt[] {
  const next: Pt[] = [];
  for (const p of points) {
    const prev = next[next.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > min) next.push(p);
  }
  if (next.length > 1 && Math.hypot(next[0].x - next[next.length - 1].x, next[0].y - next[next.length - 1].y) <= min) {
    next.pop();
  }
  return next;
}

function isConvex(points: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-8) continue;
    const s = Math.sign(cross);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return points.length >= 3;
}

function pointInPoly(points: Pt[], x: number, y: number): boolean {
  let hits = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hits++;
  }
  return hits % 2 === 1;
}

function signedArea(points: Pt[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return area / 2;
}

function polygonCentroid(points: Pt[]): Pt {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    area += cross;
    x += (points[j].x + points[i].x) * cross;
    y += (points[j].y + points[i].y) * cross;
  }
  if (Math.abs(area) < 1e-8) {
    const avg = points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
    return { x: avg.x / points.length, y: avg.y / points.length };
  }
  return { x: x / (3 * area), y: y / (3 * area) };
}
