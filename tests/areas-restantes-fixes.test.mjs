// Prazo de 8 s no estado online da TV e do produtor, e a Área do Músico com a tela acesa pelo hook
// comum (trava nativa sempre; o vídeo só depois do botão "Manter a tela acesa").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// rpc falso no formato do Supabase: devolve um construtor com abortSignal, que responde com erro
// (sem lançar) quando o sinal é cancelado, como o postgrest-js faz.
const typesUrl = new URL('../src/lib/prompterTypes.ts', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const stubs = {
  '@/lib/supabaseClient': 'export const supabase = { rpc: (name, args) => globalThis.__rpc(name, args) };',
  '@/lib/localNetwork': 'export const isLocalClient = () => false;',
  '@/lib/localClientApi': 'export const localProducerPost = async () => {}; export const localPrompterState = async () => ({});',
  '@/lib/publicUrl': 'export const publicLink = (x) => x;',
};
export async function resolve(spec, ctx, next) {
  if (spec === '@/lib/prompterTypes') return { shortCircuit: true, url: ${JSON.stringify(typesUrl)} };
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  return next(spec, ctx);
}
`));
const api = await import('../src/lib/prompterApi.ts');

const show = { name: 'Show', setlist: { songs: [], blocks: [], order: [] }, live: null, live_at: '' };

/** `reply`: null = o pedido nunca volta (só o cancelamento termina). */
function fakeRpc(reply) {
  const calls = [];
  globalThis.__rpc = (name, args) => {
    const call = { name, args, signal: null };
    calls.push(call);
    return {
      abortSignal(signal) {
        call.signal = signal;
        if (reply) return Promise.resolve(reply);
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({
            data: null, error: { message: 'AbortError: This operation was aborted', details: '', hint: '', code: '' },
          }));
        });
      },
    };
  };
  return calls;
}

test('producer_state e screen_state online vão com prazo (abortSignal)', async () => {
  const calls = fakeRpc({ data: { show, prompter: {}, lyrics: [], server_now: 'now' }, error: null });
  await api.screenState('ABC');
  await api.producerState('ABC', 'r1');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.name), ['screen_state', 'producer_state']);
  assert.deepEqual(calls[1].args, { p_code: 'ABC', p_lyrics_rev: 'r1' });
  for (const c of calls) {
    assert.ok(c.signal, `${c.name} sem abortSignal`);
    assert.equal(c.signal.aborted, false, 'resposta a tempo não é cancelada');
  }
});

test('consulta que não volta é cancelada em 8 s e vira erro (o feed mostra offline e tenta de novo)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = fakeRpc(null);
  const pending = api.screenState('ABC');
  // deixa o rpc ser chamado antes de andar o relógio
  await Promise.resolve();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(api.STATE_TIMEOUT_MS - 1);
  assert.equal(calls[0].signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(calls[0].signal.aborted, true);
  await assert.rejects(pending, (e) => e instanceof Error && e.message !== 'invalid_code' && /Abort/.test(e.message));
});

test('o prazo é só no estado: o resto do Supabase segue sem prazo', () => {
  assert.equal(api.STATE_TIMEOUT_MS, 8000);
  const src = read('src', 'lib', 'prompterApi.ts');
  assert.match(src, /stateRpc\('producer_state', stateArgs\(code, lyricsRev\)\)/);
  assert.match(src, /stateRpc\('screen_state', stateArgs\(code, lyricsRev\)\)/);
  assert.doesNotMatch(read('src', 'lib', 'supabaseClient.ts'), /AbortSignal\.timeout|STATE_TIMEOUT_MS/);
});

test('Área do Músico: tela acesa pelo hook comum, vídeo só no botão', () => {
  const ws = read('src', 'components', 'musician', 'MusicianWorkspace.tsx');
  assert.match(ws, /from '@\/lib\/useWakeLock'/);
  assert.match(ws, /useKeepAwake\(true, 'botao'\)/);
  assert.match(ws, /onClick=\{awake\.startVideo\}/);
  assert.match(ws, /Manter a tela acesa/);
  assert.doesNotMatch(ws, /useScreenAwake|wakeLock\.request|KEEP_AWAKE_MP4/);
  assert.equal(fs.existsSync(path.join(root, 'src', 'components', 'musician', 'useScreenAwake.ts')), false);
});

test('hook: no modo botao, Wake Lock recusado pede de novo no toque (click, touchend, tecla)', () => {
  const lib = read('src', 'lib', 'useWakeLock.ts');
  assert.match(lib, /const GESTURES = \['click', 'touchend', 'keydown'\] as const;/);
  assert.match(lib, /setState\('precisaBotao'\);\s*if \(hasNativeWakeLock\(\)\) armNative\(\);/);
  // o botão liga o vídeo dentro do clique, sem await antes do play()
  assert.match(lib, /startRef\.current = \(\) => \{\s*useVideo = true;\s*disarmNative\(\);\s*playVideo\(true\);/);
});

test('textos sem travessão', () => {
  for (const f of [['lib', 'prompterApi.ts'], ['lib', 'useWakeLock.ts'], ['components', 'musician', 'MusicianWorkspace.tsx']]) {
    assert.doesNotMatch(read('src', ...f), /\u2014/, f.join('/'));
  }
});
