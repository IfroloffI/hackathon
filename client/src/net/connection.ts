import { Client, Callbacks, type Room } from '@colyseus/sdk';
import { $refId } from '@colyseus/schema';
import {
  CREW_ROOM,
  CrewState,
  SERVER_PORT,
  type AuthLoginResponse,
  type AuthPlayer,
  type CreateRoomRequest,
  type JoinOptions,
  type LiveKitStatusResponse,
  type ManagedRoomInfo,
  type PlayerState,
  type RoomListing,
  type VoiceTokenResponse,
} from '@chronolet/shared';

/**
 * Один хост: в prod клиент отдаётся тем же сервером (same origin),
 * в dev Vite живёт на :5173, а сервер — на :SERVER_PORT того же хоста.
 */
export const SERVER_URL = import.meta.env.DEV
  ? `${location.protocol}//${location.hostname}:${SERVER_PORT}`
  : location.origin;

const client = new Client(SERVER_URL);

export type NetPlayer = PlayerState;
export type CrewRoom = Room<any, CrewState>;

const TOKEN_KEY = 'chronolet.token';
const PLAYER_KEY = 'chronolet.player';

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function storedAuth(): { token: string; player: AuthPlayer } | null {
  const s = storage();
  const token = s?.getItem(TOKEN_KEY);
  const raw = s?.getItem(PLAYER_KEY);
  if (!s || !token || !raw) { return null; }
  try {
    return { token, player: JSON.parse(raw) as AuthPlayer };
  } catch {
    return null;
  }
}

function saveAuth(auth: { token: string; player: AuthPlayer }): void {
  const s = storage();
  s?.setItem(TOKEN_KEY, auth.token);
  s?.setItem(PLAYER_KEY, JSON.stringify(auth.player));
}

function clearAuth(): void {
  storage()?.removeItem(TOKEN_KEY);
  storage()?.removeItem(PLAYER_KEY);
  client.http.authToken = undefined;
}

/**
 * Имя → токен (POST /auth/login). Повторный вход под тем же именем
 * переиспользует сохранённый токен. Токен проставляется в SDK: matchmake
 * уходит с `Authorization: Bearer`, WS — с `?_authToken=`.
 */
export async function ensureLogin(name: string): Promise<AuthPlayer> {
  const saved = storedAuth();
  if (saved && saved.player.name === name) {
    client.http.authToken = saved.token;
    return saved.player;
  }
  const res = await fetch(`${SERVER_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) { throw new Error(`login HTTP ${res.status}`); }
  const auth = (await res.json()) as AuthLoginResponse;
  saveAuth(auth);
  client.http.authToken = auth.token;
  return auth.player;
}

export function forceLogin(name: string): Promise<AuthPlayer> {
  clearAuth();
  return ensureLogin(name);
}

/** Текущий токен для обычных fetch-запросов (голос, API комнат). */
export function currentAuthToken(): string | null {
  return client.http.authToken ?? storedAuth()?.token ?? null;
}

function isAuthError(e: unknown): boolean {
  const code = (e as { code?: unknown }).code;
  if (code === 401 || code === 525) { return true; }
  return /HTTP 401|HTTP 525|AUTH_FAILED|Failed to authenticate/i.test(e instanceof Error ? e.message : String(e));
}

export const net = {
  async listRooms(): Promise<RoomListing[]> {
    const res = await fetch(`${SERVER_URL}/api/rooms`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async hostAddresses(): Promise<string[]> {
    const res = await fetch(`${SERVER_URL}/api/host`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { addresses: string[] }).addresses;
  },

  /** Доступен ли голосовой чат и по какому адресу подключаться. */
  async livekitStatus(): Promise<LiveKitStatusResponse> {
    const res = await fetch(`${SERVER_URL}/api/livekit`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as LiveKitStatusResponse;
  },

  /**
   * Токен участника LiveKit для комнаты. Требует Bearer-токена Colyseus:
   * сервер проверяет, что игрок действительно сидит в этой игровой комнате.
   * При 401 токен сбрасывается и логин повторяется один раз.
   */
  async voiceToken(roomId: string, name: string): Promise<VoiceTokenResponse> {
    const request = async (): Promise<VoiceTokenResponse | null> => {
      await ensureLogin(name);
      const token = currentAuthToken();
      const res = await fetch(`${SERVER_URL}/room/${encodeURIComponent(roomId)}/voice-token`, {
        method: 'POST',
        headers: token === null ? undefined : { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return null;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `voice HTTP ${res.status}`);
      }
      return (await res.json()) as VoiceTokenResponse;
    };

    let out = await request();
    if (out === null) {
      clearAuth();
      out = await request();
    }
    if (out === null) throw new Error('не удалось авторизоваться для голосового чата');
    return out;
  },

  /** Мастер: создать комнату через RoomManager (POST /room) и сразу войти в неё. */
  async createRoom(opts: CreateRoomRequest, name: string): Promise<CrewRoom> {
    await ensureLogin(name);
    const join = async (): Promise<CrewRoom> => {
      const res = await fetch(`${SERVER_URL}/room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.http.authToken}` },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const info = (await res.json()) as ManagedRoomInfo;
      return withState(client.joinById(info.roomId, { name }, CrewState));
    };
    try {
      return await join();
    } catch (e) {
      if (!isAuthError(e)) { throw e; }
      clearAuth();
      await ensureLogin(name);
      return await join();
    }
  },

  async joinByCode(code: string, opts: JoinOptions): Promise<CrewRoom> {
    await ensureLogin(opts.name);
    const join = (): Promise<CrewRoom> => withState(client.joinById(code.trim().toUpperCase(), opts, CrewState));
    try {
      return await join();
    } catch (e) {
      if (!isAuthError(e)) { throw e; }
      clearAuth();
      await ensureLogin(opts.name);
      return await join();
    }
  },

  callbacks(room: CrewRoom) {
    return Callbacks.get(room);
  },
};

/**
 * SDK отдаёт комнату сразу после подтверждения входа, а полное состояние приходит следующим сообщением.
 * Ждём его, чтобы игра и HUD подписывались на уже декодированный state (иначе вложенные схемы без refId).
 */
async function withState(pending: Promise<CrewRoom>): Promise<CrewRoom> {
  const room = await pending;
  // У корня refId есть сразу, а вложенная схема получает его только после декодирования.
  const puzzle = room.state.puzzle as unknown as Record<symbol, unknown> | undefined;
  if (!puzzle || puzzle[$refId] === undefined) {
    await new Promise<void>((resolve) => {
      room.onStateChange.once(() => resolve());
      setTimeout(resolve, 5000);
    });
  }
  return room;
}
