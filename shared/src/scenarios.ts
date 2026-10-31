/**
 * Сценарии эпох — декларативно: шаги с условиями завершения, контрольным временем (par)
 * и репликами при входе в шаг. Сервер исполняет (ScenarioRuntime), клиент показывает цель,
 * LLM получает id/шаг в каждом событии и полный сценарий через GET /llm/content.
 */

export type StepCondition =
  /** Кто-то из экипажа выслушал агента (E у рассказчика). */
  | { kind: 'talked'; agent: string }
  /** Обе роли заняты. */
  | { kind: 'roles' }
  /** Пройдено не меньше N этапов головоломки. */
  | { kind: 'stages'; atLeast: number }
  | { kind: 'solved' }
  /** Экипаж вернулся на борт. */
  | { kind: 'aboard' };

export interface ScenarioStep {
  id: string;
  title: string;
  /** Что показать игрокам как цель. */
  goal: string;
  done: StepCondition;
  /** Контрольное время шага, с: уложились — бонус XP всему экипажу. */
  parSeconds?: number;
  /** Можно ли занимать роли на этом шаге (до брифинга — нельзя). */
  rolesOpen?: boolean;
  /** Реплика бортового ИИ при входе в шаг. */
  cue?: string;
}

export type BonusKind = 'allCoins' | 'noFalls' | 'noHints' | 'fewAttempts';

export interface ScenarioBonus {
  id: string;
  kind: BonusKind;
  title: string;
  xp: number;
  coins: number;
}

export interface ScenarioDef {
  id: string;
  levelId: string;
  title: string;
  steps: ScenarioStep[];
  bonuses: ScenarioBonus[];
}

const BONUSES: ScenarioBonus[] = [
  { id: 'all_coins', kind: 'allCoins', title: 'Все сферы эпохи', xp: 40, coins: 3 },
  { id: 'no_falls', kind: 'noFalls', title: 'Ни одного падения', xp: 30, coins: 2 },
  { id: 'no_hints', kind: 'noHints', title: 'Без подсказок ХРОНОСа', xp: 50, coins: 3 },
  { id: 'few_attempts', kind: 'fewAttempts', title: 'Не больше 2 ошибок', xp: 30, coins: 2 },
];

function epochScenario(levelId: string, title: string, agent: string, narrator: string, puzzleStages: { goal: string; par: number }[], reachPar: number): ScenarioDef {
  const steps: ScenarioStep[] = [
    { id: 'briefing', title: 'Брифинг', goal: `Найдите и выслушайте: ${narrator}`, done: { kind: 'talked', agent }, parSeconds: 45, cue: `Сначала поговорите с местным: ${narrator}. Роли откроются после брифинга.` },
    { id: 'reach', title: 'К местам ролей', goal: 'Доберитесь до кругов ролей и займите обе (E)', done: { kind: 'roles' }, parSeconds: reachPar, rolesOpen: true, cue: 'Роли открыты. Дорога к ним — не прогулка.' },
  ];
  puzzleStages.forEach((s, i) => {
    const last = i === puzzleStages.length - 1;
    steps.push({ id: `stage${i + 1}`, title: `Этап ${i + 1}`, goal: s.goal, done: last ? { kind: 'solved' } : { kind: 'stages', atLeast: i + 1 }, parSeconds: s.par, rolesOpen: true });
  });
  steps.push({ id: 'extract', title: 'Эвакуация', goal: 'Все к хронолёту — и E', done: { kind: 'aboard' }, parSeconds: 60, rolesOpen: true, cue: 'Деталь у нас. Все на борт!' });
  return { id: `scn_${levelId}`, levelId, title, steps, bonuses: BONUSES };
}

export const SCENARIOS: readonly ScenarioDef[] = [
  epochScenario('alexandria', 'Тень и колодец', 'eratosthenes', 'Эратосфен', [
    { goal: 'Механик: совместите дугу с тенью и зафиксируйте угол', par: 90 },
    { goal: 'Наблюдатель: вычислите окружность, Механик: наберите её на счётах', par: 120 },
    { goal: 'Наблюдатель: подтвердите число на счётах', par: 30 },
  ], 90),
  epochScenario('padua', 'Фазы Венеры', 'galileo', 'Галилей', [
    { goal: 'Ночь 1: совместите модель с наблюдением', par: 90 },
    { goal: 'Ночь 2', par: 90 },
    { goal: 'Ночь 3 (берегитесь облаков)', par: 90 },
    { goal: 'Ночь 4', par: 90 },
    { goal: 'Бонус Галилея: сколько спутников у Юпитера?', par: 60 },
  ], 120),
  epochScenario('woolsthorpe', 'Законы движения', 'newton', 'Ньютон', [
    { goal: 'Попадите в первую мишень (учитывайте ветер)', par: 120 },
    { goal: 'Мишень переставили — попадите снова', par: 120 },
  ], 100),
  epochScenario('bletchley', 'Взлом Энигмы', 'turing', 'Тьюринг', [
    { goal: 'Перехват 1: найдите позицию WETTERBERICHT', par: 120 },
    { goal: 'Перехват 1: подберите роторы', par: 150 },
    { goal: 'Перехват 2: новая шифровка — найдите crib', par: 120 },
    { goal: 'Перехват 2: роторы', par: 150 },
  ], 120),
  epochScenario('baikonur', 'Первый полёт', 'korolev', 'Королёв', [
    { goal: 'Соберите ракету и выведите корабль на орбиту', par: 240 },
  ], 120),
];

export function scenarioForLevel(levelId: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.levelId === levelId);
}
