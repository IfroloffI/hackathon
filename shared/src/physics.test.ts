import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_LEVEL, LEVELS, type Level } from './level.ts';
import { PHYSICS } from './constants.ts';
import { moveAndCollide, resolvePenetration, type Body } from './physics.ts';

const level: Level = {
  ...HUB_LEVEL,
  bounds: { minX: -30, maxX: 30, minZ: -1.5, maxZ: 1.5, minY: -5 },
  platforms: [
    { x: 0, y: -0.5, w: 40, h: 1, color: 0 }, // пол, верх y=0
    { x: 5, y: 1, w: 2, h: 2, color: 0 }, // ящик x∈[4,6], y∈[0,2]
    { x: -5, y: 2.2, w: 4, h: 0.4, color: 0 }, // тонкая платформа y∈[2,2.4]
    { x: 15, y: 1.5, w: 2, h: 3, z: -2.5, d: 2, color: 0 }, // объект в глубине x∈[14,16], z∈[-3.5,-1.5]
  ],
};

const body = (x: number, y: number, vx = 0, vy = 0, z = 0): Body => ({ x, y, z, vx, vy, vz: 0 });

/** Симуляция как в клиенте: гравитация + moveAndCollide. */
function run(body: Body, frames: number, input: (b: Body) => void = () => {}, dt = 1 / 60) {
  let grounded = false;
  for (let i = 0; i < frames; i++) {
    input(body);
    body.vy = Math.max(body.vy - PHYSICS.gravity * dt, -20);
    grounded = moveAndCollide(body, dt, level).grounded;
  }
  return grounded;
}

test('по полу можно ходить, пол держит', () => {
  const b = body(-2, 0, 0, 0);
  const grounded = run(b, 30, (b) => (b.vx = PHYSICS.runSpeed));
  assert.equal(b.y, 0);
  assert.ok(grounded);
  assert.ok(b.x > 0, `ушёл вправо: ${b.x}`);
});

test('ящик — стена: бег вправо останавливается у левой грани', () => {
  const b = body(0, 0, 0, 0);
  run(b, 120, (b) => (b.vx = PHYSICS.runSpeed));
  assert.equal(b.x, 4 - 0.4);
});

test('ящик — стена и слева', () => {
  const b = body(10, 0, 0, 0);
  run(b, 120, (b) => (b.vx = -PHYSICS.runSpeed));
  assert.equal(b.x, 6 + 0.4);
});

test('на ящик можно запрыгнуть и стоять на нём', () => {
  const b = body(3, 0, 0, PHYSICS.jumpSpeed);
  const grounded = run(b, 90, (b) => (b.vx = b.y > 1.5 ? PHYSICS.runSpeed * 0.3 : 0));
  assert.equal(b.y, 2);
  assert.ok(grounded);
});

test('снизу сквозь тонкую платформу не пройти — удар головой', () => {
  const b = body(-5, 0, 0, PHYSICS.jumpSpeed);
  let maxHead = 0;
  run(b, 60, (b) => (maxHead = Math.max(maxHead, b.y + 1.2)));
  assert.ok(maxHead <= 2 + 1e-9, `голова выше низа платформы: ${maxHead}`);
  assert.equal(b.y, 0);
});

test('быстрое падение не проскакивает тонкую платформу (большой dt)', () => {
  const b = body(-5, 8, 0, -20);
  const grounded = run(b, 10, () => {}, 0.05);
  assert.ok(Math.abs(b.y - 2.4) < 1e-9, `y=${b.y}`);
  assert.ok(grounded);
});

test('объект в глубине не мешает тем, кто проходит перед ним', () => {
  const b = body(12, 0);
  run(b, 60, (b) => (b.vx = PHYSICS.runSpeed));
  assert.ok(b.x > 16.4, `прошёл мимо: x=${b.x}`);
});

test('на той же глубине объект — стена по X', () => {
  const b = body(12, 0, 0, 0, -1.4); // задняя грань тела -1.8 < передней грани объекта -1.5
  run(b, 60, (b) => (b.vx = PHYSICS.runSpeed));
  assert.equal(b.x, 14 - 0.4);
});

test('уходя в глубину перед объектом, упираешься в его переднюю грань', () => {
  const b = body(15, 0);
  run(b, 60, (b) => (b.vz = -PHYSICS.depthSpeed));
  assert.equal(b.z, -1.5 + 0.4);
});

test('на всех уровнях ступеньки по высоте не выше прыжка, а с батутом — не выше подброса (декорации не в счёт)', () => {
  const jumpHeight = PHYSICS.jumpSpeed ** 2 / (2 * PHYSICS.gravity);
  const bounceHeight = PHYSICS.bounceSpeed ** 2 / (2 * PHYSICS.gravity);
  for (const lvl of Object.values(LEVELS)) {
    const reach = lvl.platforms.some((p) => p.kind === 'trampoline') ? bounceHeight : jumpHeight;
    const tops = [0, ...lvl.platforms.filter((p) => !p.decor).map((p) => p.y + p.h / 2)].sort((a, b) => a - b);
    for (let i = 1; i < tops.length; i++) {
      assert.ok(tops[i] - tops[i - 1] < reach - 0.2, `${lvl.id}: ступень ${tops[i - 1]} → ${tops[i]} выше ${reach}`);
    }
  }
});

test('батут подбрасывает выше прыжка, а приземление на него не считается опорой', () => {
  const lvl: Level = { ...level, platforms: [...level.platforms, { x: 0, y: 0.5, w: 1.8, h: 1, color: 0, kind: 'trampoline' }] };
  const b = body(0, 3, 0, 0);
  let maxY = 0;
  let grounded = false;
  for (let i = 0; i < 200; i++) {
    b.vy = Math.max(b.vy - PHYSICS.gravity / 60, -20);
    grounded = moveAndCollide(b, 1 / 60, lvl).grounded || grounded;
    if (i > 40) maxY = Math.max(maxY, b.y);
  }
  assert.ok(maxY > 1 + 4.5, `подброс до ${maxY}`);
  assert.ok(!grounded, 'на батуте не стоят');
});

test('вода рва не твёрдая: сквозь неё проваливаешься', () => {
  const lvl: Level = { ...level, platforms: [{ x: 0, y: -0.45, w: 4, h: 0.2, color: 0, kind: 'moat', ghost: true }] };
  const b = body(0, 0, 0, 0);
  for (let i = 0; i < 30; i++) {
    b.vy = Math.max(b.vy - PHYSICS.gravity / 60, -20);
    moveAndCollide(b, 1 / 60, lvl);
  }
  assert.ok(b.y < -1, `y=${b.y}`);
});

test('станции стоят на полу или на достижимой платформе', () => {
  for (const lvl of Object.values(LEVELS)) {
    for (const s of lvl.stations) {
      const support = s.y === 0 || lvl.platforms.some((p) => !p.decor && Math.abs(p.y + p.h / 2 - s.y) < 1e-6 && Math.abs(p.x - s.x) <= p.w / 2);
      assert.ok(support, `${lvl.id}/${s.id}: под станцией на y=${s.y} нет опоры`);
    }
  }
});

test('застрявшего внутри ящика выталкивает наверх', () => {
  const b = body(5, 0.5, 0, 0);
  resolvePenetration(b, level);
  assert.equal(b.y, 2);
});
