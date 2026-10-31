import { randomUUID } from 'node:crypto';
import { db } from './db.ts';

export interface PlayerRow {
  id: string;
  name: string;
}

export interface PlayerStateRow {
  x: number;
  y: number;
  z: number;
  epoch: number;
}

export interface PositionUpdate extends PlayerStateRow {
  playerId: string;
}

export interface PlayerStats {
  coinsTotal: number;
  falls: number;
  observer: number;
  mechanic: number;
  likesGiven: number;
}

export interface ProfileRow {
  coins: number;
  skin: string;
  owned: string[];
  xp: number;
  likes: number;
  achievements: string[];
  stats: PlayerStats;
}

const EMPTY_STATS: PlayerStats = { coinsTotal: 0, falls: 0, observer: 0, mechanic: 0, likesGiven: 0 };

const stmt = {
  getProfile: db.prepare('SELECT coins, skin, owned_json, xp, likes, achievements_json, stats_json FROM player_profile WHERE player_id = ?'),
  upsertProfile: db.prepare(`
    INSERT INTO player_profile (player_id, coins, skin, owned_json, xp, likes, achievements_json, stats_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET coins = excluded.coins, skin = excluded.skin, owned_json = excluded.owned_json,
      xp = excluded.xp, likes = excluded.likes, achievements_json = excluded.achievements_json,
      stats_json = excluded.stats_json, updated_at = excluded.updated_at
  `),
  leaderboard: db.prepare(`
    SELECT p.name, pp.xp, pp.likes, pp.skin, json_array_length(pp.achievements_json) AS achievements
    FROM player_profile pp JOIN players p ON p.id = pp.player_id
    WHERE pp.xp > 0 ORDER BY pp.xp DESC LIMIT ?
  `),
  getMemory: db.prepare('SELECT told_cards_json, mistakes_json, last_summary, updated_at FROM agent_memory WHERE agent_id = ? AND player_id = ?'),
  upsertMemory: db.prepare(`
    INSERT INTO agent_memory (agent_id, player_id, told_cards_json, mistakes_json, last_summary, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (agent_id, player_id) DO UPDATE SET told_cards_json = excluded.told_cards_json,
      mistakes_json = excluded.mistakes_json, last_summary = excluded.last_summary, updated_at = excluded.updated_at
  `),
  findPlayerByName: db.prepare('SELECT id, name FROM players WHERE name = ?'),
  findAccount: db.prepare('SELECT id, name, password_hash FROM players WHERE lower(name) = lower(?)'),
  setPassword: db.prepare('UPDATE players SET password_hash = ? WHERE id = ?'),
  insertPlayer: db.prepare('INSERT INTO players (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)'),
  touchPlayer: db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?'),

  insertSession: db.prepare(
    'INSERT INTO sessions (id, crew_name, host_player_id, started_at) VALUES (?, ?, ?, ?)',
  ),
  finishSession: db.prepare('UPDATE sessions SET finished_at = ? WHERE id = ?'),
  setProgress: db.prepare('UPDATE sessions SET current_epoch = ?, parts_json = ? WHERE id = ?'),
  getRoles: db.prepare('SELECT roles_played_json FROM player_state WHERE player_id = ? AND session_id = ?'),
  setRoles: db.prepare('UPDATE player_state SET roles_played_json = ? WHERE player_id = ? AND session_id = ?'),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  listSessions: db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?'),

  getPlayerState: db.prepare(
    'SELECT x, y, z, epoch FROM player_state WHERE player_id = ? AND session_id = ?',
  ),
  upsertPlayerState: db.prepare(`
    INSERT INTO player_state (player_id, session_id, epoch, x, y, z, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (player_id, session_id) DO UPDATE SET
      epoch = excluded.epoch, x = excluded.x, y = excluded.y, z = excluded.z, updated_at = excluded.updated_at
  `),
  sessionPlayers: db.prepare(`
    SELECT p.name, ps.x, ps.y, ps.z, ps.epoch, ps.updated_at
    FROM player_state ps JOIN players p ON p.id = ps.player_id
    WHERE ps.session_id = ?
  `),

  insertEvent: db.prepare(
    'INSERT INTO events_log (session_id, player_id, type, payload_json, ts) VALUES (?, ?, ?, ?, ?)',
  ),
};

export interface AccountRow extends PlayerRow {
  password_hash: string | null;
}

export const players = {
  /** Аккаунт по логину (без учёта регистра — «Ада» и «ада» один игрок). */
  account(name: string): AccountRow | undefined {
    return stmt.findAccount.get(name) as AccountRow | undefined;
  },
  setPassword(id: string, hash: string) {
    stmt.setPassword.run(hash, id);
  },
  /** Авторизация «по имени»: нашли — вернули, нет — завели. */
  findOrCreate(name: string): PlayerRow {
    const now = Date.now();
    const existing = stmt.findPlayerByName.get(name) as PlayerRow | undefined;
    if (existing) {
      stmt.touchPlayer.run(now, existing.id);
      return existing;
    }
    const row = { id: randomUUID(), name };
    try {
      stmt.insertPlayer.run(row.id, row.name, now, now);
      return row;
    } catch {
      // второй одновременный логин с тем же именем проиграл INSERT — перечитываем
      const winner = stmt.findPlayerByName.get(name) as PlayerRow | undefined;
      if (!winner) { throw new Error(`игрок «${name}» не создался`); }
      return winner;
    }
  },
};

