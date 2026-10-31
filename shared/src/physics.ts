import { PLAYER_SIZE } from './constants.ts';
import type { Level, Platform } from './level.ts';

/** Тело игрока: x/z — центр, y — низ (ступни). */
export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface CollisionResult {
  grounded: boolean;
  hitCeiling: boolean;
  hitWall: boolean;
}

/** Максимальный шаг за под-итерацию — меньше самой тонкой платформы (0.4), чтобы не проскакивать насквозь. */
const MAX_SUBSTEP = 0.2;
const EPS = 1e-4;

const halfW = PLAYER_SIZE.w / 2;
const halfD = PLAYER_SIZE.d / 2;
const height = PLAYER_SIZE.h;

const edgeCache = new WeakMap<Platform, ReturnType<typeof computeEdges>>();
/** Границы платформы кэшируются: уровни неизменяемы, а физика зовёт это сотни раз за кадр. */
const edges = (p: Platform) => {
  let e = edgeCache.get(p);
  if (!e) edgeCache.set(p, (e = computeEdges(p)));
  return e;
};
const computeEdges = (p: Platform) => ({
  left: p.x - p.w / 2,
  right: p.x + p.w / 2,
  bottom: p.y - p.h / 2,
  top: p.y + p.h / 2,
  // Без z/d — на всю глубину.
  back: p.d === undefined ? -Infinity : (p.z ?? 0) - p.d / 2,
  front: p.d === undefined ? Infinity : (p.z ?? 0) + p.d / 2,
});
type Edges = ReturnType<typeof edges>;

const overlapX = (b: Body, e: Edges) => b.x + halfW > e.left + EPS && b.x - halfW < e.right - EPS;
const overlapY = (b: Body, e: Edges) => b.y + height > e.bottom + EPS && b.y < e.top - EPS;
const overlapZ = (b: Body, e: Edges) => b.z + halfD > e.back + EPS && b.z - halfD < e.front - EPS;

/**
 * Сдвигает тело на v·dt с твёрдыми AABB-объектами (3D): стены останавливают,
 * снизу бьёмся головой, сверху приземляемся, объекты в глубине задевают только на их глубине.
 * Оси разрешаются по отдельности (X, Z, затем Y), большие шаги дробятся на под-шаги. Меняет body на месте.
 */
export function moveAndCollide(body: Body, dt: number, level: Level): CollisionResult {
  const result: CollisionResult = { grounded: false, hitCeiling: false, hitWall: false };
  const dx = body.vx * dt;
  const dy = body.vy * dt;
  const dz = body.vz * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / MAX_SUBSTEP));

  const { bounds } = level;
  for (let i = 0; i < steps; i++) {
    stepX(body, dx / steps, level, result);
    stepZ(body, dz / steps, level, result);
    body.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, body.z));
    stepY(body, dy / steps, level, result);
  }

  body.x = Math.min(bounds.maxX, Math.max(bounds.minX, body.x));
  return result;
}

function stepX(body: Body, dx: number, level: Level, r: CollisionResult) {
  if (dx === 0) return;
  let nx = body.x + dx;
  for (const p of level.platforms) {
    const e = edges(p);
    // Стоим ровно на верхней грани или касаемся нижней — это не стена.
    if (!overlapY(body, e) || !overlapZ(body, e)) continue;
    if (dx > 0 && body.x + halfW <= e.left + EPS && nx + halfW > e.left) {
      nx = e.left - halfW;
    } else if (dx < 0 && body.x - halfW >= e.right - EPS && nx - halfW < e.right) {
      nx = e.right + halfW;
    }
  }
  if (nx !== body.x + dx) {
    body.vx = 0;
    r.hitWall = true;
  }
  body.x = nx;
}

function stepZ(body: Body, dz: number, level: Level, r: CollisionResult) {
  if (dz === 0) return;
  let nz = body.z + dz;
  let hit = false;
  for (const p of level.platforms) {
    const e = edges(p);
    if (!overlapY(body, e) || !overlapX(body, e)) continue;
    if (dz > 0 && body.z + halfD <= e.back + EPS && nz + halfD > e.back) {
      nz = e.back - halfD;
      hit = true;
    } else if (dz < 0 && body.z - halfD >= e.front - EPS && nz - halfD < e.front) {
      nz = e.front + halfD;
      hit = true;
    }
  }
  if (hit) {
    body.vz = 0;
    r.hitWall = true;
  }
  body.z = nz;
}

function stepY(body: Body, dy: number, level: Level, r: CollisionResult) {
  if (dy === 0) return;
  let ny = body.y + dy;
  for (const p of level.platforms) {
    const e = edges(p);
    if (!overlapX(body, e) || !overlapZ(body, e)) continue;
    if (dy < 0 && body.y >= e.top - EPS && ny < e.top) {
      ny = e.top;
      body.vy = 0;
      r.grounded = true;
    } else if (dy > 0 && body.y + height <= e.bottom + EPS && ny + height > e.bottom) {
      ny = e.bottom - height;
      body.vy = 0;
      r.hitCeiling = true;
    }
  }
  body.y = ny;
}

/** Если тело оказалось внутри платформы (старая позиция из БД, спаун) — выталкиваем наверх. */
export function resolvePenetration(body: Body, level: Level) {
  for (const p of level.platforms) {
    const e = edges(p);
    if (overlapX(body, e) && overlapY(body, e) && overlapZ(body, e)) body.y = e.top;
  }
}
