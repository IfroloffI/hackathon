#!/usr/bin/env bash
# Автофикс сетевого конфига macOS-хоста «Колизиума».
#
# Проблема: на маках с корпоративным security-ПО в pf (межсетевой экран ядра)
# живёт политика «block drop in all»: пинги и DNS проходят, а входящий TCP —
# страницы игры, WebSocket — молча дропается. Симптом: «страница не грузится»,
# хотя curl с самого мака работает (self-трафик in-фильтром не режется).
# Правило лечения runtime-only: security-ПО перезагружает pf, и фикс слетает
# (на хакатоне слетал дважды за день) — поэтому нужен автоприменятель.
#
#   sudo bash scripts/mac-net.sh                  # применить сейчас (idempotent)
#   sudo bash scripts/mac-net.sh --status         # показать состояние
#   bash scripts/mac-net.sh --print-subnets       # подсети команды (без root)
#   sudo bash scripts/mac-net.sh --install-daemon # + автоприменение: при загрузке и раз в 30 с
#   sudo bash scripts/mac-net.sh --remove-daemon  # убрать автоприменение
#
# Подсети берутся из живых интерфейсов: ZeroTier (zt*, feth* — ZeroTier 1.16+
# на macOS поднимает feth*), раздача интернета (bridge100+), Wi-Fi/Ethernet
# (en*, eth*). VPN и Docker (utun, vmnet, awdl, docker*) не трогаем.
# Существующие pf-правила читаются и перезагружаются вместе с недостающими —
# чужие не затираются. На не-macOS — тихий no-op. Подробнее: docs/MAC-HOST-SETUP.md.
set -euo pipefail

LABEL="com.chronolet.mac-net"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
LOG="/var/log/${LABEL}.log"
PFCTL=/sbin/pfctl
IFACE_RE='^(zt|feth|bridge[0-9]{2,}|en|eth)'
RULE_RE='^pass in quick inet from ([0-9]+\.){3}[0-9]+/[0-9]+ to any'
QUIET=0

usage() { sed -n '4,19p' "$0"; }

need_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "[mac-net] нужен root: sudo bash scripts/mac-net.sh $1" >&2
    exit 1
  fi
}

