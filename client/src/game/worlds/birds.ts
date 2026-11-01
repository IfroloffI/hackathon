import * as THREE from 'three';
import type { Level } from '@chronolet/shared';
import { craft, glowing, mesh, rnd, soft, stitchLine } from '../craft.ts';

/**
 * Второстепенные NPC — плюшевые птицы. Вся стая сидит кучкой в одной точке карты, пока её не спугнёт
 * первый подошедший игрок (свой или чужой); дальше каждая птица неспешно кружит по уровню, изредка
 * присаживается на своё место и снова взлетает, если к ней подойти. Декорация: сквозь птиц проходят,
 * они ничего не блокируют. Три вида: длиннокрылая — море и степь, воробей — поля, голубь — города.
 */

interface Spot {
  x: number;
  y: number;
  z: number;
}

interface BirdStyle {
  body: number;
  wing: number;
  beak: number;
}

type Species = 'gull' | 'dove' | 'tiny';

interface SpeciesDef {
  size: number;
  speed: number;
  flap: number;
}

const SPECIES: Record<Species, SpeciesDef> = {
  gull: { size: 1.2, speed: 3.2, flap: 6.5 },
  dove: { size: 1, speed: 2.6, flap: 8 },
  tiny: { size: 0.72, speed: 2.3, flap: 11 },
};

interface FlockDef {
  species: Species;
  style: BirdStyle;
  /** Кучка, пока стаю не спугнули. */
  at: Spot;
  spots: Spot[];
  segs: [number, number][];
  yRange: [number, number];
}

/** Кучка и места присада — по реальным платформам уровней (shared/src/level.ts). */
const FLOCKS: Record<string, FlockDef> = {
  hub: {
    species: 'gull',
    style: { body: 0xf2f4f8, wing: 0xa8b4c4, beak: 0xff8a3c },
    at: { x: -9.5, y: 0, z: -4.4 },
    spots: [
      { x: -10, y: 2.1, z: 0.2 },
      { x: 10.5, y: 2.1, z: 0.2 },
      { x: 20, y: 0, z: -3.4 },
      { x: 5, y: 0, z: -4.2 },
      { x: 26, y: 2.6, z: 0.6 },
    ],
    // Птицы держатся под потолком палубы — летают ниже трёх.
    segs: [
      [-14, 14.2],
      [17.2, 61],
    ],
    yRange: [1.6, 2.8],
  },
  alexandria: {
    species: 'gull',
    style: { body: 0xefe6cf, wing: 0xb9976a, beak: 0xd88a3c },
    at: { x: 18.5, y: 0, z: -4 },
    spots: [
      { x: 33, y: 2, z: -1.6 },
      { x: 61, y: 0, z: -3.4 },
      { x: 74, y: 0, z: -4.2 },
      { x: 89, y: 5.2, z: -1.2 },
      { x: 24, y: 0, z: -3.6 },
    ],
    segs: [[-28, 98]],
    yRange: [2.4, 9.5],
  },
  padua: {
    species: 'dove',
    style: { body: 0x8a6a52, wing: 0x5f4632, beak: 0xe8b45c },
    at: { x: 64.5, y: 0, z: -3.6 },
    spots: [
      { x: 47.5, y: 0, z: -4.4 },
      { x: 52.5, y: 0, z: -4.4 },
      { x: 68, y: 5.4, z: 0.4 },
      { x: 85, y: 6.4, z: -1 },
      { x: 30, y: 0, z: -4.4 },
    ],
    segs: [[-28, 98]],
    yRange: [2.4, 8.5],
  },
  woolsthorpe: {
    species: 'dove',
    style: { body: 0x9a6a42, wing: 0x6f4d32, beak: 0xe0a53c },
    at: { x: 30, y: 0, z: -4.5 },
    spots: [
      { x: 25, y: 4.4, z: 0.4 },
      { x: 53.8, y: 1.4, z: 0.2 },
      { x: 59.8, y: 1.4, z: 0.2 },
      { x: 50, y: 0, z: -4.4 },
      { x: 90, y: 5.4, z: 0 },
    ],
    segs: [[-28, 98]],
    yRange: [2.2, 9],
  },
  bletchley: {
    species: 'dove',
    style: { body: 0x9aa0a8, wing: 0x6f757e, beak: 0xc08050 },
    at: { x: 28, y: 0, z: -4.6 },
    spots: [
      { x: 28, y: 4, z: 0 },
      { x: 60, y: 2.8, z: 0.4 },
      { x: 76, y: 0, z: -4.4 },
      { x: 12, y: 0, z: -5.3 },
      { x: 95, y: 2.8, z: 0 },
    ],
    segs: [[-28, 98]],
    yRange: [2.2, 8.6],
  },
  baikonur: {
    species: 'gull',
    style: { body: 0xb5915a, wing: 0x7d5a38, beak: 0xa0522d },
    at: { x: 46, y: 0, z: -4.2 },
    spots: [
      { x: 20, y: 2.8, z: -0.6 },
      { x: 86, y: 0, z: -3.6 },
      { x: 94, y: 0, z: 0.8 },
      { x: 41, y: 3.6, z: 0.3 },
      { x: 55, y: 0, z: -4.2 },
    ],
    segs: [[-28, 98]],
    yRange: [2.4, 10],
  },
};

