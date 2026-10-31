/**
 * Контракт «игровой сервер ↔ realtime-LLM» (версия chronolet.llm/1).
 *
 * Модель: LLM-сервис ПОДПИСЫВАЕТСЯ на поток событий и сам решает, когда говорить.
 * Игра никогда не ждёт LLM: у каждой реплики есть заготовленный фолбэк, а детали и правила
 * решает только сервер. Подробное описание — docs/LLM_CONTRACTS.md.
 *
 *   LLM ──WS──▶ /llm/stream?token=…&session=…&since=…   (события + снимки, сервер → LLM)
 *   LLM ──REST─▶ /llm/…                                   (реплики, подсказки, память, история)
 *
 * Авторизация: сервисный токен LLM_SERVICE_TOKEN — `Authorization: Bearer …` или `?token=` для WS.
 */
import type { GameEvent, GameEventType } from './events.ts';
import type { ScenarioDef } from './scenarios.ts';

export const LLM_PROTOCOL = 'chronolet.llm/1';

// ───────────────────────── Агенты

export interface AgentProfile {
  id: string;
  name: string;
  /** Кто это и как говорит — затравка для системного промпта. */
  persona: string;
  /** До какого года персонаж «знает мир»: позже — реагирует удивлением (анахронизмы). */
  knowsUntil: number | null;
  /** Уровень, где агент живёт (null — везде, бортовой ИИ). */
  levelId: string | null;
  /** Максимальная длина реплики, символов. Сервер обрезает длиннее. */
  maxChars: number;
}

export const AGENT_PROFILES: readonly AgentProfile[] = [
  { id: 'ship_ai', name: 'ХРОНОС', persona: 'Бортовой ИИ хронолёта. Вежливо-ядовитый, саркастичный, но заботится об экипаже. Помнит историю экипажа между эпохами. Подсказывает по нарастающей: намёк → направление → почти ответ.', knowsUntil: null, levelId: null, maxChars: 240 },
  { id: 'eratosthenes', name: 'Эратосфен', persona: 'Спокойный учитель, хранитель Александрийской библиотеки, любит вопросы. Объясняет через круг и доли.', knowsUntil: -200, levelId: 'alexandria', maxChars: 320 },
  { id: 'galileo', name: 'Галилей', persona: 'Вспыльчивый, ироничный, обижен на церковь. Опирается на наблюдения. Может сослаться на геометрию из первой эпохи.', knowsUntil: 1642, levelId: 'padua', maxChars: 320 },
  { id: 'newton', name: 'Ньютон', persona: 'Педантичный, нелюдимый, ревнив к чужим открытиям. Требует объяснить закономерность словами.', knowsUntil: 1700, levelId: 'woolsthorpe', maxChars: 320 },
  { id: 'turing', name: 'Тьюринг', persona: 'Застенчивый, точный, шутит сухо. Замечает угадывание и просит проверять гипотезы логически.', knowsUntil: 1954, levelId: 'bletchley', maxChars: 320 },
  { id: 'korolev', name: 'Королёв', persona: 'Жёсткий, деловой, торопит. Помнит неудачные пуски экипажа и меняет подсказки.', knowsUntil: 1966, levelId: 'baikonur', maxChars: 280 },
];

// ───────────────────────── Снимок сессии (состояние «сейчас»)

export interface CrewMemberSnapshot {
  id: string;
  name: string;
  connected: boolean;
  role: 'observer' | 'mechanic' | null;
  x: number;
  y: number;
  /** Секунд без движения — повод для комментария ХРОНОСа. */
  idleSeconds: number;
  coins: number;
  xp: number;
  level: number;
  skin: string;
  /** Падений в яму за текущую эпоху. */
  falls: number;
}

export interface SessionSnapshot {
  session: string;
  crewName: string;
  ts: number;
  levelId: string;
  /** Индекс текущей эпохи 0..5 (5 — все детали собраны). */
  epoch: number;
  parts: string[];
  finished: boolean;
  scenario: {
    id: string;
    stepId: string;
    stepTitle: string;
    goal: string;
    stepStartedAt: number;
    parSeconds: number | null;
  } | null;
  puzzle: {
    id: string;
    title: string;
    stage: string;
    attempts: number;
    solved: boolean;
    hintsGiven: number;
    /** Тексты подсказок ТЕКУЩЕЙ партии (уровни 1..3). LLM их перефразирует, а не придумывает свои. */
    hints: string[];
    /** Какой уровень подсказки сервер дал бы следующим (по правилу «каждые 2 ошибки»), null — все выданы. */
    nextHintLevel: 1 | 2 | 3 | null;
  } | null;
  crew: CrewMemberSnapshot[];
  /** Последний seq события этой сессии на момент снимка. */
  lastSeq: number;
}

// ───────────────────────── Поток: сервер → LLM (WS /llm/stream)

export type LlmStreamMessage =
  | { type: 'hello'; protocol: typeof LLM_PROTOCOL; serverTs: number; sessions: string[]; lastSeq: number }
  /** Событие: живое или из реплея (?since=seq). replay=true — догоняем историю. */
  | { type: 'event'; event: GameEvent; replay?: boolean }
  /** Снимок сессии: раз в 2 с и сразу при смене шага сценария/уровня. */
  | { type: 'snapshot'; snapshot: SessionSnapshot }
  | { type: 'heartbeat'; serverTs: number }
  | { type: 'error'; message: string };

