import * as THREE from 'three';
import { EPOCHS } from '@chronolet/shared';
import { badgeTexture, circleShape, craft, cutout, glowing, mesh, roundRectShape, soft, stitchLine, stripeTexture } from '../craft.ts';
import type { Decor } from './decor.ts';

/** Цвета деталей в гнёздах двигателя — по порядку эпох. */
const PART_COLORS: Record<string, number> = {
  gnomon: 0xffc94d,
  lens: 0x7fd8ff,
  pendulum: 0xd9dee5,
  rotor: 0x7dff9a,
  fuel_cell: 0xff7a1a,
};

const HULL = 0x3d4a7a;
const HULL_DARK = 0x2a3460;
const TRIM = 0x6c8cff;

/** Космос за иллюминаторами — одна «картина» за стеной: звёзды, планета с кольцом, оранжевая луна. */
function spaceTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const c = cv.getContext('2d')!;
  const s = 1024;
  const g = c.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#1a1f4d');
  g.addColorStop(1, '#070a1f');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(255,250,235,${0.4 + Math.random() * 0.6})`;
    c.beginPath();
    c.arc(Math.random() * s, Math.random() * s, Math.random() * 1.6 + 0.5, 0, 7);
    c.fill();
  }
  c.fillStyle = '#3b6fd8';
  c.beginPath();
  c.arc(s * 0.6, s * 0.5, 22, 0, 7);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,.18)';
  c.beginPath();
  c.arc(s * 0.595, s * 0.493, 15, 0, 7);
  c.fill();
  c.strokeStyle = '#d9b26a';
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(s * 0.6, s * 0.5, 38, 9, -0.3, 0, 7);
  c.stroke();
  c.fillStyle = '#ff9a5a';
  c.beginPath();
  c.arc(s * 0.43, s * 0.47, 8, 0, 7);
  c.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function badge(text: string, w: number, color: string, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: badgeTexture(text, color), transparent: true, roughness: 0.9 }));
  m.position.set(x, y, z);
  return m;
}

/**
 * Борт Колизиума в «рукодельном» стиле: стена-картон с круглыми иллюминаторами в рамках из фетра,
 * трубы в вязаной обмотке, двигатель-«бочка» с пятью гнёздами под детали, рычаг с помпоном,
 * ХРОНОС — мягкий шар с глазом-экраном. Гнёзда загораются по мере сбора деталей.
 */
export function decorateHub(g: THREE.Group, scene: THREE.Scene): Decor {
  scene.background = new THREE.Color(0x0a0d22);
  scene.fog = new THREE.Fog(0x0a0d22, 40, 140);
  scene.environmentIntensity = 0.3;

  g.add(new THREE.HemisphereLight(0x8fa8ff, 0x1a1f3a, 1));
  const key = new THREE.DirectionalLight(0xdfe9ff, 1.6);
  key.position.set(4, 12, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -18, right: 18, top: 12, bottom: -4 });
  g.add(key);
  const engineLight = new THREE.PointLight(0x7fd8ff, 30, 12);
  engineLight.position.set(0, 3.5, -1);
  g.add(engineLight);
  const aiLight = new THREE.PointLight(0x5fe3ff, 8, 8);
  aiLight.position.set(12.5, 3, -1);
  g.add(aiLight);

  // Космос и стена с иллюминаторами (дыры в форме стены).
  const space = new THREE.Mesh(new THREE.PlaneGeometry(70, 35), new THREE.MeshBasicMaterial({ map: spaceTexture(), fog: false }));
  space.position.set(0, 5, -12);
  g.add(space);
  const wall = roundRectShape(-18, -1, 36, 11, 0.6);
  for (let x = -12; x <= 12; x += 6) wall.holes.push(circleShape(1.7, x, 4.6));
  g.add(cutout(wall, HULL, -4.9, 0.5, 'card'));
  for (let x = -12; x <= 12; x += 6) {
    const ring = mesh(new THREE.TorusGeometry(1.75, 0.2, 16, 48), craft('felt', TRIM), x, 4.6, -4.3);
    g.add(ring);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.add(mesh(new THREE.SphereGeometry(0.09, 12, 10), craft('metal', 0xd8deea), x + Math.cos(a) * 2.15, 4.6 + Math.sin(a) * 2.15, -4.35));
    }
  }
  for (let x = -15; x <= 15; x += 6) g.add(mesh(soft(1, 10.6, 0.8, 0.3), craft('card', HULL_DARK), x, 4.3, -4.2));
  // Потолок и трубы в вязаной обмотке с хомутами.
  g.add(mesh(soft(36, 1.2, 6, 0.3), craft('card', HULL_DARK), 0, 9.8, -1.5));
  for (const [y, z, c] of [[8.7, -3.6, 0xc9a14a], [8.2, -3.4, 0xe8473b]] as const) {
    const pipe = mesh(new THREE.CylinderGeometry(0.22, 0.22, 34, 20), craft('knit', c), 0, y, z);
    pipe.rotation.z = Math.PI / 2;
    g.add(pipe);
    for (let x = -16; x <= 16; x += 4) {
      const clamp = mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.25, 20), craft('metal', 0xb8c4d8), x, y, z);
      clamp.rotation.z = Math.PI / 2;
      g.add(clamp);
    }
  }
  // Разметка палубы: светящиеся стежки вдоль переднего края.
  const lane = stitchLine(28, 0x9fd3ff, 0.9);
  lane.position.set(0, 0.03, 1.8);
  g.add(lane);
  // Корпус под палубой — чтобы снизу не просвечивал космос.
  g.add(mesh(soft(36, 6, 3.4, 0.3), craft('card', 0x1c2244), 0, -4, 0, false));

  // Хроно-двигатель: «бочка» с вязаными светящимися кольцами, ядро и 5 гнёзд.
  const engine = new THREE.Group();
  engine.position.set(0, 0, -2.6);
  const prof = [[0.001, 0], [1.5, 0], [1.6, 0.4], [1.42, 2.5], [1.05, 3], [0.001, 3]].map(([x, y]) => new THREE.Vector2(x, y));
  engine.add(mesh(new THREE.LatheGeometry(prof, 48), craft('metal', 0x8a96b8)));
  const bands: THREE.Mesh[] = [];
  for (const [y, r] of [[0.6, 1.58], [1.5, 1.53], [2.4, 1.43]] as const) {
    const b = mesh(new THREE.TorusGeometry(r, 0.1, 12, 60), glowing(0x5fd0ff, 1.2), 0, y, 0, false);
    b.rotation.x = Math.PI / 2;
    bands.push(b);
    engine.add(b);
  }
  const coreMat = glowing(0x9fe6ff, 1.8).clone();
  coreMat.userData = {}; // своя копия — освобождается вместе с уровнем
  const core = mesh(new THREE.IcosahedronGeometry(0.6, 3), coreMat, 0, 3.6, 0, false);
  engine.add(core);
  const sockets = EPOCHS.map((e, i) => {
    const a = -0.9 + (i / (EPOCHS.length - 1)) * 1.8;
    engine.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.14, 24), craft('card', 0x1e2440), Math.sin(a) * 1.5, 1.95, Math.cos(a) * 1.5).rotateX(Math.PI / 2));
    const gem = mesh(new THREE.SphereGeometry(0.19, 20, 16), new THREE.MeshStandardMaterial({ color: 0x2a3150, roughness: 0.6 }), Math.sin(a) * 1.58, 1.95, Math.cos(a) * 1.58, false);
    engine.add(gem);
    return { part: e.part.id, mesh: gem };
  });
  g.add(engine);
  g.add(badge('КОЛИЗИУМ', 6, '#2a3460', 0, 7.4, -3.6));

  // Рычаг прыжка на пульте (x=4): толстый рычаг с красным помпоном, жёлто-чёрная лента на полу.
  const stick = new THREE.Group();
  stick.add(mesh(new THREE.CapsuleGeometry(0.08, 0.8, 6, 12), craft('metal', 0xd8deea), 0, 0.45));
  stick.add(mesh(new THREE.SphereGeometry(0.2, 20, 16), craft('felt', 0xe8382f), 0, 0.95));
  stick.position.set(4, 1, -2.2);
  g.add(stick);
  g.add(mesh(new THREE.BoxGeometry(2.4, 0.03, 1.4), new THREE.MeshStandardMaterial({ map: stripeTexture('#ffd23a', '#2a2a33'), roughness: 0.9 }), 4, 0.02, -0.6, false));
  g.add(badge('ПРЫЖОК', 2.4, '#e8382f', 4, 2.9, -2.2));

  // ХРОНОС: мягкий шар-голова с экраном-глазом и ушками-антеннами, парит над пультом.
  const orb = new THREE.Group();
  orb.add(mesh(new THREE.SphereGeometry(0.55, 32, 24), craft('knit', 0xeef2ff)));
  orb.add(mesh(new THREE.CircleGeometry(0.3, 32), glowing(0x5fe3ff, 1.4), 0, 0.02, 0.55, false));
  const pupil = mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ color: 0x0a2040 }), 0.03, 0.04, 0.565, false);
  orb.add(pupil);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.09, 0.32, 12), craft('felt', 0x5fe3ff), s * 0.38, 0.46, 0);
    ear.rotation.z = -s * 0.5;
    orb.add(ear);
  }
  orb.position.set(12.5, 1.62, -2.2);
  orb.scale.setScalar(0.75);
  g.add(orb);
  g.add(badge('ХРОНОС', 2.4, '#1f8fb0', 12.5, 3.9, -2.2));

  // Магазин скинов: вешалка-витрина над терминалом VK.
  const hanger = new THREE.Group();
  hanger.add(mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 24, Math.PI), craft('metal', 0xffffff), 0, 0.3));
  hanger.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), craft('metal', 0xffffff), 0, 0.3).rotateZ(Math.PI / 2));
  hanger.add(mesh(soft(0.6, 0.5, 0.08, 0.1), craft('knit', 0xff9a1f), 0, -0.05));
  hanger.position.set(-12.5, 1.9, -2.2);
  g.add(hanger);
  g.add(badge('МАГАЗИН', 2.4, '#0077ff', -12.5, 3.2, -2.2));

  return {
    update(t) {
      core.rotation.set(t * 0.6, t, 0);
      core.position.y = 3.6 + Math.sin(t * 2) * 0.08;
      bands.forEach((b, i) => (b.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.015)));
      engineLight.intensity = 26 + Math.sin(t * 3) * 6;
      stick.rotation.z = 0.4 + Math.sin(t * 1.5) * 0.06;
      orb.position.y = 1.62 + Math.sin(t * 2) * 0.06;
      orb.rotation.y = Math.sin(t * 0.8) * 0.4;
      pupil.position.x = 0.03 + Math.sin(t * 0.7) * 0.06;
      hanger.rotation.z = Math.sin(t * 1.3) * 0.08;
    },
    setParts(parts) {
      for (const s of sockets) {
        const on = parts.includes(s.part);
        const m = s.mesh.material as THREE.MeshStandardMaterial;
        const c = on ? PART_COLORS[s.part] : 0x2a3150;
        m.color.setHex(c);
        m.emissive.setHex(on ? c : 0x000000);
        m.emissiveIntensity = on ? 1.6 : 0;
      }
      coreMat.emissiveIntensity = 0.8 + (parts.length / EPOCHS.length) * 2.2;
    },
  };
}
