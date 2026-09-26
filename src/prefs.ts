export type ChromeTheme = "night" | "day";

export type AppPrefs = {
  soundOn: boolean;
  soundVolume: number;
  tipsOn: boolean;
  tooltipsOn: boolean;
  rememberLast: boolean;
  theme: ChromeTheme;
  performance: boolean;
};

const STORAGE_KEY = "falldown.prefs";

const DEFAULTS: AppPrefs = {
  soundOn: true,
  soundVolume: 80,
  tipsOn: true,
  tooltipsOn: true,
  rememberLast: true,
  theme: "night",
  performance: true,
};

function clampVolume(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function read(): AppPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppPrefs>;
    return {
      soundOn: parsed.soundOn !== false,
      soundVolume: clampVolume(Number(parsed.soundVolume ?? DEFAULTS.soundVolume)),
      tipsOn: parsed.tipsOn !== false,
      tooltipsOn: parsed.tooltipsOn !== false,
      rememberLast: parsed.rememberLast !== false,
      theme: parsed.theme === "day" ? "day" : "night",
      performance: typeof parsed.performance === "boolean" ? parsed.performance : DEFAULTS.performance,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = read();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota */
  }
}

function notify() {
  for (const listener of listeners) listener();
}

export function getPrefs(): AppPrefs {
  return { ...prefs };
}

export function onPrefsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPrefs(patch: Partial<AppPrefs>) {
  prefs = {
    ...prefs,
    ...patch,
    soundVolume:
      patch.soundVolume != null ? clampVolume(patch.soundVolume) : prefs.soundVolume,
    theme: patch.theme === "day" || patch.theme === "night" ? patch.theme : prefs.theme,
  };
  persist();
  applyChromeTheme(prefs.theme);
  notify();
}

/** Applies night/day chrome before first paint and after changes. */
export function applyChromeTheme(theme: ChromeTheme = prefs.theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "day" ? "light" : "dark";
}

applyChromeTheme();
