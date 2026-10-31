import os from 'node:os';

/**
 * LAN IPv4 адреса хоста: сначала Wi-Fi/Ethernet (en*, eth*, wlan*, wl*),
 * затем прочие, в конце — VPN/Docker-интерфейсы.
 */
export function lanAddresses(): string[] {
  const rank = (name: string) => (/^(en|eth|wlan|wl)/.test(name) ? 0
    : /^(utun|tun|tap|docker|br-|veth|vboxnet|vmnet|bridge|llw|awdl)/.test(name) ? 2 : 1);
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal)
      .map((i) => ({ name, address: i.address })))
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((i) => i.address);
}

export function primaryLanAddress(): string {
  return lanAddresses()[0] ?? '127.0.0.1';
}

/**
 * Directed broadcast первичного LAN-интерфейса (например 172.16.215.255):
 * проходит через Wi-Fi AP надёжнее, чем 255.255.255.255, и адресует
 * ровно наш сегмент. utun/tun-интерфейсы (point-to-point) не участвуют.
 */
export function subnetBroadcastAddress(): string | null {
  const rank = (name: string) => (/^(en|eth|wlan|wl)/.test(name) ? 0
    : /^(utun|tun|tap|docker|br-|veth|vboxnet|vmnet|bridge|llw|awdl)/.test(name) ? 2 : 1);
  const candidates = Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? [])
      .filter((i) => i.family === 'IPv4' && !i.internal && i.netmask)
      .map((i) => ({ name, address: i.address, netmask: i.netmask })))
    .filter((i) => rank(i.name) < 2)
    .sort((a, b) => rank(a.name) - rank(b.name));
  const best = candidates[0];
  if (best === undefined) { return null; }
  const ip = best.address.split('.').map(Number);
  const mask = best.netmask.split('.').map(Number);
  return ip.map((octet, idx) => (octet | (~mask[idx]! & 255)) & 255).join('.');
}
