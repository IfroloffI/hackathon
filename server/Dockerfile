# Игра целиком: Fastify + Colyseus (server) и собранный клиент (client/dist) на одном порту 2567.
# Сборка из корня репозитория: docker compose build game (контекст «.»).
# glibc-образ, а не alpine: у @duckdb/node-api готовые бинарники только под glibc.
FROM node:22-bookworm-slim
WORKDIR /app

# Сначала только манифесты — слой с зависимостями переиспользуется, пока они не менялись.
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY agent-service/package.json agent-service/
RUN npm ci --no-audit --no-fund

COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build -w client

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=2567
EXPOSE 2567
# Без npm: сигналы (docker stop) доходят до сервера, и он успевает сохранить позиции.
WORKDIR /app/server
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]
