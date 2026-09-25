import type * as Party from "partykit/server";

const MAX_PLAYERS = 2;
const COLORS = ["#ff5a36", "#3d8bfd", "#34c759", "#af52de", "#ff9f0a"];

type Profile = {
  id: string;
  name: string;
  avatar: string;
  color: string;
};

type ClientMsg =
  | { type: "hello"; name: string; avatar: string }
  | { type: "cursor"; x: number; y: number }
  | { type: "grabStart"; key: string; x: number; y: number }
  | { type: "grabMove"; x: number; y: number }
  | { type: "grabEnd" }
  | { type: "snapshot"; chips: unknown }
  | { type: "spawn"; specs: unknown }
  | { type: "clear" }
  | { type: "playRequest" }
  | { type: "doc"; doc: unknown }
  | { type: "signal"; signal: unknown };

function parse(raw: string): ClientMsg | null {
  try {
    const data = JSON.parse(raw) as ClientMsg;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export default class RoomServer implements Party.Server {
  hostId: string | null = null;
  profiles = new Map<string, Profile>();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    if (this.room.getConnections().length > MAX_PLAYERS) {
      conn.send(JSON.stringify({ type: "roomFull" }));
      conn.close();
      return;
    }
    if (!this.hostId) this.hostId = conn.id;
  }

  onClose(conn: Party.Connection) {
    this.profiles.delete(conn.id);
    if (this.hostId === conn.id) {
      const next = [...this.room.getConnections()].find((c) => c.id !== conn.id);
      this.hostId = next?.id ?? null;
    }
    this.broadcastPlayers();
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg = parse(typeof message === "string" ? message : "");
    if (!msg) return;

    if (msg.type === "hello") {
      const name = String(msg.name || "Player").trim().slice(0, 24) || "Player";
      const avatar = String(msg.avatar || "🦊").slice(0, 8);
      const color = COLORS[this.profiles.size % COLORS.length];
      this.profiles.set(sender.id, { id: sender.id, name, avatar, color });
      if (!this.hostId) this.hostId = sender.id;
      sender.send(
        JSON.stringify({
          type: "welcome",
          you: sender.id,
          hostId: this.hostId,
          players: [...this.profiles.values()],
        }),
      );
      this.broadcastPlayers();
      return;
    }

    if (!this.profiles.has(sender.id)) return;

    if (msg.type === "cursor") {
      this.room.broadcast(
        JSON.stringify({ type: "cursor", id: sender.id, x: msg.x, y: msg.y }),
        [sender.id],
      );
      return;
    }

    if (msg.type === "grabStart" || msg.type === "grabMove" || msg.type === "grabEnd") {
      const payload =
        msg.type === "grabStart"
          ? { type: "grabStart", id: sender.id, key: msg.key, x: msg.x, y: msg.y }
          : msg.type === "grabMove"
            ? { type: "grabMove", id: sender.id, x: msg.x, y: msg.y }
            : { type: "grabEnd", id: sender.id };
      this.room.broadcast(JSON.stringify(payload), [sender.id]);
      return;
    }

    if (msg.type === "playRequest") {
      if (this.hostId && this.hostId !== sender.id) {
        this.room.getConnection(this.hostId)?.send(JSON.stringify({ type: "playRequest" }));
      }
      return;
    }

    // Shared canvas — either player can edit (Figma-style).
    if (msg.type === "doc") {
      this.room.broadcast(JSON.stringify({ type: "doc", doc: msg.doc }), [sender.id]);
      return;
    }

    // WebRTC signaling — peer to peer only.
    if (msg.type === "signal") {
      this.room.broadcast(JSON.stringify({ type: "signal", signal: msg.signal }), [sender.id]);
      return;
    }

    // Host-only simulation messages
    if (sender.id !== this.hostId) return;

    if (msg.type === "snapshot" || msg.type === "spawn" || msg.type === "clear") {
      this.room.broadcast(JSON.stringify(msg), [sender.id]);
    }
  }

  broadcastPlayers() {
    const payload = JSON.stringify({
      type: "players",
      hostId: this.hostId,
      players: [...this.profiles.values()],
    });
    this.room.broadcast(payload);
  }
}

RoomServer satisfies Party.Worker;
