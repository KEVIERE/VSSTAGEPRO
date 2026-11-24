// Lote 6: trabalho que parava o processo principal (a janela do diretor) sai dele, com o mesmo
// resultado: bcrypt dos músicos num worker, número da placa e nome do Mac em segundo plano,
// limpeza do /tmp sem rmSync. Mais a conferência da conta uma vez só na tela de entrada.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Module, { createRequire, stripTypeScriptTypes } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.join(here, '..', 'desktop');
const { LocalAccounts, hashPassword, checkPassword, hashPasswordAsync, checkPasswordAsync } = require(path.join(desktop, 'musicianAccounts.js'));

// Electron de mentira só para os arquivos que pedem `app` no topo (nada é usado aqui).
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getVersion: () => '0.0.0', isPackaged: false }, ipcMain: { on() {} } };
  return origLoad.call(this, request, parent, isMain);
};
const fresh = (file) => {
  for (const k of Object.keys(require.cache)) if (k.startsWith(desktop) && !k.includes('node_modules')) delete require.cache[k];
  return require(path.join(desktop, file));
};

/** Maior intervalo entre batidas de um relógio de 2 ms enquanto `work` roda: o principal parado. */
async function maxStall(work) {
  let last = performance.now();
  let worst = 0;
  const t = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 2);
  try { await work(); } finally { clearInterval(t); }
  return Math.max(worst, performance.now() - last);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote6-senha-'));
const made = [];
after(() => {
  for (const a of made) a.flush(); // a cópia de segurança atrasada não recria a pasta depois
  fs.rmSync(scratch, { recursive: true, force: true });
});
const newAccounts = () => {
  const a = new LocalAccounts({ dir: fs.mkdtempSync(path.join(scratch, 'contas-')) });
  made.push(a);
  return a;
};

test('senha no worker: o mesmo formato $2a$ e conferida pelos dois lados', async () => {
  const h = await hashPasswordAsync('segredo1');
  assert.match(h, /^\$2a\$10\$/, 'formato do pgcrypto (Show Online), 10 rodadas');
  assert.equal(checkPassword('segredo1', h), true, 'a conta de antes aceita a senha do worker');
  assert.equal(await checkPasswordAsync('segredo1', hashPassword('segredo1')), true, 'o worker aceita a senha de antes');
  assert.equal(await checkPasswordAsync('errada', h), false);
  assert.equal(await checkPasswordAsync('x', 'hash-quebrado'), false, 'hash inválido é senha errada, como antes');
  assert.equal(await checkPasswordAsync('x', null), false);
});

test('senha no worker não para o principal (a conta de antes parava)', async () => {
  await hashPasswordAsync('aquecer'); // o worker já aberto, como no segundo músico da noite
  const sync = await maxStall(async () => { hashPassword('segredo1'); });
  const worker = await maxStall(() => hashPasswordAsync('segredo1'));
  console.log(`# principal parado: bcrypt aqui ${sync.toFixed(1)} ms, no worker ${worker.toFixed(1)} ms`);
  assert.ok(sync > 25, `a conta de antes trava o principal (${sync.toFixed(1)} ms)`);
  assert.ok(worker < sync / 2, `no worker o principal segue andando (${worker.toFixed(1)} ms)`);
});

test('signupAsync e loginAsync respondem igual ao signup e login de antes', async () => {
  const a = newAccounts();
  const b = newAccounts();
  const cases = [
    { username: 'Joao Baixo', password: 'segredo1', name: 'João', instrument: 'Baixo' },
    { username: 'joao.baixo', password: 'segredo1', name: 'Outro' }, // já existe
    { username: 'ab', password: 'segredo1', name: 'X' },
    { username: 'bruno', password: '123', name: 'Bruno' },
    { username: 'carla', password: 'segredo1', name: '   ' },
  ];
  for (const c of cases) {
    const sync = a.signup(c);
    const async_ = await b.signupAsync(c);
    assert.equal(async_.error, sync.error, JSON.stringify(c));
    if (sync.account) {
      assert.equal(async_.account.username, sync.account.username);
      assert.equal(async_.account.status, 'pending');
      assert.equal(checkPassword(c.password, async_.account.passwordHash), true);
    }
  }
  for (const acc of [a, b]) acc.findByUsername('joao.baixo').status = 'approved';
  const logins = [
    { username: 'JOÃO baixo', password: 'segredo1' },
    { username: 'joao.baixo', password: 'outra' },
    { username: 'ninguem', password: 'segredo1' },
  ];
  for (const l of logins) {
    const sync = a.login(l);
    const async_ = await b.loginAsync(l);
    assert.equal(async_.error, sync.error, JSON.stringify(l));
    assert.equal(!!async_.account, !!sync.account);
  }
  // bloqueado e senha zerada pelo diretor (PIN + senha nova)
  for (const acc of [a, b]) acc.findByUsername('joao.baixo').status = 'blocked';
  assert.equal((await b.loginAsync({ username: 'joao.baixo', password: 'segredo1' })).error, 'blocked');
  for (const acc of [a, b]) { const x = acc.findByUsername('joao.baixo'); x.status = 'approved'; x.passwordHash = null; }
  assert.equal((await b.loginAsync({ username: 'joao.baixo', password: 'x' })).error, 'needs_password');
  assert.equal((await b.loginAsync({ username: 'joao.baixo', newPassword: '123', pinOk: true })).error, 'weak_password');
  const reset = await b.loginAsync({ username: 'joao.baixo', newPassword: 'novasenha', pinOk: true });
  assert.ok(reset.account && !reset.error);
  assert.equal(checkPassword('novasenha', b.findByUsername('joao.baixo').passwordHash), true);
  assert.equal((await b.loginAsync({ username: 'joao.baixo', password: 'novasenha' })).error, undefined);
});

