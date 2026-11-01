#!/usr/bin/env bash
# Ветка frontend отдельно от текущей: своя рабочая копия (git worktree), свои node_modules и data/,
# свой порт — можно держать запущенной параллельно с этой веткой (у неё порт 2567).
#
#   npm run frontend              # создать/обновить копию, собрать клиент, запустить на :3567
#   FRONTEND_PORT=4000 npm run frontend
#   FRONTEND_DIR=~/fe npm run frontend
#
# Режим «боевой» (build + start): в dev ветка frontend жёстко ходит на :2567, т. е. в сервер этой ветки.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${FRONTEND_BRANCH:-frontend}"
DIR="${FRONTEND_DIR:-$ROOT/../$(basename "$ROOT")-$BRANCH}"
PORT="${FRONTEND_PORT:-3567}"

if [[ ! -d "$DIR" ]]; then
  echo "[frontend] Создаю рабочую копию ветки $BRANCH в $DIR"
  git -C "$ROOT" worktree add "$DIR" "$BRANCH"
fi
DIR="$(cd "$DIR" && pwd)"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[frontend] Порт $PORT занят — уже запущено? Другой порт: FRONTEND_PORT=4000 npm run frontend" >&2
  exit 1
fi

cd "$DIR"
# Зависимости — заново, только если поменялся package-lock.json.
if [[ ! -d node_modules || package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo "[frontend] npm install…"
  npm install --no-audit --no-fund
fi

echo "[frontend] Сборка клиента ($(git rev-parse --short HEAD) на $BRANCH)…"
npm run build

echo "[frontend] Запуск: http://localhost:$PORT  (данные — $DIR/data)"
PORT="$PORT" exec npm start
