import * as THREE from 'three';
import { arrowsInFlight, cratesAtHome, fanOn, fanReach, withCrates, type ArrowTrap, type CratePos, type FanDef, type Level } from '@chronolet/shared';
import { arrowShaft, checkpointFlag, crate, launcher, sideFan, windStreak } from './props.ts';

/**
 * Полоса препятствий уровня: ящики (позиции приходят с сервера), вентиляторы со «штрихами» потока,
 * самострелы со стрелами и флажки чекпоинтов. Всё считается из тех же функций, что физика игрока
 * (shared/src/mechanics.ts), поэтому видимое совпадает с тем, что толкает и попадает.
 */
export interface Obstacles {
  setCrates(list: readonly CratePos[]): void;
  /** Где сейчас свой игрок — флажки чекпоинтов, до которых дошёл, загораются. */
  setProgress(x: number): void;
  update(t: number, now: number, dt: number): void;
}

const LANE_DEPTH = 3;

const bandOf = (o: { z?: number; d?: number }) => (o.d === undefined ? { back: -1.3, front: 1.3, full: true } : { back: (o.z ?? 0) - o.d / 2, front: (o.z ?? 0) + o.d / 2, full: false });

export function buildObstacles(g: THREE.Group, level: Level): Obstacles {
  // ── ящики
  const crates = new Map<string, { root: THREE.Group; tx: number; ty: number }>();
  for (const def of level.crates ?? []) {
    const root = crate(def.s, def.color ?? 0xb5763d, def.s, LANE_DEPTH);
    root.position.set(def.x, def.y, 0);
    g.add(root);
    crates.set(def.id, { root, tx: def.x, ty: def.y });
  }
  let solid = withCrates(level, cratesAtHome(level));

  // ── вентиляторы
  const fans = (level.fans ?? []).map((f) => buildFan(g, f));
  // ── самострелы
  const traps = (level.arrows ?? []).map((a) => buildTrap(g, a));
  // ── чекпоинты
  const flags = level.checkpoints.map((c) => {
    const f = checkpointFlag();
    f.root.position.set(c.x, c.y, -1.75);
    g.add(f.root);
    return { ...f, x: c.x };
  });
  let reached = -Infinity;

  return {
    setCrates(list) {
      for (const c of list) {
        const v = crates.get(c.id);
        if (!v) continue;
        // Сильно разошлись (сброс, падение в бездну) — сразу на место.
        if (Math.abs(v.tx - c.x) + Math.abs(v.ty - c.y) > 3) v.root.position.set(c.x, c.y, 0);
        v.tx = c.x;
        v.ty = c.y;
      }
      solid = withCrates(level, list);
    },
    setProgress(x) {
      if (x <= reached) return;
      reached = x;
      for (const f of flags) if (f.x <= x + 0.5) f.setActive(true);
    },
    update(t, now, dt) {
      const k = 1 - Math.exp(-dt * 14);
      crates.forEach((v) => {
        v.root.position.x += (v.tx - v.root.position.x) * k;
        v.root.position.y += (v.ty - v.root.position.y) * k;
      });
      for (const f of fans) f.update(solid, now, dt);
      for (const tr of traps) tr.update(solid, now);
      for (const f of flags) f.update(t);
    },
  };
}

function buildFan(g: THREE.Group, f: FanDef) {
  const size = Math.min(1.6, Math.max(0.9, f.h * 0.6));
  const { root, blades } = sideFan(size);
  const band = bandOf(f);
  // Корпус — за дорожкой (или перед ней, если поток в ближнем ряду), чтобы не мешать проходу.
  const houseZ = !band.full && band.back + band.front > 0 ? 2.3 : -2.3;
  root.position.set(f.x, f.y + Math.min(f.h, 2.4) / 2 + 0.2, houseZ);
  if (f.dir < 0) root.rotation.y = Math.PI;
  g.add(root);
  const count = Math.max(4, Math.min(14, Math.round((f.len * f.h) / 4)));
  const streaks = Array.from({ length: count }, (_, i) => {
    const m = windStreak();
    m.position.set(f.x, f.y + 0.2 + ((i * 0.618) % 1) * (f.h - 0.4), band.back + 0.15 + ((i * 0.37) % 1) * (band.front - band.back - 0.3));
    g.add(m);
    return { m, phase: (i * 0.53) % 1 };
  });
  let spin = 0;
  return {
    update(solid: Level, now: number, dt: number) {
      const on = fanOn(f, now);
      spin += ((on ? 22 : 1.5) - spin) * Math.min(1, dt * 3);
      blades.rotation.x += spin * dt;
      const reach = Math.max(0.5, fanReach(solid, f));
      for (const s of streaks) {
        s.m.visible = on;
        if (!on) continue;
        const u = (now * (7 / reach) + s.phase) % 1;
        s.m.position.x = f.x + f.dir * u * reach;
        (s.m.material as THREE.MeshBasicMaterial).opacity = 0.6 * Math.sin(u * Math.PI);
      }
    },
  };
}

function buildTrap(g: THREE.Group, a: ArrowTrap) {
  const band = bandOf(a);
  const depth = band.front - band.back;
  // Голова самострела шириной во всю полосу, по которой летят стрелы: видно, где укрытие.
  const head = launcher();
  head.position.set(a.x, a.y, (band.back + band.front) / 2);
  head.scale.z = Math.max(1, depth / 0.9);
  if (a.dir > 0) head.rotation.y = Math.PI;
  g.add(head);
  const zs = depth >= 1.8 ? [band.back + depth * 0.25, band.front - depth * 0.25] : [(band.back + band.front) / 2];
  const perLane = Math.ceil(a.range / ((a.speed ?? 8) * (a.period ?? 1.8))) + 1;
  const pool = zs.map((z) =>
    Array.from({ length: perLane }, () => {
      const s = arrowShaft();
      if (a.dir > 0) s.rotation.y = Math.PI;
      s.position.set(a.x, a.y, z);
      s.visible = false;
      g.add(s);
      return s;
    }),
  );
  return {
    update(solid: Level, now: number) {
      const xs = arrowsInFlight(solid, a, now);
      for (const lane of pool) lane.forEach((s, i) => {
        s.visible = i < xs.length;
        if (s.visible) s.position.x = xs[i];
      });
    },
  };
}
