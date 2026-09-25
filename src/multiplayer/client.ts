import PartySocket from "partysocket";
import type {
  ChipPose,
  ClientToRoom,
  PlayerProfile,
  RoomToClient,
  SpawnSpec,
} from "./protocol";
import { partyHost } from "./protocol";

export type RoomHandlers = {
  onWelcome: (you: string, hostId: string, players: PlayerProfile[]) => void;
  onPlayers: (hostId: string, players: PlayerProfile[]) => void;
  onCursor: (id: string, x: number, y: number) => void;
  onGrabStart: (id: string, key: string, x: number, y: number) => void;
  onGrabMove: (id: string, x: number, y: number) => void;
  onGrabEnd: (id: string) => void;
  onSnapshot: (chips: ChipPose[]) => void;
  onSpawn: (specs: SpawnSpec[]) => void;
  onClear: () => void;
  onPlayRequest: () => void;
  onDoc: (doc: unknown) => void;
  onSignal: (signal: unknown) => void;
  onRoomFull: () => void;
  onClose: () => void;
  onError: () => void;
};

export type RoomClient = {
  send: (msg: ClientToRoom) => void;
  close: () => void;
};

export function connectRoom(
  roomId: string,
  handlers: RoomHandlers,
  hello: { name: string; avatar: string },
): RoomClient {
  const socket = new PartySocket({
    host: partyHost(),
    room: roomId,
    party: "main",
  });

  let closed = false;
  const queue: ClientToRoom[] = [];

  function flush(msg: ClientToRoom) {
    socket.send(JSON.stringify(msg));
  }

  function sendHello() {
    flush({ type: "hello", name: hello.name, avatar: hello.avatar });
  }

  socket.addEventListener("open", () => {
    if (closed) return;
    sendHello();
    for (const msg of queue) flush(msg);
    queue.length = 0;
  });

  socket.addEventListener("message", (event) => {
    let msg: RoomToClient;
    try {
      msg = JSON.parse(String(event.data)) as RoomToClient;
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome":
        handlers.onWelcome(msg.you, msg.hostId, msg.players);
        break;
      case "players":
        handlers.onPlayers(msg.hostId, msg.players);
        break;
      case "cursor":
        handlers.onCursor(msg.id, msg.x, msg.y);
        break;
      case "grabStart":
        handlers.onGrabStart(msg.id, msg.key, msg.x, msg.y);
        break;
      case "grabMove":
        handlers.onGrabMove(msg.id, msg.x, msg.y);
        break;
      case "grabEnd":
        handlers.onGrabEnd(msg.id);
        break;
      case "snapshot":
        handlers.onSnapshot(msg.chips);
        break;
      case "spawn":
        handlers.onSpawn(msg.specs);
        break;
      case "clear":
        handlers.onClear();
        break;
      case "playRequest":
        handlers.onPlayRequest();
        break;
      case "doc":
        handlers.onDoc(msg.doc);
        break;
      case "signal":
        handlers.onSignal(msg.signal);
        break;
      case "roomFull":
        handlers.onRoomFull();
        break;
    }
  });

  socket.addEventListener("error", () => {
    if (!closed) handlers.onError();
  });

  socket.addEventListener("close", () => {
    if (!closed) handlers.onClose();
  });

  return {
    send(msg) {
      if (closed) return;
      if (socket.readyState === WebSocket.OPEN) flush(msg);
      else queue.push(msg);
    },
    close() {
      closed = true;
      queue.length = 0;
      socket.close();
    },
  };
}

export function newRoomId() {
  return Math.random().toString(36).slice(2, 8);
}
