import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  AGENT_BEHAVIOR_MAX,
  AGENT_PROFILES,
  DEFAULT_ADMIN_SETTINGS,
  type AdminSettings,
  type AdminStatsPayload,
  type ClientMetricsRow,
  type ClientStatsPayload,
} from '@chronolet/shared';

/**
 * Метрики клиентов комнаты для панели администратора.
 * Каждый клиент раз в секунду шлёт client.stats (FPS, пинг, худший кадр, память),
 * сервер дополняет их своими наблюдениями (сообщений/с, давность отчёта, время в комнате)
 * и держит минутное окно для min/max/среднего.
 */

const WINDOW_MS = 60_000;
const START = Date.now();

/** Задержка event loop процесса — одна на сервер, общая для всех комнат. */
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

interface Sample {
  ts: number;
  fps: number;
  ping: number;
}

interface Entry {
  joinedAt: number;
  last: ClientStatsPayload | null;
  lastAt: number;
  samples: Sample[];
  msgs: number;
  msgsPerSec: number;
}

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;

const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** Проверка и нормализация того, что прислал клиент: доверять нельзя никому. */
export function parseClientStats(msg: unknown): ClientStatsPayload | null {
  const m = msg as Partial<ClientStatsPayload> | null;
  if (!m || typeof m !== 'object') return null;
  const fps = num(m.fps, 0, 1000);
  const ping = num(m.ping, 0, 60_000);
  if (fps === null || ping === null) return null;
  const memMb = num(m.memMb, 0, 1e6);
  return {
    fps: round(fps, 1),
    ping: round(ping),
    frameMaxMs: round(num(m.frameMaxMs, 0, 60_000) ?? 0, 1),
    ...(memMb !== null ? { memMb: round(memMb) } : {}),
    hidden: m.hidden === true,
    viewport: typeof m.viewport === 'string' ? m.viewport.slice(0, 20) : '',
  };
}

export class ClientMetrics {
  private entries = new Map<string, Entry>();
  private lastRateAt = Date.now();

  join(sessionId: string) {
    this.entries.set(sessionId, { joinedAt: Date.now(), last: null, lastAt: 0, samples: [], msgs: 0, msgsPerSec: 0 });
  }

  leave(sessionId: string) {
    this.entries.delete(sessionId);
  }

  /** Любое входящее сообщение клиента — для счётчика сообщений/с. */
  countMessage(sessionId: string) {
    const e = this.entries.get(sessionId);
    if (e) e.msgs++;
  }

  report(sessionId: string, stats: ClientStatsPayload) {
    const e = this.entries.get(sessionId);
    if (!e) return;
    const now = Date.now();
    e.last = stats;
    e.lastAt = now;
    // Фоновая вкладка честно рисует ~0 FPS — в статистику окна её не берём.
    if (!stats.hidden) e.samples.push({ ts: now, fps: stats.fps, ping: stats.ping });
    while (e.samples.length && now - e.samples[0].ts > WINDOW_MS) e.samples.shift();
  }

  /** Сводка; вызывается раз в секунду. */
  build(
    who: (sessionId: string) => { name: string; connected: boolean; isAdmin: boolean } | null,
    room: { createdAt: number; levelId: string; epoch: number },
  ): AdminStatsPayload {
    const now = Date.now();
    const dt = Math.max(1, now - this.lastRateAt) / 1000;
    this.lastRateAt = now;

    const clients: ClientMetricsRow[] = [];
    for (const [sessionId, e] of this.entries) {
      e.msgsPerSec = round(e.msgs / dt, 1);
      e.msgs = 0;
      const info = who(sessionId);
      if (!info) continue;
      const s = e.samples;
      const pings = s.map((x) => x.ping);
      clients.push({
        sessionId,
        name: info.name,
        connected: info.connected,
        isAdmin: info.isAdmin,
        fps: e.last?.fps ?? 0,
        ping: e.last?.ping ?? 0,
        frameMaxMs: e.last?.frameMaxMs ?? 0,
        ...(e.last?.memMb !== undefined ? { memMb: e.last.memMb } : {}),
        hidden: e.last?.hidden ?? false,
        viewport: e.last?.viewport ?? '',
        pingMin: pings.length ? Math.min(...pings) : 0,
        pingMax: pings.length ? Math.max(...pings) : 0,
        fpsAvg: s.length ? round(s.reduce((a, x) => a + x.fps, 0) / s.length, 1) : 0,
        msgsPerSec: e.msgsPerSec,
        staleSec: e.lastAt ? round((now - e.lastAt) / 1000) : -1,
        onlineSec: round((now - e.joinedAt) / 1000),
        levelId: room.levelId,
      });
    }

    const live = clients.filter((c) => c.connected && c.staleSec >= 0 && c.staleSec <= 3);
    const visible = live.filter((c) => !c.hidden);
    const mem = process.memoryUsage();
    const lag = loopDelay.mean / 1e6;
    loopDelay.reset();
    return {
      ts: now,
      clients,
      summary: {
        count: clients.length,
        fpsAvg: visible.length ? round(visible.reduce((a, c) => a + c.fps, 0) / visible.length, 1) : 0,
        fpsMin: visible.length ? Math.min(...visible.map((c) => c.fps)) : 0,
        pingAvg: live.length ? round(live.reduce((a, c) => a + c.ping, 0) / live.length) : 0,
        pingMax: live.length ? Math.max(...live.map((c) => c.ping)) : 0,
      },
      server: {
        uptimeSec: round((now - START) / 1000),
        roomAgeSec: round((now - room.createdAt) / 1000),
        heapMb: round(mem.heapUsed / 2 ** 20),
        rssMb: round(mem.rss / 2 ** 20),
        // mean — средняя задержка срабатывания таймера разрешения 20 мс; вычитаем само разрешение.
        loopLagMs: Number.isFinite(lag) ? round(Math.max(0, lag - 20), 1) : 0,
        levelId: room.levelId,
        epoch: room.epoch,
      },
    };
  }
}

/** Слияние присланных настроек с текущими — с проверкой каждого поля. */
export function mergeAdminSettings(cur: AdminSettings, msg: unknown): AdminSettings {
  const m = (msg ?? {}) as Partial<AdminSettings>;
  const next: AdminSettings = { ...cur, agents: { ...cur.agents } };
  const main = num(m.mainNpcActivity, 0, 100);
  const sec = num(m.secondaryNpcActivity, 0, 100);
  if (main !== null) next.mainNpcActivity = Math.round(main);
  if (sec !== null) next.secondaryNpcActivity = Math.round(sec);
  if (m.agents && typeof m.agents === 'object') {
    for (const [id, o] of Object.entries(m.agents)) {
      if (!AGENT_PROFILES.some((a) => a.id === id) || !o || typeof o !== 'object') continue;
      const prev = next.agents[id] ?? { muted: false, behavior: '' };
      next.agents[id] = {
        muted: typeof o.muted === 'boolean' ? o.muted : prev.muted,
        behavior: typeof o.behavior === 'string' ? o.behavior.trim().slice(0, AGENT_BEHAVIOR_MAX) : prev.behavior,
      };
    }
  }
  return next;
}

export const defaultAdminSettings = (): AdminSettings => structuredClone(DEFAULT_ADMIN_SETTINGS);
