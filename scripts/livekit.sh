#!/usr/bin/env bash
# Скачивает (один раз) и запускает LiveKit-сервер для голосового чата.
# Linux: без Docker, бинарник в .cache/livekit. macOS: brew install livekit (сборок под mac
# в релизах GitHub нет; Docker на маке не пропускает UDP-медиа из LAN в контейнер).
set -euo pipefail

VERSION="${LIVEKIT_VERSION:-v1.13.11}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/.cache/livekit"
BIN="$CACHE/livekit-server"

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *)
    echo "[livekit] Неподдерживаемая ОС: $(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  armv7l | armv7) ARCH=armv7 ;;
  *)
    echo "[livekit] Неподдерживаемая архитектура: $(uname -m)" >&2
    exit 1
    ;;
esac

if [[ "$OS" == darwin ]]; then
  BIN="$(command -v livekit-server || true)"
  if [[ -z "$BIN" ]]; then
    echo "[livekit] Нет livekit-server. Установи: brew install livekit" >&2
    exit 1
  fi
elif [[ ! -x "$BIN" ]]; then
  echo "[livekit] Скачиваю LiveKit $VERSION ($OS/$ARCH)…"
  mkdir -p "$CACHE"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  URL="https://github.com/livekit/livekit/releases/download/$VERSION/livekit_${VERSION#v}_${OS}_${ARCH}.tar.gz"
  curl -fL --retry 3 --retry-delay 2 "$URL" -o "$TMP/livekit.tgz"
  tar -xzf "$TMP/livekit.tgz" -C "$CACHE"
  chmod +x "$BIN"
fi

# Адрес, который LiveKit объявит браузерам в ICE-кандидатах.
# Сначала Wi-Fi/Ethernet, затем прочие, VPN/Docker-интерфейсы — в конце.
detect_ip() {
  if [[ "$OS" == darwin ]]; then
    # Интерфейс маршрута по умолчанию (Wi-Fi/Ethernet), затем en0/en1.
    local ifc
    ifc="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
    for i in $ifc en0 en1; do
      ipconfig getifaddr "$i" 2>/dev/null && return 0
    done
    return 0
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

NODE_IP="${LIVEKIT_NODE_IP:-$(detect_ip)}"
[[ -z "$NODE_IP" ]] && NODE_IP=127.0.0.1

# LiveKit вешает 7881 (RTC TCP), TLS-прокси — 7880. Если занято — кто-то уже запущен.
port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"
  else
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  fi
}
if port_busy 7881 || port_busy 7880; then
  echo "[livekit] Порт(ы) 7880/7881 уже занят — LiveKit, похоже, уже запущен." >&2
  echo "[livekit] Перед перезапуском останови старые процессы:" >&2
  echo "[livekit]   pkill -f livekit-server; pkill -f livekit-tls.mjs" >&2
  exit 1
fi

echo "[livekit] внутренний сигналинг: ws://127.0.0.1:17880 → wss (TLS) на 7880 · RTC TCP 7881 · UDP 50000-50100"
exec "$BIN" --config "$ROOT/livekit/livekit.yaml" --node-ip "$NODE_IP"
