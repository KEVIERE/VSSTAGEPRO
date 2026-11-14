// Nenhum texto do site, do admin ou da tela de assinatura pode citar o provedor de
// cartão antigo. Vale para strings e texto de JSX; comentários e nomes de campo do
// banco (stripe_customer_id, stripeCustomerId) ficam de fora, porque são contrato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WORD = /\bstripe\b/i;

/**
 * Tira os comentários e devolve o resto (código, strings e texto de JSX) com as
 * quebras de linha no lugar, para o erro apontar a linha certa. Respeita strings
 * e templates, então "https://..." não vira comentário.
 */
export function withoutComments(src) {
  let out = '';
  let i = 0;
  // Pilha de templates abertos: em cada um, quantas chaves estão abertas dentro do ${}.
  const tpl = [];
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    const inTplText = tpl.length > 0 && tpl[tpl.length - 1] === -1;
    if (inTplText) {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === '`') { tpl.pop(); out += c; i++; continue; }
      if (c === '$' && n === '{') { tpl[tpl.length - 1] = 0; out += '${'; i += 2; continue; }
      out += c; i++; continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, '');
      i = stop;
      continue;
    }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') { tpl.push(-1); out += c; i++; continue; }
    if (tpl.length > 0) {
      if (c === '{') tpl[tpl.length - 1]++;
      if (c === '}') {
        if (tpl[tpl.length - 1] === 0) { tpl[tpl.length - 1] = -1; out += c; i++; continue; }
        tpl[tpl.length - 1]--;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Linhas (1 em diante) em que a palavra aparece fora de comentário. */
export function stripeLines(src) {
  return withoutComments(src).split('\n').flatMap((line, idx) => (WORD.test(line) ? [idx + 1] : []));
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

const TARGETS = [
  ...walk(join(ROOT, 'src/components/sales')),
  ...walk(join(ROOT, 'src/components/admin')),
  join(ROOT, 'src/components/SubscribeDialog.tsx'),
  join(ROOT, 'src/components/PixCheckout.tsx'),
  join(ROOT, 'src/components/SubscriptionReturn.tsx'),
];

test('o detector acha string e texto de JSX e ignora comentário e nome de campo', () => {
  assert.deepEqual(stripeLines("const a = 'Ver no Stripe';"), [1]);
  assert.deepEqual(stripeLines('<span>\n  Stripe\n</span>'), [2]);
  assert.deepEqual(stripeLines('const u = `https://dashboard.stripe.com/${id}`;'), [1]);
  assert.deepEqual(stripeLines('// pagamento antigo no Stripe\nconst x = 1;'), []);
  assert.deepEqual(stripeLines('{/* cartão ia para a Stripe */}\n<b>ok</b>'), []);
  assert.deepEqual(stripeLines('const id = u.stripe_customer_id ?? u.stripeCustomerId;'), []);
  assert.deepEqual(stripeLines("stripExt('a.wav'); const s = { p_stripe_coupon_id: null };"), []);
  assert.deepEqual(stripeLines("const u = 'https://x.com/a'; const t = 'Stripe';"), [1]);
  assert.deepEqual(stripeLines('const t = `a ${b ? `c` : "d"} e`; // Stripe'), []);
});

test('nenhuma tela do site, do admin ou da assinatura cita o provedor antigo', () => {
  assert.ok(TARGETS.length > 10, 'achou os arquivos das telas');
  const hits = TARGETS.flatMap((file) =>
    stripeLines(readFileSync(file, 'utf8')).map((line) => `${relative(ROOT, file)}:${line}`));
  assert.deepEqual(hits, [], `Texto com o provedor antigo na tela:\n${hits.join('\n')}`);
});
