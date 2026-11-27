// Click gerado pelo programa que às vezes não tocava ("só não entrou a faixa: <música> - Click").
// O click (makeClickClip) registra o áudio na biblioteca ANTES de o clipe entrar na store, com
// esperas no meio (toClipAudioAsync, o click de cada parte do medley no refazer pela grade). A
// limpeza da memória do App (pruneAudioLibrary) que rodasse nesse meio via um clipe que não estava
// na timeline nem no Desfazer e apagava o áudio: o clipe entrava sem fonte e sem áudio, o Play
// pulava a faixa e a entrada atrasada (lateAttachMissingClips) nunca achava o que tocar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

globalThis.window = globalThis;

const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
const stubs = {
  '@/store': 'export const useStore = { getState: () => ({ setSongLoading() {}, setSongIncomplete() {} }) };',
  '@/lib/audioDecoder': 'export const decodeBlob = async () => { throw new Error("sem decodificar no teste"); }; export const deviceSampleRate = () => 48000;',
};
export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  if (spec.startsWith('@/')) return next(SRC + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}
`));

const lib = await import('../src/lib/audioLibrary.ts');

const audio = () => ({ channels: [new Int16Array(480)], sampleRate: 48000, length: 480 });
const none = new Set();

test('limpeza no meio da montagem do click não apaga o áudio dele', async () => {
  lib.clearAudioLibrary();
  const id = 'clip-song-1-click-novo';
  // makeClickClip: fonte registrada, espera na conversão, e só depois o áudio aberto
  lib.registerClipSource(id, 'song-1', new Blob([new Uint8Array(64)]));
  await new Promise((r) => setTimeout(r, 0));
  lib.pruneAudioLibrary(none, none); // a limpeza do App roda nessa espera
  lib.putClipAudio(id, 'song-1', audio());
  // o clipe entra na timeline: fonte e áudio continuam lá
  lib.pruneAudioLibrary(new Set([id]), none);
  assert.ok(lib.getClipSource(id), 'a fonte do click continua registrada (dá para reabrir e salvar)');
  assert.ok(lib.getClipPlayAudio({ id, duration: 0.01 }), 'o Play acha o áudio do click');
  assert.deepEqual(lib.missingClipIds('song-1'), []);
});

test('click do refazer pela grade (medley, um por parte) sobrevive à limpeza entre as partes', () => {
  lib.clearAudioLibrary();
  const parts = ['clip-m-click-a', 'clip-m-click-b', 'clip-m-click-c'];
  for (const id of parts) {
    lib.registerClipSource(id, 'm', new Blob([new Uint8Array(64)]));
    lib.putClipAudio(id, 'm', audio());
    lib.pruneAudioLibrary(new Set(['clip-m-click-velho']), none);
  }
  for (const id of parts) assert.ok(lib.getClipAudio(id) && lib.getClipSource(id), id);
});

test('o que saiu da timeline continua sendo limpo como antes', () => {
  lib.clearAudioLibrary();
  const id = 'clip-removido';
  lib.registerClipSource(id, 's', new Blob([new Uint8Array(64)]));
  lib.putClipAudio(id, 's', audio());
  lib.pruneAudioLibrary(new Set([id]), none); // já esteve na timeline
  lib.pruneAudioLibrary(none, new Set([id])); // só no Desfazer: solta o áudio, guarda a fonte
  assert.equal(lib.getClipAudio(id), null);
  assert.ok(lib.getClipSource(id));
  lib.pruneAudioLibrary(none, none); // nem no Desfazer: esquecido
  assert.equal(lib.getClipSource(id), null);
});

test('montagem abandonada não fica para sempre na memória', () => {
  lib.clearAudioLibrary();
  const id = 'clip-nunca-entrou';
  lib.registerClipSource(id, 's', new Blob([new Uint8Array(64)]));
  lib.putClipAudio(id, 's', audio());
  lib.pruneAudioLibrary(none, none);
  assert.ok(lib.getClipSource(id), 'dentro do prazo continua');
  lib.pruneAudioLibrary(none, none, Date.now() + lib.PENDING_CLIP_GRACE_MS + 1);
  assert.equal(lib.getClipSource(id), null, 'passado o prazo, é limpo');
});
