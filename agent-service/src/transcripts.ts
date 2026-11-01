import { createClient } from 'redis';
import { config } from './config.ts';
import { api } from './api.ts';
import { hearPhrase } from './context.ts';

/**
 * Расшифровки голосового чата из Redis (пишет transcriber): живой поток transcripts:live
 * и история комнаты transcripts:room:<roomId> — её подгружаем, когда сессия встречается впервые.
 * roomId расшифровки = код комнаты Colyseus = session в событиях игры.
 * Redis недоступен — сервис работает как раньше, просто без «ушей».
 */
interface Entry {
  roomId: string;
  participantName?: string;
  text: string;
  endedAt: number;
}

const seeded = new Set<string>();
let reader: ReturnType<typeof createClient> | null = null;

function parse(raw: string): Entry | null {
  try {
    const e = JSON.parse(raw) as Entry;
    return e?.roomId && typeof e.text === 'string' && e.text.trim() ? e : null;
  } catch {
    return null;
  }
}

const toPhrase = (e: Entry) => ({ name: e.participantName || 'кто-то', text: e.text.trim(), at: e.endedAt || Date.now() });

/** Подгрузить последние фразы комнаты (один раз на сессию). */
export async function seedSession(session: string) {
  if (seeded.has(session) || !reader?.isReady) return;
  seeded.add(session);
  try {
    const list = await reader.lRange(`transcripts:room:${session}`, -12, -1);
    for (const raw of list) {
      const e = parse(raw);
      if (e) hearPhrase(session, toPhrase(e), true);
    }
  } catch (e) {
    seeded.delete(session);
    console.warn(`[transcripts] история ${session} не загрузилась: ${(e as Error).message}`);
  }
}

export async function startTranscripts() {
  const opts = { url: config.redisUrl, socket: { reconnectStrategy: (n: number) => Math.min(1000 * 2 ** n, 15_000) } };
  reader = createClient(opts);
  const sub = createClient(opts);
  let warned = false;
  for (const c of [reader, sub]) {
    c.on('error', (e: Error) => {
      if (!warned) console.warn(`[transcripts] Redis ${config.redisUrl} недоступен (${e.message}) — NPC пока без расшифровок`);
      warned = true;
    });
    c.on('ready', () => {
      if (warned) console.log('[transcripts] Redis снова доступен');
      warned = false;
    });
  }
  try {
    await Promise.all([reader.connect(), sub.connect()]);
    await sub.subscribe('transcripts:live', (raw) => {
      const e = parse(raw);
      if (!e) return;
      const phrase = toPhrase(e);
      void seedSession(e.roomId).then(() => hearPhrase(e.roomId, phrase));
      // Ответ на вопрос у ворот можно сказать голосом: сервер сам решает, закрыты ли ворота.
      void api.voice({ session: e.roomId, name: phrase.name, text: phrase.text }).catch(() => {});
    });
    console.log(`[transcripts] слушаю ${config.redisUrl} transcripts:live`);
  } catch (e) {
    console.warn(`[transcripts] не подключился к Redis: ${(e as Error).message} — повторю в фоне`);
  }
}
