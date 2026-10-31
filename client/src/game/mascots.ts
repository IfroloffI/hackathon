import * as THREE from 'three';
import type { HeadKind, SkinDef } from '@chronolet/shared';

/**
 * Головы и хвосты маскотов из примитивов three.js. Голова — в системе координат «головы»
 * персонажа (центр ~ на уровне глаз, лицо смотрит в +z, к камере), радиус ~0.3.
 */
export interface MascotKit {
  mat(m: THREE.Material): THREE.Material;
  geo<T extends THREE.BufferGeometry>(g: T): T;
}

const std = (kit: MascotKit, color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  kit.mat(new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra })) as THREE.MeshStandardMaterial;

function add(parent: THREE.Object3D, mesh: THREE.Mesh, x: number, y: number, z: number) {
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Глаз: белок + зрачок + блик, смотрит в +z. */
function eye(kit: MascotKit, parent: THREE.Object3D, x: number, y: number, z: number, r: number, iris: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(r, 16, 12)), std(kit, 0xffffff, { roughness: 0.2 })), 0, 0, 0);
  add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(r * 0.55, 14, 10)), std(kit, iris, { roughness: 0.2 })), 0, 0, r * 0.62);
  add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(r * 0.18, 8, 6)), kit.mat(new THREE.MeshBasicMaterial({ color: 0xffffff }))), r * 0.2, r * 0.25, r * 1.05);
  parent.add(g);
  return g;
}

