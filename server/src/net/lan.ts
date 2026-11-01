import os from 'node:os';

/** Срез os.networkInterfaces() — принимается параметром для тестов. */
export type NetworkInterfaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

/** point-to-point и виртуальные интерфейсы: маяк туда не шлём. */
const VIRTUAL = /^(utun|tun|tap|docker|br-|veth|vboxnet|vmnet|bridge|llw|awdl)/;
/** Физические LAN-интерфейсы. */
const PHYSICAL = /^(en|eth|wlan|wl)/;

/**
 * Ранг интерфейса: меньше — предпочтительнее.
 *
 * Костыль для macOS Internet Sharing («мак сам раздаёт сеть»): раздача
 * поднимает интерфейс bridge100 (по умолчанию 192.168.2.1/24), и все
 * подключившиеся сидят именно за ним, а en* в этот момент смотрит в
 * апстрим (роутер/корпоративный Wi-Fi). Без приоритета bridge100
 * LAN-IP хоста, invite-ссылка и поле host в beacon указывают на
 * апстрим-адрес — клиенты раздачи по нему зайти не могут.
 *
 * bridge0 (Thunderbolt Bridge, без IP при раздаче не участвует) и
 * чужие для darwin мосты (docker/libvirt на Linux) приоритет не получают:
 * отличие раздачи — имя bridge100+ (две и более цифры).
 */
function rank(name: string, platform: NodeJS.Platform): number {
  if (platform === 'darwin' && /^bridge\d{2,}$/.test(name)) { return -1; }
  if (PHYSICAL.test(name)) { return 0; }
  if (VIRTUAL.test(name)) { return 2; }
  return 1;
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
 * LAN IPv4 адреса хоста, лучшие первыми: на macOS с включённой раздачей —
 * bridge100 (клиенты раздачи), дальше Wi-Fi/Ethernet (en*, eth*, wlan*, wl*),
 * затем прочие, в конце — VPN/Docker-интерфейсы.
 */
export function lanAddresses(interfaces: NetworkInterfaces = os.networkInterfaces(), platform: NodeJS.Platform = process.platform): string[] {
  return ipv4Interfaces(interfaces, platform).map((i) => i.address);
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
 * подсеть раздачи, поэтому каждую подсеть адресуем явно: и физические
 * интерфейсы (en*, eth*, wlan*, wl*), и bridge100 раздачи на darwin.
 * Point-to-point (utun/tun) и виртуальные (docker/vmnet/awdl) не участвуют.
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
