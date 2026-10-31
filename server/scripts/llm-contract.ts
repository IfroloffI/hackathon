/**
 * Проверка контракта chronolet.llm/1 против запущенного сервера.
 *   npm run llm-contract -w server                    — со встроенным образцом (llm-mock) и ручными проверками
 *   LLM_EXTERNAL=1 npm run llm-contract -w server     — против настоящего agent-сервиса (он уже подключён к /llm/stream)
 */
import WebSocket from 'ws';
import {
  ASK_TIMEOUT_MS,
  CREW_ROOM,
  CrewState,
  REACT_TIMEOUT_MS,
  SERVER_PORT,
  STREAM_DEADLINE_MS,
  getLevel,
  type GameEvent,
  type LlmStreamMessage,
  type ReplyableData,
  type SayPayload,
} from '@chronolet/shared';
import { connect } from './llm-mock.ts';
import { authedClient } from './auth.ts';

const url = process.env.SERVER_URL ?? `http://127.0.0.1:${SERVER_PORT}`;
const token = process.env.LLM_SERVICE_TOKEN ?? 'dev-llm-token';
const EXTERNAL = process.env.LLM_EXTERNAL === '1';
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
const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });

console.log(EXTERNAL ? '── режим: настоящий agent-сервис (LLM_EXTERNAL=1)' : '── режим: встроенный образец llm-mock');

