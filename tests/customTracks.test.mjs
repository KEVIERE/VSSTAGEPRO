// Botão direito na trilha: Nova trilha (vazia, na pasta dela) e Excluir trilha.
// A reorganização automática das faixas não pode apagar nem bagunçar as trilhas criadas à mão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteTrack, customTrackIds, duplicateTrackName, instrumentTrackIn, mergeCustomChildren, newTrackPlace, uniqueTrackName } from '../src/lib/customTracks.ts';

const t = (id, extra = {}) => ({ id, name: id, isSubgroup: false, parentId: null, children: [], ...extra });
const tracks = [
  t('track-timecode'),
  t('track-guia', { name: 'Guia' }),
  t('track-maestro', { name: 'Maestro', children: ['track-maestro-ia'] }),
  t('track-maestro-ia', { name: 'Maestro IA', parentId: 'track-maestro' }),
  t('track-violoes', { name: 'Violões', isSubgroup: true, children: ['v1', 'v2'] }),
  t('v1', { name: 'Violão 1', parentId: 'track-violoes' }),
  t('v2', { name: 'Violão 2', parentId: 'track-violoes' }),
  t('track-outros', { name: 'Outros', isSubgroup: true, children: [] }),
];

test('nova trilha: na pasta clicada vai para o fim; numa trilha da pasta, logo abaixo dela', () => {
  assert.deepEqual(newTrackPlace(tracks, 'track-violoes'), { parentId: 'track-violoes', index: 2 });
  assert.deepEqual(newTrackPlace(tracks, 'v1'), { parentId: 'track-violoes', index: 1 });
  assert.deepEqual(newTrackPlace(tracks, 'v2'), { parentId: 'track-violoes', index: 2 });
});

test('nova trilha em cima de Guia ou Maestro vai para a pasta Outros; no Timecode não tem', () => {
  assert.deepEqual(newTrackPlace(tracks, 'track-guia'), { parentId: 'track-outros', index: 0 });
  assert.deepEqual(newTrackPlace(tracks, 'track-maestro-ia'), { parentId: 'track-outros', index: 0 });
  assert.equal(newTrackPlace(tracks, 'track-timecode'), null);
  assert.equal(newTrackPlace(tracks, 'nao-existe'), null);
});

test('nome repetido na mesma pasta ganha número; vazio vira "Nova trilha"', () => {
  assert.equal(uniqueTrackName(tracks, 'track-violoes', 'Violão 1'), 'Violão 1 2');
  assert.equal(uniqueTrackName(tracks, 'track-violoes', 'violão 3'), 'violão 3');
  assert.equal(uniqueTrackName(tracks, 'track-outros', '   '), 'Nova trilha');
  const com = [...tracks, t('n1', { name: 'Nova trilha', parentId: 'track-outros' })];
  assert.equal(uniqueTrackName(com, 'track-outros', 'Nova trilha'), 'Nova trilha 2');
});

test('excluir: só trilhas de dentro das pastas; pastas, fixas e Maestro IA ficam', () => {
  assert.equal(canDeleteTrack(tracks.find((x) => x.id === 'v1')), true);
  for (const id of ['track-violoes', 'track-guia', 'track-maestro', 'track-maestro-ia', 'track-timecode']) {
    assert.equal(canDeleteTrack(tracks.find((x) => x.id === id)), false, id);
  }
  assert.equal(canDeleteTrack(undefined), false);
});

test('trilha criada à mão só conta dentro de pasta que existe', () => {
  const list = [...tracks, t('c1', { custom: true, parentId: 'track-violoes' }), t('c2', { custom: true, parentId: 'sumiu' })];
  assert.deepEqual([...customTrackIds(list)], ['c1']);
});

