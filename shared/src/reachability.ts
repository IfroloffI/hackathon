import { PHYSICS } from './constants.ts';
import { isNearStation, touchesCoin, type Level, type Station } from './level.ts';
import { moveAndCollide, resolvePenetration, type Body } from './physics.ts';
import { inMoat } from './mechanics.ts';

/**
 * Проверка проходимости уровня на той же физике, что у клиента: перебор действий игрока
 * (пробежка, смена ряда W/S, прыжки с разным удержанием направления) от стоячих положений.
 * Шаг 1/30 с — консервативно: на низком FPS прыжок чуть ниже, чем на 60+.
 * Ветер и стрелы — по таймеру, поэтому не учитываются (считаем, что игрок дождётся паузы);
 * ров — как яма. Ящики подставляет вызывающий (withCrates).
 */
const DT = 1 / 30;
const MAX_FALL = 20;
const LANES = [1.1, 0, -1.1, -2.6, -4.2, -5.6];

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Только что отскочил от батута: следующее действие начинается с подброса, а не с прыжка. */
  bounce?: true;
}

export interface Exploration {
  poses: Pose[];
  coins: Set<string>;
}

const key = (p: Pose) => `${Math.round(p.x / 0.3)}|${Math.round(p.y * 20)}|${Math.round(p.z * 10)}${p.bounce ? 'b' : ''}`;

/** Симуляция одного действия до приземления. null — упал в яму. */
function simulate(level: Level, start: Pose, act: { dir: number; holdDir: number; jump: boolean; vz?: number; laneTarget?: number }, coins: Set<string>): Pose | null {  const b: Body = { x: start.x, y: start.y, z: start.z, vx: 0, vy: 0, vz: 0 };
  let grounded = true;
  let left = false; // оторвались ли от опоры
  for (let t = 0; t < 4; t += DT) {
    b.vx = t < act.holdDir ? act.dir * PHYSICS.runSpeed : 0;
    b.vz = 0;
    if (act.laneTarget !== undefined && Math.abs(b.z - act.laneTarget) > 0.02) {
      b.vz = Math.sign(act.laneTarget - b.z) * PHYSICS.depthSpeed;
      if (Math.abs(act.laneTarget - b.z) < PHYSICS.depthSpeed * DT) b.z = act.laneTarget, (b.vz = 0);
    }
    if (t === 0 && start.bounce) b.vy = PHYSICS.bounceSpeed;
    else if (act.jump && t === 0) b.vy = PHYSICS.jumpSpeed;
    b.vy = Math.max(b.vy - PHYSICS.gravity * DT, -MAX_FALL);
    const res = moveAndCollide(b, DT, level);
    grounded = res.grounded;
    // На батуте игрок может сменить направление в полёте — это новая развилка.
    if (res.bounced && left) return { x: b.x, y: b.y, z: b.z, bounce: true };
    for (const c of level.coins) if (!coins.has(c.id) && touchesCoin(b, c)) coins.add(c.id);
    if (b.y < level.bounds.minY || inMoat(level, b)) return null;
    if (!grounded) left = true;
    if (start.bounce) left = true;
    const laneDone = act.laneTarget === undefined || Math.abs(b.z - act.laneTarget) <= 0.02;
    if (grounded && t >= act.holdDir && laneDone && (left || !act.jump)) return { x: b.x, y: b.y, z: b.z };
  }
  return grounded ? { x: b.x, y: b.y, z: b.z } : null;
}

/** walkOnly — только ходьба влево/вправо, без прыжков и смены ряда: «можно ли дойти, не напрягаясь». */
export function explore(level: Level, starts: Pose[], limit = 200000, walkOnly = false): Exploration {
  const coins = new Set<string>();
  const seen = new Set<string>();
  const queue: Pose[] = [];
  for (const s0 of starts) {
    const b: Body = { ...s0, vx: 0, vy: 0, vz: 0 };
    resolvePenetration(b, level);
    const settled = simulate(level, { x: b.x, y: b.y, z: b.z }, { dir: 0, holdDir: 0, jump: false }, coins);
    if (settled && !seen.has(key(settled))) {
      seen.add(key(settled));
      queue.push(settled);
    }
  }
  const actions: Parameters<typeof simulate>[2][] = [];
  for (const dir of [-1, 1]) actions.push({ dir, holdDir: 0.3, jump: false });
  if (!walkOnly) for (const dir of [-1, 0, 1]) for (const holdDir of dir === 0 ? [0] : [10, 0.25, 0.5, 1]) actions.push({ dir, holdDir, jump: true });

  for (let i = 0; i < queue.length && queue.length < limit; i++) {
    const p = queue[i];
    const tries = [...actions];
    if (!walkOnly) for (const lane of LANES) if (Math.abs(lane - p.z) > 0.05) tries.push({ dir: 0, holdDir: 0, jump: false, laneTarget: lane });
    for (const a of tries) {
      const next = simulate(level, p, a, coins);
      if (!next) continue;
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return { poses: queue, coins };
}

export const reaches = (ex: Exploration, s: Station) => ex.poses.some((p) => isNearStation(s, p));
export const posesAt = (ex: Exploration, s: Station) => ex.poses.filter((p) => isNearStation(s, p));
