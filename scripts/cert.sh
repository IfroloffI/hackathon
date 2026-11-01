#!/usr/bin/env bash
# Самоподписанный dev-сертификат для HTTPS/WSS (Fastify :2567, Vite :5173, LiveKit :7880).
# Без него микрофон работает только у хоста: getUserMedia требует secure context.
# Повторный запуск просто перегенерирует сертификат.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${CERT_DIR:-$ROOT/livekit/certs}"
CERT="$CERT_DIR/dev-cert.pem"
KEY="$CERT_DIR/dev-key.pem"
DAYS="${CERT_DAYS:-3650}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "[cert] Нет openssl (macOS: brew install openssl@3)" >&2
  exit 1
fi

# Primary LAN IP — как в server/src/net/lan.ts: ZeroTier-сегмент команды
# (zt*/feth*) приоритетнее Wi-Fi (веню-сеть режет P2P), затем Wi-Fi/Ethernet.
detect_ip() {
  if [[ "$(uname -s)" == Darwin ]]; then
    for ifc in $(ifconfig -l 2>/dev/null | tr ' ' '\n' | grep -E '^(zt|feth)'); do
      local ip
      ip=$(ifconfig "$ifc" 2>/dev/null | awk '/[[:space:]]inet[[:space:]]/{print $2; exit}')
      [[ -n "$ip" ]] && { echo "$ip"; return 0; }
    done
    local ifc2
    ifc2="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
    for i in $ifc2 en0 en1; do
      ipconfig getifaddr "$i" 2>/dev/null && return 0
    done
    return 0
  fi
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null \
      | awk '{
          name = $2; sub(/@.*/, "", name); split($4, a, "/");
          if (name ~ /^(zt|feth)/) rank = -1;
          else if (name ~ /^(en|eth|wlan|wl)/) rank = 0;
          else if (name ~ /^(utun|tun|tap|docker|br-|veth|singbox|vboxnet|vmnet|bridge|llw|awdl)/) rank = 2;
          else rank = 1; print rank, a[1];
        }' | sort -n | head -1 | awk '{print $2}'
  fi
}

IP="${CERT_IP:-$(detect_ip)}"
[[ -z "$IP" ]] && IP=127.0.0.1

mkdir -p "$CERT_DIR"
openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -days "$DAYS" \
  -keyout "$KEY" -out "$CERT" \
  -subj "/CN=chronolet-dev" \
  -addext "subjectAltName=DNS:localhost,DNS:chronolet.local,IP:127.0.0.1,IP:$IP" \
  >/dev/null 2>&1 || {
    echo "[cert] openssl не смог выпустить сертификат (старый LibreSSL без -addext?)." >&2
    echo "[cert] macOS: brew install openssl@3 && PATH=\"\$(brew --prefix openssl@3)/bin:\$PATH\" bash scripts/cert.sh" >&2
    exit 1
  }

echo "[cert] Сертификат на $DAYS дней: $CERT"
echo "[cert]  SAN: localhost, 127.0.0.1${IP:+, IP:$IP}"
