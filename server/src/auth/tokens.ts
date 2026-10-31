import { randomUUID, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
import type { AuthPlayer } from '@chronolet/shared';
import { config } from '../config.ts';

// ============================================================
// JWT для Colyseus
// ============================================================

let key: Uint8Array | null = null;

function getKey(): Uint8Array {
  if (key === null) {
    const secret = config.auth.secret;
    if (secret === undefined || secret.length === 0) {
      key = randomBytes(32);
      console.warn('[auth] JWT_SECRET не задан');
    } else {
      key = new TextEncoder().encode(secret);
    }
  }
  return key;
}

let revokedJti = new Set<string>();

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
    const player = { id: String(payload.sub), name: String(payload.name), jti: String(payload.jti) };
    if (player.jti !== undefined && revokedJti.has(player.jti)) { return null; }
    return player;
  } catch {
    return null;
  }
}

export function revokeToken(token: string): void {
  try {
    const [, payloadPart] = token.split('.');
    if (payloadPart) {
      const p = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
      if (p.jti) revokedJti.add(p.jti);
    }
  } catch { }
}

export function getBearerToken(headerValue: string | undefined): string | null {
  if (headerValue === undefined) { return null; }
  const [scheme, token] = headerValue.split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

// ============================================================
// LiveKit Access Token
// ============================================================

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
