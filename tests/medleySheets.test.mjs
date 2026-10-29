// Caderno por parte de medley na página do músico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPart, liveSheetKey, partKey, resolveKey, splitKey } from '../src/lib/medleySheets.ts';

const medley = {
  id: 'song-1', name: 'Medley Louvor', duration: 300, blockId: null,
  parts: [
    { id: 'a', name: 'Grande é o Senhor', start: 0, end: 100 },
    { id: 'b', name: 'Aclame ao Senhor', start: 100, end: 200 },
    { id: 'c', name: 'Te Louvarei', start: 200, end: 300 },
  ],
};
const single = { id: 'song-2', name: 'Solo', duration: 200, blockId: null };
const live = (extra = {}) => ({ currentSongId: 'song-1', ...extra });

test('chave da parte vai e volta', () => {
  assert.equal(partKey('song-1', 'b'), 'song-1~b');
  assert.deepEqual(splitKey('song-1~b'), { songId: 'song-1', partId: 'b' });
  assert.deepEqual(splitKey('song-2'), { songId: 'song-2', partId: null });
  const map = new Map([[medley.id, medley], [single.id, single]]);
  assert.equal(resolveKey(map, 'song-1~c').part.name, 'Te Louvarei');
  assert.equal(resolveKey(map, 'song-2').part, null);
});

test('parte tocando: pelo id do diretor ou pela posição', () => {
  assert.equal(currentPart(medley, live({ sliceId: 'c' }), 10).id, 'c');
  assert.equal(currentPart(medley, live(), 150).id, 'b');
  assert.equal(currentPart(medley, live(), 0).id, 'a');
  assert.equal(currentPart(single, live(), 50), null);
});

test('caderno no ar: o da parte, ou o da música inteira se só ele existir', () => {
  assert.equal(liveSheetKey(medley, live(), 150, []), 'song-1~b');
  assert.equal(liveSheetKey(medley, live(), 150, [{ song_id: 'song-1' }]), 'song-1');
  assert.equal(liveSheetKey(medley, live(), 150, [{ song_id: 'song-1' }, { song_id: 'song-1~b' }]), 'song-1~b');
  assert.equal(liveSheetKey(single, live(), 50, []), 'song-2');
});
