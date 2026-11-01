import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_LEVEL, type Level } from './level.ts';
import { arrowHit, arrowsInFlight, canPush, crateAhead, fanOn, inMoat, stepCrates, windAt, withCrates, type CrateBody } from './mechanics.ts';
import type { Body } from './physics.ts';

const base: Level = {
  ...HUB_LEVEL,
  bounds: { minX: -30, maxX: 30, minZ: -1.5, maxZ: 1.5, minY: -5 },
  platforms: [
    { x: -10, y: -0.5, w: 20, h: 1, color: 0 }, // пол x∈[-20,0]
    { x: 6, y: -0.5, w: 8, h: 1, color: 0 }, // яма x∈[0,2], потом пол [2,10]
    { x: -14, y: 1.5, w: 1, h: 3, color: 0 }, // стенка x∈[-14.5,-13.5]
  ],
  stations: [],
  coins: [],
  checkpoints: [],
};
const body = (x: number, y = 0, z = 0): Body => ({ x, y, z, vx: 0, vy: 0, vz: 0 });

test('ящик едет, упирается в стену и падает в яму', () => {
  const level: Level = { ...base, crates: [{ id: 'a', x: -10, y: 0, s: 1.2 }] };
  const c: CrateBody = { id: 'a', x: -10, y: 0, vy: 0, push: -1 };
  for (let i = 0; i < 120; i++) stepCrates(level, [c], 1 / 30);
  assert.ok(Math.abs(c.x - (-13.5 + 0.6)) < 1e-6, `упёрся в стену: x=${c.x}`);
  c.push = 1;
  for (let i = 0; i < 300 && c.y > -0.01; i++) stepCrates(level, [c], 1 / 30);
  assert.ok(c.y < 0, 'начал падать в яму');
  c.push = 0;
  for (let i = 0; i < 120; i++) stepCrates(level, [c], 1 / 30);
  assert.deepEqual([c.x, c.y], [-10, 0], 'упал в бездну — вернулся домой');
});

test('ящик въезжает на другой ящик, лежащий вровень с полом', () => {
  const level: Level = { ...base, crates: [{ id: 'a', x: 0.6, y: -1.2, s: 1.2 }, { id: 'b', x: -3, y: 0, s: 1.2 }], platforms: [...base.platforms, { x: 1, y: -1.7, w: 2, h: 1, color: 0 }] };
  const a: CrateBody = { id: 'a', x: 0.6, y: -1.2, vy: 0, push: 0 };
  const b: CrateBody = { id: 'b', x: -3, y: 0, vy: 0, push: 1 };
  for (let i = 0; i < 60; i++) stepCrates(level, [a, b], 1 / 30);
  assert.ok(b.x > 0 && b.y === 0, `едет по первому: (${b.x}, ${b.y})`);
});

test('толкать можно только вплотную и сбоку', () => {
  const def = { id: 'a', x: 0, y: 0, s: 1.2 };
  const level: Level = { ...base, crates: [def] };
  const pos = [{ id: 'a', x: 0, y: 0 }];
  assert.equal(crateAhead(body(-1), 1, level, pos), 'a');
  assert.equal(crateAhead(body(-1), -1, level, pos), null);
  assert.equal(crateAhead(body(-1, 1.2), 1, level, pos), null, 'стоя на ящике — не толкаешь');
  assert.ok(canPush({ x: -1.2, y: 0 }, 1, def, pos[0]));
  assert.ok(!canPush({ x: -3, y: 0 }, 1, def, pos[0]));
});

test('вентилятор дует по таймеру, укрытие гасит поток', () => {
  const fan = { x: 0, y: 0, dir: -1 as const, len: 10, h: 2, period: 4, on: 2 };
  const level: Level = { ...base, fans: [fan] };
  assert.ok(fanOn(fan, 0.5) && !fanOn(fan, 2.5));
  assert.ok(windAt(level, body(-5), 0.5) < -5, 'дует навстречу');
  assert.equal(windAt(level, body(-5), 2.5), 0, 'пауза');
  assert.equal(windAt(level, body(-12), 0.5), 0, 'дальше длины потока');
  assert.equal(windAt(level, body(-5, 2.5), 0.5), 0, 'выше потока');
  const sheltered = withCrates({ ...level, crates: [{ id: 'a', x: -3, y: 0, s: 1.2 }] }, [{ id: 'a', x: -3, y: 0 }]);
  assert.equal(windAt(sheltered, body(-5), 0.5), 0, 'за ящиком тихо');
});

test('стрелы летят залпами, попадают и гаснут о ящик', () => {
  const trap = { x: 0, y: 0.6, dir: -1 as const, range: 12, period: 2 };
  const level: Level = { ...base, arrows: [trap] };
  const [x] = arrowsInFlight(level, trap, 0.5);
  assert.ok(Math.abs(x - (-4 - 0.45)) < 1e-9, `стрела на ${x}`);
  assert.ok(arrowHit(level, body(-4.4), 0.5));
  assert.ok(!arrowHit(level, body(-4.4, 1), 0.5), 'перепрыгнул');
  assert.ok(!arrowHit(level, body(-8), 0.5));
  const shielded = withCrates({ ...level, crates: [{ id: 'a', x: -2, y: 0, s: 1.2 }] }, [{ id: 'a', x: -2, y: 0 }]);
  assert.deepEqual(arrowsInFlight(shielded, trap, 0.5), [], 'ящик — щит');
});

test('ров: окунулся ниже поверхности — как падение', () => {
  const level: Level = { ...base, platforms: [{ x: 1, y: -0.45, w: 2, h: 0.2, color: 0, kind: 'moat', ghost: true }] };
  assert.ok(!inMoat(level, body(1, 0)));
  assert.ok(inMoat(level, body(1, -0.6)));
  assert.ok(!inMoat(level, body(4, -0.6)));
});
