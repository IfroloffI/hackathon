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
export type StationKind = 'jump' | 'return' | 'observer' | 'mechanic' | 'narrator';

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

export interface Level {
  id: string;
  title: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number };
  spawn: { x: number; y: number; z: number };
  platforms: Platform[];
  stations: Station[];
}

const LANE = { minZ: -1.5, maxZ: 1.5, minY: -5 };
const EPOCH_BOUNDS = { minX: -30, maxX: 30, ...LANE };
const EPOCH_SPAWN = { x: -21, y: 0, z: 0 };
const floor = (color: number, w = 62): Platform => ({ x: 0, y: -0.5, w, h: 1, color, kind: 'floor' });
const returnStation: Station = { id: 'return', kind: 'return', x: -24, y: 0, label: 'Хронолёт: вернуться на борт' };

export const HUB_LEVEL: Level = {
  id: 'hub',
  title: 'Хронолёт — борт корабля',
  bounds: { minX: -15, maxX: 15, ...LANE },
  spawn: { x: -4, y: 0, z: 0 },
  platforms: [
    floor(0x3a4250, 32),
    { x: -15.6, y: 4, w: 1.2, h: 9, color: 0x4a5568, kind: 'wall', decor: true },
    { x: 15.6, y: 4, w: 1.2, h: 9, color: 0x4a5568, kind: 'wall', decor: true },
    // Мостки: каждая ступень не выше ~2.1 от предыдущей, под ними проходит голова (1.2).
    { x: -10, y: 1.95, w: 5, h: 0.3, color: 0x56627a }, // верх 2.1
    { x: -5.5, y: 3.95, w: 2.5, h: 0.3, color: 0x56627a }, // верх 4.1
    { x: 10.5, y: 1.95, w: 5, h: 0.3, color: 0x56627a }, // верх 2.1
    { x: 6.5, y: 0.5, w: 1, h: 1, z: 1, d: 1, color: 0xc98a3a }, // ящик с запчастями в переднем ряду
    // Хроно-двигатель в глубине: задевает только того, кто ушёл назад (W).
    { x: 0, y: 1.5, w: 3.2, h: 3, z: -2.6, d: 3.2, color: 0x6c7a8c, kind: 'engine' }, // верх 3.0
    { x: 0, y: 3.6, w: 1.2, h: 1.2, z: -2.6, d: 1.2, color: 0x7fd8ff, kind: 'engineCore' },
    { x: 12.5, y: 0.6, w: 2.4, h: 1.2, z: -2.2, d: 1.2, color: 0x2d3748, kind: 'console' }, // верх 1.2
    { x: 4, y: 0.5, w: 1.2, h: 1, z: -2.2, d: 1, color: 0x2d3748, kind: 'console' }, // пульт рычага, верх 1.0
  ],
  stations: [
    { id: 'jump', kind: 'jump', x: 4, y: 0, label: 'Рычаг прыжка' },
    { id: 'ship_ai', kind: 'narrator', x: 12.5, y: 0, label: 'Поговорить с ХРОНОСом', agent: 'ship_ai' },
  ],
};

export const ALEXANDRIA_LEVEL: Level = {
  id: 'alexandria',
  title: 'Сиена и Александрия, ~240 до н. э.',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    floor(0xd9b77e),
    { x: -1, y: 0.6, w: 5, h: 1.2, color: 0xcfa96a }, // дюна между городами, верх 1.2
    { x: 7, y: 1.95, w: 3, h: 0.3, color: 0xb89466 }, // навес, верх 2.1
    { x: -9, y: 0.4, w: 1.6, h: 0.8, z: -2.2, d: 1.6, color: 0x9b8466, kind: 'well', decor: true },
    { x: 15, y: 3, w: 1, h: 6, z: -2.4, d: 1, color: 0xe8d8b0, kind: 'obelisk', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -15, y: 0, label: 'Поговорить с Эратосфеном', agent: 'eratosthenes' },
    { id: 'observer', kind: 'observer', x: -9, y: 0, label: 'Сиена, колодец — роль Наблюдателя' },
    { id: 'mechanic', kind: 'mechanic', x: 13, y: 0, label: 'Александрия, гномон — роль Механика' },
  ],
};

