/**
 * Единая модель игрового события. Всё, что происходит в сессии, — одно событие в одном формате:
 * его пишет DuckDB (временной ряд), читает LLM-сервис (поток /llm/stream), считает прогрессия.
 */

export type GameEventType =
  | 'session.start'
  | 'session.end'
  | 'player.join'
  | 'player.leave'
  | 'level.enter'
  | 'scenario.step'
  | 'scenario.bonus'
  | 'role.take'
  | 'role.leave'
  | 'puzzle.action'
  | 'puzzle.failed'
  | 'puzzle.stage'
  | 'puzzle.solved'
  | 'part.awarded'
  | 'coin.pickup'
  | 'fall'
  | 'crate.reset'
  | 'reward.claim'
  | 'chat'
  | 'agent.ask'
  | 'agent.say'
  | 'hint'
  | 'achievement'
  | 'xp'
  | 'like'
  | 'emote'
  | 'shop.buy'
  | 'idle'
  | 'finale';

export interface EventActor {
  id: string;
  name: string;
}

export interface GameEvent<D = Record<string, unknown>> {
  /** Сквозной монотонный номер на сервере — по нему LLM-сервис догоняет пропущенное (?since=). */
  seq: number;
  /** Unix ms на сервере. */
  ts: number;
  /** Код комнаты (сессия). */
  session: string;
  type: GameEventType;
  /** Уровень, где произошло: 'hub' или levelId эпохи. */
  level: string;
  /** Сценарий и шаг на момент события — контекст для LLM без лишних запросов. */
  scenario: string | null;
  step: string | null;
  player: EventActor | null;
  data: D;
}

/** Точка телеметрии: позиция игрока, пишется ~5 Гц. */
export interface TelemetrySample {
  ts: number;
  session: string;
  playerId: string;
  level: string;
  x: number;
  y: number;
  z: number;
  anim: string;
}
