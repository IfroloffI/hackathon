import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
import type { AuthPlayer } from '@chronolet/shared';
import { config } from '../config.ts';

/**
 * Игрок (вход по логину и паролю, см. passwords.ts) → JWT (HS256).
 * Logout работает через in-memory blacklist по `jti`.
 *
 * Секрет общий с `@colyseus/auth`: при заданном `JWT_SECRET` она сама
 * проверяет Bearer-токены на matchmake-роутах Colyseus.
 */

let key: Uint8Array | null = null;

function getKey(): Uint8Array {
  if (key === null) {
    const secret = process.env.JWT_SECRET;
    if (secret !== undefined && secret.length > 0) {
      key = new TextEncoder().encode(secret);
    } else {
      // Без JWT_SECRET секрет хранится рядом с БД: токены (и вход по паролю) переживают перезапуск сервера.
      const file = path.join(path.dirname(config.dbPath), '.jwt-secret');
      try {
        key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
      } catch {
        key = randomBytes(32);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(key).toString('hex'), { mode: 0o600 });
        console.warn(`[auth] JWT_SECRET не задан — секрет сгенерирован и сохранён в ${file}`);
      }
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

/**
 * Настоящий AccessToken LiveKit (JWT, подписанный HMAC API-секретом).
 * Только с таким токеном LiveKit пустит участника в комнату и разрешит
 * публиковать/слушать аудио. `identity` — стабильный id игрока.
 */
export async function issueLiveKitToken(player: AuthPlayer, room: string): Promise<string> {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: player.id,
    name: player.name,
    ttl: config.livekit.ttl,
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return await at.toJwt();
}