export const PADUA_LEVEL: Level = {
  id: 'padua',
  title: 'Падуя, 1610',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    floor(0x7d6a5a),
    { x: -8, y: 0.5, w: 2.4, h: 1, z: -2.2, d: 1.4, color: 0x8a5a3b, kind: 'table', decor: true },
    // Лестница на крышу: 1.0 → 2.4 → 3.8
    { x: 6, y: 0.85, w: 2, h: 0.3, color: 0x9a7b5f }, // верх 1.0
    { x: 9, y: 2.25, w: 2, h: 0.3, color: 0x9a7b5f }, // верх 2.4
    { x: 15.5, y: 3.6, w: 7, h: 0.4, color: 0xa0522d }, // крыша, верх 3.8, низ 3.4
    { x: 15.5, y: 1.7, w: 7, h: 3.4, z: -2.4, d: 1.2, color: 0xd8c3a5, kind: 'hut', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -15, y: 0, label: 'Поговорить с Галилеем', agent: 'galileo' },
    { id: 'mechanic', kind: 'mechanic', x: -8, y: 0, label: 'Мастерская, модель — роль Механика' },
    { id: 'observer', kind: 'observer', x: 16, y: 3.8, label: 'Крыша, телескоп — роль Наблюдателя' },
  ],
};

export const WOOLSTHORPE_LEVEL: Level = {
  id: 'woolsthorpe',
  title: 'Англия, 1687',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    floor(0x6f9a52),
    { x: -6, y: 0.9, w: 8, h: 1.8, color: 0x5d8743 }, // холм, верх 1.8
    { x: -6.5, y: 2.2, w: 1.6, h: 0.8, z: -2.2, d: 1, color: 0x3d3d3d, kind: 'cannon', decor: true },
    { x: -16, y: 1.5, w: 0.6, h: 3, z: -2.4, d: 0.6, color: 0x6b4423, kind: 'tree', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: -14, y: 0, label: 'Поговорить с Ньютоном', agent: 'newton' },
    { id: 'mechanic', kind: 'mechanic', x: -6, y: 1.8, label: 'Пушка на холме — роль Механика' },
    { id: 'observer', kind: 'observer', x: 20, y: 0, label: 'Поле мишеней — роль Наблюдателя' },
  ],
};

export const BLETCHLEY_LEVEL: Level = {
  id: 'bletchley',
  title: 'Блетчли-парк, 1941',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    floor(0x5b6b4f),
    { x: -4, y: 0.6, w: 1.2, h: 1.2, color: 0x7a6a50 }, // ящик с перфолентами, верх 1.2
    { x: -9, y: 3.1, w: 7, h: 0.3, color: 0x4a4a4a }, // крыша барака 1, верх 3.25
    { x: -9, y: 1.5, w: 7, h: 3, z: -2.4, d: 1, color: 0x8b8f7a, kind: 'hut', decor: true },
    { x: 12, y: 3.1, w: 7, h: 0.3, color: 0x4a4a4a }, // крыша барака 2
    { x: 12, y: 1.5, w: 7, h: 3, z: -2.4, d: 1, color: 0x8b8f7a, kind: 'hut', decor: true },
    { x: 7, y: 0.6, w: 1.2, h: 1.2, color: 0x7a6a50 }, // ящик, верх 1.2
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: 2, y: 0, label: 'Поговорить с Тьюрингом', agent: 'turing' },
    { id: 'observer', kind: 'observer', x: -9, y: 0, label: 'Радиорубка — роль Наблюдателя' },
    { id: 'mechanic', kind: 'mechanic', x: 12, y: 0, label: '«Бомба» — роль Механика' },
  ],
};

export const BAIKONUR_LEVEL: Level = {
  id: 'baikonur',
  title: 'Байконур, 1961',
  bounds: EPOCH_BOUNDS,
  spawn: EPOCH_SPAWN,
  platforms: [
    floor(0xb8a46a),
    { x: -10, y: 0.7, w: 6, h: 1.4, z: -2.2, d: 1.6, color: 0x7d7a6a, kind: 'hut', decor: true }, // бункер
    { x: 9, y: 1.95, w: 4, h: 0.3, color: 0x8a8f99 }, // монтажные леса, верх 2.1
    { x: 22, y: 5, w: 1.6, h: 10, z: -2.4, d: 1.6, color: 0xe8e8e8, kind: 'rocket', decor: true },
    { x: 19.6, y: 4, w: 0.8, h: 8, z: -2.4, d: 0.8, color: 0xc0392b, kind: 'tower', decor: true },
  ],
  stations: [
    returnStation,
    { id: 'narrator', kind: 'narrator', x: 0, y: 0, label: 'Поговорить с Королёвым', agent: 'korolev' },
    { id: 'observer', kind: 'observer', x: -10, y: 0, label: 'Бункер управления — роль Наблюдателя' },
    { id: 'mechanic', kind: 'mechanic', x: 13, y: 0, label: 'Монтажный цех — роль Механика' },
  ],
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