// ───────── авторизация
assert((await fetch(`${url}/llm/sessions`)).status === 401, 'REST без токена — 401');
const badWs = await new Promise<number>((res) => {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/llm/stream?token=wrong`);
  ws.on('unexpected-response', (_req, r) => res(r.statusCode ?? 0));
  ws.on('open', () => res(200));
});
assert(badWs === 401, 'WS без токена — 401');

// ───────── поток (свой пассивный слушатель — в обоих режимах)
const stream: LlmStreamMessage[] = [];
const watcher = await connect((m) => stream.push(m), undefined, { autoReply: false });
await until(() => stream.some((m) => m.type === 'hello'), 'hello');
const hello = stream.find((m) => m.type === 'hello') as Extract<LlmStreamMessage, { type: 'hello' }>;
assert(hello.protocol === 'chronolet.llm/1', `hello: ${hello.protocol}, lastSeq=${hello.lastSeq}`);
const events = (sid: string, type: string) =>
  stream.filter((m): m is Extract<LlmStreamMessage, { type: 'event' }> => m.type === 'event' && m.event.session === sid && m.event.type === type).map((m) => m.event);

const content = await get('/llm/content');
assert(content.puzzles?.length === 5 && content.puzzles[0].observer, `/llm/content: ${content.puzzles.length} головоломок с ролями`);

const tag = Date.now() % 100000;
const roomA = await (await authedClient(url, `llm-a-${tag}`)).create(CREW_ROOM, { name: `llm-a-${tag}` }, CrewState);
const says: (SayPayload & { at: number })[] = [];
roomA.onMessage('*', () => {});
roomA.onMessage('say', (m: SayPayload) => says.push({ ...m, at: Date.now() }));
const sid = roomA.roomId;
await until(() => events(sid, 'player.join').length > 0, 'событие player.join в потоке');
await until(() => stream.some((m) => m.type === 'snapshot' && m.snapshot.session === sid && m.snapshot.crew.length === 1), 'снимок сессии');
assert(true, 'поток: события и снимки новой сессии приходят');

const me = () => roomA.state.players.get(roomA.sessionId)!;
async function walk(room: typeof roomA, x: number, y: number) {
  const p = () => room.state.players.get(room.sessionId)!;
  let { x: cx, y: cy } = p();
  while (Math.abs(cx - x) > 0.05 || Math.abs(cy - y) > 0.05) {
    cx += Math.max(-0.28, Math.min(0.28, x - cx));
    cy += Math.max(-0.6, Math.min(0.6, y - cy));
    room.send('move', { levelId: room.state.levelId, x: cx, y: cy, z: 0, vx: 0, vy: 0, anim: 'run', facing: 1 });
    await sleep(50);
  }
  await sleep(150);
}
const station = (id: string) => getLevel(roomA.state.levelId).stations.find((s) => s.id === id)!;
async function useStation(room: typeof roomA, id: string) {
  const st = station(id);
  await walk(room, st.x, st.y);
  room.send('interact', { stationId: id });
}

let llm: WebSocket | null = null;
if (!EXTERNAL) llm = await connect(); // образец отвечает сам

// ───────── вопрос агенту → потоковый ответ LLM, без заготовки
const nBefore = says.length;
await walk(roomA, station('ship_ai').x, station('ship_ai').y);
const askAt = Date.now();
roomA.send('interact', { stationId: 'ship_ai' });
await until(() => says.slice(nBefore).some((s) => s.source === 'llm' && !s.partial), 'финальная реплика LLM', STREAM_DEADLINE_MS + 2000);
const llmSays = says.slice(nBefore).filter((s) => s.source === 'llm');
const ttfb = llmSays[0].at - askAt;
assert(llmSays.at(-1)!.streamId === llmSays[0].streamId, `ответ на вопрос: ${llmSays.length} кусков, первый через ${ttfb} мс, «${llmSays.at(-1)!.text.slice(0, 80)}»`);
await sleep(ASK_TIMEOUT_MS + 500);
assert(!says.slice(nBefore).some((s) => s.source === 'script' && s.agentId === 'ship_ai'), 'заготовка не прозвучала — LLM ответила (один голос)');

// ───────── подсказка без replyTo, ошибки REST
const ack = (await (await post('/llm/hint', { session: sid, level: 2, text: 'Проверка подсказки' })).json()) as { ok: boolean; seq: number };
await until(() => says.some((s) => s.hint === 2 && s.text === 'Проверка подсказки'), 'подсказка дошла до игрока');
assert(ack.ok && ack.seq > 0, `/llm/hint → seq ${ack.seq}`);
assert((await post('/llm/say', { session: sid, agentId: 'nobody', text: 'x' })).status === 400, 'неизвестный агент — 400');

// ───────── реплей, история, ряды, снимок, память
const replay: LlmStreamMessage[] = [];
const llm2 = await connect((m) => replay.push(m), hello.lastSeq, { autoReply: false });
await until(() => replay.some((m) => m.type === 'event' && m.event.session === sid && m.event.type === 'hint'), 'реплей до подсказки');
const evs = replay.filter((m): m is Extract<LlmStreamMessage, { type: 'event' }> => m.type === 'event');
assert(evs.every((m, i) => i === 0 || m.event.seq > evs[i - 1].event.seq) && evs[0].replay, `реплей с seq>${hello.lastSeq}: ${evs.length} событий по порядку`);
llm2.close();
const hist = await get(`/llm/sessions/${sid}/events?types=agent.ask,agent.say,hint`);
assert(hist.events.some((e: GameEvent) => e.type === 'agent.say' && (e.data as { source?: string }).source === 'llm'), 'история: agent.say от LLM записан');
const act = await get(`/llm/sessions/${sid}/series?metric=activity&bucket=1s`);
assert(act.points.some((p: { values: { distance: number } }) => p.values.distance > 0), `ряд activity: ${act.points.length} окон`);
const snap0 = await get(`/llm/sessions/${sid}/snapshot`);
assert(snap0.crew[0].name === me().name && snap0.levelId === 'hub', 'снимок по REST');
const mem = await get(`/llm/memory/ship_ai/${snap0.crew[0].id}`);
assert((mem.summary ?? '').length > 0 || mem.toldCards.length > 0, `память агента записана LLM: «${(mem.summary ?? '').slice(0, 60)}»`);

// ───────── ручные проверки согласования голосов (только с образцом: внешний сервис ответил бы сам)
if (!EXTERNAL) {
  llm!.close();
  await sleep(200);
  const passive = await connect(undefined, undefined, { autoReply: false }); // LLM «слушает», но молчит
  await sleep(200);

  const askSeq = async () => {
    const n = events(sid, 'agent.ask').length;
    roomA.send('interact', { stationId: 'ship_ai' });
    await until(() => events(sid, 'agent.ask').length > n, 'agent.ask');
    return events(sid, 'agent.ask').at(-1)!;
  };

  // 1) Молчание → заготовка через ASK_TIMEOUT_MS, поздний ответ → 409 late.
  let n = says.length;
  let e = await askSeq();
  assert((e.data as Partial<ReplyableData>).replyable === true, 'agent.ask помечен replyable');
  await sleep(ASK_TIMEOUT_MS - 600);
  assert(says.length === n, 'пока LLM думает — заготовка не звучит');
  await until(() => says.length > n && says.at(-1)!.source === 'script', 'заготовка после таймаута', 1500);
  const late = await post('/llm/say', { session: sid, agentId: 'ship_ai', text: 'Опоздавший ответ', replyTo: e.seq });
  assert(late.status === 409, 'ответ после заготовки — 409 late, игроку не показан');

  // 2) Захват пустым куском → таймер снят → финал доходит, заготовки нет.
  n = says.length;
  e = await askSeq();
  await post('/llm/say', { session: sid, agentId: 'ship_ai', text: '', replyTo: e.seq, streamId: 'claim1' });
  await sleep(ASK_TIMEOUT_MS + 500);
  assert(!says.slice(n).some((s) => s.source === 'script'), 'после захвата заготовка не звучит');
  await post('/llm/say', { session: sid, agentId: 'ship_ai', text: 'Финальный ответ', replyTo: e.seq, streamId: 'claim1', final: true });
  await until(() => says.some((s) => s.text === 'Финальный ответ' && !s.partial), 'финал после захвата');
  assert(true, 'захват: «печатает…» → финал');

  // 3) Отказ: пустой финал → заготовка сразу.
  n = says.length;
  e = await askSeq();
  await post('/llm/say', { session: sid, agentId: 'ship_ai', text: '', replyTo: e.seq, streamId: 'rel1' });
  const t0 = Date.now();
  await post('/llm/say', { session: sid, agentId: 'ship_ai', text: '', replyTo: e.seq, streamId: 'rel1', final: true });
  await until(() => says.slice(n).some((s) => s.source === 'script'), 'заготовка после отказа', 1000);
  assert(Date.now() - t0 < 1000, 'отказ LLM → заготовка без ожидания');

  // 4) Захватила и пропала → через STREAM_DEADLINE_MS поток закрывается накопленным текстом.
  e = await askSeq();
  await post('/llm/say', { session: sid, agentId: 'ship_ai', text: 'Недописанная мысль', replyTo: e.seq, streamId: 'dl1' });
  await until(() => says.some((s) => s.streamId === 'dl1' && !s.partial && s.text === 'Недописанная мысль'), 'закрытие по сроку', STREAM_DEADLINE_MS + 2000);
  assert(true, `поток без финала закрыт сервером через ${STREAM_DEADLINE_MS / 1000} с накопленным текстом`);

  // ───────── головоломка: puzzle.failed отложен, подсказка — текстом партии, один голос
  const roomB = await (await authedClient(url, `llm-b-${tag}`)).joinById(sid, { name: `llm-b-${tag}` }, CrewState);
  roomB.onMessage('*', () => {});
  await sleep(300);
  await useStation(roomA, 'jump');
  await until(() => roomA.state.levelId === 'alexandria' && roomB.state.levelId === 'alexandria', 'прыжок в Александрию');
  await useStation(roomA, 'narrator');
  await until(() => roomA.state.scenario.stepId === 'reach', 'брифинг', ASK_TIMEOUT_MS + 3000);
  await Promise.all([useStation(roomA, 'observer'), useStation(roomB, 'mechanic')]);
  await until(() => !!roomA.state.puzzle.observer && !!roomA.state.puzzle.mechanic, 'роли');

  const failOnce = async () => {
    const k = events(sid, 'puzzle.failed').length;
    roomB.send('puzzle.action', { action: 'arc', value: 0 });
    roomB.send('puzzle.action', { action: 'lock' });
    await until(() => events(sid, 'puzzle.failed').length > k, 'puzzle.failed');
    return events(sid, 'puzzle.failed').at(-1)!;
  };
  n = says.length;
  const f1 = await failOnce();
  const d1 = f1.data as unknown as ReplyableData;
  assert(d1.replyable && d1.agentId === 'ship_ai' && typeof d1.fallback === 'string' && d1.hint === null, 'puzzle.failed №1: replyable, заготовка, подсказки ещё нет');
  await sleep(REACT_TIMEOUT_MS - 700);
  assert(!says.slice(n).some((s) => s.agentId === 'ship_ai' && s.text === d1.fallback), 'реплика ХРОНОСа отложена, пока LLM думает');
  await until(() => says.slice(n).some((s) => s.text === d1.fallback), 'заготовка после REACT_TIMEOUT_MS', 1500);
  assert(true, 'LLM промолчала → прозвучала заготовка ХРОНОСа');

  const hintsBefore = roomA.state.puzzle.hintsGiven;
  n = says.length;
  const f2 = await failOnce();
  const d2 = f2.data as unknown as ReplyableData;
  const snap = await get(`/llm/sessions/${sid}/snapshot`);
  assert(d2.hint?.level === 1 && d2.hint.text === snap.puzzle.hints[0], `puzzle.failed №2 несёт подсказку партии: «${d2.hint?.text.slice(0, 60)}…»`);
  assert(snap.puzzle.hints.length === 3 && snap.puzzle.nextHintLevel === 2, 'снимок: 3 текста подсказок, следующая — уровень 2');
  await post('/llm/hint', { session: sid, level: 1, text: 'Своими словами:', replyTo: f2.seq, streamId: 'h1' });
  await post('/llm/hint', { session: sid, level: 1, text: `Своими словами: ${d2.hint!.text}`, replyTo: f2.seq, streamId: 'h1', final: true });
  await sleep(REACT_TIMEOUT_MS + 800);
  const heard = says.slice(n).filter((s) => s.agentId === 'ship_ai' && !s.partial);
  assert(heard.length === 1 && heard[0].source === 'llm' && heard[0].hint === 1, 'подсказку сказала LLM, заготовка не прозвучала — один голос');
  assert(roomA.state.puzzle.hintsGiven === hintsBefore + 1, 'подсказка засчитана ровно один раз');
  await roomB.leave();
  passive.close();
} else {
  // Настоящий сервис: ошибки на головоломке должны получить реплики LLM в срок.
  const roomB = await (await authedClient(url, `llm-b-${tag}`)).joinById(sid, { name: `llm-b-${tag}` }, CrewState);
  roomB.onMessage('*', () => {});
  await sleep(300);
  await useStation(roomA, 'jump');
  await until(() => roomA.state.levelId === 'alexandria' && roomB.state.levelId === 'alexandria', 'прыжок в Александрию');
  await useStation(roomA, 'narrator');
  await until(() => roomA.state.scenario.stepId === 'reach', 'брифинг', STREAM_DEADLINE_MS);
  await Promise.all([useStation(roomA, 'observer'), useStation(roomB, 'mechanic')]);
  await until(() => !!roomA.state.puzzle.observer && !!roomA.state.puzzle.mechanic, 'роли');
  for (let i = 1; i <= 2; i++) {
    const n = says.length;
    const t0 = Date.now();
    roomB.send('puzzle.action', { action: 'arc', value: 0 });
    roomB.send('puzzle.action', { action: 'lock' });
    await until(() => says.slice(n).some((s) => s.agentId === 'ship_ai' && !s.partial), `реплика на ошибку №${i}`, STREAM_DEADLINE_MS + 2000);
    const finals = says.slice(n).filter((s) => s.agentId === 'ship_ai' && !s.partial);
    await sleep(1500);
    const all = says.slice(n).filter((s) => s.agentId === 'ship_ai' && !s.partial);
    console.log(`    ошибка №${i}: source=${finals[0].source}${finals[0].hint ? ` (подсказка ${finals[0].hint})` : ''}, ${Date.now() - t0 - 1500} мс: «${finals[0].text.slice(0, 90)}»`);
    assert(all.length === 1, `ошибка №${i}: ровно одна реплика ХРОНОСа (без двойного голоса)`);
  }
  await roomB.leave();
}

// ───────── без LLM — заготовка сразу
watcher.close();
if (!EXTERNAL) {
  await sleep(200);
  const target = roomA.state.levelId === 'hub' ? 'ship_ai' : 'narrator';
  await walk(roomA, station(target).x, station(target).y);
  const n = says.length;
  const t0 = Date.now();
  roomA.send('interact', { stationId: target });
  await until(() => says.length > n, 'заготовка');
  assert(says.at(-1)!.source === 'script' && Date.now() - t0 < 1000, 'LLM отключена — заготовка звучит сразу');
}

await roomA.leave();
console.log('\nLLM CONTRACT PASSED');
process.exit(0);
