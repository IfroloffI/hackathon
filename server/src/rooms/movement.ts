import { PHYSICS, respawnPoint, type Anim, type Level, type MovePayload } from '@chronolet/shared';

const ANIMS: ReadonlySet<Anim> = new Set(['idle', 'run', 'jump', 'fall']);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Клиент сам считает своё движение (дизайн-док, «Авторитарность»), сервер лишь
 * отсекает мусор и телепорты: границы уровня + ограничение скорости между пакетами.
 * Возвращает исправленную позицию или null, если пакет битый.
 */
export function sanitizeMove(
  msg: unknown,
  prev: { x: number; y: number; z: number },
  dtMs: number,
  level: Level,
  /** Закрытые ворота: правее этого x стоять нельзя (кто уже за ними — не трогаем). */
  blockX: number | null = null,
): Omit<MovePayload, 'levelId'> | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  if (![m.x, m.y, m.z, m.vx, m.vy].every(finite)) return null;

  // dt ограничен сверху: иначе после паузы в пакетах можно «прыгнуть» далеко.
  const dt = Math.min(Math.max(dtMs, 16), 200) / 1000;
  const maxH = PHYSICS.runSpeed * PHYSICS.speedTolerance * dt;
  const maxD = PHYSICS.depthSpeed * PHYSICS.speedTolerance * dt;
  const maxV = Math.max(PHYSICS.jumpSpeed, PHYSICS.gravity * dt) * PHYSICS.speedTolerance * dt + 0.5;

  const { bounds } = level;
  // Упал в яму — к ближайшему чекпоинту слева. Клиент делает то же самое, поэтому телепорт здесь легален.
  if ((m.y as number) < bounds.minY) {
    return { ...respawnPoint(level, prev.x), vx: 0, vy: 0, anim: 'idle', facing: 1 };
  }

  let x = clamp(clamp(m.x as number, prev.x - maxH, prev.x + maxH), bounds.minX, bounds.maxX);
  if (blockX !== null && prev.x <= blockX + 0.05) x = Math.min(x, blockX);

  return {
    x,
    y: clamp(m.y as number, prev.y - maxV, prev.y + maxV),
    z: clamp(clamp(m.z as number, prev.z - maxD, prev.z + maxD), bounds.minZ, bounds.maxZ),
    vx: clamp(m.vx as number, -PHYSICS.runSpeed * 2, PHYSICS.runSpeed * 2),
    vy: clamp(m.vy as number, -PHYSICS.gravity, PHYSICS.jumpSpeed * 2),
    anim: ANIMS.has(m.anim as Anim) ? (m.anim as Anim) : 'idle',
    facing: m.facing === -1 ? -1 : 1,
  };
}
