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
  /** Магазин на борту: купить / надеть скин. */
  ShopBuy: 'shop.buy',
  ShopEquip: 'shop.equip',
  /** Лайк другому игроку. */
  Like: 'like',
  /** Стикер-эмоция над головой. */
  Emote: 'emote',
  /** Вопрос агенту (рассказчику или ХРОНОСу): «@Галилей …» в чате. */
  Ask: 'agent.ask',
  /** Игрок упирается в ящик и толкает его (шлётся ~10 Гц, пока толкает). */
  Push: 'crate.push',
  // Зарезервировано: Grab: 'grab', Release: 'release'
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
  /** Кто-то подобрал сферу VK Coin. */
  Coin: 'coin',
  /** Ответ магазина лично покупателю. */
  Shop: 'shop',
  Like: 'like',
  Emote: 'emote',
  /** Кто-то получил ачивку. */
  Achievement: 'achievement',
  /** Лично игроку: начислен опыт. */
  Xp: 'xp',
} as const;

export interface PushPayload {
  crateId: string;
  dir: 1 | -1;
}

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
  /** Потоковая реплика LLM: куски с одним streamId; partial=true — ещё печатает. */
  streamId?: string;
  partial?: boolean;
  /** Откуда реплика: заготовка или живая LLM. */
  source?: 'script' | 'llm';
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

export interface ShopPayload {
  skinId: string;
}

export interface CoinPickup {
  coinId: string;
  sessionId: string;
  name: string;
}

export interface ShopResult {
  ok: boolean;
  text: string;
}

export interface LikePayload {
  /** sessionId того, кому лайк. */
  target: string;
}

export interface LikeBroadcast {
  from: string;
  to: string;
  fromName: string;
  toName: string;
}

export interface EmotePayload {
  emote: number;
}

export interface EmoteBroadcast {
  sessionId: string;
  emote: number;
}

export interface AskPayload {
  agentId: string;
  text: string;
}

export interface AchievementBroadcast {
  sessionId: string;
  name: string;
  id: string;
}

export interface XpGain {
  amount: number;
  reason: string;
}
