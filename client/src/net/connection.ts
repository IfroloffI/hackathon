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

// Сохранённая сессия подхватывается сразу при загрузке страницы.
{
  const saved = storedAuth();
  if (saved) client.http.authToken = saved.token;
}

export class AuthError extends Error {}

async function authRequest(path: '/auth/login' | '/auth/register', name: string, password: string): Promise<AuthPlayer> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<AuthLoginResponse> & { error?: string };
  if (!res.ok || !body.token || !body.player) throw new AuthError(body.error ?? `HTTP ${res.status}`);
  saveAuth({ token: body.token, player: body.player });
  client.http.authToken = body.token;
  return body.player;
}

/**
 * Вход по логину и паролю → JWT. Токен хранится в localStorage и проставляется в SDK:
 * matchmake уходит с `Authorization: Bearer`, WS — с `?_authToken=`; комната берёт имя из токена.
 */
export const auth = {
  current(): AuthPlayer | null {
    return storedAuth()?.player ?? null;
  },
  login: (name: string, password: string) => authRequest('/auth/login', name, password),
  register: (name: string, password: string) => authRequest('/auth/register', name, password),
  async logout() {
    const saved = storedAuth();
    clearAuth();
    if (saved) await fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${saved.token}` } }).catch(() => {});
  },
  /** Сохранённый токен ещё действует? Если нет — забываем его (нужно войти заново). */
  async validate(): Promise<AuthPlayer | null> {
    const saved = storedAuth();
    if (!saved) return null;
    try {
      const res = await fetch(`${SERVER_URL}/auth/me`, { headers: { Authorization: `Bearer ${saved.token}` } });
      if (res.status === 401) {
        clearAuth();
        return null;
      }
      return saved.player;
    } catch {
      return saved.player; // сервер недоступен — не разлогиниваем
    }
  },
};

function requireAuth(): AuthPlayer {
  const player = auth.current();
  if (!player) throw new AuthError('Сначала войдите');
  return player;
}

/** Токен отозван/протух — забываем его, лобби покажет форму входа. */
function expired(e: unknown): unknown {
  if (!isAuthError(e)) return e;
  clearAuth();
  return new AuthError('Сессия истекла — войдите снова');
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
   */
  async voiceToken(roomId: string): Promise<VoiceTokenResponse> {
    requireAuth();
    const token = currentAuthToken();
    const res = await fetch(`${SERVER_URL}/room/${encodeURIComponent(roomId)}/voice-token`, {
      method: 'POST',
      headers: token === null ? undefined : { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      clearAuth();
      throw new AuthError('Сессия истекла — войдите снова');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `voice HTTP ${res.status}`);
    }
    return (await res.json()) as VoiceTokenResponse;
  },

  /** Мастер: создать комнату через RoomManager (POST /room) и сразу войти в неё. */
  async createRoom(opts: CreateRoomRequest): Promise<CrewRoom> {
    const me = requireAuth();
    try {
      const res = await fetch(`${SERVER_URL}/room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storedAuth()!.token}` },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw Object.assign(new Error(body?.error ?? `HTTP ${res.status}`), { code: res.status });
      }
      const info = (await res.json()) as ManagedRoomInfo;
      return await withState(client.joinById(info.roomId, { name: me.name }, CrewState));
    } catch (e) {
      throw expired(e);
    }
  },

  async joinByCode(code: string): Promise<CrewRoom> {
    const me = requireAuth();
    try {
      return await withState(client.joinById(code.trim().toUpperCase(), { name: me.name }, CrewState));
    } catch (e) {
      throw expired(e);
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
