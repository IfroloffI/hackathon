/**
 * Смоук панели администратора против запущенного сервера:
 * хост и гость шлют client.stats/ping → хост получает сводку со всеми клиентами,
 * гостю панель недоступна, настройки и команды применяются.
 *   npm run admin-smoke -w server
 */
import { authedClient } from './auth.ts';
import { AdminMsg, AdminServerMsg, CREW_ROOM, CrewState, SERVER_PORT, type AdminResult, type AdminSettings, type AdminStatsPayload } from '@chronolet/shared';

const url = process.env.SERVER_URL ?? `http://127.0.0.1:${SERVER_PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok  ${msg}`);
};

const suffix = Math.random().toString(36).slice(2, 6);
const host = await authedClient(url, `host-${suffix}`);
const guest = await authedClient(url, `guest-${suffix}`);
const roomA = await host.create(CREW_ROOM, { name: `host-${suffix}`, crewName: 'AdminSmoke' }, CrewState);
const roomB = await guest.joinById(roomA.roomId, { name: `guest-${suffix}` }, CrewState);
for (const r of [roomA, roomB]) r.onMessage('*', () => {});
await sleep(200);
assert(roomB.state.host === `host-${suffix}`, 'state.host — имя хоста');

// Пинг: эхо с тем же t.
const pong = new Promise<number>((res) => roomB.onMessage(AdminServerMsg.Pong, (m: { t: number }) => res(m.t)));
roomB.send(AdminMsg.Ping, { t: 12345 });
assert((await pong) === 12345, 'pong возвращает t');

const report = (r: typeof roomA, fps: number, ping: number) => r.send(AdminMsg.ClientStats, { fps, ping, frameMaxMs: 20, hidden: false, viewport: '1x1' });
report(roomA, 60, 5);
report(roomB, 31, 120);

// Гостю — отказ.
const denied = new Promise<AdminResult>((res) => roomB.onMessage(AdminServerMsg.Result, res));
roomB.send(AdminMsg.Subscribe, { on: true });
assert(!(await denied).ok, 'гостю панель недоступна');

let stats: AdminStatsPayload | null = null;
let settings: AdminSettings | null = null;
roomA.onMessage(AdminServerMsg.Stats, (s: AdminStatsPayload) => (stats = s));
roomA.onMessage(AdminServerMsg.Settings, (s: AdminSettings) => (settings = s));
roomA.send(AdminMsg.Subscribe, { on: true });
await sleep(1300);
const s = stats as AdminStatsPayload | null;
assert(s && s.clients.length === 2, 'в сводке оба клиента');
const g = s!.clients.find((c) => c.name === `guest-${suffix}`)!;
assert(g.fps === 31 && g.ping === 120, `FPS/ping гостя: ${g.fps}/${g.ping}`);
assert(s!.summary.pingMax === 120 && s!.summary.fpsMin === 31, 'итоги: макс. ping и мин. FPS');
console.log('   ', JSON.stringify(s!.summary), JSON.stringify(s!.server));

roomA.send(AdminMsg.Settings, { mainNpcActivity: 80, secondaryNpcActivity: 10, agents: { galileo: { muted: true, behavior: 'говори стихами' } } });
await sleep(200);
const st = settings as AdminSettings | null;
assert(st?.mainNpcActivity === 80 && st.secondaryNpcActivity === 10, 'ползунки NPC сохранены');
assert(st?.agents.galileo?.muted && st.agents.galileo.behavior === 'говори стихами', 'поведение агента сохранено');

const result = () => new Promise<AdminResult>((res) => roomA.onMessage(AdminServerMsg.Result, res));
let r = result();
roomA.send(AdminMsg.Command, { type: 'rename', crewName: 'Новое имя' });
assert((await r).ok, 'переименование');
await sleep(150);
assert(roomB.state.crewName === 'Новое имя', 'гость видит новое имя');
r = result();
roomA.send(AdminMsg.Command, { type: 'goto', level: 2 });
assert((await r).ok, 'перенос в эпоху 3');
await sleep(150);
assert(roomB.state.epoch === 2 && roomB.state.parts.length === 2, 'эпоха и детали у гостя');

await roomA.leave();
await roomB.leave();
console.log('admin smoke: OK');
process.exit(0);
