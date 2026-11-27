// Entrar com o Google no programa de computador: abre no navegador padrão, volta por 127.0.0.1,
// troca o código pela sessão (PKCE) e segue o caminho de quem entra com e-mail e senha.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const require = createRequire(import.meta.url);
const { GoogleAuthFlow, PORTS, CALLBACK_PATH, SUPABASE_HOST, parseCallback, isAllowedAuthUrl, isNavigation, resultPage, redirectFor } = require('../desktop/googleAuth.js');

const AUTH_URL = 'https://eknjqqiamuztomdygalv.supabase.co/auth/v1/authorize?provider=google&redirect_to=x&code_challenge=abc&code_challenge_method=s256';

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('endereço de retorno fixo em 127.0.0.1 com portas de reserva', () => {
  assert.equal(PORTS.length, 3);
  assert.equal(redirectFor(PORTS[0]), `http://127.0.0.1:${PORTS[0]}/auth/google`);
  assert.equal(CALLBACK_PATH, '/auth/google');
});

test('lê o código, o erro e ignora outros endereços', () => {
  assert.deepEqual(parseCallback('/auth/google?code=abc123'), { code: 'abc123' });
  assert.deepEqual(parseCallback('/auth/google?error=access_denied&error_description=User+cancelled'), { error: 'access_denied', description: 'User cancelled' });
  assert.deepEqual(parseCallback('/auth/google'), { empty: true });
  assert.equal(parseCallback('/favicon.ico'), null);
});

test('só abre no navegador a autorização do Google no Supabase', () => {
  assert.equal(isAllowedAuthUrl(AUTH_URL), true);
  assert.equal(isAllowedAuthUrl('http://eknjqqiamuztomdygalv.supabase.co/auth/v1/authorize?provider=google'), false);
  assert.equal(isAllowedAuthUrl('https://exemplo.com/qualquer'), false);
  assert.equal(isAllowedAuthUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedAuthUrl('https://x.supabase.co/auth/v1/authorize?provider=github'), false);
  // só o projeto do VS Stage: outro site com o mesmo caminho não abre
  assert.equal(SUPABASE_HOST, 'eknjqqiamuztomdygalv.supabase.co');
  assert.equal(isAllowedAuthUrl('https://x.supabase.co/auth/v1/authorize?provider=google'), false);
  assert.equal(isAllowedAuthUrl('https://exemplo.com/auth/v1/authorize?provider=google'), false);
  assert.equal(isAllowedAuthUrl('https://eknjqqiamuztomdygalv.supabase.co.exemplo.com/auth/v1/authorize?provider=google'), false);
  assert.equal(isAllowedAuthUrl('https://u:p@eknjqqiamuztomdygalv.supabase.co/auth/v1/authorize?provider=google'), false);
  assert.equal(isAllowedAuthUrl('https://eknjqqiamuztomdygalv.supabase.co:8443/auth/v1/authorize?provider=google'), false);
});

