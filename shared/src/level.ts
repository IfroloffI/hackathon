import type { ArrowTrap, CrateDef, FanDef } from './mechanics.ts';

/**
 * Описание уровней, общее для клиента (рендер + физика) и сервера (валидация, станции).
 * Позже переедет в levels/*.json — по эпохе на файл.
 */

/** Как клиент рисует твёрдый объект. Коллизия всегда коробкой w×h×d. */
export type PlatformLook =
  | 'box'
  | 'floor'
  | 'wall'
  | 'engine'
  | 'engineCore'
  | 'console'
  | 'obelisk'
  | 'well'
  | 'rocket'
  | 'tower'
  | 'hut'
  | 'tree'
  | 'cannon'
  | 'table'
  // Интерактивные объекты (пока только вид, механика — позже; клиент: worlds/props.ts).
  | 'crate'
  | 'rope'
  | 'trampoline'
  | 'fan'
  | 'arrows'
  | 'moat'
  // Ворота у входа в эпоху: твёрдые, пока NPC не принял ответ на вопрос (см. withGate).
  | 'gate';

export interface Platform {
  /** Центр и размеры. Без z/d объект занимает всю глубину дорожки (стены, пол). */
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  d?: number;
  color: number;
  kind?: PlatformLook;
  /** Твёрдая декорация, а не ступенька: не участвует в проверке «достижимости» прыжком. */
  decor?: true;
  /** Не твёрдый (вода рва): физика сквозь него проходит, рисуется как обычно. */
  ghost?: true;
}

/** Точка взаимодействия (клавиша E). Сервер проверяет, что игрок рядом. */
export type StationKind = 'jump' | 'return' | 'observer' | 'mechanic' | 'narrator' | 'shop' | 'reward' | 'reset';

export interface Station {
  id: string;
  kind: StationKind;
  x: number;
  /** Уровень пола у станции — чтобы нельзя было «нажать» станцию с платформы над ней. */
  y: number;
  /** Глубина станции: как у пола дорожки (0) или в ветке вглубь (отрицательный z). */
  z?: number;
  label: string;
  /** Для narrator — id агента (рассказчик эпохи или бортовой ИИ). */
  agent?: string;
  /** reward — сколько VK Coin получает каждый игрок (один раз за сессию). */
  reward?: number;
  /** reset — какие ящики вернуть на место (если завели их в тупик). */
  crates?: string[];
}

export const STATION_RADIUS = 1.6;

export function isNearStation(s: Station, p: { x: number; y: number; z?: number }): boolean {
  return (
    Math.abs(p.x - s.x) <= STATION_RADIUS &&
    Math.abs(p.y - s.y) <= 1.6 &&
    Math.abs((p.z ?? 0) - (s.z ?? 0)) <= STATION_RADIUS
  );
}

/** Сфера VK Coin. id уникален на всю игру — собранная монета не возвращается до конца сессии. */
export interface Coin {
  id: string;
  x: number;
  /** Высота центра сферы. */
  y: number;
  z?: number;
}

export interface Level {
  id: string;
  title: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number };
  spawn: { x: number; y: number; z: number };
  platforms: Platform[];
  stations: Station[];
  coins: Coin[];
  /** Куда возвращает после падения в яму: ближайшая точка слева от места падения (иначе spawn). */
  checkpoints: { x: number; y: number }[];
  /** Полоса препятствий (shared/src/mechanics.ts): толкаемые ящики, вентиляторы, ловушки со стрелами. */
  crates?: CrateDef[];
  fans?: FanDef[];
  arrows?: ArrowTrap[];
  /** Ворота у входа: закрыты, пока экипаж не ответит NPC `agent` на его вопрос (answer-classifier). */
  gate?: GateDef;
}

export interface GateDef {
  /** Центр створки по x — сразу справа от NPC, до первого препятствия. */
  x: number;
  /** Кто задаёт вопрос и чья модель решает (id агента, он же npc_id классификатора). */
  agent: string;
}

/** Створка ворот: на всю глубину дорожки, выше прыжка (~2.4) — не перепрыгнуть и не обойти. */
export const GATE_SIZE = { w: 0.8, h: 5 } as const;

const gatePlatforms = new WeakMap<GateDef, Platform>();
/** Твёрдая створка закрытых ворот (один объект на ворота — физика кэширует его границы). */
export function gatePlatform(g: GateDef): Platform {
  let p = gatePlatforms.get(g);
  if (!p) gatePlatforms.set(g, (p = { x: g.x, y: GATE_SIZE.h / 2, w: GATE_SIZE.w, h: GATE_SIZE.h, color: 0x8a5a2b, kind: 'gate' }));
  return p;
}

