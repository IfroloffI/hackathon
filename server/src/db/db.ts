import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.ts';

/**
 * SQLite через встроенный node:sqlite — без нативных сборок, один файл на хосте.
 * Схема — подмножество раздела 8 дизайн-дока; agent_memory/dialog_log уже заведены под ИИ.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    crew_name TEXT NOT NULL,
    host_player_id TEXT,
    current_epoch INTEGER NOT NULL DEFAULT 0,
    parts_json TEXT NOT NULL DEFAULT '[]',
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE TABLE player_state (
    player_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    epoch INTEGER NOT NULL DEFAULT 0,
    x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
    connected INTEGER NOT NULL DEFAULT 1,
    roles_played_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, session_id)
  );
  CREATE TABLE agent_memory (
    agent_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    told_cards_json TEXT NOT NULL DEFAULT '[]',
    mistakes_json TEXT NOT NULL DEFAULT '[]',
    last_summary TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (agent_id, player_id)
  );
  CREATE TABLE events_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT, player_id TEXT,
    type TEXT NOT NULL, payload_json TEXT, ts INTEGER NOT NULL
  );
  CREATE TABLE dialog_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL, player_id TEXT,
    role TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL
  );
  `,
];

function openDb(): DatabaseSync {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  }
  return db;
}

export const db = openDb();
