import type { WorldHandle, SpawnSpec } from "../world";
import { connectRoom, newRoomId, type RoomClient } from "./client";
import type { SyncedDoc } from "./doc";
import { loadIdentity, promptIdentity, type Identity } from "./identity";
import { mountPresence, type PresenceHandle } from "./presence";
import type { ChipPose, ClientToRoom } from "./protocol";
import { createPeerLink, type PeerLink, type SignalPayload } from "./rtc";

export type MultiplayerSession = {
  isActive: () => boolean;
  isHost: () => boolean;
  /** Host snapshots + guest interpolation. No-op when offline. */
  tick: (dtMs: number) => void;
  broadcastSpawn: (specs: SpawnSpec[]) => void;
  broadcastClear: () => void;
  broadcastDoc: (doc: SyncedDoc) => void;
  requestHostPlay: () => boolean;
  destroy: () => void;
};

export type MultiplayerUi = {
  setStatus: (text: string) => void;
  setRoom: (roomId: string | null, link: string | null) => void;
  setBusy: (busy: boolean) => void;
};

type MountOpts = {
  stage: HTMLElement;
  playfield: HTMLElement;
  world: WorldHandle;
  ui: MultiplayerUi;
  onHostPlay: () => void;
  onRemoteSpawn: (specs: SpawnSpec[]) => void;
  onRemoteClear: () => void;
  onRemoteDoc: (doc: SyncedDoc) => void;
  getDoc: () => SyncedDoc;
};

type GameMsg =
  | { type: "cursor"; id?: string; x: number; y: number }
  | { type: "grabStart"; id?: string; key: string; x: number; y: number }
  | { type: "grabMove"; id?: string; x: number; y: number }
  | { type: "grabEnd"; id?: string }
  | { type: "snapshot"; chips: ChipPose[] }
  | { type: "spawn"; specs: SpawnSpec[] }
  | { type: "clear" }
  | { type: "playRequest" };

