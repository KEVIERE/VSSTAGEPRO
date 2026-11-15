// Salvar o show como projeto .RPP: músicas em sequência com 3 s entre elas, região por música,
// andamento por música e faixas com volume, balanço, mudo e pastas. O arquivo gerado precisa
// abrir de volta pelo nosso próprio leitor com as mesmas músicas.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildRpp, layoutSongs, songTempoPoints, rppNum, rppQuote, rppTimeSig, RPP_SONG_GAP_S } = await import('../src/lib/reaperExport.ts');
const { parseRpp, splitShow, rppTokens } = await import('../src/lib/reaperProject.ts');

test('músicas uma atrás da outra com 3 segundos entre elas', () => {
  assert.equal(RPP_SONG_GAP_S, 3);
  assert.deepEqual(layoutSongs([100, 200.5, 50]), [0, 103, 306.5]);
});

test('números sem notação científica', () => {
  assert.equal(rppNum(0.0000001), '0.0000001');
  assert.equal(rppNum(120), '120');
  assert.equal(rppNum(-0), '0');
  assert.equal(rppNum(NaN), '0');
});

test('aspas: escolhe a que não aparece no texto', () => {
  assert.deepEqual(rppTokens(`NAME ${rppQuote('Deus "Fiel"')}`), ['NAME', 'Deus "Fiel"']);
  assert.deepEqual(rppTokens(`NAME ${rppQuote(`It's "x"`)}`), ['NAME', `It's "x"`]);
  assert.deepEqual(rppTokens(`NAME ${rppQuote('a\nb')}`), ['NAME', 'a b']);
});

test('fórmula de compasso no formato do .rpp', () => {
  assert.equal(rppTimeSig(4), 262148);
  assert.equal(rppTimeSig(3), 262147);
  assert.equal(rppTimeSig(6), 524294);
});

test('andamento: BPM ajustado entra no valor e o compasso abre no começo da música', () => {
  const pts = songTempoPoints({ bpm: 120, beatsPerBar: 3 }, [{ srcStart: 0, srcEnd: 100, alpha: 120 / 132, outStart: 50 }]);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].time, 50);
  assert.ok(Math.abs(pts[0].bpm - 132) < 1e-9);
  assert.equal(pts[0].beatsPerBar, 3);
});

test('andamento: mudanças de BPM da régua viram marcas novas na posição certa', () => {
  const song = { bpm: 100, beatsPerBar: 4, tempoSegments: [{ startTime: 0, bpm: 100 }, { startTime: 30, bpm: 140 }] };
  const pts = songTempoPoints(song, [{ srcStart: 0, srcEnd: 60, alpha: 1, outStart: 10 }]);
  assert.deepEqual(pts, [{ time: 10, bpm: 100, beatsPerBar: 4 }, { time: 40, bpm: 140 }]);
});

test('andamento: medley com fatias pula o trecho desmarcado e segue a ordem', () => {
  const song = { bpm: 90, beatsPerBar: 4 };
  const pts = songTempoPoints(song, [
    { srcStart: 0, srcEnd: 20, alpha: 1, outStart: 0 },
    { srcStart: 40, srcEnd: 60, alpha: 0.5, outStart: 20 },
  ]);
  assert.deepEqual(pts, [{ time: 0, bpm: 90, beatsPerBar: 4 }, { time: 20, bpm: 180 }]);
});

function sampleProject() {
  const starts = layoutSongs([120, 90]);
  return {
    sampleRate: 48000,
    timestamp: 1700000000,
    tempo: [
      { time: starts[0], bpm: 120, beatsPerBar: 4 },
      { time: starts[1], bpm: 75, beatsPerBar: 3 },
    ],
    regions: [
      { name: 'Abertura', start: starts[0], end: starts[0] + 120 },
      { name: 'Deus "Fiel"', start: starts[1], end: starts[1] + 90 },
    ],
    tracks: [
      { name: 'Click', volume: 1, pan: -1, mute: false, items: [
        { name: 'Abertura - Click', position: starts[0], length: 120, file: 'Audio/Abertura/Click.wav' },
        { name: 'Fiel - Click', position: starts[1], length: 90, file: 'Audio/Deus _Fiel_/Click.wav' },
      ] },
      { name: 'Maestro', volume: 0.5, pan: -1, mute: false, items: [
        { name: 'Abertura - Maestro', position: starts[0], length: 120, file: 'Audio/Abertura/Maestro.wav' },
      ] },
      { name: 'Bateria', volume: 1, pan: 0, mute: false, items: [], children: [
        { name: 'Kick', volume: 0.8, pan: 0, mute: false, items: [
          { name: 'Abertura - Kick', position: starts[0], length: 120, file: 'Audio/Abertura/Kick.wav' },
        ] },
        { name: 'Caixa', volume: 1, pan: 0.2, mute: true, items: [
          { name: 'Abertura - Caixa', position: starts[0], length: 120, file: 'Audio/Abertura/Caixa.wav' },
        ] },
      ] },
      { name: 'Teclado', volume: 1, pan: 0.3, mute: false, items: [
        { name: 'Fiel - Teclado', position: starts[1], length: 90, file: 'Audio/Deus _Fiel_/Teclado.wav' },
      ] },
    ],
  };
}

test('o .rpp gerado abre de volta no nosso leitor com as mesmas músicas', () => {
  const text = buildRpp(sampleProject());
  assert.ok(text.startsWith('<REAPER_PROJECT 0.1 "6.0" 1700000000\n'));
  const parsed = parseRpp(text);
  assert.equal(parsed.bpm, 120);
  assert.deepEqual(parsed.tempo, [{ time: 0, bpm: 120, beatsPerBar: 4 }, { time: 123, bpm: 75, beatsPerBar: 3 }]);
  assert.deepEqual(parsed.regions.map((r) => [r.name, r.start, r.end]), [['Abertura', 0, 120], ['Deus "Fiel"', 123, 213]]);

  const split = splitShow(parsed);
  assert.equal(split.mode, 'regioes');
  assert.deepEqual(split.songs.map((s) => s.name), ['Abertura', 'Deus "Fiel"']);
  assert.equal(split.songs[1].beatsPerBar, 3);
  assert.equal(split.songs[1].tempo[0].bpm, 75);
  const abertura = split.songs[0].items.map((i) => `${i.track.name}:${i.startTime}:${i.playLength}`).sort();
  assert.deepEqual(abertura, ['Caixa:0:120', 'Click:0:120', 'Kick:0:120', 'Maestro:0:120']);
  const fiel = split.songs[1].items.map((i) => `${i.track.name}:${i.startTime}`).sort();
  assert.deepEqual(fiel, ['Click:0', 'Teclado:0']);
});

test('faixas: volume, balanço, mudo e pastas', () => {
  const parsed = parseRpp(buildRpp(sampleProject()));
  const byName = new Map(parsed.tracks.map((t) => [t.name, t]));
  assert.deepEqual(parsed.tracks.map((t) => t.name), ['Click', 'Maestro', 'Bateria', 'Kick', 'Caixa', 'Teclado']);
  assert.equal(byName.get('Maestro').volume, 0.5);
  assert.equal(byName.get('Caixa').mute, true);
  assert.deepEqual(byName.get('Kick').folders, ['Bateria']);
  assert.deepEqual(byName.get('Caixa').folders, ['Bateria']);
  // a pasta fecha depois da Caixa: o Teclado fica fora dela
  assert.deepEqual(byName.get('Teclado').folders, []);
  const text = buildRpp(sampleProject());
  assert.match(text, /NAME "Click"\n {4}VOLPAN 1 -1 -1 -1 1/);
  assert.match(text, /NAME "Bateria"[\s\S]*?ISBUS 1 1/);
  assert.match(text, /NAME "Caixa"[\s\S]*?ISBUS 2 -1/);
});

test('pastas dentro de pastas fecham todas na última faixa', () => {
  const leaf = (name) => ({ name, volume: 1, pan: 0, mute: false, items: [] });
  const text = buildRpp({
    sampleRate: 48000, tempo: [], regions: [],
    tracks: [{ ...leaf('A'), children: [leaf('A1'), { ...leaf('B'), children: [leaf('B1')] }] }, leaf('C')],
  });
  const parsed = parseRpp(text);
  assert.deepEqual(parsed.tracks.map((t) => [t.name, t.folders.join('>')]), [['A', ''], ['A1', 'A'], ['B', 'A'], ['B1', 'A>B'], ['C', '']]);
  assert.match(text, /NAME "B1"[\s\S]*?ISBUS 2 -2/);
});

test('o caminho do áudio fica relativo à pasta do projeto', () => {
  const text = buildRpp(sampleProject());
  assert.match(text, /FILE "Audio\/Abertura\/Click\.wav"/);
  assert.doesNotMatch(text, /FILE "\//);
});

test('volume do item (volume igual entre músicas) e fader master', () => {
  const text = buildRpp({
    sampleRate: 48000, tempo: [], regions: [], masterVolume: 0.5,
    tracks: [{ name: 'Voz', volume: 1, pan: 0, mute: false, items: [{ name: 'a', position: 0, length: 1, file: 'Audio/a.wav', volume: 0.7 }] }],
  });
  assert.match(text, /MASTER_VOLUME 0\.5 0 -1 -1 1/);
  assert.match(text, /NAME "a"\n {6}VOLPAN 0\.7 0 1 -1/);
  const parsed = parseRpp(text);
  assert.equal(parsed.tracks[0].items[0].volume, 0.7);
});
