import type { PuzzleId } from '@chronolet/shared';
import type { Puzzle } from './Puzzle.ts';
import { EratosthenesPuzzle } from './eratosthenes.ts';
import { GalileoPuzzle } from './galileo.ts';
import { NewtonPuzzle } from './newton.ts';
import { EnigmaPuzzle } from './enigma.ts';
import { KorolevPuzzle } from './korolev.ts';

export { Puzzle, type ActionResult, type PuzzleEvent } from './Puzzle.ts';

export function createPuzzle(id: PuzzleId): Puzzle {
  switch (id) {
    case 'eratosthenes':
      return new EratosthenesPuzzle();
    case 'galileo':
      return new GalileoPuzzle();
    case 'newton':
      return new NewtonPuzzle();
    case 'enigma':
      return new EnigmaPuzzle();
    case 'korolev':
      return new KorolevPuzzle();
  }
}