test('reorganizar: a trilha criada fica logo depois da que vinha antes dela', () => {
  const custom = new Set(['c1', 'c2']);
  // antes: v1, c1, v2, c2. Depois da reorganização as automáticas são v1, v2, v3
  assert.deepEqual(mergeCustomChildren(['v1', 'c1', 'v2', 'c2'], ['v1', 'v2', 'v3'], custom), ['v1', 'c1', 'v2', 'c2', 'v3']);
  // criada como primeira da pasta continua primeira
  assert.deepEqual(mergeCustomChildren(['c1', 'v1'], ['v1', 'v2'], custom), ['c1', 'v1', 'v2']);
  // a automática de antes sumiu: a criada segue a anterior que ainda existe
  assert.deepEqual(mergeCustomChildren(['v1', 'v2', 'c1'], ['v1'], custom), ['v1', 'c1']);
  // pasta só com trilhas criadas
  assert.deepEqual(mergeCustomChildren(['c1', 'c2'], [], custom), ['c1', 'c2']);
});

// Pasta nunca recebe áudio: vai para a trilha do instrumento, na sequência, sem ficar por cima.
const clipDe = (id, trackId, fileName, songId = 's1') => ({ id, trackId, fileName, name: fileName.replace('.wav', ''), songId });

test('clipe mandado para a pasta vai para a trilha do instrumento que está livre nesta música', () => {
  const clips = [clipDe('a', 'v1', 'Violao.wav')];
  const novo = clipDe('n', 'track-violoes', 'Violao base.wav');
  // Violão 1 já tem áudio nesta música; Violão 2 está livre
  assert.deepEqual(instrumentTrackIn(tracks, clips, 'track-violoes', novo), { trackId: 'v2' });
});

test('todas ocupadas: cria a próxima da sequência, nunca põe por cima', () => {
  const clips = [clipDe('a', 'v1', 'Violao.wav'), clipDe('b', 'v2', 'Violao 2.wav')];
  const novo = clipDe('n', 'track-violoes', 'Violao base.wav');
  assert.deepEqual(instrumentTrackIn(tracks, clips, 'track-violoes', novo), { create: { name: 'Violão 3' } });
  // em outra música as trilhas estão livres
  assert.deepEqual(instrumentTrackIn(tracks, clips, 'track-violoes', { ...novo, songId: 's2' }), { trackId: 'v1' });
});

test('o nome do instrumento vem da IA, do nome do arquivo ou da pasta', () => {
  const vazio = [];
  // arquivo sem instrumento conhecido: usa o da pasta
  assert.deepEqual(instrumentTrackIn(tracks, [clipDe('a', 'v1', 'x.wav'), clipDe('b', 'v2', 'y.wav')], 'track-violoes', clipDe('n', 'track-violoes', 'audio 17.wav')), { create: { name: 'Violão 3' } });
  // a IA ouviu outro instrumento da pasta
  assert.deepEqual(instrumentTrackIn(tracks, vazio, 'track-outros', clipDe('n', 'track-outros', 'gravacao.wav'), 'Saxofone'), { create: { name: 'Saxofone 1' } });
  // pasta Outros sem pista nenhuma: Extra
  assert.deepEqual(instrumentTrackIn(tracks, vazio, 'track-outros', clipDe('n', 'track-outros', 'zzz.wav')), { create: { name: 'Extra 1' } });
  // não é pasta: nada a fazer
  assert.equal(instrumentTrackIn(tracks, vazio, 'v1', clipDe('n', 'v1', 'x.wav')), null);
});

test('o clipe que já está na trilha não ocupa ela para ele mesmo', () => {
  const clips = [clipDe('a', 'v1', 'Violao.wav')];
  assert.deepEqual(instrumentTrackIn(tracks, clips, 'track-violoes', clips[0]), { trackId: 'v1' });
});

test('duplicar: a cópia ganha o próximo número da sequência do instrumento', () => {
  assert.equal(duplicateTrackName(tracks, 'track-violoes', 'Violão 1'), 'Violão 3');
  assert.equal(duplicateTrackName(tracks, 'track-violoes', 'Violão 2'), 'Violão 3');
  assert.equal(duplicateTrackName(tracks, 'track-outros', 'Bumbo'), 'Bumbo 2');
});
