/** Тестовым ботам — честный вход: регистрация (или логин, если уже есть) и токен в SDK. */
import { Client } from '@colyseus/sdk';

export const BOT_PASSWORD = 'bot-password-123';

export async function login(url: string, name: string, password = BOT_PASSWORD): Promise<string> {
  const body = JSON.stringify({ name, password });
  const headers = { 'Content-Type': 'application/json' };
  let res = await fetch(`${url}/auth/register`, { method: 'POST', headers, body });
  if (res.status === 409) res = await fetch(`${url}/auth/login`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`login ${name}: HTTP ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

/** SDK-клиент, уже авторизованный под этим логином. */
export async function authedClient(url: string, name: string, password = BOT_PASSWORD): Promise<Client> {
  const client = new Client(url);
  client.http.authToken = await login(url, name, password);
  return client;
}
