import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanAddresses, primaryLanAddress, subnetBroadcastAddresses, type NetworkInterfaces } from './lan.ts';
import { buildBeaconTargets } from './udpBeacon.ts';

/** Срез networkInterfaces из человекочитаемого описания: { en0: [{address, netmask}] }. */
function ifaces(entries: Record<string, Array<{ address: string; netmask: string; internal?: boolean }>>): NetworkInterfaces {
  return Object.fromEntries(Object.entries(entries).map(([name, list]) => [
    name,
    list.map((i) => ({ ...i, family: 'IPv4', internal: i.internal ?? false, mac: '00:00:00:00:00:00', cidr: null })),
  ]));
}

test('macOS раздаёт (Internet Sharing): bridge100 первый, его подсеть в целях бродкаста', () => {
  const snapshot = ifaces({
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    en0: [{ address: '192.168.1.50', netmask: '255.255.255.0' }],      // апстрим (роутер)
    bridge100: [{ address: '192.168.2.1', netmask: '255.255.255.0' }], // клиенты раздачи
    utun3: [{ address: '10.8.0.2', netmask: '255.255.255.255' }],      // VPN point-to-point
    awdl0: [{ address: '169.254.7.9', netmask: '255.255.255.0' }],     // AirDrop
  });

  // primary = bridge100: invite-ссылка и beacon.host ведут клиентов раздачи на верный адрес
  assert.equal(primaryLanAddress(snapshot, 'darwin'), '192.168.2.1');
  // VPN/AirDrop остаются в хвосте списка (как и раньше), но не в целях бродкаста
  assert.deepEqual(lanAddresses(snapshot, 'darwin'), ['192.168.2.1', '192.168.1.50', '169.254.7.9', '10.8.0.2']);

  // directed broadcast обеих рабочих подсетей, host = адрес «своего» интерфейса
  assert.deepEqual(subnetBroadcastAddresses(snapshot, 'darwin'), [
    { address: '192.168.2.1', broadcast: '192.168.2.255' },
    { address: '192.168.1.50', broadcast: '192.168.1.255' },
  ]);
});

test('ZeroTier: zt0 приоритетнее en0 (веню-Wi-Fi для P2P бесполезен), подсеть ZT в бродкасте', () => {
  const snapshot = ifaces({
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    en0: [{ address: '172.16.210.85', netmask: '255.255.248.0' }],
    zt0: [{ address: '172.28.240.1', netmask: '255.255.255.0' }],      // ZeroTier-сегмент команды
    utun10: [{ address: '172.20.102.32', netmask: '255.255.192.0' }],
  });

  assert.equal(primaryLanAddress(snapshot, 'darwin'), '172.28.240.1');
  assert.equal(primaryLanAddress(snapshot, 'linux'), '172.28.240.1');
  assert.deepEqual(subnetBroadcastAddresses(snapshot, 'darwin'), [
    { address: '172.28.240.1', broadcast: '172.28.240.255' },
    { address: '172.16.210.85', broadcast: '172.16.215.255' },
  ]);
});

test('bridge100 раздачи приоритетнее ZeroTier; LAN_IP перекрывает авто-детект', () => {
  const snapshot = ifaces({
    en0: [{ address: '192.168.1.50', netmask: '255.255.255.0' }],
    bridge100: [{ address: '192.168.2.1', netmask: '255.255.255.0' }],
    zt0: [{ address: '172.28.240.1', netmask: '255.255.255.0' }],
  });

  assert.equal(primaryLanAddress(snapshot, 'darwin'), '192.168.2.1', 'раздача (план А) важнее ZT');

  process.env.LAN_IP = '172.28.240.1';
  try {
    assert.equal(primaryLanAddress(snapshot, 'darwin'), '172.28.240.1');
    assert.deepEqual(lanAddresses(snapshot, 'darwin'), ['172.28.240.1', '192.168.2.1', '192.168.1.50'], 'override первым, дубль убран');
    process.env.LAN_IP = '   ';
    assert.equal(primaryLanAddress(snapshot, 'darwin'), '192.168.2.1', 'пустой LAN_IP игнорируется');
  } finally {
    delete process.env.LAN_IP;
  }
});

test('macOS без раздачи: обычный Wi-Fi, bridge0 без IP не мешает', () => {
  const snapshot = ifaces({
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    en0: [{ address: '172.16.210.85', netmask: '255.255.248.0' }],
    bridge0: [], // Thunderbolt Bridge существует, но без адреса
    utun10: [{ address: '172.20.102.32', netmask: '255.255.192.0' }],
  });

  assert.equal(primaryLanAddress(snapshot, 'darwin'), '172.16.210.85');
  assert.deepEqual(subnetBroadcastAddresses(snapshot, 'darwin'), [
    { address: '172.16.210.85', broadcast: '172.16.215.255' },
  ]);
});

test('linux: bridge — это docker/libvirt, приоритета и бродкаста не даём', () => {
  const snapshot = ifaces({
    lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    wlan0: [{ address: '192.168.1.60', netmask: '255.255.255.0' }],
    bridge100: [{ address: '192.168.2.1', netmask: '255.255.255.0' }],
    docker0: [{ address: '172.17.0.1', netmask: '255.255.0.0' }],
  });

  assert.equal(primaryLanAddress(snapshot, 'linux'), '192.168.1.60');
  assert.deepEqual(subnetBroadcastAddresses(snapshot, 'linux'), [
    { address: '192.168.1.60', broadcast: '192.168.1.255' },
  ]);
});

test('нет внешних интерфейсов: primary 127.0.0.1, подсетей нет', () => {
  const snapshot = ifaces({ lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', internal: true }] });
  assert.equal(primaryLanAddress(snapshot, 'darwin'), '127.0.0.1');
  assert.deepEqual(subnetBroadcastAddresses(snapshot, 'darwin'), []);
});

test('нестандартная маска: 10.1.8.10/22 → broadcast 10.1.11.255', () => {
  const snapshot = ifaces({ en0: [{ address: '10.1.8.10', netmask: '255.255.252.0' }] });
  assert.deepEqual(subnetBroadcastAddresses(snapshot, 'darwin'), [
    { address: '10.1.8.10', broadcast: '10.1.11.255' },
  ]);
});

test('buildBeaconTargets: loopback-копия, глобальный адрес и per-подсеть host', () => {
  const targets = buildBeaconTargets(
    '192.168.2.1',
    [
      { address: '192.168.2.1', broadcast: '192.168.2.255' },
      { address: '192.168.1.50', broadcast: '192.168.1.255' },
    ],
    '255.255.255.255',
  );

  assert.deepEqual(targets, [
    { target: '255.255.255.255', host: '192.168.2.1' },
    { target: '127.0.0.1', host: '192.168.2.1' },
    { target: '192.168.2.255', host: '192.168.2.1' },
    { target: '192.168.1.255', host: '192.168.1.50' },
  ]);
});

test('buildBeaconTargets: подсеть перекрывает глобальный адрес точным host', () => {
  const targets = buildBeaconTargets(
    '192.168.1.50',
    [{ address: '192.168.2.1', broadcast: '192.168.2.255' }],
    '192.168.2.255', // UDP_BROADCAST_ADDR переопределён на directed broadcast
  );
  assert.deepEqual(targets, [
    { target: '192.168.2.255', host: '192.168.2.1' }, // перезаписан адресом интерфейса подсети
    { target: '127.0.0.1', host: '192.168.1.50' },
  ]);
});
