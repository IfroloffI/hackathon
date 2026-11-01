/**
 * Механики полосы препятствий — общие для клиента (свой игрок), сервера (ящики) и тестов проходимости.
 * - Ящики: толкаются боком, падают под силой тяжести, заполняют ямы. Состояние держит сервер.
 * - Батуты: в physics.ts (приземление на kind 'trampoline' подбрасывает).
 * - Вентиляторы: горизонтальный поток вдоль дорожки, работают по таймеру; любой твёрдый объект — укрытие.
 * - Стрелы: летят залпами по таймеру; попадание (и ров) — назад к чекпоинту. Твёрдое (в т. ч. ящик) их останавливает.
 * Таймеры считаются от общего «часового» времени (секунды Unix) — у всех игроков фаза одна и та же.
 */
import { PHYSICS, PLAYER_SIZE } from './constants.ts';
import type { Level, Platform } from './level.ts';
import type { Body } from './physics.ts';

export interface CrateDef {
  id: string;
  /** Центр по X и низ ящика в исходном положении. */
  x: number;
  y: number;
  /** Ширина и высота (по глубине ящик всегда на всю дорожку). */
  s: number;
  color?: number;
  /** Куда ящик должен встать по задумке уровня (центр X, низ) — проверяется тестом проходимости. */
  solve?: { x: number; y: number };
}

export interface CratePos {
  id: string;
  x: number;
  y: number;
}

export interface FanDef {
  /** Где стоит вентилятор (низ потока), dir — куда дует, len — длина потока, h — его высота. */
  x: number;
  y: number;
  dir: 1 | -1;
  len: number;
  h: number;
  /** Полоса по глубине; без них — вся дорожка. */
  z?: number;
  d?: number;
  /** Сила потока (ед/с, бег — 6). */
  strength?: number;
  /** Цикл: period секунд, из них on — дует. Без period — дует всегда. */
  period?: number;
  on?: number;
  phase?: number;
}

export interface ArrowTrap {
  /** Откуда вылетают стрелы и на какой высоте летят. */
  x: number;
  y: number;
  dir: 1 | -1;
  range: number;
  z?: number;
  d?: number;
  speed?: number;
  /** Залп раз в period секунд, сдвиг фазы — чтобы ловушки били вразнобой. */
  period?: number;
  phase?: number;
}

export const CRATE_PUSH_SPEED = 2.6;
/** Сколько живёт одно «толкаю» от клиента (клиент шлёт их ~10 Гц, пока упирается). */
export const CRATE_PUSH_TTL_MS = 220;
const FAN_STRENGTH = 9;
/** Выше этого ветер не разгоняет: сервер режет скорость > runSpeed·speedTolerance. */
export const MAX_WIND_VX = PHYSICS.runSpeed * 1.4;
const ARROW_SPEED = 8;
const ARROW_HALF = 0.45;
const LANE_HALF = 1.9;
const EPS = 1e-4;

const halfW = PLAYER_SIZE.w / 2;
const halfD = PLAYER_SIZE.d / 2;

/** Часы механик: секунды Unix. Клиент берёт Date.now(), тесты — что угодно. */
export const mechClock = () => Date.now() / 1000;

const mod = (a: number, n: number) => ((a % n) + n) % n;

// ───────────────────────── ящики

/** Ящик как твёрдая платформа: ограничен дорожкой (z 0, d 3.2) — в ветки его не утащить. */
export function cratePlatform(def: CrateDef, pos: { x: number; y: number }): Platform {
  return { x: pos.x, y: pos.y + def.s / 2, w: def.s, h: def.s, z: 0, d: 3.2, color: def.color ?? 0xb5763d, kind: 'crate' };
}

/** Уровень, где ящики стоят в данных позициях (для физики игрока и тестов). Без ящиков — тот же объект. */
export function withCrates(level: Level, positions: readonly CratePos[]): Level {
  if (!level.crates?.length) return level;
  const extra: Platform[] = [];
  for (const def of level.crates) {
    const p = positions.find((c) => c.id === def.id) ?? def;
    extra.push(cratePlatform(def, p));
  }
  return { ...level, platforms: [...level.platforms, ...extra] };
}

