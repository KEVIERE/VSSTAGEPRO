// Medição de conversões da Meta: Pixel no navegador (src/lib/metaPixel.ts) e Purchase
// pela API de Conversões (supabase/functions/_shared/metaCapi.ts).
//
// O que importa provar: navegador e servidor usam o mesmo event_id (a venda conta uma
// vez), e-mail e telefone só saem com hash, o token nunca vai no endereço, o que vem do
// navegador é conferido, e falha da Meta nunca derruba o pagamento.
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as pixel from '../src/lib/metaPixel.ts';
import {
  buildPurchaseEvent, metaConfigFromEnv, normalizeEmail, normalizePhoneBR, purchaseEventId,
  reportPurchaseToMeta, sanitizeTracking, sendMetaEvents, sha256Hex,
} from '../supabase/functions/_shared/metaCapi.ts';

const SITE = 'https://vsstagepro.com.br';
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('navegador e servidor usam o mesmo event_id do Purchase', () => {
  assert.equal(pixel.purchaseEventId('abc-123'), purchaseEventId('abc-123'));
  assert.equal(purchaseEventId('abc-123'), 'purchase_abc-123');
});

test('Pixel só liga no site, com Pixel ID, fora do programa do Mac e das telas do show', () => {
  assert.equal(pixel.configuredPixelId(' 1234567890 '), '1234567890');
  assert.equal(pixel.configuredPixelId('abc'), '');
  assert.equal(pixel.configuredPixelId(undefined), '');
  assert.deepEqual(pixel.configuredPixelIds('1074429838967668, 2021834145149783,1074429838967668,lixo'), ['1074429838967668', '2021834145149783']);
  assert.deepEqual(pixel.configuredPixelIds(undefined), []);
  const ok = { pixelId: '1234567890', desktop: false };
  for (const r of ['sales', 'pricing', 'download', 'subscribed']) assert.equal(pixel.pixelAllowed({ ...ok, route: r }), true, r);
  for (const r of ['admin', 'director', 'remote', 'screen', 'musician', 'producer']) assert.equal(pixel.pixelAllowed({ ...ok, route: r }), false, r);
  assert.equal(pixel.pixelAllowed({ ...ok, desktop: true, route: 'sales' }), false);
  assert.equal(pixel.pixelAllowed({ pixelId: '', desktop: false, route: 'sales' }), false);
});

test('sem Pixel ID no build as funções não fazem nada nem quebram', () => {
  assert.doesNotThrow(() => {
    pixel.metaPageView('sales');
    pixel.metaViewContent();
    pixel.metaCompleteRegistration('u1');
    pixel.metaInitiateCheckout({ id: 'p1', plan: 'monthly', amount_cents: 5500, status: 'pending', expires_at: new Date().toISOString() });
    pixel.metaPurchase({ id: 'p1', plan: 'monthly', amount_cents: 5500, status: 'paid', expires_at: new Date().toISOString() });
  });
  assert.equal(pixel.metaTrackingForCheckout(), undefined);
});

test('Purchase do navegador: só pago, uma vez, e só se for de agora', () => {
  const now = Date.UTC(2026, 10, 17, 12);
  const c = { id: 'p1', plan: 'yearly', amount_cents: 34900, status: 'paid', expires_at: new Date(now - 3600_000).toISOString() };
  assert.equal(pixel.shouldTrackPurchase(c, now, new Set()), true);
  assert.equal(pixel.shouldTrackPurchase(c, now, new Set(['p1'])), false);
  assert.equal(pixel.shouldTrackPurchase({ ...c, status: 'pending' }, now, new Set()), false);
  assert.equal(pixel.shouldTrackPurchase({ ...c, expires_at: new Date(now - 2 * 86400_000).toISOString() }, now, new Set()), false);
  assert.equal(pixel.centsToValue(34900), 349);
  assert.equal(pixel.PLAN_VALUE.monthly, 55);
});

