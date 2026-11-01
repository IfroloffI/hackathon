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

# Primary LAN IP — как в scripts/livekit.sh и server/src/net/lan.ts:
# Wi-Fi/Ethernet (en|eth|wlan|wl) приоритетны, VPN/Docker — в конце.
detect_ip() {
  if [[ "$(uname -s)" == Darwin ]]; then
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
        else rank = 1; print rank, a[1];
      }' | sort -n | head -1 | awk '{print $2}'
  else
    hostname -I 2>/dev/null | awk '{print $1}'
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
