import encode, { init } from "gifski-wasm";
import wasmUrl from "../../node_modules/gifski-wasm/pkg/gifski_wasm_bg.wasm?url";

type EncodeRequest = {
  frames: ArrayBuffer[];
  width: number;
  height: number;
  fps: number;
  quality: number;
};

const ready = init(wasmUrl);

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  try {
    await ready;
    const { frames, width, height, fps, quality } = event.data;
    const images = frames.map((buffer) => new Uint8Array(buffer));
    const bytes = await encode({
      frames: images,
      width,
      height,
      fps,
      resizeWidth: width,
      resizeHeight: height,
      quality,
    });
    const out = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ ok: true, bytes: out }, { transfer: [out] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GIF encode failed";
    self.postMessage({ ok: false, message });
  }
};
