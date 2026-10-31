import { randomUUID, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AuthPlayer } from '@chronolet/shared';
import { config } from '../config.ts';

/**
 * Именованный игрок → JWT (HS256). Паролей нет: токен просто подписывает
 * идентичность. Logout работает через in-memory blacklist по `jti`.
 *
 * Секрет общий с `@colyseus/auth`: при заданном `JWT_SECRET` она сама
 * проверяет Bearer-токены на matchmake-роутах Colyseus.
 */

let key: Uint8Array | null = null;

function getKey(): Uint8Array {
  if (key === null) {
    const secret = config.auth.secret;
    if (secret === undefined || secret.length === 0) {
      key = randomBytes(32);
      console.warn('[auth] JWT_SECRET не задан — секрет сгенерирован на этот запуск, токены переживут только его');
    } else {
      key = new TextEncoder().encode(secret);
    }
  }
  return key;
}

const revokedJti = new Set<string>();

export interface VerifiedPlayer extends AuthPlayer {
  jti: string;
}

export async function issueToken(player: AuthPlayer): Promise<string> {
  return await new SignJWT({ name: player.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(player.id)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(config.auth.ttl)
    .sign(getKey());
}

export async function verifyToken(token: string): Promise<VerifiedPlayer | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ['HS256'] });
    const player = toPlayer(payload);
    if (player === null) { return null; }
    if (player.jti !== undefined && revokedJti.has(player.jti)) { return null; }
    return player;
  } catch {
    return null;
  }
}

export function revokeToken(token: string): void {
  try {
    const decoded = decodeJti(token);
    if (decoded !== null) { revokedJti.add(decoded); }
  } catch {
    // невалидный токен и так не пройдёт verify — добавлять нечего
  }
}

function decodeJti(token: string): string | null {
  // jose::decodeJwt не проверяет подпись — jti нужен только для blacklist,
  // сам факт отсутствия подписи отсеется в verifyToken.
  const [, payloadPart] = token.split('.');
  if (payloadPart === undefined) { return null; }
  const payload = JSON.parse(new TextDecoder().decode(Buffer.from(payloadPart, 'base64url'))) as { jti?: string };
  return typeof payload.jti === 'string' ? payload.jti : null;
}

function toPlayer(payload: JWTPayload): VerifiedPlayer | null {
  const { sub, name, jti } = payload;
  if (typeof sub !== 'string' || typeof name !== 'string' || name.length === 0) { return null; }
  return { id: sub, name, jti: typeof jti === 'string' ? jti : '' };
}

export function getBearerToken(headerValue: string | undefined): string | null {
  if (headerValue === undefined) { return null; }
  const [scheme, token] = headerValue.split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
