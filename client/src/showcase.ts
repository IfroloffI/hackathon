/**
 * Витрина стиля (только dev: http://localhost:5173/showcase.html). В prod-сборку не входит.
 * - ?view=props — объекты полосы препятствий (ящик, батут, вентилятор, самострел, ров, чекпоинт, верёвка);
 * - ?view=skins — все скины и рассказчики эпох;
 * - ?view=level&level=<id>[&x=<старт>] — уровень без сервера, его можно пройти: WASD/стрелки + пробел.
 *   Ящики считаются локально той же stepCrates, что на сервере.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getLevel, SKINS, stepCrates, type CrateBody, type Level } from '@chronolet/shared';
import { buildWorld, type World } from './game/worlds/index.ts';
import { Character } from './game/Character.ts';
import { LocalController } from './game/LocalController.ts';
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
const worlds: World[] = [];
const chars: Character[] = [];
let player: { ctrl: LocalController; view: Character; crates: CrateBody[]; level: Level } | null = null;
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
    // Те же данные, что в уровнях: ящик (crates), батут (platform), поток (fans), самострел (arrows), ров, чекпоинт.
    platforms: [
      { x: -4.5, y: -0.5, w: 21, h: 1, color: 0x4a5a9a, kind: 'floor' },
      { x: 12, y: -0.5, w: 6, h: 1, color: 0x4a5a9a, kind: 'floor' },
      { x: -9, y: 2.4, w: 0.4, h: 2.4, z: 0, d: 0.4, color: 0x8a5532, kind: 'rope', decor: true },
      { x: -5, y: 0.5, w: 1.8, h: 1, z: 0, d: 1.8, color: 0xff4fa3, kind: 'trampoline' },
      { x: 7.5, y: -0.45, w: 3, h: 0.2, color: 0x2fb8d0, kind: 'moat', ghost: true, decor: true },
    ],
    crates: [{ id: 'demo', x: -13, y: 0, s: 1.2 }],
    fans: [{ x: 1.5, y: 0, dir: -1, len: 4, h: 2 }],
    arrows: [{ x: 5.4, y: 0.7, dir: -1, range: 3.4, period: 1.4 }],
    checkpoints: [{ x: 12.5, y: 0 }],
  };
  worlds.push(buildWorld(scene, level));
  worlds[0].setProgress(20);
  for (const [t, x] of [['Ящик · толкать', -13], ['Верёвка · лазать', -9], ['Батут · прыжок', -5], ['Вентилятор · поток', -0.5], ['Стрелы · опасно', 3.8], ['Ров · опасно', 7.5], ['Чекпоинт', 12.5]] as const) {
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
  const start = q.has('x') ? { x: Number(q.get('x')), y: Number(q.get('y') ?? 8), z: 0 } : level.spawn;
  const view = new Character('Вы', 0x4fd1ff, { skin: q.get('skin') ?? 'default' });
  scene.add(view.root);
  const crates = (level.crates ?? []).map((c) => ({ id: c.id, x: c.x, y: c.y, vy: 0, push: 0 }));
  player = { ctrl: new LocalController(level, start), view, crates, level };
  camX = start.x;
}

const world = { t: 0 };
addEventListener('keydown', (e) => {
  if (player) return; // в режиме уровня стрелки управляют персонажем
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
  if (player) {
    const { ctrl, view, crates, level } = player;
    // Локальная замена сервера: толкаем ящик, пока упираемся.
    for (const c of crates) c.push = ctrl.pushing?.crateId === c.id ? ctrl.pushing.dir : 0;
    stepCrates(level, crates, dt);
    ctrl.crates = crates;
    worlds[0].setCrates(crates);
    ctrl.update(dt);
    if (ctrl.takeHazard()) view.showBubble('💥', 1000);
    view.setPose(ctrl.x, ctrl.y, ctrl.z, ctrl.facing, ctrl.anim, dt);
    worlds[0].setProgress(ctrl.x);
    camX += (ctrl.x - camX) * (1 - Math.exp(-dt * 4));
    camY += (ctrl.y + 3.2 - camY) * (1 - Math.exp(-dt * 4));
  }
  worlds.forEach((w) => w.update(world.t, dt, camX));
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
