import type { GalileoMechanicView, GalileoObserverView, Role, VenusPhase } from '@chronolet/shared';
import { Puzzle, num, round, type ActionResult } from './Puzzle.ts';

type Vec = [number, number];
type Scheme = 'geo' | 'helio';

const VENUS_ORBIT = 0.72;
/** Птолемей: Венера на эпицикле, центр которого всегда на линии Земля — Солнце, между ними. */
const EPICYCLE = { center: 0.6, radius: 0.25 };

/** Ночи наблюдений: какую фазу видит Наблюдатель. Полный диск в геоцентрической схеме недостижим. */
const NIGHTS: { phase: VenusPhase; lit: number }[] = [
  { phase: 'crescent', lit: 0.2 },
  { phase: 'half', lit: 0.5 },
  { phase: 'full', lit: 0.95 },
];

const PHASE_NAME: Record<VenusPhase, string> = {
  new: 'не видна',
  crescent: 'тонкий серп',
  half: 'половина диска',
  gibbous: 'почти полный диск',
  full: 'полный диск',
};

export function venusPositions(scheme: Scheme, angleDeg: number): { sun: Vec; earth: Vec; venus: Vec } {
  const a = (angleDeg * Math.PI) / 180;
  if (scheme === 'helio') {
    return { sun: [0, 0], earth: [1, 0], venus: [VENUS_ORBIT * Math.cos(a), VENUS_ORBIT * Math.sin(a)] };
  }
  return {
    earth: [0, 0],
    sun: [1, 0],
    venus: [EPICYCLE.center + EPICYCLE.radius * Math.cos(a), EPICYCLE.radius * Math.sin(a)],
  };
}

/** Освещённая доля диска Венеры, видимого с Земли: (1 + cos α) / 2, α — угол Солнце–Венера–Земля. */
export function litFraction(scheme: Scheme, angleDeg: number): number {
  const { sun, earth, venus } = venusPositions(scheme, angleDeg);
  const toSun: Vec = [sun[0] - venus[0], sun[1] - venus[1]];
  const toEarth: Vec = [earth[0] - venus[0], earth[1] - venus[1]];
  const cos =
    (toSun[0] * toEarth[0] + toSun[1] * toEarth[1]) / (Math.hypot(...toSun) * Math.hypot(...toEarth));
  return (1 + cos) / 2;
}

export function phaseOf(lit: number): VenusPhase {
  if (lit < 0.08) return 'new';
  if (lit < 0.35) return 'crescent';
  if (lit < 0.65) return 'half';
  if (lit < 0.88) return 'gibbous';
  return 'full';
}

/**
 * «Фазы Венеры». Наблюдатель видит фазу в телескопе, Механик крутит модель и не видит фазу.
 * Три ночи: серп → половина → полный диск. Полный диск даёт только гелиоцентрическая схема.
 */
export class GalileoPuzzle extends Puzzle {
  readonly id = 'galileo' as const;
  readonly hints = [
    'Может, стоит посмотреть на Венеру внимательнее? Она меняется, как Луна.',
    'В схеме с Землёй в центре Венера никогда не уходит за Солнце — значит, полного диска там не бывает.',
    'Переключите модель на «Солнце в центре» и поставьте Венеру по ту сторону Солнца от Земли.',
  ] as const;

  private night = 0;
  private scheme: Scheme = 'geo';
  private angle = 0;

  stageText(): string {
    if (this.solved) return 'Решено: Венера вращается вокруг Солнца!';
    return `Ночь ${this.night + 1} из ${NIGHTS.length}: Наблюдатель описывает фазу, Механик настраивает модель`;
  }

  view(role: Role): GalileoObserverView | GalileoMechanicView {
    const night = Math.min(this.night, NIGHTS.length - 1);
    if (role === 'observer') {
      return { night, nights: NIGHTS.length, phase: NIGHTS[night].phase, lit: NIGHTS[night].lit, solved: this.solved };
    }
    const pos = venusPositions(this.scheme, this.angle);
    const r = (v: Vec): Vec => [round(v[0], 3), round(v[1], 3)];
    return {
      night,
      nights: NIGHTS.length,
      scheme: this.scheme,
      angle: this.angle,
      sun: r(pos.sun),
      earth: r(pos.earth),
      venus: r(pos.venus),
      solved: this.solved,
    };
  }

  act(role: Role, action: string, value: unknown): ActionResult | null {
    if (role !== 'mechanic' || this.solved) return null;
    if (action === 'scheme') {
      if (value !== 'geo' && value !== 'helio') return null;
      this.scheme = value;
      return {};
    }
    if (action === 'angle') {
      const v = num(value, 0, 360);
      if (v === null) return null;
      this.angle = Math.round(v) % 360;
      return {};
    }
    if (action === 'observe') {
      const modelPhase = phaseOf(litFraction(this.scheme, this.angle));
      const target = NIGHTS[this.night].phase;
      // Сообщение видят все — не раскрываем, какую фазу дала модель, иначе Механик подберёт её в одиночку.
      if (modelPhase !== target) return this.fail('Модель не совпала с наблюдением');
      this.night++;
      if (this.night === NIGHTS.length) return this.win('Все три ночи совпали с моделью');
      return { event: 'stage_passed', message: `Ночь ${this.night}: модель совпала с наблюдением (${PHASE_NAME[target]})` };
    }
    return null;
  }
}

export { PHASE_NAME };
