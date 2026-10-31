import * as THREE from 'three';
import type { Level, Platform, Station, StationKind } from '@chronolet/shared';
import { craft, craftSlab, glowing, mesh, soft, stitchLine, stitchRing, type CraftKind } from '../craft.ts';
import { buildProp, type PropKind } from './props.ts';

export { mesh };
/** Материал стиля по цвету (по умолчанию картон). */
export const std = (color: number, kind: CraftKind = 'card') => craft(kind, color);
export const glow = glowing;

/** Чуть светлее/темнее цвета — верх и основа платформы из одного цвета уровня. */
export const tint = (color: number, k: number) => {
  const c = new THREE.Color(color);
  return (k > 1 ? c.offsetHSL(0, 0.04, (k - 1) * 0.45) : c.multiplyScalar(k)).getHex();
};

const PROPS = new Set<string>(['crate', 'rope', 'trampoline', 'fan', 'arrows', 'moat']);

/** Твёрдый объект уровня. Габарит совпадает с коллизией w×h×d (shared/src/physics.ts). */
export function platformMesh(p: Platform, fullDepth: number): THREE.Object3D {
  const d = p.d ?? fullDepth;
  const g = new THREE.Group();
  g.position.set(p.x, p.y, p.z ?? 0);
  if (p.kind && PROPS.has(p.kind)) {
    const prop = buildProp(p.kind as PropKind, p.w, p.h, d, p.color);
    // Верёвка и ров «привязаны» к верху габарита, остальные стоят на его низе.
    prop.position.y = p.kind === 'rope' || p.kind === 'moat' ? p.h / 2 : -p.h / 2;
    g.add(prop);
    return g;
  }
  switch (p.kind) {
    case 'engine':
    case 'engineCore':
      return g; // рисует тема хаба
    case 'obelisk': {
      const body = mesh(new THREE.CylinderGeometry(p.w * 0.3, p.w * 0.5, p.h * 0.9, 4), craft('card', p.color), 0, -p.h * 0.05);
      body.rotation.y = Math.PI / 4;
      const tip = mesh(new THREE.ConeGeometry(p.w * 0.42, p.h * 0.12, 4), glowing(0xffd36b, 0.5), 0, p.h * 0.46);
      tip.rotation.y = Math.PI / 4;
      // Лента-пояс с шовчиком.
      const band = mesh(new THREE.CylinderGeometry(p.w * 0.43, p.w * 0.45, 0.25, 4), craft('felt', 0x2bb5a8), 0, -p.h * 0.3);
      band.rotation.y = Math.PI / 4;
      g.add(body, tip, band);
      return g;
    }
    case 'well': {
      g.add(mesh(new THREE.CylinderGeometry(p.w / 2, p.w / 2 + 0.05, p.h, 24, 1, true), craft('card', p.color, { side: THREE.DoubleSide })));
      const lip = mesh(new THREE.TorusGeometry(p.w / 2, 0.1, 10, 32), craft('felt', 0xe9c891), 0, p.h / 2);
      lip.rotation.x = Math.PI / 2;
      const water = mesh(new THREE.CircleGeometry(p.w / 2 - 0.05, 24), glowing(0xfff3b0, 1.1), 0, p.h / 2 - 0.3, 0, false);
      water.rotation.x = -Math.PI / 2;
      g.add(lip, water);
      return g;
    }
    case 'rocket': {
      const r = p.w / 2;
      g.add(mesh(new THREE.CylinderGeometry(r * 0.85, r, p.h * 0.78, 32), craft('metal', 0xf2f4f6), 0, -p.h * 0.06));
      g.add(mesh(new THREE.ConeGeometry(r * 0.85, p.h * 0.18, 32), craft('felt', 0xe8382f), 0, p.h * 0.42));
      for (let i = 0; i < 4; i++) {
        const booster = mesh(new THREE.ConeGeometry(r * 0.5, p.h * 0.35, 20), craft('metal', 0xdfe5ea), Math.cos(i * 1.57) * r * 1.15, -p.h * 0.3, Math.sin(i * 1.57) * r * 1.15);
        booster.rotation.z = Math.PI;
        g.add(booster);
      }
      for (const y of [-p.h * 0.1, p.h * 0.2]) {
        const band = mesh(new THREE.TorusGeometry(r * 0.92, 0.08, 10, 32), craft('felt', 0xe8382f), 0, y);
        band.rotation.x = Math.PI / 2;
        g.add(band);
      }
      return g;
    }
    case 'tower': {
      const m = craft('metal', p.color);
      for (const sx of [-1, 1]) g.add(mesh(soft(p.w * 0.3, p.h, p.w * 0.3, 0.06), m, sx * p.w * 0.35, 0, 0));
      for (let y = -p.h / 2 + 0.6; y < p.h / 2; y += 1.2) g.add(mesh(soft(p.w, 0.1, 0.1, 0.04), m, 0, y));
      return g;
    }
    case 'hut': {
      g.add(mesh(soft(p.w, p.h, d, 0.2), craft('card', p.color)));
      // Крыша-«одеяло» и светящиеся окна-заплатки со шовчиком.
      g.add(mesh(soft(p.w + 0.3, 0.3, d + 0.2, 0.14), craft('felt', tint(p.color, 0.6)), 0, p.h / 2 + 0.1));
      for (let x = -p.w / 2 + 1; x < p.w / 2 - 0.4; x += 2) {
        g.add(mesh(soft(0.8, 0.7, 0.06, 0.12), glowing(0xffe3a3, 0.7), x, p.h * 0.1, d / 2 + 0.02, false));
      }
      return g;
    }
    case 'tree': {
      g.add(mesh(new THREE.CylinderGeometry(p.w * 0.35, p.w * 0.5, p.h, 12), craft('wood', p.color)));
      for (const [dx, dy, r] of [[0, 1, 1.4], [-0.9, 0.5, 0.9], [0.9, 0.6, 1], [0.3, 1.8, 0.8]] as const) {
        g.add(mesh(new THREE.SphereGeometry(r, 24, 16), craft('felt', 0x4f9a3c), dx, p.h / 2 + dy, 0));
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        g.add(mesh(new THREE.SphereGeometry(0.13, 12, 10), craft('plain', 0xe8473b), Math.cos(a) * 1.1, p.h / 2 + 0.7 + Math.sin(i) * 0.5, Math.sin(a) * 0.5 + 0.9));
      }
      return g;
    }
    case 'cannon': {
      const barrel = mesh(new THREE.CylinderGeometry(0.16, 0.24, p.w * 1.2, 20), craft('metal', p.color), 0.1, 0.15);
      barrel.rotation.z = -Math.PI / 3;
      g.add(barrel);
      const mouth = mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 20), craft('metal', 0xc9a14a), 0.1 + Math.sin(Math.PI / 3) * p.w * 0.6, 0.15 + Math.cos(Math.PI / 3) * p.w * 0.6);
      mouth.rotation.set(Math.PI / 2, 0, -Math.PI / 3);
      g.add(mouth);
      for (const z of [-0.35, 0.35]) {
        g.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 24), craft('wood', 0x7a4a2a), -0.2, -0.1, z).rotateX(Math.PI / 2));
      }
      return g;
    }
    case 'table': {
      g.add(mesh(soft(p.w, 0.16, d, 0.07), craft('wood', p.color), 0, p.h / 2 - 0.08));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, p.h, 10), craft('wood', tint(p.color, 0.8)), (sx * p.w) / 2.3, 0, (sz * d) / 2.4));
      }
      // Скатерть-фетр с шовчиком по краю.
      g.add(mesh(soft(p.w * 0.7, 0.04, d * 0.8, 0.02), craft('felt', 0xe9d8b4), 0, p.h / 2 + 0.01));
      return g;
    }
    case 'console': {
      g.add(mesh(soft(p.w, p.h, d, 0.18), craft('card', p.color)));
      g.add(mesh(soft(p.w * 0.8, p.h * 0.45, 0.06, 0.08), glowing(0x2ee6c9, 0.8), 0, p.h * 0.18, d / 2 + 0.01, false));
      for (let i = 0; i < 4; i++) {
        const led = mesh(new THREE.SphereGeometry(0.06, 10, 8), glowing([0xff5e5e, 0xffd36b, 0x7fd8ff, 0x8bff8b][i], 1.8), -p.w * 0.3 + i * p.w * 0.2, -p.h * 0.25, d / 2 + 0.03, false);
        led.userData.blink = i;
        g.add(led);
      }
      return g;
    }
    case 'wall': {
      // Стена-«подушка»: картон, фетровые полосы-накладки и шов.
      g.add(mesh(soft(p.w, p.h, d, 0.16), craft('card', p.color)));
      for (let y = -p.h / 2 + 0.8; y < p.h / 2 - 0.3; y += 1.2) {
        g.add(mesh(soft(p.w + 0.06, 0.2, d + 0.06, 0.08), craft('felt', tint(p.color, 1.35)), 0, y));
      }
      return g;
    }
    default:
      return slabAt(g, p.w, p.h, d, p.color);
  }
}