/** Уровень для физики: закрытые ворота — ещё одна твёрдая стена; открытые — как будто их нет. */
export function withGate(level: Level, open: boolean): Level {
  if (!level.gate || open) return level;
  return { ...level, platforms: [...level.platforms, gatePlatform(level.gate)] };
}

/** Правее какого x игрок не может стоять, пока ворота закрыты (сервер режет телепорты сквозь створку). */
export function gateBlockX(g: GateDef, playerHalfWidth: number): number {
  return g.x - GATE_SIZE.w / 2 - playerHalfWidth;
}

export const COIN_PICKUP_RADIUS = 0.9;

/** Подбирает ли тело (x/z — центр, y — ступни) монету. Общая проверка для сервера и тестов. */
export function touchesCoin(p: { x: number; y: number; z: number }, c: Coin): boolean {
  const cy = p.y + 0.6; // центр тела
  return Math.hypot(p.x - c.x, cy - c.y) <= COIN_PICKUP_RADIUS && Math.abs(p.z - (c.z ?? 0)) <= 1.3;
}

/** Точка возрождения после падения: ближайший чекпоинт не правее места падения. */
export function respawnPoint(level: Level, fellAtX: number): { x: number; y: number; z: number } {
  let best: { x: number; y: number } | null = null;
  for (const c of level.checkpoints) if (c.x <= fellAtX + 0.01 && (!best || c.x > best.x)) best = c;
  return best ? { x: best.x, y: best.y, z: 0 } : { ...level.spawn };
}

/**
 * Дорожка ширины 3 (z −1.5…1.5, ширина не растёт); вглубь (до −6.5) — ветки-тропы,
 * которые уровень открывает своими платформами с явными z/d.
 */
const LANE = { minZ: -6.5, maxZ: 1.5, minY: -5 };
/** Глубина объектов дорожки: перекрывает всю полосу ±1.5 с запасом, но не строит стен в ветках. */
const LANE_D = 3.2;
/** Эпоха — длинная полоса: старт с кораблём слева, роль на полпути, вторая роль в конце (~5 минут на экипаж). */
const EPOCH_BOUNDS = { minX: -30, maxX: 100, ...LANE };
const EPOCH_SPAWN = { x: -21, y: 0, z: 0 };
const returnStation: Station = { id: 'return', kind: 'return', x: -24, y: 0, label: 'Колизиум: вернуться на борт' };

/** Кусок пола от x0 до x1 (верх y=0). Между кусками — ямы: упал — вернулся к чекпоинту. */
const ground = (x0: number, x1: number, color: number): Platform => ({ x: (x0 + x1) / 2, y: -0.5, w: x1 - x0, h: 1, color, kind: 'floor' });
/** Сплошной блок от пола до top (ступень, ящик, холм). Занимает дорожку, но не бесконечную глубину. */
const block = (x: number, w: number, top: number, color: number, extra: Partial<Platform> = {}): Platform =>
  ({ x, y: top / 2, w, h: top, z: 0, d: LANE_D, color, ...extra });
/** Блок от x0 до x1 высотой top — удобнее для крыш и стен. */
const span = (x0: number, x1: number, top: number, color: number): Platform => block((x0 + x1) / 2, x1 - x0, top, color);
/** Тонкая парящая платформа с верхом top. */
const ledge = (x: number, w: number, top: number, color: number, extra: Partial<Platform> = {}): Platform =>
  ({ x, y: top - 0.15, w, h: 0.3, z: 0, d: LANE_D, color, ...extra });
/** Платформа только в дальнем ряду: встать можно, лишь уйдя вглубь (W). */
const backLedge = (x: number, w: number, top: number, color: number, extra: Partial<Platform> = {}): Platform =>
  ledge(x, w, top, color, { z: -1, d: 1, ...extra });
/** Бортик-укрытие от ветра на краю платформы: верх top+h. */
const parapet = (x: number, top: number, color: number, h = 1): Platform =>
  ({ x, y: top + h / 2, w: 0.6, h, z: 0, d: LANE_D, color });
/** Ветка вглубь: пол-грунт на глубине z (центр), шириной d (по умолчанию 3 — как дорожка). */
const backFloor = (x0: number, x1: number, top: number, z: number, color: number, d = 3): Platform =>
  ({ x: (x0 + x1) / 2, y: top - 0.5, w: x1 - x0, h: 1, z, d, color, kind: 'floor' });
/** Ступенька в ветке вглубь: парящая платформа с центром z. */
const backStep = (x: number, w: number, top: number, z: number, color: number, d = 3): Platform =>
  ({ x, y: top - 0.15, w, h: 0.3, z, d, color });
/** Блок-укрытие/декорация в ветке вглубь. */
const backBlock = (x: number, w: number, top: number, z: number, color: number, d = 3): Platform =>
  block(x, w, top, color, { z, d });
