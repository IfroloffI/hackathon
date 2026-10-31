import type {
  EngineType,
  KorolevLaunch,
  KorolevMechanicView,
  KorolevObserverView,
  RocketStage,
  Role,
} from '@chronolet/shared';
import { Puzzle, num, round, type ActionResult } from './Puzzle.ts';

export interface RocketParams {
  payload: number;
  massLimit: number;
}

export const ROCKET = {
  payload: 1, // т, корабль (по умолчанию; в сессии — случайный из VARIANTS)
  tank: { fuel: 10, dry: 1 }, // т
  engines: { A: { mass: 1.5, ve: 2.6 }, B: { mass: 3, ve: 3.1 } } as Record<EngineType, { mass: number; ve: number }>,
  massLimit: 120, // т, грузоподъёмность стартового стола
  required: 7.9, // км/с, первая космическая
  maxStages: 3,
  maxTanks: 6,
};

const stageDry = (s: RocketStage) => s.tanks * ROCKET.tank.dry + ROCKET.engines[s.engine].mass;
const stageMass = (s: RocketStage) => s.tanks * (ROCKET.tank.fuel + ROCKET.tank.dry) + ROCKET.engines[s.engine].mass;
const active = (stages: RocketStage[]) => stages.filter((s) => s.tanks > 0);
const DEFAULT: RocketParams = { payload: ROCKET.payload, massLimit: ROCKET.massLimit };

export function rocketMass(stages: RocketStage[], p: RocketParams = DEFAULT): number {
  return p.payload + active(stages).reduce((m, s) => m + stageMass(s), 0);
}

/** Все конфигурации из 1..maxStages ступеней (для проверки вариантов перебором). */
export function* rocketConfigs(maxStages: number): Generator<RocketStage[]> {
  const opts: RocketStage[] = [];
  for (let t = 1; t <= ROCKET.maxTanks; t++) for (const e of ['A', 'B'] as const) opts.push({ tanks: t, engine: e });
  function* build(prefix: RocketStage[]): Generator<RocketStage[]> {
    if (prefix.length) yield prefix;
    if (prefix.length < maxStages) for (const o of opts) yield* build([...prefix, o]);
  }
  yield* build([]);
}

/**
 * Варианты «корабль × стартовый стол», для которых сценарий честный: ни одна 1–2-ступенчатая
 * ракета не выходит на орбиту, а какая-то 3-ступенчатая — выходит. Считается один раз перебором.
 */
export const VARIANTS: RocketParams[] = (() => {
  const out: RocketParams[] = [];
  for (const payload of [0.8, 1, 1.2, 1.5])
    for (const massLimit of [110, 115, 120, 125]) {
      const p = { payload, massLimit };
      let two = false;
      for (const c of rocketConfigs(2)) if (simulate(c, p).ok) { two = true; break; }
      if (two) continue;
      let three = false;
      for (const c of rocketConfigs(3)) if (c.length === 3 && simulate(c, p).ok) { three = true; break; }
      if (three) out.push(p);
    }
  return out;
})();

/** Формула Циолковского по ступеням снизу вверх: Δv = v_e · ln(m0 / m1), после работы ступень сбрасывается. */
export function simulate(stages: RocketStage[], p: RocketParams = DEFAULT): KorolevLaunch {
  const list = active(stages);
  let mass = rocketMass(stages, p);
  const result: KorolevLaunch['stages'] = [];
  let total = 0;
  for (const s of list) {
    const m0 = mass;
    const m1 = m0 - s.tanks * ROCKET.tank.fuel;
    const dv = ROCKET.engines[s.engine].ve * Math.log(m0 / m1);
    result.push({ dv: round(dv), m0: round(m0, 1), m1: round(m1, 1) });
    total += dv;
    mass = m1 - stageDry(s);
  }
  total = round(total);
  const m0 = rocketMass(stages, p);
  let reason: string;
  let ok = false;
  if (list.length === 0) reason = 'Ракеты нет: ни одного бака';
  else if (m0 > p.massLimit) reason = `Масса ${round(m0, 1)} т больше грузоподъёмности стола ${p.massLimit} т — ракета не оторвалась`;
  else if (total < ROCKET.required) reason = `Набрана скорость ${total} км/с из ${ROCKET.required} — ракета упала`;
  else {
    ok = true;
    reason = `Орбита! Набрано ${total} км/с`;
  }
  return { stages: result, total, required: ROCKET.required, ok, reason };
}

