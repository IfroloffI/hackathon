import os from 'node:os';

/** IPv4-адреса хоста: сначала Wi-Fi/Ethernet (en*, eth*, wlan*), туннели и виртуальные сети — в конец. */
export function lanAddresses(): string[] {
  const rank = (name: string) => (/^(en|eth|wlan|wl)/.test(name) ? 0 : /^(utun|tun|tap|docker|br-|veth|vboxnet|vmnet|bridge|llw|awdl)/.test(name) ? 2 : 1);
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address })))
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((i) => i.address);
}
