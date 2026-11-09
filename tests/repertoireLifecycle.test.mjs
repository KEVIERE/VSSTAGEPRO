// Ciclo de vida do áudio de referência do produtor: envio, liberação com folga, pedido de
// repertório e o que entra em cada envio.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Réplica das regras da Edge Function (prompter-audio/index.ts) e do cliente
// (useReferenceAutoSync.ts), para travar o comportamento sem precisar do Supabase.
const RELEASE_GRACE_MS = 10 * 60 * 1000;

/** releaseExpiredAudio: o áudio sai quando passou a folga e não há pedido novo. */
function shouldRelease({ releasedAt, requestedAt, now }) {
  if (!releasedAt) return false;
  if (requestedAt) return false;
  return now - Date.parse(releasedAt) >= RELEASE_GRACE_MS;
}

/** useReferenceAutoSync: o envio automático fica quieto enquanto o áudio está liberado. */
function autoSendBlocked({ released, isPlaying }) {
  return released || isPlaying;
}

/** Quais músicas entram num pedido novo: só as que ainda não têm letra. */
function pendingForRequest(songs, doneSongIds) {
  const done = new Set(doneSongIds);
  return songs.filter((s) => !done.has(s.id)).map((s) => s.id);
}

const T0 = Date.parse('2026-11-04T20:00:00.000Z');

test('sem o produtor salvar, o áudio nunca é liberado', () => {
  assert.equal(shouldRelease({ releasedAt: null, requestedAt: null, now: T0 + 10 * 60 * 1000 }), false);
});

test('logo depois de salvar, o áudio ainda fica (a folga protege o produtor)', () => {
  assert.equal(shouldRelease({ releasedAt: new Date(T0).toISOString(), requestedAt: null, now: T0 + 60_000 }), false);
  assert.equal(shouldRelease({ releasedAt: new Date(T0).toISOString(), requestedAt: null, now: T0 + 9 * 60 * 1000 }), false);
});

test('passados os 10 minutos, o áudio sai sozinho', () => {
  assert.equal(shouldRelease({ releasedAt: new Date(T0).toISOString(), requestedAt: null, now: T0 + 10 * 60 * 1000 }), true);
  assert.equal(shouldRelease({ releasedAt: new Date(T0).toISOString(), requestedAt: null, now: T0 + 60 * 60 * 1000 }), true);
});

test('um pedido novo segura a liberação, para o áudio poder subir de novo', () => {
  // O pedido zera produced_audio_released_at no banco. Mesmo com a marca velha em mãos,
  // a presença de requestedAt já impede a limpeza.
  assert.equal(shouldRelease({
    releasedAt: new Date(T0).toISOString(),
    requestedAt: new Date(T0 + 20 * 60 * 1000).toISOString(),
    now: T0 + 30 * 60 * 1000,
  }), false);
});

test('com o áudio liberado, o envio automático não sobe nada de novo', () => {
  // Era o problema: reabrir o programa encontrava a pasta vazia e subia tudo outra vez.
  assert.equal(autoSendBlocked({ released: true, isPlaying: false }), true);
  assert.equal(autoSendBlocked({ released: false, isPlaying: false }), false);
  assert.equal(autoSendBlocked({ released: false, isPlaying: true }), true, 'tocando, também não envia');
});

test('um pedido de repertório manda só as músicas sem letra', () => {
  const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(pendingForRequest(songs, ['a', 'c']), ['b', 'd']);
  assert.deepEqual(pendingForRequest(songs, []), ['a', 'b', 'c', 'd'], 'sem nenhuma letra, manda todas');
  assert.deepEqual(pendingForRequest(songs, ['a', 'b', 'c', 'd']), [], 'com todas prontas, não manda nada');
});

test('música nova no repertório entra no próximo pedido', () => {
  // O produtor salvou quando eram 3 músicas; o diretor acrescentou uma quarta depois.
  assert.deepEqual(pendingForRequest([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'nova' }], ['a', 'b', 'c']), ['nova']);
});

test('o pedido é consumido uma vez: a marca é apagada ao pegar', () => {
  // director_take_repertoire_request devolve o carimbo e zera a coluna. Simula as duas leituras.
  let requestedAt = new Date(T0).toISOString();
  const take = () => { const cur = requestedAt; requestedAt = null; return cur; };
  assert.equal(take(), new Date(T0).toISOString());
  assert.equal(take(), null, 'a segunda leitura não repete o envio');
});
