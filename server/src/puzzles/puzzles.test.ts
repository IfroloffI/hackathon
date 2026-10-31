import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  EnigmaMechanicView,
  EnigmaObserverView,
  EratMechanicView,
  EratObserverView,
  GalileoObserverView,
  NewtonObserverView,
} from '@chronolet/shared';
import { EratosthenesPuzzle } from './eratosthenes.ts';
import { CLOUD_MS, GalileoPuzzle, litFraction, phaseOf } from './galileo.ts';
import { NewtonPuzzle } from './newton.ts';
import { EnigmaPuzzle, encrypt, decrypt, cribCandidates, CRIB } from './enigma.ts';
import { KorolevPuzzle, VARIANTS, rocketConfigs, simulate } from './korolev.ts';

const keys = (v: unknown) => Object.keys(v as object);

test('Эратосфен: угол → счёты → подтверждение; роли видят разное', () => {
  for (let run = 0; run < 10; run++) {
    const p = new EratosthenesPuzzle();
    const o = p.view('observer') as EratObserverView;
    const m = p.view('mechanic') as EratMechanicView;
    assert.ok(!keys(o).includes('shadow') && !keys(m).includes('distance'), 'асимметрия данных');
    assert.equal(p.act('mechanic', 'abacus', 1), null, 'до фиксации угла счёты недоступны');

    p.act('mechanic', 'arc', m.shadow + 1);
    assert.equal(p.act('mechanic', 'lock', null)?.event, 'attempt_failed');
    p.act('mechanic', 'arc', m.shadow);
    assert.equal(p.act('mechanic', 'lock', null)?.event, 'stage_passed');

    const answer = (o.distance * 360) / m.shadow;
    assert.equal(p.act('mechanic', 'abacus', answer * 1.2)?.event, 'stage_passed', 'набрал неверно');
    assert.equal((p.view('observer') as EratObserverView).abacus, Math.round(answer * 1.2), 'Наблюдатель видит счёты');
    assert.equal(p.act('observer', 'confirm', true)?.event, 'attempt_failed', 'неверное число не принимается');
    p.act('mechanic', 'abacus', answer);
    assert.equal(p.act('observer', 'confirm', false)?.event, undefined, 'можно вернуть на пересчёт');
    p.act('mechanic', 'abacus', answer);
    assert.equal(p.act('observer', 'confirm', true)?.event, 'solved');
    assert.equal(p.stagesPassed, 4);
  }
});

test('Галилей: в геоцентрической схеме нет ни половины, ни почти полного, ни полного диска', () => {
  const geo = new Set(Array.from({ length: 360 }, (_, a) => phaseOf(litFraction('geo', a))));
  for (const ph of ['half', 'gibbous', 'full']) assert.ok(!geo.has(ph as never), `geo даёт ${ph}`);
  const helio = new Set(Array.from({ length: 360 }, (_, a) => phaseOf(litFraction('helio', a))));
  for (const ph of ['crescent', 'half', 'gibbous', 'full']) assert.ok(helio.has(ph as never), `helio не даёт ${ph}`);
});

test('Галилей: четыре ночи, облака в третью, потом спутники Юпитера', () => {
  let now = 1_000_000;
  const p = new GalileoPuzzle(() => now);
  assert.ok(!keys(p.view('mechanic')).includes('phase'));
  const angleFor = (phase: string) => Array.from({ length: 360 }, (_, a) => a).find((a) => phaseOf(litFraction('helio', a)) === phase)!;
  p.act('mechanic', 'scheme', 'helio');
  for (let night = 0; night < 4; night++) {
    const o = p.view('observer') as GalileoObserverView;
    if (night === 2) {
      assert.ok(o.clouds && o.phase === null, 'в третью ночь облака скрывают фазу');
      assert.equal(p.nextChangeAt(), now + CLOUD_MS);
      assert.equal(p.act('mechanic', 'observe', null)?.event, undefined, 'в облака наблюдать нельзя, но это не ошибка');
      now += CLOUD_MS;
    }
    const phase = (p.view('observer') as GalileoObserverView).phase!;
    p.act('mechanic', 'angle', angleFor(phase));
    assert.equal(p.act('mechanic', 'observe', null)?.event, 'stage_passed', `ночь ${night + 1}`);
  }
  const o = p.view('observer') as GalileoObserverView;
  assert.equal(o.stage, 'moons');
  assert.ok(o.moons && o.moons[0].length === 4, 'Наблюдатель видит луны');
  assert.ok(!keys(p.view('mechanic')).includes('moons'), 'Механик лун не видит');
  assert.equal(p.act('mechanic', 'moons', 3)?.event, 'attempt_failed');
  assert.equal(p.act('mechanic', 'moons', 4)?.event, 'solved');
});

