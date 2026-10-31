import type { NewtonMechanicView, NewtonObserverView, NewtonShot, Role } from '@chronolet/shared';
import { Puzzle, num, round, type ActionResult } from './Puzzle.ts';

const G = 9.81;
const SPEED: [number, number] = [5, 25];
const ANGLE: [number, number] = [5, 85];
const TOLERANCE = 1.5;
const MAX_SHOTS_SHOWN = 5;

export function trajectory(speed: number, angleDeg: number): NewtonShot {
  const a = (angleDeg * Math.PI) / 180;
  const vx = speed * Math.cos(a);
  const vy = speed * Math.sin(a);
  const flight = (2 * vy) / G;
  const points: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (flight * i) / 24;
    points.push([round(vx * t, 2), round(Math.max(0, vy * t - (G * t * t) / 2), 2)]);
  }
  return { landing: round(vx * flight, 2), points };
}

/**
 * «Законы движения». Механик задаёт скорость и угол, но не видит полёта.
 * Наблюдатель видит мишень и траектории выстрелов и говорит «дальше/ближе».
 */
export class NewtonPuzzle extends Puzzle {
  readonly id = 'newton' as const;
  readonly hints = [
    'Ядро летит по кривой. Что будет, если толкнуть его сильнее? А если поднять ствол?',
    'Дальше всего ядро летит при угле 45°. Поставьте 45° и меняйте только скорость.',
    'Дальность = v² · sin(2·угол) / g. Наблюдатель знает расстояние до мишени — посчитайте скорость.',
  ] as const;

  readonly target: number;
  private speed = 12;
  private angle = 30;
  private shots: NewtonShot[] = [];
  private fired = 0;

  constructor(target = 25 + Math.round(Math.random() * 30)) {
    super();
    this.target = target;
  }

  stageText(): string {
    if (this.solved) return 'Решено: ядро попало точно в цель!';
    return `Выстрелов: ${this.fired}. Наблюдатель видит мишень, Механик наводит пушку`;
  }

  view(role: Role): NewtonObserverView | NewtonMechanicView {
    if (role === 'observer') return { target: this.target, tolerance: TOLERANCE, shots: this.shots, solved: this.solved };
    return {
      speed: this.speed,
      angle: this.angle,
      speedRange: SPEED,
      angleRange: ANGLE,
      shotsFired: this.fired,
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
      const shot = trajectory(this.speed, this.angle);
      this.fired++;
      this.shots = [...this.shots, shot].slice(-MAX_SHOTS_SHOWN);
      const miss = shot.landing - this.target;
      if (Math.abs(miss) <= TOLERANCE) return this.win('Попадание!');
      return this.fail('Выстрел! Куда упало ядро — видит Наблюдатель');
    }
    return null;
  }
}
