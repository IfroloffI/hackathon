import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';
import type { GameEvent, SeriesMetric, SeriesPoint, TelemetrySample } from '@chronolet/shared';

/**
 * Хранилище временных рядов на DuckDB (встраиваемая колоночная СУБД, один файл, без сервиса).
 * Две таблицы-ряда: events (все игровые события) и telemetry (позиции ~5 Гц).
 * Запись — пакетами через Appender раз в FLUSH_MS; чтение — оконные агрегаты time_bucket.
 * Сущности (игроки, профили, сессии) остаются в SQLite — это OLTP, а не ряды.
 */
const FLUSH_MS = 500;
const RING_SIZE = 5000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  seq BIGINT, ts BIGINT, session VARCHAR, type VARCHAR, level VARCHAR,
  scenario VARCHAR, step VARCHAR, player_id VARCHAR, player_name VARCHAR, data VARCHAR
);
CREATE TABLE IF NOT EXISTS telemetry (
  ts BIGINT, session VARCHAR, player_id VARCHAR, level VARCHAR,
  x DOUBLE, y DOUBLE, z DOUBLE, anim VARCHAR
);
`;

const num = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number));

export class TimeSeriesStore {
  private conn!: DuckDBConnection;
  private events: GameEvent[] = [];
  private telemetry: TelemetrySample[] = [];
  /** Последние события в памяти — реплей для LLM без похода в БД. */
  private ring: GameEvent[] = [];
  private seq = 0;
  private timer?: NodeJS.Timeout;
  private flushing: Promise<void> = Promise.resolve();

  async open(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = await DuckDBInstance.create(file);
    this.conn = await db.connect();
    await this.conn.run(SCHEMA);
    const r = await this.conn.runAndReadAll('SELECT coalesce(max(seq), 0) AS s FROM events');
    this.seq = num(r.getRowObjectsJson()[0].s);
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  nextSeq(): number {
    return ++this.seq;
  }

  get lastSeq(): number {
    return this.seq;
  }

  appendEvent(e: GameEvent) {
    this.events.push(e);
    this.ring.push(e);
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
  }

  appendTelemetry(s: TelemetrySample) {
    this.telemetry.push(s);
  }

  /** Сбросить накопленное в DuckDB (Appender — самый быстрый путь вставки). Вызовы сериализуются. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.doFlush()).catch((e) => console.error('[timeseries] flush failed', e));
    return this.flushing;
  }

  private async doFlush() {
    if (this.events.length) {
      const batch = this.events;
      this.events = [];
      const a = await this.conn.createAppender('events');
      for (const e of batch) {
        a.appendBigInt(BigInt(e.seq));
        a.appendBigInt(BigInt(e.ts));
        a.appendVarchar(e.session);
        a.appendVarchar(e.type);
        a.appendVarchar(e.level);
        e.scenario === null ? a.appendNull() : a.appendVarchar(e.scenario);
        e.step === null ? a.appendNull() : a.appendVarchar(e.step);
        e.player ? a.appendVarchar(e.player.id) : a.appendNull();
        e.player ? a.appendVarchar(e.player.name) : a.appendNull();
        a.appendVarchar(JSON.stringify(e.data));
        a.endRow();
      }
      a.closeSync();
    }
    if (this.telemetry.length) {
      const batch = this.telemetry;
      this.telemetry = [];
      const a = await this.conn.createAppender('telemetry');
      for (const s of batch) {
        a.appendBigInt(BigInt(Math.round(s.ts)));
        a.appendVarchar(s.session);
        a.appendVarchar(s.playerId);
        a.appendVarchar(s.level);
        a.appendDouble(s.x);
        a.appendDouble(s.y);
        a.appendDouble(s.z);
        a.appendVarchar(s.anim);
        a.endRow();
      }
      a.closeSync();
    }
  }

  /** События сессии после seq (реплей для LLM). Свежие — из памяти, старые — из DuckDB. */
  async eventsSince(session: string | null, since: number, types: string[] | null, limit: number): Promise<GameEvent[]> {
    const match = (e: GameEvent) => e.seq > since && (!session || e.session === session) && (!types || types.includes(e.type));
    const oldest = this.ring[0]?.seq ?? Infinity;
    if (since + 1 >= oldest) return this.ring.filter(match).slice(0, limit);

    await this.flush();
    const params: (string | number)[] = [since];
    let sql = 'SELECT * FROM events WHERE seq > ?';
    if (session) {
      sql += ' AND session = ?';
      params.push(session);
    }
    if (types?.length) {
      sql += ` AND type IN (${types.map(() => '?').join(',')})`;
      params.push(...types);
    }
    sql += ' ORDER BY seq LIMIT ?';
    params.push(limit);
    const r = await this.conn.runAndReadAll(sql, params);
    return r.getRowObjectsJson().map((row) => ({
      seq: num(row.seq),
      ts: num(row.ts),
      session: String(row.session),
      type: row.type as GameEvent['type'],
      level: String(row.level),
      scenario: (row.scenario as string | null) ?? null,
      step: (row.step as string | null) ?? null,
      player: row.player_id ? { id: String(row.player_id), name: String(row.player_name) } : null,
      data: JSON.parse(String(row.data)),
    }));
  }

  /** Агрегаты по окнам времени — основа «временных рядов» для LLM и аналитики. */
  async series(session: string, metric: SeriesMetric, bucketMs: number, from: number, to: number): Promise<SeriesPoint[]> {
    await this.flush();
    const bucket = `epoch_ms(time_bucket(to_milliseconds(${Math.max(100, Math.floor(bucketMs))}), epoch_ms(ts)))`;
    let sql: string;
    switch (metric) {
      case 'events':
        sql = `SELECT ${bucket} AS t, type AS key, count(*) AS n FROM events
               WHERE session = ? AND ts BETWEEN ? AND ? GROUP BY ALL ORDER BY t, key`;
        break;
      case 'struggle':
        sql = `SELECT ${bucket} AS t, 'crew' AS key,
                 count(*) FILTER (WHERE type = 'puzzle.failed') AS fails,
                 count(*) FILTER (WHERE type = 'hint') AS hints,
                 count(*) FILTER (WHERE type = 'fall') AS falls,
                 count(*) FILTER (WHERE type = 'puzzle.stage') AS stages
               FROM events WHERE session = ? AND ts BETWEEN ? AND ? GROUP BY ALL ORDER BY t`;
        break;
      case 'activity':
        sql = `WITH d AS (
                 SELECT ts, player_id, level,
                   sqrt(pow(x - lag(x) OVER w, 2) + pow(y - lag(y) OVER w, 2)) AS dist
                 FROM telemetry WHERE session = ? AND ts BETWEEN ? AND ?
                 WINDOW w AS (PARTITION BY player_id, level ORDER BY ts))
               SELECT ${bucket} AS t, player_id AS key, round(coalesce(sum(dist), 0), 3) AS distance, count(*) AS samples
               FROM d GROUP BY ALL ORDER BY t, key`;
        break;
      case 'positions':
        sql = `SELECT ${bucket} AS t, player_id AS key, arg_max(x, ts) AS x, arg_max(y, ts) AS y, arg_max(z, ts) AS z
               FROM telemetry WHERE session = ? AND ts BETWEEN ? AND ? GROUP BY ALL ORDER BY t, key`;
        break;
    }
    const r = await this.conn.runAndReadAll(sql, [session, from, to]);
    return r.getRowObjectsJson().map((row) => {
      const { t, key, ...rest } = row;
      const values: Record<string, number> = {};
      for (const [k, v] of Object.entries(rest)) values[k === 'n' ? 'count' : k] = num(v);
      return { t: num(t), key: String(key), values };
    });
  }

  /** Сколько строк в рядах — для /api/health и тестов. */
  async counts(): Promise<{ events: number; telemetry: number }> {
    await this.flush();
    const r = await this.conn.runAndReadAll('SELECT (SELECT count(*) FROM events) AS e, (SELECT count(*) FROM telemetry) AS t');
    const row = r.getRowObjectsJson()[0];
    return { events: num(row.e), telemetry: num(row.t) };
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
    this.conn.closeSync();
  }
}

export const timeseries = new TimeSeriesStore();