/** Ящики в исходных/решённых позициях — для тестов и офлайн-витрины. */
export const cratesAtHome = (level: Level): CratePos[] => (level.crates ?? []).map((c) => ({ id: c.id, x: c.x, y: c.y }));
export const cratesSolved = (level: Level): CratePos[] => (level.crates ?? []).map((c) => ({ id: c.id, ...(c.solve ?? c) }));

/** В какой ящик упирается тело, идя в сторону dir (стоя на опоре). */
export function crateAhead(body: Body, dir: number, level: Level, positions: readonly CratePos[]): string | null {
  if (!dir || !level.crates) return null;
  for (const def of level.crates) {
    const c = positions.find((p) => p.id === def.id);
    if (!c) continue;
    if (body.y >= c.y + def.s - 0.05 || body.y + PLAYER_SIZE.h <= c.y + 0.05) continue;
    const side = dir > 0 ? c.x - def.s / 2 - (body.x + halfW) : body.x - halfW - (c.x + def.s / 2);
    if (Math.abs(side) < 0.08) return def.id;
  }
  return null;
}

/** Может ли игрок с серверной позицией p толкать ящик (допуск на лаг пакетов). */
export function canPush(p: { x: number; y: number }, dir: number, def: CrateDef, c: CratePos): boolean {
  if (p.y >= c.y + def.s - 0.05 || p.y + PLAYER_SIZE.h <= c.y + 0.05) return false;
  const gap = dir > 0 ? c.x - def.s / 2 - (p.x + halfW) : p.x - halfW - (c.x + def.s / 2);
  return gap > -0.4 && gap < 0.9;
}

export interface CrateBody extends CratePos {
  vy: number;
  /** Куда сейчас толкают (0 — никто). */
  push: number;
}

/**
 * Шаг ящиков (сервер, ~30 Гц): толкаемые едут по X со скоростью CRATE_PUSH_SPEED, упираясь в твёрдое
 * и в другие ящики; без опоры падают; упавший в бездну возвращается домой. Меняет crates на месте.
 */
export function stepCrates(level: Level, crates: CrateBody[], dt: number) {
  const defs = new Map((level.crates ?? []).map((d) => [d.id, d]));
  const solids = level.platforms.filter((p) => !p.ghost);
  const boxOf = (c: CrateBody) => {
    const s = defs.get(c.id)!.s;
    return { left: c.x - s / 2, right: c.x + s / 2, bottom: c.y, top: c.y + s };
  };
  const obstacles = (self: CrateBody) => [
    ...solids.map((p) => ({ left: p.x - p.w / 2, right: p.x + p.w / 2, bottom: p.y - p.h / 2, top: p.y + p.h / 2 })),
    ...crates.filter((o) => o !== self).map(boxOf),
  ];
  for (const c of crates) {
    const def = defs.get(c.id);
    if (!def) continue;
    const s = def.s;
    if (c.push) {
      let nx = c.x + c.push * CRATE_PUSH_SPEED * dt;
      for (const o of obstacles(c)) {
        if (c.y + s <= o.bottom + EPS || c.y >= o.top - EPS) continue;
        if (c.push > 0 && c.x + s / 2 <= o.left + EPS && nx + s / 2 > o.left) nx = o.left - s / 2;
        if (c.push < 0 && c.x - s / 2 >= o.right - EPS && nx - s / 2 < o.right) nx = o.right + s / 2;
      }
      c.x = Math.min(level.bounds.maxX - s / 2, Math.max(level.bounds.minX + s / 2, nx));
    }
    // Сила тяжести: ищем самую высокую опору под ящиком.
    c.vy = Math.max(c.vy - PHYSICS.gravity * dt, -20);
    let ny = c.y + c.vy * dt;
    for (const o of obstacles(c)) {
      if (c.x + s / 2 <= o.left + EPS || c.x - s / 2 >= o.right - EPS) continue;
      if (c.y >= o.top - EPS && ny < o.top) {
        ny = o.top;
        c.vy = 0;
      }
    }
    c.y = ny;
    if (c.y < level.bounds.minY) Object.assign(c, { x: def.x, y: def.y, vy: 0, push: 0 });
  }
}

// ───────────────────────── ветер и стрелы

type Box = { left: number; right: number; bottom: number; top: number; back: number; front: number };
const boxOfPlatform = (p: Platform): Box => ({
  left: p.x - p.w / 2,
  right: p.x + p.w / 2,
  bottom: p.y - p.h / 2,
  top: p.y + p.h / 2,
  back: p.d === undefined ? -Infinity : (p.z ?? 0) - p.d / 2,
  front: p.d === undefined ? Infinity : (p.z ?? 0) + p.d / 2,
});

