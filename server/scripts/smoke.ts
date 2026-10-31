/**
 * Смоук-тест мультиплеера против запущенного сервера (npm run dev / npm start):
 * A создаёт комнату → B входит по коду → движения A видны B → позиция A в БД →
 * A перезаходит и появляется там же.
 *   npm run smoke -w server
 */
import { Client, Callbacks } from '@colyseus/sdk';
import { authedClient } from './auth.ts';
import { CREW_ROOM, CrewState, PERSIST_INTERVAL_MS, SERVER_PORT } from '@chronolet/shared';

const url = process.env.SERVER_URL ?? `http://127.0.0.1:${SERVER_PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok  ${msg}`);
};

const suffix = Math.random().toString(36).slice(2, 6);
const a = await authedClient(url, `alice-${suffix}`);
const b = await authedClient(url, `bob-${suffix}`);

// Авторизация: без токена — в комнату нельзя, неверный пароль и чужой логин — отказ.
const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
assert((await post('/auth/login', { name: `alice-${suffix}`, password: 'неверный-пароль' })).status === 401, 'неверный пароль — 401');
assert((await post('/auth/register', { name: `alice-${suffix}`, password: 'другой-пароль' })).status === 409, 'занятый логин не зарегистрировать — 409');
assert((await post('/auth/register', { name: 'ab', password: 'пароль-ок' })).status === 400, 'короткий логин — 400');
assert((await post('/auth/register', { name: `x-${suffix}`, password: '123' })).status === 400, 'короткий пароль — 400');

const roomA = await a.create(CREW_ROOM, { name: `alice-${suffix}`, crewName: 'Smoke' }, CrewState);
const quiet = (r: { onMessage: (t: '*', cb: () => void) => unknown }) => r.onMessage('*', () => {});
quiet(roomA);
assert(/^[A-Z2-9]{4}$/.test(roomA.roomId), `комната создана, код ${roomA.roomId}`);

const listed = (await (await fetch(`${url}/api/rooms`)).json()) as { roomId: string }[];
assert(listed.some((r) => r.roomId === roomA.roomId), 'комната видна в /api/rooms');

const roomB = await b.joinById(roomA.roomId, { name: `bob-${suffix}` }, CrewState);
quiet(roomB);
await sleep(200);
assert(roomB.state.players.size === 2 && roomA.state.players.size === 2, 'оба игрока в state у обоих');
let anonRejected = false;
try {
  await new Client(url).joinById(roomA.roomId, { name: `anon-${suffix}` });
} catch {
  anonRejected = true;
}
assert(anonRejected, 'без токена в комнату не пускает');
const spoof = await (await authedClient(url, `eve-${suffix}`)).joinById(roomA.roomId, { name: `alice-${suffix}-fake` }, CrewState);
await sleep(200);
assert(spoof.state.players.get(spoof.sessionId)!.name === `eve-${suffix}`, 'имя в комнате — из токена, а не из параметров');
await spoof.leave();

let dupRejected = false;
try {
  await (await authedClient(url, `bob-${suffix}`)).joinById(roomA.roomId, { name: `bob-${suffix}` });
} catch {
  dupRejected = true;
}
assert(dupRejected, 'дубликат имени в комнате отклонён');

const base = roomA.state.players.get(roomA.sessionId)!.x;
let seenByB = 0;
Callbacks.get(roomB).onChange(roomB.state.players.get(roomA.sessionId)!, () => seenByB++);

// A бежит вправо 1 с: 20 пакетов, по 0.3 за пакет (= runSpeed 6 * 0.05 с)
for (let i = 1; i <= 20; i++) {
  roomA.send('move', { levelId: 'hub', x: base + i * 0.3, y: 0, z: 0, vx: 6, vy: 0, anim: 'run', facing: 1 });
  await sleep(50);
}
await sleep(200);
const aAtB = roomB.state.players.get(roomA.sessionId)!;
assert(seenByB > 5, `B получил ${seenByB} обновлений позиции A`);
assert(Math.abs(aAtB.x - (base + 6)) < 0.5 && aAtB.anim === 'run', `B видит A на x=${aAtB.x.toFixed(2)}`);

// Телепорт должен быть отсечён сервером
roomA.send('move', { levelId: 'hub', x: base + 25, y: 0, z: 0, vx: 0, vy: 0, anim: 'idle', facing: 1 });
await sleep(200);
assert(aAtB.x < base + 8.5, `телепорт отсечён лимитом скорости (x=${aAtB.x.toFixed(2)})`);

await sleep(PERSIST_INTERVAL_MS + 500);
const db = (await (await fetch(`${url}/api/sessions/${roomA.roomId}`)).json()) as {
  players: { name: string; x: number }[];
};
const aRow = db.players.find((p) => p.name === `alice-${suffix}`);
assert(aRow && Math.abs(aRow.x - aAtB.x) < 0.01, `позиция A сохранена в SQLite (x=${aRow?.x.toFixed(2)})`);

const savedX = aAtB.x;
await roomA.leave();
await sleep(300);
assert(roomB.state.players.size === 1, 'после выхода A у B остался один игрок');

const roomA2 = await (await authedClient(url, `alice-${suffix}`)).joinById(roomA.roomId, { name: `alice-${suffix}` }, CrewState);
quiet(roomA2);
await sleep(200);
const restored = roomA2.state.players.get(roomA2.sessionId)!;
assert(Math.abs(restored.x - savedX) < 0.01, `A вернулся на сохранённую позицию x=${restored.x.toFixed(2)}`);

await roomA2.leave();
await roomB.leave();
console.log('\nSMOKE PASSED');
process.exit(0);
