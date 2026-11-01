/**
 * Одна Ollama на CPU — одна генерация за раз. Очередь с приоритетами и сроками:
 * вопрос игрока → ошибка → этап/решение → простой. Задача, чей срок истёк в очереди,
 * выбрасывается (заготовка уже прозвучала у сервера).
 */
export interface Task {
  priority: number;
  /** Последний момент, когда задачу ещё имеет смысл начинать (unix ms). */
  startBy: number;
  label: string;
  run(): Promise<void>;
  /** Вызывается, если задача так и не стартовала в срок. */
  expired(): void;
}

export class TaskQueue {
  private items: Task[] = [];
  private busy = false;

  push(t: Task) {
    this.items.push(t);
    this.items.sort((a, b) => a.priority - b.priority || a.startBy - b.startBy);
    void this.pump();
  }

  get size() {
    return this.items.length;
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let t = this.items.shift(); t; t = this.items.shift()) {
        if (Date.now() > t.startBy) {
          t.expired();
          continue;
        }
        try {
          await t.run();
        } catch (e) {
          console.error(`[queue] ${t.label} упала:`, e);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
