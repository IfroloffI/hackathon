# Колизиум для команды через ZeroTier — воспроизводимый manual

Контекст: веню-Wi-Fi площадки изолирует ноутбуки друг от друга — пинги между
клиентами ходят, но TCP молча дропается (AP isolation). Интернет есть у всех.
Решение: виртуальный L2-сегмент через ZeroTier — команда сидит в одной подсети,
сервер игры поднимается на хосте как обычно, ссылки и маяк комнат автоматически
адресуют ZT-подсеть.

Проверено на хакатоне: macOS-хост (ZeroTier 1.16.2), коллега на Windows,
сеть `76fc96e498e625ac` (подсеть `10.161.254.0/24`). Ниже наши значения —
подставляйте свои, где указано.

## TL;DR

1. Создать ZeroTier-сеть (§1) → Network ID.
2. Хост: поставить ZeroTier, join, авторизовать себя в Central (§2).
3. Хост: **разрешить входящий TCP из ZT-подсети в pf** — главный подводный камень macOS (§3).
4. Коллеги: клиент ZeroTier → join → хост апрувит их в Members (§4).
5. Все открывают `http://<zt-ip-хоста>:5173` (dev) / `https://<zt-ip-хоста>:2567`
   (compose) или invite-ссылку из лобби — она уже ведёт в ZT-сегмент.

## 1. Создать ZeroTier-сеть (один раз, любой участник с аккаунтом)

