import { GALLERY_SHAPE_PATHS, GALLERY_SHAPE_VIEWBOX } from "./mosaikShapes";

export type IconPreset = {
  id: string;
  label: string;
  src: string;
};

const FILL = "#ff4dff";

function svgMarkup(inner: string, viewBox: number): string {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}">${inner}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;
}

function pathIcon(d: string): string {
  return svgMarkup(
    `<path fill="${FILL}" fill-rule="evenodd" d="${d}"/>`,
    GALLERY_SHAPE_VIEWBOX,
  );
}

/** First row of Mosaik's shape library (inline SVGs in ControlsPanel). */
const PRIMITIVES: IconPreset[] = [
  {
    id: "block",
    label: "Boxes",
    src: svgMarkup(`<rect x="2" y="2" width="20" height="20" fill="${FILL}"/>`, 24),
  },
  {
    id: "sphere",
    label: "Spheres",
    src: svgMarkup(`<circle cx="12" cy="12" r="11" fill="${FILL}"/>`, 24),
  },
  {
    id: "triangle",
    label: "Triangles",
    src: svgMarkup(`<polygon points="2,2 22,2 22,22" fill="${FILL}"/>`, 24),
  },
  {
    id: "ring",
    label: "Rings",
    src: svgMarkup(
      `<circle cx="12" cy="12" r="9.5" fill="none" stroke="${FILL}" stroke-width="5"/>`,
      24,
    ),
  },
];

const GALLERY_LABELS: Record<keyof typeof GALLERY_SHAPE_PATHS, string> = {
  wedges: "Wedges",
  spots: "Spots",
  quads: "Quads",
  checks: "Checks",
  clover: "Clovers",
  dots: "Dots",
  ex: "Xs",
  arcs: "Arcs",
  star: "Stars",
  bloom: "Blooms",
  flower: "Flowers",
  blossom: "Blossoms",
  moons: "Moons",
  steps: "Steps",
  chevrons: "Chevrons",
  gates: "Gates",
  waves: "Waves",
  arches: "Arches",
  tiles: "Tiles",
  scallops: "Scallops",
};

const GALLERY_ORDER = [
  "wedges",
  "spots",
  "quads",
  "checks",
  "clover",
  "dots",
  "ex",
  "arcs",
  "star",
  "bloom",
  "flower",
  "blossom",
  "moons",
  "steps",
  "chevrons",
  "gates",
  "waves",
  "arches",
  "tiles",
  "scallops",
] as const;

export const ICON_PRESETS: IconPreset[] = [
  ...PRIMITIVES,
  ...GALLERY_ORDER.map((id) => ({
    id,
    label: GALLERY_LABELS[id],
    src: pathIcon(GALLERY_SHAPE_PATHS[id]),
  })),
];
