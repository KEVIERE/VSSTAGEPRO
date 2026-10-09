const net = require('net');
const http = require('http');
const dns = require('dns');
const { execFile } = require('child_process');
const { lanAddresses, HOST_NAME } = require('./localServer');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

async function defaultGateway() {
  const out = await run('/sbin/route', ['-n', 'get', 'default']);
  const m = /gateway:\s*([\d.]+)/.exec(out);
  return m ? m[1] : null;
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

async function firewallState() {
  const fw = '/usr/libexec/ApplicationFirewall/socketfilterfw';
  const [globalState, blockAll] = await Promise.all([run(fw, ['--getglobalstate']), run(fw, ['--getblockall'])]);
  if (!globalState) return 'unknown';
  if (/enabled|block all/i.test(blockAll) && !/disabled/i.test(blockAll)) return 'blockall';
  return /enabled/i.test(globalState) ? 'on' : 'off';
}

/** Testes do assistente Configurar Rede. Cada item explica em palavras simples o que fazer. */
async function networkCheck(server) {
  const checks = [];
  const addresses = lanAddresses();
  const ip = addresses[0] || null;

  if (!ip) {
    checks.push({ id: 'network', label: 'Mac conectado ao roteador', status: 'fail', action: 'network',
      detail: 'O Mac não está em nenhuma rede. Ligue o cabo do roteador no Mac ou entre no Wi-Fi do roteador.' });
  } else if (ip.startsWith('169.254.')) {
    checks.push({ id: 'network', label: 'Mac conectado ao roteador', status: 'fail', action: 'router',
      detail: 'O Mac está ligado, mas o roteador não entregou um endereço. Reinicie o roteador e confira se o "DHCP" está ligado nele.' });
  } else {
    checks.push({ id: 'network', label: 'Mac conectado ao roteador', status: 'ok', detail: `Endereço do Mac na rede: ${ip}` });
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
  if (fw === 'blockall') {
    checks.push({ id: 'firewall', label: 'Firewall do Mac', status: 'fail', action: 'firewall',
      detail: 'O firewall está bloqueando todas as conexões. Abra o firewall e desligue "Bloquear todas as conexões de entrada".' });
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

module.exports = { networkCheck, defaultGateway };