/** Высокая стена, перекрывающая часть глубины: обходится по W/S. side: 'front' — у камеры, 'back' — у фона. */
const depthWall = (x: number, side: 'front' | 'back', color: number): Platform => ({
  x, y: 1.6, w: 0.5, h: 3.2, z: side === 'front' ? 0.65 : -0.65, d: 1.7, color, kind: 'wall', decor: true,
});
/** Батут на опоре base (верх батута — base+1): подбрасывает на ~5. */
const trampoline = (x: number, base = 0): Platform => ({ x, y: base + 0.5, w: 1.8, h: 1, z: 0, d: 1.8, color: 0xff4fa3, kind: 'trampoline' });
/** Ров от x0 до x1: вода (не твёрдая, окунулся — к чекпоинту), под ней дно на глубине floor (для ящиков). */
const moat = (x0: number, x1: number, color = 0x2fb8d0, top = -0.35, floor?: number): Platform[] => [
  { x: (x0 + x1) / 2, y: top - 0.1, w: x1 - x0, h: 0.2, color, kind: 'moat', ghost: true, decor: true },
  ...(floor === undefined ? [] : [{ x: (x0 + x1) / 2, y: floor - 0.5, w: x1 - x0, h: 1, color: 0x4a5a6a, decor: true } as Platform]),
];
const crate = (id: string, x: number, solve: [number, number], y = 0, s = 1.2, color?: number): CrateDef => ({ id, x, y, s, solve: { x: solve[0], y: solve[1] }, ...(color === undefined ? {} : { color }) });
const coins = (levelId: string, list: [number, number, number?][]): Coin[] =>
  list.map(([x, y, z], i) => ({ id: `${levelId}-${i + 1}`, x, y, ...(z === undefined ? {} : { z }) }));

// ───────────── Борт: палуба + паркур-отсек справа (за дверью в переборке). Награда в конце — VK Coin каждому.
const DECK = 0x4a5a9a;
const GYM = 0x5a4a8a;
export const HUB_LEVEL: Level = {
  id: 'hub',
  title: 'Колизиум — борт корабля',
  bounds: { minX: -15, maxX: 62, ...LANE },
  spawn: { x: -4, y: 0, z: 0 },
  platforms: [
    { ...ground(-16, 28, DECK) },
    { x: -15.6, y: 4, w: 1.2, h: 9, color: 0x2a3460, kind: 'wall', decor: true },
    // Переборка с проёмом в паркур-отсек: под ней проходят (низ на 3).
    { x: 15.6, y: 6, w: 1.2, h: 6, color: 0x2a3460, kind: 'wall', decor: true },
    { x: 62.6, y: 4, w: 1.2, h: 9, color: 0x2a3460, kind: 'wall', decor: true },
    // Мостки: каждая ступень не выше ~2.1 от предыдущей, под ними проходит голова (1.2).
    ledge(-10, 5, 2.1, 0x6c8cff),
    ledge(-5.5, 2.5, 4.1, 0x6c8cff),
    ledge(10.5, 5, 2.1, 0x6c8cff),
    { x: 6.5, y: 0.5, w: 1, h: 1, z: 1, d: 1, color: 0xc98a3a, kind: 'crate' }, // ящик с запчастями в переднем ряду
    // Хроно-двигатель в глубине: задевает только того, кто ушёл назад (W).
    { x: 0, y: 1.5, w: 3.2, h: 3, z: -2.6, d: 3.2, color: 0x6c7a8c, kind: 'engine' },
    { x: 0, y: 3.6, w: 1.2, h: 1.2, z: -2.6, d: 1.2, color: 0x7fd8ff, kind: 'engineCore' },
    { x: 12.5, y: 0.6, w: 2.4, h: 1.2, z: -2.2, d: 1.2, color: 0x4a5590, kind: 'console' },
    { x: 4, y: 0.5, w: 1.2, h: 1, z: -2.2, d: 1, color: 0x4a5590, kind: 'console' },
    { x: -12.5, y: 0.6, w: 1.6, h: 1.2, z: -2.2, d: 1.2, color: 0x0077ff, kind: 'console' }, // терминал магазина
    // ── Паркур-отсек. 1) ящик к стенке 2.6;
    span(26, 28, 2.6, GYM),
    // 2) мостки над шахтой под обстрелом (стрелы на высоте груди);
    ledge(31, 2, 3, GYM),
    ledge(35, 2, 3.4, GYM),
    ledge(39, 2, 3, GYM),
    // 3) батут на нижней площадке → верхний ярус;
    ledge(42.5, 3, 2.6, GYM),
    trampoline(42.5, 2.6),
    // 4) верхний ярус под порывами вентилятора — финишная площадка с наградой.
    ledge(48.5, 4, 7.2, GYM),
    parapet(50.2, 7.2, GYM),
    ledge(54, 2.4, 7.2, GYM),
    ledge(59, 6, 7.2, 0x6c8cff),
  ],
  stations: [
    { id: 'jump', kind: 'jump', x: 4, y: 0, label: 'Рычаг прыжка' },
    { id: 'ship_ai', kind: 'narrator', x: 12.5, y: 0, label: 'Поговорить с ХРОНОСом', agent: 'ship_ai' },
    { id: 'shop', kind: 'shop', x: -12.5, y: 0, label: 'Магазин скинов (VK Coin)' },
    { id: 'gym_reset', kind: 'reset', x: 17.8, y: 0, label: 'Паркур-отсек: вернуть ящик', crates: ['gym'] },
    { id: 'gym_reward', kind: 'reward', x: 59.5, y: 7.2, label: 'Финиш паркура — забрать награду', reward: 5 },
  ],
  coins: coins('hub', [[-10, 2.9], [-5.5, 4.9], [10.5, 2.9], [6.5, 1.8, 1], [27, 3.4], [35, 4.3], [42.5, 6.2], [54, 8.0], [-4, 0.8, -5.3], [0, 0.8, -5.3], [4, 0.8, -5.3], [8, 0.8, -5.3]]),
  checkpoints: [{ x: 17, y: 0 }, { x: 27.5, y: 2.6 }, { x: 41.5, y: 2.6 }],
  crates: [crate('gym', 19.5, [25.4, 0])],
  arrows: [{ x: 40.2, y: 3.75, dir: -1, range: 11, period: 2.2 }],
  fans: [{ x: 56, y: 7.2, dir: -1, len: 15, h: 3, period: 4.6, on: 2.2 }],
};
// Ветка вглубь на борту: держаться z < −1.5 — ENGINE (z −4.2…−1.0) открывает за собой коридор,
// в нём «трюмные» монеты. Пол палубы тянется на всю глубину, так что ветка ходибельна сразу.