test('dois celulares pedindo o mesmo usuário ao mesmo tempo: um entra, o outro recebe "já existe"', async () => {
  const acc = newAccounts();
  const [x, y] = await Promise.all([
    acc.signupAsync({ username: 'dani', password: 'segredo1', name: 'Dani' }),
    acc.signupAsync({ username: 'Dani', password: 'segredo2', name: 'Daniela' }),
  ]);
  assert.equal([x, y].filter((r) => r.account).length, 1);
  assert.equal([x, y].find((r) => !r.account).error, 'username_taken');
  assert.equal(acc.accounts.filter((a) => a.username === 'dani').length, 1);
});

test('diretor zera a senha enquanto o worker confere: vale a conta de agora', async () => {
  const acc = newAccounts();
  acc.signup({ username: 'eva', password: 'segredo1', name: 'Eva' });
  acc.findByUsername('eva').status = 'approved';
  const pending = acc.loginAsync({ username: 'eva', password: 'segredo1' });
  // no meio da conta, o diretor zera a senha
  acc.findByUsername('eva').passwordHash = null;
  assert.equal((await pending).error, 'needs_password', 'sem senha guardada agora: pede a nova, como o login de agora pediria');
});

test('número da placa em segundo plano é o mesmo do caminho de antes', { skip: process.platform !== 'darwin' && 'só no Mac' }, async () => {
  const asyncMod = fresh('antiTamper.js');
  let id;
  const stall = await maxStall(async () => { id = await asyncMod.getHardwareIdAsync(); });
  const syncMod = fresh('antiTamper.js');
  let same;
  const syncStall = await maxStall(async () => { same = syncMod.getHardwareId(); });
  console.log(`# principal parado: ioreg síncrono ${syncStall.toFixed(1)} ms, em segundo plano ${stall.toFixed(1)} ms`);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(id, same, 'a conferência guardada no Mac continua abrindo (a chave sai deste número)');
  assert.equal(asyncMod.getHardwareId(), id, 'depois de pronto, o síncrono usa o guardado');
  // o número saiu do ioreg, não da reserva
  const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8' });
  const uuid = /"IOPlatformUUID"\s*=\s*"([^"]+)"/i.exec(out)[1].trim();
  assert.equal(id, crypto.createHash('sha256').update(uuid).digest('hex'));
});

test('quem é este Mac: mesmo código e nome de antes, sem comando síncrono', { skip: process.platform !== 'darwin' && 'só no Mac' }, async () => {
  const { deviceInfo } = fresh('deviceInfo.js');
  const { getHardwareId } = require(path.join(desktop, 'antiTamper.js'));
  const [d1, d2] = await Promise.all([deviceInfo(), deviceInfo()]);
  assert.equal(d1, d2, 'dois pedidos juntos: uma leitura só');
  const id = crypto.createHash('sha256').update(`vsstage-device-v1:${getHardwareId()}`).digest('hex').slice(0, 40);
  const name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim().slice(0, 80) || os.hostname();
  assert.deepEqual(d1, { id, name });
  assert.equal(await deviceInfo(), d1, 'guardado depois da primeira vez');
  const src = fs.readFileSync(path.join(desktop, 'deviceInfo.js'), 'utf8') + fs.readFileSync(path.join(desktop, 'antiTamper.js'), 'utf8');
  assert.doesNotMatch(src.replace(/execSync\(spec\.cmd, spec\.opts\)/, ''), /execSync\(|execFileSync\(/, 'só o caminho de reserva do getHardwareId continua síncrono');
});

test('limpeza do /tmp em segundo plano: só as pastas vs-update-', async () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'tmp-'));
  for (const n of ['vs-update-aaa', 'vs-update-bbb']) { fs.mkdirSync(path.join(dir, n)); fs.writeFileSync(path.join(dir, n, 'x.dmg'), 'x'); }
  fs.mkdirSync(path.join(dir, 'outra-pasta'));
  const oldTmp = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    const { cleanLeftovers } = fresh('selfUpdate.js');
    const result = cleanLeftovers();
    assert.ok(result instanceof Promise, 'não segura o principal');
    assert.equal(await result, 2);
  } finally {
    if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
  }
  assert.deepEqual(fs.readdirSync(dir), ['outra-pasta']);
});

