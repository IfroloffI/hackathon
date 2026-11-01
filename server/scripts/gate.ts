/**
 * Смоук ворот эпохи против запущенного сервера и answer-classifier:
 * бот прыгает с корабля в Александрию → Эратосфен сам задаёт вопрос → сквозь закрытые ворота
 * не пройти → неверный ответ в чат: «Нет», ворота закрыты → верный: «Да», ворота открыты,
 * сценарий перешёл к брифингу → за ворота пройти можно.
 *   npm run gate -w server
 *   (HTTPS с dev-сертификатом: NODE_TLS_REJECT_UNAUTHORIZED=0 SERVER_URL=https://127.0.0.1:2567 npm run gate -w server)
 */
import { authedClient } from './auth.ts';
import { ClientMsg, CREW_ROOM, CrewState, getLevel, HUB_LEVEL, SERVER_PORT, ServerMsg } from '@chronolet/shared';

const url = process.env.SERVER_URL ?? `http://127.0.0.1:${SERVER_PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (cond: unknown, msg: string) => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const suffix = Math.random().toString(36).slice(2, 6);
const client = await authedClient(url, `gate-${suffix}`);
const room = await client.create(CREW_ROOM, { name: `gate-${suffix}`, crewName: 'Gate' }, CrewState);
const says: { speaker: string; text: string }[] = [];
room.onMessage(ServerMsg.Say, (m: { speaker: string; text: string }) => says.push(m));
room.onMessage(ServerMsg.System, (m: { text: string }) => says.push({ speaker: 'system', text: m.text }));
room.onMessage('*', () => {});
await sleep(500);

const me = () => room.state.players.get(room.sessionId)!;
const level = () => getLevel(room.state.levelId);
/** Идём к x шагами, которые сервер принимает (скорость ≤ runSpeed). */
async function walkTo(x: number) {
  for (let i = 0; i < 200; i++) {
    const p = me();
    if (Math.abs(p.x - x) < 0.05) return;
    const nx = p.x + Math.sign(x - p.x) * Math.min(0.25, Math.abs(x - p.x));
    room.send(ClientMsg.Move, { levelId: room.state.levelId, x: nx, y: 0, z: 0, vx: 6 * Math.sign(x - p.x), vy: 0, anim: 'run', facing: x > p.x ? 1 : -1 });
    await sleep(50);
  }
}
const waitSay = async (speaker: string, ms = 6000) => {
  for (let t = 0; t < ms; t += 50) {
    const s = says.find((m) => m.speaker === speaker);
    if (s) return s;
    await sleep(50);
  }
  return null;
};

// На корабле — к рычагу прыжка.
const lever = HUB_LEVEL.stations.find((s) => s.kind === 'jump')!;
await walkTo(lever.x);
says.length = 0;
room.send(ClientMsg.Interact, { stationId: lever.id });
for (let i = 0; i < 40 && room.state.levelId !== 'alexandria'; i++) await sleep(50);
check(room.state.levelId === 'alexandria', 'прыжок: экипаж в Александрии');
check(room.state.scenario.stepId === 'gate', `первый шаг сценария — ворота (${room.state.scenario.goal})`);

const q = await waitSay('Эратосфен');
check(q, `Эратосфен сам задал вопрос: «${q?.text ?? '—'}»`);

const gate = level().gate!;
await walkTo(gate.x + 3);
check(me().x < gate.x - 0.4, `закрытые ворота (x=${gate.x}) не пускают: игрок остановлен на x=${me().x.toFixed(2)}`);

const answer = async (text: string) => {
  says.length = 0;
  room.send(ClientMsg.Chat, { text });
  return await waitSay('Эратосфен', 3000);
};
const no = await answer('Наполеон');
check(no?.text.startsWith('Нет'), `«Наполеон» (без @) → ${no?.text ?? 'нет ответа'}`);
check(!room.state.gatesOpen.includes('alexandria'), 'после неверного ответа ворота закрыты');

const yes = await answer('наверное, Архимед');
check(yes?.text.startsWith('Да'), `«наверное, Архимед» → ${yes?.text ?? 'нет ответа'}`);
await sleep(200);
check(room.state.gatesOpen.includes('alexandria'), 'после верного ответа ворота открыты');
check(room.state.scenario.stepId === 'briefing', `сценарий перешёл к брифингу (${room.state.scenario.goal})`);

says.length = 0;
room.send(ClientMsg.Chat, { text: 'привет всем' });
await sleep(800);
check(!says.some((m) => m.speaker === 'Эратосфен'), 'ворота открыты — обычный чат Эратосфен больше не судит');

await walkTo(gate.x + 3);
check(me().x > gate.x + 2.5, `за ворота можно пройти: x=${me().x.toFixed(2)}`);

await room.leave();
if (failed) {
  console.error(`\nFAIL: ${failed} проверок не прошли`);
  process.exit(1);
}
console.log('\nВорота работают');
process.exit(0);
