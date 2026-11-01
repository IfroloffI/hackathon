import type { GameEvent } from '@chronolet/shared';
import { eventBus } from '../core/eventBus.ts';
import { config } from '../config.ts';
import { OllamaClient } from './ollama.ts';

/**
 * Заготовка под ИИ-персонажей (раздел 5 дизайн-дока): рассказчики эпох и бортовой ИИ.
 * Пока LLM не подключаем — сервис только подписан на шину и логирует события,
 * чтобы было видно, какие триггеры до него доходят.
 *
 * План: persona.md + knowledge.json + agent_memory (БД) → промпт → Ollama;
 * таймаут ~3 с → фолбэк-реплика; очередь комментариев бортового ИИ не чаще 8–10 с.
 */
export class AgentService {
  private llm = config.ollama.enabled ? new OllamaClient(config.ollama.url, config.ollama.model) : null;

  start() {
    eventBus.on((e) => this.onEvent(e));
    console.log(`[agents] ${this.llm ? `LLM: ${config.ollama.model} @ ${config.ollama.url}` : 'реплики NPC: заготовки + agent-service по /llm/stream (docker compose up -d)'}`);
  }

  private onEvent(e: GameEvent) {
    if (process.env.DEBUG_EVENTS === '1') console.log('[agents] event', e);
    // Реплики LLM приходят от внешнего сервиса через /llm/say (контракт — shared/src/llm.ts).
  }
}
