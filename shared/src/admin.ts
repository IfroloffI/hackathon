/**
 * Панель администратора комнаты. Администратор — хост (тот, кто создал комнату):
 * его имя лежит в `CrewState.host`. Метрики шлёт каждый клиент, сервер собирает
 * их в сводку и раз в секунду рассылает только подписанным администраторам.
 */

export const AdminMsg = {
  /** C→S, все клиенты: эхо для замера пинга. */
  Ping: 'net.ping',
  /** C→S, все клиенты: метрики клиента раз в секунду. */
  ClientStats: 'client.stats',
  /** C→S, админ: открыть/закрыть панель (подписка на сводку). */
  Subscribe: 'admin.subscribe',
  /** C→S, админ: поменять настройки (NPC, агенты). */
  Settings: 'admin.settings',
  /** C→S, админ: разовое действие над вселенной. */
  Command: 'admin.command',
} as const;

export const AdminServerMsg = {
  /** S→C: ответ на ping с тем же t. */
  Pong: 'net.pong',
  /** S→C, админ: сводка метрик. */
  Stats: 'admin.stats',
  /** S→C, админ: текущие настройки. */
  Settings: 'admin.settings',
  /** S→C, админ: результат команды. */
  Result: 'admin.result',
} as const;

export interface PingPayload {
  t: number;
}

/** Что клиент сообщает о себе раз в секунду. */
export interface ClientStatsPayload {
  fps: number;
  /** RTT до сервера, мс (последний замер). */
  ping: number;
  /** Худший кадр за секунду, мс — видно фризы, которых не видно в среднем FPS. */
  frameMaxMs: number;
  /** JS-heap, МБ (только Chromium). */
  memMb?: number;
  /** Вкладка в фоне — FPS там ≈ 0, это не лаг. */
  hidden: boolean;
  /** Ширина×высота окна. */
  viewport: string;
}

export interface ClientMetricsRow extends ClientStatsPayload {
  sessionId: string;
  name: string;
  connected: boolean;
  isAdmin: boolean;
  /** Минимум/максимум пинга за последнюю минуту. */
  pingMin: number;
  pingMax: number;
  /** Средний FPS за минуту. */
  fpsAvg: number;
  /** Сообщений от клиента в секунду (все типы). */
  msgsPerSec: number;
  /** Секунд с последнего отчёта: > 3 — клиент молчит. */
  staleSec: number;
  /** Секунд в комнате. */
  onlineSec: number;
  levelId: string;
}

export interface AdminStatsPayload {
  ts: number;
  clients: ClientMetricsRow[];
  summary: {
    count: number;
    fpsAvg: number;
    fpsMin: number;
    pingAvg: number;
    pingMax: number;
  };
  server: {
    uptimeSec: number;
    roomAgeSec: number;
    heapMb: number;
    rssMb: number;
    /** Загрузка event loop: задержка таймера сверх ожидаемой, мс. */
    loopLagMs: number;
    levelId: string;
    epoch: number;
  };
}

/** Поведение агента-персонажа, задаётся администратором. */
export interface AgentOverride {
  /** Агент молчит: ни заготовки, ни LLM-реплики не доходят до игроков. */
  muted: boolean;
  /** Указание ведущего — добавляется к персоне в системном промпте LLM. */
  behavior: string;
}

export interface AdminSettings {
  /** 0..100 — активность основных NPC (рассказчики эпох, ХРОНОС). Пока ни на что не влияет. */
  mainNpcActivity: number;
  /** 0..100 — активность второстепенных NPC. Пока ни на что не влияет. */
  secondaryNpcActivity: number;
  /** agentId → поведение. */
  agents: Record<string, AgentOverride>;
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  mainNpcActivity: 50,
  secondaryNpcActivity: 50,
  agents: {},
};

export type AdminCommand =
  /** Перенести экипаж: 'hub' или индекс эпохи (детали предыдущих эпох засчитываются). */
  | { type: 'goto'; level: 'hub' | number }
  | { type: 'rename'; crewName: string }
  | { type: 'announce'; text: string }
  | { type: 'resetCrates' }
  | { type: 'openGate' }
  | { type: 'giveCoins'; amount: number };

export interface AdminResult {
  ok: boolean;
  text: string;
}

export const AGENT_BEHAVIOR_MAX = 400;
