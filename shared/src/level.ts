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
  | 'table';

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
}

/** Точка взаимодействия (клавиша E). Сервер проверяет, что игрок рядом. */
export type StationKind = 'jump' | 'return' | 'observer' | 'mechanic' | 'narrator' | 'shop';

export interface Station {
  id: string;
  kind: StationKind;
  x: number;
  /** Уровень пола у станции — чтобы нельзя было «нажать» станцию с платформы над ней. */
  y: number;
  label: string;
  /** Для narrator — id агента (рассказчик эпохи или бортовой ИИ). */
  agent?: string;
}

export const STATION_RADIUS = 1.6;

export function isNearStation(s: Station, p: { x: number; y: number }): boolean {
  return Math.abs(p.x - s.x) <= STATION_RADIUS && Math.abs(p.y - s.y) <= 1.6;
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

const LANE = { minZ: -1.5, maxZ: 1.5, minY: -5 };
const EPOCH_BOUNDS = { minX: -30, maxX: 30, ...LANE };
const EPOCH_SPAWN = { x: -21, y: 0, z: 0 };
const returnStation: Station = { id: 'return', kind: 'return', x: -24, y: 0, label: 'Колизиум: вернуться на борт' };

/** Кусок пола от x0 до x1 (верх y=0). Между кусками — ямы: упал — вернулся к чекпоинту. */
const ground = (x0: number, x1: number, color: number): Platform => ({ x: (x0 + x1) / 2, y: -0.5, w: x1 - x0, h: 1, color, kind: 'floor' });
/** Сплошной блок от пола до top (ступень, ящик, холм). */
const block = (x: number, w: number, top: number, color: number, extra: Partial<Platform> = {}): Platform => ({ x, y: top / 2, w, h: top, color, ...extra });
/** Тонкая парящая платформа с верхом top. */
const ledge = (x: number, w: number, top: number, color: number, extra: Partial<Platform> = {}): Platform => ({ x, y: top - 0.15, w, h: 0.3, color, ...extra });
/** Платформа только в дальнем ряду: встать можно, лишь уйдя вглубь (W). */
const backLedge = (x: number, w: number, top: number, color: number): Platform => ledge(x, w, top, color, { z: -1, d: 1 });
/** Высокая стена, перекрывающая часть глубины: обходится по W/S. side: 'front' — у камеры, 'back' — у фона. */
const depthWall = (x: number, side: 'front' | 'back', color: number): Platform => ({
  x, y: 1.6, w: 0.5, h: 3.2, z: side === 'front' ? 0.65 : -0.65, d: 1.7, color, kind: 'wall', decor: true,
});
const coins = (levelId: string, list: [number, number, number?][]): Coin[] =>
  list.map(([x, y, z], i) => ({ id: `${levelId}-${i + 1}`, x, y, ...(z === undefined ? {} : { z }) }));

export const HUB_LEVEL: Level = {
  id: 'hub',
  title: 'Колизиум — борт корабля',
  bounds: { minX: -15, maxX: 15, ...LANE },
  spawn: { x: -4, y: 0, z: 0 },
  platforms: [
    { ...ground(-16, 16, 0x3a4250) },
    { x: -15.6, y: 4, w: 1.2, h: 9, color: 0x4a5568, kind: 'wall', decor: true },
    { x: 15.6, y: 4, w: 1.2, h: 9, color: 0x4a5568, kind: 'wall', decor: true },
    // Мостки: каждая ступень не выше ~2.1 от предыдущей, под ними проходит голова (1.2).
    ledge(-10, 5, 2.1, 0x56627a),
    ledge(-5.5, 2.5, 4.1, 0x56627a),
    ledge(10.5, 5, 2.1, 0x56627a),
    { x: 6.5, y: 0.5, w: 1, h: 1, z: 1, d: 1, color: 0xc98a3a }, // ящик с запчастями в переднем ряду
    // Хроно-двигатель в глубине: задевает только того, кто ушёл назад (W).
    { x: 0, y: 1.5, w: 3.2, h: 3, z: -2.6, d: 3.2, color: 0x6c7a8c, kind: 'engine' },
    { x: 0, y: 3.6, w: 1.2, h: 1.2, z: -2.6, d: 1.2, color: 0x7fd8ff, kind: 'engineCore' },
    { x: 12.5, y: 0.6, w: 2.4, h: 1.2, z: -2.2, d: 1.2, color: 0x2d3748, kind: 'console' },
    { x: 4, y: 0.5, w: 1.2, h: 1, z: -2.2, d: 1, color: 0x2d3748, kind: 'console' },
    { x: -12.5, y: 0.6, w: 1.6, h: 1.2, z: -2.2, d: 1.2, color: 0x0b3a7a, kind: 'console' }, // терминал магазина
  ],
  stations: [
    { id: 'jump', kind: 'jump', x: 4, y: 0, label: 'Рычаг прыжка' },
    { id: 'ship_ai', kind: 'narrator', x: 12.5, y: 0, label: 'Поговорить с ХРОНОСом', agent: 'ship_ai' },
    { id: 'shop', kind: 'shop', x: -12.5, y: 0, label: 'Магазин скинов (VK Coin)' },
  ],
  coins: coins('hub', [[-10, 2.9], [-5.5, 4.9], [10.5, 2.9], [6.5, 1.8, 1]]),
  checkpoints: [],
};

// ───────────── Сиена и Александрия: обучение. Ямы, плато колодца, лестница храма с уступом вглубь.
const SAND = 0xd9b77e;
export const ALEXANDRIA_LEVEL: Level = {
  id: 'alexandria',
  title: 'Сиена и Александрия, ~240 до н. э.',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    ground(-30, -13, SAND),
    ground(-10.5, 3, SAND),
    ground(6, 30, SAND),
    block(-8.5, 1.4, 1.4, 0xcfa96a), // камень у плато
    block(-5, 4, 2.8, 0xc49a5c), // плато Сиены с колодцем, верх 2.8 — с пола не допрыгнуть
    block(-1.9, 1.2, 1.4, 0xcfa96a), // камень с обратной стороны — чтобы вернуться к кораблю
    { x: -4.2, y: 3.2, w: 1.6, h: 0.8, z: -2.2, d: 1.6, color: 0x9b8466, kind: 'well', decor: true },
    // Храм Александрии: ступени → уступ только в дальнем ряду → площадка гномона.
    block(9, 2, 1, 0xe0cfa0),
    block(11.5, 2, 2.2, 0xe0cfa0),
    backLedge(14, 2, 3.6, 0xd8c08a),
    ledge(17.2, 3, 4.6, 0xe8d8b0),
    { x: 21, y: 3, w: 1, h: 6, z: -2.4, d: 1, color: 0xe8d8b0, kind: 'obelisk', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -17, y: 0, label: 'Поговорить с Эратосфеном', agent: 'eratosthenes' },
    { id: 'observer', kind: 'observer', x: -5, y: 2.8, label: 'Сиена, колодец — роль Наблюдателя' },
    { id: 'mechanic', kind: 'mechanic', x: 17.2, y: 4.6, label: 'Александрия, гномон — роль Механика' },
  ],
  coins: coins('alexandria', [[-11.75, 1.6], [-8.5, 2.2], [-3.5, 3.6], [4.5, 1.8], [11.5, 3.0], [14, 4.4, -1], [17.2, 6.0], [27, 0.8]]),
  checkpoints: [{ x: -9.8, y: 0 }, { x: 6.8, y: 0 }],
};

