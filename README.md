# Ultrapilled

A standalone physics playground for text chips and icons. Built on [Matter.js](https://brm.io/matter-js/).

## Run

```bash
npm install
npm run dev
```

## Use

1. Add text slots (typeface, colors, pill / box / no holding shape, box radius).
2. Add icon slots from presets or upload SVG / PNG / JPG.
3. Tune gravity, speed, and bounciness.
4. Hit **Trigger Physics** — everything drops from above.

## Sounds

**UI** — [SND01 "sine"](https://snd.dev/) by [Ayako Taniguchi](https://ayakotaniguchi.jp/) (`public/sounds/`). Free for personal and commercial use under [snd.dev Terms of Use](https://snd.dev/); do not redistribute the unprocessed assets alone or use them as an unprocessed sound logo / trademark.

**Shape impacts** — [Soundcn](https://www.soundcn.xyz/?category=UI) drop samples (embedded in `src/sounds/`), played via the Web Audio API (`src/lib/sound-engine.ts`). Add more with:

```bash
npx shadcn add https://soundcn.xyz/r/<sound-name>.json
```
