import * as THREE from 'three';
import { glow, landedShip, mesh, std, stars } from './common.ts';
import { signSprite, type Decor } from './decor.ts';

interface Sky {
  color: number;
  fog: [number, number];
  hemi: [number, number, number];
  sun: { color: number; intensity: number; pos: [number, number, number] };
}

function setup(g: THREE.Group, scene: THREE.Scene, sky: Sky) {
  scene.background = new THREE.Color(sky.color);
  scene.fog = new THREE.Fog(sky.color, sky.fog[0], sky.fog[1]);
  g.add(new THREE.HemisphereLight(sky.hemi[0], sky.hemi[1], sky.hemi[2]));
  const sun = new THREE.DirectionalLight(sky.sun.color, sky.sun.intensity);
  sun.position.set(...sky.sun.pos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 14, bottom: -4 });
  g.add(sun);
  g.add(landedShip(-25));
}

const flatten = (m: THREE.Mesh, sy: number) => (m.scale.y = sy, m);

/** Сиена и Александрия: пустыня, колодец без тени в полдень, обелиск с тенью, библиотека, пирамиды вдали. */
export function decorateAlexandria(g: THREE.Group, scene: THREE.Scene): Decor {
  setup(g, scene, { color: 0xf3c98b, fog: [30, 110], hemi: [0xfff1d6, 0xb08a5a, 1.1], sun: { color: 0xfff0c8, intensity: 2.2, pos: [8, 20, 6] } });
  g.add(mesh(new THREE.SphereGeometry(3, 24, 16), glow(0xfff3b0, 2), 10, 26, -60, false));
  for (const [x, s] of [[-30, 9], [-18, 13], [40, 11]] as const) {
    const pyr = mesh(new THREE.ConeGeometry(s, s * 0.9, 4), std(0xd9b77e), x, s * 0.45 - 1, -55, false);
    pyr.rotation.y = Math.PI / 4;
    g.add(pyr);
  }
  // Колоннада Александрийской библиотеки.
  for (let x = 18; x <= 27; x += 1.8) g.add(mesh(new THREE.CylinderGeometry(0.3, 0.35, 5, 12), std(0xf0e4c8), x, 2.5, -5));
  g.add(mesh(new THREE.BoxGeometry(11, 0.6, 2), std(0xf0e4c8), 22.5, 5.3, -5));
  // Пальмы.
  for (const x of [-20, -13, 4, 9]) {
    g.add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 4, 8), std(0x8b6a3e), x, 2, -6));
    for (let i = 0; i < 5; i++) {
      const leaf = flatten(mesh(new THREE.SphereGeometry(1, 8, 6), std(0x4f8a3c), x + Math.cos(i * 1.25) * 0.9, 4.1, -6 + Math.sin(i * 1.25) * 0.9), 0.15);
      g.add(leaf);
    }
  }
  g.add(signSprite('СИЕНА', -9, 4.2, -2, 3.2, '#7a4b12'));
  g.add(signSprite('АЛЕКСАНДРИЯ', 13, 7.2, -2, 4.4, '#7a4b12'));
  g.add(signSprite('← 5000 стадий →', 2, 3.2, -3, 4, '#7a4b12'));
  return {};
}