// ───────────── Сиена и Александрия.
// Ящик к скале → коридор стрел над двумя рвами → плато Сиены (Наблюдатель) → мостки под ветром с бортиками-укрытиями →
// ящик в ров вместо моста → батут под порывами на площадку гномона (Механик).
const SAND = 0xd9b77e;
const ROCK = 0xcfa96a;
export const ALEXANDRIA_LEVEL: Level = {
  id: 'alexandria',
  title: 'Сиена и Александрия, ~240 до н. э.',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  gate: { x: -14, agent: 'eratosthenes' },
  platforms: [
    ground(-30, -12, SAND),
    ground(-9, 14, SAND),
    span(8, 10, 2.8, ROCK), // скала: с пола не запрыгнуть — нужен ящик
    span(10, 11, 1.4, 0xc49a5c), // уступ с обратной стороны — чтобы вернуться к кораблю
    ...moat(14, 16.5),
    ground(16.5, 21, SAND),
    ...moat(21, 23.5),
    ground(23.5, 30, SAND),
    span(30, 40, 2, 0xc49a5c), // плато Сиены с колодцем
    { x: 36.8, y: 2.4, w: 1.6, h: 0.8, z: -2.2, d: 1.6, color: 0x9b8466, kind: 'well', decor: true },
    // Мостки над пропастью: бортики — укрытие от ветра.
    ledge(44, 3, 2, ROCK),
    parapet(45.2, 2, 0xc49a5c),
    ledge(49.5, 3, 2, ROCK),
    parapet(50.7, 2, 0xc49a5c),
    ledge(55, 3, 2, ROCK),
    parapet(56.2, 2, 0xc49a5c),
    ground(59, 66, SAND),
    span(59, 60, 1, ROCK), // ступень назад, на мостки
    // Ветка вглубь: обход мостков «низом» — тропа от Сиены вдоль пропасти к поселению.
    backFloor(30, 39, 0, -4.2, SAND), // уходит за плато Сиены
    backStep(42.2, 2.6, 1, -4.2, SAND),
    backStep(46.6, 2.6, 1.2, -4.2, SAND),
    backStep(51, 2.8, 1.6, -4.2, SAND),
    backStep(55.4, 2.8, 2.2, -4.2, SAND),
    ...moat(66, 72.4, 0x2fb8d0, -0.35, -1.2), // ров: перепрыгнуть нельзя, ящик ложится на дно вровень с полом
    ground(72.4, 100, SAND),
    trampoline(78),
    ledge(89, 14, 5.2, 0xe8d8b0), // площадка гномона
    { x: 98, y: 3, w: 1, h: 6, z: -2.4, d: 1, color: 0xe8d8b0, kind: 'obelisk', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -17, y: 0, label: 'Поговорить с Эратосфеном', agent: 'eratosthenes' },
    { id: 'reset1', kind: 'reset', x: -6, y: 0, label: 'Вернуть ящик у скалы', crates: ['rock'] },
    { id: 'observer', kind: 'observer', x: 35.5, y: 2, label: 'Сиена, колодец — роль Наблюдателя' },
    { id: 'reset2', kind: 'reset', x: 60.5, y: 0, label: 'Вернуть ящик у рва', crates: ['moat'] },
    { id: 'mechanic', kind: 'mechanic', x: 92, y: 5.2, label: 'Александрия, гномон — роль Механика' },
  ],
  coins: coins('alexandria', [[-10.5, 1.6], [9, 3.8], [15.2, 1.4], [22.2, 1.4], [33, 3.0], [45.2, 3.9], [56.2, 3.9], [69.5, 1.4], [78, 5.6], [86, 6.0], [98, 0.8], [34, 0.9, -4.2], [42.2, 2.0, -4.2], [46.6, 2.3, -4.2], [51, 2.7, -4.2], [55.4, 3.3, -4.2]]),
  checkpoints: [{ x: -8, y: 0 }, { x: 11.5, y: 0 }, { x: 38.5, y: 2 }, { x: 60, y: 0 }, { x: 74, y: 0 }],
  crates: [crate('rock', 2, [7.4, 0]), crate('moat', 63, [66.9, -1.2])],
  arrows: [{ x: 29.8, y: 0.55, dir: -1, range: 17, period: 1.9 }],
  fans: [
    { x: 59, y: 1.4, dir: -1, len: 18.5, h: 4.4, period: 5.4, on: 3 },
    { x: 83, y: 1, dir: -1, len: 9, h: 6, period: 5, on: 2.4, phase: 1 },
  ],
};

