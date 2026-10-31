import type { EnigmaMechanicView, EnigmaObserverView, Role } from '@chronolet/shared';
import { Puzzle, num, type ActionResult } from './Puzzle.ts';

const A = 'A'.charCodeAt(0);
export const CRIB = 'WETTERBERICHT';
const MESSAGES = [
  ['MORGEN', 'NEBELIMKANAL'],
  ['FUNKSPRUCH', 'REGENUNDWINDNORD'],
  ['HEUTE', 'KLARESWETTERSEE'],
  ['ANALLE', 'STURMWARNUNGWEST'],
];

/**
 * Упрощённая «Энигма» (раздел 4.4 дизайн-дока): 3 ротора, позиция i шифруется ротором i mod 3,
 * сдвиг ротора 1..25. Сдвиг 0 запрещён — поэтому, как у настоящей Энигмы, буква никогда не шифруется в себя.
 */
export function encrypt(plain: string, rotors: readonly number[]): string {
  let out = '';
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode(((plain.charCodeAt(i) - A + rotors[i % 3]) % 26) + A);
  }
  return out;
}

export function decrypt(cipher: string, rotors: readonly number[]): string {
  return encrypt(cipher, rotors.map((r) => 26 - r));
}

/** Позиции, где crib не противоречит правилу «буква не шифруется в себя». */
export function cribCandidates(cipher: string, crib = CRIB): number[] {
  const res: number[] = [];
  for (let p = 0; p + crib.length <= cipher.length; p++) {
    let ok = true;
    for (let t = 0; t < crib.length && ok; t++) if (cipher[p + t] === crib[t]) ok = false;
    if (ok) res.push(p);
  }
  return res;
}

const rotorTable = (shift: number) => encrypt('ABCDEFGHIJKLMNOPQRSTUVWXYZ', [shift, shift, shift]);

/**
 * «Взлом Энигмы». Этап 1: Наблюдатель находит позицию WETTERBERICHT в перехвате.
 * Этап 2: Наблюдатель диктует пары «открытая → шифр», Механик подбирает роторы, видя таблицы замен.
 */
export class EnigmaPuzzle extends Puzzle {
  readonly id = 'enigma' as const;
  readonly hints = [
    'У Энигмы есть слабость: буква никогда не шифруется сама в себя.',
    'Двигайте WETTERBERICHT вдоль шифровки и отбрасывайте позиции, где хоть одна буква совпала.',
    'Позиция найдена? Каждая пара «буква → шифр» задаёт сдвиг своего ротора: ротор = номер позиции по модулю 3.',
  ] as const;

  readonly plain: string;
  readonly cipher: string;
  readonly key: readonly [number, number, number];
  readonly cribPos: number;
  private stage: 'crib' | 'rotors' | 'solved' = 'crib';
  private rotors: [number, number, number] = [1, 1, 1];

  constructor(rand = Math.random) {
    super();
    // Подбираем ключ так, чтобы по правилу «буква ≠ себе» оставалось не больше двух позиций.
    let best: { plain: string; cipher: string; key: [number, number, number]; pos: number; n: number } | null = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const [pre, post] = MESSAGES[Math.floor(rand() * MESSAGES.length)];
      const plain = pre + CRIB + post;
      const key: [number, number, number] = [0, 0, 0].map(() => 1 + Math.floor(rand() * 25)) as [number, number, number];
      const cipher = encrypt(plain, key);
      const n = cribCandidates(cipher).length;
      if (!best || n < best.n) best = { plain, cipher, key, pos: pre.length, n };
      if (n <= 2) break;
    }
    this.plain = best!.plain;
    this.cipher = best!.cipher;
    this.key = best!.key;
    this.cribPos = best!.pos;
  }

  stageText(): string {
    if (this.stage === 'crib') return 'Этап 1: Наблюдатель ищет, где в перехвате прячется WETTERBERICHT';
    if (this.stage === 'rotors') return 'Этап 2: Механик подбирает положения роторов по парам букв';
    return `Расшифровано: ${this.plain}`;
  }

  view(role: Role): EnigmaObserverView | EnigmaMechanicView {
    if (role === 'observer') {
      return {
        stage: this.stage,
        cipher: this.cipher,
        crib: CRIB,
        cribPos: this.stage === 'crib' ? null : this.cribPos,
        plaintext: this.stage === 'solved' ? this.plain : null,
      };
    }
    return {
      stage: this.stage,
      rotors: [...this.rotors],
      tables: [rotorTable(this.rotors[0]), rotorTable(this.rotors[1]), rotorTable(this.rotors[2])],
    };
  }

  act(role: Role, action: string, value: unknown): ActionResult | null {
    if (this.solved) return null;
    if (role === 'observer' && this.stage === 'crib' && action === 'crib') {
      const p = num(value, 0, this.cipher.length);
      if (p === null || !Number.isInteger(p)) return null;
      if (p !== this.cribPos) return this.fail(`Позиция ${p + 1} не подошла`);
      this.stage = 'rotors';
      return { event: 'stage_passed', message: 'WETTERBERICHT найдено в перехвате' };
    }
    if (role === 'mechanic') {
      if (action === 'rotor') {
        const v = value as { index?: unknown; value?: unknown } | null;
        const i = num(v?.index, 0, 2);
        const r = num(v?.value, 1, 25);
        if (i === null || r === null || !Number.isInteger(i) || !Number.isInteger(r)) return null;
        this.rotors[i] = r;
        return {};
      }
      if (action === 'check' && this.stage === 'rotors') {
        if (this.rotors.some((r, i) => r !== this.key[i])) return this.fail('Расшифровка выходит бессмыслицей');
        this.stage = 'solved';
        return this.win(`Сообщение прочитано: ${this.plain}`);
      }
    }
    return null;
  }
}
