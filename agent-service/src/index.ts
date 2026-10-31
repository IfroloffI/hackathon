import WebSocket from 'ws';
import { LLM_PROTOCOL, type AgentProfile, type LlmStreamMessage } from '@chronolet/shared';
import { config } from './config.ts';
import { api } from './api.ts';
import { ctx, remember } from './context.ts';
import { checkModel, health, warmup } from './ollama.ts';
import { systemPrompt } from './prompt.ts';
import { onEvent } from './responder.ts';

/**
 * agent-service: realtime-LLM для NPC «Хронолёта» по контракту chronolet.llm/1.
 * Подписка на /llm/stream (с догоном по ?since=), реакции на отвечаемые события и простой,
 * генерация через локальную Ollama со стримингом, ответы через /llm/say|hint, память — /llm/memory.
 * Игра от этого сервиса не зависит: нет ответа в срок — сервер говорит заготовку.
 */
const agents = new Map<string, AgentProfile>();
let lastSeq: number | undefined;

async function loadContent() {
  for (;;) {
    try {
      const c = await api.content();
      if (c.protocol !== LLM_PROTOCOL) console.warn(`[agent] протокол сервера ${c.protocol}, ожидали ${LLM_PROTOCOL}`);
      for (const a of c.agents) agents.set(a.id, a);
      console.log(`[agent] контент: ${c.agents.length} агентов, ${c.puzzles.length} головоломок`);
      return;
    } catch (e) {
      console.warn(`[agent] сервер ${config.serverUrl} недоступен (${(e as Error).message}) — повтор через 3 с`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** Здоровье Ollama: при восстановлении — прогрев (модель в память, префикс ХРОНОСа в кэш). */
async function watchOllama() {
  const wasOk = health.ok;
  if (await checkModel()) {
    if (!wasOk) {
      const ms = await warmup(systemPrompt(agents.get('ship_ai')!));
      console.log(ms !== null ? `[agent] Ollama ${config.model} готова, прогрев ${ms} мс` : `[agent] прогрев не удался: ${health.lastError}`);
    }
  } else if (wasOk || !health.lastError.startsWith('[logged]')) {
    console.warn(`[agent] Ollama недоступна: ${health.lastError} — работают заготовки сервера`);
    health.lastError = `[logged] ${health.lastError}`;
  }
}

function connect() {
  const since = lastSeq !== undefined ? `&since=${lastSeq}` : '';
  const ws = new WebSocket(`${config.serverUrl.replace(/^http/, 'ws')}/llm/stream?token=${encodeURIComponent(config.token)}${since}`);
  ws.on('open', () => console.log(`[agent] подключён к ${config.serverUrl}/llm/stream${since ? ` (догон с #${lastSeq})` : ''}`));
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as LlmStreamMessage;
    if (m.type === 'hello' && lastSeq === undefined) lastSeq = m.lastSeq;
    if (m.type === 'snapshot') ctx(m.snapshot.session).snapshot = m.snapshot;
    if (m.type === 'event') {
      lastSeq = Math.max(lastSeq ?? 0, m.event.seq);
      remember(m.event);
      // Реплей — только контекст: отвечать на старое поздно.
      if (!m.replay) onEvent(m.event, agents);
    }
  });
  ws.on('close', () => {
    console.warn('[agent] поток закрыт — переподключение через 2 с');
    setTimeout(connect, 2000);
  });
  ws.on('error', (e) => console.warn(`[agent] ошибка потока: ${e.message}`));
}

console.log(`[agent] старт: сервер ${config.serverUrl}, Ollama ${config.ollamaUrl}, модель ${config.model}`);
await loadContent();
await watchOllama();
setInterval(() => void watchOllama(), 10_000).unref();
connect();
