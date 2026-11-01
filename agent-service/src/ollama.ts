import { config } from './config.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamResult {
  text: string;
  ttftMs: number | null;
  totalMs: number;
  tokens: number;
}

/**
 * Потоковый /api/chat локальной Ollama. Персона агента идёт первым system-сообщением и не меняется —
 * Ollama переиспользует KV-кэш общего префикса, и задержка до первого токена на CPU заметно меньше.
 */
export async function streamChat(
  messages: ChatMessage[],
  opts: { signal: AbortSignal; onToken: (textSoFar: string) => void; maxTokens?: number },
): Promise<StreamResult> {
  const t0 = Date.now();
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      keep_alive: -1,
      // Разнообразие: выше температура, штраф за повторы, случайный seed (иначе одинаковый промпт → одинаковый ответ).
      options: {
        num_predict: opts.maxTokens ?? config.maxTokens,
        temperature: 0.8,
        top_p: 0.9,
        repeat_penalty: 1.08,
        repeat_last_n: 128,
        seed: Math.floor(Math.random() * 2 ** 31),
        num_ctx: 3072,
      },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama HTTP ${res.status}`);
  let text = '';
  let ttftMs: number | null = null;
  let tokens = 0;
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
      if (msg.error) throw new Error(`ollama: ${msg.error}`);
      const piece = msg.message?.content ?? '';
      if (piece) {
        if (ttftMs === null) ttftMs = Date.now() - t0;
        text += piece;
        tokens++;
        opts.onToken(text);
      }
    }
  }
  return { text, ttftMs, totalMs: Date.now() - t0, tokens };
}

/**
 * Здоровье Ollama: модель загружена и отвечает. Без здоровья сервис не «захватывает» события —
 * сервер сам скажет заготовку по таймеру (игра не ждёт LLM).
 */
export const health = {
  ok: false,
  lastError: '' as string,
  markFail(err: unknown) {
    this.ok = false;
    this.lastError = String((err as Error)?.message ?? err);
  },
  markOk() {
    this.ok = true;
    this.lastError = '';
  },
};

export async function checkModel(): Promise<boolean> {
  try {
    const r = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const tags = (await r.json()) as { models?: { name: string }[] };
    const has = !!tags.models?.some((m) => m.name === config.model || m.name.startsWith(`${config.model}`));
    if (!has) throw new Error(`модель ${config.model} не скачана`);
    return true;
  } catch (e) {
    health.markFail(e);
    return false;
  }
}

/** Прогрев: модель в память (keep_alive) и общий префикс персоны в KV-кэш. */
export async function warmup(system: string): Promise<number | null> {
  const t0 = Date.now();
  try {
    await streamChat([{ role: 'system', content: system }, { role: 'user', content: 'Скажи «готов».' }], {
      signal: AbortSignal.timeout(120_000),
      onToken: () => {},
      maxTokens: 4,
    });
    health.markOk();
    return Date.now() - t0;
  } catch (e) {
    health.markFail(e);
    return null;
  }
}
