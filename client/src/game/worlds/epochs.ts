import * as THREE from 'three';
import { craft, cutout, glowing, hillsShape, mesh, polyShape, rnd, skyTexture, soft, stitchLine } from '../craft.ts';
import { landedShip, stars, tint } from './common.ts';
import { signSprite, type Decor } from './decor.ts';

/**
 * Эпохи в «рукодельном» стиле: каждая — диорама на столе. Небо-градиент, фетровые облака,
 * слои холмов-вырезок, пол-«стол» до горизонта и размытые кочки на переднем плане.
 * Палитра эпохи задаёт всё сразу, поэтому стиль единый, а настроение у каждой своё.
 */
interface Palette {
  sky: [bottom: string, top: string];
  ambient: number;
  ground: number;
  sun: { color: number; intensity: number; pos: [number, number, number] };
  /** Ближний → дальний слой холмов. */
  hills: [number, number, number];
  tuft: number;
  night?: boolean;
}

function diorama(g: THREE.Group, scene: THREE.Scene, p: Palette) {
  scene.background = skyTexture(...p.sky);
  scene.fog = new THREE.Fog(new THREE.Color(p.sky[0]).getHex(), 40, 120);
  scene.environmentIntensity = p.night ? 0.25 : 0.45;
  g.add(new THREE.HemisphereLight(p.ambient, p.ground, p.night ? 0.9 : 1.1));
  const sun = new THREE.DirectionalLight(p.sun.color, p.sun.intensity);
  sun.position.set(...p.sun.pos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 2048);
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 16, bottom: -4, near: 1, far: 80 });
  sun.userData.follow = true;
  g.add(sun, sun.target);
  // Контровой свет сзади — «обводит» силуэты, как софтбокс над диорамой.
  const rim = new THREE.DirectionalLight(p.night ? 0x8fa8ff : 0xfff2dd, p.night ? 1.4 : 1);
  rim.position.set(-4, 6, -10);
  g.add(rim);

  // Пол-стол до горизонта и кочки-кулисы переднего плана.
  const floor = mesh(new THREE.PlaneGeometry(260, 80), craft('felt', tint(p.ground, 0.5)), 0, -1.6, -20);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  g.add(floor);
  for (let x = -70; x <= 130; x += 4.6) {
    const tuft = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const b = mesh(new THREE.SphereGeometry(0.7 + ((x * 7 + k) % 5) * 0.1, 20, 14), craft('felt', p.tuft), k * 0.7, 0, 0, false);
      b.scale.set(1, 0.7, 0.7);
      tuft.add(b);
    }
    tuft.position.set(x + ((x * 13) % 3), -1.6, 4.4);
    g.add(tuft);
  }
  g.add(cutout(hillsShape(4, 1.8, 0.08, 1, 130), p.hills[2], -34, 0.5));
  g.add(cutout(hillsShape(2, 1.2, 0.13, 3, 130), p.hills[1], -22, 0.5));
  g.add(cutout(hillsShape(0.4, 0.7, 0.2, 5, 130), p.hills[0], -12, 0.4));
  if (p.night) g.add(stars(1200, 90, 0xfff6dc, 0.35));
  g.add(landedShip(-25));
  surroundings(g, p);
}

/** Не ставим кулисы туда, где бегает игрок: дорожка уровня и её края (EPOCH_BOUNDS в shared). */
const LANE_HALF = 3;
const LEVEL_MIN_X = -31;
const LEVEL_MAX_X = 101;
/** Насколько окрестности тянутся по x — пол и холмы заканчиваются на ±130. */
const SCATTER = { from: -70, to: 128 };

/**
 * Окрестности диорамы — то, что открывается, когда камера поворачивается по ходу движения:
 * низкие кусты и камни-«пуфы» перед дорожкой (ниже линии взгляда), рощицы и валуны за ней,
 * а за краями уровня — крупные кулисы, чтобы мир не обрывался.
 */
