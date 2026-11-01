/**
 * Минимальный клиент локальной Ollama. Не используется, пока OLLAMA_ENABLED != 1.
 * TODO: реплики NPC генерирует отдельный agent-service/ (контракт chronolet.llm/1, стриминг) —
 * этот клиент оставлен для совместимости; кандидат на удаление после отказа от OLLAMA_ENABLED.
 */
export class OllamaClient {
  constructor(
    private url: string,
    private model: string,
  ) {}

  async chat(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], timeoutMs = 3000): Promise<string | null> {
    try {
      const res = await fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content ?? null;
    } catch {
      return null; // вызывающий берёт фолбэк-реплику
    }
  }
}
