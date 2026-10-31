/**
 * Контракты HTTP/WS API нового бэкенд-слоя (Fastify).
 * Только типы и константы — без зависимостей от рантайма,
 * чтобы клиент и сервер могли импортировать их одинаково.
 */

// ---------- Auth ----------

/** POST /auth/login — тело запроса. */
export interface AuthLoginRequest {
  name: string;
}

/** Публичные данные игрока (без приватных полей). */
export interface AuthPlayer {
  id: string;
  name: string;
}

/** POST /auth/login — ответ. Токен передавать как `Authorization: Bearer <token>`. */
export interface AuthLoginResponse {
  token: string;
  player: AuthPlayer;
}

/** GET /auth/me — ответ. */
export interface AuthMeResponse {
  player: AuthPlayer;
}

// ---------- Rooms (RoomManager) ----------

/** POST /room — тело запроса. */
export interface CreateRoomRequest {
  /** Человекочитаемое название экипажа. По умолчанию: `Экипаж <имя мастера>`. */
  crewName?: string;
  /** Публичная комната попадает в UDP-бродкаст по локалке. По умолчанию: false. */
  isPublic?: boolean;
}

/** Комната под управлением RoomManager. */
export interface ManagedRoomInfo {
  roomId: string;
  crewName: string;
  hostPlayerId: string;
  hostName: string;
  isPublic: boolean;
  clients: number;
  maxClients: number;
  /** ms, Date.now() на сервере. */
  createdAt: number;
}

// ---------- WebSocket: /room/{id}/connect ----------

/**
 * Событие, которое сервер раз в секунду рассылает всем участникам комнаты
 * в WS-канале `/room/{id}/connect`.
 */
export interface HelloEvent {
  type: 'hello';
  text: string;
  /** ms, Date.now() на сервере. */
  ts: number;
}

// ---------- UDP-бродкаст публичных комнат ----------

/** Порт UDP-бродкаста по умолчанию (TCP-порт сервера 2567 не трогаем). */
export const UDP_BROADCAST_PORT = 41234;

/** Payload одного UDP-пакета beacon'а. */
export interface RoomBeacon {
  app: 'chronolet';
  roomId: string;
  crewName: string;
  /** LAN IPv4 хоста. */
  host: string;
  /** TCP-порт сервера (2567). */
  port: number;
  ts: number;
}
