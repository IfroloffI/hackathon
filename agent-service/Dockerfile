# Сборка из корня репозитория: docker compose build agent-service (контекст «.»).
FROM node:22-alpine
WORKDIR /app
COPY tsconfig.base.json ./
COPY shared ./shared
COPY agent-service ./agent-service
# Зависимости ставим в /app/node_modules — их видят и agent-service, и shared (@colyseus/schema).
# @chronolet/shared — локальный пакет: не из реестра, а симлинк на исходники.
RUN node -e "const p=require('./agent-service/package.json'); const deps={...p.dependencies}; delete deps['@chronolet/shared']; require('fs').writeFileSync('package.json', JSON.stringify({name:'agent-service-image',private:true,type:'module',dependencies:deps}))" \
 && npm install --omit=dev --no-audit --no-fund \
 && mkdir -p node_modules/@chronolet && ln -s ../../shared node_modules/@chronolet/shared
WORKDIR /app/agent-service
ENV NODE_ENV=production
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]
