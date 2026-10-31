/**
 * Полное прохождение двумя ботами против запущенного сервера: корабль → 5 эпох → финал.
 * Каждый бот видит только данные своей роли; «разговор» — это передача увиденного между ботами,
 * как игроки делали бы голосом. Заодно проверяет: асимметрию данных, «все на борт», выдачу деталей.
 *   npm run playthrough -w server
 */
import { Client, type Room } from '@colyseus/sdk';
import {
  CREW_ROOM,
  CrewState,
  EPOCHS,
  SERVER_PORT,
  getLevel,
  type EnigmaObserverView,
  type EratMechanicView,
  type EratObserverView,
  type GalileoObserverView,
  type NewtonObserverView,
  type PuzzleViewMessage,
  type Role,
  type SayPayload,
  type ShopResult,
} from '@chronolet/shared';
import { solve } from './solvers.ts';

const url = process.env.SERVER_URL ?? `http://127.0.0.1:${SERVER_PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok  ${msg}`);
};
async function until(cond: () => boolean, what: string | (() => string), ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`FAIL: не дождались: ${typeof what === 'function' ? what() : what}`);
    await sleep(30);
  }
}

class Bot {
  views = new Map<Role, unknown>();
  says: SayPayload[] = [];
  shop: ShopResult[] = [];
  /** Все виды, когда-либо полученные, — для проверки асимметрии. */
  everRoles = new Set<Role>();
  constructor(public room: Room<any, CrewState>) {
    room.onMessage('*', () => {});
    room.onMessage('puzzle.view', (m: PuzzleViewMessage) => {
      if (m.role) {
        this.views.set(m.role, m.view);
        this.everRoles.add(m.role);
      } else this.views.clear();
    });
    room.onMessage('say', (m: SayPayload) => this.says.push(m));
    room.onMessage('shop', (m: ShopResult) => this.shop.push(m));
  }
  get me() {
    return this.room.state.players.get(this.room.sessionId)!;
  }
  view<T>(role: Role) {
    return this.views.get(role) as T;
  }
  /** Идём к точке с честной скоростью (сервер режет телепорты). */
  async walkTo(x: number, y: number) {
    const levelId = this.room.state.levelId;
    let { x: cx, y: cy } = this.me;
    while (Math.abs(cx - x) > 0.05 || Math.abs(cy - y) > 0.05) {
      cx += Math.max(-0.28, Math.min(0.28, x - cx));
      cy += Math.max(-0.6, Math.min(0.6, y - cy));
      this.room.send('move', { levelId, x: cx, y: cy, z: 0, vx: 0, vy: 0, anim: 'run', facing: 1 });
      await sleep(50);
    }
    await until(() => Math.abs(this.me.x - x) < 0.3 && Math.abs(this.me.y - y) < 0.3, `дошёл до ${x},${y}`);
  }
  async use(stationId: string) {
    const st = getLevel(this.room.state.levelId).stations.find((s) => s.id === stationId)!;
    await this.walkTo(st.x, st.y);
    this.room.send('interact', { stationId });
    await sleep(150);
  }
  /** Пройти через все сферы уровня (сервер засчитывает касание по своей копии позиции). */
  async collectAll() {
    for (const c of getLevel(this.room.state.levelId).coins) {
      await this.walkTo(c.x, Math.max(0, c.y - 0.6));
      await until(() => this.room.state.coinsTaken.includes(c.id), `сфера ${c.id}`);
    }
  }
  async shopReply(send: () => void) {
    const n = this.shop.length;
    send();
    await until(() => this.shop.length > n, 'ответ магазина');
    return this.shop.at(-1)!;
  }
  act(action: string, value?: unknown) {
    this.room.send('puzzle.action', { action, value });
  }
}

const tag = Math.random().toString(36).slice(2, 6);
const a = new Bot(await new Client(url).create(CREW_ROOM, { name: `obs-${tag}`, crewName: 'Playthrough' }, CrewState));
const b = new Bot(await new Client(url).joinById(a.room.roomId, { name: `mech-${tag}` }, CrewState));
console.log(`комната ${a.room.roomId}`);
await sleep(200);

