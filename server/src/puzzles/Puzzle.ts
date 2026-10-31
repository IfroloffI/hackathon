import type { PuzzleId, Role } from '@chronolet/shared';

export type PuzzleEvent = 'attempt_failed' | 'stage_passed' | 'solved';

export interface ActionResult {
  event?: PuzzleEvent;
  /** Короткая реплика для всех (результат действия). */
  message?: string;
}

/**
 * Головоломка как конечный автомат (раздел 7 дизайн-дока). Только сервер знает полное
 * состояние и проверяет решение; клиентам уходят stage (всем) и view(role) (только своей роли).
 */
export abstract class Puzzle {
  abstract readonly id: PuzzleId;
  attempts = 0;
  solved = false;
  /** Подсказки бортового ИИ по нарастающей: намёк → направление → почти ответ. */
  abstract readonly hints: readonly [string, string, string];

  /** Статус для всех, без секретов. */
  abstract stageText(): string;
  /** Приватный вид для роли. */
  abstract view(role: Role): unknown;
  /** Действие игрока на роли. null — действие проигнорировано (не та роль, не тот этап, мусор). */
  abstract act(role: Role, action: string, value: unknown): ActionResult | null;

  protected fail(message: string): ActionResult {
    this.attempts++;
    return { event: 'attempt_failed', message };
  }

  protected win(message: string): ActionResult {
    this.solved = true;
    return { event: 'solved', message };
  }
}

export const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;

export const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
