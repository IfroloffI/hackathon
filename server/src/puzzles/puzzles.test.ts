import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  EnigmaMechanicView,
  EnigmaObserverView,
  NewtonObserverView,
  RocketStage,
} from '@chronolet/shared';
import { EratosthenesPuzzle } from './eratosthenes.ts';
import { GalileoPuzzle, litFraction, phaseOf } from './galileo.ts';
import { NewtonPuzzle } from './newton.ts';
import { EnigmaPuzzle, encrypt, decrypt, cribCandidates, CRIB } from './enigma.ts';
import { KorolevPuzzle, ROCKET, rocketMass, simulate } from './korolev.ts';

const keys = (v: unknown) => Object.keys(v as object);

test('Эратосфен: угол → окружность, роли видят разное', () => {
  const p = new EratosthenesPuzzle();
  assert.ok(!keys(p.view('observer')).includes('shadow'), 'Наблюдатель не видит угол тени');
  assert.ok(!keys(p.view('mechanic')).includes('distance'), 'Механик не видит расстояние');
  assert.equal(p.act('observer', 'answer', 250000), null, 'ответ до фиксации угла игнорируется');

  p.act('mechanic', 'arc', 9);
  assert.equal(p.act('mechanic', 'lock', null)?.event, 'attempt_failed');
  p.act('mechanic', 'arc', 7.1);
  assert.equal(p.act('mechanic', 'lock', null)?.event, 'stage_passed');
  assert.equal(p.act('mechanic', 'answer', 250000), null, 'Механик не вводит ответ');
  assert.equal(p.act('observer', 'answer', 200000)?.event, 'attempt_failed');
  assert.equal(p.act('observer', 'answer', 252000)?.event, 'solved');
  assert.equal(p.attempts, 2);
});

test('Галилей: в геоцентрической схеме нет ни половины, ни полного диска', () => {
  const geo = new Set(Array.from({ length: 360 }, (_, a) => phaseOf(litFraction('geo', a))));
  assert.ok(!geo.has('half') && !geo.has('full'), `geo даёт: ${[...geo]}`);
  const helio = new Set(Array.from({ length: 360 }, (_, a) => phaseOf(litFraction('helio', a))));
  for (const ph of ['crescent', 'half', 'full'] as const) assert.ok(helio.has(ph), `helio не даёт ${ph}`);
});

test('Галилей: решается только в гелиоцентрической схеме', () => {
  const p = new GalileoPuzzle();
  assert.ok(!keys(p.view('observer')).includes('scheme'));
  assert.ok(!keys(p.view('mechanic')).includes('phase'));
  const findAngle = (scheme: 'geo' | 'helio', phase: string) =>
    Array.from({ length: 360 }, (_, a) => a).find((a) => phaseOf(litFraction(scheme, a)) === phase);

  p.act('mechanic', 'angle', findAngle('geo', 'crescent'));
  assert.equal(p.act('mechanic', 'observe', null)?.event, 'stage_passed', 'серп возможен и в geo');
  p.act('mechanic', 'angle', 90);
  const miss = p.act('mechanic', 'observe', null);
  assert.equal(miss?.event, 'attempt_failed', 'половина в geo невозможна');
  assert.ok(!/серп|диск|половин/.test(miss?.message ?? ''), 'публичное сообщение не раскрывает фазу модели');
  p.act('mechanic', 'scheme', 'helio');
  p.act('mechanic', 'angle', findAngle('helio', 'half'));
  assert.equal(p.act('mechanic', 'observe', null)?.event, 'stage_passed');
  p.act('mechanic', 'angle', 180);
  assert.equal(p.act('mechanic', 'observe', null)?.event, 'solved');
  assert.equal(p.act('observer', 'scheme', 'geo'), null, 'Наблюдатель модель не трогает');
});

test('Ньютон: Механик не видит полёта, Наблюдатель видит; попадание решает', () => {
  const p = new NewtonPuzzle(40);
  assert.ok(!keys(p.view('mechanic')).includes('shots') && !keys(p.view('mechanic')).includes('target'));
  p.act('mechanic', 'angle', 45);
  p.act('mechanic', 'speed', 15);
  assert.equal(p.act('mechanic', 'fire', null)?.event, 'attempt_failed');
  assert.equal((p.view('observer') as NewtonObserverView).shots.length, 1);
  const v = Math.sqrt(40 * 9.81); // дальность при 45° = v²/g
  p.act('mechanic', 'speed', v);
  assert.equal(p.act('mechanic', 'fire', null)?.event, 'solved');
});