await a.use('ship_ai');
assert(a.says.some((s) => s.agentId === 'ship_ai'), 'ХРОНОС отвечает у пульта');

const far = await a.shopReply(() => a.room.send('shop.buy', { skinId: 'vk' }));
assert(!far.ok, `магазин вдали от терминала не работает: «${far.text}»`);
const coins0 = a.me.coins;
await a.collectAll();
assert(a.me.coins === coins0 + getLevel('hub').coins.length, `на борту собраны все сферы (${a.me.coins} VK Coin)`);
await b.walkTo(getLevel('hub').coins[0].x, getLevel('hub').coins[0].y - 0.6);
await sleep(200);
assert(b.me.coins === 0, 'собранная сфера второй раз не даётся');

for (const epoch of EPOCHS) {
  console.log(`\n── Эпоха ${epoch.index + 1}: ${epoch.title}`);
  await a.use('jump');
  await until(() => a.room.state.levelId === epoch.levelId && b.room.state.levelId === epoch.levelId, 'прыжок в эпоху');
  assert(true, `прыжок в «${epoch.title}», головоломка «${a.room.state.puzzle.title}»`);

  if (epoch.index === 0) {
    // Яма между Сиеной и Александрией (x 3..6): падение возвращает к чекпоинту x=-9.8, а не на старт.
    await a.walkTo(4.5, 0);
    a.room.send('move', { levelId: epoch.levelId, x: 4.5, y: -6, z: 0, vx: 0, vy: -20, anim: 'fall', facing: 1 });
    await until(() => Math.abs(a.me.x - -9.8) < 0.01 && a.me.y === 0, () => `респаун у чекпоинта (x=${a.me.x}, y=${a.me.y})`);
    assert(true, 'падение в яму → сервер возвращает к ближайшему чекпоинту');
  }
  // Роли закрыты до брифинга.
  await b.use('mechanic');
  assert(a.room.state.puzzle.mechanic === '' && a.room.state.scenario.stepId === 'briefing', 'до брифинга роли закрыты');
  const saysBeforeTalk = a.says.length;
  await a.use('narrator');
  await until(() => a.says.slice(saysBeforeTalk).some((s) => s.speaker === epoch.narrator.name), 'реплика рассказчика');
  assert(true, `${epoch.narrator.name} говорит`);
  await until(() => a.room.state.scenario.stepId === 'reach', 'шаг «к местам ролей»');

  await Promise.all([a.use('observer'), b.use('mechanic')]);
  await until(() => a.views.has('observer') && b.views.has('mechanic'), 'виды ролей');
  assert(a.room.state.puzzle.observer === a.room.sessionId && a.room.state.puzzle.mechanic === b.room.sessionId, 'роли заняты');
  await until(() => a.room.state.scenario.stepId === 'stage1', 'шаг «этап 1»');

  const parts = () => a.room.state.parts.length;
  const before = parts();

  await solve(epoch.puzzle.id, a, b, () => a.room.state.puzzle.solved);

  await until(() => a.room.state.puzzle.solved && parts() === before + 1, 'головоломка решена, деталь выдана');
  await a.collectAll();
  assert(true, `сферы эпохи собраны, у A ${a.me.coins} VK Coin`);
  assert(a.room.state.parts.at(-1) === epoch.part.id, `деталь «${epoch.part.name}» получена (попыток: ${a.room.state.puzzle.attempts})`);
  await until(() => a.room.state.scenario.stepId === 'extract', 'шаг «эвакуация»');

  if (epoch.index === 0) {
    // Без Механика у корабля улететь нельзя.
    const saysBefore = a.says.length;
    await a.use('return');
    await until(() => a.says.length > saysBefore, 'ответ ХРОНОСа');
    assert(a.room.state.levelId === epoch.levelId && /Не на борту/.test(a.says.at(-1)!.text), '«все на борт»: без второго игрока не улетаем');
  }
  await Promise.all([a.walkTo(-23, 0), b.walkTo(-22, 0)]);
  await a.use('return');
  await until(
    () => a.room.state.levelId === 'hub',
    () => `возврат на корабль (игроки: ${[...a.room.state.players.values()].map((p) => p.name).join(', ')}; ХРОНОС: «${a.says.at(-1)?.text}»)`,
  );
  assert(true, `вернулись на корабль, деталей: ${parts()}/5`);
}

