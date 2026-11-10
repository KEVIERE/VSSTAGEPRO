// Rede Local: qual endereço do Mac vai no link e no QR code, e se o firewall do Mac está barrando
// o VS Stage. Roda sem rede de verdade: as interfaces e a lista do firewall são de mentira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LocalServer, rankInterfaces } = require('../desktop/localServer.js');
const { firewallRule, separateNetworks } = require('../desktop/networkCheck.js');

const order = (entries, primary) => rankInterfaces(entries, primary).map((e) => e.address);

test('cabo na rede da mesa e Wi-Fi no roteador: o QR vai para o Wi-Fi, que é a rota padrão', () => {
  const entries = [
    { name: 'en0', address: '10.0.0.20', netmask: '255.255.255.0' },
    { name: 'en1', address: '192.168.1.15', netmask: '255.255.255.0' },
  ];
  assert.deepEqual(order(entries, 'en1'), ['192.168.1.15', '10.0.0.20']);
});

test('VPN ligada como rota padrão: o QR continua no Wi-Fi ou cabo, a VPN fica depois', () => {
  const entries = [
    { name: 'utun4', address: '100.64.0.7' },
    { name: 'en0', address: '192.168.1.15' },
  ];
  assert.deepEqual(order(entries, 'utun4'), ['192.168.1.15', '100.64.0.7']);
});

test('sem rota padrão: Wi-Fi e cabo antes de máquina virtual, 169.254 sempre por último', () => {
  const entries = [
    { name: 'en5', address: '169.254.10.2' },
    { name: 'bridge100', address: '192.168.64.1' },
    { name: 'en0', address: '192.168.1.15' },
    { name: 'en1', address: '192.168.2.30' },
  ];
  assert.deepEqual(order(entries, null), ['192.168.1.15', '192.168.2.30', '192.168.64.1', '169.254.10.2']);
});

test('o servidor usa a rota padrão para o primeiro endereço', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-ip-'));
  const srv = new LocalServer({ webRoot: dir, storePath: path.join(dir, 'rede-local.json'), version: 't' });
  const real = os.networkInterfaces;
  os.networkInterfaces = () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
    en0: [{ family: 'IPv4', internal: false, address: '10.0.0.20', netmask: '255.255.255.0' }],
    en1: [{ family: 'IPv4', internal: false, address: '192.168.1.15', netmask: '255.255.255.0' }],
  });
  try {
    assert.equal(srv.addresses()[0], '10.0.0.20');
    srv.primaryIface = 'en1';
    assert.equal(srv.addresses()[0], '192.168.1.15');
  } finally {
    os.networkInterfaces = real;
  }
});

test('a rota padrão é conferida no máximo a cada 5 s', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-ip-'));
  const srv = new LocalServer({ webRoot: dir, storePath: path.join(dir, 'rede-local.json'), version: 't' });
  const first = srv.refreshRoute();
  assert.equal(srv.refreshRoute(), first);
  return first;
});

const LIST = (state, file = '/Applications/VS Stage.app/Contents/MacOS/VS Stage') => [
  'Total number of apps = 3 ',
  '1 : /usr/local/bin/node ',
  '             (Allow incoming connections)',
  `2 : ${file} `,
  `             (${state} incoming connections)`,
  '3 : /usr/sbin/cupsd ',
  '             (Allow incoming connections)',
].join('\n');
const APP = '/Applications/VS Stage.app/Contents/MacOS/VS Stage';

test('firewall: o VS Stage marcado como bloqueado é reconhecido', () => {
  assert.equal(firewallRule(LIST('Block'), APP), 'block');
});

test('firewall: o VS Stage liberado é reconhecido', () => {
  assert.equal(firewallRule(LIST('Allow'), APP), 'allow');
});

test('firewall: regra gravada no .app (e não no executável) também vale', () => {
  assert.equal(firewallRule(LIST('Block', '/Applications/VS Stage.app'), APP), 'block');
});

test('firewall: sem regra do VS Stage ou com outro app parecido, não afirma nada', () => {
  assert.equal(firewallRule(LIST('Block', '/Applications/VS Stage Antigo.app/Contents/MacOS/VS Stage'), APP), null);
  assert.equal(firewallRule('Total number of apps = 0 ', APP), null);
  assert.equal(firewallRule('', APP), null);
});

test('firewall: regra antiga liberada e outra bloqueada, vale o bloqueio', () => {
  const out = `${LIST('Allow')}\n4 : /Applications/VS Stage.app \n             (Block incoming connections)`;
  assert.equal(firewallRule(out, APP), 'block');
});

test('Mac em duas redes: só avisa quando cabo e Wi-Fi estão em redes diferentes', () => {
  const same = rankInterfaces([
    { name: 'en0', address: '192.168.1.10', netmask: '255.255.255.0' },
    { name: 'en1', address: '192.168.1.11', netmask: '255.255.255.0' },
  ], 'en0');
  assert.equal(separateNetworks(same).length, 1);

  const split = rankInterfaces([
    { name: 'en0', address: '10.0.0.20', netmask: '255.255.255.0' },
    { name: 'en1', address: '192.168.1.15', netmask: '255.255.255.0' },
    { name: 'utun4', address: '100.64.0.7', netmask: '255.192.0.0' },
    { name: 'bridge100', address: '192.168.64.1', netmask: '255.255.255.0' },
  ], 'en1');
  assert.deepEqual(separateNetworks(split).map((e) => e.address), ['192.168.1.15', '10.0.0.20']);
});
