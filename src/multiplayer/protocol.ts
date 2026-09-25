export type PlayerProfile = {
  id: string;
  name: string;
  avatar: string;
  color: string;
};

export type ChipPose = {
  key: string;
  x: number;
  y: number;
  angle: number;
};

export type SpawnSpec = {
  key: string;
  slotId: string;
  seqIndex: number;
  seqTotal: number;
  sizeUnit: number;
  x: number;
  y: number;
  angle: number;
};

export type ClientToRoom =
  | { type: "hello"; name: string; avatar: string }
  | { type: "cursor"; x: number; y: number }
  | { type: "grabStart"; key: string; x: number; y: number }
  | { type: "grabMove"; x: number; y: number }
  | { type: "grabEnd" }
  | { type: "snapshot"; chips: ChipPose[] }
  | { type: "spawn"; specs: SpawnSpec[] }
  | { type: "clear" }
  | { type: "playRequest" }
  | { type: "doc"; doc: unknown }
  | { type: "signal"; signal: unknown };

export type RoomToClient =
  | { type: "welcome"; you: string; hostId: string; players: PlayerProfile[] }
  | { type: "players"; hostId: string; players: PlayerProfile[] }
  | { type: "cursor"; id: string; x: number; y: number }
  | { type: "grabStart"; id: string; key: string; x: number; y: number }
  | { type: "grabMove"; id: string; x: number; y: number }
  | { type: "grabEnd"; id: string }
  | { type: "snapshot"; chips: ChipPose[] }
  | { type: "spawn"; specs: SpawnSpec[] }
  | { type: "clear" }
  | { type: "playRequest" }
  | { type: "doc"; doc: unknown }
  | { type: "signal"; signal: unknown }
  | { type: "roomFull" };

export function partyHost(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  return env?.VITE_PARTYKIT_HOST || "127.0.0.1:1999";
}
