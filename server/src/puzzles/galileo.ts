import type { GalileoMechanicView, GalileoObserverView, Role, VenusPhase } from '@chronolet/shared';
import { Puzzle, num, round, type ActionResult } from './Puzzle.ts';

type Vec = [number, number];
type Scheme = 'geo' | 'helio';

const VENUS_ORBIT = 0.72;
/** Птолемей: Венера на эпицикле, центр которого всегда на линии Земля — Солнце, между ними. */
const EPICYCLE = { center: 0.6, radius: 0.25 };

/** Ночи наблюдений: какую фазу видит Наблюдатель. Полный и почти полный диск в геоцентрической схеме недостижимы. */
const NIGHTS: { phase: VenusPhase; lit: number }[] = [
  { phase: 'crescent', lit: 0.2 },
  { phase: 'half', lit: 0.5 },
  { phase: 'gibbous', lit: 0.78 },
  { phase: 'full', lit: 0.95 },
];
/** В эту ночь (с 0) небо сначала затянуто — Наблюдатель ждёт, пока облака уйдут. */
const CLOUDY_NIGHT = 2;
export const CLOUD_MS = 8000;
/** Спутники Юпитера за две ночи: смещения от планеты. Их четыре — ответ этапа «moons». */
const MOONS = [
  [-34, -21, 12, 30],
  [-28, 9, 18, -40],
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
 * Четыре ночи: серп → половина → почти полный → полный (только гелиоцентрическая схема).
 * В третью ночь первые CLOUD_MS небо в облаках. Бонус: Механик называет число спутников Юпитера,
 * которые видит только Наблюдатель.
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
  private nightStartedAt = Date.now();
  private moonsAnswer: number | null = null;

  constructor(private now: () => number = Date.now) {
    super();
    this.nightStartedAt = now();
  }

  private get stageName(): 'nights' | 'moons' | 'solved' {
    return this.solved ? 'solved' : this.night < NIGHTS.length ? 'nights' : 'moons';
  }

  private get cloudy(): boolean {
    return this.night === CLOUDY_NIGHT && this.now() - this.nightStartedAt < CLOUD_MS;
  }

  nextChangeAt(): number | null {
    return this.cloudy ? this.nightStartedAt + CLOUD_MS : null;
  }

  stageText(): string {
    if (this.solved) return 'Решено: Венера вращается вокруг Солнца, а у Юпитера свои луны!';
    if (this.stageName === 'moons') return 'Бонус Галилея: сколько спутников у Юпитера?';
    return `Ночь ${this.night + 1} из ${NIGHTS.length}${this.cloudy ? ' — облака!' : ''}: Наблюдатель описывает фазу, Механик настраивает модель`;
  }

  view(role: Role): GalileoObserverView | GalileoMechanicView {
    const night = Math.min(this.night, NIGHTS.length - 1);
    if (role === 'observer') {
      const hidden = this.cloudy || this.stageName !== 'nights';
      return {
        stage: this.stageName,
        night,
        nights: NIGHTS.length,
        phase: hidden ? null : NIGHTS[night].phase,
        lit: hidden ? null : NIGHTS[night].lit,
        clouds: this.cloudy,
        moons: this.stageName === 'nights' ? null : MOONS,
        solved: this.solved,
      };
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
      stage: this.stageName,
      moonsAnswer: this.moonsAnswer,
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
    if (action === 'moons' && this.stageName === 'moons') {
      const n = num(value, 0, 12);
      if (n === null || !Number.isInteger(n)) return null;
      this.moonsAnswer = n;
      if (n !== MOONS[0].length) return this.fail(`${n} — Галилей пересчитывает и не соглашается`);
      return this.win('Четыре спутника Юпитера — «Медицейские звёзды»!');
    }
    if (action === 'observe' && this.stageName === 'nights') {
      if (this.cloudy) return { message: 'Облака! Ждите, пока Наблюдатель увидит Венеру' };
      const modelPhase = phaseOf(litFraction(this.scheme, this.angle));
      const target = NIGHTS[this.night].phase;
      // Сообщение видят все — не раскрываем, какую фазу дала модель, иначе Механик подберёт её в одиночку.
      if (modelPhase !== target) return this.fail('Модель не совпала с наблюдением');
      this.night++;
      this.nightStartedAt = this.now();
      if (this.night === NIGHTS.length) return this.stage('Все четыре ночи совпали с моделью. Теперь — Юпитер');
      return this.stage(`Ночь ${this.night}: модель совпала с наблюдением (${PHASE_NAME[target]})`);
    }
    return null;
  }
}

export { PHASE_NAME };