type BirdState = 'sit' | 'fly' | 'land';

interface Bird {
  root: THREE.Group;
  wings: THREE.Group[];
  sides: number[];
  species: SpeciesDef;
  state: BirdState;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  nest: THREE.Vector3;
  phase: number;
  flapOff: number;
  timer: number;
  flightTimer: number;
}

/** Плюшевая птица: тело вдоль x, голова с конусным клювом и глазами, хвост, крылья на плечах. */
function buildBird(def: SpeciesDef, style: BirdStyle): { root: THREE.Group; wings: THREE.Group[]; sides: number[] } {
  const s = def.size;
  const root = new THREE.Group();
  const bodyMat = craft('felt', style.body);
  const wingMat = craft('felt', style.wing);
  root.add(mesh(soft(0.62 * s, 0.4 * s, 0.34 * s, 0.12 * s), bodyMat, 0, 0.2 * s));
  root.add(mesh(soft(0.3 * s, 0.28 * s, 0.3 * s, 0.09 * s), bodyMat, 0.36 * s, 0.42 * s));
  const beak = new THREE.ConeGeometry(0.07 * s, 0.18 * s, 10);
  beak.rotateZ(-Math.PI / 2);
  root.add(mesh(beak, glowing(style.beak, 0.25), 0.55 * s, 0.4 * s));
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.045 * s, 8, 6), craft('plain', 0x2a2520, { roughness: 0.5 }), 0.42 * s, 0.5 * s, sx * 0.13 * s);
    eye.castShadow = false;
    root.add(eye);
  }
  const tail = mesh(soft(0.3 * s, 0.06 * s, 0.26 * s, 0.03 * s), wingMat, -0.36 * s, 0.24 * s);
  tail.rotation.y = 0.35;
  root.add(tail);
  const wings: THREE.Group[] = [];
  const sides: number[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.26 * s, 0);
    pivot.rotation.y = side > 0 ? 0 : Math.PI;
    pivot.add(mesh(soft(0.34 * s, 0.05 * s, 0.7 * s, 0.025 * s), wingMat, 0.06 * s, 0, 0.3 * s));
    const st = stitchLine(0.5 * s);
    st.rotation.y = Math.PI / 2;
    st.position.set(0.06 * s, 0.02 * s, 0.5 * s);
    pivot.add(st);
    root.add(pivot);
    wings.push(pivot);
    sides.push(side);
  }
  return { root, wings, sides };
}

export interface Birds {
  root: THREE.Group;
  update(t: number, dt: number, players: { x: number; y: number; z: number }[]): void;
}

