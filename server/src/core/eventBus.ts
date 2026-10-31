/**
 * Внутренняя шина событий игры. Комнаты публикуют, подписчики (лог, будущий AgentService
 * с бортовым ИИ и рассказчиками) реагируют. Комнаты не знают о подписчиках.
 */
export type GameEvent =
  | { type: 'player.join'; sessionId: string; playerId: string; name: string }
  | { type: 'player.leave'; sessionId: string; playerId: string; name: string }
  | { type: 'chat'; sessionId: string; playerId: string; name: string; text: string }
  | { type: 'session.created'; sessionId: string; crewName: string }
  | { type: 'session.disposed'; sessionId: string }
  | { type: 'epoch.change'; sessionId: string; levelId: string }
  | { type: 'puzzle'; sessionId: string; puzzleId: string; event: string; playerId: string; attempts: number }
  | { type: 'part.awarded'; sessionId: string; partId: string };

type Handler = (e: GameEvent) => void;

class EventBus {
  private handlers = new Set<Handler>();

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(e: GameEvent) {
    for (const h of this.handlers) {
      try {
        h(e);
      } catch (err) {
        console.error('[eventBus] handler failed', e.type, err);
      }
    }
  }
}

export const eventBus = new EventBus();