// Магазин на борту.
const shopSt = getLevel('hub').stations.find((s) => s.kind === 'shop')!;
const c = new Bot(await new Client(url).joinById(a.room.roomId, { name: `poor-${tag}` }, CrewState));
await sleep(200);
await Promise.all([a.walkTo(shopSt.x, 0), b.walkTo(shopSt.x + 0.5, 0), c.walkTo(shopSt.x - 0.5, 0)]);
const poor = await c.shopReply(() => c.room.send('shop.buy', { skinId: 'spotty' }));
assert(!poor.ok && c.me.skin === 'default', `без монет не купить: «${poor.text}»`);
await c.room.leave();
const before = a.me.coins;
const bought = await a.shopReply(() => a.room.send('shop.buy', { skinId: 'spotty' }));
await until(() => a.me.skin === 'spotty', 'скин надет');
assert(bought.ok && a.me.owned.includes('spotty') && a.me.coins <= before - 40 + 1, `куплен маскот Спотти за 40, осталось ${a.me.coins}`);
assert(b.room.state.players.get(a.room.sessionId)!.skin === 'spotty', 'второй игрок видит новый скин');
const again = await a.shopReply(() => a.room.send('shop.buy', { skinId: 'spotty' }));
assert(!again.ok, 'повторно не купить');
const eq = await a.shopReply(() => a.room.send('shop.equip', { skinId: 'default' }));
await until(() => a.me.skin === 'default', 'переодет');
assert(eq.ok, 'можно снова надеть стандартный');
await a.shopReply(() => a.room.send('shop.equip', { skinId: 'spotty' }));

await a.use('jump');
await until(() => a.room.state.finished, 'финал');
assert(b.room.state.finished, 'финал: двигатель починен, курс домой');

assert(!a.everRoles.has('mechanic') && !b.everRoles.has('observer'), 'Наблюдатель ни разу не получил данных Механика и наоборот');
for (const id of ['first_coin', 'observer', 'first_part', 'home', 'fashion']) assert(a.me.achievements.includes(id), `ачивка ${id} у A`);
assert(b.me.achievements.includes('mechanic'), 'ачивка mechanic у B');
assert(a.me.xp > 500 && b.me.xp > 300, `XP: A=${a.me.xp}, B=${b.me.xp}`);
const health = (await (await fetch(`${url}/api/health`)).json()) as { series: { events: number; telemetry: number } };
assert(health.series.events > 100 && health.series.telemetry > 100, `временные ряды DuckDB: ${health.series.events} событий, ${health.series.telemetry} точек телеметрии`);

const db = (await (await fetch(`${url}/api/sessions/${a.room.roomId}`)).json()) as { session: { current_epoch: number; parts_json: string } };
assert(db.session.current_epoch === 5 && JSON.parse(db.session.parts_json).length === 5, 'прогресс (5 деталей) сохранён в SQLite');

const coinsLeft = a.me.coins;
await a.room.leave();
await b.room.leave();

// Кошелёк и скины живут между сессиями.
const again2 = new Bot(await new Client(url).create(CREW_ROOM, { name: `obs-${tag}` }, CrewState));
await sleep(300);
assert(again2.me.coins === coinsLeft && again2.me.skin === 'spotty' && again2.me.owned.includes('spotty'), `после перезахода: ${again2.me.coins} VK Coin, скин ${again2.me.skin}`);
await again2.room.leave();
console.log('\nPLAYTHROUGH PASSED');
process.exit(0);
