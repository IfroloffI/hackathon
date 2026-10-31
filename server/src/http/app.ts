import fs from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { createAuthContext, matchMaker, ServerError } from 'colyseus';
import {
  CREW_ROOM,
  livekitRoomName,
  type LiveKitStatusResponse,
  type ManagedRoomInfo,
  type RoomListing,
  type VoiceTokenResponse,
} from '@chronolet/shared';
import { sessions, players } from '../db/repositories.ts';
import { config } from '../config.ts';
import {
  getBearerToken,
  issueLiveKitToken,
  issueToken,
  revokeToken,
  verifyToken,
  type VerifiedPlayer,
} from '../auth/tokens.ts';
import * as roomManager from '../rooms/roomManager.ts';
import { closeRoomChannels, disconnectPlayer } from '../net/helloHub.ts';
import { lanAddresses } from '../net/lan.ts';

declare module 'fastify' {
  interface FastifyRequest {
    player?: VerifiedPlayer;
  }
}

const MATCHMAKE_METHODS = ['joinOrCreate', 'create', 'join', 'joinById', 'reconnect'] as const;
type MatchmakeMethod = (typeof MATCHMAKE_METHODS)[number];

type AuthedRequest = FastifyRequest & { player: VerifiedPlayer };

function authed(req: FastifyRequest): VerifiedPlayer | null {
  const player = (req as AuthedRequest).player;
  return player ?? null;
}

