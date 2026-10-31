import type { GameEvent } from '@chronolet/shared';
import { timeseries } from '../timeseries/store.ts';

/**
 * Шина игровых событий. Каждое событие получает сквозной seq и время, пишется во временной ряд
 * (DuckDB) и раздаётся подписчикам: LLM-хаб (/llm/stream), сервис агентов, отладка.
 * Комнаты не знают, кто слушает.
 */
export type EmitInput = Omit<GameEvent, 'seq' | 'ts'>;
type Handler = (e: GameEvent) => void;

class EventBus {
  private handlers = new Set<Handler>();

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(input: EmitInput): GameEvent {
    const e: GameEvent = { seq: timeseries.nextSeq(), ts: Date.now(), ...input };
    timeseries.appendEvent(e);
    for (const h of this.handlers) {
      try {
        h(e);
      } catch (err) {
        console.error('[eventBus] handler failed', e.type, err);
      }
    }
    return e;
  }
}

export const eventBus = new EventBus();
