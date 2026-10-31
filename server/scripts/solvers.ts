/**
 * Решатели головоломок для ботов в смоук-сценариях. Каждый бот видит только вид своей роли;
 * «разговор» — передача увиденного между ботами, как игроки делали бы голосом.
 */
import type {
  EnigmaObserverView,
  EratMechanicView,
  EratObserverView,
  GalileoObserverView,
  KorolevMechanicView,
  NewtonObserverView,
  PuzzleId,
} from '@chronolet/shared';
import { litFraction, phaseOf } from '../src/puzzles/galileo.ts';
import { cribCandidates } from '../src/puzzles/enigma.ts';
import { rocketConfigs, simulate } from '../src/puzzles/korolev.ts';

export interface RoleBot {
  views: Map<string, unknown>;
  act(action: string, value?: unknown): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 12000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`FAIL: не дождались: ${what}`);
    await sleep(30);
  }
}

export async function solve(id: PuzzleId, obs: RoleBot, mech: RoleBot, isSolved: () => boolean) {
  const ov = <T>() => obs.views.get('observer') as T;
  const mv = <T>() => mech.views.get('mechanic') as T;
  switch (id) {
    case 'eratosthenes': {
      const shadow = mv<EratMechanicView>().shadow; // Механик видит тень…
      mech.act('arc', shadow);
      mech.act('lock');
      await until(() => ov<EratObserverView>().angleLocked, 'угол зафиксирован');
      const answer = (ov<EratObserverView>().distance * 360) / shadow; // …Наблюдатель знает расстояние и считает
      mech.act('abacus', answer); // диктует — Механик набирает
      await until(() => ov<EratObserverView>().stage === 'confirm', 'счёты набраны');
      obs.act('confirm', true);
      break;
    }
    case 'galileo': {
      mech.act('scheme', 'helio');
      for (let night = 0; night < 4; night++) {
        await until(() => ov<GalileoObserverView>().night === night && ov<GalileoObserverView>().phase !== null, `ночь ${night + 1} (ждём облака)`);
        const phase = ov<GalileoObserverView>().phase; // «вижу половину диска»
        mech.act('angle', [...Array(360).keys()].find((x) => phaseOf(litFraction('helio', x)) === phase)!);
        mech.act('observe');
        await until(() => ov<GalileoObserverView>().night > night || ov<GalileoObserverView>().stage !== 'nights', `ночь ${night + 1} засчитана`);
      }
      await until(() => !!ov<GalileoObserverView>().moons, 'луны Юпитера');
      mech.act('moons', ov<GalileoObserverView>().moons![0].length);
      break;
    }
    case 'newton': {
      mech.act('angle', 45);
      for (let round = 0; round < 2; round++) {
        await until(() => ov<NewtonObserverView>().round === round, `мишень ${round + 1}`);
        const { target, wind } = ov<NewtonObserverView>();
        // (v·cos45 + w)·2v·sin45/g = T → v² + √2·w·v − g·T = 0
        mech.act('speed', (-Math.SQRT2 * wind + Math.sqrt(2 * wind * wind + 4 * 9.81 * target)) / 2);
        mech.act('fire');
        await until(() => isSolved() || ov<NewtonObserverView>().round > round, `попадание ${round + 1}`);
      }
      break;
    }
    case 'enigma': {
      for (let n = 0; n < 2; n++) {
        await until(() => ov<EnigmaObserverView>().intercept === n && ov<EnigmaObserverView>().stage === 'crib', `перехват ${n + 1}`);
        for (const pos of cribCandidates(ov<EnigmaObserverView>().cipher)) {
          obs.act('crib', pos);
          await sleep(150);
          if (ov<EnigmaObserverView>().stage !== 'crib') break;
        }
        await until(() => ov<EnigmaObserverView>().cribPos !== null, 'crib найден');
        const { cipher, crib, cribPos } = ov<EnigmaObserverView>();
        for (let r = 0; r < 3; r++) {
          const i = [...crib].map((_, t) => cribPos! + t).find((p) => p % 3 === r)!;
          mech.act('rotor', { index: r, value: (cipher.charCodeAt(i) - crib.charCodeAt(i - cribPos!) + 26) % 26 });
        }
        mech.act('check');
        await until(() => isSolved() || ov<EnigmaObserverView>().intercept > n, `перехват ${n + 1} прочитан`);
      }
      break;
    }
    case 'korolev': {
      mech.act('launch'); // одна ступень — не долетает
      await sleep(150);
      const v = mv<KorolevMechanicView>();
      const params = { payload: v.parts.payload, massLimit: v.massLimit };
      let config = null;
      for (const c of rocketConfigs(3)) if (c.length === 3 && simulate(c, params).ok) { config = c; break; }
      config!.forEach((s, i) => mech.act('stage', { index: i, tanks: s.tanks, engine: s.engine }));
      mech.act('launch');
      break;
    }
  }
}
