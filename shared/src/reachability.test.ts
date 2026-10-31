import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from './level.ts';
import { explore, posesAt, reaches } from './reachability.ts';

/**
 * Каждый уровень проходим на настоящей физике: от точки появления можно дойти до каждой станции
 * и собрать каждую монету, а от каждой роли — вернуться к Колизиуму (или к станции прыжка).
 */
for (const level of Object.values(LEVELS)) {
  test(`уровень ${level.id}: станции и монеты достижимы, с ролей можно вернуться`, () => {
    const fromSpawn = explore(level, [level.spawn]);
    for (const s of level.stations) assert.ok(reaches(fromSpawn, s), `${level.id}: не дойти до станции «${s.id}»`);
    const missing = level.coins.filter((c) => !fromSpawn.coins.has(c.id)).map((c) => `${c.id}(${c.x},${c.y})`);
    assert.deepEqual(missing, [], `${level.id}: недостижимые монеты`);

    const home = level.stations.find((s) => s.kind === 'return' || s.kind === 'jump')!;
    for (const s of level.stations.filter((st) => st.kind === 'observer' || st.kind === 'mechanic')) {
      const back = explore(level, posesAt(fromSpawn, s).slice(0, 3));
      assert.ok(reaches(back, home), `${level.id}: с «${s.id}» не вернуться к «${home.id}»`);
    }
  });
}

test('до ролей в эпохах не дойти простой ходьбой — нужны прыжки или обход по глубине', () => {
  for (const level of Object.values(LEVELS).filter((l) => l.id !== 'hub')) {
    const walk = explore(level, [level.spawn], 60000, true);
    for (const s of level.stations.filter((st) => st.kind === 'observer' || st.kind === 'mechanic')) {
      assert.ok(!reaches(walk, s), `${level.id}: до «${s.id}» можно дойти пешком`);
    }
  }
});
