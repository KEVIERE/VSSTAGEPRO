// Projeto do REAPER: o show (uma música atrás da outra) vira uma música por região ou marcador.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseRpp, splitShow, resolveMediaPath, rppTokens } = await import('../src/lib/reaperProject.ts');

const item = (pos, len, file, extra = '') => `    <ITEM
      POSITION ${pos}
      LENGTH ${len}
      FADEIN 1 0 0 1 0 0 0
      FADEOUT 1 0 0 1 0 0 0
      MUTE 0 0
      NAME "${file.split('/').pop()}"
      VOLPAN 1 0 1 -1
      SOFFS 0
      PLAYRATE 1 1 0 -1 0 0.0025
${extra}      <SOURCE WAVE
        FILE "${file}"
      >
    >`;

const track = (name, body, { bus = '0 0', vol = 1, mute = 0 } = {}) => `  <TRACK {X}
    NAME "${name}"
    VOLPAN ${vol} 0 -1 -1 1
    MUTESOLO ${mute} 0 0
    ISBUS ${bus}
${body}
  >`;

const project = (head, tracks) => `<REAPER_PROJECT 0.1 "7.47/macOS-arm64" 1
  TEMPO 120 4 4 0
${head}
${tracks.join('\n')}
>`;

const SHOW = project(`  <TEMPOENVEX
    PT 0 120 1 262148 0 1
    PT 100 90 1
    PT 130 140 1
  >
  MARKER 1 0 "SALA DE REBOCO" 1 0 1 B {A} 0
  MARKER 1 112.5 "" 1
  MARKER 2 118.5 "PORQUE DEMOROU" 1 0 1 B {B} 0
  MARKER 2 314.5 "" 1
  MARKER 3 150 "Refrão" 0 0 1 B {C} 0`, [
  track('CLICK', [item(0, 112.5, 'Media/Click.wav'), item(118.5, 196, 'Media/Click-001.wav')].join('\n')),
  track('[ BATERIA ]', '', { bus: '1 1', vol: 0.5 }),
  track('BUMBO', item(0, 314.5, 'Media/Bumbo.wav')),
  track('CAIXA', item(118.5, 196, 'Media/Caixa.wav'), { bus: '2 -1' }),
  track('BAIXO', item(118.5, 196, 'Media/Baixo.wav'), { mute: 1 }),
]);

test('lê aspas, números e nomes com espaço', () => {
  assert.deepEqual(rppTokens('MARKER 1 0 "SALA DE REBOCO" 1'), ['MARKER', '1', '0', 'SALA DE REBOCO', '1']);
});

test('cada região vira uma música, na ordem da linha do tempo', () => {
  const s = splitShow(parseRpp(SHOW));
  assert.equal(s.mode, 'regioes');
  assert.deepEqual(s.songs.map((x) => x.name), ['SALA DE REBOCO', 'PORQUE DEMOROU']);
  assert.equal(s.songs[1].start, 118.5);
});

test('cada música começa no 0:00 dela', () => {
  const [, second] = splitShow(parseRpp(SHOW)).songs;
  const click = second.items.find((i) => i.item.file === 'Media/Click-001.wav');
  assert.equal(click.startTime, 0);
  assert.equal(click.trimStart, 0);
});

test('áudio que atravessa duas músicas é cortado no ponto certo de cada uma', () => {
  const [first, second] = splitShow(parseRpp(SHOW)).songs;
  const a = first.items.find((i) => i.item.file === 'Media/Bumbo.wav');
  const b = second.items.find((i) => i.item.file === 'Media/Bumbo.wav');
  assert.equal(a.startTime, 0);
  assert.equal(a.playLength, 112.5);
  assert.equal(b.startTime, 0);
  assert.equal(b.trimStart, 118.5);
  assert.ok(Math.abs(b.playLength - 196) < 1e-9);
});

test('volume e mudo das pastas do REAPER valem nas faixas de dentro', () => {
  const [, second] = splitShow(parseRpp(SHOW)).songs;
  const caixa = second.items.find((i) => i.item.file === 'Media/Caixa.wav');
  assert.deepEqual(caixa.track.folders, ['[ BATERIA ]']);
  assert.equal(caixa.gain, 0.5);
  const baixo = second.items.find((i) => i.item.file === 'Media/Baixo.wav');
  assert.deepEqual(baixo.track.folders, [], 'a pasta fechou na CAIXA');
  assert.equal(baixo.mute, true);
});

