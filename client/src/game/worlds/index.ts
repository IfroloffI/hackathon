import * as THREE from 'three';
import { EPOCHS, GATE_SIZE, mechClock, type CratePos, type Level } from '@chronolet/shared';
import { Character } from '../Character.ts';
import { disposeTree, levelDepth, platformMesh, stationMarker } from './common.ts';
import { vkCoin, type CoinView } from './vkCoin.ts';
import type { Decor } from './decor.ts';
import { buildObstacles } from './obstacles.ts';
import { gate as gateProp } from './props.ts';
import { decorateHub } from './hub.ts';
import { decorateAlexandria, decorateBaikonur, decorateBletchley, decoratePadua, decorateWoolsthorpe } from './epochs.ts';

export interface World {
  /** focusX — где камера: за ней ходит солнце с тенями (уровни длинные). */
  update(t: number, dt: number, focusX?: number): void;
  setParts(parts: string[]): void;
  /** Спрятать уже собранные сферы (при входе на уровень). */
  hideCoins(ids: Iterable<string>): void;
  /** Сферу только что подобрали — анимация «лопнула» и исчезла. */
  popCoin(id: string): void;
  /** Позиции ящиков с сервера. */
  setCrates(list: readonly CratePos[]): void;
  /** Ворота у входа открыты (с сервера) — анимация открытия. */
  setGateOpen(open: boolean): void;
  /** Где свой игрок — для флажков чекпоинтов. */
  setProgress(x: number): void;
  dispose(): void;
}

const THEMES: Record<string, (g: THREE.Group, scene: THREE.Scene) => Decor> = {
  hub: decorateHub,
  alexandria: decorateAlexandria,
  padua: decoratePadua,
  woolsthorpe: decorateWoolsthorpe,
  bletchley: decorateBletchley,
  baikonur: decorateBaikonur,
};

/** Одежда рассказчиков эпох (NPC). */
const NPC_LOOK: Record<string, { robe: number; hat?: number }> = {
  eratosthenes: { robe: 0xece4d0 },
  galileo: { robe: 0x5a2a2a, hat: 0x1c1c1c },
  newton: { robe: 0x3a3a5a },
  turing: { robe: 0x6b5a45 },
  korolev: { robe: 0x2f3b2f, hat: 0x222222 },
};

/**
 * Строит уровень: твёрдые объекты из данных уровня (совпадают с коллизиями), маркеры станций,
 * рассказчика и оформление эпохи. Всё живёт в одной группе — смена эпохи = dispose + новый build.
 */
export function buildWorld(scene: THREE.Scene, level: Level): World {
  const g = new THREE.Group();
  scene.add(g);

  const depth = levelDepth(level);
  for (const p of level.platforms) g.add(platformMesh(p, depth));

  const markers = level.stations.map((s) => {
    const m = stationMarker(s);
    g.add(m);
    return m;
  });

  const coins = new Map<string, CoinView>();
  const popping = new Set<(t: number) => void>();
  level.coins.forEach((c, i) => {
    const view = vkCoin(c.x, c.y, c.z ?? 0, i * 1.3);
    coins.set(c.id, view);
    g.add(view.root);
  });

  const npcs: Character[] = [];
  for (const s of level.stations) {
    if (s.kind !== 'narrator' || !s.agent || !NPC_LOOK[s.agent]) continue;
    const name = EPOCHS.find((e) => e.narrator.id === s.agent)?.narrator.name ?? s.agent;
    const npc = new Character(name, 0xffe066, { npc: NPC_LOOK[s.agent] });
    npc.root.position.set(s.x, s.y, -0.9);
    g.add(npc.root);
    npcs.push(npc);
  }

  const gate = level.gate ? gateProp(GATE_SIZE.w, GATE_SIZE.h, depth) : null;
  if (gate && level.gate) {
    gate.root.position.set(level.gate.x, 0, 0);
    g.add(gate.root);
  }

  const decor = (THEMES[level.id] ?? decorateHub)(g, scene);
  const obstacles = buildObstacles(g, level);

  // Мигающие светодиоды пультов и анимированные объекты (батуты, вентиляторы, метки станций…).
  const leds: THREE.Mesh[] = [];
  const animated: ((t: number) => void)[] = [];
  const followers: { light: THREE.DirectionalLight; x: number }[] = [];
  g.traverse((o) => {
    if (o.userData.blink !== undefined) leds.push(o as THREE.Mesh);
    if (typeof o.userData.update === 'function') animated.push(o.userData.update);
    if (o.userData.follow) followers.push({ light: o as THREE.DirectionalLight, x: o.position.x });
  });

  return {
    update(t, dt, focusX = 0) {
      decor.update?.(t);
      gate?.update(dt);
      obstacles.update(t, mechClock(), dt);
      // Солнце (и его тени) едет за камерой с шагом, чтобы тени не «дрожали».
      const fx = Math.round(focusX / 4) * 4;
      for (const f of followers) {
        f.light.position.x = f.x + fx;
        f.light.target.position.x = fx;
      }
      for (const m of markers) {
        const ring = m.userData.pulse as THREE.Mesh;
        ring.scale.setScalar(1 + Math.sin(t * 3) * 0.05);
      }
      for (const f of animated) f(t);
      for (const l of leds) l.visible = Math.sin(t * 2 + l.userData.blink * 1.7) > -0.3;
      coins.forEach((c) => c.update(t));
      popping.forEach((f) => f(t));
      for (const n of npcs) {
        const p = n.root.position;
        n.setPose(p.x, p.y, p.z, -1, 'idle', dt);
      }
    },
    setParts(parts) {
      decor.setParts?.(parts);
    },
    setCrates(list) {
      obstacles.setCrates(list);
    },
    setGateOpen(open) {
      gate?.setOpen(open);
    },
    setProgress(x) {
      obstacles.setProgress(x);
    },
    hideCoins(ids) {
      for (const id of ids) {
        coins.get(id)?.root.removeFromParent();
        coins.delete(id);
      }
    },
    popCoin(id) {
      const c = coins.get(id);
      if (!c) return;
      coins.delete(id);
      // Пока лопается — продолжаем обновлять отдельно.
      const tick = (t: number) => c.update(t);
      popping.add(tick);
      c.pop(() => {
        popping.delete(tick);
        c.root.removeFromParent();
      });
    },
    dispose() {
      npcs.forEach((n) => n.dispose());
      disposeTree(g);
    },
  };
}