1. [my.zerotier.com](https://my.zerotier.com) → **Create A Network** (название, например `kolizey`).
2. **IPv4** → Easy → включить auto-assign (запомните подсеть, у нас `10.161.254.0/24`).
3. **Advanced**: тумблер **«Do NOT Auto-Assign IPs» должен быть выключен**.
   Галочки «Allow Ethernet Bridging» / «Exclude from SSO Auth» не трогать.
   Пункта «Allow Broadcast» в новом UI больше нет — бродкаст включён всегда.
4. Скопировать **Network ID** (16 hex-символов).

## 2. Хост (macOS)

### 2.1 Установка

```bash
brew install --cask zerotier-one   # pkg-инсталлер спросит пароль админа
```

CLI демона требует root. Если работаете из агента без терминала — через
GUI-диалог пароля:

```bash
osascript -e 'do shell script "/usr/local/bin/zerotier-cli <команда>" with administrator privileges'
```

### 2.2 Подключение и авторизация

```bash
sudo zerotier-cli join <NetworkID>
sudo zerotier-cli listnetworks   # status: REQUESTING_CONFIGURATION — ждёт авторизации
```

В Central → **Members** → поставить галку **Auth** своему устройству.
Через секунды:

```bash
sudo zerotier-cli listnetworks   # status: OK, dev: fethXXXX, ips: 10.161.254.5/24
```

**Важно (macOS):** ZeroTier 1.16+ создаёт интерфейс `feth*` (fake-ethernet
пару), а не классический `zt0` — и `ipconfig getifaddr` про него не знает.
Детект в коде проекта уже учитывает оба имени (`/^(zt|feth)/`).

### 2.3 pf — главный подводный камень

На macOS-хосте мог быть включён pf (System → какое-то security-ПО загружает
правила «default-deny»): пинги и DNS проходят, **входящий TCP молча дропается**.
Симптом: страница не грузится, при этом `tcpdump` видит SYN коллеги, а SYN-ACK
от хоста не рождается. Правило лечения runtime-only — security-ПО его
периодически смывает, поэтому чинить нужно автоматически.

**Рекомендуемый путь (одна команда, сам чинит при загрузке и раз в 30 с):**

```bash
sudo bash scripts/mac-net.sh --install-daemon
```

Подробности и откат — [docs/MAC-HOST-SETUP.md](docs/MAC-HOST-SETUP.md).

Вручную (разово, без демона):

```bash
sudo pfctl -a main -s rules 2>/dev/null > /tmp/pf-main.rules   # бэкап текущих правил
echo "pass in quick inet from 10.161.254.0/24 to any" >> /tmp/pf-main.rules
sudo pfctl -a main -f /tmp/pf-main.rules
```

Откат: `sudo pfctl -a main -f <бэкап без нашей строки>`.
**Правило runtime-only**: после перезагрузки хоста повторить при необходимости.

Заодно проверить application firewall (обычно не при чём, но на «других
устройствах» может быть включён):

```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
```

## 3. Коллеги (любая ОС)

1. Поставить [клиент ZeroTier](https://www.zerotier.com/download/).
2. Join Network по тому же Network ID.
3. Хост апрувит каждого в Central → **Members** (галка Auth) — там же видны
   выданные адреса (Managed IPs), это самый простой способ узнать IP коллеги.
4. Открыть `http://10.161.254.5:5173` (dev-режим хоста) или
   `https://10.161.254.5:2567` (compose; сертификат самоподписанный —
   «Дополнительно → Перейти»). Публичные комнаты видны в лобби без кода:
   список комнат все получают с того же сервера (`GET /api/rooms`).

Windows не отвечает на ping (файрвол режет ICMP по умолчанию) — это норма,
не признак проблемы.

## 4. Запуск игры на хосте

```bash
npm run dev       # dev: сервер :2567 + Vite :5173 (host: true, LAN-ready)
# или
npm run up        # compose: игра+голос+LLM на :2567, https
```

Код сам выбирает адрес: `LAN_IP` (env) → `bridge100` (раздача мака) →
`zt*`/`feth*` (ZeroTier) → Wi-Fi/Ethernet. `scripts/up.sh` передаёт его
в контейнер `game` и в `LIVEKIT_NODE_IP` (голос LiveKit тоже пойдёт по ZT).

**Не запускайте два инстанса одновременно** (порт 2567 и SQLite общие):
иначе сервер упадёт с `database is locked`. Проверка перед стартом:
`lsof -nP -i :2567`.

## 5. Проверка (чек-лист хоста)

```bash
curl -s http://localhost:2567/api/host        # ZT-адрес должен быть ПЕРВЫМ
sudo zerotier-cli listpeers                   # у активных коллег latency > 0, есть path
netstat -an -p tcp | grep 10.161.254 | grep ESTABLISHED   # живые сессии коллег
curl -s http://localhost:2567/api/rooms       # комнаты с isPublic
npm run udp-listen -w server                  # UDP-маяк: host = ZT-адрес, порт 2567
```

Маяк уходит на directed broadcast каждой подсети хоста
(`10.161.254.255` для ZT, `172.16.215.255` для веню-Wi-Fi) с `host` =
адресу интерфейса этой подсети.

## Troubleshooting

| Симптом | Причина | Лечение |
|---|---|---|
| Страница не грузится; в `listpeers` у коллеги `path -`, `latency -1` | не авторизован в Members / клиент выключен | галка Auth в Central / включить сеть в клиенте |
| Авторизованный node не оживает | запись от старой установки клиента | найти живой node в `listpeers`, апрувить его |
| Windows-коллега не пингуется | файрвол Windows режет ICMP | норма; смотреть listpeers/ARP |
| tcpdump видит SYN, SYN-ACK нет | pf `block drop in` на хосте | §2.3 |
| `database is locked` при старте | второй инстанс сервера | `kill $(lsof -t -i:2567)`, один инстанс |
| Нет интерфейса `zt0` на macOS | ZeroTier 1.16+ создаёт `feth*` | уже учтено в коде (`/^(zt|feth)/`) |
| Нет «Allow Broadcast» в новом UI ZeroTier | убрали, бродкаст всегда вкл | проверить только «Do NOT Auto-Assign IPs» = выкл |
| После ребута хоста «снова никто не может» | pf-правило runtime-only | повторить §2.3 |

## Что изменено в коде (ветка `llm`)

| Коммит | Что |
|---|---|
| `6018d28` | Ранжирование адресов `LAN_IP` → `bridge100` → `zt*` → `en*` в `server/src/net/lan.ts`; override `LAN_IP` (env) для compose; UDP-маяк на directed broadcast каждой подсети с per-interface `host` (`udpBeacon.ts`); детект ZT-адреса и экспорт `LAN_IP` в `scripts/up.sh`; проброс `LAN_IP` в `game` (docker-compose.yml); README |
| `ae2009e` | ZeroTier на macOS = `feth*`, не `zt0`: регэксп `ZEROTIER=/^(zt\|feth)/`, ifconfig-парсинг в `up.sh`, тест |

Тесты: `server/src/net/lan.test.ts` — 10 кейсов (ZT-приоритет, раздача
bridge100, LAN_IP override, Linux/bridges, нестандартные маски, сборка целей
маяка). `npm test -w server` — зелёные.