// ───────────── Падуя, ночь.
// Переулок стражи: арбалеты бьют по ближним рядам, укрытие — дальний ряд, но его перегораживают стены →
// мастерская: сквозняк мехов по полу, ящик — щит и ступенька (Механик на верстаке) →
// крыши над каналами: батут, порывы из труб и арбалет у обсерватории (Наблюдатель).
const STONE = 0x9a6a4a;
const ROOF = 0xa0522d;
export const PADUA_LEVEL: Level = {
  id: 'padua',
  title: 'Падуя, 1610',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  gate: { x: -14.5, agent: 'galileo' },
  platforms: [
    ground(-30, -12, STONE),
    ...moat(-12, -9, 0x2a6f8a),
    ground(-9, 44, STONE),
    depthWall(-2, 'back', 0x7a4a32),
    depthWall(5, 'back', 0x7a4a32),
    depthWall(12, 'back', 0x7a4a32),
    span(19, 20, 2, 0x8a4a32), // будка арбалетчика
    span(38, 44, 2.8, 0x8a5a3b), // верстак мастерской
    { x: 41.5, y: 3.3, w: 2.4, h: 1, z: -2.2, d: 1.4, color: 0x8a5a3b, kind: 'table', decor: true },
    // Крыши над каналами.
    ...moat(44, 56, 0x2a6f8a),
    span(47, 52, 3.6, ROOF),
    span(56, 60, 3, ROOF),
    ground(60, 66, STONE),
    trampoline(63),
    span(66, 72, 5.4, ROOF),
    ...moat(72, 75, 0x2a6f8a),
    span(75, 80, 5.4, ROOF),
    ...moat(80, 83, 0x2a6f8a),
    span(83, 100, 6.4, 0xb0623a), // крыша обсерватории
    { x: 93, y: 3.4, w: 10, h: 6.8, z: -2.4, d: 1.2, color: 0xd8c3a5, kind: 'hut', decor: true },
    // Ветка вглубь: полочки в глубине канала — закуток с монетами (выход на дальний берег — только крышами).
    backFloor(45.5, 49.5, 0, -4.4, STONE),
    backFloor(51.5, 53.5, 0, -4.4, STONE),
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -18, y: 0, label: 'Поговорить с Галилеем', agent: 'galileo' },
    { id: 'reset1', kind: 'reset', x: 22.5, y: 0, label: 'Вернуть ящик мастерской', crates: ['bench'] },
    { id: 'mechanic', kind: 'mechanic', x: 41.5, y: 2.8, label: 'Мастерская, модель — роль Механика' },
    { id: 'observer', kind: 'observer', x: 93, y: 6.4, label: 'Крыша, телескоп — роль Наблюдателя' },
  ],
  coins: coins('padua', [[-10.5, 1.6], [1.5, 0.8, -1.1], [8.5, 0.8, -1.1], [19.5, 2.8], [30, 0.8], [49.5, 4.4], [63, 5.2], [69, 6.2], [77.5, 6.2], [87, 7.2], [98, 7.2], [47.5, 0.9, -4.4], [52.5, 0.9, -4.4]]),
  checkpoints: [{ x: -8, y: 0 }, { x: 21, y: 0 }, { x: 43, y: 2.8 }, { x: 61, y: 0 }, { x: 68, y: 5.4 }, { x: 85, y: 6.4 }],
  crates: [crate('bench', 24, [37.4, 0])],
  arrows: [
    // Арбалет бьёт по ближнему и среднему рядам; дальний (W) — укрытие, если не мешают стены.
    { x: 18.8, y: 0.7, dir: -1, range: 27, z: 0.45, d: 2.1, period: 1.7 },
    { x: 82.8, y: 6.05, dir: -1, range: 9, period: 2.4, phase: 0.6 },
  ],
  fans: [
    { x: 38, y: 0, dir: -1, len: 14, h: 1.2 }, // мехи: дуют всегда, укрыться можно только за ящиком
    { x: 86, y: 5.4, dir: -1, len: 15, h: 2.6, period: 4.4, on: 2 },
  ],
};

