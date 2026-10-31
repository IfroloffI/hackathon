import * as THREE from 'three';
import type { Level, Platform, Station, StationKind } from '@chronolet/shared';

export const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
export const glow = (color: number, intensity = 1.5) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** Твёрдый объект уровня. Габарит совпадает с коллизией w×h×d (shared/src/physics.ts). */
export function platformMesh(p: Platform, fullDepth: number): THREE.Object3D {
  const d = p.d ?? fullDepth;
  const g = new THREE.Group();
  g.position.set(p.x, p.y, p.z ?? 0);
  switch (p.kind) {
    case 'engine':
    case 'engineCore':
      return g; // рисует тема хаба
    case 'obelisk': {
      g.add(mesh(new THREE.CylinderGeometry(p.w * 0.32, p.w * 0.55, p.h * 0.92, 4), std(p.color), 0, -p.h * 0.04));
      g.children[0].rotation.y = Math.PI / 4;
      const tip = mesh(new THREE.ConeGeometry(p.w * 0.45, p.h * 0.1, 4), glow(0xffd36b, 0.6), 0, p.h * 0.46);
      tip.rotation.y = Math.PI / 4;
      g.add(tip);
      return g;
    }
    case 'well': {
      g.add(mesh(new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.h, 20, 1, true), std(p.color, { side: THREE.DoubleSide })));
      g.add(mesh(new THREE.CircleGeometry(p.w / 2 - 0.05, 20), glow(0xfff3b0, 1.2), 0, p.h / 2 - 0.3));
      g.children[1].rotation.x = -Math.PI / 2;
      return g;
    }
    case 'rocket': {
      const r = p.w / 2;
      g.add(mesh(new THREE.CylinderGeometry(r * 0.8, r, p.h * 0.78, 20), std(p.color, { roughness: 0.4 }), 0, -p.h * 0.06));
      g.add(mesh(new THREE.ConeGeometry(r * 0.8, p.h * 0.18, 20), std(0xc0392b), 0, p.h * 0.42));
      for (let i = 0; i < 4; i++) {
        const fin = mesh(new THREE.BoxGeometry(0.08, 1.2, 0.9), std(0x7f8c8d), 0, -p.h * 0.4);
        fin.rotation.y = (i * Math.PI) / 2;
        fin.translateZ(r + 0.3);
        g.add(fin);
      }
      for (let i = 0; i < 3; i++) g.add(mesh(new THREE.TorusGeometry(r * 0.9, 0.04, 6, 24), std(0x34495e), 0, -p.h * 0.3 + i * 2.2));
      g.children.slice(-3).forEach((c) => (c.rotation.x = Math.PI / 2));
      return g;
    }
    case 'tower': {
      g.add(mesh(new THREE.BoxGeometry(p.w * 0.3, p.h, p.w * 0.3), std(p.color), -p.w * 0.35, 0, 0));
      g.add(mesh(new THREE.BoxGeometry(p.w * 0.3, p.h, p.w * 0.3), std(p.color), p.w * 0.35, 0, 0));
      for (let y = -p.h / 2 + 0.6; y < p.h / 2; y += 1.2) g.add(mesh(new THREE.BoxGeometry(p.w, 0.08, 0.08), std(p.color), 0, y));
      return g;
    }
    case 'hut': {
      g.add(mesh(new THREE.BoxGeometry(p.w, p.h, d), std(p.color)));
      for (let x = -p.w / 2 + 1; x < p.w / 2; x += 2) {
        g.add(mesh(new THREE.PlaneGeometry(0.8, 0.7), glow(0xffe3a3, 0.7), x, p.h * 0.1, d / 2 + 0.01, false));
      }
      return g;
    }
    case 'tree': {
      g.add(mesh(new THREE.CylinderGeometry(p.w * 0.35, p.w * 0.5, p.h, 8), std(p.color)));
      g.add(mesh(new THREE.SphereGeometry(1.4, 14, 10), std(0x3f7d3a), 0, p.h / 2 + 0.9));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), std(0xc0392b), Math.cos(a) * 1.1, p.h / 2 + 0.6 + Math.sin(i) * 0.4, Math.sin(a) * 1.1 + 0.4));
      }
      return g;
    }
    case 'cannon': {
      const barrel = mesh(new THREE.CylinderGeometry(0.16, 0.22, p.w * 1.2, 14), std(p.color, { metalness: 0.6, roughness: 0.4 }), 0.1, 0.15);
      barrel.rotation.z = -Math.PI / 3;
      g.add(barrel);
      for (const z of [-0.35, 0.35]) {
        const wheel = mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 16), std(0x5a3a1a), -0.2, -0.1, z);
        g.add(wheel);
      }
      return g;
    }
    case 'table': {
      g.add(mesh(new THREE.BoxGeometry(p.w, 0.12, d), std(p.color), 0, p.h / 2 - 0.06));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.add(mesh(new THREE.BoxGeometry(0.1, p.h, 0.1), std(p.color), (sx * p.w) / 2.3, 0, (sz * d) / 2.4));
      }
      return g;
    }
    case 'console': {
      g.add(mesh(new THREE.BoxGeometry(p.w, p.h, d), std(p.color, { metalness: 0.5, roughness: 0.4 })));
      const screen = mesh(new THREE.PlaneGeometry(p.w * 0.8, p.h * 0.45), glow(0x2ee6c9, 0.9), 0, p.h * 0.18, d / 2 + 0.01, false);
      g.add(screen);
      for (let i = 0; i < 4; i++) {
        const led = mesh(new THREE.SphereGeometry(0.04, 8, 6), glow([0xff5e5e, 0xffd36b, 0x7fd8ff, 0x8bff8b][i], 2), -p.w * 0.3 + i * p.w * 0.2, -p.h * 0.25, d / 2 + 0.02, false);
        led.userData.blink = i;
        g.add(led);
      }
      return g;
    }
    case 'wall': {
      g.add(mesh(new THREE.BoxGeometry(p.w, p.h, d), std(p.color, { metalness: 0.6, roughness: 0.5 })));
      for (let y = -p.h / 2 + 1; y < p.h / 2; y += 1.5) {
        g.add(mesh(new THREE.BoxGeometry(p.w + 0.05, 0.08, d + 0.05), glow(0x3fb9ff, 0.6), 0, y, 0, false));
      }
      return g;
    }
    default:
      g.add(mesh(new THREE.BoxGeometry(p.w, p.h, d), std(p.color, { roughness: 0.9 })));
      return g;
  }
}

