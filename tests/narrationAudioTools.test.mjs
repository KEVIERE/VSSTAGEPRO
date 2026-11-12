// Ferramentas de áudio nas falas do Maestro IA: masterizar com IA, normalizar, volume e mudo,
// e a fala lembra a masterização e os ajustes quando a voz é gerada de novo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', ...p), 'utf8');
const lane = read('src', 'components', 'NarrationLane.tsx');
const voice = read('src', 'lib', 'maestroVoice.ts');
const store = read('src', 'store.ts');
const types = read('src', 'types.ts');

test('o menu da fala tem as ferramentas de áudio', () => {
  assert.match(lane, /Áudio da fala/);
  assert.match(lane, /masterAudioClip\(clip\.id, choice\)/, 'masteriza o áudio da fala');
  assert.match(lane, /normalizeClip\(clip\.id/, 'normaliza');
  assert.match(lane, /setClipGain\(clip\.id/, 'muda o volume');
  assert.match(lane, /toggleClipMute\(clip\.id\)/, 'silencia');
});

test('a fala guarda a masterização escolhida', () => {
  assert.match(types, /master\?: 'manter' \| 'equilibrado' \| 'show' \| 'streaming';/);
  assert.match(lane, /updateNarration\(song\.id, narration\.id, \{ master: choice \}\)/);
});

test('voz gerada de novo é masterizada igual e mantém volume, mudo e fades', () => {
  assert.match(voice, /const master = findNarration\(songId, narrationId\)\?\.master;\s*if \(master\) void masterAudioClip\(clipId, master\);/);
  const start = store.indexOf('setNarrationAudio: (songId, narrationId, clip, patch) =>');
  const body = store.slice(start, store.indexOf('}),', start));
  assert.match(body, /gain: old\.gain, mute: old\.mute, fadeIn: old\.fadeIn, fadeOut: old\.fadeOut/);
});
