// Arquivo MIDI que vem junto do VS: leitor próprio (cabeçalho, VLQ, running status, metas, sysex,
// RIFF, lixo antes do MThd, faixa cortada) e o que ele vira na música (mapa de andamento, compasso,
// regiões, tom, SMPTE offset). Os arquivos são montados aqui, byte a byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { parseMidiFile, decodeMidiText, looksLikeMidi, MidiParseError } = await import('../src/lib/midiFile.ts');
const { planMidiSong, planMidiWindow, summarizeMidi, midiClock, meterBeats, midiKeyName, smpteShift } = await import('../src/lib/midiSong.ts');
const { beatSpans, gridBeatTimes } = await import('../src/lib/grid.ts');
const { canReplaceTempoMap } = await import('../src/lib/tempoFollow.ts');

// ---------- montagem dos arquivos ----------
const vlq = (n) => {
  const out = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  return out;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const latin1 = (s) => [...s].map((c) => c.charCodeAt(0) & 255);
const utf8 = (s) => [...new TextEncoder().encode(s)];
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
const tempo = (bpm) => { const us = Math.round(60e6 / bpm); return meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]); };
const meter = (n, d, cc = 24, bb = 8) => meta(0x58, [n, Math.log2(d), cc, bb]);
const marker = (text, enc = utf8) => meta(0x06, enc(text));
const eot = () => meta(0x2f, []);

/** Faixa a partir de [deltaTicks, bytesDoEvento]. Sem fim de faixa se `noEnd`. */
function track(events, { noEnd = false } = {}) {
  const body = [];
  for (const [delta, bytes] of events) body.push(...vlq(delta), ...bytes);
  if (!noEnd) body.push(0, ...eot());
  return [...latin1('MTrk'), ...u32(body.length), ...body];
}
function smf(format, division, tracks) {
  return new Uint8Array([...latin1('MThd'), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division), ...tracks.flat()]);
}
const PPQ = 480;
const close = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

// ---------- leitura ----------

test('formato 0: tempo, compasso, marcador, notas com running status e sysex', () => {
  const bytes = smf(0, PPQ, [track([
    [0, meta(0x03, utf8('Minha Música'))],
    [0, tempo(120)],
    [0, meter(4, 4)],
    [0, [0xf0, 3, 0x7e, 0x09, 0xf7]],
    [0, [0x90, 60, 100]],
    [240, [62, 90]], // running status
    [240, [60, 0]], // nota com velocidade 0 = fim
    [0, [0xc0, 5]],
    [0, [0xb0, 7, 100]],
    [0, meta(0x05, utf8('a'))],
    [PPQ * 4 - 480, marker('Verso')],
    [PPQ * 8, tempo(90)],
  ])]);
  const info = parseMidiFile(bytes);
  assert.equal(info.format, 0);
  assert.equal(info.sequenceName, 'Minha Música');
  assert.deepEqual(info.tempos.map((t) => t.tick), [0, PPQ * 12]);
  assert.equal(info.counts.notes, 2);
  assert.equal(info.counts.programChanges, 1);
  assert.equal(info.counts.sysex, 1);
  assert.equal(info.counts.lyrics, 1);
  assert.deepEqual(info.texts.map((t) => [t.text, t.tick]), [['Verso', PPQ * 4]]);
  assert.deepEqual(info.warnings, []);
});

test('formato 1: tempo e compasso espalhados nas faixas entram juntos, repetidos saem', () => {
  const conductor = track([[0, tempo(100)], [0, meter(3, 4)], [PPQ * 3, tempo(100)], [PPQ * 3, tempo(130)]]);
  const other = track([[0, meta(0x03, utf8('Teclado'))], [PPQ * 6, tempo(140)], [0, [0x90, 64, 80]]]);
  const info = parseMidiFile(smf(1, PPQ, [conductor, other]));
  // no tick 2880 a faixa de condutor (130) vence a outra faixa (140)
  assert.deepEqual(info.tempos.map((t) => [t.tick, Math.round(60e6 / t.usPerQuarter)]), [[0, 100], [PPQ * 6, 130]]);
  assert.equal(info.trackNames[1], 'Teclado');
  assert.equal(info.tracksRead, 2);
});

