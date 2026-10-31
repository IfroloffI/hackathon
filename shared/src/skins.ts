/**
 * Скины — маскоты ВКонтакте и фирменные костюмы; покупаются за VK Coin в магазине на борту.
 * Внешний вид описан данными: клиент собирает персонажа (client/src/game/mascots.ts), сервер проверяет цену.
 *
 * Облик Спотти, Персика и Глазок — по описаниям маскотов ВК. Спаркс, Сеня и Дигги — ЧЕРНОВЫЕ образы
 * (approx: true): точного описания нет, нужно сверить с референсами бренда и подправить цвета/формы.
 */

export type HatKind = 'none' | 'crown' | 'wizard' | 'cap' | 'halo' | 'antlers';
export type HeadKind = 'helmet' | 'dog' | 'cat' | 'eyes' | 'spark' | 'bear' | 'robot' | 'heart';

export interface SkinDef {
  id: string;
  name: string;
  description: string;
  price: number;
  head: HeadKind;
  /** Цвет тела/меха/костюма. null — цвет игрока по имени. */
  body: number | null;
  /** Вторичный цвет: морда, живот, шлем, экран. */
  detail: number;
  /** Светящиеся детали (пояс, нашивка, искры). null — цвет игрока. */
  accent: number | null;
  /** Цвет визора/радужки. */
  eye: number;
  tail?: 'dog' | 'cat';
  hat: HatKind;
  metal?: boolean;
  /** Черновой облик — сверить с брендбуком. */
  approx?: boolean;
}

export const SKINS: readonly SkinDef[] = [
  { id: 'default', name: 'Хронавт', description: 'Стандартный скафандр экипажа', price: 0, head: 'helmet', body: null, detail: 0xf2f2f2, accent: null, eye: 0x1b2a4a, hat: 'none' },
  { id: 'vk', name: 'Хронавт VK', description: 'Фирменный синий скафандр', price: 10, head: 'helmet', body: 0x0077ff, detail: 0xffffff, accent: 0xffffff, eye: 0x0a2a66, hat: 'none' },
  { id: 'likosha', name: 'Лайкоша', description: 'Живой лайк: всем ставит сердечки', price: 15, head: 'heart', body: 0xff3347, detail: 0xffffff, accent: 0xffd1d8, eye: 0x1b1b1b, hat: 'none' },
  { id: 'sparks', name: 'Спаркс', description: 'Искрящийся спутник фестивалей (черновой облик)', price: 20, head: 'spark', body: 0xffc21a, detail: 0xfff4c2, accent: 0xff7a00, eye: 0x1b1b1b, hat: 'none', approx: true },
  { id: 'senya', name: 'Сеня', description: 'Добродушный друг из спецпроектов (черновой облик)', price: 20, head: 'bear', body: 0x9b6b43, detail: 0xf1d3b3, accent: 0x0077ff, eye: 0x1b1b1b, hat: 'cap', approx: true },
  { id: 'diggy', name: 'Дигги', description: 'Цифровой помощник из тем оформления (черновой облик)', price: 20, head: 'robot', body: 0x3ac9b0, detail: 0x0d1b2a, accent: 0x7dfff0, eye: 0x7dfff0, hat: 'none', approx: true },
  { id: 'glazki', name: 'Глазки', description: '«Я весь смотрение» — лицо VK Видео', price: 25, head: 'eyes', body: 0x2a2f45, detail: 0xffffff, accent: 0x0077ff, eye: 0x0077ff, hat: 'none' },
  { id: 'persik', name: 'Персик', description: 'Рыжий кот с харизматичной недовольной мордой', price: 35, head: 'cat', body: 0xf08a24, detail: 0xfff1e0, accent: 0xb35a12, eye: 0x2e7d32, tail: 'cat', hat: 'none' },
  { id: 'spotty', name: 'Спотти', description: 'Синий пёс-оптимист со шрамом на левом ухе — символ ВКонтакте', price: 40, head: 'dog', body: 0x3f8cff, detail: 0xffffff, accent: 0x1f5fcc, eye: 0x1b1b1b, tail: 'dog', hat: 'none' },
];

export const DEFAULT_SKIN = 'default';

export function getSkin(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** Название валюты. */
export const COIN_NAME = 'VK Coin';
/** Фирменный синий VK. */
export const VK_BLUE = 0x0077ff;
