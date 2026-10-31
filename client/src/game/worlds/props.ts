import * as THREE from 'three';
import { craft, glowing, mesh, soft, stitchRing, stripeTexture } from '../craft.ts';

/**
 * Интерактивные объекты полосы препятствий (заготовка: пока только вид, механику подключим позже).
 * Единый язык: материал стиля + цветной кант по типу взаимодействия — игрок с первого взгляда
 * понимает, что делать с предметом. Цвета AFFORDANCE не переиспользовать для декора.
 *
 * Анимированный объект кладёт функцию в root.userData.update(t) — buildWorld вызывает её каждый кадр.
 */
export const AFFORDANCE = {
  /** Толкать / тащить (ящики). */
  push: 0xff9a1f,
  /** Пружинить (батуты). */
  bounce: 0xff4fa3,
  /** Опасно (стрелы, ров, шипы). */
  danger: 0xe8382f,
  /** Поток воздуха (вентиляторы). */
  wind: 0x37c8ff,
  /** Лазать / раскачиваться (верёвки). */
  climb: 0xf2d16b,
} as const;

export type PropKind = 'crate' | 'rope' | 'trampoline' | 'fan' | 'arrows' | 'moat';

const onUpdate = (o: THREE.Object3D, f: (t: number) => void) => {
  o.userData.update = f;
  return o;
};

/** Кант-обводка в плоскости XZ (эллипс w×d) — подсказка «с этим можно взаимодействовать». */
function rim(color: number, w: number, d: number, y: number) {
  const t = mesh(new THREE.TorusGeometry(1, 0.05, 8, 48), glowing(color, 0.35), 0, y, 0, false);
  t.rotation.x = Math.PI / 2;
  t.scale.set(w / 2, d / 2, 1);
  return t;
}

/** Ящик: картон/доски, скотч крест-накрест, оранжевая наклейка-«ручка» и кант по крышке. Габарит s×s×s, низ в y=0. */
export function crate(s = 1, wood = 0xb5763d): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(soft(s, s, s, 0.08), craft('card', wood), 0, s / 2));
  const tape = craft('felt', 0xe8d9b0);
  g.add(mesh(soft(s + 0.02, 0.16, s + 0.02, 0.04), tape, 0, s / 2));
  g.add(mesh(soft(0.16, s + 0.02, s + 0.02, 0.04), tape, 0, s / 2));
  g.add(mesh(new THREE.CircleGeometry(0.2 * s, 32), glowing(AFFORDANCE.push, 0.25), 0.26 * s, 0.76 * s, s / 2 + 0.015, false));
  g.add(rim(AFFORDANCE.push, s * 1.02, s * 1.02, s + 0.02));
  return g;
}

/** Верёвка с узлами-хваталками, свисает с перекладины. (0,0) — точка крепления, len — длина вниз. */
export function rope(len = 2.6, beam = 0x8a5532): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(soft(2.4, 0.3, 0.6, 0.12), craft('wood', beam), 0, 0.15));
  const swing = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.08, -len * 0.5, 0.05), new THREE.Vector3(0.2, -len, 0.1)]);
  const knit = craft('knit', AFFORDANCE.climb);
  swing.add(mesh(new THREE.TubeGeometry(curve, 40, 0.07, 10), knit));
  for (let i = 1; i <= 4; i++) {
    const p = curve.getPoint(i / 4.4);
    swing.add(mesh(new THREE.SphereGeometry(0.14, 16, 12), knit, p.x, p.y, p.z));
  }
  const end = curve.getPoint(1);
  swing.add(mesh(new THREE.ConeGeometry(0.16, 0.35, 12), craft('felt', AFFORDANCE.climb), end.x, end.y - 0.12, end.z));
  g.add(swing);
  return onUpdate(g, (t) => (swing.rotation.z = Math.sin(t * 1.4) * 0.06)) as THREE.Group;
}

/** Батут: металлическая чаша, пружины, розовая фетровая мембрана с белым кантом. Низ в y=0, верх ≈ 0.95. */
export function trampoline(r = 0.9): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.05, 0.3, 32), craft('metal', 0x8a8f99), 0, 0.15));
  for (let i = 0; i < 5; i++) {
    const coil = mesh(new THREE.TorusGeometry(r * 0.7, 0.05, 8, 32), craft('metal', 0xcfd6e0), 0, 0.36 + i * 0.09);
    coil.rotation.x = Math.PI / 2;
    g.add(coil);
  }
  const pad = mesh(new THREE.CylinderGeometry(r, r, 0.18, 40), craft('felt', AFFORDANCE.bounce), 0, 0.86);
  g.add(pad, rim(0xffffff, r * 2.1, r * 2.1, 0.96));
  const st = stitchRing(r * 0.75, 28);
  st.position.y = 0.96;
  g.add(st);
  return onUpdate(g, (t) => {
    const k = 1 + Math.max(0, Math.sin(t * 3)) * 0.12;
    pad.scale.set(1, 1 / k, 1);
  }) as THREE.Group;
}