/** Полоса по глубине: без z/d — вся дорожка. */
const laneOf = (o: { z?: number; d?: number }) => (o.d === undefined ? { back: -LANE_HALF, front: LANE_HALF } : { back: (o.z ?? 0) - o.d / 2, front: (o.z ?? 0) + o.d / 2 });

/** Ближайшая к источнику твёрдая преграда на луче [from → from+dir·len] в полосе высот y0..y1 и глубин lane. */
function blockedAt(level: Level, from: number, dir: number, len: number, y0: number, y1: number, lane: { back: number; front: number }): number {
  let reach = len;
  for (const p of level.platforms) {
    if (p.ghost) continue;
    const b = boxOfPlatform(p);
    if (b.top <= y0 + EPS || b.bottom >= y1 - EPS || b.front <= lane.back || b.back >= lane.front) continue;
    const dist = dir > 0 ? b.left - from : from - b.right;
    if (dist >= -EPS && dist < reach) reach = Math.max(0, dist);
  }
  return reach;
}

/** Дует ли вентилятор сейчас. */
export function fanOn(f: FanDef, now: number): boolean {
  return !f.period || mod(now + (f.phase ?? 0), f.period) < (f.on ?? f.period / 2);
}

/** Докуда сейчас доходит поток (с учётом укрытий и ящиков). */
export function fanReach(level: Level, f: FanDef): number {
  return blockedAt(level, f.x, f.dir, f.len, f.y, f.y + f.h, laneOf(f));
}

/** Горизонтальная скорость ветра в точке тела (0 — тихо). level — уже с ящиками. */
export function windAt(level: Level, body: Body, now: number): number {
  let vx = 0;
  for (const f of level.fans ?? []) {
    if (!fanOn(f, now)) continue;
    if (body.y >= f.y + f.h || body.y + PLAYER_SIZE.h <= f.y) continue;
    const lane = laneOf(f);
    if (body.z + halfD <= lane.back || body.z - halfD >= lane.front) continue;
    const dist = (body.x - f.x) * f.dir;
    if (dist < 0) continue;
    // Укрытие считаем по полосе высот самого тела: стоишь за камнем — не сдувает.
    const reach = blockedAt(level, f.x, f.dir, f.len, Math.max(f.y, body.y), Math.min(f.y + f.h, body.y + PLAYER_SIZE.h), lane);
    if (dist - halfW > reach) continue;
    vx += f.dir * (f.strength ?? FAN_STRENGTH) * (1 - 0.35 * Math.min(1, dist / f.len));
  }
  return vx;
}

/** Центры летящих сейчас стрел ловушки (X). level — уже с ящиками: стрела гаснет о первое твёрдое. */
export function arrowsInFlight(level: Level, t: ArrowTrap, now: number): number[] {
  const speed = t.speed ?? ARROW_SPEED;
  const period = t.period ?? 1.8;
  const reach = blockedAt(level, t.x, t.dir, t.range, t.y - 0.05, t.y + 0.05, laneOf(t));
  const out: number[] = [];
  for (let age = mod(now + (t.phase ?? 0), period); age * speed <= reach; age += period) out.push(t.x + t.dir * (age * speed + ARROW_HALF));
  return out;
}

/** Попала ли стрела в тело. */
export function arrowHit(level: Level, body: Body, now: number): boolean {
  for (const t of level.arrows ?? []) {
    if (t.y < body.y - 0.05 || t.y > body.y + PLAYER_SIZE.h) continue;
    const lane = laneOf(t);
    if (body.z + halfD <= lane.back || body.z - halfD >= lane.front) continue;
    for (const x of arrowsInFlight(level, t, now)) if (Math.abs(x - body.x) < halfW + ARROW_HALF) return true;
  }
  return false;
}

/** Окунулся во «ров» (kind 'moat', ghost) — как падение в яму. */
export function inMoat(level: Level, body: Body): boolean {
  for (const p of level.platforms) {
    if (p.kind !== 'moat') continue;
    const top = p.y + p.h / 2;
    if (body.y < top - 0.15 && body.y > top - 3 && Math.abs(body.x - p.x) < p.w / 2) return true;
  }
  return false;
}
