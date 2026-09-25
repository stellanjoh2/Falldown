import { playSound, unlockAudio } from "@/lib/sound-engine";
import type { SoundAsset } from "@/lib/sound-types";
import { click002Sound } from "@/sounds/click-002";
import { confirmation001Sound } from "@/sounds/confirmation-001";
import { drop001Sound } from "@/sounds/drop-001";
import { drop002Sound } from "@/sounds/drop-002";
import { drop003Sound } from "@/sounds/drop-003";
import { drop004Sound } from "@/sounds/drop-004";
import { minimize006Sound } from "@/sounds/minimize-006";
import { switch002Sound } from "@/sounds/switch-002";

/** Collapse same-tick requests; block another play shortly after. */
const SOUND_LOCK_MS = 50;

/** Per-asset impact pool (drop-004 weighted twice). */
const IMPACT_POOL: SoundAsset[] = [drop004Sound, drop002Sound, drop004Sound, drop001Sound];

const impactBySlot = new Map<string, string>();

let pendingUri: string | null = null;
let pendingVolume = 1;
let flushQueued = false;
let lockedUntil = 0;
let unlockBound = false;
let muted = false;

/** When true, all UI / impact SFX are skipped (e.g. audio-react mic is on). */
export function setUiSoundsMuted(next: boolean) {
  muted = next;
  pendingUri = null;
}

function requestPlay(dataUri: string, volume = 1) {
  if (muted) return;
  pendingUri = dataUri;
  pendingVolume = volume;
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    if (muted) {
      pendingUri = null;
      return;
    }
    const uri = pendingUri;
    const vol = pendingVolume;
    pendingUri = null;
    pendingVolume = 1;
    if (!uri) return;
    const now = performance.now();
    if (now < lockedUntil) return;
    lockedUntil = now + SOUND_LOCK_MS;
    void playSound(uri, { volume: vol });
  });
}

function impactUriForSlot(slotId: string): string {
  let uri = impactBySlot.get(slotId);
  if (!uri) {
    uri = IMPACT_POOL[Math.floor(Math.random() * IMPACT_POOL.length)]!.dataUri;
    impactBySlot.set(slotId, uri);
  }
  return uri;
}

export function playClick() {
  requestPlay(click002Sound.dataUri);
}

export function playCreate() {
  requestPlay(drop003Sound.dataUri);
}

/** Impact for a slot’s assigned drop sound. `bounceIndex` 0 = first hit. */
export function playImpact(slotId: string, bounceIndex: number, speedFactor: number) {
  const bounceVol = bounceIndex <= 0 ? 1 : bounceIndex === 1 ? 0.5 : 0.25;
  const volume = Math.max(0.15, Math.min(1, bounceVol * speedFactor));
  requestPlay(impactUriForSlot(slotId), volume);
}

export function playRemove() {
  requestPlay(minimize006Sound.dataUri);
}

export function playNotify() {
  requestPlay(confirmation001Sound.dataUri);
}

export function playSwitch() {
  requestPlay(switch002Sound.dataUri);
}

export function playInvert() {
  playSwitch();
}

function bindAudioUnlock() {
  if (unlockBound) return;
  unlockBound = true;
  const unlock = () => {
    void unlockAudio();
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

/** Play click-002 on interactive UI presses (buttons / role=button). */
export function bindUiClickSounds(root: ParentNode = document) {
  bindAudioUnlock();
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest("button, [role='button']");
      if (!(el instanceof HTMLElement)) return;
      if (el instanceof HTMLButtonElement && el.disabled) return;
      if (el.getAttribute("aria-disabled") === "true") return;
      // undo/redo play inside undo()/redo() so keyboard gets the same sound
      if (el.id === "undo" || el.id === "redo") return;
      playClick();
    },
    true,
  );
}
