/**
 * Проверка контракта chronolet.llm/1 против запущенного сервера (npm run llm-contract -w server).
 */
import WebSocket from 'ws';
import { Client } from '@colyseus/sdk';
import { CREW_ROOM, CrewState, SERVER_PORT, getLevel, type LlmStreamMessage, type SayPayload } from '@chronolet/shared';
import { connect } from './llm-mock.ts';

const url = process.env.SERVER_URL ?? `http://127.0.0.1:${SERVER_PORT}`;
const token = process.env.LLM_SERVICE_TOKEN ?? 'dev-llm-token';
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok  ${msg}`);
};
async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`FAIL: не дождались: ${what}`);
    await sleep(25);
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = async (path: string): Promise<any> => (await fetch(`${url}${path}`, { headers: H })).json();

// Авторизация.
assert((await fetch(`${url}/llm/sessions`)).status === 401, 'REST без токена — 401');
const badWs = await new Promise<number>((res) => {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/llm/stream?token=wrong`);
  ws.on('unexpected-response', (_req, r) => res(r.statusCode ?? 0));
  ws.on('open', () => res(200));
});
assert(badWs === 401, 'WS без токена — 401');

// Поток.
const stream: LlmStreamMessage[] = [];
const llm = await connect((m) => stream.push(m));
await until(() => stream.some((m) => m.type === 'hello'), 'hello');
const hello = stream.find((m) => m.type === 'hello') as Extract<LlmStreamMessage, { type: 'hello' }>;
assert(hello.protocol === 'chronolet.llm/1', `hello: ${hello.protocol}, lastSeq=${hello.lastSeq}`);

const room = await new Client(url).create(CREW_ROOM, { name: `llm-${Date.now() % 10000}` }, CrewState);
const says: SayPayload[] = [];
room.onMessage('*', () => {});
room.onMessage('say', (m: SayPayload) => says.push(m));
const sid = room.roomId;
await until(() => stream.some((m) => m.type === 'event' && m.event.session === sid && m.event.type === 'player.join'), 'событие player.join в потоке');
await until(() => stream.some((m) => m.type === 'snapshot' && m.snapshot.session === sid && m.snapshot.crew.length === 1), 'снимок сессии');
assert(true, 'поток: события и снимки новой сессии приходят');

// Вопрос агенту → потоковый ответ LLM, без заготовки.
const ai = getLevel('hub').stations.find((s) => s.id === 'ship_ai')!;
const me = () => room.state.players.get(room.sessionId)!;
for (let x = me().x; Math.abs(x - ai.x) > 0.1; ) {
  x += Math.sign(ai.x - x) * Math.min(0.28, Math.abs(ai.x - x));
  room.send('move', { levelId: 'hub', x, y: 0, z: 0, vx: 0, vy: 0, anim: 'run', facing: 1 });
  await sleep(50);
}
await sleep(150);
room.send('interact', { stationId: 'ship_ai' });
await until(() => says.some((s) => s.source === 'llm' && !s.partial), 'финальная реплика LLM');
const llmSays = says.filter((s) => s.source === 'llm');
assert(llmSays.some((s) => s.partial) && llmSays.at(-1)!.streamId === llmSays[0].streamId, `потоковая реплика: ${llmSays.length} кусков, «${llmSays.at(-1)!.text}»`);
await sleep(3500);
assert(!says.some((s) => s.source === 'script' && s.agentId === 'ship_ai' && /Я ХРОНОС/.test(s.text)), 'заготовка не прозвучала — LLM успела ответить');

// Подсказка от LLM.
const ack = (await (await fetch(`${url}/llm/hint`, { method: 'POST', headers: H, body: JSON.stringify({ session: sid, level: 2, text: 'Проверка подсказки' }) })).json()) as { ok: boolean; seq: number };
await until(() => says.some((s) => s.hint === 2 && s.text === 'Проверка подсказки'), 'подсказка дошла до игрока');
assert(ack.ok && ack.seq > 0, `/llm/hint → seq ${ack.seq}`);
const badSay = await fetch(`${url}/llm/say`, { method: 'POST', headers: H, body: JSON.stringify({ session: sid, agentId: 'nobody', text: 'x' }) });
assert(badSay.status === 400, 'неизвестный агент — 400');

// Реплей по since.
const replay: LlmStreamMessage[] = [];
const since = hello.lastSeq;
const llm2 = await connect((m) => replay.push(m), since);
await until(() => replay.some((m) => m.type === 'event' && m.event.session === sid && m.event.type === 'hint'), 'реплей до подсказки');
const evs = replay.filter((m): m is Extract<LlmStreamMessage, { type: 'event' }> => m.type === 'event');
assert(evs.every((m, i) => i === 0 || m.event.seq > evs[i - 1].event.seq) && evs[0].replay, `реплей с seq>${since}: ${evs.length} событий по порядку`);
llm2.close();

// История, ряды, память.
const hist = await get(`/llm/sessions/${sid}/events?types=agent.ask,agent.say,hint`);
assert(hist.events.some((e: { type: string; data: { source?: string } }) => e.type === 'agent.say' && e.data.source === 'llm'), 'история: agent.say от LLM записан');
const act = await get(`/llm/sessions/${sid}/series?metric=activity&bucket=1s`);
assert(act.points.length > 0 && act.points.some((p: { values: { distance: number } }) => p.values.distance > 0), `ряд activity: ${act.points.length} окон`);
const evSeries = await get(`/llm/sessions/${sid}/series?metric=events&bucket=10s`);
assert(evSeries.points.some((p: { key: string }) => p.key === 'agent.ask'), 'ряд events по типам');
const snap = await get(`/llm/sessions/${sid}/snapshot`);
assert(snap.crew[0].name === me().name && snap.levelId === 'hub', 'снимок по REST');
const playerId = snap.crew[0].id;
const mem = await get(`/llm/memory/ship_ai/${playerId}`);
assert(/спрашивал/.test(mem.summary ?? ''), `память агента записана LLM: «${mem.summary}»`);

// Без LLM — заготовка сразу.
llm.close();
await sleep(200);
const n = says.length;
room.send('interact', { stationId: 'ship_ai' });
await until(() => says.length > n, 'заготовка');
assert(says.at(-1)!.source === 'script', 'LLM отключена — сразу звучит заготовка');

await room.leave();
console.log('\nLLM CONTRACT PASSED');
process.exit(0);