test('só o navegador indo para a página conta como retorno', () => {
  assert.equal(isNavigation({}), true);
  assert.equal(isNavigation({ 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' }), true);
  assert.equal(isNavigation({ 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors' }), false);
  assert.equal(isNavigation({ 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' }), false);
  assert.equal(isNavigation({ 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' }), false);
});

test('página de outro site não interrompe a entrada; retorno vazio também não', async () => {
  const flow = new GoogleAuthFlow({ ports: [47961], timeoutMs: 5000, openExternal: async () => {} });
  const prep = await flow.prepare();
  let done = null;
  const waiting = flow.wait(AUTH_URL).then((r) => { done = r; return r; });
  await new Promise((r) => setTimeout(r, 20));
  // imagem e fetch de uma página qualquer: 404, nada muda
  assert.equal((await get(`${prep.redirectTo}?error=x`, { 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors' })).status, 404);
  assert.equal((await get(`${prep.redirectTo}?code=falso`, { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors' })).status, 404);
  // sem código e sem erro: página de espera que repassa o erro depois do #, sem encerrar
  const empty = await get(prep.redirectTo);
  assert.equal(empty.status, 200);
  assert.match(empty.body, /location\.hash/);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done, null);
  // o retorno de verdade ainda chega
  await get(`${prep.redirectTo}?code=bom`, { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' });
  assert.deepEqual(await waiting, { status: 'ok', code: 'bom' });
});

test('cancelar antes de abrir o Google: o wait responde cancelado, não erro', async () => {
  const flow = new GoogleAuthFlow({ ports: [47971], timeoutMs: 5000, openExternal: async () => { throw new Error('não devia abrir'); } });
  await flow.prepare();
  flow.cancel();
  assert.deepEqual(await flow.wait(AUTH_URL), { status: 'cancelled' });
  // a tela também confere se foi cancelada enquanto pedia o endereço
  const src = read('src', 'lib', 'authFlow.ts');
  assert.match(src, /const mine = \+\+googleAttempt;/);
  assert.equal((src.match(/if \(cancelled\(\)\) throw new Error\('google_cancelled'\);/g) || []).length, 3);
  assert.match(src, /export function cancelGoogleSignIn\(\): void \{\n  googleAttempt \+= 1;/);
});

test('página do navegador manda voltar ao VS Stage, em português e sem travessão', () => {
  const ok = resultPage(true);
  assert.match(ok, /voltar ao VS Stage/);
  assert.match(ok, /lang="pt-BR"/);
  assert.match(resultPage(false), /tente de novo/);
  assert.doesNotMatch(ok + resultPage(false), /—/);
});

test('retorno com código: responde a página, traz a janela e entrega o código', async () => {
  const ports = [47911, 47912];
  let opened = null;
  let focused = 0;
  const flow = new GoogleAuthFlow({ ports, timeoutMs: 5000, openExternal: async (u) => { opened = u; }, focusWindow: () => { focused += 1; } });
  const prep = await flow.prepare();
  assert.equal(prep.redirectTo, 'http://127.0.0.1:47911/auth/google');
  const waiting = flow.wait(AUTH_URL);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, AUTH_URL);
  const page = await get(`${prep.redirectTo}?code=xyz`);
  assert.equal(page.status, 200);
  assert.match(page.body, /voltar ao VS Stage/);
  assert.deepEqual(await waiting, { status: 'ok', code: 'xyz' });
  assert.equal(focused, 1);
});

test('porta ocupada: usa a seguinte', async () => {
  const busy = http.createServer();
  await new Promise((r) => busy.listen(47921, '127.0.0.1', r));
  try {
    const flow = new GoogleAuthFlow({ ports: [47921, 47922], timeoutMs: 5000, openExternal: async () => {} });
    const prep = await flow.prepare();
    assert.equal(prep.redirectTo, 'http://127.0.0.1:47922/auth/google');
    flow.cancel();
  } finally {
    busy.close();
  }
});

test('todas as portas ocupadas: avisa', async () => {
  const busy = http.createServer();
  await new Promise((r) => busy.listen(47931, '127.0.0.1', r));
  try {
    const flow = new GoogleAuthFlow({ ports: [47931], openExternal: async () => {} });
    assert.deepEqual(await flow.prepare(), { error: 'google_port_busy' });
  } finally {
    busy.close();
  }
});

test('navegador fechado: o tempo acaba; cancelar no programa solta a espera', async () => {
  const flow = new GoogleAuthFlow({ ports: [47941], timeoutMs: 60, openExternal: async () => {} });
  await flow.prepare();
  assert.deepEqual(await flow.wait(AUTH_URL), { status: 'timeout' });
  await new Promise((r) => setTimeout(r, 350));
  const again = new GoogleAuthFlow({ ports: [47941], timeoutMs: 5000, openExternal: async () => {} });
  await again.prepare();
  const waiting = again.wait(AUTH_URL);
  again.cancel();
  assert.deepEqual(await waiting, { status: 'cancelled' });
});

test('erro do Google chega à tela; endereço estranho nem abre', async () => {
  let opened = 0;
  const flow = new GoogleAuthFlow({ ports: [47951], timeoutMs: 5000, openExternal: async () => { opened += 1; } });
  const prep = await flow.prepare();
  const waiting = flow.wait(AUTH_URL);
  await new Promise((r) => setTimeout(r, 20));
  const page = await get(`${prep.redirectTo}?error=access_denied&error_description=denied`);
  assert.match(page.body, /Não deu para entrar/);
  assert.deepEqual(await waiting, { status: 'error', error: 'access_denied', description: 'denied' });
  await new Promise((r) => setTimeout(r, 350));
  await flow.prepare();
  assert.equal((await flow.wait('https://exemplo.com/')).error, 'google_bad_url');
  assert.equal(opened, 1);
});

test('principal e preload ligam o fluxo sem reescrever a navegação', () => {
  const main = read('desktop', 'main.js');
  assert.match(main, /require\('\.\/googleAuth'\)/);
  assert.match(main, /openExternal: \(url\) => shell\.openExternal\(url\)/);
  assert.match(main, /handle\('googleAuthPrepare'/);
  assert.match(main, /handle\('googleAuthWait'/);
  assert.match(main, /handle\('googleAuthCancel'/);
  assert.match(main, /googleAuth\.stop\(\)/);
  const preload = read('desktop', 'preload.js');
  assert.match(preload, /googleAuthWait: call\('googleAuthWait'\)/);
  // vai no pacote do programa
  assert.match(read('desktop', 'package.json'), /"\*\.js"/);
});

test('a tela usa PKCE, troca o código no programa e passa a sessão ao cliente principal', () => {
  const flow = read('src', 'lib', 'authFlow.ts');
  assert.match(flow, /if \(hasDesktopGoogle\(\)\) return signInWithGoogleDesktop\(\);/);
  assert.match(flow, /skipBrowserRedirect: true/);
  assert.match(flow, /exchangeCodeForSession\(res\.code\)/);
  assert.match(flow, /supabase\.auth\.setSession\(/);
  // no site continua indo para a área de downloads
  assert.match(flow, /redirectTo: `\$\{window\.location\.origin\}\/#baixar`/);
  const client = read('src', 'lib', 'supabaseClient.ts');
  assert.match(client, /flowType: 'pkce'/);
  assert.match(client, /persistSession: false/);
});

test('botão do Google espera com Cancelar e mostra os erros em português', () => {
  const da = read('src', 'components', 'DirectorAccess.tsx');
  assert.match(da, /googleWaiting \?/);
  assert.match(da, /onClick=\{cancelGoogleSignIn\}/);
  assert.match(da, /if \(code !== 'google_cancelled'\) setError\(friendlyError\(code\)\)/);
  const fe = read('src', 'lib', 'friendlyError.ts');
  for (const c of ['google_cancelled', 'google_timeout', 'google_denied', 'google_email_conflict', 'google_no_email', 'google_port_busy', 'google_failed']) {
    assert.match(fe, new RegExp(`${c}: '`));
  }
  assert.doesNotMatch(fe.match(/google_cancelled[\s\S]*?google_failed: '[^']*'/)[0], /—/);
});
