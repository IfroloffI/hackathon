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

const stmt = {
  findPlayerByName: db.prepare('SELECT id, name FROM players WHERE name = ?'),
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

export const players = {
  /** Пока авторизация «по имени»: нашли — вернули, нет — завели. Пароль/JWT добавятся в auth. */
  findOrCreate(name: string): PlayerRow {
    const now = Date.now();
    const existing = stmt.findPlayerByName.get(name) as PlayerRow | undefined;
    if (existing) {
      stmt.touchPlayer.run(now, existing.id);
      return existing;
    }
    const row = { id: randomUUID(), name };
    stmt.insertPlayer.run(row.id, row.name, now, now);
    return row;
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
