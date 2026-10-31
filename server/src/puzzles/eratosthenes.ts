import type { EratMechanicView, EratObserverView, Role } from '@chronolet/shared';
import { Puzzle, num, type ActionResult } from './Puzzle.ts';

const DISTANCE = 5000; // стадий
const SHADOW = 7.2; // градусов = 1/50 круга
const ANGLE_TOLERANCE = 0.3;
const ANSWER = (DISTANCE * 360) / SHADOW; // 250 000 стадий
const ANSWER_TOLERANCE = 0.05;

/**
 * «Тень и колодец». Наблюдатель (Сиена) знает расстояние и что в полдень тени нет.
 * Механик (Александрия) совмещает дугу с тенью гномона и фиксирует угол.
 * Затем Наблюдатель вводит окружность Земли — для этого нужен угол от Механика.
 */
export class EratosthenesPuzzle extends Puzzle {
  readonly id = 'eratosthenes' as const;
  readonly hints = [
    'В Сиене тени нет, а в Александрии есть. Одно Солнце, одна Земля — что их различает?',
    'Угол тени в Александрии — такая же доля полного круга, как расстояние между городами — доля окружности Земли.',
    `${SHADOW}° — это 1/50 от 360°. Значит, окружность Земли в 50 раз больше ${DISTANCE} стадий.`,
  ] as const;

  private stage: 'measure' | 'compute' | 'solved' = 'measure';
  private arc = 0;

  stageText(): string {
    if (this.stage === 'measure') return 'Механик измеряет угол тени гномона в Александрии';
    if (this.stage === 'compute') return 'Угол зафиксирован. Наблюдатель вычисляет окружность Земли';
    return `Решено: окружность Земли ≈ ${ANSWER.toLocaleString('ru-RU')} стадий`;
  }

  view(role: Role): EratObserverView | EratMechanicView {
    if (role === 'observer') return { stage: this.stage, distance: DISTANCE, angleLocked: this.stage !== 'measure' };
    return { stage: this.stage, arc: this.arc, shadow: SHADOW, locked: this.stage !== 'measure' };
  }

  act(role: Role, action: string, value: unknown): ActionResult | null {
    if (role === 'mechanic' && this.stage === 'measure') {
      if (action === 'arc') {
        const v = num(value, 0, 30);
        if (v === null) return null;
        this.arc = Math.round(v * 10) / 10;
        return {};
      }
      if (action === 'lock') {
        if (Math.abs(this.arc - SHADOW) > ANGLE_TOLERANCE) return this.fail(`Дуга на ${this.arc}° не совпадает с тенью`);
        this.arc = SHADOW;
        this.stage = 'compute';
        return { event: 'stage_passed', message: 'Угол тени зафиксирован' };
      }
    }
    if (role === 'observer' && this.stage === 'compute' && action === 'answer') {
      const v = num(value, 0, 1e9);
      if (v === null) return null;
      if (Math.abs(v - ANSWER) / ANSWER > ANSWER_TOLERANCE) {
        return this.fail(`${Math.round(v).toLocaleString('ru-RU')} стадий — Эратосфен качает головой`);
      }
      this.stage = 'solved';
      return this.win('Окружность Земли измерена!');
    }
    return null;
  }
}