test('Энигма: буква никогда не шифруется в себя, расшифровка обратна', () => {
  for (let k = 0; k < 200; k++) {
    const key = [1 + (k % 25), 1 + ((k * 7) % 25), 1 + ((k * 13) % 25)];
    const plain = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + CRIB;
    const c = encrypt(plain, key);
    for (let i = 0; i < plain.length; i++) assert.notEqual(c[i], plain[i]);
    assert.equal(decrypt(c, key), plain);
  }
});

test('Энигма: решение по crib, данные ролей разделены', () => {
  for (let run = 0; run < 20; run++) {
    const p = new EnigmaPuzzle();
    assert.ok(cribCandidates(p.cipher).includes(p.cribPos), 'настоящая позиция не отброшена правилом');
    const obs = p.view('observer') as EnigmaObserverView;
    assert.ok(!keys(p.view('mechanic')).includes('cipher'), 'Механик не видит перехват');
    assert.equal(obs.cribPos, null);

    const wrong = (p.cribPos + 1) % (p.cipher.length - CRIB.length);
    assert.equal(p.act('observer', 'crib', wrong)?.event, 'attempt_failed');
    assert.equal(p.act('observer', 'crib', p.cribPos)?.event, 'stage_passed');

    // Наблюдатель диктует пары, Механик подбирает роторы по своим таблицам.
    const o = p.view('observer') as EnigmaObserverView;
    for (let r = 0; r < 3; r++) {
      const i = [...Array(CRIB.length).keys()].map((t) => t + o.cribPos!).find((pos) => pos % 3 === r)!;
      const plain = CRIB[i - o.cribPos!];
      const want = o.cipher[i];
      for (let v = 1; v <= 25; v++) {
        p.act('mechanic', 'rotor', { index: r, value: v });
        const table = (p.view('mechanic') as EnigmaMechanicView).tables[r];
        if (table[plain.charCodeAt(0) - 65] === want) break;
      }
    }
    assert.equal(p.act('mechanic', 'check', null)?.event, 'solved');
  }
});

function* configs(maxStages: number): Generator<RocketStage[]> {
  const opts: RocketStage[] = [];
  for (let t = 1; t <= ROCKET.maxTanks; t++) for (const e of ['A', 'B'] as const) opts.push({ tanks: t, engine: e });
  if (maxStages >= 1) for (const a of opts) yield [a];
  if (maxStages >= 2) for (const a of opts) for (const b of opts) yield [a, b];
  if (maxStages >= 3) for (const a of opts) for (const b of opts) for (const c of opts) yield [a, b, c];
}

test('Королёв: ни одна 1–2-ступенчатая ракета не выходит на орбиту, 3-ступенчатая — может', () => {
  for (const c of configs(2)) {
    const r = simulate(c);
    assert.ok(!r.ok, `неожиданно хватило ${c.length} ступеней: ${JSON.stringify(c)} → ${r.total}`);
  }
  let found = 0;
  for (const c of configs(3)) if (simulate(c).ok) found++;
  assert.ok(found > 0, 'нет решения из 3 ступеней');
});

test('Королёв: подсказка 3-го уровня даёт рабочую ракету; Механик не видит Δv', () => {
  const p = new KorolevPuzzle();
  assert.ok(!keys(p.view('mechanic')).includes('required'));
  const fail = p.act('mechanic', 'launch', null);
  assert.equal(fail?.event, 'attempt_failed', 'стартовая конфигурация не летит');
  assert.ok(!/\d/.test(fail?.message ?? ''), 'публичное сообщение без телеметрии');
  p.act('mechanic', 'stage', { index: 0, tanks: 6, engine: 'B' });
  p.act('mechanic', 'stage', { index: 1, tanks: 3, engine: 'B' });
  p.act('mechanic', 'stage', { index: 2, tanks: 1, engine: 'A' });
  assert.ok(rocketMass([{ tanks: 6, engine: 'B' }, { tanks: 3, engine: 'B' }, { tanks: 1, engine: 'A' }]) <= ROCKET.massLimit);
  assert.equal(p.act('mechanic', 'launch', null)?.event, 'solved');
});