function surroundings(g: THREE.Group, p: Palette) {
  const bush = (x: number, z: number, s: number, color: number) => {
    const b = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const r = (0.5 + rnd() * 0.35) * s;
      const ball = mesh(new THREE.SphereGeometry(r, 18, 12), craft('felt', color), (k - 1) * 0.55 * s, r * 0.55, (rnd() - 0.5) * 0.4 * s, false);
      ball.scale.y = 0.75;
      b.add(ball);
    }
    b.position.set(x, -1.6, z);
    b.rotation.y = rnd() * Math.PI;
    return b;
  };
  const rock = (x: number, z: number, s: number, color: number) => {
    const r = mesh(new THREE.DodecahedronGeometry(s, 1), craft('card', color), x, -1.6 + s * 0.45, z);
    r.scale.set(1.2, 0.7, 1);
    r.rotation.y = rnd() * Math.PI;
    return r;
  };
  const flower = (x: number, z: number, color: number) => {
    const f = new THREE.Group();
    f.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), craft('felt', 0x4f9a3c), 0, 0.3, 0, false));
    f.add(mesh(new THREE.SphereGeometry(0.14, 12, 8), craft('felt', color), 0, 0.62, 0, false));
    f.position.set(x, -1.6, z);
    return f;
  };
  const petals = [0xffffff, 0xffd36b, 0xff8fa3, 0x9fc7ff];

  // Передний план: низко, чтобы не загораживать игрока (верх ниже y≈-0.3).
  const span = SCATTER.to - SCATTER.from;
  for (let i = 0; i < 100; i++) {
    const x = SCATTER.from + rnd() * span;
    const z = LANE_HALF + 2 + rnd() * 12;
    const roll = rnd();
    if (roll < 0.45) g.add(bush(x, z, 0.6 + rnd() * 0.4, rnd() < 0.5 ? p.tuft : p.hills[0]));
    else if (roll < 0.7) g.add(rock(x, z, 0.35 + rnd() * 0.35, tint(p.ground, 0.9 + rnd() * 0.3)));
    else for (let k = 0; k < 3; k++) g.add(flower(x + (rnd() - 0.5) * 1.4, z + (rnd() - 0.5) * 1.4, petals[(i + k) % petals.length]));
  }
  // Средний план за дорожкой: кусты покрупнее и валуны.
  for (let i = 0; i < 56; i++) {
    const x = SCATTER.from + rnd() * span;
    const z = -LANE_HALF - 4 - rnd() * 9;
    if (rnd() < 0.6) g.add(bush(x, z, 1 + rnd() * 0.8, p.hills[Math.floor(rnd() * 3)]));
    else g.add(rock(x, z, 0.7 + rnd() * 0.8, tint(p.ground, 0.8 + rnd() * 0.3)));
  }
  // Кулисы за краями уровня: крупные холмы-подушки поперёк дорожки, чтобы конец мира не был пустым.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = (side < 0 ? LEVEL_MIN_X : LEVEL_MAX_X) + side * (5 + i * 4 + rnd() * 3);
      const z = -8 + rnd() * 18;
      const s = 2.2 + rnd() * 2;
      const hill = mesh(new THREE.SphereGeometry(s, 28, 18), craft('felt', p.hills[i % 3]), x, -1.6, z);
      hill.scale.set(1.4, 0.8, 1.1);
      g.add(hill);
      g.add(bush(x + side * s, z + s, 1.2, p.tuft));
    }
  }
}

/** Облака-подушки из фетра, медленно плывут. */
function clouds(g: THREE.Group, n: number, y = 11): (t: number) => void {
  const list: THREE.Group[] = [];
  for (let i = 0; i < n; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const s = mesh(new THREE.SphereGeometry(1 + (k % 2) * 0.5, 24, 16), craft('felt', 0xffffff), k * 1.3 - 2, (k % 2) * 0.4, 0, false);
      s.scale.z = 0.6;
      c.add(s);
    }
    c.position.set(-40 + i * 16, y + (i % 2) * 3, -24 - (i % 3) * 4);
    list.push(c);
    g.add(c);
  }
  // Облака плывут вправо по всей длине уровня и возвращаются слева.
  return (t) => list.forEach((c, i) => (c.position.x = ((i * 16 + t * 0.5) % 180) - 50));
}

function disc(g: THREE.Group, color: number, r: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color, fog: false }));
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function palm(x: number, z: number) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.4, 2.2, 0), new THREE.Vector3(0.2, 4.4, 0)]);
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.22, 12), craft('wood', 0x9a6a3a)));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = mesh(new THREE.SphereGeometry(1, 20, 10), craft('felt', 0x3f9a52), 0.2 + Math.cos(a), 4, Math.sin(a) * 0.6);
    leaf.scale.set(1.3, 0.16, 0.4);
    leaf.rotation.set(0, -a, -0.4 * Math.sign(Math.cos(a) || 1));
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  return g;
}