test('texto: UTF-8, Latin-1, BOM, zeros do fim e marca de idioma', () => {
  assert.equal(decodeMidiText(new Uint8Array(utf8('Refrão'))), 'Refrão');
  assert.equal(decodeMidiText(new Uint8Array(latin1('Coração'))), 'Coração');
  assert.equal(decodeMidiText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Ponte'), 0, 0])), 'Ponte');
  assert.equal(decodeMidiText(new Uint8Array(latin1('{@LATIN}Introdução'))), 'Introdução');
  // Windows-1252: 0x96 é o traço médio, vira caractere e não lixo
  assert.equal(decodeMidiText(new Uint8Array([0x45, 0x20, 0x96, 0x20, 0x46])), 'E – F');
});

test('marcadores com acento em Latin-1 e em UTF-8 no mesmo arquivo', () => {
  const info = parseMidiFile(smf(1, PPQ, [track([[0, tempo(120)], [PPQ * 4, marker('Introdução', latin1)], [PPQ * 8, marker('Refrão')]])]));
  assert.deepEqual(info.texts.map((t) => t.text), ['Introdução', 'Refrão']);
});

test('RIFF RMID e lixo antes do MThd (MacBinary)', () => {
  const inner = smf(0, PPQ, [track([[0, tempo(120)]])]);
  const riff = new Uint8Array([...latin1('RIFF'), 0, 0, 0, 0, ...latin1('RMID'), ...latin1('data'), inner.length & 255, (inner.length >> 8) & 255, 0, 0, ...inner]);
  assert.equal(parseMidiFile(riff).tempos.length, 1);
  const junk = new Uint8Array([...new Array(128).fill(0x11), ...inner]);
  assert.ok(looksLikeMidi(junk));
  assert.equal(parseMidiFile(junk).tempos.length, 1);
});

test('pedaço desconhecido é pulado e cabeçalho maior que 6 é respeitado', () => {
  const t = track([[0, tempo(150)]]);
  const bytes = new Uint8Array([...latin1('MThd'), ...u32(8), ...u16(1), ...u16(1), ...u16(PPQ), 9, 9, ...latin1('XFIH'), ...u32(3), 1, 2, 3, ...t]);
  const info = parseMidiFile(bytes);
  close(60e6 / info.tempos[0].usPerQuarter, 150, 0.01);
});

test('arquivo quebrado: não é MIDI, cabeçalho curto, faixa cortada, número grande demais', () => {
  assert.throws(() => parseMidiFile(new Uint8Array(latin1('RIFF1234WAVEfmt '))), MidiParseError);
  assert.throws(() => parseMidiFile(new Uint8Array([...latin1('MThd'), 0, 0, 0, 6, 0, 1])), MidiParseError);
  assert.throws(() => parseMidiFile(new Uint8Array([...latin1('MThd'), ...u32(6), 0, 0, 0, 1, 0, 0])), MidiParseError);
  // faixa anunciada maior que o arquivo, sem fim de faixa: o que veio vale
  const full = smf(0, PPQ, [track([[0, tempo(120)], [PPQ, marker('Verso')], [PPQ, [0x90, 60, 100]]], { noEnd: true })]);
  const cut = full.subarray(0, full.length - 2);
  const info = parseMidiFile(cut);
  assert.equal(info.tempos.length, 1);
  assert.equal(info.texts[0].text, 'Verso');
  assert.ok(info.warnings.length > 0);
  // VLQ de 5 bytes: a faixa para ali, com aviso
  const bad = smf(0, PPQ, [track([[0, tempo(120)], [0, [0xff, 0x06, 0x81, 0x81, 0x81, 0x81, 0x01]]])]);
  const r = parseMidiFile(bad);
  assert.equal(r.tempos.length, 1);
  assert.match(r.warnings.join(' '), /defeito/);
  // byte de dados logo depois de um meta (sem running status): defeito, não trava
  const noStatus = smf(0, PPQ, [track([[0, tempo(120)], [0, [0x40, 0x40]]])]);
  assert.match(parseMidiFile(noStatus).warnings.join(' '), /defeito/);
});

test('divisão SMPTE: tick é tempo absoluto e o andamento só diz onde caem as semínimas', () => {
  // 25 fps x 40 ticks = 1000 ticks por segundo
  const div = ((256 - 25) << 8) | 40;
  const info = parseMidiFile(smf(0, div, [track([[0, tempo(120)], [2000, marker('Verso')], [2000, tempo(60)]])]));
  assert.deepEqual(info.division, { kind: 'smpte', fps: 25, ticksPerFrame: 40 });
  const clock = midiClock(info);
  close(clock.seconds(2000), 2);
  close(clock.quarters(4000), 8); // 4 s a 120
  close(clock.quarters(5000), 9); // mais 1 s a 60
  const plan = planMidiSong(info, { duration: 20 });
  close(plan.tempoSegments[1].startTime, 4);
  close(plan.tempoSegments[1].bpm, 60);
  close(plan.regions[0].start, 2);
  assert.equal(summarizeMidi(info).smpteDivision, true);
});

// ---------- o que vira na música ----------

test('arquivo sem tempo nem compasso: 120 e 4/4, marcado como sem andamento', () => {
  const info = parseMidiFile(smf(1, 96, [track([[0, meta(0x03, utf8('Sem tempo'))], [96 * 4, marker('A')]])]));
  const s = summarizeMidi(info);
  assert.equal(s.hasTempo, false);
  assert.equal(s.bpmStart, 120);
  assert.equal(s.meterStart, '4/4');
  const plan = planMidiSong(info, { duration: 30 });
  assert.equal(plan.hasTempo, false);
  assert.equal(plan.bpm, 120);
  assert.equal(plan.tempoSegments, undefined);
  close(plan.regions[0].start, 2);
});

test('várias trocas de andamento e de compasso viram trechos cravados nos instantes do MIDI', () => {
  const info = parseMidiFile(smf(1, PPQ, [
    track([
      [0, tempo(120)], [0, meter(4, 4)],
      [PPQ * 16, tempo(140)], // compasso 5
      [PPQ * 8, meter(3, 4)], // compasso 7
      [PPQ * 6, tempo(100)], // 2 compassos de 3/4 depois
      [PPQ * 6, meter(6, 8)],
    ]),
  ]));
  const s = summarizeMidi(info);
  assert.equal(s.tempoChanges, 2);
  assert.equal(s.meterChanges, 2);
  assert.equal(s.bpmStart, 120);
  const plan = planMidiSong(info, { duration: 120 });
  assert.equal(plan.beatsPerBar, 4);
  const segs = plan.tempoSegments;
  // 16 semínimas a 120 = 8 s; 8 a 140 = 3,4286 s; 6 a 140 = 2,5714 s; 6 a 100 = 3,6 s
  const t1 = 8, t2 = t1 + 8 * 60 / 140, t3 = t2 + 6 * 60 / 140, t4 = t3 + 6 * 60 / 100;
  assert.deepEqual(segs.map((x) => [Number(x.startTime.toFixed(4)), Number(x.bpm.toFixed(2)), x.beatsPerBar ?? 4]), [
    [0, 120, 4],
    [Number(t1.toFixed(4)), 140, 4],
    [Number(t2.toFixed(4)), 140, 3],
    [Number(t3.toFixed(4)), 100, 3],
    [Number(t4.toFixed(4)), 200, 6], // 6/8 em colcheias
  ]);
  assert.equal(segs[segs.length - 1].endTime, 120);
  // a grade tem batida exatamente em cada troca
  const beats = gridBeatTimes({ bpm: plan.bpm, beatsPerBar: 4, tempoSegments: segs }, 0, 40);
  for (const t of [t1, t2, t3, t4]) assert.ok(beats.some((b) => Math.abs(b - t) < 1e-5), `sem batida em ${t}`);
  // compasso de cada trecho na contagem da régua
  assert.deepEqual(beatSpans({ bpm: plan.bpm, beatsPerBar: 4, tempoSegments: segs }).map((x) => x.perBar), [4, 4, 3, 3, 6]);
});

test('troca de andamento no meio do compasso: o trecho novo sabe quantos tempos faltam para o 1', () => {
  const info = parseMidiFile(smf(0, PPQ, [track([[0, tempo(120)], [0, meter(4, 4)], [PPQ * 6, tempo(90)]])]));
  const plan = planMidiSong(info, { duration: 60 });
  const [, b] = plan.tempoSegments;
  close(b.startTime, 3);
  assert.equal(b.barOffset, 2);
  close(b.downbeat, 3 + 2 * 60 / 90);
});

test('troca dentro de uma batida e rampa: a grade fica a meio milissegundo do arquivo', () => {
  const ev = [[0, tempo(100)], [0, meter(4, 4)], [PPQ * 4 + 120, tempo(110)]];
  // rampa de 110 a 150 em semicolcheias por 2 compassos
  for (let k = 1; k <= 32; k++) ev.push([120, tempo(110 + (40 * k) / 32)]);
  const info = parseMidiFile(smf(0, PPQ, [track(ev)]));
  const clock = midiClock(info);
  const plan = planMidiSong(info, { duration: 60 });
  const beats = gridBeatTimes({ bpm: plan.bpm, beatsPerBar: 4, tempoSegments: plan.tempoSegments }, 0, 30);
  for (let q = 0; q <= 40; q++) {
    const t = clock.secondsAtQuarter(q);
    assert.ok(beats.some((b) => Math.abs(b - t) <= 0.0006), `batida ${q} fora (${t})`);
  }
  assert.ok(plan.tempoSegments.length < 30, `trechos demais: ${plan.tempoSegments.length}`);
  close(plan.tempoSegments[plan.tempoSegments.length - 1].bpm, 150, 1e-3);
});

test('compasso que a música não tem (5/4) fica no mapa, mesmo sem troca de andamento', () => {
  const info = parseMidiFile(smf(0, PPQ, [track([[0, tempo(120)], [0, meter(5, 4)]])]));
  const plan = planMidiSong(info, { duration: 60 });
  assert.equal(plan.beatsPerBar, undefined);
  assert.equal(plan.tempoSegments.length, 2);
  assert.deepEqual(beatSpans({ bpm: plan.bpm, tempoSegments: plan.tempoSegments }).map((x) => x.perBar), [5, 5]);
  close(plan.tempoSegments[1].startTime, 2.5);
});

test('um andamento só em 3/4: sem mapa, BPM e compasso da música', () => {
  const info = parseMidiFile(smf(0, PPQ, [track([[0, tempo(72.5)], [0, meter(3, 4)]])]));
  const plan = planMidiSong(info, { duration: 200 });
  assert.equal(plan.tempoSegments, undefined);
  assert.equal(plan.beatsPerBar, 3);
  close(plan.bpm, 72.5, 1e-3);
});

test('2/2 conta em semínimas e 6/8 em colcheias', () => {
  assert.deepEqual(meterBeats(2, 2), { perBar: 4, unit: 1 });
  assert.deepEqual(meterBeats(6, 8), { perBar: 6, unit: 0.5 });
  assert.deepEqual(meterBeats(7, 16), { perBar: 7, unit: 0.25 });
  assert.deepEqual(meterBeats(3, 4), { perBar: 3, unit: 1 });
});

test('marcações viram regiões: marcador no 0:00 vale mesmo com o nome da música, vazio sai, FIM fecha', () => {
  const info = parseMidiFile(smf(1, PPQ, [track([
    [0, meta(0x03, utf8('Santo'))], [0, tempo(120)], [0, marker('Santo')],
    [PPQ * 4, marker('Introdução')], [PPQ * 8, marker('   ')], [0, marker('Refrão')],
    [PPQ * 16, marker('FIM')], [PPQ * 8, marker('Ponte')],
  ])]));
  const plan = planMidiSong(info, { duration: 30 });
  assert.deepEqual(plan.regions.map((r) => [r.name, r.start, r.end]), [['Santo', 0, 2], ['Introdução', 2, 6], ['Refrão', 6, 14], ['Ponte', 18, 30]]);
  assert.deepEqual(summarizeMidi(info).markers, ['Santo', 'Introdução', 'Refrão', 'Ponte']);
});

test('sem marcador, os cue points viram seção', () => {
  const info = parseMidiFile(smf(0, PPQ, [track([[0, tempo(120)], [PPQ * 2, meta(0x07, utf8('Verso'))]])]));
  assert.deepEqual(planMidiSong(info, { duration: 10 }).regions.map((r) => r.name), ['Verso']);
});

test('tom pela armadura; C maior sozinho não vale', () => {
  assert.equal(midiKeyName(1, false), 'G');
  assert.equal(midiKeyName(-3, false), 'Eb');
  assert.equal(midiKeyName(0, true), 'Am');
  assert.equal(midiKeyName(3, true), 'F#m');
  const key = (sf, mi) => planMidiSong(parseMidiFile(smf(0, PPQ, [track([[0, meta(0x59, [sf & 255, mi])]])])), { duration: 5 }).musicKey;
  assert.equal(key(2, 0), 'D');
  assert.equal(key(-1, 1), 'Dm');
  assert.equal(key(0, 0), undefined);
});

test('SMPTE offset: hora cheia não desloca; o resto pode ser aplicado e a grade entra depois do 0:00', () => {
  const at = (h, m, s, f) => meta(0x54, [(1 << 5) | h, m, s, f, 0]); // 25 fps
  assert.equal(smpteShift(parseMidiFile(smf(0, PPQ, [track([[0, at(1, 0, 0, 0)]])])).smpteOffset), 0);
  const info = parseMidiFile(smf(0, PPQ, [track([[0, at(1, 0, 2, 0)], [0, tempo(120)], [0, meter(4, 4)], [PPQ * 4, marker('Verso')]])]));
  const s = summarizeMidi(info);
  assert.equal(s.smpte, '01:00:02:00');
  close(s.smpteShift, 2);
  const plan = planMidiSong(info, { duration: 30, shift: s.smpteShift });
  close(plan.regions[0].start, 4);
  // trecho de entrada com 4 batidas até o 1 do MIDI
  const [lead, main] = plan.tempoSegments;
  assert.equal(lead.startTime, 0);
  close(main.startTime, 2);
  close(lead.bpm, 120);
  // sem aplicar: tudo como no arquivo
  close(planMidiSong(info, { duration: 30 }).regions[0].start, 2);
  // pré-rolagem antes da hora cheia é negativa
  close(smpteShift({ hours: 0, minutes: 59, seconds: 58, frames: 0, subframes: 0, fps: 25 }), -2);
});

test('trecho de um projeto: só o que cai na música, com o começo no 1 certo', () => {
  const info = parseMidiFile(smf(1, PPQ, [track([[0, tempo(120)], [0, meter(4, 4)], [PPQ * 40, tempo(90)], [PPQ * 4, marker('Refrão')]])]));
  // música de 10 s a 30 s do projeto (compasso 6 ao fim); a troca de 90 cai em 20 s
  const plan = planMidiWindow(info, { start: 10, end: 30 });
  close(plan.bpm, 120);
  close(plan.tempoSegments[1].startTime, 10);
  close(plan.tempoSegments[1].bpm, 90);
  close(plan.regions[0].start, 10 + 4 * 60 / 90);
});

test('mapa do MIDI não pode ser trocado pela conferência automática', () => {
  const segs = [{ startTime: 0, endTime: 10, bpm: 120, downbeat: 0 }, { startTime: 10, endTime: 20, bpm: 90, downbeat: 10 }];
  assert.equal(canReplaceTempoMap({ bpm: 120, bpmSource: 'manual', tempoSegments: segs, tempoMapSource: 'midi' }), false);
  assert.equal(canReplaceTempoMap({ bpm: 120, bpmSource: 'click', tempoSegments: segs, tempoMapSource: 'midi' }), false);
  assert.equal(canReplaceTempoMap({ bpm: 120, tempoMapSource: 'midi' }), false);
});

// ---------- arquivos .mid de verdade no Mac (só leitura) ----------
test('arquivos .mid achados no Mac abrem sem erro', () => {
  const roots = [path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Downloads')];
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6 || found.length >= 40) return;
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(mid|midi|smf)$/i.test(e.name)) found.push(p);
      if (found.length >= 40) return;
    }
  };
  for (const r of roots) walk(r, 0);
  for (const file of found) {
    const bytes = fs.readFileSync(file);
    if (bytes.length > 32 * 1024 * 1024) continue;
    let info;
    try { info = parseMidiFile(bytes); } catch (err) {
      assert.ok(err instanceof MidiParseError, `${file}: ${err}`);
      continue;
    }
    const s = summarizeMidi(info);
    assert.ok(s.bpmStart > 0 && Number.isFinite(s.bpmStart), file);
    const plan = planMidiSong(info, { duration: Math.max(30, s.lengthSeconds) });
    assert.ok(plan.bpm > 0, file);
    for (const seg of plan.tempoSegments ?? []) assert.ok(seg.bpm > 0 && Number.isFinite(seg.startTime), file);
  }
});