// ───────────── Англия, 1687.
// Река по камню → батут-стог на холм под обстрелом → пушечный холм (Механик) → река пошире: два ящика на дно →
// поле под порывами с копнами-укрытиями → стрельбище (стрелы летят в мишень, вдогонку) → батут на вышку (Наблюдатель).
const GRASS = 0x6f9a52;
const HILL = 0x5d8743;
const HAY = 0xd9c36a;
export const WOOLSTHORPE_LEVEL: Level = {
  id: 'woolsthorpe',
  title: 'Англия, 1687',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  gate: { x: -13.5, agent: 'newton' },
  platforms: [
    ground(-30, -12.5, GRASS),
    ...moat(-12.5, -7.5, 0x3fa0d0),
    { x: -10, y: -2, w: 1, h: 4, color: 0x8a8a8a }, // камень посреди реки, верх 0
    ground(-7.5, 14, GRASS),
    trampoline(4.5),
    span(8, 14, 4.4, HILL),
    ground(17, 40, GRASS),
    span(17, 30, 4.4, 0x4f7a3a), // пушечный холм
    { x: 25, y: 4.8, w: 1.6, h: 0.8, z: -2.2, d: 1, color: 0x3d3d3d, kind: 'cannon', decor: true },
    span(30, 32, 2.2, HILL), // спуск с холма (и подъём обратно)
    ...moat(40, 47.6, 0x3fa0d0, -0.35, -1.2),
    ground(47.6, 100, GRASS),
    // Копны — укрытия от порывов.
    span(53, 54.6, 1.4, HAY),
    span(59, 60.6, 1.4, HAY),
    span(65, 66.6, 1.4, HAY),
    span(75, 76, 1.4, 0x8b6a3e), // столб стрельбища с самострелом
    trampoline(83),
    ledge(90, 10, 5.4, 0x6b4423), // вышка наблюдателя
    { x: 96, y: 2.7, w: 0.5, h: 5.4, z: -2.2, d: 0.5, color: 0x6b4423, kind: 'tree', decor: true },
    // Ветка вглубь: дальний луг за копнами — укрытия и монеты (переправа через реку — только ящики).
    backBlock(58, 1.6, 1.4, -4.4, HAY),
    backBlock(64.5, 1.6, 1.4, -4.4, HAY),
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -15, y: 0, label: 'Поговорить с Ньютоном', agent: 'newton' },
    { id: 'mechanic', kind: 'mechanic', x: 24, y: 4.4, label: 'Пушка на холме — роль Механика' },
    { id: 'reset1', kind: 'reset', x: 33.5, y: 0, label: 'Вернуть ящики у реки', crates: ['raft1', 'raft2'] },
    { id: 'observer', kind: 'observer', x: 91, y: 5.4, label: 'Вышка у поля мишеней — роль Наблюдателя' },
  ],
  coins: coins('woolsthorpe', [[-10, 1.2], [4.5, 4.4], [11, 5.4], [15.5, 5.6], [28, 5.4], [43.5, 1.4], [56.5, 0.8], [62.5, 0.8], [75.5, 2.4], [83, 5.8], [95, 6.4], [58, 2.4, -4.4], [64.5, 2.4, -4.4], [88, 0.8, -4.4]]),
  checkpoints: [{ x: -7, y: 0 }, { x: 12, y: 4.4 }, { x: 33, y: 0 }, { x: 49, y: 0 }, { x: 70, y: 0 }],
  // Сначала дальний ящик (он ляжет первым), затем ближний съедет по нему и ляжет вторым.
  crates: [crate('raft2', 37.5, [40.7, -1.2]), crate('raft1', 35, [41.9, -1.2])],
  arrows: [
    { x: 7.8, y: 3, dir: -1, range: 8, period: 2 }, // пугало-самострел на склоне: бьёт по взлетающим с батута
    { x: 76.2, y: 0.6, dir: 1, range: 20, period: 1.6 }, // стрельбище: стрелы летят вдогонку
  ],
  fans: [{ x: 72, y: 0, dir: -1, len: 23, h: 3, period: 5, on: 2.6 }],
};

