// Falas do Maestro IA se comportam como os outros áudios: a voz gerada é um clipe comum da faixa
// Maestro IA e a marcação só guarda texto, voz e o que precisa para gerar de novo.
// - Delete (atalho do App ou da timeline) e "Remover Clip" apagam a fala inteira;
// - o menu da fala tem as mesmas opções dos áudios (Copiar, Colar, Duplicar, Dividir, Unir...);
// - dividir, unir ou mandar para outra faixa transforma a voz num áudio comum (a marcação sai);
// - fala de projeto antigo com o áudio faltando continua lá e dá para selecionar e apagar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAESTRO_IA_TRACK_ID, hasLiveClip, looseMaestroClips, pruneNarrationLinks } from '../src/lib/narrations.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', 'src', ...p), 'utf8');

const IA = MAESTRO_IA_TRACK_ID;
const clip = (id, trackId = IA) => ({ id, trackId });
const fala = (id, clipId) => ({ id, text: id, voice: 'feminina', start: 0, end: 1, status: 'ready', ...(clipId ? { clipId } : {}) });
const song = (narrations) => ({ id: 's1', narrations });

test('áudio da fala apagado: a fala sai junto', () => {
  const songs = [song([fala('a', 'ca'), fala('b', 'cb')])];
  const out = pruneNarrationLinks(songs, [clip('ca'), clip('cb')], [clip('cb')]);
  assert.deepEqual(out[0].narrations.map((n) => n.id), ['b']);
});

test('voz mandada para outra faixa vira áudio comum de lá', () => {
  const songs = [song([fala('a', 'ca')])];
  const out = pruneNarrationLinks(songs, [clip('ca')], [clip('ca', 'track-voz')]);
  assert.deepEqual(out[0].narrations, []);
});

test('fala dividida: os pedaços ficam como clipes comuns', () => {
  const songs = [song([fala('a', 'ca'), fala('b', 'cb')])];
  const out = pruneNarrationLinks(songs, [clip('ca'), clip('cb')], [clip('ca'), clip('cb'), clip('ca-split')], ['ca']);
  assert.deepEqual(out[0].narrations.map((n) => n.id), ['b']);
});

test('fala de projeto antigo com o áudio faltando não some sozinha', () => {
  const songs = [song([fala('a', 'sumiu'), fala('b')])];
  const out = pruneNarrationLinks(songs, [clip('x', 'track-bateria')], []);
  assert.equal(out, songs, 'nada mudou: mesma lista');
});

test('sem mudança nas falas, devolve a mesma lista (não cria passo no desfazer)', () => {
  const songs = [song([fala('a', 'ca')]), { id: 's2' }];
  assert.equal(pruneNarrationLinks(songs, [clip('ca'), clip('z', 'track-guia')], [clip('ca')]), songs);
  const withOne = pruneNarrationLinks(songs, [clip('ca')], []);
  assert.equal(withOne[1], songs[1], 'a música sem fala mexida continua a mesma');
});

test('áudios soltos da faixa Maestro IA aparecem na régua das falas', () => {
  const clips = [clip('ca'), clip('pedaco'), clip('bat', 'track-bateria')];
  assert.deepEqual(looseMaestroClips(clips, [fala('a', 'ca'), fala('b')]).map((c) => c.id), ['pedaco']);
  assert.deepEqual(looseMaestroClips(clips, undefined).map((c) => c.id), ['ca', 'pedaco']);
});

