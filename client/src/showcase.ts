/**
 * Витрина стиля (только dev: http://localhost:5173/showcase.html). В prod-сборку не входит.
 * - ?view=props — интерактивные объекты (ящик, верёвка, батут, вентилятор, стрелы, ров) через настоящий platformMesh;
 * - ?view=skins — все скины и рассказчики эпох;
 * - ?view=level&level=<id> — любой уровень без сервера; ←/→ двигают камеру.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getLevel, SKINS, type Level } from '@chronolet/shared';
import { buildWorld } from './game/worlds/index.ts';
import { Character } from './game/Character.ts';
import { signSprite } from './game/worlds/decor.ts';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'props';
const container = document.getElementById('c')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
container.append(renderer.domElement);
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 400);

const hub = getLevel('hub');
const worlds: { update(t: number, dt: number): void }[] = [];
const chars: Character[] = [];
let camX = 0;
let camY = 3.2;
let camZ = 15;

if (view === 'props') {
  // Палуба корабля с объектами: те же данные, что пойдут в уровни (kind в Platform).
  const level: Level = {
    ...hub,
    id: 'showcase',
    stations: [],
    coins: [],
    platforms: [
      { x: -4.5, y: -0.5, w: 21, h: 1, color: 0x4a5a9a, kind: 'floor' },
      { x: 12, y: -0.5, w: 6, h: 1, color: 0x4a5a9a, kind: 'floor' },
      { x: -13, y: 0.5, w: 1, h: 1, z: 0.3, d: 1, color: 0xb5763d, kind: 'crate' },
      { x: -9, y: 2.4, w: 0.4, h: 2.4, z: 0, d: 0.4, color: 0x8a5532, kind: 'rope', decor: true },
      { x: -5, y: 0.5, w: 1.8, h: 1, z: 0.6, d: 1.8, color: 0xff4fa3, kind: 'trampoline' },
      { x: -1, y: 0.25, w: 1.6, h: 0.5, z: 0.6, d: 1.6, color: 0x5a6070, kind: 'fan' },
      { x: 5, y: 0.7, w: 0.9, h: 1.4, z: 0, d: 1, color: 0x9a8a72, kind: 'arrows' },
      { x: 7.5, y: -0.7, w: 3, h: 0.2, color: 0x2fb8d0, kind: 'moat', decor: true },
    ],
  };
  worlds.push(buildWorld(scene, level));
  for (const [t, x] of [['Ящик · толкать', -13], ['Верёвка · лазать', -9], ['Батут · прыжок', -5], ['Вентилятор · поток', -1], ['Стрелы · опасно', 3.4], ['Ров · опасно', 7.5]] as const) {
    scene.add(signSprite(t, x, -1.5, 2.4, 1.6, '#4a5590'));
  }
  camX = -2.5;
  camY = 2.8;
  camZ = 17;
} else if (view === 'skins') {
  worlds.push(buildWorld(scene, { ...hub, stations: [], coins: [] }));
  const looks = [...SKINS.map((s) => ({ name: s.name, skin: s.id }))];
  looks.forEach((l, i) => {
    const c = new Character(l.name, 0x4fd1ff, { skin: l.skin });
    c.root.position.set(-8.45 + i * 1.3, 0, 0.8);
    scene.add(c.root);
    chars.push(c);
  });
  const npcs: [string, { robe: number; hat?: number }][] = [['Эратосфен', { robe: 0xece4d0 }], ['Галилей', { robe: 0x7a2a2a, hat: 0x1c1c1c }], ['Ньютон', { robe: 0x3a3a6a }], ['Тьюринг', { robe: 0x6b5a45 }], ['Королёв', { robe: 0x2f3b2f, hat: 0x222222 }]];
  npcs.forEach(([name, robe], i) => {
    const c = new Character(name, 0xffe066, { npc: robe });
    c.root.position.set(3.25 + i * 1.3, 0, 0.8);
    scene.add(c.root);
    chars.push(c);
  });
  camX = 0;
  camY = 2.6;
  camZ = 15;
} else {
  const level = getLevel(q.get('level') ?? 'hub');
  const w = buildWorld(scene, level);
  w.setParts(['gnomon', 'lens']);
  worlds.push(w);
  ['default', 'spotty', 'persik'].forEach((skin, i) => {
    const c = new Character(skin, 0x4fd1ff + i * 0x3000, { skin });
    c.root.position.set(level.spawn.x + i * 1.2, level.spawn.y, 0.3);
    scene.add(c.root);
    chars.push(c);
  });
  camX = level.spawn.x + 6;
}

const world = { t: 0 };
addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft') camX -= 2;
  if (e.code === 'ArrowRight') camX += 2;
  if (e.code === 'ArrowUp') camY += 1;
  if (e.code === 'ArrowDown') camY -= 1;
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
const anims = ['idle', 'idle', 'run', 'jump', 'idle'];
(function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  world.t += dt;
  worlds.forEach((w) => w.update(world.t, dt));
  chars.forEach((c, i) => {
    const p = c.root.position;
    // В витрине скинов фигурки по очереди показывают анимации.
    const anim = view === 'skins' ? anims[(Math.floor(world.t / 1.5) + i) % anims.length] : 'idle';
    c.setPose(p.x, p.y, p.z, 1, anim, dt);
  });
  camera.position.set(camX, camY, camZ);
  camera.lookAt(camX, camY - 1.6, 0);
  renderer.render(scene, camera);
})();
