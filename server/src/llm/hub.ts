import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { LLM_PROTOCOL, type GameEvent, type LlmAck, type LlmHintRequest, type LlmSayRequest, type LlmStreamMessage, type LlmVoiceRequest, type SessionSnapshot } from '@chronolet/shared';
import { eventBus } from '../core/eventBus.ts';
import { timeseries } from '../timeseries/store.ts';
import { config } from '../config.ts';

/**
 * LLM-хаб: WS /llm/stream для realtime-LLM-сервиса (контракт — shared/src/llm.ts).
 * Сервер шлёт все события (живые и реплей с ?since=), снимки сессий раз в SNAPSHOT_MS
 * и heartbeat. Обратный канал — REST /llm/* (routes.ts), здесь — реестр сессий для него.
 */
const STREAM_PATH = '/llm/stream';
const SNAPSHOT_MS = 2000;
const HEARTBEAT_MS = 10000;
const REPLAY_LIMIT = 5000;

/** Что комната отдаёт хабу: снимок и обработчики реплик/подсказок от LLM. */
export interface SessionControl {
  snapshot(): SessionSnapshot;
  say(req: LlmSayRequest): LlmAck;
  hint(req: LlmHintRequest): LlmAck;
  /** Фраза из расшифровки голоса: ответ на вопрос у ворот. */
  voice(req: LlmVoiceRequest): Promise<LlmAck>;
}

interface StreamClient {
  ws: WebSocket;
  /** null — все сессии. */
  session: string | null;
  /** Пока идёт реплей истории, живые события копятся здесь (без потерь и дублей). */
  buffer: GameEvent[] | null;
}

const sessions = new Map<string, SessionControl>();
const clients = new Set<StreamClient>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

export const llmHub = {
  register(session: string, ctl: SessionControl) {
    sessions.set(session, ctl);
  },
  unregister(session: string) {
    sessions.delete(session);
  },
  get(session: string) {
    return sessions.get(session);
  },
  list(): string[] {
    return [...sessions.keys()];
  },
  /** Подключён ли LLM-сервис, слушающий эту сессию: тогда на вопросы игроков ждём его ответа. */
  listening(session: string): boolean {
    for (const c of clients) if (c.ws.readyState === WebSocket.OPEN && (c.session === null || c.session === session)) return true;
    return false;
  },
  /** Немедленный снимок (смена шага/уровня) — не ждать таймера. */
  pushSnapshot(session: string) {
    const ctl = sessions.get(session);
    if (!ctl) return;
    const msg: LlmStreamMessage = { type: 'snapshot', snapshot: ctl.snapshot() };
    for (const c of clients) if (c.session === null || c.session === session) send(c.ws, msg);
  },
};

export function isLlmPath(url: string | undefined): boolean {
  return (url ?? '').split('?')[0] === STREAM_PATH;
}

export function attachLlmHub(server: Server) {
  server.on('upgrade', (req, socket, head) => {
    if (isLlmPath(req.url)) void handleUpgrade(req, socket, head);
  });
  eventBus.on((e) => broadcastEvent(e));
  setInterval(() => {
    for (const id of sessions.keys()) llmHub.pushSnapshot(id);
  }, SNAPSHOT_MS).unref();
  setInterval(() => {
    for (const c of clients) send(c.ws, { type: 'heartbeat', serverTs: Date.now() });
  }, HEARTBEAT_MS).unref();
}

function send(ws: WebSocket, msg: LlmStreamMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastEvent(event: GameEvent) {
  for (const c of clients) {
    if (c.session !== null && c.session !== event.session) continue;
    if (c.buffer) c.buffer.push(event);
    else send(c.ws, { type: 'event', event });
  }
}

async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = new URL(`ws://server${req.url ?? '/'}`);
  const token = url.searchParams.get('token') ?? (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (token !== config.llmToken) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  const session = url.searchParams.get('session');
  const since = Number(url.searchParams.get('since') ?? NaN);

  wss.handleUpgrade(req, socket, head, async (ws) => {
    const client: StreamClient = { ws, session: session || null, buffer: [] };
    clients.add(client);
    send(ws, { type: 'hello', protocol: LLM_PROTOCOL, serverTs: Date.now(), sessions: llmHub.list(), lastSeq: timeseries.lastSeq });
    let last = timeseries.lastSeq;
    if (Number.isFinite(since)) {
      last = since;
      for (const event of await timeseries.eventsSince(client.session, since, null, REPLAY_LIMIT)) {
        send(ws, { type: 'event', event, replay: true });
        last = event.seq;
      }
    }
    for (const event of client.buffer!) if (event.seq > last) send(ws, { type: 'event', event });
    client.buffer = null;
    for (const id of client.session ? [client.session] : llmHub.list()) {
      const ctl = sessions.get(id);
      if (ctl) send(ws, { type: 'snapshot', snapshot: ctl.snapshot() });
    }
    ws.on('close', () => clients.delete(client));
    ws.on('error', () => ws.close());
  });
}