test('servidor da rede local confere a senha pelo worker', () => {
  const src = fs.readFileSync(path.join(desktop, 'localServer.js'), 'utf8');
  assert.match(src, /async musicianLogin\(res, body, addr\)/);
  assert.match(src, /result = await this\.accounts\.signupAsync\(/);
  assert.match(src, /result = await this\.accounts\.loginAsync\(/);
  assert.doesNotMatch(src, /^const QRCode = require\('qrcode'\);/m, 'qrcode só com o primeiro QR');
});

// ---------- tela de entrada ----------
const access = fs.readFileSync(path.join(here, '..', 'src', 'components', 'DirectorAccess.tsx'), 'utf8');

test('conferência da conta: uma por vez para a mesma conta', async () => {
  const start = access.indexOf('type LicenseFlight<T>');
  const body = access.slice(start, access.indexOf('const formatCheckDate', start));
  const shareLicenseFlight = new Function(`${stripTypeScriptTypes(body)}\nreturn shareLicenseFlight;`)();
  const holder = { current: null };
  let asked = 0;
  let answer;
  const ask = () => { asked += 1; return new Promise((r) => { answer = r; }); };
  const a = shareLicenseFlight(holder, 'conta-1', ask);
  const b = shareLicenseFlight(holder, 'conta-1', ask);
  assert.equal(a, b, 'getSession e INITIAL_SESSION juntos: a mesma ida ao servidor');
  assert.equal(asked, 1);
  assert.equal(a.applied, false);
  const other = shareLicenseFlight(holder, 'conta-2', ask);
  assert.notEqual(other, a, 'outra conta nunca pega a resposta da anterior');
  assert.equal(a.applied, true, 'a resposta da conta anterior não é mais aplicada');
  assert.equal(asked, 2);
  answer({ status: 'active' });
  await other.ask;
  await new Promise((r) => setImmediate(r));
  assert.equal(holder.current, null, 'respondeu: a próxima conferência pergunta de novo');
  const c = shareLicenseFlight(holder, 'conta-1', ask);
  assert.equal(asked, 3);
  // pagou, desconectou o outro Mac, internet de volta: conferência nova na hora
  const d = shareLicenseFlight(holder, 'conta-1', ask, true);
  assert.notEqual(d, c);
  assert.equal(asked, 4);
  assert.equal(c.applied, true, 'a que estava no ar não passa por cima da nova');
  assert.equal(shareLicenseFlight(holder, 'conta-1', ask), d, 'quem vem depois espera a nova');
});

test('conferência nova para quem acabou de mudar algo no servidor; compartilhada no resto', () => {
  const fresh = [...access.matchAll(/loadLicense\(NET_WAIT_MS, true\)/g)].length;
  assert.equal(fresh, 6, 'desconectar o outro Mac, pagamento, internet de volta, código, "Tentar de novo" e "Já assinei"');
  assert.match(access, /window\.addEventListener\(LICENSE_REFRESH_EVENT, refreshNow\);\s*window\.addEventListener\('focus', refresh\);/);
  assert.match(access, /window\.addEventListener\('online', refreshNow\);/);
  assert.match(access, /await loadLicense\(got === 'timeout' \? 0 : NET_WAIT_MS\)/, 'abertura: compartilhada com o INITIAL_SESSION');
});

test('conferência da conta: resposta aplicada uma vez; selo de parceiro junto com a conferência', () => {
  const load = access.slice(access.indexOf('const loadLicense = async'), access.indexOf('const applyServer = (lic: License)'));
  assert.match(load, /shareLicenseFlight\(licenseFlightRef, storedSession\(\)\?\.user\.id \?\? '', askServer, fresh\)/);
  assert.match(load, /const settle = \(lic: License\) => \{ if \(flight\.applied\) return; flight\.applied = true; applyServer\(lic\); \};/);
  assert.match(load, /ask\.then\(settle\)/, 'resposta atrasada continua valendo');
  assert.doesNotMatch(load, /applyServer\(answer\)/);
  const ask = access.slice(access.indexOf('const askServer = async'), access.indexOf('// Uma conferência por vez'));
  assert.ok(ask.indexOf("rpc('my_partner_status')") < ask.indexOf("rpc('license_status')"), 'o selo sai antes, junto');
  assert.match(ask, /if \(lic\.status === 'active'\) \{[^}]*if \(await partnerAsk\) lic\.partner = true;/, 'só conta ativa leva o selo, como antes');
  assert.match(ask, /if \(lic\.status === 'trial' \|\| lic\.status === 'active'\) \{\s*\/\/ um Mac por vez/, 'um Mac por vez continua igual');
});