test('mudança de andamento no meio da música vem junto, contada do início dela', () => {
  const [first, second] = splitShow(parseRpp(SHOW)).songs;
  assert.deepEqual(first.tempo, [{ startTime: 0, bpm: 120 }, { startTime: 100, bpm: 90 }]);
  assert.deepEqual(second.tempo, [{ startTime: 0, bpm: 90 }, { startTime: 11.5, bpm: 140 }]);
  assert.equal(first.beatsPerBar, 4);
});

test('marcador dentro da região vira seção da música', () => {
  const [, second] = splitShow(parseRpp(SHOW)).songs;
  assert.deepEqual(second.sections, [{ name: 'Refrão', start: 31.5, end: 196 }]);
});

test('sem regiões: cada marcador abre uma música e "FIM" fecha', () => {
  const p = project(`  MARKER 1 2 "Música A" 0
  MARKER 2 60 "FIM" 0
  MARKER 3 65 "Música B" 0`, [track('CLICK', item(0, 120, 'Media/Click.wav'))]);
  const s = splitShow(parseRpp(p));
  assert.equal(s.mode, 'marcadores');
  assert.deepEqual(s.songs.map((x) => [x.name, x.start, x.end]), [['Música A', 2, 60], ['Música B', 65, 120]]);
  assert.equal(s.songs[0].items[0].trimStart, 2);
  assert.equal(s.songs[1].items[0].trimStart, 65);
});

test('sem marcação nenhuma: o projeto inteiro vira uma música', () => {
  const p = project('', [track('CLICK', item(0, 30, 'Media/Click.wav'))]);
  const s = splitShow(parseRpp(p), 'Meu Show');
  assert.equal(s.mode, 'inteiro');
  assert.deepEqual(s.songs.map((x) => x.name), ['Meu Show']);
});

test('MIDI e item com velocidade alterada ficam de fora e são contados', () => {
  const midi = `    <ITEM
      POSITION 0
      LENGTH 10
      <SOURCE MIDI
        HASDATA 1 960 QN
      >
    >`;
  const p = project('', [track('SYNTH', midi), track('GUITARRA', item(0, 10, 'Media/Gt.wav').replace('PLAYRATE 1 1', 'PLAYRATE 1.5 1'))]);
  const s = splitShow(parseRpp(p));
  assert.deepEqual(s.skipped.map((x) => x.reason).sort(), ['midi', 'velocidade']);
  assert.equal(s.songs.length, 0);
});

test('tomada escolhida (TAKE SEL) é a que toca', () => {
  const body = `    <ITEM
      POSITION 0
      LENGTH 10
      NAME "Take 1"
      SOFFS 0
      <SOURCE WAVE
        FILE "Media/take1.wav"
      >
      TAKE SEL
      NAME "Take 2"
      SOFFS 3
      <SOURCE WAVE
        FILE "Media/take2.wav"
      >
    >`;
  const s = splitShow(parseRpp(project('', [track('VIOLAO', body)])));
  assert.equal(s.songs[0].items[0].item.file, 'Media/take2.wav');
  assert.equal(s.songs[0].items[0].trimStart, 3);
});

test('acha o áudio pelo caminho relativo, e pelo nome quando o projeto mudou de lugar', () => {
  const files = [
    { path: 'SHOW/PROJETO/Media/Click.wav', file: 'a' },
    { path: 'SHOW/OUTRO/Media/Click.wav', file: 'b' },
    { path: 'SHOW/PROJETO/Media/Violão 1.wav', file: 'c' },
  ];
  assert.equal(resolveMediaPath('Media/Click.wav', 'SHOW/PROJETO', files), 'a');
  assert.equal(resolveMediaPath('Media\\Violão 1.wav', 'SHOW/PROJETO', files), 'c');
  assert.equal(resolveMediaPath('/Users/outra/Desktop/PROJETO/Media/Click.wav', 'SHOW/PROJETO', files), 'a');
  assert.equal(resolveMediaPath('Media/Nao existe.wav', 'SHOW/PROJETO', files), null);
});
