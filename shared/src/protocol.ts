/**
 * Протокол клиент ↔ сервер.
 * Состояние комнаты (игроки, позиции) синхронизируется через Colyseus Schema,
 * а здесь — типы явных сообщений (намерений) и опций входа.
 */

export const ClientMsg = {
  Move: 'move',
  Chat: 'chat.say',
  /** Нажата E у станции: роль, рычаг прыжка, возврат на корабль, разговор. */
  Interact: 'interact',
  /** Действие на своей роли в головоломке. */
  PuzzleAction: 'puzzle.action',
  // Зарезервировано: Grab: 'grab', Release: 'release', AgentAsk: 'agent.ask'
} as const;

export const ServerMsg = {
  Chat: 'chat',
  System: 'system',
  /** Реплика персонажа: рассказчик эпохи или бортовой ИИ. */
  Say: 'say',
  /** Приватный вид головоломки для своей роли. */
  PuzzleView: 'puzzle.view',
  /** Сервер переставил игрока (смена уровня). */
  Teleport: 'teleport',
} as const;

export interface InteractPayload {
  stationId: string;
}

export interface PuzzleActionPayload {
  action: string;
  value?: unknown;
  /** От чьего имени действие, если игрок держит обе роли (режим разработки CHRONOLET_SOLO). */
  role?: 'observer' | 'mechanic';
}

export interface SayPayload {
  agentId: string;
  speaker: string;
  text: string;
  /** Подсказка бортового ИИ: уровень 1..3. */
  hint?: number;
}

export interface TeleportPayload {
  levelId: string;
  x: number;
  y: number;
  z: number;
}

export type Anim = 'idle' | 'run' | 'jump' | 'fall';

export interface MovePayload {
  /** Уровень, на котором посчитана позиция: пакеты со старого уровня после прыжка отбрасываются. */
  levelId: string;
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