// ───────────── Падуя: мастерская за стенами (перелезть по ящикам), балконы до крыши, один — только вглубь.
const STONE = 0x7d6a5a;
export const PADUA_LEVEL: Level = {
  id: 'padua',
  title: 'Падуя, 1610',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    ground(-30, -14, STONE),
    ground(-11, 30, STONE),
    // Мастерская: стены 2.8 с ящиками снаружи и изнутри.
    block(-9.6, 1.2, 1.2, 0x8a6a4a),
    block(-7, 0.6, 2.8, 0x8a4a32),
    block(-5.4, 0.8, 1.2, 0x8a6a4a),
    { x: -4, y: 0.5, w: 2.4, h: 1, z: -2.2, d: 1.4, color: 0x8a5a3b, kind: 'table', decor: true },
    block(-2.6, 0.8, 1.2, 0x8a6a4a),
    block(-1.5, 0.6, 2.8, 0x8a4a32),
    block(0.2, 1, 1.2, 0x8a6a4a),
    // Путь на крышу: балкон → балкон вглубь → карниз → крыша.
    block(4, 2, 1.4, 0x9a7b5f),
    backLedge(7, 1.6, 2.8, 0x9a7b5f),
    ledge(10, 1.6, 4.2, 0x9a7b5f),
    ledge(16.5, 7, 5.6, 0xa0522d),
    { x: 16.5, y: 2.6, w: 7, h: 5.2, z: -2.4, d: 1.2, color: 0xd8c3a5, kind: 'hut', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -18, y: 0, label: 'Поговорить с Галилеем', agent: 'galileo' },
    { id: 'mechanic', kind: 'mechanic', x: -4, y: 0, label: 'Мастерская, модель — роль Механика' },
    { id: 'observer', kind: 'observer', x: 18, y: 5.6, label: 'Крыша, телескоп — роль Наблюдателя' },
  ],
  coins: coins('padua', [[-12.5, 1.6], [-9.6, 2.0], [-7, 3.8], [-4, 1.0], [7, 3.6, -1], [10, 5.0], [14, 6.4], [27, 0.8]]),
  checkpoints: [{ x: -10.5, y: 0 }],
};

