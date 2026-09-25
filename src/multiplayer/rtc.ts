/** WebRTC data-channel for low-latency gameplay. Signaling stays on PartyKit. */

export type SignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

type Handlers = {
  onMessage: (data: unknown) => void;
  onOpen: () => void;
  onClose: () => void;
};

const ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type PeerLink = {
  handleSignal: (signal: SignalPayload) => void;
  send: (msg: object) => boolean;
  close: () => void;
  ready: () => boolean;
};

/** Host (`offerer: true`) creates the data channel; guest waits for an offer. */
export function createPeerLink(
  offerer: boolean,
  sendSignal: (signal: SignalPayload) => void,
  handlers: Handlers,
): PeerLink {
  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let closed = false;
  let makingOffer = false;

  function ready() {
    return Boolean(channel && channel.readyState === "open");
  }

  function wireChannel(ch: RTCDataChannel) {
    channel = ch;
    ch.binaryType = "arraybuffer";
    ch.addEventListener("open", () => {
      if (!closed) handlers.onOpen();
    });
    ch.addEventListener("close", () => {
      if (!closed) handlers.onClose();
    });
    ch.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data)) as unknown;
        handlers.onMessage(data);
      } catch {
        /* ignore */
      }
    });
  }

  function ensurePc() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: ICE });
    pc.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        sendSignal({ kind: "ice", candidate: event.candidate.toJSON() });
      }
    });
    pc.addEventListener("connectionstatechange", () => {
      if (!pc) return;
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        handlers.onClose();
      }
    });
    pc.addEventListener("datachannel", (event) => {
      wireChannel(event.channel);
    });
    return pc;
  }

  async function startOffer() {
    if (closed || !offerer) return;
    const conn = ensurePc();
    if (!channel) {
      wireChannel(conn.createDataChannel("game", { ordered: true }));
    }
    makingOffer = true;
    try {
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      if (conn.localDescription) {
        sendSignal({ kind: "offer", sdp: conn.localDescription.toJSON() });
      }
    } finally {
      makingOffer = false;
    }
  }

  async function handleSignal(signal: SignalPayload) {
    if (closed) return;
    const conn = ensurePc();
    try {
      if (signal.kind === "offer") {
        if (offerer || makingOffer) return;
        await conn.setRemoteDescription(signal.sdp);
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        if (conn.localDescription) {
          sendSignal({ kind: "answer", sdp: conn.localDescription.toJSON() });
        }
      } else if (signal.kind === "answer") {
        if (!offerer) return;
        await conn.setRemoteDescription(signal.sdp);
      } else if (signal.kind === "ice") {
        try {
          await conn.addIceCandidate(signal.candidate);
        } catch {
          /* candidate may arrive before remote description */
        }
      }
    } catch {
      /* negotiation race — WS fallback still works */
    }
  }

  if (offerer) {
    void startOffer();
  } else {
    ensurePc();
  }

  return {
    handleSignal: (signal) => void handleSignal(signal),
    send(msg) {
      if (!ready() || !channel) return false;
      try {
        channel.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      closed = true;
      try {
        channel?.close();
      } catch {
        /* */
      }
      try {
        pc?.close();
      } catch {
        /* */
      }
      channel = null;
      pc = null;
    },
    ready,
  };
}
