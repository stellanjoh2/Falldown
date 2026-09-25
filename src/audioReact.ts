import { getAudioContext, unlockAudio } from "./lib/sound-engine";

export type AudioBands = {
  /** Overall level 0–1 after sensitivity. */
  level: number;
  /** Low-end energy 0–1 (kicks, rumble). */
  bass: number;
  /** High-end energy 0–1 (hats, claps, sharp hits). */
  sharp: number;
};

const FFT_SIZE = 1024;
/** ~20–150 Hz at 44.1 kHz with fftSize 1024. */
const BASS_BIN_END = 8;
/** ~2 kHz+ — transients and bright hits. */
const SHARP_BIN_START = 48;

let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let freqBuf: Uint8Array<ArrayBuffer> | null = null;
let starting: Promise<boolean> | null = null;

function bandMean(data: Uint8Array, from: number, to: number): number {
  const end = Math.min(to, data.length);
  const start = Math.max(0, Math.min(from, end));
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i]!;
  return sum / ((end - start) * 255);
}

export function isMicActive(): boolean {
  return Boolean(stream && analyser);
}

export async function startMic(): Promise<boolean> {
  if (isMicActive()) return true;
  if (starting) return starting;

  starting = (async () => {
    try {
      await unlockAudio();
      const ctx = getAudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      // Low smoothing so kicks still spike frame-to-frame.
      analyser.smoothingTimeConstant = 0.25;
      freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      return true;
    } catch {
      stopMic();
      return false;
    } finally {
      starting = null;
    }
  })();

  return starting;
}

export function stopMic(): void {
  starting = null;
  try {
    source?.disconnect();
  } catch {
    // already disconnected
  }
  source = null;
  analyser = null;
  freqBuf = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  resetOnset();
}

/**
 * Sample current mic spectrum.
 * `sensitivity` 0–100 raises quieter signals (higher = more reactive).
 */
export function sampleBands(sensitivity: number): AudioBands {
  if (!analyser || !freqBuf) return { level: 0, bass: 0, sharp: 0 };

  const ctx = getAudioContext();
  if (ctx.state === "suspended") void ctx.resume();

  analyser.getByteFrequencyData(freqBuf);
  const bass = bandMean(freqBuf, 1, BASS_BIN_END);
  const sharp = bandMean(freqBuf, SHARP_BIN_START, freqBuf.length);
  const mid = bandMean(freqBuf, BASS_BIN_END, SHARP_BIN_START);
  const raw = Math.max(bass, mid, sharp);

  const gain = 0.35 + (Math.min(100, Math.max(0, sensitivity)) / 100) * 2.4;
  const lift = (v: number) => Math.min(1, v * gain);

  return {
    level: lift(raw),
    bass: lift(bass),
    sharp: lift(sharp),
  };
}

/** Peak-hold envelopes — decay between hits so the next kick still registers. */
let envLevel = 0;
let envBass = 0;
let envSharp = 0;
/** How fast the hold falls (~per frame at 60fps). */
const ENV_DECAY = 0.92;

export type AudioOnset = AudioBands & {
  /** How hard this frame poked above the decaying envelope. */
  flux: number;
  bassFlux: number;
  sharpFlux: number;
};

export function sampleOnset(sensitivity: number): AudioOnset {
  const bands = sampleBands(sensitivity);
  const flux = Math.max(0, bands.level - envLevel);
  const bassFlux = Math.max(0, bands.bass - envBass);
  const sharpFlux = Math.max(0, bands.sharp - envSharp);
  envLevel = Math.max(bands.level, envLevel * ENV_DECAY);
  envBass = Math.max(bands.bass, envBass * ENV_DECAY);
  envSharp = Math.max(bands.sharp, envSharp * ENV_DECAY);
  return { ...bands, flux, bassFlux, sharpFlux };
}

export function resetOnset(): void {
  envLevel = 0;
  envBass = 0;
  envSharp = 0;
}