test('Ньютон: ветер видит только Наблюдатель, две мишени подряд', () => {
  const p = new NewtonPuzzle(Math.random, [30, 45], [2, -1.5]);
  assert.ok(!keys(p.view('mechanic')).includes('wind') && !keys(p.view('mechanic')).includes('target'));
  /** Скорость при 45°: (v·cos45 + w)·2v·sin45/g = T → v² + √2·w·v − g·T = 0. */
  const speedFor = (T: number, w: number) => (-Math.SQRT2 * w + Math.sqrt(2 * w * w + 4 * 9.81 * T)) / 2;
  p.act('mechanic', 'angle', 45);
  p.act('mechanic', 'speed', Math.sqrt(30 * 9.81)); // без учёта ветра — промах
  assert.equal(p.act('mechanic', 'fire', null)?.event, 'attempt_failed', 'ветер сносит');
  for (const round of [0, 1]) {
    const o = p.view('observer') as NewtonObserverView;
    assert.equal(o.round, round);
    p.act('mechanic', 'speed', speedFor(o.target, o.wind));
    assert.equal(p.act('mechanic', 'fire', null)?.event, round === 0 ? 'stage_passed' : 'solved');
  }
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

test('Энигма: два перехвата с разными ключами, данные ролей разделены', () => {
  for (let run = 0; run < 10; run++) {
    const p = new EnigmaPuzzle();
    for (let n = 0; n < 2; n++) {
      const o0 = p.view('observer') as EnigmaObserverView;
      assert.equal(o0.intercept, n);
      assert.ok(cribCandidates(o0.cipher).includes(p.cribPos));
      assert.ok(!keys(p.view('mechanic')).includes('cipher'), 'Механик не видит перехват');
      const wrong = cribCandidates(o0.cipher).find((x) => x !== p.cribPos) ?? (p.cribPos + 1) % (o0.cipher.length - CRIB.length);
      assert.equal(p.act('observer', 'crib', wrong)?.event, 'attempt_failed');
      assert.equal(p.act('observer', 'crib', p.cribPos)?.event, 'stage_passed');
      const o = p.view('observer') as EnigmaObserverView;
      for (let r = 0; r < 3; r++) {
        const i = [...Array(CRIB.length).keys()].map((t) => t + o.cribPos!).find((pos) => pos % 3 === r)!;
        const want = o.cipher[i];
        for (let v = 1; v <= 25; v++) {
          p.act('mechanic', 'rotor', { index: r, value: v });
          if ((p.view('mechanic') as EnigmaMechanicView).tables[r][CRIB.charCodeAt(i - o.cribPos!) - 65] === want) break;
        }
      }
      assert.equal(p.act('mechanic', 'check', null)?.event, n === 0 ? 'stage_passed' : 'solved');
    }
  }
});

test('Королёв: каждый вариант корабля и стола решается только тремя ступенями', () => {
  assert.ok(VARIANTS.length >= 4, `вариантов: ${VARIANTS.length}`);
  for (const v of VARIANTS) {
    for (const c of rocketConfigs(2)) assert.ok(!simulate(c, v).ok, `${JSON.stringify(v)}: хватило ${c.length} ступеней`);
    const p = new KorolevPuzzle(Math.random, v);
    assert.ok(!keys(p.view('mechanic')).includes('required'), 'Механик не видит Δv');
    const fail = p.act('mechanic', 'launch', null);
    assert.equal(fail?.event, 'attempt_failed');
    assert.ok(!/\d/.test(fail?.message ?? ''), 'публичное сообщение без телеметрии');
    let found: ReturnType<typeof rocketConfigs> extends Generator<infer T> ? T : never = [];
    for (const c of rocketConfigs(3)) if (c.length === 3 && simulate(c, v).ok) { found = c; break; }
    found.forEach((s, i) => p.act('mechanic', 'stage', { index: i, tanks: s.tanks, engine: s.engine }));
    assert.equal(p.act('mechanic', 'launch', null)?.event, 'solved');
  }
});
