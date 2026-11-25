// IA que ouve o áudio (YAMNet) e escolhe a faixa: importação de VS com nome que não diz o
// instrumento e o clique direito > "Reclassificar com IA". As notas abaixo foram medidas com
// stems de verdade (publicouca-bateria/) no modelo do Google.
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { YAMNET_CLASS_NAMES, routeByYamnetScores } from '../src/lib/yamnetCategories.ts';
import { routeByName } from '../src/lib/nameRouter.ts';

// "Nome 12%, Outro, com vírgula 3%": alguns nomes do modelo têm vírgula
const parse = (txt) => [...txt.matchAll(/(.+?) (\d+)%(?:, |$)/g)].map((m) => ({ className: m[1], probability: Number(m[2]) / 100 }));
const route = (txt) => routeByYamnetScores(parse(txt));
const where = (txt) => { const r = route(txt); return r ? `${r.target}/${r.childName}` : null; };

test('a tabela tem os 521 sons do modelo, nos índices oficiais', () => {
  assert.equal(YAMNET_CLASS_NAMES.length, 521);
  assert.equal(YAMNET_CLASS_NAMES[0], 'Speech');
  assert.equal(YAMNET_CLASS_NAMES[24], 'Singing');
  assert.equal(YAMNET_CLASS_NAMES[132], 'Music');
  assert.equal(YAMNET_CLASS_NAMES[137], 'Bass guitar');
  assert.equal(YAMNET_CLASS_NAMES[494], 'Silence');
});

test('instrumentos medidos em stems', () => {
  assert.equal(where('Music 89%, Bass guitar 56%, Guitar 32%, Plucked string instrument 31%, Musical instrument 26%'), 'track-contrabaixo/Contrabaixo');
  assert.equal(where('Music 63%, Percussion 43%, Drum 34%, Musical instrument 33%, Drum kit 28%'), 'track-bateria/Bateria');
  assert.equal(where('Music 98%, Accordion 47%, Musical instrument 17%, Harmonica 4%, Bowed string instrument 3%'), 'track-sanfonas/Sanfona');
  // bumbo sozinho: a IA ouve como beatbox ou drum machine
  assert.equal(where('Music 33%, Beatboxing 16%, Drum machine 10%, Heart sounds, heartbeat 7%, Musical instrument 6%'), 'track-bateria/Bateria');
});

test('voz cantada vai para a Guia, mesmo quando a IA ouve "fala"', () => {
  assert.equal(where('Music 37%, Singing 7%, Vocal music 5%, Speech 4%, A capella 4%'), 'track-guia/Guia');
  assert.equal(where('Speech 48%, Music 8%, Narration, monologue 3%, Singing 3%, Guitar 1%'), 'track-guia/Guia');
  assert.equal(where('Speech 29%, Music 14%, Vocal music 7%, A capella 6%, Singing 5%'), 'track-guia/Guia');
});

test('fala pura vai para o Maestro', () => {
  assert.equal(where('Speech 96%, Narration, monologue 3%, Conversation 2%'), 'track-maestro/Maestro');
});

test('plateia, trecho mudo e chute fraco não decidem nada', () => {
  assert.equal(route('Speech 16%, Crowd 10%, Cheering 7%, Whoop 5%, Shout 4%'), null);
  assert.equal(route('Silence 70%, Music 12%, Speech 8%, Accordion 5%, Harmonica 2%'), null);
  assert.equal(route('Music 90%, Piano 3%, Musical instrument 2%'), null);
  // som sem faixa bem mais forte que o instrumento: melhor não arriscar
  assert.equal(route('Knock 35%, Door 21%, Silence 11%, Drum 6%'), null);
});

test('gêneros e climas de música não decidem a faixa', () => {
  assert.equal(route('Music 96%, Afrobeat 3%, Music of Africa 3%, Funk 3%, House music 2%'), null);
});

test('click do programa e bipe vão para o Click, mesmo com muito silêncio entre os toques', () => {
  assert.equal(where('Plop 67%, Wood block 20%, Tick 12%, Clock 3%, Musical instrument 3%'), 'track-click/Click');
  assert.equal(where('Wood block 29%, Plop 11%, Music 8%, Musical instrument 8%, Percussion 8%'), 'track-click/Click');
  assert.equal(where('Silence 45%, Tick 23%, Sound effect 14%, Ping 12%, Clock 11%'), 'track-click/Click');
  assert.equal(where('Silence 55%, Tick 20%, Sound effect 10%'), 'track-click/Click');
  assert.equal(where('Beep, bleep 37%, Sound effect 25%, Silence 21%, Sidetone 13%, Noise 11%'), 'track-click/Click');
});

test('nomes abreviados dos VS', () => {
  const at = (n) => { const r = routeByName(n); return r ? `${r.target}/${r.instrumentName}` : null; };
  assert.equal(at('ACC.wav'), 'track-sanfonas/Sanfona');
  assert.equal(at('ACC 2.wav'), 'track-sanfonas/Sanfona');
  assert.equal(at('ACC_SOLO.wav'), 'track-solos/Sanfona Solo');
  assert.equal(at('ACC SL.wav'), 'track-solos/Sanfona Solo');
  assert.equal(at('CLIK.wav'), 'track-click/Click');
  assert.equal(at('PERC.wav'), 'track-percussoes/Percussão');
  assert.equal(at('PNO.wav'), 'track-teclados/Piano');
  assert.equal(at('TRUMPETS.wav'), 'track-outros/Trompete');
  assert.equal(at('VLO.wav'), 'track-violoes/Violão');
  assert.equal(at('GTR SL.wav'), 'track-solos/Guitarra Solo');
  // palavras que só começam igual não viram instrumento
  assert.equal(at('Accent.wav'), null);
  assert.equal(at('slide.wav'), null);
});

test('importação ouve os áudios sem nome antes de criar as faixas', () => {
  const src = readFileSync(new URL('../src/lib/importManager.ts', import.meta.url), 'utf8');
  assert.match(src, /classifyClipAudio\(entry\.audio/);
  assert.match(src, /routingMethod = 'ai'/);
  const ai = readFileSync(new URL('../src/lib/aiRouter.ts', import.meta.url), 'utf8');
  assert.match(ai, /ensureSongLoaded\(clip\.songId\)/, 'reclassificar carrega o áudio da música');
  assert.match(ai, /setSuggestion\(/, 'reclassificar sugere numa janelinha antes de mover');
});

test('avisos do canto (Separar stems, metrônomo) ficam numa pilha, sem um cobrir o outro', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /fixed bottom-4 right-4 z-\[120\] flex flex-col-reverse[\s\S]{0,80}<StemSplitStatus \/>\s*<ClickStatus \/>/);
  for (const f of ['StemSplitStatus', 'ClickStatus']) {
    const src = readFileSync(new URL(`../src/components/${f}.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /fixed bottom-4 right-4/, `${f} não se posiciona sozinho`);
  }
});
