import * as THREE from 'three';
import { EPOCHS } from '@chronolet/shared';
import { glow, mesh, std, stars } from './common.ts';
import { signSprite, type Decor } from './decor.ts';

/** Цвета деталей в гнёздах двигателя — по порядку эпох. */
const PART_COLORS: Record<string, number> = {
  gnomon: 0xffc94d,
  lens: 0x7fd8ff,
  pendulum: 0xd9dee5,
  rotor: 0x7dff9a,
  fuel_cell: 0xff7a1a,
};

/**
 * Борт Колизиума: отсек с хроно-двигателем, панорамными иллюминаторами в космос,
 * мостками, пультом ХРОНОСа и рычагом прыжка. Пять гнёзд двигателя загораются по мере сбора деталей.
 */
export function decorateHub(g: THREE.Group, scene: THREE.Scene): Decor {
  scene.background = new THREE.Color(0x04060d);
  scene.fog = new THREE.Fog(0x04060d, 40, 140);

  g.add(new THREE.HemisphereLight(0xa9c4ff, 0x141824, 0.9));
  const key = new THREE.DirectionalLight(0xdfe9ff, 1.1);
  key.position.set(4, 10, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -18, right: 18, top: 12, bottom: -4 });
  g.add(key);
  const engineLight = new THREE.PointLight(0x5fd0ff, 25, 12);
  engineLight.position.set(0, 3, -1);
  g.add(engineLight);
  const consoleLight = new THREE.PointLight(0xff4fa3, 8, 8);
  consoleLight.position.set(12.5, 2.5, -1);
  g.add(consoleLight);

  // Задняя стена с панорамными окнами: нижняя и верхняя панели, колонны между окнами.
  const hullMat = std(0x2a3140, { metalness: 0.7, roughness: 0.45 });
  g.add(mesh(new THREE.BoxGeometry(32, 2.4, 0.4), hullMat, 0, 1.2, -4.2));
  g.add(mesh(new THREE.BoxGeometry(32, 3.6, 0.4), hullMat, 0, 7.2, -4.2));
  for (let x = -15; x <= 15; x += 6) g.add(mesh(new THREE.BoxGeometry(1.2, 3, 0.5), hullMat, x, 3.9, -4.2));
  for (const y of [2.42, 5.38]) g.add(mesh(new THREE.BoxGeometry(32, 0.08, 0.5), glow(0x3fb9ff, 1.2), 0, y, -4.1, false));
  // Потолок со световыми полосами, трубы.
  g.add(mesh(new THREE.BoxGeometry(32, 0.4, 6), hullMat, 0, 9.2, -1.2));
  for (const z of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(28, 0.06, 0.25), glow(0xcfe8ff, 1.4), 0, 8.98, z, false));
  const pipeMat = std(0x8a6a3a, { metalness: 0.8, roughness: 0.35 });
  for (const [y, z] of [[8.4, -3.6], [8.1, -3.75], [0.35, -3.8]]) {
    const pipe = mesh(new THREE.CylinderGeometry(0.12, 0.12, 32, 10), pipeMat, 0, y, z);
    pipe.rotation.z = Math.PI / 2;
    g.add(pipe);
  }
  // Направляющие огни на полу и предупреждающая разметка у рычага.
  for (let x = -14; x <= 14; x += 2) g.add(mesh(new THREE.BoxGeometry(1, 0.02, 0.08), glow(0x3fb9ff, 1), x, 0.01, 1.85, false));
  for (let i = 0; i < 6; i++) {
    const s = mesh(new THREE.BoxGeometry(0.25, 0.02, 1.4), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x111111 : 0xffc400 }), 2.9 + i * 0.4, 0.012, 0, false);
    s.rotation.y = 0.5;
    g.add(s);
  }

  // Космос за окнами.
  g.add(stars(1400, 90, 0xffffff, 0.45));
  g.add(stars(300, 70, 0x9fd3ff, 0.7));
  const planet = mesh(new THREE.SphereGeometry(14, 40, 30), std(0x3b6fd8, { emissive: 0x0d2a5a, emissiveIntensity: 0.8, roughness: 1 }), 34, 4, -85, false);
  const ringP = mesh(new THREE.TorusGeometry(21, 1.2, 4, 80), glow(0xd9b26a, 0.5), 34, 4, -85, false);
  ringP.rotation.set(1.2, 0.2, 0.3);
  g.add(planet, ringP);

  // Хроно-двигатель: корпус, светящиеся кольца, ядро, 5 гнёзд под детали.
  const engine = new THREE.Group();
  engine.position.set(0, 0, -2.6);
  engine.add(mesh(new THREE.CylinderGeometry(1.3, 1.6, 3, 32), std(0x6c7a8c, { metalness: 0.85, roughness: 0.3 }), 0, 1.5));
  const rings: THREE.Mesh[] = [];
  for (const y of [0.6, 1.5, 2.4]) {
    const r = mesh(new THREE.TorusGeometry(1.52 - y * 0.07, 0.06, 8, 40), glow(0x3fb9ff, 1.6), 0, y, 0, false);
    r.rotation.x = Math.PI / 2;
    rings.push(r);
    engine.add(r);
  }
  const core = mesh(new THREE.IcosahedronGeometry(0.55, 1), glow(0x7fd8ff, 2.2), 0, 3.6, 0, false);
  engine.add(core);
  const sockets = EPOCHS.map((e, i) => {
    const a = -0.9 + (i / (EPOCHS.length - 1)) * 1.8;
    const m = mesh(new THREE.SphereGeometry(0.17, 16, 12), std(0x1e232c, { metalness: 0.5 }), Math.sin(a) * 1.5, 1.95, Math.cos(a) * 1.5, false);
    engine.add(m);
    return { part: e.part.id, mesh: m };
  });
  g.add(engine);

  // Рычаг прыжка на пульте (x=4).
  const lever = new THREE.Group();
  lever.position.set(4, 1, -2.2);
  const stick = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), std(0xcfd6df, { metalness: 0.8 }), 0, 0.45);
  const knob = mesh(new THREE.SphereGeometry(0.14, 12, 10), glow(0xff3b3b, 1.4), 0, 0.92);
  lever.add(stick, knob);
  lever.rotation.z = 0.4;
  g.add(lever);

  // ХРОНОС — голограмма над пультом.
  const holo = mesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: 0x5fe3ff, wireframe: true }), 12.5, 2.4, -2.2, false);
  const holoCore = mesh(new THREE.SphereGeometry(0.16, 12, 10), glow(0x5fe3ff, 2), 12.5, 2.4, -2.2, false);
  g.add(holo, holoCore);

  g.add(signSprite('КОЛИЗИУМ', 0, 6.6, -3.9, 6, '#7fd8ff'));
  g.add(signSprite('ХРОНОС', 12.5, 3.3, -2.2, 2.4, '#5fe3ff'));
  g.add(signSprite('ПРЫЖОК', 4, 2.4, -2.2, 2.2, '#ff6b6b'));

  return {
    update(t) {
      core.rotation.set(t * 0.7, t, 0);
      core.position.y = 3.6 + Math.sin(t * 2) * 0.08;
      rings.forEach((r, i) => ((r.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(t * 3 + i) * 0.6));
      engineLight.intensity = 22 + Math.sin(t * 3) * 6;
      holo.rotation.set(t * 0.5, t * 0.8, 0);
      holoCore.scale.setScalar(1 + Math.sin(t * 4) * 0.15);
    },
    setParts(parts) {
      for (const s of sockets) {
        const on = parts.includes(s.part);
        const m = s.mesh.material as THREE.MeshStandardMaterial;
        const c = on ? PART_COLORS[s.part] : 0x1e232c;
        m.color.setHex(c);
        m.emissive.setHex(on ? c : 0x000000);
        m.emissiveIntensity = on ? 1.8 : 0;
      }
      const lit = parts.length / EPOCHS.length;
      (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + lit * 2.5;
    },
  };
}
