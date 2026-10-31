/**
 * Протокол клиент ↔ сервер.
 * Состояние комнаты (игроки, позиции) синхронизируется через Colyseus Schema,
 * а здесь — типы явных сообщений (намерений) и опций входа.
 */

export const ClientMsg = {
  Move: 'move',
  Chat: 'chat.say',
  // Зарезервировано под механики из дизайн-дока:
  // Grab: 'grab', Release: 'release', RoleTake: 'role.take', PuzzleAction: 'puzzle.action',
  // AgentAsk: 'agent.ask', JumpRequest: 'jump.request',
} as const;

export const ServerMsg = {
  Chat: 'chat',
  System: 'system',
  // ShipComment: 'ship.comment', AgentSay: 'agent.say', Hint: 'hint', PartAwarded: 'part.awarded',
} as const;

export type Anim = 'idle' | 'run' | 'jump' | 'fall';

export interface MovePayload {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  anim: Anim;
  facing: 1 | -1;
}

export interface ChatPayload {
  text: string;
}

export interface ChatBroadcast {
  from: string;
  name: string;
  text: string;
  ts: number;
}

export interface JoinOptions {
  name: string;
}

export interface CreateOptions extends JoinOptions {
  /** Человекочитаемое название экипажа, видно в списке комнат. */
  crewName?: string;
}

/** metadata комнаты — то, что видно в /api/rooms без входа. */
export interface CrewRoomMetadata {
  crewName: string;
  hostName: string;
  epoch: number;
}

export interface RoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  metadata: CrewRoomMetadata;
}
