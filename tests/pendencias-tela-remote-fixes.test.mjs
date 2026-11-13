// Teleprompter e Remote: página da letra com tempos fora de ordem, versão das letras no estado
// online (sem quebrar banco antigo), cores dos avisos iguais às da TV e a tela sempre acesa
// num lugar só.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { autoPageIndex, pageIndexFor } from '../src/lib/prompterView.ts';
import { DEFAULT_PROMPTER } from '../src/lib/prompterTypes.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const pages = (...times) => times.map((time, i) => ({ id: `p${i}`, text: `p${i}`, time }));

test('autoPageIndex: tempos fora de ordem ficam com a página de maior tempo já passado', () => {
  assert.equal(autoPageIndex(pages(70, 62, 80), 71), 0);
  assert.equal(autoPageIndex(pages(70, 62, 80), 65), 1);
  assert.equal(autoPageIndex(pages(70, 62, 80), 80), 2);
  assert.equal(autoPageIndex(pages(70, 62, 80), 10), -1);
});

test('autoPageIndex: em ordem continua igual a antes (empate fica com a de baixo, sem tempo é pulada)', () => {
  assert.equal(autoPageIndex(pages(0, 10, 20), 15), 1);
  assert.equal(autoPageIndex(pages(0, 10, 10, 20), 12), 2);
  assert.equal(autoPageIndex(pages(0, null, 20), 25), 2);
  assert.equal(autoPageIndex(pages(0, 10, null), 25), 1);
  // folga de 50 ms: a página que entra "agora" já aparece
  assert.equal(autoPageIndex(pages(0, 10), 9.96), 1);
});

test('o painel do produtor usa o mesmo "sai antes" que a TV', () => {
  const ps = pages(0, 10, 20);
  const p = { ...DEFAULT_PROMPTER, lyricLead: 1.5 };
  assert.equal(pageIndexFor(ps, 8.7, null, p), autoPageIndex(ps, 8.7 + 1.5));
  assert.match(read('src', 'components', 'prompter', 'ScreenControlPanel.tsx'), /autoPageIndex\(pages, lv\.currentTime \+ \(state\.lyricLead \?\? 0\)\)/);
});

// prompterApi importa o Supabase de verdade; aqui ele vira um rpc falso que guarda as chamadas.
const typesUrl = new URL('../src/lib/prompterTypes.ts', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const stubs = {
  '@/lib/supabaseClient': 'export const supabase = { rpc: (name, args) => { globalThis.__rpcCalls.push([name, args]); return Promise.resolve(globalThis.__rpcReply(name, args)); } };',
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
const lyricRow = { song_id: 's1', pages: [{ id: 'a', text: 'Oi', time: 1 }], updated_at: 'x' };

function rpcReturns(data) {
  globalThis.__rpcCalls = [];
  globalThis.__rpcReply = () => ({ data, error: null });
  return globalThis.__rpcCalls;
}

test('estado online sem versão das letras: não manda p_lyrics_rev (banco antigo recusaria)', async () => {
  const calls = rpcReturns({ show, prompter: {}, lyrics: [lyricRow], server_now: 'now' });
  const snap = await api.screenState('ABC');
  assert.deepEqual(calls, [['screen_state', { p_code: 'ABC' }]]);
  assert.equal(snap.lyrics.length, 1);
  assert.equal('lyricsRev' in snap, false);
  await api.producerState('ABC', null);
  assert.deepEqual(calls[1], ['producer_state', { p_code: 'ABC' }]);
});

test('estado online com versão: manda p_lyrics_rev e devolve lyricsRev', async () => {
  const calls = rpcReturns({ show, prompter: {}, lyrics: [lyricRow], lyrics_rev: 'r2', server_now: 'now' });
  const snap = await api.producerState('ABC', 'r1');
  assert.deepEqual(calls, [['producer_state', { p_code: 'ABC', p_lyrics_rev: 'r1' }]]);
  assert.equal(snap.lyricsRev, 'r2');
  assert.equal(snap.lyrics[0].song_id, 's1');
});

test('letra igual (lyrics null com lyrics_rev): devolve null para o feed manter a que já tem', async () => {
  rpcReturns({ show, prompter: {}, lyrics: null, lyrics_rev: 'r1', server_now: 'now' });
  const snap = await api.screenState('ABC', 'r1');
  assert.equal(snap.lyrics, null);
  assert.equal(snap.lyricsRev, 'r1');
});

test('servidor antigo com lyrics null e sem lyrics_rev: vale lista vazia, a TV não fica presa', async () => {
  rpcReturns({ show, prompter: {}, lyrics: null, server_now: 'now' });
  const snap = await api.screenState('ABC');
  assert.deepEqual(snap.lyrics, []);
});

test('cores dos avisos no painel são as mesmas da TV', () => {
  const stage = read('src', 'components', 'prompter', 'StageScreen.tsx');
  const panel = read('src', 'components', 'prompter', 'NoticeControl.tsx');
  const hex = (name) => stage.match(new RegExp(`const ${name} = '(#[0-9a-f]{6})'`, 'i'))[1].toLowerCase();
  const dot = (id) => panel.match(new RegExp(`id: '${id}'[^\\n]*dot: '(#[0-9a-f]{6})'`, 'i'))[1].toLowerCase();
  assert.equal(dot('info'), hex('GREEN'));
  assert.equal(dot('warn'), hex('ORANGE'));
  assert.equal(dot('urgent'), hex('RED'));
});

test('avisos do produtor carimbados e contados na hora do servidor', () => {
  for (const f of ['NoticeControl.tsx', 'QuickNotices.tsx']) {
    assert.match(read('src', 'components', 'prompter', f), /withNotice\([^\n]*Date\.now\(\) \+ clockOffsetMs\)/, f);
  }
  const area = read('src', 'components', 'prompter', 'ProducerArea.tsx');
  assert.match(area, /const serverNow = feed\.now \+ feed\.sync\.clockOffsetMs;/);
  assert.match(area, /now=\{serverNow\} clockOffsetMs=\{feed\.sync\.clockOffsetMs\}/);
});

test('tela sempre acesa: um hook só, usado pela TV e pelo Remote', () => {
  const lib = read('src', 'lib', 'useWakeLock.ts');
  assert.match(lib, /export function useKeepAwake\(/);
  assert.match(lib, /const KEEP_AWAKE_MP4 = 'data:video\/mp4;base64,/);
  for (const f of [['components', 'prompter', 'StageScreenPage.tsx'], ['components', 'MobileShowRemote.tsx']]) {
    const src = read('src', ...f);
    assert.match(src, /from '@\/lib\/useWakeLock'/, f.join('/'));
    assert.doesNotMatch(src, /KEEP_AWAKE_MP4|wakeLock\.request/, f.join('/'));
  }
});
