const net = require('net');
const http = require('http');
const dns = require('dns');
const { execFile } = require('child_process');
const { lanInterfaces, defaultRoute, HOST_NAME } = require('./localServer');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

async function defaultGateway() {
  return (await defaultRoute()).gateway;
}

/** Nome de cada placa como aparece nos Ajustes do Mac (en0 vira "Wi-Fi", en5 vira "Ethernet"). */
async function portNames() {
  const out = await run('/usr/sbin/networksetup', ['-listallhardwareports']);
  const names = {};
  for (const m of out.matchAll(/Hardware Port:\s*(.+)\nDevice:\s*(\S+)/g)) names[m[2]] = m[1].trim();
  return names;
}

function subnet({ address, netmask }) {
  const mask = String(netmask || '255.255.255.0').split('.').map(Number);
  return address.split('.').map((n, i) => Number(n) & (mask[i] ?? 255)).join('.');
}

/**
 * Wi-Fi e cabo ligados em redes diferentes, um por rede. Com dois itens ou mais o QR code só
 * acerta uma delas. Cabo e Wi-Fi no mesmo roteador caem na mesma rede e não contam.
 */
function separateNetworks(interfaces) {
  const seen = new Map();
  for (const e of interfaces) {
    if (e.kind !== 'primary' && e.kind !== 'physical') continue;
    const key = subnet(e);
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}

function tcpOpen(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 2000 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

function httpPing(host, port) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/api/local/ping', timeout: 2500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

const FIREWALL = '/usr/libexec/ApplicationFirewall/socketfilterfw';

async function firewallState() {
  const [globalState, blockAll] = await Promise.all([run(FIREWALL, ['--getglobalstate']), run(FIREWALL, ['--getblockall'])]);
  if (!globalState) return 'unknown';
  if (/enabled|block all/i.test(blockAll) && !/disabled/i.test(blockAll)) return 'blockall';
  return /enabled/i.test(globalState) ? 'on' : 'off';
}

/**
 * Regra do VS Stage na lista do firewall (`socketfilterfw --listapps`): 'allow', 'block' ou null
 * quando ainda não há regra (o Mac pergunta na primeira conexão de um aparelho).
 *
 * O app não tem certificado da Apple, então o firewall não o libera sozinho: ele pergunta, e quem
 * clica em "Negar" deixa o VS Stage bloqueado sem aviso nenhum. O `--getappblocked` não serve para
 * isso, porque responde "permitted" até para um caminho que não existe. A lista guarda o caminho
 * do executável ou do .app, seguido da linha "(Allow incoming connections)" ou "(Block ...)".
 */
function firewallRule(listOutput, appPath) {
  if (!listOutput || !appPath) return null;
  const bundle = /^(.*?\.app)(?:\/|$)/.exec(appPath)?.[1] || appPath;
  const lines = listOutput.split('\n');
  let rule = null;
  for (let i = 0; i < lines.length; i += 1) {
    const p = /^\s*\d+\s*:\s*(.+?)\s*$/.exec(lines[i])?.[1];
    if (!p || (p !== appPath && p !== bundle && !p.startsWith(`${bundle}/`))) continue;
    const state = lines[i + 1] || '';
    if (/block/i.test(state)) return 'block';
    if (/allow/i.test(state)) rule = 'allow';
  }
  return rule;
}

/** Testes do assistente Configurar Rede. Cada item explica em palavras simples o que fazer. */
async function networkCheck(server, { appPath } = {}) {
  const checks = [];
  // O mesmo endereço que vai no link e no QR code (ver rankInterfaces em localServer.js).
  await server.refreshRoute();
  const interfaces = lanInterfaces(server.primaryIface);
  const ip = interfaces[0]?.address || null;
  const names = await portNames();
  const portOf = (e) => names[e.name] || e.name;

  if (!ip) {
    checks.push({ id: 'network', label: 'Mac conectado ao roteador', status: 'fail', action: 'network',
      detail: 'O Mac não está em nenhuma rede. Ligue o cabo do roteador no Mac ou entre no Wi-Fi do roteador.' });
  } else if (ip.startsWith('169.254.')) {
    checks.push({ id: 'network', label: 'Mac conectado ao roteador', status: 'fail', action: 'router',
      detail: 'O Mac está ligado, mas o roteador não entregou um endereço. Reinicie o roteador e confira se o "DHCP" está ligado nele.' });
  } else {
    checks.push({ id: 'network', label: 'Mac conectado ao roteador', status: 'ok', detail: `Endereço do Mac na rede: ${ip} (${portOf(interfaces[0])})` });
  }

  const networks = separateNetworks(interfaces);
  if (networks.length > 1) {
    checks.push({ id: 'networks', label: 'Mac em mais de uma rede', status: 'warn', action: 'network',
      detail: `O Mac está ligado em ${networks.length} redes diferentes ao mesmo tempo: ${networks.map((e) => `${portOf(e)} (${e.address})`).join(' e ')}. O QR code usa o ${portOf(interfaces[0])} (${ip}). Se o celular não abrir a página, desligue a conexão que não é a do roteador do palco e teste de novo.` });
  }

  const gateway = await defaultGateway();
  if (gateway) {
    const reach = (await tcpOpen(gateway, 80)) || (await tcpOpen(gateway, 443));
    checks.push({ id: 'router', label: 'Roteador encontrado', status: 'ok', action: reach ? 'router' : undefined,
      detail: reach ? `O roteador responde em ${gateway}. Você pode abrir a configuração dele se precisar.` : `O roteador está em ${gateway}.` });
  } else if (ip) {
    checks.push({ id: 'router', label: 'Roteador encontrado', status: 'warn',
      detail: 'Não achei o roteador, mas o Mac está numa rede. Se os aparelhos estiverem no mesmo Wi-Fi, deve funcionar.' });
  }

  const serverOk = server.running && ip ? await httpPing(ip, server.port) : false;
  checks.push(serverOk
    ? { id: 'server', label: 'Rede local do VS Stage ligada', status: 'ok', detail: `Os aparelhos entram por http://${ip}:${server.port}` }
    : { id: 'server', label: 'Rede local do VS Stage ligada', status: 'fail', detail: server.error || 'A rede local não está respondendo. Feche e abra o VS Stage.' });

  const resolved = server.mdnsActive
    ? await withTimeout(new Promise((r) => dns.lookup(HOST_NAME, { family: 4 }, (err, a) => r(err ? null : a))), 3000, null)
    : null;
  checks.push(resolved
    ? { id: 'name', label: `Nome fixo ${HOST_NAME}`, status: 'ok', detail: `iPhone, iPad e Mac também podem digitar http://${HOST_NAME}:${server.port}` }
    : { id: 'name', label: `Nome fixo ${HOST_NAME}`, status: 'warn', action: 'sharing',
        detail: 'O nome fixo não respondeu. Sem problema: use o QR code, que já leva o endereço certo.' });

  const fw = await firewallState();
  const rule = fw === 'on' ? firewallRule(await run(FIREWALL, ['--listapps']), appPath) : null;
  if (fw === 'blockall') {
    checks.push({ id: 'firewall', label: 'Firewall do Mac', status: 'fail', action: 'firewall',
      detail: 'O firewall está bloqueando todas as conexões. Abra o firewall e desligue "Bloquear todas as conexões de entrada".' });
  } else if (rule === 'block') {
    checks.push({ id: 'firewall', label: 'Firewall do Mac', status: 'fail', action: 'firewall',
      detail: 'O firewall do Mac está barrando o VS Stage, por isso nenhum aparelho consegue entrar. Abra o firewall, clique em Opções, ache o VS Stage na lista e troque para "Permitir conexões de entrada".' });
  } else if (rule === 'allow') {
    checks.push({ id: 'firewall', label: 'Firewall do Mac', status: 'ok', detail: 'O firewall está ligado e deixa os aparelhos entrarem no VS Stage.' });
  } else if (fw === 'on') {
    checks.push({ id: 'firewall', label: 'Firewall do Mac', status: 'warn', action: 'firewall',
      detail: 'O firewall está ligado. Se o Mac perguntar se o VS Stage pode receber conexões, clique em Permitir.' });
  } else {
    checks.push({ id: 'firewall', label: 'Firewall do Mac', status: 'ok', detail: 'Nada bloqueando os aparelhos.' });
  }

  const clients = (await server.info()).clients.length;
  checks.push(clients > 0
    ? { id: 'devices', label: 'Aparelhos se enxergando', status: 'ok', detail: `${clients} ${clients === 1 ? 'aparelho conectado' : 'aparelhos conectados'} agora.` }
    : { id: 'devices', label: 'Aparelhos se enxergando', status: 'warn', action: gateway ? 'router' : undefined,
        detail: 'Ninguém entrou ainda. Escaneie um QR code no celular. Se não abrir, desligue o "isolamento de AP" ou a "rede de convidados" no roteador.' });

  const online = await withTimeout(new Promise((r) => dns.lookup('apple.com', (err) => r(!err))), 2500, false);
  checks.push({ id: 'internet', label: 'Internet', status: 'ok',
    detail: online ? 'Tem internet, mas a Rede Local não depende dela.' : 'Sem internet. Tudo bem: a Rede Local funciona sem ela.' });

  return { checks, gateway };
}

module.exports = { networkCheck, defaultGateway, firewallRule, separateNetworks };
