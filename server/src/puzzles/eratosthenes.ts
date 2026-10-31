import type { EratMechanicView, EratObserverView, EratStage, Role } from '@chronolet/shared';
import { Puzzle, num, type ActionResult } from './Puzzle.ts';

const ANGLES = [6, 6.4, 7.2, 7.5, 8, 9];
const ANGLE_TOLERANCE = 0.3;
const ANSWER_TOLERANCE = 0.03;

/**
 * «Тень и колодец», три этапа:
 *  1) Механик совмещает дугу гномона с тенью и фиксирует угол (видит тень, не знает расстояния);
 *  2) Наблюдатель (знает расстояние) вычисляет окружность и диктует, Механик набирает её на счётах;
 *  3) Наблюдатель видит число на счётах и подтверждает — или возвращает на пересчёт.
 * Расстояние и угол случайные — ответ не выучить.
 */
export class EratosthenesPuzzle extends Puzzle {
  readonly id = 'eratosthenes' as const;
  readonly distance: number;
  readonly shadow: number;
  readonly hints: readonly [string, string, string];

  private st: EratStage = 'measure';
  private arc = 0;
  private abacus: number | null = null;

  constructor(rand = Math.random) {
    super();
    this.distance = 4000 + Math.floor(rand() * 9) * 250;
    this.shadow = ANGLES[Math.floor(rand() * ANGLES.length)];
    this.hints = [
      'В Сиене тени нет, а в Александрии есть. Одно Солнце, одна Земля — что их различает?',
      'Угол тени — такая же доля от 360°, как расстояние между городами — доля окружности Земли.',
      `360 / ${this.shadow} = ${(360 / this.shadow).toFixed(1)}. Умножьте расстояние на это число.`,
    ] as const;
  }

  get answer() {
    return (this.distance * 360) / this.shadow;
  }

  stageText(): string {
    switch (this.st) {
      case 'measure':
        return 'Механик измеряет угол тени гномона в Александрии';
      case 'compute':
        return 'Наблюдатель считает окружность Земли и диктует, Механик набирает на счётах';
      case 'confirm':
        return 'Наблюдатель проверяет число на счётах';
      case 'solved':
        return `Решено: окружность Земли ≈ ${Math.round(this.answer).toLocaleString('ru-RU')} стадий`;
    }
  }

  view(role: Role): EratObserverView | EratMechanicView {
    const abacus = this.st === 'confirm' || this.st === 'solved' ? this.abacus : null;
    if (role === 'observer') return { stage: this.st, distance: this.distance, angleLocked: this.st !== 'measure', abacus };
    return { stage: this.st, arc: this.arc, shadow: this.shadow, locked: this.st !== 'measure', abacus: this.abacus };
  }

  act(role: Role, action: string, value: unknown): ActionResult | null {
    if (role === 'mechanic' && this.st === 'measure') {
      if (action === 'arc') {
        const v = num(value, 0, 30);
        if (v === null) return null;
        this.arc = Math.round(v * 10) / 10;
        return {};
      }
      if (action === 'lock') {
        if (Math.abs(this.arc - this.shadow) > ANGLE_TOLERANCE) return this.fail(`Дуга на ${this.arc}° не совпадает с тенью`);
        this.arc = this.shadow;
        this.st = 'compute';
        return this.stage('Угол тени зафиксирован');
      }
    }
    if (role === 'mechanic' && this.st === 'compute' && action === 'abacus') {
      const v = num(value, 1, 1e9);
      if (v === null) return null;
      this.abacus = Math.round(v);
      this.st = 'confirm';
      return this.stage('Число набрано на счётах');
    }
    if (role === 'observer' && this.st === 'confirm' && action === 'confirm') {
      if (value === false) {
        this.st = 'compute';
        return { message: 'Наблюдатель вернул счёты на пересчёт' };
      }
      if (Math.abs(this.abacus! - this.answer) / this.answer > ANSWER_TOLERANCE) {
        this.st = 'compute';
        return this.fail(`${this.abacus!.toLocaleString('ru-RU')} стадий — Эратосфен качает головой`);
      }
      this.st = 'solved';
      return this.win('Окружность Земли измерена!');
    }
    return null;
  }
}
