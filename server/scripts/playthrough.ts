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
} from '@chronolet/shared';
import { litFraction, phaseOf } from '../src/puzzles/galileo.ts';
import { cribCandidates } from '../src/puzzles/enigma.ts';

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

for (const epoch of EPOCHS) {
  console.log(`\n── Эпоха ${epoch.index + 1}: ${epoch.title}`);
  await a.use('jump');
  await until(() => a.room.state.levelId === epoch.levelId && b.room.state.levelId === epoch.levelId, 'прыжок в эпоху');
  assert(true, `прыжок в «${epoch.title}», головоломка «${a.room.state.puzzle.title}»`);

  await a.use('narrator');
  assert(a.says.at(-1)?.speaker === epoch.narrator.name, `${epoch.narrator.name} говорит`);

  await Promise.all([a.use('observer'), b.use('mechanic')]);
  await until(() => a.views.has('observer') && b.views.has('mechanic'), 'виды ролей');
  assert(a.room.state.puzzle.observer === a.room.sessionId && a.room.state.puzzle.mechanic === b.room.sessionId, 'роли заняты');

  const parts = () => a.room.state.parts.length;
  const before = parts();

  switch (epoch.puzzle.id) {
    case 'eratosthenes': {
      const shadow = b.view<EratMechanicView>('mechanic').shadow; // Механик видит тень…
      b.act('arc', shadow);
      b.act('lock');
      await until(() => a.view<EratObserverView>('observer').angleLocked, 'угол зафиксирован');
      const d = a.view<EratObserverView>('observer').distance; // …Наблюдатель знает расстояние
      a.act('answer', (d * 360) / shadow);
      break;
    }
    case 'galileo': {
      b.act('scheme', 'helio');
      for (let night = 0; night < 3; night++) {
        await until(() => a.view<GalileoObserverView>('observer').night === night, `ночь ${night + 1}`);
        const phase = a.view<GalileoObserverView>('observer').phase; // «вижу половину диска»
        const angle = [...Array(360).keys()].find((x) => phaseOf(litFraction('helio', x)) === phase)!;
        b.act('angle', angle);
        b.act('observe');
        await sleep(150);
      }
      break;
    }
    case 'newton': {
      const target = a.view<NewtonObserverView>('observer').target;
      b.act('speed', 10);
      b.act('fire'); // пристрелочный
      await until(() => a.view<NewtonObserverView>('observer').shots.length === 1, 'первый выстрел виден Наблюдателю');
      b.act('angle', 45);
      b.act('speed', Math.sqrt(target * 9.81));
      b.act('fire');
      break;
    }
    case 'enigma': {
      const obs = () => a.view<EnigmaObserverView>('observer');
      for (const pos of cribCandidates(obs().cipher)) {
        a.act('crib', pos);
        await sleep(150);
        if (obs().stage !== 'crib') break;
      }
      await until(() => obs().cribPos !== null, 'crib найден');
      const { cipher, crib, cribPos } = obs();
      for (let r = 0; r < 3; r++) {
        const i = [...crib].map((_, t) => cribPos! + t).find((p) => p % 3 === r)!;
        const shift = (cipher.charCodeAt(i) - crib.charCodeAt(i - cribPos!) + 26) % 26;
        b.act('rotor', { index: r, value: shift });
      }
      b.act('check');
      break;
    }
    case 'korolev': {
      b.act('launch'); // одна ступень — не долетает
      await sleep(150);
      b.act('stage', { index: 0, tanks: 6, engine: 'B' });
      b.act('stage', { index: 1, tanks: 3, engine: 'B' });
      b.act('stage', { index: 2, tanks: 1, engine: 'A' });
      b.act('launch');
      break;
    }
  }

  await until(() => a.room.state.puzzle.solved && parts() === before + 1, 'головоломка решена, деталь выдана');
  assert(a.room.state.parts.at(-1) === epoch.part.id, `деталь «${epoch.part.name}» получена (попыток: ${a.room.state.puzzle.attempts})`);

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

await a.use('jump');
await until(() => a.room.state.finished, 'финал');
assert(b.room.state.finished, 'финал: двигатель починен, курс домой');

assert(!a.everRoles.has('mechanic') && !b.everRoles.has('observer'), 'Наблюдатель ни разу не получил данных Механика и наоборот');

const db = (await (await fetch(`${url}/api/sessions/${a.room.roomId}`)).json()) as { session: { current_epoch: number; parts_json: string } };
assert(db.session.current_epoch === 5 && JSON.parse(db.session.parts_json).length === 5, 'прогресс (5 деталей) сохранён в SQLite');

await a.room.leave();
await b.room.leave();
console.log('\nPLAYTHROUGH PASSED');
process.exit(0);
