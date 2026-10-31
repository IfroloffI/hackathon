import type { NewtonMechanicView, NewtonObserverView, NewtonShot, Role } from '@chronolet/shared';
import { Puzzle, num, round, type ActionResult } from './Puzzle.ts';

const G = 9.81;
const SPEED: [number, number] = [5, 25];
const ANGLE: [number, number] = [5, 85];
const TOLERANCE = 1.5;
const MAX_SHOTS_SHOWN = 5;

/** Полёт ядра; ветер сносит его вдоль поля: x(t) = (vx + wind)·t. */
export function trajectory(speed: number, angleDeg: number, wind = 0): NewtonShot {
  const a = (angleDeg * Math.PI) / 180;
  const vx = speed * Math.cos(a) + wind;
  const vy = speed * Math.sin(a);
  const flight = (2 * vy) / G;
  const points: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (flight * i) / 24;
    points.push([round(vx * t, 2), round(Math.max(0, vy * t - (G * t * t) / 2), 2)]);
  }
  return { landing: round(vx * flight, 2), points };
}

const ROUNDS = 2;

/**
 * «Законы движения». Механик задаёт скорость и угол, но не видит полёта.
 * Наблюдатель видит мишень, флюгер (ветер) и траектории — и говорит «дальше/ближе».
 * Две мишени: после первого попадания мишень переставляют и меняется ветер.
 */
export class NewtonPuzzle extends Puzzle {
  readonly id = 'newton' as const;
  readonly hints = [
    'Ядро летит по кривой. Что будет, если толкнуть его сильнее? А если поднять ствол?',
    'Дальше всего ядро летит при угле 45°. Поставьте 45° и меняйте только скорость.',
    'Дальность = v² · sin(2·угол) / g, а ветер сносит ядро на ветер × время полёта. Попутный — бьёт дальше.',
  ] as const;

  private targets: number[];
  private winds: number[];
  private round = 0;
  private speed = 12;
  private angle = 30;
  private shots: NewtonShot[] = [];
  private fired = 0;

  constructor(rand = Math.random, targets?: number[], winds?: number[]) {
    super();
    this.targets = targets ?? [25 + Math.round(rand() * 20), 35 + Math.round(rand() * 20)];
    this.winds = winds ?? [0, 0].map(() => Math.round((rand() * 6 - 3) * 2) / 2);
  }

  get target() {
    return this.targets[Math.min(this.round, ROUNDS - 1)];
  }

  get wind() {
    return this.winds[Math.min(this.round, ROUNDS - 1)];
  }

  stageText(): string {
    if (this.solved) return 'Решено: обе мишени поражены!';
    return `Мишень ${this.round + 1} из ${ROUNDS}, выстрелов: ${this.fired}. Наблюдатель видит мишень и ветер, Механик наводит пушку`;
  }

  view(role: Role): NewtonObserverView | NewtonMechanicView {
    if (role === 'observer') {
      return { round: this.round, rounds: ROUNDS, target: this.target, tolerance: TOLERANCE, wind: this.wind, shots: this.shots, solved: this.solved };
    }
    return {
      speed: this.speed,
      angle: this.angle,
      speedRange: SPEED,
      angleRange: ANGLE,
      shotsFired: this.fired,
      round: this.round,
      rounds: ROUNDS,
      solved: this.solved,
    };
  }

  act(role: Role, action: string, value: unknown): ActionResult | null {
    if (role !== 'mechanic' || this.solved) return null;
    if (action === 'speed' || action === 'angle') {
      const range = action === 'speed' ? SPEED : ANGLE;
      const v = num(value, range[0], range[1]);
      if (v === null) return null;
      if (action === 'speed') this.speed = round(v, 1);
      else this.angle = Math.round(v);
      return {};
    }
    if (action === 'fire') {
      const shot = trajectory(this.speed, this.angle, this.wind);
      this.fired++;
      this.shots = [...this.shots, shot].slice(-MAX_SHOTS_SHOWN);
      const miss = shot.landing - this.target;
      if (Math.abs(miss) <= TOLERANCE) {
        this.round++;
        if (this.round === ROUNDS) return this.win('Попадание! Обе мишени поражены');
        this.shots = [];
        return this.stage('Попадание! Мишень переставили, ветер сменился');
      }
      return this.fail('Выстрел! Куда упало ядро — видит Наблюдатель');
    }
    return null;
  }
}
