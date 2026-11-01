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

# ZeroTier — приоритетнее Wi-Fi: если сегмент команды поднят, команда сидит в нём
# (веню-Wi-Fi часто режет P2P). Иначе Wi-Fi/Ethernet; VPN/Docker-интерфейсы — нет.
# macOS: ZeroTier 1.16+ поднимает feth*-пару, а не zt0, и configd про неё не знает —
# поэтому ifconfig, а не ipconfig.
detect_ip() {
  if [[ "$(uname -s)" == Darwin ]]; then
    for if in $(ifconfig -l 2>/dev/null | tr ' ' '\n' | grep -E '^(zt|feth)'); do
      local ip
      ip=$(ifconfig "$if" 2>/dev/null | awk '/[[:space:]]inet[[:space:]]/{print $2; exit}')
      [[ -n "$ip" ]] && { echo "$ip"; return; }
    done
    for i in en0 en1 en2 en3; do
      ipconfig getifaddr "$i" 2>/dev/null && return
    done
    return
  fi
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null \
      | awk '{
          name = $2; sub(/@.*/, "", name); split($4, a, "/");
          if (name ~ /^(zt|feth)/) rank = -1;
          else if (name ~ /^(en|eth|wlan|wl)/) rank = 0;
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
# Адрес, который игра рекламирует в invite-ссылках и UDP-маяке (/api/host, LAN_IP).
# В контейнере game своих LAN-интерфейсов нет — передаём адрес хоста снаружи.
export LAN_IP="${LAN_IP:-$LIVEKIT_NODE_IP}"

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

echo "[up] LAN-IP для голоса: $LIVEKIT_NODE_IP"
docker compose up -d --build "$@"

echo
echo "[up] Готово. Игра:  https://localhost:2567   ·   с других ноутбуков: https://$LIVEKIT_NODE_IP:2567"
echo "[up] Сертификат самоподписанный: в браузере — «Дополнительно → Перейти»; для голоса то же сделать на https://$LIVEKIT_NODE_IP:7880"
echo "[up] Логи: docker compose logs -f game agent-service   ·   стоп: npm run down"