function slabAt(g: THREE.Group, w: number, h: number, d: number, color: number) {
  g.add(craftSlab(w, h, d, tint(color, 0.85), tint(color, 1.25)));
  return g;
}

const STATION_COLOR: Record<StationKind, number> = {
  observer: 0x4fd1ff,
  mechanic: 0xffa94d,
  jump: 0xff5e5e,
  return: 0x7dff9a,
  narrator: 0xffe066,
  shop: 0x0077ff,
};

/** Станция «нажми E»: фетровая подушка со стежками на полу + парящая капля-метка цвета станции. */
export function stationMarker(s: Station): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(s.x, s.y + 0.02, 0.4);
  const c = STATION_COLOR[s.kind];
  const pad = mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.08, 40), craft('felt', c), 0, 0.04, 0, false);
  const ring = stitchRing(0.62);
  ring.position.y = 0.09;
  const pin = new THREE.Group();
  const drop = mesh(new THREE.SphereGeometry(0.16, 20, 16), glowing(c, 0.6), 0, 0, 0, false);
  const tip = mesh(new THREE.ConeGeometry(0.14, 0.22, 20), glowing(c, 0.6), 0, -0.17, 0, false);
  tip.rotation.x = Math.PI;
  pin.add(drop, tip);
  pin.position.y = 2.2;
  g.add(pad, ring, pin);
  g.userData.pulse = ring;
  g.userData.update = (t: number) => {
    pin.position.y = 2.2 + Math.sin(t * 2.5 + s.x) * 0.08;
    pin.rotation.y = t * 1.2;
  };
  return g;
}

