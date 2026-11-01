import * as THREE from 'three';
import type { HeadKind, SkinDef } from '@chronolet/shared';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Головы и хвосты маскотов — «плюшевые игрушки»: вязаный мех, фетровые уши и морды, глаза-пуговицы.
 * Голова — в системе координат «головы» персонажа (центр на уровне глаз, лицо смотрит в +z), радиус ~0.32.
 */
export interface MascotKit {
  mat(m: THREE.Material): THREE.Material;
  geo<T extends THREE.BufferGeometry>(g: T): T;
  /** Вязаный материал персонажа (свой экземпляр — для затемнения отключившихся). */
  knit(color: number): THREE.MeshStandardMaterial;
  /** Фетр. */
  felt(color: number): THREE.MeshStandardMaterial;
  /** Гладкая лакированная деталь: пуговицы, носы. */
  plain(color: number, extra?: THREE.MeshPhysicalMaterialParameters): THREE.MeshStandardMaterial;
}

function add(parent: THREE.Object3D, mesh: THREE.Mesh, x: number, y: number, z: number) {
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Глаз-пуговица: блестящий диск + белый блик. Смотрит в +z. */
export function buttonEye(kit: MascotKit, parent: THREE.Object3D, x: number, y: number, z: number, r: number, color: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = x * 1.6;
  const disc = add(g, new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(r, r, 0.04, 24)), kit.plain(color, { roughness: 0.15, clearcoat: 1 })), 0, 0, 0);
  disc.rotation.x = Math.PI / 2;
  add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(r * 0.3, 10, 8)), kit.mat(new THREE.MeshBasicMaterial({ color: 0xffffff }))), r * 0.35, r * 0.35, 0.025);
  parent.add(g);
  return g;
}

/** Вышитая улыбка (дуга-трубочка). */
export function stitchedSmile(kit: MascotKit, parent: THREE.Object3D, y: number, z: number, w = 0.11, color = 0x3a2a2a) {
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-w, 0.02, 0), new THREE.Vector3(0, -0.045, 0.02), new THREE.Vector3(w, 0.02, 0)]);
  return add(parent, new THREE.Mesh(kit.geo(new THREE.TubeGeometry(curve, 16, 0.013, 6)), kit.plain(color, { clearcoat: 0, roughness: 0.8 })), 0, y, z);
}