export async function buildApp(httpServer: HttpServer): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    serverFactory: (handler) => {
      httpServer.on('request', handler);
      return httpServer;
    },
  });

  await app.register(cors, {
    origin: true,
    // @colyseus/sdk с authToken шлёт matchmake с credentials: 'include' — без этого браузер
    // блокирует вход в комнату, когда клиент открыт с другого origin (dev: Vite на :5173).
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ---------- auth ----------

  app.post('/auth/login', async (req, reply) => {
    const name = normalizeName((req.body as { name?: unknown } | null)?.name);
    if (name === null) {
      return reply.code(400).send({ error: 'Нужно имя игрока (1–20 символов)' });
    }
    const player = players.findOrCreate(name);
    const token = await issueToken({ id: player.id, name: player.name });
    return reply.code(201).send({ token, player: { id: player.id, name: player.name } });
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (req) => {
    revokeToken(getBearerToken(req.headers.authorization) ?? '');
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const player = authed(req);
    if (player === null) { return reply.code(401).send({ error: 'Требуется авторизация: POST /auth/login' }); }
    return { player: { id: player.id, name: player.name } };
  });

  // ---------- RoomManager ----------

  app.post<{ Body: { crewName?: string; isPublic?: boolean } }>('/room', { preHandler: requireAuth }, async (req, reply) => {
    const player = authed(req);
    if (player === null) { return reply.code(401).send({ error: 'Требуется авторизация: POST /auth/login' }); }
    const room = await roomManager.createRoom(player, {
      crewName: req.body.crewName,
      isPublic: req.body.isPublic,
    });
    return reply.code(201).send(room);
  });

  app.get<{ Params: { id: string } }>('/room/:id', { preHandler: requireAuth }, async (req, reply) => {
    const room = roomManager.getManagedRoom(req.params.id);
    if (room === null) {
      return reply.code(404).send({ error: 'Комната не найдена' });
    }
    const player = authed(req);
    if (player === null) { return reply.code(401).send({ error: 'Требуется авторизация: POST /auth/login' }); }
    if (!roomManager.isHost(room.roomId, player.id)) {
      return reply.code(403).send({ error: 'Комната доступна только её мастеру' });
    }
    return room;
  });

  app.delete<{ Params: { id: string } }>('/room/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params;
    const player = authed(req);
    if (player === null) { return reply.code(401).send({ error: 'Требуется авторизация: POST /auth/login' }); }
    if (!roomManager.isHost(id, player.id)) {
      const room = roomManager.getManagedRoom(id);
      if (room === null) {
        return reply.code(404).send({ error: 'Комната не найдена' });
      }
      return reply.code(403).send({ error: 'Удалить комнату может только её мастер' });
    }
    const deleted = await roomManager.deleteRoom(id);
    if (!deleted) {
      return reply.code(404).send({ error: 'Комната не найдена' });
    }
    closeRoomChannels(id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/room/:id/disconnect', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params;
    const room = roomManager.getManagedRoom(id) ?? await matchMaker.getRoomById(id);
    if (room === null) {
      return reply.code(404).send({ error: 'Комната не найдена' });
    }
    const player = authed(req);
    if (player === null) { return reply.code(401).send({ error: 'Требуется авторизация: POST /auth/login' }); }
    return { closed: disconnectPlayer(id, player.id) };
  });

  // ---------- голосовой чат (LiveKit) ----------

  app.get('/api/livekit', async (req): Promise<LiveKitStatusResponse> => ({
    enabled: config.livekit.enabled,
    url: config.livekit.enabled ? livekitUrl(req) : null,
  }));

  /**
   * Токен участника голосовой комнаты. LiveKit-комната создаётся сам,
   * когда в неё заходит первый участник, — отдельный createRoom не нужен.
   */
  app.post<{ Params: { id: string } }>('/room/:id/voice-token', { preHandler: requireAuth }, async (req, reply) => {
    const player = authed(req);
    if (player === null) { return reply.code(401).send({ error: 'Требуется авторизация: POST /auth/login' }); }
    if (!config.livekit.enabled) {
      return reply.code(503).send({ error: 'Голосовой чат выключен на сервере (LIVEKIT_ENABLED=0)' });
    }
    const gameRoom = await matchMaker.getRoomById(req.params.id);
    if (gameRoom === undefined) {
      return reply.code(404).send({ error: 'Комната не найдена' });
    }
    // getRoomById отдаёт кэш (там clients — число); сами клиенты — в локальном инстансе.
    const localRoom = matchMaker.getLocalRoomById(gameRoom.roomId) as unknown as
      | { clients: Iterable<{ userData?: { playerId?: string } }> }
      | undefined;
    if (localRoom === undefined || !isRoomMember(localRoom, player.id)) {
      return reply.code(403).send({ error: 'Сначала войди в игровую комнату' });
    }
    const room = livekitRoomName(gameRoom.roomId);
    const token = await issueLiveKitToken({ id: player.id, name: player.name }, room);
    return { url: livekitUrl(req), token, room } satisfies VoiceTokenResponse;
  });

  // ---------- matchmake (wire-контракт @colyseus/sdk) ----------

  app.post<{ Params: { method: string; roomName: string } }>('/matchmake/:method/:roomName', async (req, reply) => {
    const { method, roomName } = req.params;
    if (!MATCHMAKE_METHODS.includes(method as MatchmakeMethod)) {
      return reply.code(400).send({ error: `invalid method "${method}"` });
    }
    if (!/^([a-zA-Z_\-0-9]+)$/.test(roomName)) {
      return reply.code(400).send({ error: `invalid room name "${roomName}"` });
    }
    const options = (req.body ?? {}) as Record<string, unknown>;
    const authContext = createAuthContext({
      headers: req.headers as Record<string, string | undefined>,
      token: getBearerToken(req.headers.authorization) ?? undefined,
    });
    try {
      // ISeatReservation — ответ, который ждёт @colyseus/sdk (см. Client.createMatchMakeRequest).
      const reservation = method === 'reconnect'
        ? await matchMaker.reconnect(roomName, options)
        : await matchMaker[method as Exclude<MatchmakeMethod, 'reconnect'>](roomName, options, authContext);
      return reservation;
    } catch (e) {
      return reply.code(matchmakeErrorStatus(e)).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ---------- debug / service ----------

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  app.get('/api/host', async () => ({ addresses: lanAddresses() }));

  app.get('/api/rooms', async () => {
    const rooms = await matchMaker.query({ name: CREW_ROOM });
    const listing: (RoomListing & { isPublic?: boolean })[] = rooms
      .filter((r) => !r.private)
      .map((r) => ({
        roomId: r.roomId,
        clients: r.clients,
        maxClients: r.maxClients,
        locked: !!r.locked,
        metadata: r.metadata,
        isPublic: roomManager.getManagedRoom(r.roomId)?.isPublic ?? true,
      }));
    return listing;
  });

  app.get('/api/managed-rooms', { preHandler: requireAuth }, async (): Promise<ManagedRoomInfo[]> => {
    return roomManager.listRooms();
  });

  app.get('/api/sessions', async () => sessions.list());

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { session, players: sessions.players(req.params.id) };
  });

  // ---------- статика клиента (prod) ----------

  if (fs.existsSync(config.clientDist)) {
    await app.register(fastifyStatic, { root: config.clientDist });

    app.setNotFoundHandler(async (req, reply) => {
      const url = req.url.split('?')[0] ?? '/';
      const isApi = /^(\/api|\/matchmake|\/room|\/auth|\/__healthcheck)(\/|$)/.test(url);
      if (req.method === 'GET' && !isApi && (req.headers.accept ?? '').includes('text/html')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}

async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = getBearerToken(req.headers.authorization);
  const player = token !== null ? await verifyToken(token) : null;
  if (player === null) {
    await reply.code(401).send({ error: 'Требуется авторизация: POST /auth/login' });
    return;
  }
  (req as AuthedRequest).player = player;
}

function normalizeName(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 20) : '';
  return name.length > 0 ? name : null;
}

/**
 * Публичный адрес LiveKit для браузера. Явный LIVEKIT_URL (нужен за прокси
 * или при Docker) важнее; иначе — тот же хост, что и у игры, порт 7880.
 */
function livekitUrl(req: FastifyRequest): string {
  if (config.livekit.url !== null) { return config.livekit.url; }
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ?? req.protocol;
  return `${proto === 'https' ? 'wss' : 'ws'}://${req.hostname}:${config.livekit.port}`;
}

/** Голосовой токен выдаём только тем, кто уже сидит в игровой комнате. */
function isRoomMember(
  room: { clients: Iterable<{ userData?: { playerId?: string } }> },
  playerId: string,
): boolean {
  for (const client of room.clients) {
    if (client.userData?.playerId === playerId) { return true; }
  }
  return false;
}

function matchmakeErrorStatus(e: unknown): number {
  if (/not found|no rooms|invalid room|has been disposed/i.test(e instanceof Error ? e.message : '')) {
    return 404;
  }
  if (e instanceof ServerError) {
    const code = Number(e.code);
    if (Number.isInteger(code) && code >= 400 && code < 600) { return code; }
  }
  return 500;
}