export function buildMascotHead(kind: HeadKind, s: SkinDef, body: number, accent: number, kit: MascotKit): THREE.Group {
  const head = new THREE.Group();
  const fur = std(kit, body);
  const detail = std(kit, s.detail);
  const dark = std(kit, 0x1b1b1b, { roughness: 0.4 });
  switch (kind) {
    case 'dog': {
      // Спотти: круглая синяя голова, белая морда, висячие уши, шрам на левом ухе.
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.3, 24, 18)), fur), 0, 0, 0);
      const snout = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.15, 18, 12)), detail), 0, -0.08, 0.22);
      snout.scale.set(1.15, 0.85, 1);
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.055, 12, 8)), dark), 0, -0.03, 0.37);
      eye(kit, head, -0.11, 0.07, 0.22, 0.06, s.eye);
      eye(kit, head, 0.11, 0.07, 0.22, 0.06, s.eye);
      const smile = add(head, new THREE.Mesh(kit.geo(new THREE.TorusGeometry(0.06, 0.012, 6, 16, Math.PI)), dark), 0, -0.12, 0.34);
      smile.rotation.z = Math.PI;
      const earMat = std(kit, accent);
      for (const sx of [-1, 1]) {
        const ear = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.13, 14, 10)), earMat), sx * 0.29, 0.02, -0.02);
        ear.scale.set(0.45, 1.1, 0.8);
        ear.rotation.z = sx * 0.35;
        // Левое ухо персонажа (+x, он смотрит на камеру) — со шрамом.
        if (sx === 1) {
          const scar = add(ear, new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.06, 0.03, 0.2)), detail), 0.05, -0.02, 0);
          scar.rotation.x = 0.6;
        }
      }
      break;
    }
    case 'cat': {
      // Персик: рыжая голова, острые уши, белая морда, сдвинутые «недовольные» брови, усы.
      const skull = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.3, 24, 18)), fur), 0, 0, 0);
      skull.scale.set(1.12, 0.95, 1);
      const inner = std(kit, 0xffb3a7);
      for (const sx of [-1, 1]) {
        const ear = add(head, new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.11, 0.2, 4)), fur), sx * 0.19, 0.27, 0);
        ear.rotation.z = -sx * 0.25;
        const earIn = add(head, new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.06, 0.12, 4)), inner), sx * 0.19, 0.26, 0.05);
        earIn.rotation.z = -sx * 0.25;
      }
      const muzzle = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.14, 16, 12)), detail), 0, -0.1, 0.21);
      muzzle.scale.set(1.3, 0.75, 0.9);
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.035, 10, 8)), inner), 0, -0.05, 0.33);
      eye(kit, head, -0.12, 0.05, 0.23, 0.055, s.eye);
      eye(kit, head, 0.12, 0.05, 0.23, 0.055, s.eye);
      const brow = std(kit, accent);
      for (const sx of [-1, 1]) {
        // Брови к переносице вниз — фирменная недовольная морда.
        const b = add(head, new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.13, 0.03, 0.03)), brow), sx * 0.12, 0.13, 0.27);
        b.rotation.z = sx * 0.45;
        for (const dy of [-0.11, -0.14]) {
          const w = add(head, new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4)), dark), sx * 0.2, dy, 0.25);
          w.rotation.z = Math.PI / 2 + sx * (dy + 0.12) * 2;
        }
      }
      for (let i = -1; i <= 1; i++) add(head, new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.03, 0.09, 0.02)), brow), i * 0.06, 0.24, 0.17);
      break;
    }
    case 'eyes': {
      // Глазки: вместо головы — пара больших глаз.
      for (const sx of [-1, 1]) {
        const g = eye(kit, head, sx * 0.15, 0.05, 0, 0.17, s.eye);
        g.rotation.y = -sx * 0.08;
        const lid = add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.175, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.32)), fur), 0, 0, 0);
        lid.rotation.x = -0.25;
      }
      break;
    }
    case 'spark': {
      // Спаркс (черновой): светящийся шар с короной искр.
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.28, 20, 16)), std(kit, body, { emissive: body, emissiveIntensity: 0.25 })), 0, 0, 0);
      const glow = std(kit, accent, { emissive: accent, emissiveIntensity: 1.2 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI - Math.PI / 2;
        const spike = add(head, new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.05, 0.2, 6)), glow), Math.sin(a) * 0.26, 0.2 + Math.cos(a) * 0.1, -0.02);
        spike.rotation.z = -a * 0.9;
      }
      eye(kit, head, -0.1, 0.03, 0.22, 0.06, s.eye);
      eye(kit, head, 0.1, 0.03, 0.22, 0.06, s.eye);
      const smile = add(head, new THREE.Mesh(kit.geo(new THREE.TorusGeometry(0.07, 0.014, 6, 16, Math.PI)), dark), 0, -0.08, 0.25);
      smile.rotation.z = Math.PI;
      break;
    }
    case 'bear': {
      // Сеня (черновой): круглая голова, круглые уши, светлая морда.
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.3, 22, 16)), fur), 0, 0, 0);
      for (const sx of [-1, 1]) {
        add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.1, 14, 10)), fur), sx * 0.22, 0.22, 0);
        add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.06, 12, 8)), detail), sx * 0.22, 0.22, 0.05);
      }
      const snout = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.13, 16, 12)), detail), 0, -0.08, 0.22);
      snout.scale.set(1.2, 0.85, 1);
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.045, 10, 8)), dark), 0, -0.04, 0.34);
      eye(kit, head, -0.1, 0.06, 0.23, 0.05, s.eye);
      eye(kit, head, 0.1, 0.06, 0.23, 0.05, s.eye);
      break;
    }
    case 'robot': {
      // Дигги (черновой): угловатая голова-монитор с экраном-лицом и антенной.
      const box = add(head, new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.5, 0.4, 0.4)), fur), 0, 0, 0);
      box.scale.set(1, 1, 1);
      add(head, new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.4, 0.28, 0.02)), std(kit, s.detail, { roughness: 0.2 })), 0, 0, 0.205);
      const led = std(kit, s.eye, { emissive: s.eye, emissiveIntensity: 1.6 });
      for (const sx of [-1, 1]) add(head, new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.07, 0.09, 0.02)), led), sx * 0.09, 0.03, 0.22);
      const mouth = add(head, new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.16, 0.025, 0.02)), led), 0, -0.07, 0.22);
      mouth.rotation.z = 0;
      add(head, new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6)), dark), 0, 0.29, 0);
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.045, 10, 8)), std(kit, accent, { emissive: accent, emissiveIntensity: 1.4 })), 0, 0.39, 0);
      break;
    }
    case 'heart': {
      // Лайкоша: голова-сердечко с белыми глазами.
      const red = std(kit, body, { roughness: 0.35 });
      for (const sx of [-1, 1]) add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.17, 18, 14)), red), sx * 0.13, 0.08, 0);
      const tip = add(head, new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.26, 0.32, 20)), red), 0, -0.13, 0);
      tip.rotation.x = Math.PI;
      tip.scale.z = 0.62;
      eye(kit, head, -0.1, 0.05, 0.15, 0.055, s.eye);
      eye(kit, head, 0.1, 0.05, 0.15, 0.055, s.eye);
      const smile = add(head, new THREE.Mesh(kit.geo(new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI)), std(kit, 0xffffff)), 0, -0.07, 0.17);
      smile.rotation.z = Math.PI;
      break;
    }
    case 'helmet':
      break;
  }
  return head;
}

export function buildTail(kind: 'dog' | 'cat', color: number, kit: MascotKit): THREE.Group {
  const g = new THREE.Group();
  const mat = std(kit, color);
  if (kind === 'dog') {
    const t = add(g, new THREE.Mesh(kit.geo(new THREE.CapsuleGeometry(0.045, 0.22, 4, 8)), mat), 0, 0.1, 0);
    t.rotation.x = -0.9;
  } else {
    for (let i = 0; i < 4; i++) {
      const seg = add(g, new THREE.Mesh(kit.geo(new THREE.CapsuleGeometry(0.04, 0.09, 4, 8)), mat), 0, 0.06 + i * 0.09, -i * 0.03);
      seg.rotation.x = -0.4 - i * 0.15;
    }
  }
  return g;
}