test('fala com o áudio no projeto entra na seleção dos clipes; sem o áudio, seleção própria', () => {
  assert.equal(hasLiveClip(fala('a', 'ca'), [clip('ca')]), true);
  assert.equal(hasLiveClip(fala('a', 'sumiu'), [clip('ca')]), false);
  assert.equal(hasLiveClip(fala('b'), [clip('ca')]), false);
  const lane = read('components', 'NarrationLane.tsx');
  assert.match(lane, /const live = hasLiveClip\(n, useStore\.getState\(\)\.clips\);/);
  assert.match(lane, /if \(live && n\.clipId && onSelectClip\) \{/);
});

test('a store mantém a fala ligada ao clipe em toda ação de áudio', () => {
  const store = read('store.ts');
  const without = store.slice(store.indexOf('function withoutClips('), store.indexOf('// Só o que o usuário edita entra no Desfazer'));
  assert.match(without, /songs: pruneNarrationLinks\(songs, s\.clips, nextClips\)/, 'removeClips (Delete do App, menu Editar)');
  const removeAt = store.indexOf('removeClip: (clipId) => set(');
  const remove = store.slice(removeAt, store.indexOf('removeClips: (clipIds) =>', removeAt));
  assert.match(remove, /pruneNarrationLinks\(/, 'Remover Clip do botão direito');
  const splitAt = store.indexOf('splitClipsAt: (clipIds, atSeconds) => {');
  const split = store.slice(splitAt, store.indexOf('applySongEnds:', splitAt));
  assert.match(split, /pruneNarrationLinks\(state\.songs, state\.clips, clips, splitOrigMap\.keys\(\)\)/, 'Dividir');
  const routeAt = store.indexOf('routeClip: (clipId, targetTrackId, instrument) =>');
  const route = store.slice(routeAt, store.indexOf('setClipMarkers:', routeAt));
  assert.equal((route.match(/pruneNarrationLinks\(s\.songs, s\.clips, grouped\.clips\)/g) ?? []).length, 2, 'Enviar Para e arrastar para outra faixa');
  assert.match(store, /syncNarrationLinks: \(prevClips\) => set\(\(s\) => \{\s*const songs = pruneNarrationLinks\(s\.songs, prevClips, s\.clips\);/);
  // gerar a voz de novo troca o clipe sem apagar a fala
  const audio = store.slice(store.indexOf('setNarrationAudio: (songId, narrationId, clip, patch) =>'), store.indexOf('syncNarrationLinks: (prevClips)'));
  assert.doesNotMatch(audio, /pruneNarrationLinks/);
});

test('Delete: App e timeline não apagam duas vezes, e a timeline lê a seleção de agora', () => {
  const app = fs.readFileSync(path.join(here, '..', 'src', 'App.tsx'), 'utf8');
  assert.match(app, /e\.key === 'Delete' \|\| e\.key === 'Backspace'\) \{\s*\/\/[^\n]*\n\s*if \(e\.defaultPrevented\) return;/);
  const panel = read('components', 'TimelinePanel.tsx');
  assert.match(panel, /if \(e\.key === 'Delete' \|\| e\.key === 'Backspace'\) \{\s*if \(e\.defaultPrevented\) return;/);
  assert.match(panel, /const liveIds = useStore\.getState\(\)\.selectedClipIds;/);
});

test('o menu da fala tem as mesmas opções dos áudios, Unir inclusive', () => {
  const menu = read('components', 'ContextMenu.tsx');
  assert.match(menu, /export function ClipMenuItems\(/);
  assert.match(menu, /<ClipMenuItems key=\{menuKey\} clipId=\{state\.clipId\} onClose=\{closeMenu\} \/>/, 'o menu dos clipes usa as mesmas opções');
  for (const label of ['Enviar Para', 'Copiar', 'Colar no Cursor', 'Duplicar', 'Dividir no Cursor (Split)', 'Emendar Clipes (Unir)', 'Remover Clip']) {
    assert.ok(menu.includes(label), label);
  }
  const lane = read('components', 'NarrationLane.tsx');
  assert.match(lane, /<ClipMenuItems clipId=\{clip\.id\} onClose=\{onClose\} audioTools=\{false\} removeItem=\{false\} routingTools=\{false\} \/>/);
  // a IA de roteamento mandaria a voz do maestro para o canal das vozes (o PA)
  assert.match(menu, /\{routingTools && \(/);
});

test('Unir (menu, Editar e ⇧⌘G) solta a fala emendada no mesmo passo do desfazer', () => {
  // a poda fica no próprio setState do Unir: vale para qualquer caminho que chame glueSelectedClips
  const glue = read('lib', 'clipGlue.ts');
  assert.match(glue, /const songs = pruneNarrationLinks\(s\.songs, s\.clips, clips\);/);
  assert.doesNotMatch(glue, /beginGesture/);
});

test('tecla S sem seleção não corta a voz das falas', () => {
  const panel = read('components', 'TimelinePanel.tsx');
  assert.match(panel, /crossingClips\.filter\(\(c\) => !narrationClipIds\.has\(c\.id\)\)/);
});

test('barra de ritmo anda de ponta a ponta (limites do próprio texto e da marcação)', async () => {
  const dialog = read('components', 'NarrationDialog.tsx');
  assert.match(dialog, /min=\{pace\.min\}/);
  assert.match(dialog, /max=\{pace\.max\}/);
  const { wpmRange, wpmForSpan, spanForWpm, NARRATION_MIN_LENGTH } = await import('../src/lib/narrations.ts');
  // texto curto: antes a barra ia até 420 mas a marcação parava no mínimo bem antes
  const r = wpmRange('Refrão', 4);
  assert.equal(r.max, wpmForSpan('Refrão', NARRATION_MIN_LENGTH));
  assert.ok(r.max < 420);
  for (const w of [r.min, Math.round((r.min + r.max) / 2), r.max]) {
    assert.equal(wpmForSpan('Refrão', spanForWpm('Refrão', w)), w);
  }
});

test('áudio solto da faixa Maestro IA é um clipe normal desenhado na régua das falas', () => {
  const panel = read('components', 'TimelinePanel.tsx');
  assert.match(panel, /const loose = looseMaestroClips\(songClips, song\.narrations\);/);
  assert.match(panel, /clipLayer=\{/);
  const lane = read('components', 'NarrationLane.tsx');
  assert.match(lane, /\{clipLayer\}/);
  assert.match(lane, /closest\('\[data-selectable="clip"\]'\)\) return;/, 'clicar nele não cria marcação');
});