// ───────────── Блетчли-парк, 1941.
// Лабиринт бараков: вентиляторы дуют то в дальнем, то в ближнем ряду, стены заставляют менять ряд →
// ящик + уступ вглубь на крышу радиорубки (Наблюдатель) → батут на мостки под очередями стрел →
// большой ящик в затопленный проём, вентилятор над ним → «бомба» (Механик).
const PARK = 0x5b6b4f;
const HALL = 0x6a6a6a;
export const BLETCHLEY_LEVEL: Level = {
  id: 'bletchley',
  title: 'Блетчли-парк, 1941',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  gate: { x: -15, agent: 'turing' },
  platforms: [
    ground(-30, -10, PARK),
    ...moat(-10, -7, 0x3a5a6a),
    ground(-7, 46, PARK),
    depthWall(-2, 'front', 0x6b6b5a),
    depthWall(3, 'back', 0x6b6b5a),
    depthWall(8, 'front', 0x6b6b5a),
    depthWall(13, 'back', 0x6b6b5a),
    backLedge(22, 1.6, 2.6, HALL),
    span(24, 32, 4, 0x4a4a4a), // крыша барака-радиорубки
    span(32, 33.5, 2.2, HALL), // ступень с обратной стороны
    { x: 28, y: 1.85, w: 8, h: 3.7, z: -2.4, d: 1, color: 0x8b8f7a, kind: 'hut', decor: true },
    trampoline(43.5),
    ledge(52, 10, 4.8, HALL), // мостки над двором
    span(58, 66, 2.8, HALL), // платформа перед проёмом, на ней большой ящик
    ...moat(66, 72.6, 0x3a5a6a, 0.4, 0),
    span(72.6, 100, 2.8, HALL), // зал «бомбы»
    { x: 88, y: 4.3, w: 7, h: 3, z: -2.4, d: 1, color: 0x8b8f7a, kind: 'hut', decor: true },
    // Ветка вглубь: задний двор бараков и двор за «бомбой» — монеты в глубине (проём — только с ящиком).
    backFloor(48.5, 65.2, 0, -4.4, PARK),
    backFloor(74, 99, 0, -4.4, PARK),
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -19, y: 0, label: 'Поговорить с Тьюрингом', agent: 'turing' },
    { id: 'reset1', kind: 'reset', x: 17.5, y: 0, label: 'Вернуть ящик у радиорубки', crates: ['hut'] },
    { id: 'observer', kind: 'observer', x: 29, y: 4, label: 'Крыша радиорубки — роль Наблюдателя' },
    { id: 'reset2', kind: 'reset', x: 59.5, y: 2.8, label: 'Вернуть большой ящик', crates: ['big'] },
    { id: 'mechanic', kind: 'mechanic', x: 88, y: 2.8, label: '«Бомба» — роль Механика' },
  ],
  coins: coins('bletchley', [[-8.5, 1.6], [0.5, 0.8, 1.1], [5.5, 0.8, -1.1], [10.5, 0.8, 1.1], [22, 3.4, -1], [26, 5.0], [43.5, 5.6], [52, 6.6], [69.5, 3.8], [80, 3.6], [97, 3.6], [0.5, 0.8, -5.6], [8.5, 0.8, -5.6], [52, 0.8, -4.4], [58, 0.8, -4.4], [63, 0.8, -4.4], [85, 0.8, -4.4], [92, 0.8, -4.4]]),
  checkpoints: [{ x: -6.5, y: 0 }, { x: 16.5, y: 0 }, { x: 34.5, y: 0 }, { x: 58.6, y: 2.8 }, { x: 74, y: 2.8 }],
  crates: [crate('hut', 14.5, [23.4, 0]), crate('big', 62, [67.6, 0], 2.8, 2.8, 0x8a6a4a)],
  arrows: [{ x: 56.8, y: 5.4, dir: -1, range: 10, period: 1.8 }],
  fans: [
    // Лабиринт: у каждой стены в обходном ряду — вентилятор-«ворота»; открываются волной.
    { x: -1.75, y: 0, dir: -1, len: 4.5, h: 3.2, z: -1, d: 1, period: 4, on: 2 },
    { x: 3.25, y: 0, dir: -1, len: 4.5, h: 3.2, z: 1, d: 1, period: 4, on: 2, phase: 1 },
    { x: 8.25, y: 0, dir: -1, len: 4.5, h: 3.2, z: -1, d: 1, period: 4, on: 2, phase: 2 },
    { x: 13.25, y: 0, dir: -1, len: 4.5, h: 3.2, z: 1, d: 1, period: 4, on: 2, phase: 3 },
    { x: 80, y: 2.8, dir: -1, len: 16, h: 3, period: 5, on: 2.5 },
  ],
};