/** Домик-«кукольный»: картон, крыша-пирамида из фетра, окна-заплатки (светятся ночью). */
function house(w: number, h: number, wall: number, roof: number, windowGlow: number) {
  const g = new THREE.Group();
  g.add(mesh(soft(w, h, 2, 0.2), craft('card', wall), 0, h / 2 - 0.6));
  const r = mesh(new THREE.CylinderGeometry(0.01, w * 0.72, 1.4, 4), craft('felt', roof), 0, h + 0.1);
  r.rotation.y = Math.PI / 4;
  r.scale.z = 0.6;
  g.add(r);
  for (let k = 0; k < 2; k++) g.add(mesh(soft(0.7, 0.9, 0.1, 0.1), glowing(0xffb85c, windowGlow), -w * 0.22 + k * w * 0.44, h * 0.6, 1.02, false));
  return g;
}

/** Сиена и Александрия: пустыня, пирамиды, обелиск, колоннада библиотеки, пальмы. */
export function decorateAlexandria(g: THREE.Group, scene: THREE.Scene): Decor {
  diorama(g, scene, {
    sky: ['#ffe2a8', '#f7b46a'], ambient: 0xffd9a8, ground: 0xd59a55, tuft: 0xe8c48a,
    sun: { color: 0xfff0d0, intensity: 2.4, pos: [8, 18, 10] }, hills: [0xe0a862, 0xd99c5a, 0xc98a4c],
  });
  disc(g, 0xfff3c0, 3, 12, 20, -60);
  for (const [x, s] of [[-26, 9], [-4, 12], [40, 10], [70, 13], [104, 9]] as const) g.add(cutout(polyShape([[x - s, -1], [x, s * 0.9], [x + s, -1]]), 0xe9c07a, -28, 0.6, 'card'));
  const lib = new THREE.Group();
  for (let x = 84; x <= 93; x += 1.8) lib.add(mesh(new THREE.CylinderGeometry(0.3, 0.36, 7, 20), craft('card', 0xf6ead0), x, 3.5, -6));
  lib.add(mesh(soft(11, 0.7, 2, 0.2), craft('card', 0xf6ead0), 88.5, 7.3, -6));
  const roof = mesh(new THREE.CylinderGeometry(0.01, 6, 1.6, 3), craft('felt', 0x2bb5a8), 88.5, 8.4, -6);
  roof.scale.z = 0.3;
  lib.add(roof);
  g.add(lib);
  for (const x of [-20, -13, 4, 20, 47, 63, 76, 99]) g.add(palm(x, -6));
  g.add(signSprite('СИЕНА', 35, 5, -2, 2.6, '#a8642a'));
  g.add(signSprite('АЛЕКСАНДРИЯ', 89, 8.4, -2, 3.6, '#a8642a'));
  g.add(signSprite('← 5000 стадий →', 62, 4.2, -3, 3.2, '#2bb5a8'));
  return { update: clouds(g, 11) };
}

/** Падуя, ночь: дома с огнями, луна, яркая Венера, армиллярная сфера в мастерской, телескоп на крыше. */
export function decoratePadua(g: THREE.Group, scene: THREE.Scene): Decor {
  diorama(g, scene, {
    sky: ['#2b3a7a', '#0e1433'], ambient: 0x5a5fb0, ground: 0x6a3a2e, tuft: 0x4a2f3a, night: true,
    sun: { color: 0xb8c8ff, intensity: 1.3, pos: [-6, 16, 10] }, hills: [0x3a2f5c, 0x2c2449, 0x211a38],
  });
  disc(g, 0xfff6dc, 2.5, -28, 22, -70);
  const venus = mesh(new THREE.SphereGeometry(0.6, 16, 12), glowing(0xfff6c8, 3), 30, 16, -60, false);
  g.add(venus);
  for (let i = 0; i < 24; i++) {
    const x = -30 + i * 5.5;
    const h = 6 + ((i * 37) % 4);
    const hs = house(4.6, h, [0x9a5238, 0xb46a46, 0x7f4530][i % 3], 0x5a2a20, 1.1);
    hs.position.set(x, 0, -16);
    g.add(hs);
  }
  const arm = new THREE.Group();
  arm.position.set(41.5, 4.25, -2.2);
  arm.add(mesh(new THREE.SphereGeometry(0.15, 16, 12), glowing(0xffd36b, 1.5)));
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = mesh(new THREE.TorusGeometry(0.35 + i * 0.12, 0.03, 8, 40), craft('metal', 0xc9a14a));
    r.rotation.x = Math.PI / 2 + i * 0.4;
    rings.push(r);
    arm.add(r);
  }
  g.add(arm);
  const scope = mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 16), craft('wood', 0x8a5532), 93.6, 7.4, -1.2);
  scope.rotation.z = -0.9;
  g.add(scope, mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8), craft('metal', 0x444444), 93.3, 6.9, -1.2));
  const lamp = new THREE.PointLight(0xffb35c, 12, 9);
  lamp.position.set(41.5, 5.8, -1);
  g.add(lamp);
  g.add(signSprite('МАСТЕРСКАЯ', 41, 6.6, -2, 3, '#b5603f'));
  g.add(signSprite('ТЕЛЕСКОП', 93, 9.2, -2, 2.6, '#b5603f'));
  g.add(signSprite('ПЕРЕУЛОК СТРАЖИ', 6, 4.4, -2.6, 3.6, '#b5603f'));
  return {
    update(t) {
      rings.forEach((r, i) => (r.rotation.z = t * (0.3 + i * 0.2)));
      venus.scale.setScalar(1 + Math.sin(t * 3) * 0.1);
    },
  };
}

