import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '@chronolet/shared';
import { ScenarioRuntime, type ScenarioFacts } from './scenario.ts';

const facts = (f: Partial<ScenarioFacts> = {}): ScenarioFacts => ({ rolesFilled: false, stagesPassed: 0, solved: false, aboard: false, ...f });

test('сценарий: брифинг → роли → этапы → эвакуация, роли закрыты до брифинга', () => {
  let now = 0;
  const r = new ScenarioRuntime('padua', () => now);
  assert.equal(r.step?.id, 'briefing');
  assert.equal(r.rolesOpen, false);
  assert.deepEqual(r.update(facts({ rolesFilled: true })), [], 'роли без брифинга шаг не двигают');

  now = 30_000;
  const c1 = r.talkedTo('galileo', facts());
  assert.equal(c1.length, 1);
  assert.ok(c1[0].underPar, '30 с при контроле 45 с — бонус');
  assert.equal(r.step?.id, 'reach');
  assert.equal(r.rolesOpen, true);

  now = 300_000;
  const c2 = r.update(facts({ rolesFilled: true }));
  assert.equal(c2[0].underPar, false, '270 с при контроле 120 с — без бонуса');
  assert.equal(r.step?.id, 'stage1');

  r.update(facts({ rolesFilled: true, stagesPassed: 2 }));
  assert.equal(r.step?.id, 'stage3', 'пройдено два этапа сразу — два шага');
  r.update(facts({ rolesFilled: true, stagesPassed: 4, solved: true }));
  assert.equal(r.step?.id, 'extract', 'решено — сразу к эвакуации');
  r.update(facts({ solved: true, aboard: true }));
  assert.equal(r.step, null, 'сценарий завершён');
});

test('сценарий: бонусы эпохи', () => {
  const r = new ScenarioRuntime('baikonur');
  assert.deepEqual(r.bonuses({ allCoins: true, attempts: 0 }).map((b) => b.kind).sort(), ['allCoins', 'fewAttempts', 'noFalls', 'noHints']);
  r.falls = 1;
  r.hints = 2;
  assert.deepEqual(r.bonuses({ allCoins: false, attempts: 5 }), []);
});

test('сценарии: число этапов совпадает с этапами головоломок', () => {
  const stages: Record<string, number> = { alexandria: 3, padua: 5, woolsthorpe: 2, bletchley: 4, baikonur: 1 };
  for (const s of SCENARIOS) {
    const puzzleSteps = s.steps.filter((st) => st.id.startsWith('stage')).length;
    assert.equal(puzzleSteps, stages[s.levelId], s.levelId);
  }
  assert.equal(new ScenarioRuntime('hub').def, null, 'на корабле сценария нет');
});
