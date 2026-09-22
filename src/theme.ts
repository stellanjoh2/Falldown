export type ColorTheme = [string, string, string, string];

export const DEFAULT_THEME: ColorTheme = ["#c8c8c8", "#39ff14", "#2f3bff", "#ffffff"];

function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function pickTheme(theme: ColorTheme, index: number): string {
  return theme[index % theme.length];
}

export function inkOn(fill: string): string {
  const [r, g, b] = parseHex(fill);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#111111" : "#ffffff";
}