const STATION_COLOR: Record<StationKind, number> = {
  observer: 0x4fd1ff,
  mechanic: 0xffa94d,
  jump: 0xff5e5e,
  return: 0x7dff9a,
  narrator: 0xffe066,
};

/** Светящийся круг на полу у станции + столбик света: «здесь можно нажать E». */
export function stationMarker(s: Station): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(s.x, s.y + 0.02, 0);
  const c = STATION_COLOR[s.kind];
  const ring = mesh(new THREE.RingGeometry(0.55, 0.75, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 }), 0, 0, 0, false);
  ring.rotation.x = -Math.PI / 2;
  const beam = mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 2.4, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    0, 1.2, 0, false,
  );
  g.add(ring, beam);
  g.userData.pulse = ring;
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

/** Приземлившийся хронолёт в эпохе — к нему возвращаются за прыжком. */
export function landedShip(x: number): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(x, 0, -2.6);
  const hull = mesh(new THREE.CapsuleGeometry(1.1, 2.6, 8, 20), std(0xdfe6ee, { metalness: 0.6, roughness: 0.3 }), 0, 1.6);
  hull.rotation.z = Math.PI / 2;
  const cockpit = mesh(new THREE.SphereGeometry(0.7, 16, 12), glow(0x7fd8ff, 0.8), 1.4, 2.1, 0.4);
  const stripe = mesh(new THREE.TorusGeometry(1.12, 0.06, 8, 32), glow(0xff7a1a, 1.2), -0.6, 1.6);
  stripe.rotation.y = Math.PI / 2;
  g.add(hull, cockpit, stripe);
  for (const sx of [-1.4, 1.2]) {
    const leg = mesh(new THREE.CylinderGeometry(0.06, 0.12, 1, 8), std(0x7f8c8d), sx, 0.5, 0.6);
    leg.rotation.x = 0.35;
    g.add(leg);
  }
  const fin = mesh(new THREE.BoxGeometry(1.2, 0.08, 1.6), std(0xff7a1a), -2.2, 1.9);
  g.add(fin);
  return g;
}

export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  root.removeFromParent();
}

export function levelDepth(level: Level) {
  return level.bounds.maxZ - level.bounds.minZ + 1.2;
}
