/** Эпохи из дизайн-дока и chronolet_ideas.docx. Порядок = порядок прохождения. */

export type PuzzleId = 'eratosthenes' | 'galileo' | 'newton' | 'enigma' | 'korolev';
export type Role = 'observer' | 'mechanic';

export interface EpochDef {
  index: number;
  levelId: string;
  title: string;
  year: string;
  narrator: { id: string; name: string };
  puzzle: { id: PuzzleId; title: string };
  part: { id: string; name: string };
}

export const EPOCHS: readonly EpochDef[] = [
  {
    index: 0,
    levelId: 'alexandria',
    title: 'Сиена и Александрия',
    year: '~240 до н. э.',
    narrator: { id: 'eratosthenes', name: 'Эратосфен' },
    puzzle: { id: 'eratosthenes', title: 'Тень и колодец' },
    part: { id: 'gnomon', name: 'Гномон' },
  },
  {
    index: 1,
    levelId: 'padua',
    title: 'Падуя',
    year: '1610',
    narrator: { id: 'galileo', name: 'Галилей' },
    puzzle: { id: 'galileo', title: 'Фазы Венеры' },
    part: { id: 'lens', name: 'Линза' },
  },
  {
    index: 2,
    levelId: 'woolsthorpe',
    title: 'Англия',
    year: '1687',
    narrator: { id: 'newton', name: 'Ньютон' },
    puzzle: { id: 'newton', title: 'Законы движения' },
    part: { id: 'pendulum', name: 'Маятник' },
  },
  {
    index: 3,
    levelId: 'bletchley',
    title: 'Блетчли-парк',
    year: '1941',
    narrator: { id: 'turing', name: 'Тьюринг' },
    puzzle: { id: 'enigma', title: 'Взлом Энигмы' },
    part: { id: 'rotor', name: 'Ротор' },
  },
  {
    index: 4,
    levelId: 'baikonur',
    title: 'Байконур',
    year: '1961',
    narrator: { id: 'korolev', name: 'Королёв' },
    puzzle: { id: 'korolev', title: 'Первый полёт' },
    part: { id: 'fuel_cell', name: 'Топливный элемент' },
  },
];

export const SHIP_AI = { id: 'ship_ai', name: 'ХРОНОС' } as const;

export function epochByLevel(levelId: string): EpochDef | undefined {
  return EPOCHS.find((e) => e.levelId === levelId);
}
