/**
 * Клиент answer-classifier (answer-classifier/, отдельный контейнер): верен ли ответ игрока
 * на вопрос-ворота NPC. Решает бинарный классификатор (логрег на bag of words), не LLM.
 */
import { config } from '../config.ts';

export interface GateNpc {
  name: string;
  question: string;
  accept: string;
  reject: string;
}

export interface Verdict {
  accepted: boolean;
  probability: number;
  knownWords: string[];
}

let npcs: Record<string, GateNpc> | null = null;

/** Вопросы и реплики NPC — из сервиса (единый источник: answer-classifier/questions.json). */
export async function gateNpcs(): Promise<Record<string, GateNpc> | null> {
  if (npcs) return npcs;
  try {
    const res = await fetch(`${config.answerClassifier.url}/npcs`, { signal: AbortSignal.timeout(config.answerClassifier.timeoutMs) });
    if (!res.ok) return null;
    npcs = (await res.json()) as Record<string, GateNpc>;
    return npcs;
  } catch {
    return null;
  }
}

/** null — сервис недоступен или не знает этого NPC. */
export async function classifyAnswer(npcId: string, text: string): Promise<Verdict | null> {
  try {
    const res = await fetch(`${config.answerClassifier.url}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ npc_id: npcId, text }),
      signal: AbortSignal.timeout(config.answerClassifier.timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accepted: boolean; probability: number; known_words: string[] };
    return { accepted: data.accepted, probability: data.probability, knownWords: data.known_words };
  } catch {
    return null;
  }
}