/** Англия, 1687: холмы, яблони, ферма, облака, поле с мишенью и забор. */
export function decorateWoolsthorpe(g: THREE.Group, scene: THREE.Scene): Decor {
  diorama(g, scene, {
    sky: ['#dff3ff', '#9fd3f0'], ambient: 0xcfe8ff, ground: 0x6f9a45, tuft: 0x86b85a,
    sun: { color: 0xfffbe8, intensity: 2.4, pos: [10, 20, 10] }, hills: [0x8cc06a, 0x76ab58, 0x5f9447],
  });
  disc(g, 0xfff3c0, 2.6, 14, 21, -60);
  for (const [x, z, s] of [[-28, -9, 1.2], [16, -10, 1.4], [38, -8, 1], [62, -10, 1.3], [88, -9, 1.1]] as const) {
    const tree = new THREE.Group();
    tree.add(mesh(new THREE.CylinderGeometry(0.3, 0.5, 3, 12), craft('wood', 0x7a5232), 0, 1.5));
    for (const [dx, dy, r] of [[0, 4, 1.8], [-1.3, 3.4, 1.2], [1.3, 3.5, 1.3], [0.4, 5, 1.1]] as const) tree.add(mesh(new THREE.SphereGeometry(r, 24, 16), craft('felt', 0x4f9a3c), dx, dy, 0));
    for (let i = 0; i < 9; i++) tree.add(mesh(new THREE.SphereGeometry(0.18, 12, 10), craft('plain', 0xe8473b), Math.sin(i * 2.1) * 1.5, 3 + (i % 3) * 0.7, 1.3));
    tree.position.set(x, 0, z);
    tree.scale.setScalar(s);
    g.add(tree);
  }
  const farm = house(5, 3.4, 0xf3e6c8, 0x8a4a2a, 0.3);
  farm.position.set(-2, 0, -14);
  g.add(farm);
  const target = new THREE.Group();
  target.position.set(97, 1.4, -2);
  target.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 8), craft('wood', 0x6b4423), 0, -0.2, -0.1));
  [1, 0.72, 0.44, 0.18].forEach((r, i) => {
    const d = mesh(new THREE.CylinderGeometry(r, r, 0.08 + i * 0.01, 32), craft('felt', i % 2 ? 0xfff4dc : 0xe8382f), 0, 0.6, i * 0.014);
    d.rotation.x = Math.PI / 2;
    target.add(d);
  });
  g.add(target);
  for (let x = 48; x <= 98; x += 3) g.add(mesh(soft(0.18, 0.9, 0.18, 0.06), craft('wood', 0x8b6a3e), x, 0.45, -1.95));
  const rail = stitchLine(50, 0x8b6a3e, 0.6);
  rail.position.set(73, 0.7, -1.95);
  g.add(rail);
  g.add(signSprite('ПУШКА', 24, 7, -2, 2.2, '#4f7a3a'));
  g.add(signSprite('ПОЛЕ МИШЕНЕЙ', 70, 4.6, -2, 3.4, '#4f7a3a'));
  return { update: clouds(g, 11) };
}