// ───────────── Байконур, 1961.
// Ящик — щит от пневмопушки и ступенька на бункер (Наблюдатель) → монтажные леса: стрелы по ярусам,
// батут на верхний ярус, «выхлоп» двигателя порывами → площадка у ракеты (Механик).
const STEPPE = 0xb8a46a;
const STEEL = 0x8a8f99;
export const BAIKONUR_LEVEL: Level = {
  id: 'baikonur',
  title: 'Байконур, 1961',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  gate: { x: -14, agent: 'korolev' },
  platforms: [
    ground(-30, -6, STEPPE),
    ground(-3, 34, STEPPE),
    span(14, 34, 2.8, 0x7d7a6a), // бункер управления
    { x: 29, y: 3.2, w: 3, h: 0.8, z: -2.3, d: 1.2, color: 0x5d5a4a, kind: 'table', decor: true },
    // Монтажные леса над котлованом.
    ledge(38, 3, 3.6, STEEL),
    ledge(43, 3, 4.6, STEEL),
    ledge(48.5, 3, 4.6, STEEL),
    trampoline(48.5, 4.6),
    ledge(55, 6, 9.4, STEEL),
    parapet(57.7, 9.4, 0x5d6470),
    ledge(63.5, 5, 9.4, STEEL),
    ledge(73, 10, 8, 0xc0392b), // площадка обслуживания у ракеты
    ground(78, 100, STEPPE),
    { x: 86, y: 5, w: 1.6, h: 10, z: -2.4, d: 1.6, color: 0xe8e8e8, kind: 'rocket', decor: true },
    { x: 83.6, y: 4, w: 0.8, h: 8, z: -2.4, d: 0.8, color: 0xc0392b, kind: 'tower', decor: true },
    // Ветка вглубь: вторая тропа под лесами — грунт у котлована, расходящиеся маршрутом ступени мимо «выхлопа».
    backFloor(35.5, 55, 0, -4.2, STEPPE),
    backStep(58, 3, 0.6, -4.2, STEPPE),
    backStep(62, 3, 0.8, -4.2, STEPPE),
    backStep(67, 3.2, 0.6, -4.2, STEPPE),
    backStep(71.5, 3.4, 0.8, -4.2, STEPPE),
    backStep(75, 3.4, 1.2, -4.2, STEPPE),
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -17, y: 0, label: 'Поговорить с Королёвым', agent: 'korolev' },
    { id: 'reset1', kind: 'reset', x: -1.5, y: 0, label: 'Вернуть ящик у бункера', crates: ['shield'] },
    { id: 'observer', kind: 'observer', x: 30, y: 2.8, label: 'Бункер управления — роль Наблюдателя' },
    { id: 'mechanic', kind: 'mechanic', x: 75, y: 8, label: 'Монтажные леса — роль Механика' },
  ],
  coins: coins('baikonur', [[-4.5, 1.6], [7, 2.2], [14, 3.6], [24, 3.6], [36, 3.4], [43, 5.4], [48.5, 8.6], [55, 10.2], [60.3, 10.2], [68, 9.0], [90, 0.8], [40, 0.8, -4.2], [50, 0.8, -4.2], [54, 0.8, -4.2], [58, 1.3, -4.2], [62, 1.5, -4.2], [67, 1.3, -4.2], [71.5, 1.5, -4.2], [88, 0.8, -4.4], [95, 0.8, -4.4]]),
  checkpoints: [{ x: -2.5, y: 0 }, { x: 32, y: 2.8 }, { x: 47.5, y: 4.6 }, { x: 53, y: 9.4 }],
  crates: [crate('shield', 3, [13.4, 0])],
  arrows: [
    { x: 13.8, y: 0.6, dir: -1, range: 16, period: 1.5 }, // пневмопушка у входа: ящик-щит её гасит
    { x: 44.8, y: 5.2, dir: -1, range: 8.5, period: 2.2 }, // заклёпки по ярусу лесов
  ],
  fans: [{ x: 66, y: 9.4, dir: -1, len: 18, h: 3, period: 5, on: 2.5 }],
};

export const LEVELS: Record<string, Level> = Object.fromEntries(
  [HUB_LEVEL, ALEXANDRIA_LEVEL, PADUA_LEVEL, WOOLSTHORPE_LEVEL, BLETCHLEY_LEVEL, BAIKONUR_LEVEL].map((l) => [l.id, l]),
);

export function getLevel(id: string): Level {
  return LEVELS[id] ?? HUB_LEVEL;
}

/** Детерминированный цвет игрока по имени. */
export function colorForName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const palette = [0xe76f51, 0x2a9d8f, 0xe9c46a, 0x8ab17d, 0x9b5de5, 0x4d96ff, 0xf28482, 0x6d597a];
  return palette[h % palette.length];
}
