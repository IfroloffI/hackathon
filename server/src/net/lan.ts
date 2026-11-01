import os from 'node:os';

/** Срез os.networkInterfaces() — принимается параметром для тестов. */
export type NetworkInterfaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

/** point-to-point и виртуальные интерфейсы: маяк туда не шлём. */
const VIRTUAL = /^(utun|tun|tap|docker|br-|veth|vboxnet|vmnet|bridge|llw|awdl)/;
/** Физические LAN-интерфейсы. */
const PHYSICAL = /^(en|eth|wlan|wl)/;
/** ZeroTier: zt* (Linux/Windows), feth* (macOS, fake-ethernet пары) — виртуальный L2-сегмент команды. */
const ZEROTIER = /^(zt|feth)/;

/**
 * Ранг интерфейса: меньше — предпочтительнее.
 *
 * 1. macOS Internet Sharing («мак сам раздаёт сеть»): раздача поднимает
 *    bridge100 (по умолчанию 192.168.2.1/24), и все подключившиеся сидят
 *    за ним, а en* в этот момент смотрит в апстрим (роутер/веню-Wi-Fi).
 *    Без приоритета bridge100 LAN-IP хоста, invite-ссылка и поле host
 *    в beacon указывают на апстрим-адрес — клиенты раздачи по нему не
 *    заходят. bridge0 (Thunderbolt, без IP) и docker-мосты приоритет
 *    не получают: отличие раздачи — имя bridge100+ (две и более цифры).
 * 2. ZeroTier (zt*): когда веню-сеть режет P2P, команда сидит в
 *    ZT-подсети — ссылка и маяк должны адресовать её, а не бесполезный
 *    в P2P-смысле en*.
 *
 * LAN_IP (env) перекрывает авто-детект полностью — явный адрес хоста
 * для compose-режима, где контейнер не видит интерфейсы хоста.
 */
function rank(name: string, platform: NodeJS.Platform): number {
  if (platform === 'darwin' && /^bridge\d{2,}$/.test(name)) { return -2; }
  if (ZEROTIER.test(name)) { return -1; }
  if (PHYSICAL.test(name)) { return 0; }
  if (VIRTUAL.test(name)) { return 2; }
  return 1;
}

/** Явно указанный адрес хоста (env LAN_IP): пустая строка игнорируется. */
function overriddenLanIp(): string | undefined {
  const value = process.env.LAN_IP?.trim();
  return value === '' ? undefined : value;
}

/** IPv4-интерфейсы, отсортированные по рангу (затем по имени — детерминизм). */
function ipv4Interfaces(interfaces: NetworkInterfaces, platform: NodeJS.Platform): Array<{ name: string; address: string; netmask: string | null }> {
  return Object.entries(interfaces)
    .flatMap(([name, list]) => (list ?? [])
      .filter((i) => i.family === 'IPv4' && !i.internal)
      .map((i) => ({ name, address: i.address, netmask: i.netmask || null })))
    .sort((a, b) => rank(a.name, platform) - rank(b.name, platform) || a.name.localeCompare(b.name));
}

/**
 * LAN IPv4 адреса хоста, лучшие первыми: LAN_IP (если задан),
 * затем bridge100 раздачи (darwin), ZeroTier, Wi-Fi/Ethernet (en*, eth*,
 * wlan*, wl*), прочие, в конце — VPN/Docker-интерфейсы.
 */
export function lanAddresses(interfaces: NetworkInterfaces = os.networkInterfaces(), platform: NodeJS.Platform = process.platform): string[] {
  const detected = ipv4Interfaces(interfaces, platform).map((i) => i.address);
  const override = overriddenLanIp();
  if (override === undefined) { return detected; }
  return [override, ...detected.filter((address) => address !== override)];
}

export function primaryLanAddress(interfaces?: NetworkInterfaces, platform?: NodeJS.Platform): string {
  return lanAddresses(interfaces ?? os.networkInterfaces(), platform ?? process.platform)[0] ?? '127.0.0.1';
}

/** Directed broadcast подсети (10.1.8.10/255.255.252.0 → 10.1.11.255); null при кривых данных. */
function broadcastOf(address: string, netmask: string): string | null {
  const ip = address.split('.').map(Number);
  const mask = netmask.split('.').map(Number);
  if (ip.length !== 4 || mask.length !== 4 || ip.some(Number.isNaN) || mask.some(Number.isNaN)) { return null; }
  return ip.map((octet, idx) => (octet | (~mask[idx]! & 255)) & 255).join('.');
}

/**
 * Directed broadcast каждой подсети, куда стоит слать маяк, с адресом
 * «своего» интерфейса этой подсети.
 *
 * 255.255.255.255 на macOS уходит по маршруту по умолчанию — то есть НЕ в
 * подсеть раздачи и НЕ в ZeroTier-сегмент, поэтому каждую подсеть адресуем
 * явно: и физические интерфейсы (en*, eth*, wlan*, wl*), и bridge100
 * раздачи, и ZeroTier (zt*). Point-to-point (utun/tun) и виртуальные
 * (docker/vmnet/awdl) не участвуют.
 */
export function subnetBroadcastAddresses(
  interfaces: NetworkInterfaces = os.networkInterfaces(),
  platform: NodeJS.Platform = process.platform,
): Array<{ address: string; broadcast: string }> {
  const byBroadcast = new Map<string, { address: string; broadcast: string }>();
  for (const iface of ipv4Interfaces(interfaces, platform)) {
    if (rank(iface.name, platform) === 2 || iface.netmask === null) { continue; }
    const broadcast = broadcastOf(iface.address, iface.netmask);
    if (broadcast !== null) { byBroadcast.set(broadcast, { address: iface.address, broadcast }); }
  }
  return [...byBroadcast.values()];
}