/** Блетчли-парк: пасмурно, особняк, радиомачта с маячком, «бомба» с барабанами-роторами на бараке. */
export function decorateBletchley(g: THREE.Group, scene: THREE.Scene): Decor {
  diorama(g, scene, {
    sky: ['#c9d1cf', '#97a39f'], ambient: 0xb0bcb8, ground: 0x5d6a48, tuft: 0x74845a,
    sun: { color: 0xeef2f0, intensity: 1.7, pos: [-5, 18, 10] }, hills: [0x7a8a66, 0x6f5a4c, 0x5a4a40],
  });
  const manor = new THREE.Group();
  manor.add(mesh(soft(24, 8, 3, 0.3), craft('card', 0x9a5a44), 2, 3.4, -20));
  for (const x of [-7, 2, 11]) {
    const t = mesh(new THREE.CylinderGeometry(0.01, 2.4, 2.8, 4), craft('felt', 0x4a3a34), x, 8.8, -20);
    t.rotation.y = Math.PI / 4;
    t.scale.z = 0.6;
    manor.add(t);
  }
  for (let i = 0; i < 9; i++) manor.add(mesh(soft(1, 1.4, 0.1, 0.12), glowing(0xfff0c0, 0.5), -8 + i * 2.5, 4, -18.45, false));
  g.add(manor);
  const wing = manor.clone();
  wing.position.x = 62;
  g.add(wing);
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.14, 9, 10), craft('metal', 0x666a70), 26.5, 4.5, -3.2));
  for (const y of [5, 7, 8.6]) g.add(mesh(soft(1.6 - y * 0.12, 0.08, 0.08, 0.03), craft('metal', 0x666a70), 26.5, y, -3.2));
  const beacon = mesh(new THREE.SphereGeometry(0.2, 14, 10), glowing(0xff3b3b, 2.5), 26.5, 9.1, -3.2, false);
  g.add(beacon);
  const drums: THREE.Mesh[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      const d = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 24), craft('felt', [0x2e86de, 0xe8382f, 0x27ae60][r]), 86.1 + c * 0.75, 3.5 + r * 0.7, -1.82);
      d.rotation.x = Math.PI / 2;
      drums.push(d);
      g.add(d);
    }
  }
  g.add(signSprite('РАДИОРУБКА', 28, 6.4, -2, 3, '#4a5a3a'));
  g.add(signSprite('«БОМБА»', 88, 7, -2, 2.4, '#4a5a3a'));
  g.add(signSprite('ЛАБИРИНТ БАРАКОВ', 5.5, 4.8, -2.6, 3.6, '#4a5a3a'));
  return {
    update(t) {
      drums.forEach((d, i) => (d.rotation.y = t * (1 + (i % 6) * 0.3)));
      beacon.visible = Math.sin(t * 4) > 0;
    },
  };
}

/** Байконур, 1961: закат над степью, ракета у башни, бункер с перископом, баки в цеху. */
export function decorateBaikonur(g: THREE.Group, scene: THREE.Scene): Decor {
  diorama(g, scene, {
    sky: ['#ffc59a', '#e8735a'], ambient: 0xffb08a, ground: 0xb07a48, tuft: 0xd9a46a,
    sun: { color: 0xffd2a8, intensity: 2.2, pos: [-12, 10, 10] }, hills: [0xd08a60, 0xb87452, 0x9a6046],
  });
  disc(g, 0xfff0c0, 6, -36, 6, -80);
  g.add(mesh(soft(5, 0.6, 4, 0.2), craft('card', 0x7f8c8d), 86, 0.3, -2.6));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 12), craft('metal', 0x444444), 31.5, 4.2, -2.2));
  g.add(mesh(soft(0.5, 0.26, 0.26, 0.08), craft('metal', 0x444444), 31.7, 4.9, -2.2));
  const lights: THREE.Mesh[] = [];
  for (let y = 1; y < 8; y += 2) {
    const l = mesh(new THREE.SphereGeometry(0.12, 10, 8), glowing(0xff3b3b, 2), 83.6, y, -1.9, false);
    lights.push(l);
    g.add(l);
  }
  for (let i = 0; i < 3; i++) {
    const tank = mesh(new THREE.CapsuleGeometry(0.5, 0.9, 8, 20), craft('metal', 0xdfe6ee), 92 + i * 1.3, 0.55, -2.3);
    tank.rotation.z = Math.PI / 2;
    g.add(tank);
  }
  g.add(signSprite('БУНКЕР', 30, 5.6, -2, 2.4, '#a8452a'));
  g.add(signSprite('МОНТАЖНЫЕ ЛЕСА', 58, 13.4, -2, 3.6, '#a8452a'));
  g.add(signSprite('ВОСТОК', 86, 11.8, -2.4, 2.4, '#e8382f'));
  const drift = clouds(g, 9, 13);
  return {
    update(t) {
      drift(t);
      lights.forEach((l, i) => (l.visible = Math.sin(t * 3 + i) > -0.2));
    },
  };
}