/** Падуя, ночь: звёзды, Луна, яркая Венера, крыша с телескопом, мастерская с армиллярной сферой. */
export function decoratePadua(g: THREE.Group, scene: THREE.Scene): Decor {
  setup(g, scene, { color: 0x0b1330, fog: [35, 120], hemi: [0x4d6bb3, 0x1a1420, 0.9], sun: { color: 0xb8c8ff, intensity: 0.8, pos: [-6, 18, 10] } });
  g.add(stars(1200, 90));
  g.add(mesh(new THREE.SphereGeometry(2.5, 24, 16), glow(0xf2f0e6, 1.2), -28, 22, -70, false));
  const venus = mesh(new THREE.SphereGeometry(0.6, 16, 12), glow(0xfff6c8, 3), 30, 16, -60, false);
  g.add(venus, mesh(new THREE.SphereGeometry(0.5, 16, 12), glow(0xffd9a8, 2), 18, 20, -60, false));
  // Дома Падуи с огнями в окнах.
  for (let x = -26; x <= 26; x += 5.5) {
    const h = 5 + ((x * 7) % 4);
    g.add(mesh(new THREE.BoxGeometry(5, h, 3), std(0x8a4a32), x, h / 2, -9));
    for (let i = 0; i < 2; i++) g.add(mesh(new THREE.PlaneGeometry(0.7, 0.9), glow(0xffc46b, 0.9), x - 1 + i * 2, h * 0.6, -7.49, false));
  }
  // Армиллярная сфера на столе мастерской.
  const arm = new THREE.Group();
  arm.position.set(-8, 1.55, -2.2);
  arm.add(mesh(new THREE.SphereGeometry(0.15, 12, 10), glow(0xffd36b, 1.5)));
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = mesh(new THREE.TorusGeometry(0.35 + i * 0.12, 0.02, 6, 32), std(0xc9a14a, { metalness: 0.8, roughness: 0.3 }));
    r.rotation.x = Math.PI / 2 + i * 0.4;
    rings.push(r);
    arm.add(r);
  }
  g.add(arm);
  // Телескоп на крыше.
  const scope = mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.6, 12), std(0x6b4a2a, { metalness: 0.4 }), 16.5, 4.6, -0.8);
  scope.rotation.z = -0.9;
  g.add(scope, mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), std(0x333333), 16.2, 4.2, -0.8));
  const lamp = new THREE.PointLight(0xffb35c, 10, 8);
  lamp.position.set(-8, 3, -1);
  g.add(lamp);
  g.add(signSprite('МАСТЕРСКАЯ', -8, 3.6, -2, 3.4, '#ffd9a0'));
  g.add(signSprite('ТЕЛЕСКОП', 16, 6.6, -2, 3, '#ffd9a0'));
  return {
    update(t) {
      rings.forEach((r, i) => (r.rotation.z = t * (0.3 + i * 0.2)));
      venus.scale.setScalar(1 + Math.sin(t * 3) * 0.1);
    },
  };
}

/** Англия, 1687: зелёные холмы, яблоня, пушка на холме, поле с мишенью. */
export function decorateWoolsthorpe(g: THREE.Group, scene: THREE.Scene): Decor {
  setup(g, scene, { color: 0x9fd3f0, fog: [40, 130], hemi: [0xe6f4ff, 0x4f7a3a, 1.2], sun: { color: 0xfffbe8, intensity: 2, pos: [10, 22, 8] } });
  for (const [x, r] of [[-30, 18], [0, 22], [32, 16]] as const) g.add(flatten(mesh(new THREE.SphereGeometry(r, 24, 16), std(0x77a95b), x, -r * 0.25, -55, false), 0.35));
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Group();
    c.position.set(-30 + i * 15, 14 + (i % 2) * 3, -40);
    for (let k = 0; k < 4; k++) c.add(flatten(mesh(new THREE.SphereGeometry(2 + (k % 2), 12, 8), std(0xffffff, { roughness: 1 }), k * 2.2, 0, 0, false), 0.55));
    clouds.push(c);
    g.add(c);
  }
  // Мишень на поле.
  const target = new THREE.Group();
  target.position.set(24, 1.4, -2);
  target.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.8, 6), std(0x6b4423), 0, -0.2, -0.1));
  [1, 0.72, 0.44, 0.18].forEach((r, i) => {
    const disc = mesh(new THREE.CylinderGeometry(r, r, 0.06 + i * 0.01, 24), std(i % 2 ? 0xffffff : 0xc0392b), 0, 0.6, i * 0.012);
    disc.rotation.x = Math.PI / 2;
    target.add(disc);
  });
  g.add(target);
  for (let x = -12; x <= 28; x += 3) g.add(mesh(new THREE.BoxGeometry(0.15, 0.9, 0.15), std(0x8b6a3e), x, 0.45, -1.95));
  g.add(signSprite('ПУШКА', -6, 4.4, -2, 2.4, '#2d4a1e'));
  g.add(signSprite('ПОЛЕ МИШЕНЕЙ', 21, 3.6, -2, 4, '#2d4a1e'));
  return {
    update(t) {
      clouds.forEach((c, i) => (c.position.x = ((-30 + i * 15 + t * 0.6 + 45) % 90) - 45));
    },
  };
}

