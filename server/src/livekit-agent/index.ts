// LiveKit Agent Worker for Chronolot
// Connects to LiveKit room, reads game state from SQLite DB,
// and generates AI comments based on game events.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.ts';

// --- Configuration ---
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const WHISPER_URL = process.env.WHISPER_URL || 'http://127.0.0.1:9000/v1';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';

// --- DB connection ---
const dbPath = config.dbPath;
const db = new DatabaseSync(dbPath);

// --- System prompt ---
const SYSTEM_PROMPT =
  'Ты — ХРОНОС, бортовой ИИ космического корабля-хронолёта. ' +
  'Комментируешь происходящее в игре для экипажа из до 6 игроков. ' +
  'Учитывай эпоху, роли игроков (Наблюдатель/Механик), полученные детали. ' +
  'Давай краткие комментарии (1-2 предложения) в стиле: ' +
  'вежливо-ядовитый, саркастичный, но полезный. ' +
  'Помни историю: если игроки уже проходили эпоху, напоминай об этом.';

/**
 * Получает состояние игры из SQLite БД.
 * Возвращает epoch, parts, и карту игроков с их позициями и статусом онлайн.
 */
function getGameState(sessionId: string) {
  try {
    const sessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!sessionRow) return null;

    const playerRows = db.prepare(
      'SELECT p.name, ps.x, ps.y, ps.z, ps.connected FROM player_state ps JOIN players p ON p.id = ps.player_id WHERE ps.session_id = ?'
    ).all(sessionId) as any[];

    const partsJson: any = sessionRow.parts_json;
  const parts: string[] = JSON.parse(partsJson || '[]');

    return {
      epoch: sessionRow.current_epoch,
      parts,
      players: playerRows.reduce((acc: any, row: any) => {
        acc[row.name] = { name: row.name, x: row.x, y: row.y, z: row.z, connected: row.connected };
        return acc;
      }, {}),
    };
  } catch (e) {
    console.error('[DB] Error:', e);
    return null;
  }
}

/**
 * Отправляет запрос к Ollama LLM и возвращает ответ.
 */
async function getLLMResponse(userMessage: string): Promise<string | null> {
  try {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      stream: false,
    });

    const fetchPromise = fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const timeoutPromise = new Promise<string | null>((resolve) => {
      setTimeout(() => resolve(null), 8000);
    });

    const res = (await Promise.race([fetchPromise, timeoutPromise])) as
      | Response
      | null;

    if (!res) {
      console.error('[LLM] request timeout');
      return null;
    }

    if (!res.ok) {
      const txt = await res.text();
      console.error('[LLM] error:', txt);
      return null;
    }

    const data: any = await res.json();
    return data.message?.content ?? null;
  } catch (e) {
    console.error('[LLM] exception:', e);
    return null;
  }
}

/**
 * Логирует комментарий в консоль (в боевом режиме — отправляет в LiveKit через data channel).
 */
function sendComment(text: string) {
  console.log('[LiveKitAgent] →', text);
  // TODO: room.localParticipant.publishData(Buffer.from(text), { reliable: true });
  // В продакшене здесь был бы вызов SDK для публикации аудио-комментария
  // в LiveKit room через WebRTC data channel.
}

/**
 * Основной воркер агента.
 * Вызывается один раз на каждую игровую комнату при её создании.
 *
 * @param {string} gameSessionId - ID Colyseus сессии (соответствует имени LiveKit комнаты)
 */
async function agentWorker(gameSessionId: string) {
  console.log('[LiveKitAgent] Worker started for session:', gameSessionId);

  // Читаем начальное состояние игры
  const state: any = getGameState(gameSessionId);
  if (!state) {
    console.error('[LiveKitAgent] Could not read game state for session:', gameSessionId);
    return;
  }
  console.log('[LiveKitAgent] Initial state - epoch:', state.epoch, 'parts:', state.parts.length, 'players:', Object.keys(state.players).length);

  // Опрос состояния каждые 5 секунд
  const interval = setInterval(async () => {
    try {
      const current: any = getGameState(gameSessionId);
      if (!current) return;

      const changes: string[] = [];

      // Смена эпохи
      if (current.epoch !== state.epoch) {
        const epochNames: any = { 0: 'хаб', 1: 'Александрия', 2: 'Падуя', 3: 'Ньютон', 4: 'Блетчли-парк', 5: 'Байконур' };
        changes.push(`эпоха: ${epochNames[current.epoch] || current.epoch}`);
      }

      // Полученные детали
      if (current.parts.length !== state.parts.length) {
        const added: string[] = [];
        for (const p of current.parts) {
          if (!state.parts.includes(p)) added.push(p);
        }
        if (added.length > 0) changes.push(`детали: ${added.join(', ')}`);
      }

      // Игроки онлайн
      const curOnline: any = Object.values(current.players).filter((p: any) => p.connected).length;
      const prevOnline: any = Object.values(state.players).filter((p: any) => p.connected).length;
      if (curOnline !== prevOnline) changes.push(`игроков онлайн: ${curOnline}`);

      if (changes.length > 0) {
        const msg: string = `Игра: ${changes.join(', ')}.`;
        const response: string | null = await getLLMResponse(msg);
        if (response) {
          sendComment(response);
          console.log('[LiveKitAgent] Comment:', response);
        }
      }

      // Обновляем состояние для следующего цикла
      state.epoch = current.epoch;
      state.parts = current.parts;
      state.players = current.players;
    } catch (e) {
      console.error('[LiveKitAgent] poll error:', e);
    }
  }, 5000);

  console.log('[LiveKitAgent] Worker polling interval started (5s interval)');
  // Возвращаем функцию остановки опроса
  return () => clearInterval(interval);
}

// Экспорт функций для использования из основного сервера
export { agentWorker, getGameState, getLLMResponse, sendComment };

// Точка входа при直接 запуске (для тестирования)
if (import.meta.url === new URL(import.meta.url).href) {
  const sid = process.env.GAME_SESSION_ID || '';
  if (sid) agentWorker(sid).catch(console.error);
}