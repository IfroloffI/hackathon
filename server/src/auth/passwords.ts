import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Пароли: scrypt (встроен в Node, без нативных зависимостей) с солью.
 * Формат хэша: `scrypt$<N>$<соль hex>$<ключ hex>`. Асинхронно — не блокирует тики комнат.
 */
const N = 16384;
const KEYLEN = 32;

export const PASSWORD_RULES = { min: 6, max: 72 } as const;

function derive(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N);
  return `scrypt$${N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, saltHex, keyHex] = stored.split('$');
  if (algo !== 'scrypt' || !n || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await derive(password, Buffer.from(saltHex, 'hex'), Number(n));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Пароль годится: длина в пределах правил. */
export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Нужен пароль';
  if (raw.length < PASSWORD_RULES.min) return `Пароль — минимум ${PASSWORD_RULES.min} символов`;
  if (raw.length > PASSWORD_RULES.max) return `Пароль — максимум ${PASSWORD_RULES.max} символов`;
  return null;
}
