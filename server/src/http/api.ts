import express, { type Application } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchMaker } from 'colyseus';
import { CREW_ROOM, type RoomListing } from '@chronolet/shared';
import { sessions } from '../db/repositories.ts';
import { config } from '../config.ts';

/** REST поверх того же хоста. Матчмейкинг (create/join) делает сам Colyseus на /matchmake. */
export function mountHttp(app: Application) {
  app.use((req, res, next) => {
    // В dev клиент живёт на порту Vite — разрешаем кросс-доменные запросы внутри LAN.
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  /** LAN-адреса хоста — из них клиент собирает ссылку-приглашение, даже если открыт как localhost. */
  app.get('/api/host', (_req, res) => {
    res.json({ addresses: lanAddresses() });
  });

  app.get('/api/rooms', async (_req, res) => {
    const rooms = await matchMaker.query({ name: CREW_ROOM });
    const listing: RoomListing[] = rooms
      .filter((r) => !r.private)
      .map((r) => ({
        roomId: r.roomId,
        clients: r.clients,
        maxClients: r.maxClients,
        locked: !!r.locked,
        metadata: r.metadata,
      }));
    res.json(listing);
  });

  /** Для отладки/жюри: что лежит в БД по сессиям. */
  app.get('/api/sessions', (_req, res) => {
    res.json(sessions.list());
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return void res.status(404).json({ error: 'not found' });
    res.json({ session, players: sessions.players(req.params.id) });
  });

  // Prod: тот же хост отдаёт собранный клиент — ноутбукам нужно только открыть http://<ip>:2567
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.get(/^\/(?!api|matchmake).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }
}

/** IPv4-адреса хоста: сначала Wi-Fi/Ethernet (en*, eth*, wlan*), туннели и виртуальные сети — в конец. */
function lanAddresses(): string[] {
  const rank = (name: string) => (/^(en|eth|wlan|wl)/.test(name) ? 0 : /^(utun|tun|tap|docker|br-|veth|vboxnet|vmnet|bridge|llw|awdl)/.test(name) ? 2 : 1);
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address })))
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((i) => i.address);
}