test('cookies da Meta lidos do navegador, com fbclid de reserva', () => {
  const t = pixel.readMetaTracking('a=1; _fbp=fb.1.1731800000000.123456789; _fbc=fb.1.1731800000000.AbC_d-1', '', `${SITE}/?utm_source=meta#planos`, 0);
  assert.deepEqual(t, { fbp: 'fb.1.1731800000000.123456789', fbc: 'fb.1.1731800000000.AbC_d-1', url: `${SITE}/?utm_source=meta` });
  const r = pixel.readMetaTracking('_fbp=lixo', '?fbclid=XyZ123', `${SITE}/`, 1731800000000);
  assert.equal(r.fbp, undefined);
  assert.equal(r.fbc, 'fb.1.1731800000000.XyZ123');
});

test('hash e normalização como a Meta pede', async () => {
  assert.equal(await sha256Hex('teste@vsstage.com'), sha('teste@vsstage.com'));
  assert.equal(normalizeEmail('  Fulano@Gmail.COM '), 'fulano@gmail.com');
  assert.equal(normalizeEmail('sem-arroba'), null);
  assert.equal(normalizePhoneBR('(11) 98765-4321'), '5511987654321');
  assert.equal(normalizePhoneBR('+55 11 98765-4321'), '5511987654321');
  assert.equal(normalizePhoneBR('123'), null);
});

test('o que vem do navegador é conferido antes de gravar', () => {
  const t = sanitizeTracking(
    { fbp: 'fb.1.1731800000000.123', fbc: '<script>', url: 'https://golpe.com/x' },
    { ip: '200.1.2.3, 10.0.0.1', ua: 'Mozilla/5.0' }, SITE,
  );
  assert.deepEqual(t, { fbp: 'fb.1.1731800000000.123', ip: '200.1.2.3', ua: 'Mozilla/5.0' });
  assert.equal(sanitizeTracking(null, {}, SITE), null);
  assert.equal(sanitizeTracking({ url: `${SITE}/#planos` }, {}, SITE).url, `${SITE}/#planos`);
  assert.equal(sanitizeTracking({ url: `${SITE}.golpe.com/` }, {}, SITE), null);
});

const compra = {
  paymentId: 'pay-1', orderNsu: 'vs-abc-1', plan: 'yearly', amountCents: 34900, userId: 'user-1',
  email: ' Fulano@Gmail.com', phone: '11987654321',
  tracking: { fbp: 'fb.1.1731800000000.1', fbc: 'fb.1.1731800000000.Ab', url: `${SITE}/#planos`, ip: '200.1.2.3', ua: 'Mozilla/5.0' },
};

test('Purchase do servidor: valor em reais, BRL, dados pessoais só com hash', async () => {
  const e = await buildPurchaseEvent({ ...compra, eventTime: 1731800000.7 }, SITE);
  assert.equal(e.event_name, 'Purchase');
  assert.equal(e.event_id, 'purchase_pay-1');
  assert.equal(e.event_time, 1731800000);
  assert.equal(e.action_source, 'website');
  assert.equal(e.event_source_url, `${SITE}/#planos`);
  assert.deepEqual(e.custom_data.currency, 'BRL');
  assert.equal(e.custom_data.value, 349);
  assert.equal(e.custom_data.order_id, 'vs-abc-1');
  assert.deepEqual(e.user_data.em, [sha('fulano@gmail.com')]);
  assert.deepEqual(e.user_data.ph, [sha('5511987654321')]);
  assert.deepEqual(e.user_data.external_id, [sha('user-1')]);
  assert.equal(e.user_data.fbc, 'fb.1.1731800000000.Ab');
  assert.equal(e.user_data.client_ip_address, '200.1.2.3');
  const texto = JSON.stringify(e);
  assert.ok(!texto.includes('fulano'), 'e-mail sem hash vazou');
  assert.ok(!texto.includes('987654321'), 'telefone sem hash vazou');
});

