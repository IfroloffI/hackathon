import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Тот же dev-сертификат, что выдаёт сервер (scripts/cert.sh): страница по https,
// иначе getUserMedia/RTCPeerConnection недоступны не-хостам (une secure context).
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const certPath = process.env.TLS_CERT ?? path.join(root, 'livekit', 'certs', 'dev-cert.pem');
const keyPath = process.env.TLS_KEY ?? path.join(root, 'livekit', 'certs', 'dev-key.pem');
const hasCert = fs.existsSync(certPath) && fs.existsSync(keyPath);

export default defineConfig({
  server: {
    // Доступен с других ноутбуков в LAN.
    host: true,
    port: 5173,
    ...(hasCert
      ? { https: { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) } }
      : {}),
  },
  build: { outDir: 'dist', target: 'es2022' },
});
