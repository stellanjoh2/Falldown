import { playSound, unlockAudio, type SoundPlayback } from "@/lib/sound-engine";
import type { SoundAsset } from "@/lib/sound-types";
import { getPrefs, onPrefsChange } from "./prefs";
import { drop001Sound } from "@/sounds/drop-001";
import { drop002Sound } from "@/sounds/drop-002";
import { drop004Sound } from "@/sounds/drop-004";

/** Collapse same-tick requests; block another play shortly after. */
const SOUND_LOCK_MS = 50;

/** Shape-fall impacts stay on Soundcn drops (drop-004 weighted twice). */
const IMPACT_POOL: SoundAsset[] = [drop004Sound, drop002Sound, drop004Sound, drop001Sound];

/** SND01 sine UI pack under public/sounds. */
const S = (name: string) => `/sounds/${name}.wav`;

const TAP_URLS = [S("tap_01"), S("tap_02"), S("tap_03"), S("tap_04"), S("tap_05")];
const TYPE_URLS = [S("type_01"), S("type_02"), S("type_03"), S("type_04"), S("type_05")];

const impactBySlot = new Map<string, string>();

let pendingUri: string | null = null;
let pendingVolume = 1;
let flushQueued = false;
let lockedUntil = 0;
let unlockBound = false;
/** Forced mute (e.g. audio-react mic). Overrides user sound prefs. */
let forceMuted = false;
let soundOn = getPrefs().soundOn;
let soundVolume = getPrefs().soundVolume;
let typeBound = false;
let progressPlayback: SoundPlayback | null = null;

onPrefsChange(() => {
  const prefs = getPrefs();
  soundOn = prefs.soundOn;
  soundVolume = prefs.soundVolume;
  if (!soundOn || soundVolume <= 0 || forceMuted) stopProgress();
});

/** When true, all UI / impact SFX are skipped (e.g. audio-react mic is on). */
export function setUiSoundsMuted(next: boolean) {
  forceMuted = next;
  pendingUri = null;
  stopProgress();
}

function audible(): boolean {
  return !forceMuted && soundOn && soundVolume > 0;
}

function gain(volume: number): number {
  return volume * (soundVolume / 100);
}

function pick(urls: string[]): string {
  return urls[Math.floor(Math.random() * urls.length)]!;
}

function requestPlay(src: string, volume = 1) {
  if (!audible()) return;
  pendingUri = src;
  pendingVolume = volume;
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    if (!audible()) {
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
    void playSound(uri, { volume: gain(vol) });
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

/** Light UI press (random tap). */
export function playClick() {
  requestPlay(pick(TAP_URLS));
}

/** Trigger Physics primary control. */
export function playButton() {
  requestPlay(S("notification"));
}

/** Add / upload / duplicate. */
export function playCreate() {
  requestPlay(S("select"));
}

/** Impact for a slot’s assigned drop sound. `bounceIndex` 0 = first hit. */
export function playImpact(slotId: string, bounceIndex: number, speedFactor: number) {
  const bounceVol = bounceIndex <= 0 ? 1 : bounceIndex === 1 ? 0.5 : 0.25;
  const volume = Math.max(0.15, Math.min(1, bounceVol * speedFactor));
  requestPlay(impactUriForSlot(slotId), volume);
}

/** Remove / dismiss / deselect. */
export function playRemove() {
  requestPlay(S("transition_down"));
}

/** Soft success (clipboard, quick confirm). */
export function playNotify() {
  requestPlay(S("notification"));
}

/** Bigger success (export finished). */
export function playCelebrate() {
  requestPlay(S("celebration"));
}

/** Error / cancel / warning. */
export function playCaution() {
  requestPlay(S("caution"));
}

/** Checkbox / boolean control. */
export function playSwitch(on = true) {
  requestPlay(on ? S("toggle_on") : S("toggle_off"));
}

/** Slot accordion open / close. */
export function playTransition(up: boolean) {
  requestPlay(up ? S("transition_up") : S("transition_down"));
}

/** Tab change / hide UI / invert — same light tap as other UI. */
export function playSwipe() {
  playClick();
}

export function playInvert() {
  playClick();
}

/** Disabled control feedback. */
export function playDisabled() {
  requestPlay(S("disabled"));
}

/** Random typewriter click; overlaps allowed so rapid typing still feels dense. */
export function playType() {
  if (!audible()) return;
  void playSound(pick(TYPE_URLS), { volume: gain(0.7) });
}

/** Looping bed while a long export runs. */
export function startProgress() {
  if (!audible()) return;
  stopProgress();
  void playSound(S("progress_loop"), { volume: gain(0.35), loop: true }).then((playback) => {
    if (!audible()) {
      playback.stop();
      return;
    }
    progressPlayback = playback;
  });
}

export function stopProgress() {
  progressPlayback?.stop();
  progressPlayback = null;
}

function isTypingField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    const type = target.type;
    return type === "text" || type === "search" || type === "password" || type === "";
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
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

/** Sine taps / button on interactive UI presses. */
export function bindUiClickSounds(root: ParentNode = document) {
  bindAudioUnlock();
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest("button, [role='button']");
      if (!(el instanceof HTMLElement)) return;
      if (el instanceof HTMLButtonElement && el.disabled) {
        playDisabled();
        return;
      }
      if (el.getAttribute("aria-disabled") === "true") {
        playDisabled();
        return;
      }
      // Explicit sounds elsewhere (tabs, slot accordion, Trigger Physics, mic).
      if (el.id === "play" || el.id === "audio-mic") return;
      if (el.classList.contains("panel-tabs__tab")) return;
      if (el.classList.contains("slot-toggle")) return;
      playClick();
    },
    true,
  );
}

/** Random type sound on text / contenteditable input (panel + canvas). */
export function bindUiTypeSounds(root: ParentNode = document) {
  if (typeBound) return;
  typeBound = true;
  bindAudioUnlock();
  root.addEventListener(
    "input",
    (event) => {
      if (!isTypingField(event.target)) return;
      playType();
    },
    true,
  );
}
