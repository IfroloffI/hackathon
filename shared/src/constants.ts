/** Имя типа комнаты в Colyseus. Одна комната = один экипаж (сессия игры). */
export const CREW_ROOM = 'crew';

export const MAX_CREW = 6;

/** Порт единственного хоста: API, WebSocket и (в prod) статика клиента. */
export const SERVER_PORT = 2567;

/** Префикс имени комнаты в LiveKit: одна голосовая комната на игровую. */
export const LIVEKIT_ROOM_PREFIX = 'chronolet-';

/** Имя LiveKit-комнаты для кода комнаты Colyseus. Должно совпадать на клиенте и сервере. */
export function livekitRoomName(roomId: string): string {
  return `${LIVEKIT_ROOM_PREFIX}${roomId}`;
}

/** Порт LiveKit по умолчанию (signalling ws). */
export const LIVEKIT_PORT = 7880;

/** Как часто клиент шлёт свою позицию (Гц). */
export const MOVE_SEND_HZ = 20;

/** Как часто сервер рассылает патчи состояния (мс). */
export const PATCH_RATE_MS = 50;

/** Как часто позиции игроков сохраняются в БД (мс). */
export const PERSIST_INTERVAL_MS = 5000;

/** Сколько секунд держим место за отвалившимся игроком. */
export const RECONNECT_GRACE_S = 20;

/** Физика платформера — общая, чтобы сервер мог валидировать движение. */
export const PHYSICS = {
  runSpeed: 6,
  depthSpeed: 3,
  /** Высота прыжка = jumpSpeed² / (2·gravity) ≈ 2.4 — с запасом выше самой высокой ступеньки уровня. */
  jumpSpeed: 11,
  gravity: 25,
  /** Допуск на скорость при серверной проверке (лаг, накопление). */
  speedTolerance: 1.6,
} as const;

export const PLAYER_SIZE = { w: 0.8, h: 1.2, d: 0.8 } as const;
