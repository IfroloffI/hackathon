import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, type Level } from './level.ts';
import { cratesAtHome, cratesSolved, stepCrates, withCrates, type CrateBody, type CratePos } from './mechanics.ts';
import { explore, posesAt, reaches } from './reachability.ts';

const ROLES = new Set(['observer', 'mechanic', 'reward']);

/**
 * Каждый уровень проходим на настоящей физике: от точки появления (ящики — на задуманных местах) можно дойти
 * до каждой станции и собрать каждую монету, а от каждой роли — вернуться к Колизиуму (или к рычагу прыжка).
 */
for (const level of Object.values(LEVELS)) {
  test(`уровень ${level.id}: станции и монеты достижимы, с ролей можно вернуться`, () => {
    const solved = withCrates(level, cratesSolved(level));
    const fromSpawn = explore(solved, [level.spawn]);
    for (const s of level.stations) assert.ok(reaches(fromSpawn, s), `${level.id}: не дойти до станции «${s.id}»`);
    const missing = level.coins.filter((c) => !fromSpawn.coins.has(c.id)).map((c) => `${c.id}(${c.x},${c.y})`);
    assert.deepEqual(missing, [], `${level.id}: недостижимые монеты`);

    const home = level.stations.find((s) => s.kind === 'return' || s.kind === 'jump')!;
    for (const s of level.stations.filter((st) => ROLES.has(st.kind))) {
      const back = explore(solved, posesAt(fromSpawn, s).slice(0, 3));
      assert.ok(reaches(back, home), `${level.id}: с «${s.id}» не вернуться к «${home.id}»`);
    }
  });
}

/** Толкаем ящик к задуманному месту, как игрок: пока не доехал или не начал падать; потом даём осесть. */
function pushToSolve(level: Level, placed: CratePos[], id: string): CrateBody {
  const def = level.crates!.find((c) => c.id === id)!;
  const dir = Math.sign(def.solve!.x - def.x);
  const bodies: CrateBody[] = placed.map((p) => ({ ...p, vy: 0, push: 0 }));
  const c = bodies.find((b) => b.id === id)!;
  for (let i = 0; i < 900; i++) {
    c.push = c.y > def.y - 0.05 && (def.solve!.x - c.x) * dir > 0.02 ? dir : 0;
    stepCrates(level, bodies, 1 / 30);
  }
  return c;
}

for (const level of Object.values(LEVELS).filter((l) => l.crates?.length)) {
  test(`уровень ${level.id}: ящики нужны, доезжают до места и к ним можно подойти`, () => {
    const atHome = explore(withCrates(level, cratesAtHome(level)), [level.spawn]);
    const roles = level.stations.filter((s) => ROLES.has(s.kind));
    assert.ok(roles.some((s) => !reaches(atHome, s)), `${level.id}: все роли достижимы без ящиков — головоломка лишняя`);

    // По порядку: предыдущие ящики уже на местах, текущий и следующие — дома.
    const crates = level.crates!;
    crates.forEach((def, i) => {
      const placed: CratePos[] = crates.map((c, k) => ({ id: c.id, ...(k < i ? c.solve! : { x: c.x, y: c.y }) }));
      const ex = explore(withCrates(level, placed), [level.spawn]);
      const dir = Math.sign(def.solve!.x - def.x);
      const side = dir > 0 ? def.x - def.s / 2 - 0.4 : def.x + def.s / 2 + 0.4;
      assert.ok(
        ex.poses.some((p) => Math.abs(p.x - side) < 0.15 && Math.abs(p.y - def.y) < 0.05),
        `${level.id}: к ящику «${def.id}» не подойти с нужной стороны (x≈${side})`,
      );
      const end = pushToSolve(level, placed, def.id);
      assert.ok(Math.abs(end.x - def.solve!.x) <= 0.8 && Math.abs(end.y - def.solve!.y) < 0.05, `${level.id}: ящик «${def.id}» встал в (${end.x.toFixed(2)}, ${end.y.toFixed(2)}), а не в (${def.solve!.x}, ${def.solve!.y})`);
    });
  });
}

test('до ролей в эпохах не дойти простой ходьбой — нужны прыжки или обход по глубине', () => {
  for (const level of Object.values(LEVELS).filter((l) => l.id !== 'hub')) {
    const walk = explore(withCrates(level, cratesAtHome(level)), [level.spawn], 60000, true);
    for (const s of level.stations.filter((st) => st.kind === 'observer' || st.kind === 'mechanic')) {
      assert.ok(!reaches(walk, s), `${level.id}: до «${s.id}» можно дойти пешком`);
    }
  }
});

test('станции ролей и награды не стоят под ветром и стрелами', () => {
  for (const level of Object.values(LEVELS)) {
    for (const s of level.stations.filter((st) => ROLES.has(st.kind))) {
      for (const f of level.fans ?? []) {
        const inside = (s.x - f.x) * f.dir >= -1 && (s.x - f.x) * f.dir <= f.len + 1 && s.y + 1.2 > f.y && s.y < f.y + f.h;
        assert.ok(!inside, `${level.id}/${s.id}: под потоком вентилятора x=${f.x}`);
      }
      for (const a of level.arrows ?? []) {
        const inside = (s.x - a.x) * a.dir >= -1 && (s.x - a.x) * a.dir <= a.range + 1 && a.y >= s.y && a.y <= s.y + 1.2;
        assert.ok(!inside, `${level.id}/${s.id}: на линии стрел x=${a.x}`);
      }
    }
  }
});

test('у вентиляторов и стрел есть окно, чтобы проскочить', () => {
  for (const level of Object.values(LEVELS)) {
    for (const f of level.fans ?? []) if (f.period) assert.ok(f.period - (f.on ?? f.period / 2) >= 1.8, `${level.id}: вентилятор x=${f.x} отдыхает меньше 1.8 с`);
    for (const a of level.arrows ?? []) assert.ok((a.period ?? 1.8) >= 1.4, `${level.id}: стрелы x=${a.x} чаще 1.4 с`);
  }
});
