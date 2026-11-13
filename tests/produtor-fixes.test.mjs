// Área do Produtor: letra no tempo da música (BPM do show e medley), envio da tela em pedaços
// (dois aparelhos não desfazem um ao outro) e títulos legíveis no trilho de alumínio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  isIdentityMap, refTimeMap, refToSongTime, songToRefTime, toSongWords, warpPeaks,
} from '../src/lib/lyricsAutoSync.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('BPM 0 e sem medley: o áudio do show é o tempo da música', () => {
  const m = refTimeMap({ bpmAdjust: 0 });
  assert.ok(isIdentityMap(m));
  near(refToSongTime(m, 83.4), 83.4);
  near(songToRefTime(m, 83.4), 83.4);
  const words = [{ w: 'Deus', s: 1, e: 2 }];
  assert.equal(toSongWords(words, m), words);
});

test('+6 BPM: 120 s no áudio do show são 126 s da música (o relógio do diretor)', () => {
  const m = refTimeMap({ bpmAdjust: 6 });
  assert.ok(!isIdentityMap(m));
  near(refToSongTime(m, 120), 126);
  near(songToRefTime(m, 126), 120);
  const m2 = refTimeMap({ bpmAdjust: -6 });
  near(refToSongTime(m2, 120), 114);
  const [w] = toSongWords([{ w: 'fiel', s: 60, e: 61 }], m);
  near(w.s, 63);
  near(w.e, 64.05);
});

test('medley com parte pulada: o que vem depois do salto não fica deslocado', () => {
  const song = {
    bpmAdjust: 0,
    parts: [
      { id: 'a', name: 'A', start: 0, end: 60 },
      { id: 'b', name: 'B', start: 60, end: 90, enabled: false },
      { id: 'c', name: 'C', start: 90, end: 150 },
    ],
  };
  const m = refTimeMap(song);
  assert.ok(!isIdentityMap(m));
  near(refToSongTime(m, 30), 30);
  near(refToSongTime(m, 70), 100); // 10 s dentro da parte C
  near(songToRefTime(m, 100), 70);
  // dentro da parte pulada o cursor vai para o começo da próxima parte
  near(songToRefTime(m, 75), 60);
  near(refToSongTime(m, songToRefTime(m, 75)), 90);
});

test('medley com todas as partes e BPM 0 continua 1:1', () => {
  const m = refTimeMap({ bpmAdjust: 0, parts: [{ id: 'a', name: 'A', start: 0, end: 50 }, { id: 'b', name: 'B', start: 50, end: 80 }] });
  assert.ok(isIdentityMap(m));
});

test('parte com BPM próprio estica só ela', () => {
  const m = refTimeMap({
    bpmAdjust: 0,
    parts: [{ id: 'a', name: 'A', start: 0, end: 60 }, { id: 'b', name: 'B', start: 60, end: 120, bpmAdjust: 6 }],
  });
  near(refToSongTime(m, 60), 60);
  const a = 120 / 126;
  near(refToSongTime(m, 60 + 30 * a), 90);
});

test('onda no tempo da música: parte pulada fica reta', () => {
  const song = {
    bpmAdjust: 0,
    parts: [
      { id: 'a', name: 'A', start: 0, end: 10 },
      { id: 'b', name: 'B', start: 10, end: 20, enabled: false },
      { id: 'c', name: 'C', start: 20, end: 30 },
    ],
  };
  const m = refTimeMap(song);
  const peaks = new Float32Array(20).fill(1); // 20 s de áudio do show, tudo com som
  const out = warpPeaks(peaks, 20, m, 30, 30);
  assert.ok(out[5] > 0.9, 'parte A tem onda');
  assert.equal(out[15], 0, 'parte pulada fica reta');
  assert.ok(out[25] > 0.9, 'parte C tem onda');
});

test('títulos no trilho de alumínio sem letra clara forçada', () => {
  for (const f of ['LyricsEditor.tsx', 'SongLyricsEditor.tsx']) {
    assert.doesNotMatch(read('src', 'components', 'prompter', f), /console-legend flex-1 !text-logic-text/, f);
  }
  assert.match(read('src', 'components', 'prompter', 'ScreenControlPanel.tsx'), /console-rail min-h-8/);
});

// usePrompterControl importa a API (Supabase) de verdade; aqui ela vira um módulo vazio, só para
// testar as funções puras do envio em pedaços.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === '@/lib/prompterApi') {
    return { shortCircuit: true, url: 'data:text/javascript,export const producerPatchPrompter = () => {}; export const producerState = () => {};' };
  }
  return next(spec, ctx);
}
`));
const { applyPatch, mergePatch, prompterDiff } = await import('../src/lib/usePrompterControl.ts');

const base = () => ({
  toggles: { lyrics: true, clock: true, showTime: false, nowNext: true, playlist: false, notices: true, logo: false, logoCorner: false, joinQr: false },
  blackout: false, fontScale: 1, lyricColor: '#ffffff', lyricFont: 'Inter', lyricAlign: 'center', mirror: false,
  barSize: 20, showStartAt: null, showDurationMin: 120, nudge: { songId: null, delta: 0 }, notice: null,
  presets: [], history: [], scheduled: [], lyricLead: 0,
});

test('só as chaves mexidas vão no pedaço, e cada chave da tela vai sozinha', () => {
  const b = base();
  const n = { ...b, toggles: { ...b.toggles, clock: false }, blackout: true };
  assert.deepEqual(prompterDiff(b, n), { toggles: { clock: false }, blackout: true });
  // ligar e desligar de novo antes de enviar: vai o valor final
  const back = { ...n, blackout: false };
  assert.deepEqual(prompterDiff(n, back, { blackout: true }), { blackout: false });
});

test('dois aparelhos: o pedaço de cada um entra por cima do servidor sem apagar o do outro', () => {
  const server = base();
  const a = { blackout: true, toggles: { clock: false } };
  const b = { fontScale: 1.2, toggles: { logoCorner: true } };
  const v = applyPatch(applyPatch(server, a), b);
  assert.equal(v.blackout, true);
  assert.equal(v.fontScale, 1.2);
  assert.equal(v.toggles.clock, false);
  assert.equal(v.toggles.logoCorner, true);
  assert.equal(v.toggles.lyrics, true);
  // envio que falhou volta para a fila: o que foi mudado depois vale mais
  assert.deepEqual(mergePatch({ blackout: true, toggles: { clock: false } }, { blackout: false, toggles: { logo: true } }),
    { blackout: false, toggles: { clock: false, logo: true } });
  assert.equal(applyPatch(server, {}), server);
});
