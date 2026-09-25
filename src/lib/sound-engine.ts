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

export async function decodeAudioData(dataUri: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(dataUri);
  if (cached) return cached;

  const ctx = ensureContext();
  const bytes = base64Bytes(dataUri);
  const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
  bufferCache.set(dataUri, audioBuffer);
  return audioBuffer;
}

export interface PlaySoundOptions {
  volume?: number;
  playbackRate?: number;
  onEnd?: () => void;
}

export interface SoundPlayback {
  stop: () => void;
}

export async function playSound(
  dataUri: string,
  options: PlaySoundOptions = {},
): Promise<SoundPlayback> {
  const noop = { stop: () => {} };
  if (!unlocked) {
    // Avoid creating/resuming AudioContext outside a gesture (autoplay policy).
    return noop;
  }

  const { volume = 1, playbackRate = 1, onEnd } = options;
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
    buffer = await decodeAudioData(dataUri);
  } catch {
    return noop;
  }

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();

  source.buffer = buffer;
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