// ---------- pergunta e ligação com a importação ----------
const { midiImportPrompt, askMidiImport } = await import('../src/lib/appPrompt.ts');
const src = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('a janela responde qual MIDI ler; Ignorar devolve null', async () => {
  const options = [{ fileName: 'a.mid', summary: null, error: 'x' }, { fileName: 'b.mid', summary: { smpteShift: 2 } }];
  let shown = null;
  const off = midiImportPrompt.register((p) => { shown = p; });
  const read = askMidiImport({ songName: 'Santo', songCount: 1, options });
  assert.equal(shown.songName, 'Santo');
  assert.equal(shown.options.length, 2);
  shown.answer({ index: 1, applySmpte: true });
  assert.deepEqual(await read, { index: 1, applySmpte: true });
  const skip = askMidiImport({ songName: 'Santo', songCount: 1, options });
  shown.answer(null);
  assert.equal(await skip, null);
  off();
});

test('importação: pergunta antes de importar, aplica com origem própria e confere com o click', () => {
  const im = src('lib/importManager.ts');
  assert.match(im, /const midi = await chooseMidi\(groups\[k\], midiAnswers\);[\s\S]*importSong\(groups\[k\]\.name, groups\[k\]\.files, label, groups\[k\]\.reaper, midi\)/);
  assert.match(im, /tempoMapSource: 'midi' as const/);
  assert.match(im, /setSongBpm\(songId, plan\.bpm, 'manual', 0\)/);
  // com andamento do MIDI a medição pelo click não roda; só a conferência
  assert.match(im, /if \(midiTempo\) await checkMidiAgainstClick\(songId\);\s*else await applyBpm\(songId, \{ createClick: true \}\);/);
  assert.match(im, /if \(r\.midiTempo\) await checkMidiAgainstClick\(r\.songId\);/);
  // sem MIDI, nada muda
  assert.match(im, /if \(!src\?\.files\.length\) return null;/);
  // o MIDI aparece nas três entradas: pasta, pasta mãe, arrastar e projeto do REAPER
  assert.match(im, /withMidi\(\{ name: relPath\(audio\[0\]\)\[0\]/);
  assert.match(im, /withMidi\(\{ name, files: list \}, midi\.get\(name\)/);
  assert.match(im, /withMidi\(\{ name: entry\.name, files \}/);
  assert.match(im, /midi: \{ files: midiFiles, window: \{ start: song\.start, end: song\.end \}/);
  assert.match(src('App.tsx'), /<MidiImportDialog \/>/);
  assert.match(src('lib/tempoFollow.ts'), /source === 'reaper' \|\| source === 'midi'/);
});

test('mapa enorme (20 mil trocas) e muitas notas: lê rápido e a grade fica no arquivo', () => {
  const ev = [[0, meter(4, 4)]];
  for (let k = 0; k < 20000; k++) ev.push([k ? 24 : 0, tempo(100 + 40 * Math.sin(k / 300))]);
  for (let k = 0; k < 50000; k++) ev.push([0, k % 2 ? [0x80, 60, 0] : [0x90, 60, 100]]);
  const started = performance.now();
  const info = parseMidiFile(smf(0, PPQ, [track(ev)]));
  const plan = planMidiSong(info, { duration: 600 });
  assert.ok(performance.now() - started < 4000, 'demorou demais');
  const clock = midiClock(info);
  const beats = gridBeatTimes({ bpm: plan.bpm, beatsPerBar: 4, tempoSegments: plan.tempoSegments }, 0, 800);
  for (let q = 0; q < 900; q += 37) {
    const t = clock.secondsAtQuarter(q);
    assert.ok(beats.some((b) => Math.abs(b - t) <= 0.0006), `batida ${q} fora`);
  }
});

// ---------- correções da revisão ----------

test('projeto com várias músicas: cada uma leva só os andamentos dela', () => {
  // 120 BPM até 20 s, 90 até 46,67 s, 150 depois
  const info = parseMidiFile(smf(1, PPQ, [track([[0, tempo(120)], [0, meter(4, 4)], [PPQ * 40, tempo(90)], [PPQ * 40, tempo(150)]])]));
  const first = planMidiWindow(info, { start: 0, end: 20 });
  assert.equal(first.tempoSegments, undefined);
  close(first.bpm, 120);
  const middle = planMidiWindow(info, { start: 20, end: 20 + 40 * 60 / 90 });
  assert.equal(middle.tempoSegments, undefined);
  close(middle.bpm, 90);
  // a que pega a troca leva só ela
  const both = planMidiWindow(info, { start: 10, end: 30 });
  assert.deepEqual(both.tempoSegments.map((s) => Math.round(s.bpm)), [120, 90]);
  close(both.tempoSegments[1].endTime, 20);
  // a grade da música 1 continua no relógio do arquivo até o fim dela
  const beats = gridBeatTimes({ bpm: first.bpm, beatsPerBar: 4, tempoSegments: first.tempoSegments }, 0, 20);
  assert.ok(beats.every((b) => Math.abs(b / 0.5 - Math.round(b / 0.5)) < 1e-6));
  // música sozinha mais curta que o MIDI: o mapa não passa do fim
  assert.equal(planMidiSong(info, { duration: 15 }).tempoSegments, undefined);
  assert.equal(planMidiSong(info, { duration: 60 }).tempoSegments.length, 3);
});

test('com SMPTE offset aplicado, o BPM da música é o do MIDI, não o do trecho de entrada', () => {
  const at = meta(0x54, [(3 << 5) | 1, 0, 2, 12, 0]); // 01:00:02:12 a 30 fps = 2,4 s
  const info = parseMidiFile(smf(0, PPQ, [track([[0, at], [0, tempo(120)], [0, meter(4, 4)]])]));
  const shift = summarizeMidi(info).smpteShift;
  close(shift, 2.4);
  const plan = planMidiSong(info, { duration: 30, shift });
  close(plan.bpm, 120);
  assert.equal(plan.tempoSegments[0].startTime, 0);
  assert.ok(Math.abs(plan.tempoSegments[0].bpm - 120) > 1, 'o trecho de entrada tem andamento próprio');
  close(plan.tempoSegments[1].bpm, 120);
  close(plan.tempoSegments[1].startTime, 2.4);
});

test('cabeçalho com menos de 14 bytes dá MidiParseError', () => {
  for (const bytes of [[0x4d, 0x54, 0x68, 0x64, 0, 0], [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1]]) {
    assert.throws(() => parseMidiFile(new Uint8Array(bytes)), MidiParseError);
  }
  assert.throws(() => parseMidiFile(new Uint8Array([1, 2, ...latin1('MThd'), 0, 0])), MidiParseError);
});

test('tempo e compasso no mesmo tick em faixas diferentes: vale o da faixa de condutor', () => {
  const info = parseMidiFile(smf(1, PPQ, [
    track([[0, tempo(120)], [0, meter(4, 4)]]),
    track([[0, tempo(100)], [0, meter(3, 4)], [PPQ * 8, tempo(90)]]),
  ]));
  assert.deepEqual(info.tempos.map((t) => [t.tick, Math.round(60e6 / t.usPerQuarter)]), [[0, 120], [PPQ * 8, 90]]);
  assert.deepEqual(info.meters.map((m) => `${m.numerator}/${m.denominator}`), ['4/4']);
  // na mesma faixa, o último do tick vale
  const same = parseMidiFile(smf(0, PPQ, [track([[0, tempo(120)], [0, tempo(100)]])]));
  assert.equal(Math.round(60e6 / same.tempos[0].usPerQuarter), 100);
});

test('marcador no tick 0 com o nome da faixa de condutor continua virando região', () => {
  const info = parseMidiFile(smf(1, PPQ, [track([[0, meta(0x03, utf8('Intro'))], [0, tempo(120)], [0, marker('Intro')], [PPQ * 9.6, marker('Verso')]])]));
  const plan = planMidiSong(info, { duration: 20 });
  assert.deepEqual(plan.regions.map((r) => [r.name, r.start, r.end]), [['Intro', 0, 4.8], ['Verso', 4.8, 20]]);
});

test('running status depois de meta ou sysex: o último status de canal continua valendo', () => {
  const info = parseMidiFile(smf(0, PPQ, [track([
    [0, tempo(120)], [0, [0x90, 0x3c, 0x64]], [0, meta(0x01, utf8('texto'))], [10, [0x3e, 0x64]],
    [0, [0xf0, 2, 0x7e, 0xf7]], [10, [0x40, 0x64]], [PPQ, marker('Verso')],
  ])]));
  assert.equal(info.counts.notes, 3);
  assert.deepEqual(info.warnings, []);
  assert.equal(info.texts.find((t) => t.kind === 'marker').text, 'Verso');
});

test('projeto do REAPER: itens MIDI das faixas não são oferecidos como mapa do projeto', async () => {
  const { withoutItemMedia } = await import('../src/lib/reaperProject.ts');
  const item = (file, sourceType) => ({ name: '', position: 30, length: 10, sourceOffset: 0, volume: 1, mute: false, fadeIn: 0, fadeOut: 0, playRate: 1, file, sourceType });
  const project = { bpm: 120, beatsPerBar: 4, tempo: [], markers: [], regions: [], tracks: [
    { name: 'Teclado', volume: 1, mute: false, folders: [], folderVolume: 1, folderMute: false, hasFx: false, items: [item('Media/teclado.mid', 'MIDI'), item('Media/voz.wav', 'WAVE')] },
  ] };
  const files = [{ path: 'Show/Media/teclado.mid', file: 'item' }, { path: 'Show/Show.mid', file: 'projeto' }];
  assert.deepEqual(withoutItemMedia(project, 'Show', files), ['projeto']);
  assert.deepEqual(withoutItemMedia(project, 'Show', []), []);
  const im = fs.readFileSync(path.join(import.meta.dirname, '../src/lib/importManager.ts'), 'utf8');
  assert.match(im, /const midiFiles = withoutItemMedia\(project, dir, all\.filter\(\(f\) => isMidi\(f\.file\)\)\);/);
});

test('projeto com várias músicas: o compasso de cada uma é o do começo dela', () => {
  const src = fs.readFileSync(new URL('../src/lib/midiSong.ts', import.meta.url), 'utf8');
  assert.match(src, /const startBar = beats\[0\]\?\.perBar \?\? songBar;/);
  assert.match(src, /plan\.beatsPerBar = startBar;/);
});