/** Вентилятор, дующий вверх: корпус, голубое кольцо, вращающиеся лопасти и ленточки потока. Низ в y=0. */
export function fan(size = 1.6): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(soft(size, 0.5, size, 0.16), craft('metal', 0x5a6070), 0, 0.25));
  const ring = mesh(new THREE.TorusGeometry(size * 0.45, 0.08, 10, 40), craft('felt', AFFORDANCE.wind), 0, 0.55);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const blades = new THREE.Group();
  blades.position.y = 0.55;
  for (let i = 0; i < 4; i++) {
    const b = mesh(new THREE.SphereGeometry(size * 0.21, 16, 8), craft('plain', 0xeef2f6), Math.cos(i * 1.57) * size * 0.21, 0, Math.sin(i * 1.57) * size * 0.21);
    b.scale.set(1, 0.12, 0.45);
    b.rotation.y = -i * 1.57;
    blades.add(b);
  }
  g.add(blades);
  const flow = new THREE.Group();
  const ribbonMat = new THREE.MeshBasicMaterial({ color: AFFORDANCE.wind, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const curve = new THREE.CatmullRomCurve3([0, 1, 2, 3].map((k) => new THREE.Vector3(Math.cos(a + k * 0.7) * 0.4, 0.8 + k * 0.9, Math.sin(a + k * 0.7) * 0.4)));
    flow.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.035, 6), ribbonMat));
  }
  g.add(flow);
  return onUpdate(g, (t) => {
    blades.rotation.y = t * 9;
    flow.rotation.y = t * 1.5;
  }) as THREE.Group;
}

/** Стрелы: каменная голова-лучник с красной щелью, стрелы летят влево на высоте ~0.9. Низ в y=0. */
export function arrows(range = 4.2): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(soft(0.9, 1.4, 1, 0.12), craft('card', 0x9a8a72), 0, 0.7));
  g.add(mesh(soft(0.5, 0.16, 0.2, 0.05), glowing(AFFORDANCE.danger, 0.9), -0.35, 0.9, 0.3));
  const shots: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Group();
    const shaft = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), craft('wood', 0xb07a40));
    shaft.rotation.z = Math.PI / 2;
    const tip = mesh(new THREE.ConeGeometry(0.07, 0.2, 8), craft('metal', 0x9aa0a8), -0.53, 0, 0);
    tip.rotation.z = Math.PI / 2;
    a.add(shaft, tip);
    for (const s of [-1, 1]) {
      const f = mesh(new THREE.BoxGeometry(0.2, 0.01, 0.12), craft('felt', AFFORDANCE.danger), 0.38, 0, s * 0.05);
      f.rotation.x = s * 0.6;
      a.add(f);
    }
    a.position.set(0, 0.9, 0.3);
    shots.push(a);
    g.add(a);
  }
  return onUpdate(g, (t) => shots.forEach((a, i) => (a.position.x = -0.8 - ((t * 2.2 + i * 1.4) % range)))) as THREE.Group;
}

/** Ров шириной w по всей глубине d: колышущаяся вода (или лава) и предупреждающие ленты по краям. Верх воды в y=0. */
export function moat(w: number, d = 3.2, liquid = 0x2fb8d0, lava = false): THREE.Group {
  const g = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d, Math.max(8, Math.round(w * 10)), 10),
    new THREE.MeshPhysicalMaterial({ color: liquid, roughness: 0.15, clearcoat: 1, emissive: lava ? liquid : 0x000000, emissiveIntensity: lava ? 0.6 : 0 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = true;
  g.add(water);
  const pos = water.geometry.attributes.position as THREE.BufferAttribute;
  const base = Float32Array.from(pos.array as Float32Array);
  const tape = new THREE.MeshStandardMaterial({ map: stripeTexture('#fff2c4', '#e8382f'), roughness: 0.8 });
  for (const ex of [-w / 2 + 0.05, w / 2 - 0.05]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.3, d), tape, ex, 0.55, 0));
  return onUpdate(g, (t) => {
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, Math.sin(base[i * 3] * 3 + t * 2) * 0.05 + Math.cos(base[i * 3 + 1] * 2 + t) * 0.04);
    }
    pos.needsUpdate = true;
  }) as THREE.Group;
}

/** Объект по виду платформы — для platformMesh и витрины. */
export function buildProp(kind: PropKind, w: number, h: number, d: number, color: number): THREE.Group {
  switch (kind) {
    case 'crate':
      return crate(Math.min(w, h, d), color);
    case 'rope':
      return rope(h, color);
    case 'trampoline':
      return trampoline(w / 2);
    case 'fan':
      return fan(w);
    case 'arrows':
      return arrows();
    case 'moat':
      return moat(w, d, color, color === 0xff7a2a);
  }
}
