#!/usr/bin/env bash
# Поднять весь «Колизиум» в Docker одной командой: npm run up  (или bash scripts/up.sh [сервисы…]).
#  1. LAN-IP хоста → LIVEKIT_NODE_IP (его LiveKit отдаёт браузерам для голоса);
#  2. dev-сертификат в livekit/certs, если его нет (https/wss — иначе микрофон только у хоста);
#  3. docker compose up -d --build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "[up] Docker не запущен — запусти Docker Desktop (или dockerd) и повтори." >&2
  exit 1
fi

# Wi-Fi/Ethernet в приоритете, VPN/Docker-интерфейсы — нет (как в scripts/livekit.sh).
detect_ip() {
  if [[ "$(uname -s)" == Darwin ]]; then
    for i in en0 en1 en2 en3; do
      ipconfig getifaddr "$i" 2>/dev/null && return
    done
    return
  fi
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null \
      | awk '{
          name = $2; sub(/@.*/, "", name); split($4, a, "/");
          if (name ~ /^(en|eth|wlan|wl)/) rank = 0;
          else if (name ~ /^(utun|tun|tap|docker|br-|veth|singbox|vboxnet|vmnet|bridge|llw|awdl)/) rank = 2;
          else rank = 1;
          print rank, a[1];
        }' \
      | sort -n | head -1 | awk '{print $2}'
    return
  fi
  hostname -I 2>/dev/null | awk '{print $1}'
}

export LIVEKIT_NODE_IP="${LIVEKIT_NODE_IP:-$(detect_ip)}"
[[ -z "$LIVEKIT_NODE_IP" ]] && LIVEKIT_NODE_IP=127.0.0.1
# LiveKit в полном стеке — сервис compose, а не процесс на хосте: туда же ходит агент расшифровки.
export TRANSCRIBER_LIVEKIT_URL="${TRANSCRIBER_LIVEKIT_URL:-ws://livekit:17880}"
# И игра — сервис compose: agent-service ходит к ней по имени.
export SERVER_URL="${SERVER_URL:-https://game:2567}"

CERT_DIR="$ROOT/livekit/certs"
if [[ ! -f "$CERT_DIR/dev-cert.pem" || ! -f "$CERT_DIR/dev-key.pem" ]]; then
  echo "[up] Генерирую dev-сертификат (localhost, 127.0.0.1, $LIVEKIT_NODE_IP)…"
  mkdir -p "$CERT_DIR"
  SUBJ="/CN=chronolet-dev"
  SAN="subjectAltName=DNS:localhost,DNS:chronolet.local,IP:127.0.0.1,IP:$LIVEKIT_NODE_IP"
  if ! openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
      -keyout "$CERT_DIR/dev-key.pem" -out "$CERT_DIR/dev-cert.pem" \
      -subj "$SUBJ" -addext "$SAN" >/dev/null 2>&1; then
    # Нет подходящего openssl на хосте — генерируем в контейнере.
    docker run --rm -v "$CERT_DIR:/out" alpine:3.20 sh -c \
      "apk add --no-cache openssl >/dev/null && openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
       -keyout /out/dev-key.pem -out /out/dev-cert.pem -subj '$SUBJ' -addext '$SAN' >/dev/null 2>&1"
  fi
fi

# LLM: нативная Ollama на хосте (на Mac — GPU) быстрее Docker-версии в десятки раз. Нет её — поднимаем в Docker.
if curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && ! docker compose ps --status running ollama 2>/dev/null | grep -q ollama; then
  echo "[up] LLM: нативная Ollama на хосте (:11434)"
else
  echo "[up] LLM: нативной Ollama нет — поднимаю в Docker (медленно; на Mac лучше: brew install ollama && ollama serve)"
  export COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}docker-ollama"
  export OLLAMA_URL="${OLLAMA_URL:-http://ollama:11434}"
fi

echo "[up] LAN-IP для голоса: $LIVEKIT_NODE_IP"
docker compose up -d --build "$@"

echo
echo "[up] Готово. Игра:  https://localhost:2567   ·   с других ноутбуков: https://$LIVEKIT_NODE_IP:2567"
echo "[up] Сертификат самоподписанный: в браузере — «Дополнительно → Перейти»; для голоса то же сделать на https://$LIVEKIT_NODE_IP:7880"
echo "[up] Логи: docker compose logs -f game agent-service   ·   стоп: npm run down"
