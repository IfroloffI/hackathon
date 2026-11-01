import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AGENT_PROFILES,
  EPOCHS,
  type LlmAck,
  type PuzzleId,
  LLM_PROTOCOL,
  SCENARIOS,
  type GameEventType,
  type LlmContentResponse,
  type LlmEventsResponse,
  type LlmHintRequest,
  type LlmMemoryRequest,
  type LlmSayRequest,
  type LlmVoiceRequest,
  type LlmSeriesResponse,
  type SeriesMetric,
} from '@chronolet/shared';
import { config } from '../config.ts';
import { timeseries } from '../timeseries/store.ts';
import { agentMemory } from '../db/repositories.ts';
import { llmHub } from './hub.ts';

const METRICS: SeriesMetric[] = ['events', 'activity', 'positions', 'struggle'];
const EVENT_TYPES: GameEventType[] = [
  'session.start', 'session.end', 'player.join', 'player.leave', 'level.enter', 'scenario.step', 'scenario.bonus',
  'role.take', 'role.leave', 'puzzle.action', 'puzzle.failed', 'puzzle.stage', 'puzzle.solved', 'part.awarded',
  'coin.pickup', 'fall', 'chat', 'agent.ask', 'agent.say', 'gate.answer', 'gate.open', 'hint', 'achievement', 'xp', 'like', 'emote', 'shop.buy',
  'idle', 'finale', 'admin.settings', 'admin.command',
];

/** Что видит/делает каждая роль — справка для промптов (данные партии — в снимке и событиях). */
const PUZZLE_ROLES: Record<PuzzleId, { observer: string; mechanic: string }> = {
  eratosthenes: { observer: 'в Сиене: знает расстояние до Александрии, видит, что тени нет', mechanic: 'в Александрии: совмещает дугу гномона с тенью, набирает число на счётах' },
  galileo: { observer: 'смотрит в телескоп: фаза Венеры, облака, спутники Юпитера', mechanic: 'крутит модель: схема (Земля/Солнце в центре), положение Венеры, число спутников' },
  newton: { observer: 'видит мишень, ветер на флюгере и где упало ядро', mechanic: 'задаёт скорость и угол пушки, полёта не видит' },
  enigma: { observer: 'видит перехват, ищет позицию WETTERBERICHT, диктует пары букв', mechanic: 'крутит три ротора по таблицам замен' },
  korolev: { observer: 'видит формулу Циолковского и телеметрию пусков', mechanic: 'собирает ступени (баки, двигатели), видит массы' },
};

/** 409 — ответ опоздал (заготовка уже прозвучала), иначе 400 на ошибку. */
const ackStatus = (ack: LlmAck) => (ack.ok ? 200 : ack.error === 'late' ? 409 : 400);

/** «10s», «1m», «500ms» или число мс. */
function parseBucket(v: unknown): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(String(v ?? '10s'));
  if (!m) return 10_000;
  const n = Number(m[1]);
  return Math.max(100, m[2] === 'm' ? n * 60_000 : m[2] === 'ms' ? n : n * 1000);
}

/**
 * REST-часть контракта chronolet.llm/1 (см. shared/src/llm.ts, docs/LLM_CONTRACTS.md).
 * Все маршруты — только с сервисным токеном LLM_SERVICE_TOKEN.
 */
export function registerLlmRoutes(app: FastifyInstance) {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (token !== config.llmToken) return reply.code(401).send({ ok: false, error: 'LLM service token required' });
  };
  const session = (id: string, reply: FastifyReply) => {
    const ctl = llmHub.get(id);
    if (!ctl) void reply.code(404).send({ ok: false, error: `session ${id} not active` });
    return ctl;
  };

  app.register(async (llm) => {
    llm.addHook('preHandler', guard);

    llm.get('/llm/content', async (): Promise<LlmContentResponse> => ({
      protocol: LLM_PROTOCOL,
      agents: AGENT_PROFILES,
      scenarios: SCENARIOS,
      eventTypes: EVENT_TYPES,
      puzzles: EPOCHS.map((e) => ({ id: e.puzzle.id, title: e.puzzle.title, levelId: e.levelId, ...PUZZLE_ROLES[e.puzzle.id] })),
    }));

    llm.get('/llm/sessions', async () => ({ sessions: llmHub.list().map((id) => llmHub.get(id)!.snapshot()) }));

    llm.get<{ Params: { id: string } }>('/llm/sessions/:id/snapshot', async (req, reply) => session(req.params.id, reply)?.snapshot());

    llm.get<{ Params: { id: string }; Querystring: { since?: string; types?: string; limit?: string } }>(
      '/llm/sessions/:id/events',
      async (req): Promise<LlmEventsResponse> => {
        const types = req.query.types ? req.query.types.split(',').filter(Boolean) : null;
        const limit = Math.min(5000, Math.max(1, Number(req.query.limit ?? 500)));
        const events = await timeseries.eventsSince(req.params.id, Number(req.query.since ?? 0), types, limit);
        return { events, lastSeq: timeseries.lastSeq };
      },
    );

    llm.get<{ Params: { id: string }; Querystring: { metric?: string; bucket?: string; from?: string; to?: string } }>(
      '/llm/sessions/:id/series',
      async (req, reply): Promise<LlmSeriesResponse | void> => {
        const metric = (req.query.metric ?? 'events') as SeriesMetric;
        if (!METRICS.includes(metric)) return reply.code(400).send({ ok: false, error: `metric: ${METRICS.join('|')}` });
        const bucketMs = parseBucket(req.query.bucket);
        const to = Number(req.query.to ?? Date.now());
        const from = Number(req.query.from ?? to - 15 * 60_000);
        return { metric, bucketMs, points: await timeseries.series(req.params.id, metric, bucketMs, from, to) };
      },
    );

    llm.post<{ Body: LlmSayRequest }>('/llm/say', async (req, reply) => {
      const ctl = session(req.body?.session, reply);
      if (!ctl) return;
      const ack = ctl.say(req.body);
      return reply.code(ackStatus(ack)).send(ack);
    });

    llm.post<{ Body: LlmVoiceRequest }>('/llm/voice', async (req, reply) => {
      const ctl = session(req.body?.session, reply);
      if (!ctl) return;
      const ack = await ctl.voice(req.body);
      return reply.code(ackStatus(ack)).send(ack);
    });

    llm.post<{ Body: LlmHintRequest }>('/llm/hint', async (req, reply) => {
      const ctl = session(req.body?.session, reply);
      if (!ctl) return;
      const ack = ctl.hint(req.body);
      return reply.code(ackStatus(ack)).send(ack);
    });

    llm.post<{ Body: LlmMemoryRequest }>('/llm/memory', async (req, reply) => {
      const b = req.body;
      if (!b?.agentId || !b.playerId) return reply.code(400).send({ ok: false, error: 'agentId and playerId required' });
      agentMemory.set(b.agentId, b.playerId, { toldCards: b.toldCards, mistakes: b.mistakes, summary: b.summary });
      return { ok: true };
    });

    llm.get<{ Params: { agentId: string; playerId: string } }>('/llm/memory/:agentId/:playerId', async (req) =>
      agentMemory.get(req.params.agentId, req.params.playerId),
    );
  });
}