// ───────────── Англия: река по камню, холм с пушкой ярусами, забор и вышка над полем мишеней.
const GRASS = 0x6f9a52;
export const WOOLSTHORPE_LEVEL: Level = {
  id: 'woolsthorpe',
  title: 'Англия, 1687',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    ground(-30, -12.5, GRASS),
    { x: -10, y: -2, w: 1, h: 4, color: 0x8a8a8a }, // камень посреди реки, верх 0
    ground(-7.5, 30, GRASS),
    block(-4.5, 3, 1.2, 0x5d8743),
    block(-1.5, 3, 2.6, 0x5d8743),
    block(2, 4, 4, 0x4f7a3a),
    block(5.2, 1.2, 2.6, 0x5d8743), // спуск/подъём с правой стороны холма
    block(6.6, 1.2, 1.3, 0x5d8743),
    { x: 2.5, y: 4.4, w: 1.6, h: 0.8, z: -2.2, d: 1, color: 0x3d3d3d, kind: 'cannon', decor: true },
    block(10, 1.6, 1.4, 0xd9c36a), // стог
    { ...block(12, 0.4, 3.2, 0x8b6a3e), decor: true }, // забор
    block(14, 1.6, 1.4, 0xd9c36a),
    block(19.5, 1.2, 1.4, 0x8b6a3e),
    block(22, 2, 3, 0x6b4423), // вышка наблюдателя
    { x: -16, y: 1.5, w: 0.6, h: 3, z: -2.4, d: 0.6, color: 0x6b4423, kind: 'tree', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -15, y: 0, label: 'Поговорить с Ньютоном', agent: 'newton' },
    { id: 'mechanic', kind: 'mechanic', x: 2, y: 4, label: 'Пушка на холме — роль Механика' },
    { id: 'observer', kind: 'observer', x: 22, y: 3, label: 'Вышка у поля мишеней — роль Наблюдателя' },
  ],
  coins: coins('woolsthorpe', [[-24, 2.2], [-10, 1.2], [-8.5, 1.4], [-1.5, 3.4], [2, 5.6], [12, 4.0], [14, 2.2], [22, 4.4]]),
  checkpoints: [{ x: -7, y: 0 }, { x: 15, y: 0 }],
};