export function mountMultiplayer(opts: MountOpts) {
  const { stage, playfield, world, ui } = opts;
  let room: RoomClient | null = null;
  let presence: PresenceHandle | null = null;
  let peer: PeerLink | null = null;
  let you: string | null = null;
  let hostId: string | null = null;
  let roomId: string | null = null;
  let lastSnap = 0;
  let lastCursorAt = 0;
  let lastSpawn: SpawnSpec[] | null = null;
  let peerCount = 0;
  let pendingSignals: SignalPayload[] = [];

  function isHost() {
    return Boolean(you && hostId && you === hostId);
  }

  function isActive() {
    return Boolean(room);
  }

  function applyRole() {
    world.setNetMode(isHost() ? "host" : room ? "guest" : "solo");
  }

  function roomUrl(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", id);
    return url.toString();
  }

  /** Gameplay over PartyKit WS (reliable). RTC is a bonus fast path for snapshots/cursors. */
  function sendGame(msg: ClientToRoom) {
    if (msg.type === "cursor" && you) {
      const stamped = { ...msg, id: you };
      if (peer?.send(stamped)) return;
      room?.send(msg);
      return;
    }
    if (msg.type === "snapshot") {
      if (peer?.send(msg)) return;
      room?.send(msg);
      return;
    }
    // Grabs / spawn / clear must hit the host — always WS.
    room?.send(msg);
  }

  function handleGame(msg: GameMsg) {
    switch (msg.type) {
      case "cursor": {
        if (!msg.id) return;
        const w = playfield.clientWidth;
        const h = playfield.clientHeight;
        presence?.setCursor(msg.id, playfield.offsetLeft + msg.x * w, playfield.offsetTop + msg.y * h);
        break;
      }
      case "grabStart":
        if (!isHost() || !msg.key) return;
        world.beginRemoteDrag(msg.key, msg.x * playfield.clientWidth, msg.y * playfield.clientHeight);
        break;
      case "grabMove":
        if (!isHost()) return;
        world.moveRemoteDrag(msg.x * playfield.clientWidth, msg.y * playfield.clientHeight);
        break;
      case "grabEnd":
        if (!isHost()) return;
        world.endRemoteDrag();
        break;
      case "snapshot": {
        if (isHost()) return;
        const w = playfield.clientWidth;
        const h = playfield.clientHeight;
        world.applyNetSnapshot(
          msg.chips.map((c) => ({
            ...c,
            x: c.x * w,
            y: c.y * h,
          })),
        );
        break;
      }
      case "spawn":
        if (isHost()) return;
        opts.onRemoteSpawn(
          msg.specs.map((s) => ({
            ...s,
            x: s.x * playfield.clientWidth,
            y: s.y * playfield.clientHeight,
          })),
        );
        break;
      case "clear":
        if (isHost()) return;
        opts.onRemoteClear();
        break;
      case "playRequest":
        if (isHost()) opts.onHostPlay();
        break;
    }
  }

  function closePeer() {
    peer?.close();
    peer = null;
    pendingSignals = [];
  }

  function startPeer() {
    if (!room || !you || peerCount < 1) return;
    // Keep an existing link — recreating on every presence ping drops grabs mid-drag.
    if (peer) return;
    const queued = pendingSignals;
    pendingSignals = [];
    const offerer = isHost();
    peer = createPeerLink(
      offerer,
      (signal) => room?.send({ type: "signal", signal }),
      {
        onMessage(data) {
          if (!data || typeof data !== "object" || !("type" in data)) return;
          handleGame(data as GameMsg);
        },
        onOpen() {
          if (peerCount > 0) ui.setStatus(isHost() ? "P2P linked — hosting" : "P2P linked");
        },
        onClose() {
          peer = null;
        },
      },
    );
    for (const signal of queued) peer.handleSignal(signal);
  }

  function onStageCursor(event: PointerEvent) {
    if (!room || !playfield) return;
    const now = performance.now();
    if (now - lastCursorAt < 16) return;
    lastCursorAt = now;
    const rect = playfield.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < -0.05 || y < -0.05 || x > 1.05 || y > 1.05) return;
    sendGame({ type: "cursor", x, y });
  }

  stage.addEventListener("pointermove", onStageCursor);

  function tearDownRoom() {
    closePeer();
    room?.close();
    room = null;
    presence?.destroy();
    presence = null;
    you = null;
    hostId = null;
    roomId = null;
    lastSpawn = null;
    peerCount = 0;
    world.setNetMode("solo");
    world.setNetGrabHandler(null);
    ui.setRoom(null, null);
    ui.setBusy(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function enterRoom(id: string, identity: Identity) {
    tearDownRoom();
    roomId = id;
    presence = mountPresence(stage);
    ui.setBusy(true);
    ui.setStatus("Connecting…");
    ui.setRoom(id, roomUrl(id));

    let welcomed = false;
    const connectTimer = window.setTimeout(() => {
      if (welcomed || roomId !== id) return;
      ui.setStatus("Couldn’t connect — is the party server running?");
      tearDownRoom();
    }, 8000);

    room = connectRoom(
      id,
      {
        onWelcome(self, host, list) {
          welcomed = true;
          window.clearTimeout(connectTimer);
          you = self;
          hostId = host;
          presence?.setPlayers(list, self);
          applyRole();
          ui.setBusy(false);
          ui.setStatus(isHost() ? "Hosting — send the link to a friend" : "Joined");
          world.setNetGrabHandler((kind, key, x, y) => {
            if (!room || isHost()) return;
            const w = Math.max(1, playfield.clientWidth);
            const h = Math.max(1, playfield.clientHeight);
            const nx = x / w;
            const ny = y / h;
            if (kind === "start" && key) sendGame({ type: "grabStart", key, x: nx, y: ny });
            else if (kind === "move") sendGame({ type: "grabMove", x: nx, y: ny });
            else if (kind === "end") sendGame({ type: "grabEnd" });
          });
        },
        onPlayers(host, list) {
          hostId = host;
          presence?.setPlayers(list, you);
          applyRole();
          const peers = list.filter((p) => p.id !== you);
          peerCount = peers.length;
          if (peers.length) {
            ui.setStatus(`With ${peers.map((p) => `${p.avatar} ${p.name}`).join(", ")}`);
            startPeer();
            if (isHost()) {
              room?.send({ type: "doc", doc: opts.getDoc() });
              if (lastSpawn?.length) {
                const w = Math.max(1, playfield.clientWidth);
                const h = Math.max(1, playfield.clientHeight);
                sendGame({
                  type: "spawn",
                  specs: lastSpawn.map((s) => ({ ...s, x: s.x / w, y: s.y / h })),
                });
              }
            }
          } else {
            closePeer();
            if (isHost()) ui.setStatus("Hosting — waiting for a friend");
          }
        },
        onCursor(id, x, y) {
          handleGame({ type: "cursor", id, x, y });
        },
        onGrabStart(id, key, x, y) {
          handleGame({ type: "grabStart", id, key, x, y });
        },
        onGrabMove(id, x, y) {
          handleGame({ type: "grabMove", id, x, y });
        },
        onGrabEnd(id) {
          handleGame({ type: "grabEnd", id });
        },
        onSnapshot(chips) {
          handleGame({ type: "snapshot", chips });
        },
        onSpawn(specs) {
          handleGame({ type: "spawn", specs });
        },
        onClear() {
          handleGame({ type: "clear" });
        },
        onPlayRequest() {
          handleGame({ type: "playRequest" });
        },
        onDoc(doc) {
          opts.onRemoteDoc(doc as SyncedDoc);
        },
        onSignal(signal) {
          const payload = signal as SignalPayload;
          if (peer) peer.handleSignal(payload);
          else pendingSignals.push(payload);
        },
        onRoomFull() {
          welcomed = true;
          window.clearTimeout(connectTimer);
          ui.setStatus("That room is full (2 people max)");
          tearDownRoom();
        },
        onError() {},
        onClose() {
          if (!welcomed) return;
          ui.setStatus("Reconnecting…");
        },
      },
      { name: identity.name || "Player", avatar: identity.avatar },
    );

    const url = new URL(window.location.href);
    url.searchParams.set("room", id);
    window.history.replaceState({}, "", url.toString());
  }

  async function host() {
    const picked = await promptIdentity(loadIdentity(), "Host");
    if (!picked) return;
    const id = newRoomId();
    enterRoom(id, picked);
    const link = roomUrl(id);
    try {
      await navigator.clipboard.writeText(link);
      ui.setStatus("Link copied — send it to a friend");
    } catch {
      ui.setStatus("Hosting — tap Copy to share the link");
    }
  }

  async function joinRoom(id: string, joinOpts?: { prompt?: boolean }) {
    const shouldPrompt = joinOpts?.prompt !== false;
    if (shouldPrompt) {
      const picked = await promptIdentity(loadIdentity(), "Join");
      if (!picked) return;
      enterRoom(id, picked);
      return;
    }
    const saved = loadIdentity();
    if (!saved.name) {
      const picked = await promptIdentity(saved, "Join");
      if (!picked) return;
      enterRoom(id, picked);
      return;
    }
    enterRoom(id, saved);
  }

  async function join() {
    const id = await promptJoinLink();
    if (!id) return;
    await joinRoom(id);
  }

  function copyLink() {
    if (!roomId) return;
    void navigator.clipboard.writeText(roomUrl(roomId)).then(
      () => ui.setStatus("Link copied"),
      () => ui.setStatus("Couldn’t copy — select the link from the address bar"),
    );
  }

  const session: MultiplayerSession = {
    isActive,
    isHost,
    tick(dtMs) {
      if (!room) return;
      if (!isHost()) {
        world.tickNet(dtMs);
        return;
      }
      const now = performance.now();
      const busy = world.isDragging();
      const interval = busy ? 8 : 16;
      if (now - lastSnap < interval) return;
      lastSnap = now;
      const w = Math.max(1, playfield.clientWidth);
      const h = Math.max(1, playfield.clientHeight);
      const chips = world.netSnapshot().map((c) => ({
        ...c,
        x: c.x / w,
        y: c.y / h,
      }));
      if (chips.length) sendGame({ type: "snapshot", chips });
    },
    broadcastSpawn(specs) {
      if (!room || !isHost()) return;
      lastSpawn = specs;
      const w = Math.max(1, playfield.clientWidth);
      const h = Math.max(1, playfield.clientHeight);
      sendGame({
        type: "spawn",
        specs: specs.map((s) => ({ ...s, x: s.x / w, y: s.y / h })),
      });
    },
    broadcastClear() {
      if (!room || !isHost()) return;
      lastSpawn = null;
      sendGame({ type: "clear" });
    },
    broadcastDoc(doc) {
      // Docs stay on the reliable WS path (larger payloads).
      if (!room) return;
      room.send({ type: "doc", doc });
    },
    requestHostPlay() {
      if (!room || isHost()) return false;
      sendGame({ type: "playRequest" });
      return true;
    },
    destroy: tearDownRoom,
  };

  return {
    session,
    host,
    join,
    joinRoom,
    copyLink,
    leave() {
      tearDownRoom();
      ui.setStatus("");
    },
    roomId: () => roomId,
  };
}

export function roomFromUrl(): string | null {
  const id = new URL(window.location.href).searchParams.get("room");
  return id && /^[a-z0-9]+$/i.test(id) ? id : null;
}

export function roomIdFromText(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/^[a-z0-9]+$/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const id = url.searchParams.get("room");
    return id && /^[a-z0-9]+$/i.test(id) ? id : null;
  } catch {
    const match = raw.match(/[?&]room=([a-z0-9]+)/i);
    return match?.[1] ?? null;
  }
}

