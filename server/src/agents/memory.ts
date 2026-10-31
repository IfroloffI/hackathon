import { agentMemory } from '../db/repositories.ts';

/**
 * Заготовленные реплики с памятью: агент не повторяется (agent_memory.told_cards — общая
 * с LLM-сервисом: заготовки помечаются `script:<n>`, LLM пишет свои id карточек).
 * Когда всё рассказано — повторяет последнюю (главную) мысль.
 */
export function nextLine(agentId: string, playerId: string, lines: string[]): string {
  const mem = agentMemory.get(agentId, playerId);
  const idx = lines.findIndex((_, i) => !mem.toldCards.includes(`script:${i}`));
  if (idx === -1) return lines[lines.length - 1];
  agentMemory.set(agentId, playerId, { toldCards: [...mem.toldCards, `script:${idx}`] });
  return lines[idx];
}