export function stars(count: number, radius: number, color = 0xffffff, size = 0.35): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.85 + Math.random() * 0.15);
    pos.set([r * Math.sqrt(1 - u * u) * Math.cos(a), Math.abs(r * u) * 0.8 + 2, -Math.abs(r * Math.sqrt(1 - u * u) * Math.sin(a)) - 15], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, fog: false }));
}

/** Приземлившийся Колизиум в эпохе — плюшевый кораблик-капсула, к нему возвращаются за прыжком. */
export function landedShip(x: number): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(x, 0, -2.6);
  const hull = mesh(new THREE.CapsuleGeometry(1.1, 2.6, 12, 32), craft('felt', 0xeef2f8), 0, 1.6);
  hull.rotation.z = Math.PI / 2;
  const cockpit = mesh(new THREE.SphereGeometry(0.7, 24, 16), glowing(0x7fd8ff, 0.6), 1.4, 2.1, 0.4);
  const stripe = mesh(new THREE.TorusGeometry(1.12, 0.1, 10, 40), craft('felt', 0xff7a1a), -0.6, 1.6);
  stripe.rotation.y = Math.PI / 2;
  const seam = stitchLine(3.6);
  seam.position.set(0, 1.6, 1.12);
  g.add(hull, cockpit, stripe, seam);
  for (const sx of [-1.4, 1.2]) {
    const leg = mesh(new THREE.CylinderGeometry(0.07, 0.12, 1, 10), craft('metal', 0x9aa3b0), sx, 0.5, 0.6);
    leg.rotation.x = 0.35;
    g.add(leg, mesh(new THREE.SphereGeometry(0.18, 12, 10), craft('felt', 0x5a6070), sx, 0.05, 0.75));
  }
  g.add(mesh(soft(1.2, 0.14, 1.6, 0.06), craft('felt', 0xff7a1a), -2.2, 1.9));
  return g;
}

/** Освободить уровень. Общие материалы и геометрии стиля (userData.shared) остаются в кэше. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    const free = (x: THREE.Material) => !x.userData.shared && x.dispose();
    if (Array.isArray(mat)) mat.forEach(free);
    else if (mat) free(mat);
  });
  root.removeFromParent();
}

export function levelDepth(level: Level) {
  return level.bounds.maxZ - level.bounds.minZ + 1.2;
}
