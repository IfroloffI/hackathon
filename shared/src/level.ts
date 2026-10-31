/**
 * Описание уровня, общее для клиента (рендер + физика) и сервера (валидация).
 * Позже переедет в levels/*.json — по эпохе на файл.
 */

export interface Platform {
  /** Центр по X/Y и размеры. По Z платформа занимает всю глубину дорожки. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
}

export interface Level {
  id: string;
  title: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number };
  spawn: { x: number; y: number; z: number };
  platforms: Platform[];
}

export const HUB_LEVEL: Level = {
  id: 'hub',
  title: 'Хаб — корабль-хронолёт',
  bounds: { minX: -20, maxX: 20, minZ: -1.5, maxZ: 1.5, minY: -5 },
  spawn: { x: 0, y: 1, z: 0 },
  platforms: [
    { x: 0, y: -0.5, w: 40, h: 1, color: 0xb08a5a }, // пол
    { x: -8, y: 1.5, w: 4, h: 0.4, color: 0xc9a46c },
    { x: -3, y: 3, w: 3, h: 0.4, color: 0xc9a46c },
    { x: 4, y: 2, w: 4, h: 0.4, color: 0xc9a46c },
    { x: 10, y: 3.5, w: 3, h: 0.4, color: 0xc9a46c },
    { x: 15, y: 1, w: 2, h: 2, color: 0x8f6b43 }, // ящик
  ],
};

/** Детерминированный цвет игрока по имени. */
export function colorForName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const palette = [0xe76f51, 0x2a9d8f, 0xe9c46a, 0x8ab17d, 0x9b5de5, 0x4d96ff, 0xf28482, 0x6d597a];
  return palette[h % palette.length];
}
