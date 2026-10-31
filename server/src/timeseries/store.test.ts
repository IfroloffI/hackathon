import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeSeriesStore } from './store.ts';
import type { GameEvent } from '@chronolet/shared';

const ev = (s: TimeSeriesStore, ts: number, type: GameEvent['type'], player = 'p1'): GameEvent => ({
  seq: s.nextSeq(), ts, session: 'ABCD', type, level: 'padua', scenario: 'scn_padua', step: 'stage1',
  player: { id: player, name: player }, data: { k: 1 },
});

test('DuckDB: события и телеметрия пишутся пакетами и агрегируются по окнам', async () => {
  const s = new TimeSeriesStore();
  await s.open(':memory:');
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < 30; i++) s.appendEvent(ev(s, t0 + i * 1000, i % 3 === 0 ? 'puzzle.failed' : 'coin.pickup'));
  s.appendEvent(ev(s, t0 + 5000, 'hint'));
  for (let i = 0; i < 50; i++) s.appendTelemetry({ ts: t0 + i * 200, session: 'ABCD', playerId: 'p1', level: 'padua', x: i * 0.5, y: 0, z: 0, anim: 'run' });
  await s.flush();

  assert.deepEqual(await s.counts(), { events: 31, telemetry: 50 });

  const struggle = await s.series('ABCD', 'struggle', 10_000, t0, t0 + 60_000);
  assert.equal(struggle.length, 3, '3 окна по 10 с');
  assert.equal(struggle.reduce((a, p) => a + p.values.fails, 0), 10);
  assert.equal(struggle[0].values.hints, 1);

  const activity = await s.series('ABCD', 'activity', 5_000, t0, t0 + 60_000);
  const dist = activity.reduce((a, p) => a + p.values.distance, 0);
  assert.ok(Math.abs(dist - 24.5) < 1e-6, `дистанция ${dist}`);

  const pos = await s.series('ABCD', 'positions', 60_000, t0, t0 + 60_000);
  assert.equal(pos[0].values.x, 24.5, 'последняя позиция в окне');

  // Реплей: из памяти и из БД одинаково.
  const tail = await s.eventsSince('ABCD', 25, null, 100);
  assert.deepEqual(tail.map((e) => e.seq), [26, 27, 28, 29, 30, 31]);
  const onlyHints = await s.eventsSince(null, 0, ['hint'], 10);
  assert.equal(onlyHints.length, 1);
  await s.close();
});