/**
 * «Первый полёт». Механик собирает ступени (баки + двигатель), видит массы деталей.
 * Наблюдатель видит формулу, характеристики двигателей и телеметрию тестовых пусков.
 * Одной ступени не хватает — команда сама приходит к многоступенчатой схеме.
 */
export class KorolevPuzzle extends Puzzle {
  readonly id = 'korolev' as const;
  readonly hints = [
    'Ракета тащит вверх пустые баки. Зачем они ей, когда топливо кончилось?',
    'Разбейте ракету на ступени: отработавшая ступень сбрасывается, и верхним легче разгоняться.',
    'Три ступени, снизу самая тяжёлая на двигателе B, сверху — маленькая. Следите, чтобы масса влезла в стол.',
  ] as const;

  private stages: RocketStage[] = [
    { tanks: 4, engine: 'B' },
    { tanks: 0, engine: 'A' },
    { tanks: 0, engine: 'A' },
  ];
  private launches: KorolevLaunch[] = [];
  readonly params: RocketParams;

  constructor(rand = Math.random, params?: RocketParams) {
    super();
    this.params = params ?? VARIANTS[Math.floor(rand() * VARIANTS.length)];
  }

  stageText(): string {
    if (this.solved) return 'Решено: ракета вышла на орбиту!';
    return `Тестовых пусков: ${this.launches.length}. Механик собирает ракету, Наблюдатель следит за телеметрией`;
  }

  view(role: Role): KorolevObserverView | KorolevMechanicView {
    const mass = round(rocketMass(this.stages, this.params), 1);
    if (role === 'observer') {
      return {
        required: ROCKET.required,
        engines: { A: { ve: ROCKET.engines.A.ve }, B: { ve: ROCKET.engines.B.ve } },
        mass,
        fuel: active(this.stages).reduce((f, s) => f + s.tanks * ROCKET.tank.fuel, 0),
        massLimit: this.params.massLimit,
        launches: this.launches.slice(-4),
        solved: this.solved,
      };
    }
    return {
      stages: this.stages.map((s) => ({ ...s })),
      maxStages: ROCKET.maxStages,
      maxTanks: ROCKET.maxTanks,
      parts: {
        tank: ROCKET.tank,
        engines: { A: { mass: ROCKET.engines.A.mass }, B: { mass: ROCKET.engines.B.mass } },
        payload: this.params.payload,
      },
      mass,
      massLimit: this.params.massLimit,
      launches: this.launches.length,
      solved: this.solved,
    };
  }

  act(role: Role, action: string, value: unknown): ActionResult | null {
    if (role !== 'mechanic' || this.solved) return null;
    if (action === 'stage') {
      const v = value as { index?: unknown; tanks?: unknown; engine?: unknown } | null;
      const i = num(v?.index, 0, ROCKET.maxStages - 1);
      const tanks = num(v?.tanks, 0, ROCKET.maxTanks);
      if (i === null || tanks === null || !Number.isInteger(i) || !Number.isInteger(tanks)) return null;
      if (v?.engine !== 'A' && v?.engine !== 'B') return null;
      this.stages[i] = { tanks, engine: v.engine };
      return {};
    }
    if (action === 'launch') {
      const launch = simulate(this.stages, this.params);
      this.launches.push(launch);
      // Публичное сообщение без цифр: телеметрия — данные Наблюдателя.
      if (launch.ok) return this.win('Пуск! Ракета ушла на орбиту');
      return this.fail('Тестовый пуск неудачен — телеметрия в бункере у Наблюдателя');
    }
    return null;
  }
}
