import type {
  LlmAck,
  LlmContentResponse,
  LlmHintRequest,
  LlmMemory,
  LlmMemoryRequest,
  LlmSayRequest,
  LlmVoiceRequest,
} from '@chronolet/shared';
import { config } from './config.ts';

/** REST-часть контракта chronolet.llm/1 (сервис → игровой сервер). */
const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${config.serverUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

export const api = {
  say: (req: LlmSayRequest) => post<LlmAck>('/llm/say', req),
  hint: (req: LlmHintRequest) => post<LlmAck>('/llm/hint', req),
  /** Фраза из расшифровки — серверу: пока ворота закрыты, она идёт классификатору ответов. */
  voice: (req: LlmVoiceRequest) => post<LlmAck>('/llm/voice', req),
  memory: (req: LlmMemoryRequest) => post<{ ok: boolean }>('/llm/memory', req),
  async getMemory(agentId: string, playerId: string): Promise<LlmMemory | null> {
    try {
      const r = await fetch(`${config.serverUrl}/llm/memory/${agentId}/${encodeURIComponent(playerId)}`, { headers, signal: AbortSignal.timeout(1500) });
      return r.ok ? ((await r.json()) as LlmMemory) : null;
    } catch {
      return null;
    }
  },
  async content(): Promise<LlmContentResponse> {
    const r = await fetch(`${config.serverUrl}/llm/content`, { headers, signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`/llm/content HTTP ${r.status}`);
    return (await r.json()) as LlmContentResponse;
  },
};