test('envio: token no corpo, nunca no endereço, e código de teste quando houver', async () => {
  const chamadas = [];
  const fetchFn = async (url, init) => {
    chamadas.push({ url, corpo: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => '{"events_received":1}' };
  };
  const r = await sendMetaEvents(fetchFn, { pixelId: '1234567890', token: 'TOKEN-SECRETO', testEventCode: 'TEST123', siteUrl: SITE }, [{ a: 1 }]);
  assert.equal(r.ok, true);
  assert.match(chamadas[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.0\/1234567890\/events$/);
  assert.ok(!chamadas[0].url.includes('TOKEN'));
  assert.equal(chamadas[0].corpo.access_token, 'TOKEN-SECRETO');
  assert.equal(chamadas[0].corpo.test_event_code, 'TEST123');
});

test('sem Pixel ou sem token não manda nada; erro da Meta nunca lança', async () => {
  assert.deepEqual(metaConfigFromEnv(() => undefined, SITE), []);
  assert.deepEqual(metaConfigFromEnv((k) => (k === 'META_PIXEL_ID' ? '1234567890' : undefined), SITE), []);
  const [cfg] = metaConfigFromEnv((k) => ({ META_PIXEL_ID: '1234567890', META_CAPI_TOKEN: 'tk' })[k], SITE);
  assert.deepEqual(cfg, { pixelId: '1234567890', token: 'tk', testEventCode: undefined, siteUrl: SITE });
  // Dois Pixels: o token geral vale só para o primeiro; o segundo precisa do token dele.
  const dois = (extra) => metaConfigFromEnv((k) => ({ META_PIXEL_ID: '1111111111,2222222222', META_CAPI_TOKEN: 'tk1', ...extra })[k], SITE);
  assert.deepEqual(dois({}).map((c) => c.pixelId), ['1111111111']);
  assert.deepEqual(dois({ META_CAPI_TOKEN_2222222222: 'tk2' }).map((c) => [c.pixelId, c.token]), [['1111111111', 'tk1'], ['2222222222', 'tk2']]);

  const erros = [];
  const base = {
    loadPurchase: async () => compra,
    now: () => 1731800000000,
    log: () => {},
    error: (...a) => erros.push(a.join(' ')),
  };
  let chamou = false;
  assert.equal(await reportPurchaseToMeta({ ...base, configs: [], fetch: async () => { chamou = true; } }, 'vs-abc-1'), 'skipped');
  assert.equal(chamou, false);

  assert.equal(await reportPurchaseToMeta({ ...base, configs: [cfg], fetch: async () => { throw new Error('rede caiu'); } }, 'vs-abc-1'), 'failed');
  assert.equal(await reportPurchaseToMeta({ ...base, configs: [cfg], fetch: async () => ({ ok: false, status: 400, text: async () => 'erro' }) }, 'vs-abc-1'), 'failed');
  assert.equal(await reportPurchaseToMeta({ ...base, configs: [cfg], loadPurchase: async () => { throw new Error('banco'); }, fetch: async () => ({}) }, 'vs-abc-1'), 'failed');
  assert.ok(erros.every((e) => !e.includes('tk')), 'token apareceu no log');

  // Dois Pixels: o mesmo evento vai para os dois, cada um com o seu token.
  const urls = [];
  const cfg2 = { ...cfg, pixelId: '2222222222', token: 'tk2' };
  const r2 = await reportPurchaseToMeta({ ...base, configs: [cfg, cfg2], fetch: async (url, init) => { urls.push([url.split('/')[4], JSON.parse(init.body).access_token, JSON.parse(init.body).data[0].event_id]); return { ok: true, status: 200, text: async () => '{}' }; } }, 'vs-abc-1');
  assert.equal(r2, 'sent');
  assert.deepEqual(urls, [['1234567890', 'tk', 'purchase_pay-1'], ['2222222222', 'tk2', 'purchase_pay-1']]);

  const enviado = await reportPurchaseToMeta({ ...base, configs: [cfg], fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }) }, 'vs-abc-1');
  assert.equal(enviado, 'sent');
});

test('Purchase pelo servidor só quando o pedido é liberado agora (activated)', () => {
  const webhook = readFileSync(new URL('../supabase/functions/infinitepay-webhook/index.ts', import.meta.url), 'utf8');
  const checkout = readFileSync(new URL('../supabase/functions/pix-checkout/index.ts', import.meta.url), 'utf8');
  assert.match(webhook, /r\.result === 'activated'\) await reportPurchase\(orderNsu\)/);
  assert.match(checkout, /r\.result === 'activated'\) await reportPurchase\(orderNsu\)/);
  const mig = readFileSync(new URL('../supabase/migrations/20261117120000_meta_conversoes.sql', import.meta.url), 'utf8');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS meta_tracking jsonb/);
});