function promptJoinLink(): Promise<string | null> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "mp-modal";
    root.innerHTML = `
      <form class="mp-modal__card" autocomplete="off">
        <h2 class="mp-modal__title">Join a friend</h2>
        <p class="mp-modal__hint">Paste the invite link they sent you.</p>
        <label class="mp-modal__field">
          <span>Invite link</span>
          <input type="text" name="link" placeholder="https://…?room=…" required />
        </label>
        <p class="mp-modal__error" hidden></p>
        <div class="mp-modal__actions">
          <button type="button" class="pill" data-cancel>Cancel</button>
          <button type="submit" class="pill is-on">Continue</button>
        </div>
      </form>
    `;
    const form = root.querySelector("form")!;
    const error = root.querySelector<HTMLElement>(".mp-modal__error")!;
    const finish = (value: string | null) => {
      root.remove();
      resolve(value);
    };
    form.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
    root.addEventListener("click", (event) => {
      if (event.target === root) finish(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input[name="link"]');
      const id = roomIdFromText(input?.value ?? "");
      if (!id) {
        error.hidden = false;
        error.textContent = "That doesn’t look like an invite link.";
        return;
      }
      finish(id);
    });
    document.body.append(root);
    form.querySelector<HTMLInputElement>('input[name="link"]')?.focus();
  });
}
