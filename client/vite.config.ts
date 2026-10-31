import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Доступен с других ноутбуков в LAN.
    host: true,
    port: 5173,
  },
  build: { outDir: 'dist', target: 'es2022' },
});