export function buildMascotHead(kind: HeadKind, s: SkinDef, body: number, accent: number, kit: MascotKit): THREE.Group {
  const head = new THREE.Group();
  const fur = kit.knit(body);
  const detail = kit.felt(s.detail);
  const nose = kit.plain(0x1b1b1b, { roughness: 0.2, clearcoat: 1 });
  const skull = () => {
    const m = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.32, 32, 24)), fur), 0, 0, 0);
    m.scale.set(1.04, 0.95, 0.94);
    return m;
  };
  switch (kind) {
    case 'dog': {
      // Спотти: синяя круглая голова, белая морда, висячие уши, шрам на левом ухе.
      skull();
      const muzzle = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.14, 24, 16)), detail), 0, -0.08, 0.25);
      muzzle.scale.set(1.25, 0.85, 0.8);
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.05, 16, 12)), nose), 0, -0.03, 0.36);
      buttonEye(kit, head, -0.11, 0.07, 0.28, 0.06, s.eye);
      buttonEye(kit, head, 0.11, 0.07, 0.28, 0.06, s.eye);
      stitchedSmile(kit, head, -0.14, 0.32, 0.06);
      const earMat = kit.knit(accent);
      for (const sx of [-1, 1]) {
        const ear = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.13, 20, 14)), earMat), sx * 0.32, -0.02, 0);
        ear.scale.set(0.55, 1.4, 0.5);
        ear.rotation.z = sx * 0.25;
        // Левое ухо персонажа (+x, он смотрит на камеру) — с белой заплаткой-шрамом.
        if (sx === 1) {
          const scar = add(ear, new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.06, 0.04, 0.22)), detail), 0.05, -0.02, 0);
          scar.rotation.x = 0.6;
        }
      }
      break;
    }
    case 'cat': {
      // Персик: рыжая голова, острые уши, белая морда, сдвинутые «недовольные» брови, усы.
      const sk = skull();
      sk.scale.set(1.12, 0.92, 0.94);
      const inner = kit.felt(0xffb3a7);
      for (const sx of [-1, 1]) {
        const ear = add(head, new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.12, 0.22, 4)), fur), sx * 0.21, 0.29, 0);
        ear.rotation.z = -sx * 0.3;
        const earIn = add(head, new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.065, 0.13, 4)), inner), sx * 0.21, 0.28, 0.06);
        earIn.rotation.z = -sx * 0.3;
      }
      const muzzle = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.12, 24, 16)), detail), 0, -0.11, 0.25);
      muzzle.scale.set(1.4, 0.8, 0.7);
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.035, 12, 10)), kit.plain(0xff8aa0)), 0, -0.06, 0.34);
      buttonEye(kit, head, -0.12, 0.04, 0.28, 0.065, s.eye);
      buttonEye(kit, head, 0.12, 0.04, 0.28, 0.065, s.eye);
      const brow = kit.felt(accent);
      for (const sx of [-1, 1]) {
        // Брови к переносице вниз — фирменная недовольная морда.
        const b = add(head, new THREE.Mesh(kit.geo(new THREE.CapsuleGeometry(0.02, 0.1, 4, 8)), brow), sx * 0.12, 0.14, 0.29);
        b.rotation.z = Math.PI / 2 + sx * 0.4;
        for (const dy of [-0.11, -0.14]) {
          const w = add(head, new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.005, 0.005, 0.22, 4)), kit.plain(0x3a2a2a)), sx * 0.22, dy, 0.27);
          w.rotation.z = Math.PI / 2 + sx * (dy + 0.12) * 2;
        }
      }
      for (let i = -1; i <= 1; i++) add(head, new THREE.Mesh(kit.geo(new THREE.CapsuleGeometry(0.015, 0.06, 4, 6)), brow), i * 0.06, 0.25, 0.19);
      break;
    }
    case 'eyes': {
      // Глазки: вместо головы — пара больших глаз-шаров с веками.
      for (const sx of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(sx * 0.17, 0.03, 0);
        add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.22, 32, 24)), kit.felt(0xffffff)), 0, 0, 0);
        const iris = add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.11, 24, 16)), kit.plain(s.eye, { clearcoat: 1 })), 0.02, 0, 0.16);
        iris.scale.z = 0.5;
        add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.03, 10, 8)), kit.mat(new THREE.MeshBasicMaterial({ color: 0xffffff }))), 0.05, 0.04, 0.22);
        const lid = add(g, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.228, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.6)), fur), 0, 0, 0);
        lid.rotation.x = 0.35;
        head.add(g);
      }
      break;
    }
    case 'spark': {
      // Спаркс (черновой): жёлтый шар с фетровой короной искр.
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.31, 32, 24)), fur), 0, 0, 0);
      const ray = kit.felt(accent);
      for (let i = 0; i < 9; i++) {
        const a = -1.2 + i * 0.3;
        const sp = add(head, new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.06, 0.2, 8)), ray), Math.sin(a) * 0.32, Math.cos(a) * 0.32, -0.02);
        sp.rotation.z = -a;
      }
      buttonEye(kit, head, -0.1, 0.04, 0.29, 0.06, s.eye);
      buttonEye(kit, head, 0.1, 0.04, 0.29, 0.06, s.eye);
      stitchedSmile(kit, head, -0.09, 0.3);
      break;
    }
    case 'bear': {
      // Сеня (черновой): круглые уши, светлая морда.
      skull();
      for (const sx of [-1, 1]) {
        add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.1, 16, 12)), fur), sx * 0.24, 0.24, -0.02);
        add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.055, 12, 10)), detail), sx * 0.24, 0.24, 0.05);
      }
      const muzzle = add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.12, 24, 16)), detail), 0, -0.09, 0.25);
      muzzle.scale.set(1.2, 0.8, 0.8);
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.045, 14, 10)), nose), 0, -0.05, 0.35);
      buttonEye(kit, head, -0.1, 0.07, 0.28, 0.05, s.eye);
      buttonEye(kit, head, 0.1, 0.07, 0.28, 0.05, s.eye);
      break;
    }
    case 'robot': {
      // Дигги (черновой): мягкая подушка-монитор с экраном-лицом и антенной-помпоном.
      add(head, new THREE.Mesh(kit.geo(new RoundedBoxGeometry(0.58, 0.48, 0.48, 6, 0.15)), fur), 0, 0, 0);
      add(head, new THREE.Mesh(kit.geo(new RoundedBoxGeometry(0.42, 0.28, 0.04, 4, 0.07)), kit.plain(s.detail, { roughness: 0.2 })), 0, 0, 0.24);
      const led = kit.plain(s.eye, { emissive: s.eye, emissiveIntensity: 1.6, clearcoat: 0 });
      for (const sx of [-1, 1]) add(head, new THREE.Mesh(kit.geo(new RoundedBoxGeometry(0.07, 0.1, 0.02, 2, 0.025)), led), sx * 0.09, 0.03, 0.265);
      add(head, new THREE.Mesh(kit.geo(new RoundedBoxGeometry(0.15, 0.03, 0.02, 2, 0.01)), led), 0, -0.07, 0.265);
      add(head, new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6)), kit.plain(0x2b2f3a)), 0, 0.32, 0);
      add(head, new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.055, 12, 10)), kit.felt(accent)), 0, 0.42, 0);
      break;
    }
    case 'heart': {
      // Лайкоша: голова-сердечко из толстого фетра.
      const hs = new THREE.Shape();
      hs.moveTo(0, -0.3);
      hs.bezierCurveTo(-0.46, 0, -0.34, 0.34, 0, 0.15);
      hs.bezierCurveTo(0.34, 0.34, 0.46, 0, 0, -0.3);
      add(head, new THREE.Mesh(kit.geo(new THREE.ExtrudeGeometry(hs, { depth: 0.24, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 8, curveSegments: 32 })), fur), 0, 0, -0.12);
      buttonEye(kit, head, -0.1, 0.04, 0.24, 0.055, s.eye);
      buttonEye(kit, head, 0.1, 0.04, 0.24, 0.055, s.eye);
      stitchedSmile(kit, head, -0.08, 0.24, 0.07, 0xffffff);
      break;
    }
    case 'helmet':
      break;
  }
  return head;
}

export function buildTail(kind: 'dog' | 'cat', color: number, kit: MascotKit): THREE.Group {
  const g = new THREE.Group();
  const mat = kit.knit(color);
  if (kind === 'dog') {
    const t = add(g, new THREE.Mesh(kit.geo(new THREE.CapsuleGeometry(0.05, 0.2, 6, 10)), mat), 0, 0.1, 0);
    t.rotation.x = -0.9;
  } else {
    for (let i = 0; i < 4; i++) {
      const seg = add(g, new THREE.Mesh(kit.geo(new THREE.CapsuleGeometry(0.045, 0.09, 6, 10)), mat), 0, 0.06 + i * 0.09, -i * 0.03);
      seg.rotation.x = -0.4 - i * 0.15;
    }
  }
  return g;
}
