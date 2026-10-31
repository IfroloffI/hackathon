/**
 * Эталонный (игрушечный) LLM-сервис по контракту chronolet.llm/1 — образец для настоящей
 * реализации: подписка на поток, ответы на вопросы игроков потоковыми репликами, подсказки
 * при затыках, память агентов. Вместо модели — шаблоны.
 *   LLM_SERVICE_TOKEN=dev-llm-token npm run llm-mock -w server
 */
import WebSocket from 'ws';
import { SERVER_PORT, type GameEvent, type LlmSayRequest, type LlmStreamMessage, type SessionSnapshot } from '@chronolet/shared';

const base = process.env.SERVER_URL ?? `http://127.0.0.1:${SERVER_PORT}`;
const token = process.env.LLM_SERVICE_TOKEN ?? 'dev-llm-token';
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const snapshots = new Map<string, SessionSnapshot>();
const fails = new Map<string, number[]>();

async function post(path: string, body: unknown) {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  return r.json();
}

/** Потоковая реплика: несколько кусков с одним streamId, последний — final. */
export async function streamSay(req: Omit<LlmSayRequest, 'text' | 'streamId' | 'final'>, text: string) {
  const streamId = `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const words = text.split(' ');
  let acc = '';
  for (let i = 0; i < words.length; i += 3) {
    acc += (acc ? ' ' : '') + words.slice(i, i + 3).join(' ');
    const final = i + 3 >= words.length;
    await post('/llm/say', { ...req, text: acc, streamId, final });
    if (!final) await new Promise((r) => setTimeout(r, 120));
  }
}

async function onEvent(e: GameEvent) {
  const snap = snapshots.get(e.session);
  if (e.type === 'agent.ask') {
    const { agentId, text } = e.data as { agentId: string; text: string };
    const step = snap?.scenario?.goal ?? 'осмотреться';
    const reply = text
      ? `${e.player?.name}, хороший вопрос: «${text}». Сейчас главное — ${step.toLowerCase()}.`
      : `${e.player?.name}, рад тебя видеть. Наша цель сейчас: ${step.toLowerCase()}.`;
    await streamSay({ session: e.session, agentId, to: e.player?.id, replyTo: e.seq }, reply);
    if (e.player) await post('/llm/memory', { agentId, playerId: e.player.id, summary: `спрашивал: ${text || '(подошёл поговорить)'}` });
  }
  if (e.type === 'puzzle.failed') {
    const list = (fails.get(e.session) ?? []).filter((t) => e.ts - t < 60_000);
    list.push(e.ts);
    fails.set(e.session, list);
    if (list.length === 3) await post('/llm/hint', { session: e.session, level: 1, text: 'Три промаха за минуту. Остановитесь и проговорите вслух, что видит каждый.' });
  }
  if (e.type === 'idle') {
    await post('/llm/say', { session: e.session, agentId: 'ship_ai', text: `${e.player?.name}, вы там уснули? Экипаж ждёт.` });
  }
}

export function connect(onMessage?: (m: LlmStreamMessage) => void, since?: number): Promise<WebSocket> {
  const url = `${base.replace(/^http/, 'ws')}/llm/stream?token=${encodeURIComponent(token)}${since !== undefined ? `&since=${since}` : ''}`;
  const ws = new WebSocket(url);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as LlmStreamMessage;
    onMessage?.(m);
    if (m.type === 'snapshot') snapshots.set(m.snapshot.session, m.snapshot);
    if (m.type === 'event' && !m.replay) void onEvent(m.event);
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await connect((m) => {
    if (m.type === 'event') console.log(`#${m.event.seq} ${m.event.session} ${m.event.type}`, JSON.stringify(m.event.data).slice(0, 120));
    if (m.type === 'hello') console.log('connected', m.protocol, 'sessions:', m.sessions);
  });
}