/** Событие, на которое ждут ответа LLM: игрок спросил агента. Сервер ждёт /llm/say с replyTo до ASK_TIMEOUT_MS, потом отвечает заготовкой. */
export const ASK_TIMEOUT_MS = 3000;

/**
 * Отвечаемые события (data.replyable === true): agent.ask, puzzle.failed, puzzle.stage, puzzle.solved.
 * Пока LLM слушает сессию, сервер НЕ говорит сразу, а откладывает заготовку (data.fallback) на
 * REACT_TIMEOUT_MS (для agent.ask — ASK_TIMEOUT_MS). Первый кусок /llm/say или /llm/hint с replyTo —
 * «захват»: короткий таймер снимается, на финал (final=true) даётся STREAM_DEADLINE_MS, иначе сервер
 * закроет поток накопленным текстом (или, если текста нет, скажет заготовку). Ответ с replyTo после
 * того, как заготовка уже прозвучала, — 409 late и игроку не показывается: двойного голоса нет.
 * «Отказ»: финальный кусок с replyTo и пустым text — сервер сразу говорит заготовку (LLM не успевает).
 * На остальные события сервер говорит заготовками сам — LLM на них не отвечает (кроме idle: заготовки нет).
 */
export const REACT_TIMEOUT_MS = 2500;
export const STREAM_DEADLINE_MS = 15000;

/** Что лежит в data у отвечаемых событий (помимо полей конкретного события). */
export interface ReplyableData {
  replyable: true;
  /** Агент, который должен ответить. */
  agentId: string;
  /** Заготовка, которая прозвучит, если LLM не ответит в срок. */
  fallback: string | null;
  /** Для puzzle.failed: подсказка, которую сервер дал бы сейчас — её и надо перефразировать (через /llm/hint). */
  hint?: { level: 1 | 2 | 3; text: string } | null;
}

// ───────────────────────── REST: LLM → сервер

/** POST /llm/say — реплика агента. Стриминг: несколько вызовов с одним streamId, последний с final=true. */
export interface LlmSayRequest {
  session: string;
  agentId: string;
  /** Полный текст (без streamId) или очередной кусок (со streamId). */
  text: string;
  /** Адресат-игрок (id); без него — всему экипажу. */
  to?: string;
  /** seq события agent.ask, на которое это ответ, — тогда заготовка не прозвучит. */
  replyTo?: number;
  streamId?: string;
  final?: boolean;
}

/** POST /llm/hint — подсказка бортового ИИ. */
export interface LlmHintRequest {
  session: string;
  level: 1 | 2 | 3;
  text: string;
  /** seq отвечаемого события (обычно puzzle.failed с data.hint) — правила как у /llm/say. */
  replyTo?: number;
  streamId?: string;
  final?: boolean;
  to?: string;
}

/** POST /llm/memory — что агент запомнил об игроке (agent_memory). */
export interface LlmMemoryRequest {
  agentId: string;
  playerId: string;
  toldCards?: string[];
  mistakes?: string[];
  summary?: string;
}

export interface LlmMemory {
  agentId: string;
  playerId: string;
  toldCards: string[];
  mistakes: string[];
  summary: string | null;
  updatedAt: number | null;
}

export interface LlmAck {
  ok: boolean;
  /** seq события agent.say/hint, если записано. */
  seq?: number;
  error?: string;
}

// ───────────────────────── REST: история и контент

/** GET /llm/sessions/:id/events?since=&types=&limit= */
export interface LlmEventsResponse {
  events: GameEvent[];
  lastSeq: number;
}

/** GET /llm/sessions/:id/series?metric=&bucket=&from=&to= — агрегаты временных рядов DuckDB. */
export type SeriesMetric =
  /** Сколько событий каждого типа в окне. */
  | 'events'
  /** Пройденная дистанция и число точек телеметрии на игрока в окне. */
  | 'activity'
  /** Последняя позиция игрока в окне (arg_max по времени). */
  | 'positions'
  /** Неудачные попытки и подсказки в окне. */
  | 'struggle';

export interface SeriesPoint {
  /** Начало окна, unix ms. */
  t: number;
  /** Разрез: тип события или id игрока. */
  key: string;
  values: Record<string, number>;
}

export interface LlmSeriesResponse {
  metric: SeriesMetric;
  bucketMs: number;
  points: SeriesPoint[];
}

/** GET /llm/content — всё статичное, что нужно для промптов: агенты, сценарии, типы событий. */
export interface LlmContentResponse {
  protocol: typeof LLM_PROTOCOL;
  agents: readonly AgentProfile[];
  scenarios: readonly ScenarioDef[];
  eventTypes: GameEventType[];
  /** Справочно: головоломки, роли и шаблоны подсказок (тексты конкретной партии — в snapshot.puzzle.hints). */
  puzzles: { id: string; title: string; levelId: string; observer: string; mechanic: string }[];
}
