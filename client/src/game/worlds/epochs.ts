import * as THREE from 'three';
import { craft, cutout, glowing, hillsShape, mesh, polyShape, skyTexture, soft, stitchLine } from '../craft.ts';
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
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 14, bottom: -4, near: 1, far: 80 });
  g.add(sun);
  // Контровой свет сзади — «обводит» силуэты, как софтбокс над диорамой.
  const rim = new THREE.DirectionalLight(p.night ? 0x8fa8ff : 0xfff2dd, p.night ? 1.4 : 1);
  rim.position.set(-4, 6, -10);
  g.add(rim);

  // Пол-стол до горизонта и кочки-кулисы переднего плана.
  const floor = mesh(new THREE.PlaneGeometry(260, 80), craft('felt', tint(p.ground, 0.5)), 0, -1.6, -20);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  g.add(floor);
  for (let x = -40; x <= 40; x += 4.6) {
    const tuft = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const b = mesh(new THREE.SphereGeometry(0.7 + ((x * 7 + k) % 5) * 0.1, 20, 14), craft('felt', p.tuft), k * 0.7, 0, 0, false);
      b.scale.set(1, 0.7, 0.7);
      tuft.add(b);
    }
    tuft.position.set(x + ((x * 13) % 3), -1.6, 4.4);
    g.add(tuft);
  }
  g.add(cutout(hillsShape(4, 1.8, 0.08, 1), p.hills[2], -34, 0.5));
  g.add(cutout(hillsShape(2, 1.2, 0.13, 3), p.hills[1], -22, 0.5));
  g.add(cutout(hillsShape(0.4, 0.7, 0.2, 5), p.hills[0], -12, 0.4));
  if (p.night) g.add(stars(1200, 90, 0xfff6dc, 0.35));
  g.add(landedShip(-25));
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
  return (t) => list.forEach((c, i) => (c.position.x = ((-40 + i * 16 + t * 0.5 + 50) % 100) - 50));
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
  for (const [x, s] of [[-30, 9], [-14, 12], [26, 10]] as const) g.add(cutout(polyShape([[x - s, -1], [x, s * 0.9], [x + s, -1]]), 0xe9c07a, -28, 0.6, 'card'));
  const lib = new THREE.Group();
  for (let x = 18; x <= 27; x += 1.8) lib.add(mesh(new THREE.CylinderGeometry(0.3, 0.36, 5, 20), craft('card', 0xf6ead0), x, 2.5, -6));
  lib.add(mesh(soft(11, 0.7, 2, 0.2), craft('card', 0xf6ead0), 22.5, 5.3, -6));
  const roof = mesh(new THREE.CylinderGeometry(0.01, 6, 1.6, 3), craft('felt', 0x2bb5a8), 22.5, 6.4, -6);
  roof.scale.z = 0.3;
  lib.add(roof);
  g.add(lib);
  for (const x of [-20, -13, 4, 9]) g.add(palm(x, -6));
  g.add(signSprite('СИЕНА', -9, 4.6, -2, 2.6, '#a8642a'));
  g.add(signSprite('АЛЕКСАНДРИЯ', 13, 7.4, -2, 3.6, '#a8642a'));
  g.add(signSprite('← 5000 стадий →', 2, 3.2, -3, 3.2, '#2bb5a8'));
  return { update: clouds(g, 6) };
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
  for (let i = 0; i < 12; i++) {
    const x = -30 + i * 5.5;
    const h = 6 + ((i * 37) % 4);
    const hs = house(4.6, h, [0x9a5238, 0xb46a46, 0x7f4530][i % 3], 0x5a2a20, 1.1);
    hs.position.set(x, 0, -16);
    g.add(hs);
  }
  const arm = new THREE.Group();
  arm.position.set(-4, 1.45, -2.2);
  arm.add(mesh(new THREE.SphereGeometry(0.15, 16, 12), glowing(0xffd36b, 1.5)));
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = mesh(new THREE.TorusGeometry(0.35 + i * 0.12, 0.03, 8, 40), craft('metal', 0xc9a14a));
    r.rotation.x = Math.PI / 2 + i * 0.4;
    rings.push(r);
    arm.add(r);
  }
  g.add(arm);
  const scope = mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 16), craft('wood', 0x8a5532), 18.6, 6.6, -1.2);
  scope.rotation.z = -0.9;
  g.add(scope, mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8), craft('metal', 0x444444), 18.3, 6.1, -1.2));
  const lamp = new THREE.PointLight(0xffb35c, 12, 9);
  lamp.position.set(-4, 3, -1);
  g.add(lamp);
  g.add(signSprite('МАСТЕРСКАЯ', -4, 3.8, -2, 3, '#b5603f'));
  g.add(signSprite('ТЕЛЕСКОП', 18, 8.2, -2, 2.6, '#b5603f'));
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
  for (const [x, z, s] of [[-28, -9, 1.2], [16, -10, 1.4], [30, -8, 1]] as const) {
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
  target.position.set(26, 1.4, -2);
  target.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 8), craft('wood', 0x6b4423), 0, -0.2, -0.1));
  [1, 0.72, 0.44, 0.18].forEach((r, i) => {
    const d = mesh(new THREE.CylinderGeometry(r, r, 0.08 + i * 0.01, 32), craft('felt', i % 2 ? 0xfff4dc : 0xe8382f), 0, 0.6, i * 0.014);
    d.rotation.x = Math.PI / 2;
    target.add(d);
  });
  g.add(target);
  for (let x = -12; x <= 28; x += 3) g.add(mesh(soft(0.18, 0.9, 0.18, 0.06), craft('wood', 0x8b6a3e), x, 0.45, -1.95));
  const rail = stitchLine(40, 0x8b6a3e, 0.6);
  rail.position.set(8, 0.7, -1.95);
  g.add(rail);
  g.add(signSprite('ПУШКА', -6, 4.6, -2, 2.2, '#4f7a3a'));
  g.add(signSprite('ПОЛЕ МИШЕНЕЙ', 21, 4.6, -2, 3.4, '#4f7a3a'));
  return { update: clouds(g, 6) };
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
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.14, 9, 10), craft('metal', 0x666a70), -10.8, 4.5, -3.2));
  for (const y of [5, 7, 8.6]) g.add(mesh(soft(1.6 - y * 0.12, 0.08, 0.08, 0.03), craft('metal', 0x666a70), -10.8, y, -3.2));
  const beacon = mesh(new THREE.SphereGeometry(0.2, 14, 10), glowing(0xff3b3b, 2.5), -10.8, 9.1, -3.2, false);
  g.add(beacon);
  const drums: THREE.Mesh[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      const d = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 24), craft('felt', [0x2e86de, 0xe8382f, 0x27ae60][r]), 13 + c * 0.75, 0.6 + r * 0.7, -1.82);
      d.rotation.x = Math.PI / 2;
      drums.push(d);
      g.add(d);
    }
  }
  g.add(signSprite('РАДИОРУБКА', -8, 5.4, -2, 3, '#4a5a3a'));
  g.add(signSprite('«БОМБА»', 15, 4.2, -2, 2.4, '#4a5a3a'));
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
  g.add(mesh(soft(5, 0.6, 4, 0.2), craft('card', 0x7f8c8d), 24, 0.3, -2.6));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 12), craft('metal', 0x444444), -11, 2.2, -2.2));
  g.add(mesh(soft(0.5, 0.26, 0.26, 0.08), craft('metal', 0x444444), -10.8, 2.9, -2.2));
  const lights: THREE.Mesh[] = [];
  for (let y = 1; y < 8; y += 2) {
    const l = mesh(new THREE.SphereGeometry(0.12, 10, 8), glowing(0xff3b3b, 2), 21.6, y, -1.9, false);
    lights.push(l);
    g.add(l);
  }
  for (let i = 0; i < 3; i++) {
    const tank = mesh(new THREE.CapsuleGeometry(0.5, 0.9, 8, 20), craft('metal', 0xdfe6ee), 11 + i * 1.3, 0.55, -2.3);
    tank.rotation.z = Math.PI / 2;
    g.add(tank);
  }
  g.add(signSprite('БУНКЕР', -11, 3.8, -2, 2.4, '#a8452a'));
  g.add(signSprite('МОНТАЖНЫЙ ЦЕХ', 12, 3.4, -2, 3.6, '#a8452a'));
  g.add(signSprite('ВОСТОК', 24, 11.8, -2.4, 2.4, '#e8382f'));
  const drift = clouds(g, 5, 13);
  return {
    update(t) {
      drift(t);
      lights.forEach((l, i) => (l.visible = Math.sin(t * 3 + i) > -0.2));
    },
  };
}
