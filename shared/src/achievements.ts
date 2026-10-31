/** Ачивки и уровни игрока — геймификация в духе VK: XP, уровни, значки, лайки. */

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  xp: number;
  coins: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_coin', title: 'Первая сфера', description: 'Подобрать VK Coin', icon: '🔵', xp: 10, coins: 0 },
  { id: 'collector', title: 'Коллекционер', description: 'Собрать 25 VK Coin за всё время', icon: '💎', xp: 60, coins: 5 },
  { id: 'observer', title: 'Зоркий глаз', description: 'Сыграть Наблюдателем', icon: '🔭', xp: 20, coins: 1 },
  { id: 'mechanic', title: 'Золотые руки', description: 'Сыграть Механиком', icon: '🔧', xp: 20, coins: 1 },
  { id: 'both_roles', title: 'Универсал', description: 'Побывать и Наблюдателем, и Механиком', icon: '🔁', xp: 40, coins: 2 },
  { id: 'first_part', title: 'Первая деталь', description: 'Экипаж добыл деталь двигателя', icon: '⚙️', xp: 30, coins: 2 },
  { id: 'stuntman', title: 'Каскадёр', description: 'Упасть в яму 5 раз', icon: '🤸', xp: 15, coins: 0 },
  { id: 'liked', title: 'Душа экипажа', description: 'Получить 5 лайков', icon: '❤️', xp: 40, coins: 3 },
  { id: 'fan', title: 'Щедрое сердце', description: 'Поставить 10 лайков', icon: '💙', xp: 20, coins: 1 },
  { id: 'fashion', title: 'Модник', description: 'Купить скин', icon: '🧥', xp: 20, coins: 0 },
  { id: 'speedrun', title: 'Быстрее времени', description: 'Уложиться в контрольное время шага', icon: '⏱️', xp: 30, coins: 2 },
  { id: 'flawless', title: 'Без единой ошибки', description: 'Решить головоломку без неудачных попыток', icon: '✨', xp: 60, coins: 4 },
  { id: 'home', title: 'Домой!', description: 'Починить хроно-двигатель', icon: '🚀', xp: 150, coins: 10 },
];

export function achievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** XP за действия (кроме ачивок). */
export const XP = {
  coin: 5,
  roleTaken: 10,
  stagePassed: 20,
  solved: 50,
  likeReceived: 5,
  parBonus: 25,
} as const;

/** Уровень игрока: каждые следующие 100·n XP. 0→1, 100→2, 300→3, 600→4… */
export function levelFromXp(xp: number): { level: number; from: number; to: number } {
  let level = 1;
  let from = 0;
  let step = 100;
  while (xp >= from + step) {
    from += step;
    level++;
    step = 100 * level;
  }
  return { level, from, to: from + step };
}

/** Стикеры-эмоции над головой (клавиши 1–6). */
export const EMOTES = ['👍', '❤️', '😂', '🔥', '😮', '🎉'] as const;