/** Стая птиц уровня (null — уровень без птиц). Птицы — чистый визуал. */
export function birdFlock(level: Level, count = 6): Birds | null {
  const def = FLOCKS[level.id];
  if (!def) return null;
  const g = new THREE.Group();
  const species = SPECIES[def.species];
  const [xMin, xMax] = def.segs[0];
  const zMin = level.bounds.minZ + 0.8;
  const zMax = level.bounds.maxZ - 0.4;
  const [yMin, yMax] = def.yRange;

  const birds: Bird[] = [];
  for (let i = 0; i < count; i++) {
    const { root, wings, sides } = buildBird(species, def.style);
    const nest = new THREE.Vector3(def.at.x + (rnd() - 0.5) * 1.6, def.at.y, def.at.z + (rnd() - 0.5) * 1.2);
    root.position.copy(nest);
    g.add(root);
    birds.push({
      root,
      wings,
      sides,
      species,
      state: 'sit',
      pos: nest.clone(),
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      nest,
      phase: rnd() * Math.PI * 2,
      flapOff: rnd() * Math.PI * 2,
      timer: 0,
      flightTimer: 6 + rnd() * 8,
    });
  }

  const pickWander = (b: Bird) => {
    const seg = def.segs.length > 1 && rnd() > 0.5 ? def.segs[1] : def.segs[0];
    const [s0, s1] = seg ?? [xMin, xMax];
    b.target.set(s0 + rnd() * (s1 - s0), yMin + rnd() * (yMax - yMin), zMin + rnd() * (zMax - zMin));
  };
  const pickLanding = (b: Bird) => {
    const near = def.spots.filter((sp) => Math.abs(sp.x - b.pos.x) < 34);
    const spot = (near.length ? near : def.spots)[Math.floor(rnd() * (near.length ? near.length : def.spots.length))];
    b.target.set(spot.x + (rnd() - 0.5) * 0.4, spot.y, spot.z + (rnd() - 0.5) * 0.3);
  };
  const flyAway = (b: Bird) => {
    b.state = 'fly';
    pickWander(b);
    b.timer = 6 + rnd() * 10;
    b.flightTimer = b.timer;
  };
  const near1 = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }, r: number) =>
    Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < r;

  const dir = new THREE.Vector3();
  const desired = new THREE.Vector3();
  return {
    root: g,
    update(t, dt, players) {
      for (const b of birds) {
        if (b.state === 'sit') {
          // Дремлют: подходит первый игрок — вся стая разлетается.
          const scared = players.some((p) => near1(p, b.nest, 3.4));
          if (scared) {
            flyAway(b);
            b.vel.set((rnd() - 0.5) * 2, 1.6 + rnd() * 1.4, (rnd() - 0.5) * 2).normalize().multiplyScalar(species.speed * 1.3);
          } else {
            b.root.position.copy(b.nest);
            b.root.position.y += Math.abs(Math.sin(t * 2.2 + b.phase)) * 0.02;
          }
          continue;
        }
        if (b.state === 'land') {
          if (players.some((p) => near1(p, b.pos, 2.8))) {
            // Вспорхнула: резко вверх и дальше кружить.
            b.state = 'fly';
            pickWander(b);
            b.vel.set((rnd() - 0.5) * 2.4, 2.2, (rnd() - 0.5) * 2.4).normalize().multiplyScalar(species.speed * 1.2);
            b.flightTimer = 7 + rnd() * 10;
            b.timer = 6 + rnd() * 8;
          } else {
            b.root.position.copy(b.target);
            b.root.position.y += Math.abs(Math.sin(t * 1.7 + b.phase)) * 0.03;
          }
        } else {
          // Полёт: догоняем цель, у цели — новая; изредка сажаемся на ближайшую полку.
          b.flightTimer -= dt;
          b.timer -= dt;
          if (b.timer <= 0 && b.flightTimer <= 0 && rnd() > 0.4) {
            pickLanding(b);
            b.timer = 20;
            b.flightTimer = 8;
          } else if (b.flightTimer <= 0) {
            pickWander(b);
            b.flightTimer = 5 + rnd() * 7;
            if (b.timer <= 0) b.timer = 8 + rnd() * 8;
          }
          dir.subVectors(b.target, b.pos);
          if (dir.length() < 0.6) {
            if (b.timer > 10 && Math.hypot(b.target.y - b.pos.y) < 1) {
              // Долетели до присада — сели.
              b.state = 'land';
              b.vel.set(0, 0, 0);
              b.root.position.copy(b.target);
              continue;
            }
            pickWander(b);
            b.flightTimer = 5 + rnd() * 7;
          } else {
            desired.copy(dir).normalize().multiplyScalar(species.speed * (0.85 + Math.sin(t * 1.3 + b.phase) * 0.15));
            b.vel.lerp(desired, Math.min(1, dt * 2));
            b.pos.addScaledVector(b.vel, dt);
            b.root.position.copy(b.pos);
            if (b.vel.lengthSq() > 0.04) b.root.rotation.y = Math.atan2(-b.vel.z, b.vel.x);
          }
        }
        // Машем крыльями: в полёте широко, в присаде — почти подогнуты.
        const flapAmp = b.state === 'fly' ? 0.95 : 0.1;
        const rate = b.state === 'fly' ? b.species.flap : b.species.flap * 0.2;
        for (let i = 0; i < b.wings.length; i++) {
          b.wings[i].rotation.x = b.sides[i] * (Math.sin(t * rate + b.flapOff + b.phase) * flapAmp - 0.12);
        }
      }
    },
  };
}