export const sessions = {
  create(id: string, crewName: string, hostPlayerId: string | null) {
    stmt.insertSession.run(id, crewName, hostPlayerId, Date.now());
  },
  finish(id: string) {
    stmt.finishSession.run(Date.now(), id);
  },
  setProgress(id: string, epoch: number, parts: string[]) {
    stmt.setProgress.run(epoch, JSON.stringify(parts), id);
  },
  get(id: string) {
    return stmt.getSession.get(id);
  },
  list(limit = 50) {
    return stmt.listSessions.all(limit);
  },
  players(id: string) {
    return stmt.sessionPlayers.all(id);
  },
};

export const playerState = {
  load(playerId: string, sessionId: string): PlayerStateRow | undefined {
    return stmt.getPlayerState.get(playerId, sessionId) as PlayerStateRow | undefined;
  },
  /** Пакетное сохранение одной транзакцией — вызывается по таймеру, не на каждый move. */
  saveMany(sessionId: string, rows: PositionUpdate[]) {
    if (rows.length === 0) return;
    const now = Date.now();
    db.exec('BEGIN');
    try {
      for (const r of rows) stmt.upsertPlayerState.run(r.playerId, sessionId, r.epoch, r.x, r.y, r.z, now);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
};

/** Кошелёк VK Coin и скины игрока — живут между сессиями. */
export const profiles = {
  load(playerId: string): ProfileRow {
    const row = stmt.getProfile.get(playerId) as
      | { coins: number; skin: string; owned_json: string; xp: number; likes: number; achievements_json: string; stats_json: string }
      | undefined;
    if (!row) return { coins: 0, skin: 'default', owned: ['default'], xp: 0, likes: 0, achievements: [], stats: { ...EMPTY_STATS } };
    return {
      coins: row.coins,
      skin: row.skin,
      owned: JSON.parse(row.owned_json),
      xp: row.xp,
      likes: row.likes,
      achievements: JSON.parse(row.achievements_json),
      stats: { ...EMPTY_STATS, ...JSON.parse(row.stats_json) },
    };
  },
  save(playerId: string, p: ProfileRow) {
    stmt.upsertProfile.run(
      playerId, p.coins, p.skin, JSON.stringify(p.owned), p.xp, p.likes,
      JSON.stringify(p.achievements), JSON.stringify(p.stats), Date.now(),
    );
  },
  leaderboard(limit = 20) {
    return stmt.leaderboard.all(limit) as { name: string; xp: number; likes: number; skin: string; achievements: number }[];
  },
};

/** Память агентов об игроках (agent_memory) — пишет LLM-сервис через /llm/memory. */
export const agentMemory = {
  get(agentId: string, playerId: string) {
    const row = stmt.getMemory.get(agentId, playerId) as
      | { told_cards_json: string; mistakes_json: string; last_summary: string | null; updated_at: number }
      | undefined;
    return {
      agentId,
      playerId,
      toldCards: row ? (JSON.parse(row.told_cards_json) as string[]) : [],
      mistakes: row ? (JSON.parse(row.mistakes_json) as string[]) : [],
      summary: row?.last_summary ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  },
  set(agentId: string, playerId: string, patch: { toldCards?: string[]; mistakes?: string[]; summary?: string }) {
    const cur = agentMemory.get(agentId, playerId);
    stmt.upsertMemory.run(
      agentId, playerId,
      JSON.stringify(patch.toldCards ?? cur.toldCards),
      JSON.stringify(patch.mistakes ?? cur.mistakes),
      patch.summary ?? cur.summary,
      Date.now(),
    );
  },
};

export const rolesPlayed = {
  /** Счётчик сыгранных ролей (дизайн-док, правило 3: роли — тем, кто ещё не играл). */
  increment(playerId: string, sessionId: string, role: string) {
    const row = stmt.getRoles.get(playerId, sessionId) as { roles_played_json: string } | undefined;
    if (!row) return;
    const roles = JSON.parse(row.roles_played_json) as Record<string, number>;
    roles[role] = (roles[role] ?? 0) + 1;
    stmt.setRoles.run(JSON.stringify(roles), playerId, sessionId);
  },
};

export const eventsLog = {
  write(sessionId: string, playerId: string | null, type: string, payload?: unknown) {
    stmt.insertEvent.run(sessionId, playerId, type, payload === undefined ? null : JSON.stringify(payload), Date.now());
  },
};