// ───────────── Блетчли-парк: крыша радиорубки по ящикам и уступу вглубь, лабиринт стен перед «бомбой».
const PARK = 0x5b6b4f;
export const BLETCHLEY_LEVEL: Level = {
  id: 'bletchley',
  title: 'Блетчли-парк, 1941',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    ground(-30, -2, PARK),
    ground(1, 30, PARK),
    block(-15, 1.2, 1.2, 0x7a6a50),
    backLedge(-13, 1.4, 2.6, 0x6a6a6a),
    ledge(-8, 6, 4, 0x4a4a4a), // крыша барака-радиорубки
    { x: -8, y: 1.85, w: 6, h: 3.7, z: -2.4, d: 1, color: 0x8b8f7a, kind: 'hut', decor: true },
    // Лабиринт: стены перекрывают то передний, то задний ряд — обходить по W/S.
    depthWall(6, 'front', 0x6b6b5a),
    depthWall(9, 'back', 0x6b6b5a),
    depthWall(12, 'front', 0x6b6b5a),
    { x: 15, y: 1.5, w: 7, h: 3, z: -2.4, d: 1, color: 0x8b8f7a, kind: 'hut', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -19, y: 0, label: 'Поговорить с Тьюрингом', agent: 'turing' },
    { id: 'observer', kind: 'observer', x: -7, y: 4, label: 'Крыша радиорубки — роль Наблюдателя' },
    { id: 'mechanic', kind: 'mechanic', x: 15, y: 0, label: '«Бомба» — роль Механика' },
  ],
  coins: coins('bletchley', [[-24, 2.2], [-15, 2.0], [-13, 3.4, -1], [-9, 4.8], [-0.5, 1.6], [7.5, 0.7], [10.5, 0.7], [27, 0.8]]),
  checkpoints: [{ x: 1.5, y: 0 }],
};

// ───────────── Байконур: бункер за стенами-лабиринтом, монтажные леса над ямой до верхней площадки.
const STEPPE = 0xb8a46a;
export const BAIKONUR_LEVEL: Level = {
  id: 'baikonur',
  title: 'Байконур, 1961',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    ground(-30, -6, STEPPE),
    ground(-3, 8, STEPPE),
    ground(11, 30, STEPPE),
    depthWall(-13, 'back', 0x7d7a6a), // бункер: вход только у камеры…
    depthWall(-9, 'front', 0x7d7a6a), // …выход только у фона
    { x: -11, y: 0.4, w: 3, h: 0.8, z: -2.3, d: 1.2, color: 0x5d5a4a, kind: 'table', decor: true },
    block(1, 1.6, 1.4, 0x8a8f99),
    backLedge(4, 2, 2.8, 0x8a8f99),
    ledge(7, 2, 4.2, 0x8a8f99),
    ledge(13.5, 4, 4.5, 0x8a8f99), // верхняя площадка над ямой
    { x: 24, y: 5, w: 1.6, h: 10, z: -2.4, d: 1.6, color: 0xe8e8e8, kind: 'rocket', decor: true },
    { x: 21.6, y: 4, w: 0.8, h: 8, z: -2.4, d: 0.8, color: 0xc0392b, kind: 'tower', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -17, y: 0, label: 'Поговорить с Королёвым', agent: 'korolev' },
    { id: 'observer', kind: 'observer', x: -11, y: 0, label: 'Бункер управления — роль Наблюдателя' },
    { id: 'mechanic', kind: 'mechanic', x: 14, y: 4.5, label: 'Монтажные леса — роль Механика' },
  ],
  coins: coins('baikonur', [[-24, 2.2], [-11, 0.8], [-4.5, 1.6], [1, 2.2], [4, 3.6, -1], [7, 5.0], [15.5, 5.3], [27, 0.8]]),
  checkpoints: [{ x: -2.5, y: 0 }, { x: 11.5, y: 0 }],
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
