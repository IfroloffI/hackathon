/**
 * Приватные «виды» головоломок: сервер шлёт каждой роли только её вид (сообщение puzzle.view).
 * Наблюдатель не получает данных Механика и наоборот — асимметрию не сломать через DevTools.
 */
import type { PuzzleId, Role } from './epochs.ts';

// --- Эратосфен: «Тень и колодец»
export type EratStage = 'measure' | 'compute' | 'confirm' | 'solved';
export interface EratObserverView {
  stage: EratStage;
  /** Расстояние Сиена — Александрия, стадии. */
  distance: number;
  angleLocked: boolean;
  /** Что Механик набрал на счётах — видно на этапе подтверждения. */
  abacus: number | null;
}
export interface EratMechanicView {
  stage: EratStage;
  /** Угол дуги, которую двигает Механик, градусы. */
  arc: number;
  /** Угол тени гномона — Механик видит тень, но не знает расстояние. */
  shadow: number;
  locked: boolean;
  abacus: number | null;
}

// --- Галилей: «Фазы Венеры»
export type VenusPhase = 'new' | 'crescent' | 'half' | 'gibbous' | 'full';
export interface GalileoObserverView {
  stage: 'nights' | 'moons' | 'solved';
  night: number;
  nights: number;
  /** Что видно в телескопе этой ночью; null — небо затянуто облаками. */
  phase: VenusPhase | null;
  /** Освещённая доля диска, 0..1 — для рисования; null — облака. */
  lit: number | null;
  clouds: boolean;
  /** Этап спутников: положения лун Юпитера (смещение по x) за две ночи. */
  moons: number[][] | null;
  solved: boolean;
}
export interface GalileoMechanicView {
  night: number;
  nights: number;
  scheme: 'geo' | 'helio';
  /** Положение Венеры на орбите/эпицикле, градусы. */
  angle: number;
  /** Координаты для схемы модели (единицы — радиус орбиты Земли). */
  sun: [number, number];
  earth: [number, number];
  venus: [number, number];
  stage: 'nights' | 'moons' | 'solved';
  /** Ответ Механика на этапе спутников. */
  moonsAnswer: number | null;
  solved: boolean;
}

// --- Ньютон: «Законы движения»
export interface NewtonShot {
  landing: number;
  points: [number, number][];
}
export interface NewtonObserverView {
  /** Номер мишени (с 0) и сколько всего. */
  round: number;
  rounds: number;
  target: number;
  tolerance: number;
  /** Ветер вдоль поля, м/с (+ — от пушки к мишени). Видит только Наблюдатель — по флюгеру. */
  wind: number;
  shots: NewtonShot[];
  solved: boolean;
}
export interface NewtonMechanicView {
  speed: number;
  angle: number;
  speedRange: [number, number];
  angleRange: [number, number];
  shotsFired: number;
  round: number;
  rounds: number;
  solved: boolean;
}

// --- Тьюринг: «Взлом Энигмы»
export interface EnigmaObserverView {
  /** Номер перехвата (с 0) и сколько всего. */
  intercept: number;
  intercepts: number;
  stage: 'crib' | 'rotors' | 'solved';
  cipher: string;
  crib: string;
  /** Найденная позиция crib (с 0), когда этап 1 пройден. */
  cribPos: number | null;
  plaintext: string | null;
}
export interface EnigmaMechanicView {
  intercept: number;
  intercepts: number;
  stage: 'crib' | 'rotors' | 'solved';
  /** Положения трёх роторов, 1..25 (сдвиг; 0 запрещён — буква не шифруется в себя). */
  rotors: [number, number, number];
  /** Для каждого ротора — во что он превращает A..Z при текущем положении. */
  tables: [string, string, string];
}

// --- Королёв: «Первый полёт»
export type EngineType = 'A' | 'B';
export interface RocketStage {
  tanks: number;
  engine: EngineType;
}
export interface KorolevLaunch {
  stages: { dv: number; m0: number; m1: number }[];
  total: number;
  required: number;
  ok: boolean;
  reason: string;
}
export interface KorolevObserverView {
  required: number;
  engines: Record<EngineType, { ve: number }>;
  /** Текущая конфигурация — только интегральные цифры, без раскладки по ступеням. */
  mass: number;
  fuel: number;
  massLimit: number;
  launches: KorolevLaunch[];
  solved: boolean;
}
export interface KorolevMechanicView {
  stages: RocketStage[];
  maxStages: number;
  maxTanks: number;
  parts: { tank: { fuel: number; dry: number }; engines: Record<EngineType, { mass: number }>; payload: number };
  mass: number;
  massLimit: number;
  launches: number;
  solved: boolean;
}

export interface PuzzleViewMessage {
  puzzleId: PuzzleId;
  role: Role | null;
  view: unknown;
}
