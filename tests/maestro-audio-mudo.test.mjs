// Fala do Maestro IA (e outros áudios) muda até trocar de música, e o ▶ das vozes sem som.
// - clipe que entra na música no ar (fala gerada ou gerada de novo com o Play rodando, áudio
//   consolidado, gravação, colagem) ganha reprodutor na hora, sem precisar de outro Play;
// - reprodutor que parou com erro na thread de áudio nunca é guardado nem reaproveitado;
// - trocar BPM/tom não faz um preparo de clipes velhos valer de novo;
// - o exemplo das vozes toca na placa da música, espera o contexto voltar e não gera duas vezes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canRestampSignature, clipPartOfSignature, clipsToAttachLive } from '../src/lib/liveAttach.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', 'src', ...p), 'utf8');

const IA = 'track-maestro-ia';
const clip = (id, startTime, playLength = 2, trackId = IA, songId = 's1') => ({ id, songId, trackId, startTime, playLength });

test('fala gerada de novo com o Play rodando: o clipe novo entra na hora', () => {
  // tocando: bateria e a fala antiga (X); a fala foi gerada de novo e virou o clipe Y
  const active = new Set(['bateria']);
  const clips = [clip('bateria', 0, 200, 'track-bateria'), clip('Y', 30)];
  const out = clipsToAttachLive(clips, 's1', active, new Set(['track-bateria', IA]), () => true, 12);
  assert.deepEqual(out.map((c) => c.id), ['Y']);
});

test('clipe que já tocou inteiro, sem áudio aberto, de outra música ou de faixa apagada fica de fora', () => {
  const clips = [
    clip('passou', 1, 2),
    clip('sem-audio', 40),
    clip('outra', 40, 2, IA, 's2'),
    clip('sem-faixa', 40, 2, 'track-apagada'),
    clip('no-meio', 10, 5),
  ];
  const out = clipsToAttachLive(clips, 's1', new Set(), new Set([IA]), (id) => id !== 'sem-audio', 12);
  assert.deepEqual(out.map((c) => c.id), ['no-meio']);
});

test('clipe que já tem reprodutor não ganha outro', () => {
  const out = clipsToAttachLive([clip('a', 0, 100)], 's1', new Set(['a']), new Set([IA]), () => true, 5);
  assert.deepEqual(out, []);
});

test('a assinatura só é renovada com os mesmos clipes', () => {
  const clipes = 'c1|t|0.0000|3.0000|100|48000|2|1|0|0|0.000|0.000|linear|linear';
  assert.equal(clipPartOfSignature(`0|0|${clipes}`), clipes);
  assert.equal(clipPartOfSignature(`disk|2|-1|${clipes}`), clipes);
  assert.ok(canRestampSignature(`0|0|${clipes}`, `4|1|${clipes}`));
  assert.ok(canRestampSignature(`disk|0|0|${clipes}`, `disk|4|1|${clipes}`));
  // fala trocada (outro id) ou clipe movido: o preparo velho não vale
  assert.ok(!canRestampSignature(`0|0|${clipes}`, `4|1|${clipes.replace('c1', 'c2')}`));
  assert.ok(!canRestampSignature(`0|0|${clipes}`, `4|1|${clipes.replace('0.0000|3', '5.0000|3')}`));
  assert.ok(!canRestampSignature(`0|0|${clipes}`, null));
});

test('o motor liga a entrada ao vivo, o aviso de reprodutor com erro e o retorno do contexto suspenso', () => {
  const src = read('lib', 'audioEngine.ts');
  // mudança nos clipes com a música no ar chama a entrada ao vivo
  assert.match(src, /if \(s\.clips !== prev\.clips && this\.isPlaying && this\.currentSongId\) \{[\s\S]{0,200}this\.scheduleLiveAttach\(\);/);
  assert.match(src, /node\.onprocessorerror = \(\) => this\.handleDeadPlayer\(node\);/);
  assert.match(src, /bundle\.signature === expectedSig && !this\.hasDeadNode\(bundle\)/);
  assert.match(src, /if \(ready && !this\.hasDeadNode\(ready\) && ready\.signature ===/);
  assert.match(src, /canRestampSignature\(prep\.signature, restamped\)/);
  assert.match(src, /born\.state === 'suspended' && this\.isPlaying\) void born\.resume\(\)/);
});

test('exemplo das vozes: placa da música, espera o contexto e não gera duas vezes', () => {
  const src = read('lib', 'maestroVoice.ts');
  assert.match(src, /audioEngine\.getOutputSinkId\(\)/);
  assert.match(src, /if \(ctx\.state === 'running'\) begin\(\);\s*else void ctx\.resume\(\)\.then\(begin/);
  assert.match(src, /const running = demoInflight\.get\(key\);\s*if \(running\) return running;/);
  assert.match(src, /isCloneVoice\(voice\) \? CLONE_DEMO_TEXT : DEMO_TEXT/);
  // a voz pronta (Maestro) monta o exemplo das falas gravadas, sem chamar o motor
  const demo = src.slice(src.indexOf('async function makeVoiceDemo'), src.indexOf('// Pré-escuta'));
  assert.match(demo, /if \(ready\) \{[\s\S]*?voiceSampleTexts\(ready\)/);
  assert.doesNotMatch(demo, /maestroSpeak/);
});
