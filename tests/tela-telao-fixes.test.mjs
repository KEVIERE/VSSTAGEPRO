import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLiveView, holdForward } from '../src/lib/liveClock.ts';
import { activeNotice, withNotice } from '../src/lib/prompterView.ts';
import { DEFAULT_PROMPTER } from '../src/lib/prompterTypes.ts';

const live = {
  isPlaying: true, isPaused: false, currentTime: 60, songProgress: 0.25, nextSongCountdown: 180,
  currentSongId: 's', nextSongId: 'n', bpm: 120, playFlow: 'auto', onAir: true, publishedAt: 0,
};

test('sem sinal tocando (TV, 30 s): congela onde estava, sem voltar ao último pacote', () => {
  const a = computeLiveView(live, 240, 0, 0, 29900, 30000);
  const b = computeLiveView(live, 240, 0, 0, 31000, 30000);
  assert.equal(a.status, 'live');
  assert.equal(b.status, 'nosignal');
  assert.equal(b.isPlaying, false);
  assert.equal(b.currentTime, 90);
  assert.ok(b.currentTime - a.currentTime < 0.2, 'não pula para trás na troca');
  assert.equal(b.songProgress, 90 / 240);
  assert.equal(b.nextSongCountdown, 150);
  // Continua parado enquanto durar a queda.
  const c = computeLiveView(live, 240, 0, 0, 120000, 30000);
  assert.equal(c.currentTime, 90);
});

test('sem sinal tocando (músico, 4 s): também para na estimativa', () => {
  const v = computeLiveView(live, 240, 0, 0, 5000);
  assert.equal(v.status, 'nosignal');
  assert.equal(v.currentTime, 64);
  assert.equal(v.nextSongCountdown, 176);
});

test('sem sinal perto do fim: não passa da duração', () => {
  const v = computeLiveView({ ...live, currentTime: 230 }, 240, 0, 0, 31000, 30000);
  assert.equal(v.currentTime, 240);
  assert.equal(v.songProgress, 1);
});

test('parado ou fora do ar: continua devolvendo o tempo do pacote', () => {
  const parado = computeLiveView({ ...live, isPlaying: false }, 240, 0, 0, 60000, 30000);
  assert.equal(parado.currentTime, 60);
  const fora = computeLiveView({ ...live, onAir: false }, 240, 0, 0, 60000, 30000);
  assert.equal(fora.status, 'ended');
  assert.equal(fora.currentTime, 60);
});

test('holdForward volta limpo quando o sinal retorna', () => {
  const mem = { songId: null, t: 0 };
  holdForward(computeLiveView(live, 240, 0, 0, 31000, 30000), 's', mem, 240);
  assert.equal(mem.t, 90);
  // Sinal de volta com o tempo real à frente: segue sem segurar nada.
  const back = holdForward(computeLiveView({ ...live, currentTime: 95 }, 240, 0, 40000, 40100, 30000), 's', mem, 240);
  assert.ok(back.isPlaying);
  assert.ok(back.currentTime >= 95);
});

const OPTS = { level: 'info', layout: 'bar', durationSec: 10 };

test('withNotice carimba o instante recebido (hora do servidor)', () => {
  const at = 1_700_000_000_000;
  const s = withNotice(DEFAULT_PROMPTER, 'Volta em 10 s', OPTS, at);
  assert.equal(s.notice.sentAt, at);
  assert.equal(s.history[0].at, at);
});

test('withNotice sem instante usa o relógio local, como antes', () => {
  const before = Date.now();
  const s = withNotice(DEFAULT_PROMPTER, 'Até tirar', { ...OPTS, durationSec: 0 });
  assert.ok(s.notice.sentAt >= before && s.notice.sentAt <= Date.now());
});

test('aviso com tempo: comparado na hora do servidor, o relógio errado da TV não importa', () => {
  const serverSent = 1_700_000_000_000;
  const s = withNotice(DEFAULT_PROMPTER, 'Volta em 10 s', OPTS, serverSent);
  // TV 15 s adiantada: pelo relógio dela o aviso já teria vencido.
  const tvNow = serverSent + 2000 + 15000;
  assert.equal(activeNotice(s, tvNow, null, 0, false), null);
  const clockOffsetMs = -15000;
  assert.ok(activeNotice(s, tvNow + clockOffsetMs, null, 0, false));
  // E sai no tempo certo.
  assert.equal(activeNotice(s, serverSent + 10500, null, 0, false), null);
});
