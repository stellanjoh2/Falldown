let audioContext: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
let unlocked = false;

function ensureContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/** Call from a user gesture so Chrome allows playback. */
export async function unlockAudio(): Promise<void> {
  const ctx = ensureContext();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }
  unlocked = ctx.state === "running";
}

export function getAudioContext(): AudioContext {
  return ensureContext();
}

function base64Bytes(dataUri: string): Uint8Array {
  const raw = dataUri.split(",")[1] ?? "";
  const base64 = raw.replace(/\s/g, "");
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function loadAudioBuffer(src: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(src);
  if (cached) return cached;

  const ctx = ensureContext();
  let bytes: ArrayBuffer;
  if (src.startsWith("data:")) {
    bytes = base64Bytes(src).buffer.slice(0) as ArrayBuffer;
  } else {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to fetch sound: ${src}`);
    bytes = await res.arrayBuffer();
  }
  const audioBuffer = await ctx.decodeAudioData(bytes);
  bufferCache.set(src, audioBuffer);
  return audioBuffer;
}

/** Decode a data URI or fetch/decode a URL path. */
export async function decodeAudioData(src: string): Promise<AudioBuffer> {
  return loadAudioBuffer(src);
}

export interface PlaySoundOptions {
  volume?: number;
  playbackRate?: number;
  loop?: boolean;
  onEnd?: () => void;
}

export interface SoundPlayback {
  stop: () => void;
}

export async function playSound(
  src: string,
  options: PlaySoundOptions = {},
): Promise<SoundPlayback> {
  const noop = { stop: () => {} };
  if (!unlocked) {
    // Avoid creating/resuming AudioContext outside a gesture (autoplay policy).
    return noop;
  }

  const { volume = 1, playbackRate = 1, loop = false, onEnd } = options;
  const ctx = ensureContext();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return noop;
    }
  }
  if (ctx.state !== "running") return noop;

  let buffer: AudioBuffer;
  try {
    buffer = await loadAudioBuffer(src);
  } catch {
    return noop;
  }

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();

  source.buffer = buffer;
  source.loop = loop;
  source.playbackRate.value = playbackRate;
  gain.gain.value = volume;

  source.connect(gain);
  gain.connect(ctx.destination);

  source.onended = () => {
    onEnd?.();
  };

  source.start(0);

  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        // No-op if already stopped.
      }
    },
  };
}
