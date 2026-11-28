// Pixel da Meta no site: o que a campanha de anúncios precisa receber.
// O cadastro (CompleteRegistration) é o evento que a campanha otimiza; se ele some do site,
// a Meta passa a gastar sem saber quem se cadastrou. Estes testes travam isso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pixel from '../src/lib/metaPixel.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Pixel ID: o do build quando válido, senão o Pixel do site', () => {
  assert.equal(pixel.configuredPixelId(' 1234567890 '), '1234567890');
  assert.equal(pixel.configuredPixelId('abc'), '');
  assert.equal(pixel.configuredPixelId(undefined), '');
  assert.equal(pixel.DEFAULT_PIXEL_ID, '1074429838967668');
});

test('só liga nas páginas públicas do site, nunca no programa do Mac', () => {
  const id = pixel.DEFAULT_PIXEL_ID;
  for (const route of ['sales', 'pricing', 'download', 'subscribed', 'subscriber', 'stagedownload']) {
    assert.equal(pixel.pixelAllowed({ pixelId: id, desktop: false, route }), true, route);
  }
  for (const route of ['admin', 'producer', 'musician', 'screen', 'remote']) {
    assert.equal(pixel.pixelAllowed({ pixelId: id, desktop: false, route }), false, route);
  }
  assert.equal(pixel.pixelAllowed({ pixelId: id, desktop: true, route: 'sales' }), false);
  assert.equal(pixel.pixelAllowed({ pixelId: '', desktop: false, route: 'sales' }), false);
});

test('conta recém-criada conta como cadastro; login de conta antiga não', () => {
  const now = Date.parse('2026-11-28T12:00:00Z');
  assert.equal(pixel.isNewAccount('2026-11-28T11:58:00Z', now), true);
  assert.equal(pixel.isNewAccount('2026-11-28T11:00:00Z', now), false);
  assert.equal(pixel.isNewAccount('2026-11-20T11:00:00Z', now), false);
  assert.equal(pixel.isNewAccount(undefined, now), false);
  assert.equal(pixel.isNewAccount('lixo', now), false);
});

test('fora do navegador as funções não fazem nada nem quebram', () => {
  pixel.metaPageView('sales');
  pixel.metaViewContent();
  pixel.metaCompleteRegistration('u1');
  pixel.metaRegistrationFromSession({ id: 'u1', created_at: new Date().toISOString() });
  pixel.metaRegistrationFromSession(null);
  const charge = { id: 'p1', plan: 'monthly', amount_cents: 5500, status: 'paid', expires_at: new Date().toISOString() };
  pixel.metaInitiateCheckout(charge);
  pixel.metaPurchase(charge);
});

test('Purchase do navegador: só pago, uma vez, e só se for de agora', () => {
  const now = Date.parse('2026-11-28T12:00:00Z');
  const c = { id: 'p1', plan: 'yearly', amount_cents: 34900, status: 'paid', expires_at: '2026-11-28T12:20:00Z' };
  assert.equal(pixel.shouldTrackPurchase(c, now, new Set()), true);
  assert.equal(pixel.shouldTrackPurchase(c, now, new Set(['p1'])), false);
  assert.equal(pixel.shouldTrackPurchase({ ...c, status: 'pending' }, now, new Set()), false);
  assert.equal(pixel.shouldTrackPurchase({ ...c, expires_at: '2026-11-20T12:00:00Z' }, now, new Set()), false);
  assert.equal(pixel.centsToValue(34900), 349);
});

test('as telas do site chamam o Pixel nos pontos certos', () => {
  const app = src('src/App.tsx');
  assert.match(app, /metaPageView\(route\)/);
  assert.match(app, /metaRegistrationFromSession\(session\.user\)/);
  for (const f of ['src/components/DownloadAccess.tsx', 'src/components/DirectorAccess.tsx', 'src/components/sales/PricingPage.tsx']) {
    assert.match(src(f), /metaCompleteRegistration\(signUpData\.user\?\.id\)/, f);
  }
  assert.match(src('src/components/sales/PricingPage.tsx'), /metaViewContent\(\)/);
  assert.match(src('src/components/PixCheckout.tsx'), /metaInitiateCheckout\(c\)/);
  assert.match(src('src/components/SubscriptionReturn.tsx'), /metaPurchase\(c\)/);
});
