#!/usr/bin/env node
// TLS-терминатор LiveKit: публично wss://<хост>:7880 → wss внутренний livekit:17880.
// LiveKit-сервер сам не умеет TLS; без wss браузеры на https-странице
// блокируют ws:// как mixed content (у «других игроков» голос не улетает).
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const certPath = process.env.TLS_CERT ?? path.join(root, 'livekit', 'certs', 'dev-cert.pem');
const keyPath = process.env.TLS_KEY ?? path.join(root, 'livekit', 'certs', 'dev-key.pem');
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error(`[livekit-tls] нет сертификата — запусти scripts/cert.sh`);
  process.exit(1);
}

const UPSTREAM_HOST = process.env.LIVEKIT_SIGNAL_HOST ?? '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.LIVEKIT_SIGNAL_PORT ?? 17880);
const PUBLIC_PORT = Number(process.env.LIVEKIT_TLS_PORT ?? 7880);

let requests = 0, sockets = 0;

const tlsProxy = https.createServer(
  { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
  (req, res) => {
    requests++;
    const upstream = http.request(
      {
        host: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        method: req.method,
        path: req.url,
        headers: { ...req.headers }, // Host сохраняем — LiveKit не ограничивает
      },
      (uRes) => {
        res.writeHead(uRes.statusCode ?? 502, uRes.headers);
        uRes.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(`{"error":"livekit недоступен (${e.code ?? e.message}) — запусти npm run livekit"}`);
    });
    req.pipe(upstream);
  },
);

/** WebSocket upgrade не проходит через http.request — прокидываем сырой TCP. */
tlsProxy.on('upgrade', (req, socket, head) => {
  sockets++;
  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  }
  const toUpstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    toUpstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length > 0) toUpstream.write(head);
    socket.pipe(toUpstream);
    toUpstream.pipe(socket);
  });
  const fail = (e) => {
    console.error(`[livekit-tls] upgrade провален: ${e.message}`);
    socket.destroy();
    toUpstream.destroy();
  };
  toUpstream.on('error', fail);
  socket.on('error', fail);
});

tlsProxy.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log(`[livekit-tls] wss://0.0.0.0:${PUBLIC_PORT} → ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});
tlsProxy.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[livekit-tls] порт ${PUBLIC_PORT} занят — TLS-прокси уже запущен (pkill -f livekit-tls.mjs, если нужно перезапустить)`);
    process.exit(1);
  }
  console.error(`[livekit-tls] ${e.message}`);
  process.exit(1);
});

const stats = setInterval(() => {
  console.log(`[livekit-tls] http=${requests} ws-open=${sockets}`);
  requests = 0; sockets = 0;
}, 30_000);
stats.unref();