# «a.b.c.d/prefix» из ip и hex-маски (0xffffff00 → /24), адрес сети = ip AND mask.
net_of() {
  local ip=$1 m=$2 h a b c d ma mb mc md bits=0 w
  h=${m#0x}
  [[ ${#h} -eq 8 ]] || return 1
  IFS=. read -r a b c d <<< "$ip"
  [[ -n "${a:-}" && -n "${b:-}" && -n "${c:-}" && -n "${d:-}" ]] || return 1
  ma=$(( 0x${h:0:2} )); mb=$(( 0x${h:2:2} )); mc=$(( 0x${h:4:2} )); md=$(( 0x${h:6:2} ))
  w=$(( 0x$h ))
  while [[ $w -ne 0 ]]; do bits=$(( bits + (w & 1) )); w=$(( w >> 1 )); done
  [[ $bits -ge 8 && $bits -le 32 ]] || return 1
  printf "%d.%d.%d.%d/%d\n" $(( a & ma )) $(( b & mb )) $(( c & mc )) $(( d & md )) "$bits"
}

# Подсети команды: по одному /N на каждый живой IPv4-интерфейс, без дублей.
team_subnets() {
  local ifc line ip mask
  for ifc in $(ifconfig -l 2>/dev/null); do
    if [[ "$ifc" =~ $IFACE_RE ]]; then
      line=$(ifconfig "$ifc" 2>/dev/null | awk '/^[[:space:]]*inet[[:space:]]/{print; exit}')
      if [[ -n "$line" ]]; then
        ip=$(printf '%s\n' "$line" | awk '{print $2}')
        mask=$(printf '%s\n' "$line" | awk '{for (i=1;i<=NF;i++) if ($i=="netmask") {print $(i+1); exit}}')
        if [[ -n "${ip:-}" && "${mask:-}" == 0x* ]]; then
          net_of "$ip" "$mask" || true
        fi
      fi
    fi
  done | sort -u
}

pf_enabled() { "$PFCTL" -s info 2>/dev/null | grep -q "Status: Enabled"; }

# block-политика на наших маках сидит в anchor "main"; если он не используется —
# работаем с корневым набором правил.
pf_anchor_used() { "$PFCTL" -s rules 2>/dev/null | grep -q '^anchor "main"'; }

dump_rules() {
  if [[ "$1" == "anchor" ]]; then "$PFCTL" -a main -s rules 2>/dev/null || true
  else "$PFCTL" -s rules 2>/dev/null || true; fi
}

load_rules() {
  if [[ "$1" == "anchor" ]]; then "$PFCTL" -a main -f "$2" >/dev/null 2>&1
  else "$PFCTL" -f "$2" >/dev/null 2>&1; fi
}

apply() {
  if ! pf_enabled; then
    [[ $QUIET -eq 1 ]] || echo "[mac-net] pf выключен — входящий не фильтруется, фикс не нужен"
    return 0
  fi
  local subnets
  subnets=$(team_subnets)
  if [[ -z "$subnets" ]]; then
    [[ $QUIET -eq 1 ]] || echo "[mac-net] живых интерфейсов команды нет — нечего разрешать"
    return 0
  fi
  local scope="top"
  if pf_anchor_used; then scope="anchor"; fi
  local dump
  dump=$(dump_rules "$scope")
  local tmp
  tmp=$(mktemp -t mac-net.XXXXXX)
  printf '%s\n' "$dump" > "$tmp"
  local sn added=0
  while read -r sn; do
    [[ -n "$sn" ]] || continue
    if printf '%s\n' "$dump" | grep -q "from ${sn} to any"; then continue; fi
    printf 'pass in quick inet from %s to any\n' "$sn" >> "$tmp"
    added=1
    echo "[mac-net] $(date '+%Y-%m-%d %H:%M:%S') + pass in quick inet from ${sn} to any"
  done <<< "$subnets"
  if [[ $added -eq 1 ]]; then
    load_rules "$scope" "$tmp"
    [[ $QUIET -eq 1 ]] || echo "[mac-net] pf обновлён (набор: $scope)"
  else
    [[ $QUIET -eq 1 ]] || echo "[mac-net] правила уже на месте (набор: $scope)"
  fi
  rm -f "$tmp"
}

status() {
  echo "== pf =="
  "$PFCTL" -s info 2>/dev/null | grep "^Status" || echo "неизвестно"
  echo "== подсети команды =="
  team_subnets || true
  echo "== наши pass-правила в pf =="
  local scope="top"
  if pf_anchor_used; then scope="anchor"; fi
  dump_rules "$scope" | grep -E "$RULE_RE" || echo "(нет)"
  echo "== LaunchDaemon =="
  if [[ -f "$PLIST" ]]; then echo "установлен: $PLIST"
  else echo "не установлен (sudo bash scripts/mac-net.sh --install-daemon)"; fi
}

install_daemon() {
  apply
  local self tmp
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  tmp=$(mktemp -t mac-net.XXXXXX)
  cat > "$tmp" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
        <key>Label</key>
        <string>${LABEL}</string>
        <key>ProgramArguments</key>
        <array>
                <string>/bin/bash</string>
                <string>${self}</string>
                <string>--quiet-apply</string>
        </array>
        <key>RunAtLoad</key>
        <true/>
        <key>StartInterval</key>
        <integer>30</integer>
        <key>StandardOutPath</key>
        <string>${LOG}</string>
        <key>StandardErrorPath</key>
        <string>${LOG}</string>
</dict>
</plist>
PLIST
  cp "$tmp" "$PLIST"
  rm -f "$tmp"
  chown root:wheel "$PLIST"
  chmod 644 "$PLIST"
  if ! launchctl bootstrap system "$PLIST" 2>/dev/null; then
    launchctl load "$PLIST" 2>/dev/null || true
  fi
  echo "[mac-net] LaunchDaemon ${LABEL} установлен: чинит правило при загрузке системы и раз в 30 с"
  echo "[mac-net] лог: ${LOG}"
  status
}

remove_daemon() {
  if [[ -f "$PLIST" ]]; then
    launchctl bootout system "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "[mac-net] LaunchDaemon удалён"
  else
    echo "[mac-net] LaunchDaemon не был установлен"
  fi
  echo "[mac-net] pf-правила не тронуты (безвредны); убрать руками:"
  echo "  sudo pfctl -a main -s rules   # найти строки 'pass in quick inet from <подсеть> to any'"
  echo "  # удалить их из вывода и загрузить обратно: sudo pfctl -a main -f <файл>"
}

cmd="${1:---apply}"
if [[ "$cmd" == "--quiet-apply" ]]; then QUIET=1; cmd="--apply"; fi

case "$cmd" in
  --print-subnets) team_subnets ;;
  --apply) need_root "$cmd"; apply ;;
  --status) need_root "$cmd"; status ;;
  --install-daemon) need_root "$cmd"; install_daemon ;;
  --remove-daemon) need_root "$cmd"; remove_daemon ;;
  *) usage; exit 2 ;;
esac
