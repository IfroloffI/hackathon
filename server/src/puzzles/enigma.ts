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

interface Intercept {
  plain: string;
  cipher: string;
  key: readonly [number, number, number];
  cribPos: number;
}

/** Перехват с ключом, при котором правило «буква ≠ себе» оставляет не больше двух позиций crib. */
function makeIntercept(rand: () => number, avoid?: string): Intercept {
  let best: (Intercept & { n: number }) | null = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const [pre, post] = MESSAGES[Math.floor(rand() * MESSAGES.length)];
    const plain = pre + CRIB + post;
    if (plain === avoid) continue;
    const key = [0, 0, 0].map(() => 1 + Math.floor(rand() * 25)) as [number, number, number];
    const cipher = encrypt(plain, key);
    const n = cribCandidates(cipher).length;
    if (!best || n < best.n) best = { plain, cipher, key, cribPos: pre.length, n };
    if (n <= 2) break;
  }
  return best!;
}

const INTERCEPTS = 2;

/**
 * «Взлом Энигмы». Для каждого из двух перехватов (ключ меняется):
 * этап «crib» — Наблюдатель находит позицию WETTERBERICHT; этап «rotors» — Наблюдатель диктует
 * пары «открытая → шифр», Механик подбирает роторы по таблицам замен.
 */
export class EnigmaPuzzle extends Puzzle {
  readonly id = 'enigma' as const;
  readonly hints = [
    'У Энигмы есть слабость: буква никогда не шифруется сама в себя.',
    'Двигайте WETTERBERICHT вдоль шифровки и отбрасывайте позиции, где хоть одна буква совпала.',
    'Позиция найдена? Каждая пара «буква → шифр» задаёт сдвиг своего ротора: ротор = номер позиции по модулю 3.',
  ] as const;

  private intercepts: Intercept[];
  private current = 0;
  private stage_: 'crib' | 'rotors' | 'solved' = 'crib';
  private rotors: [number, number, number] = [1, 1, 1];

  constructor(rand = Math.random) {
    super();
    const first = makeIntercept(rand);
    this.intercepts = [first, makeIntercept(rand, first.plain)];
  }

  private get ic(): Intercept {
    return this.intercepts[Math.min(this.current, INTERCEPTS - 1)];
  }
  // Для тестов и ботов: данные текущего перехвата.
  get plain() {
    return this.ic.plain;
  }
  get cipher() {
    return this.ic.cipher;
  }
  get key() {
    return this.ic.key;
  }
  get cribPos() {
    return this.ic.cribPos;
  }

  stageText(): string {
    const n = `Перехват ${this.current + 1} из ${INTERCEPTS}`;
    if (this.stage_ === 'crib') return `${n}: Наблюдатель ищет, где прячется WETTERBERICHT`;
    if (this.stage_ === 'rotors') return `${n}: Механик подбирает роторы по парам букв`;
    return `Расшифровано: ${this.intercepts.map((i) => i.plain).join(' / ')}`;
  }

  view(role: Role): EnigmaObserverView | EnigmaMechanicView {
    if (role === 'observer') {
      return {
        intercept: Math.min(this.current, INTERCEPTS - 1),
        intercepts: INTERCEPTS,
        stage: this.stage_,
        cipher: this.cipher,
        crib: CRIB,
        cribPos: this.stage_ === 'crib' ? null : this.cribPos,
        plaintext: this.stage_ === 'solved' ? this.plain : null,
      };
    }
    return {
      intercept: Math.min(this.current, INTERCEPTS - 1),
      intercepts: INTERCEPTS,
      stage: this.stage_,
      rotors: [...this.rotors],
      tables: [rotorTable(this.rotors[0]), rotorTable(this.rotors[1]), rotorTable(this.rotors[2])],
    };
  }

  act(role: Role, action: string, value: unknown): ActionResult | null {
    if (this.solved) return null;
    if (role === 'observer' && this.stage_ === 'crib' && action === 'crib') {
      const p = num(value, 0, this.cipher.length);
      if (p === null || !Number.isInteger(p)) return null;
      if (p !== this.cribPos) return this.fail(`Позиция ${p + 1} не подошла`);
      this.stage_ = 'rotors';
      return this.stage(`Перехват ${this.current + 1}: WETTERBERICHT найдено`);
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
      if (action === 'check' && this.stage_ === 'rotors') {
        if (this.rotors.some((r, i) => r !== this.key[i])) return this.fail('Расшифровка выходит бессмыслицей');
        const read = this.plain;
        this.current++;
        if (this.current === INTERCEPTS) {
          this.stage_ = 'solved';
          return this.win(`Оба сообщения прочитаны. Последнее: ${read}`);
        }
        this.stage_ = 'crib';
        this.rotors = [1, 1, 1];
        return this.stage(`Прочитано: ${read}. Пришёл новый перехват — ключ сменился`);
      }
    }
    return null;
  }
}
