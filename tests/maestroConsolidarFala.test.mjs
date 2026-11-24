// Consolidar uma fala só (clique direito): a fala clicada, ou as selecionadas da Maestro IA, vira
// áudio na faixa Maestro no mesmo tempo; as outras falas e marcações ficam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const src = read('lib/maestroConsolidate.ts');

// a parte pura fica entre as duas marcas; o resto do arquivo importa o programa
const pure = src.slice(src.indexOf('// ---- parte pura'), src.indexOf('// ---- fim da parte pura'));
const js = ts.transpileModule(pure.replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const clipPlayLength = (c) => Math.max(0.05, c.duration - (c.trimStart ?? 0) - (c.trimEnd ?? 0));
const { pickConsolidateClipIds, consolidateSpan } = new Function('MAESTRO_IA_TRACK_ID', 'clipPlayLength',
  `${js}; return { pickConsolidateClipIds, consolidateSpan };`)('track-maestro-ia', clipPlayLength);

const IA = 'track-maestro-ia';
const clips = [
  { id: 'a', songId: 's1', trackId: IA },
  { id: 'b', songId: 's1', trackId: IA },
  { id: 'c', songId: 's1', trackId: 'track-voz' },
  { id: 'd', songId: 's2', trackId: IA },
  { id: 'e', songId: 's1', trackId: IA },
];

test('sem seleção de vários: só a fala clicada', () => {
  assert.deepEqual(pickConsolidateClipIds(clips, 'b', []), ['b']);
  assert.deepEqual(pickConsolidateClipIds(clips, 'b', ['b']), ['b']);
  // clicada fora da seleção: a seleção não conta
  assert.deepEqual(pickConsolidateClipIds(clips, 'b', ['a', 'e']), ['b']);
});

test('clicada dentro da seleção: as selecionadas da Maestro IA da mesma música', () => {
  assert.deepEqual(pickConsolidateClipIds(clips, 'a', ['a', 'c', 'd', 'e']), ['a', 'e']);
});

test('clipe que não é da Maestro IA: nada', () => {
  assert.deepEqual(pickConsolidateClipIds(clips, 'c', ['c']), []);
  assert.deepEqual(pickConsolidateClipIds(clips, 'zz', []), []);
});

test('trecho: do início da primeira fala ao fim da última, com o corte', () => {
  assert.deepEqual(consolidateSpan([{ startTime: 4, duration: 2 }]), { from: 4, duration: 2 });
  const span = consolidateSpan([
    { startTime: 10, duration: 3, trimStart: 0.5 },
    { startTime: 2, duration: 1 },
  ]);
  assert.equal(span.from, 2);
  assert.equal(span.duration, 10.5);
});

test('consolidar parcial: só as escolhidas saem, as outras marcações ficam, um passo só', () => {
  assert.match(src, /export async function consolidateMaestroIa\(songId: string, onlyClipIds\?: string\[\]\)/);
  assert.match(src, /narrations: \(sg\.narrations \?\? \[\]\)\.filter\(\(n\) => !n\.clipId \|\| !removeIds\.has\(n\.clipId\)\)/);
  assert.match(src, /startTime: from,/);
  const menu = read('components/ContextMenu.tsx');
  assert.match(menu, /clip\.trackId === MAESTRO_IA_TRACK_ID/);
  assert.match(menu, /'Consolidar as falas selecionadas' : 'Consolidar esta fala na faixa Maestro'/);
  assert.match(menu, /runConsolidateMaestroIa\(clip\.songId, ids\)/);
});
