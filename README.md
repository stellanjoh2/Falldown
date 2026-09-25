# Ultrapilled

A standalone physics playground for text chips and icons. Built on [Matter.js](https://brm.io/matter-js/).

## Run

```bash
npm install
npm run dev
```

For multiplayer (invite link / find player), run the realtime server too:

```bash
npm run dev:all
```

Or in two terminals: `npm run dev` and `npm run dev:party`.

## Use

1. Add text slots (typeface, colors, pill / box / no holding shape, box radius).
2. Add icon slots from presets or upload SVG / PNG / JPG.
3. Tune gravity, speed, and bounciness.
4. Hit **Play** — everything drops from above.
5. Optional: **Host** (copies an invite link) or **Join** (paste a friend’s link) for 2-person physics.

## Sounds

UI sounds come from [Soundcn](https://www.soundcn.xyz/?category=UI) — self-contained TypeScript modules played via the Web Audio API (`src/lib/sound-engine.ts`). Add sounds with:

```bash
npx shadcn add https://soundcn.xyz/r/<sound-name>.json
```