/** Блетчли-парк: пасмурно, бараки, радиомачта у радиорубки, «бомба» с барабанами-роторами. */
export function decorateBletchley(g: THREE.Group, scene: THREE.Scene): Decor {
  setup(g, scene, { color: 0x9aa3a8, fog: [25, 90], hemi: [0xd6dde2, 0x4a5240, 1.1], sun: { color: 0xe6ecf0, intensity: 1.2, pos: [-5, 18, 10] } });
  // Особняк вдали.
  g.add(mesh(new THREE.BoxGeometry(24, 9, 6), std(0x8a5a44), 2, 4.5, -30, false));
  g.add(mesh(new THREE.ConeGeometry(4, 4, 4), std(0x4a3a34), -6, 11, -30, false));
  // Радиомачта.
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 9, 6), std(0x555555), -9, 4.5, -3.2));
  for (const y of [5, 7, 8.6]) g.add(mesh(new THREE.BoxGeometry(1.6 - y * 0.12, 0.05, 0.05), std(0x555555), -9, y, -3.2));
  const beacon = mesh(new THREE.SphereGeometry(0.12, 10, 8), glow(0xff3b3b, 2), -9, 9.1, -3.2, false);
  g.add(beacon);
  // «Бомба» Тьюринга: шкаф с рядами барабанов.
  const drums: THREE.Mesh[] = [];
  g.add(mesh(new THREE.BoxGeometry(3.4, 2.2, 0.4), std(0x2c2c2c), 12, 1.1, -1.95));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const d = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 16), std([0x2e86de, 0xc0392b, 0x27ae60][r]), 10.8 + c * 0.6, 0.55 + r * 0.6, -1.72);
      d.rotation.x = Math.PI / 2;
      drums.push(d);
      g.add(d);
    }
  }
  // Радиостол.
  g.add(mesh(new THREE.BoxGeometry(2, 0.9, 0.3), std(0x5a4632), -9, 0.45, -1.95));
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.5, 0.3), std(0x3a3a3a), -9.4, 1.15, -1.95));
  g.add(mesh(new THREE.PlaneGeometry(0.4, 0.25), glow(0x9fff9f, 1.2), -9.4, 1.2, -1.79, false));
  g.add(signSprite('РАДИОРУБКА', -9, 4.4, -2, 3.4, '#1f2a1a'));
  g.add(signSprite('«БОМБА»', 12, 4.4, -2, 2.8, '#1f2a1a'));
  return {
    update(t) {
      drums.forEach((d, i) => (d.rotation.y = t * (1 + (i % 5) * 0.3)));
      beacon.visible = Math.sin(t * 4) > 0;
    },
  };
}

/** Байконур, 1961: закат над степью, ракета у башни обслуживания, бункер управления, монтажные леса. */
export function decorateBaikonur(g: THREE.Group, scene: THREE.Scene): Decor {
  setup(g, scene, { color: 0xf0a878, fog: [35, 120], hemi: [0xffd2b0, 0x6a5a40, 1.1], sun: { color: 0xffb070, intensity: 2, pos: [-12, 10, 10] } });
  g.add(mesh(new THREE.SphereGeometry(5, 24, 16), glow(0xff8a3d, 1.8), -40, 6, -80, false));
  for (let x = -40; x <= 40; x += 12) g.add(flatten(mesh(new THREE.SphereGeometry(10, 16, 10), std(0xa8925a), x, -4, -45, false), 0.4));
  g.add(mesh(new THREE.BoxGeometry(5, 0.6, 4), std(0x7f8c8d), 22, 0.3, -2.6));
  // Перископ бункера.
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), std(0x444444), -10, 2, -2.2));
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.2, 0.2), std(0x444444), -9.85, 2.6, -2.2));
  // Огни на башне.
  const lights: THREE.Mesh[] = [];
  for (let y = 1; y < 8; y += 2) {
    const l = mesh(new THREE.SphereGeometry(0.1, 8, 6), glow(0xff3b3b, 2), 19.6, y, -1.9, false);
    lights.push(l);
    g.add(l);
  }
  // Детали ракеты в цеху.
  for (let i = 0; i < 3; i++) {
    const tank = mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.4, 16), std(0xdfe6ee, { metalness: 0.5 }), 11 + i * 1.3, 0.7, -2.3);
    tank.rotation.z = Math.PI / 2;
    g.add(tank);
  }
  g.add(signSprite('БУНКЕР', -10, 3.4, -2, 2.6, '#3a1e0a'));
  g.add(signSprite('МОНТАЖНЫЙ ЦЕХ', 12, 4.2, -2, 4.2, '#3a1e0a'));
  g.add(signSprite('ВОСТОК', 22, 11.6, -2.4, 2.6, '#3a1e0a'));
  return {
    update(t) {
      lights.forEach((l, i) => (l.visible = Math.sin(t * 3 + i) > -0.2));
    },
  };
}
