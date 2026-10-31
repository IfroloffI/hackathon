import { db } from '../db/db.ts';

const stmt = {
  get: db.prepare('SELECT told_cards_json FROM agent_memory WHERE agent_id = ? AND player_id = ?'),
  upsert: db.prepare(`
    INSERT INTO agent_memory (agent_id, player_id, told_cards_json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (agent_id, player_id) DO UPDATE SET told_cards_json = excluded.told_cards_json, updated_at = excluded.updated_at
  `),
};

/**
 * Память агента об игроке (таблица agent_memory): какие реплики уже рассказаны.
 * Агент не повторяется, а когда всё рассказал — повторяет последнюю (главную) мысль.
 */
export function nextLine(agentId: string, playerId: string, lines: string[]): string {
  const row = stmt.get.get(agentId, playerId) as { told_cards_json: string } | undefined;
  const told: number[] = row ? JSON.parse(row.told_cards_json) : [];
  const idx = lines.findIndex((_, i) => !told.includes(i));
  const pick = idx === -1 ? lines.length - 1 : idx;
  if (idx !== -1) stmt.upsert.run(agentId, playerId, JSON.stringify([...told, idx]), Date.now());
  return lines[pick];
}
