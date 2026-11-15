// Diário de engasgos do motor: guarda só os últimos eventos, na ordem, e vira texto para colar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioDiagLog, AUDIO_DIAG_MAX, iniciarAudioDiag } from '../src/lib/audioDiag.ts';

test('guarda na ordem e devolve cópia', () => {
  const log = new AudioDiagLog();
  log.registrar({ t: 10, tipo: 'underrun', faixa: 'baixo', folgaQuadros: 128 });
  log.registrar({ t: 20, tipo: 'recovered', faixa: 'baixo' });
  const evs = log.ler();
  assert.deepEqual(evs, [
    { t: 10, tipo: 'underrun', faixa: 'baixo', folgaQuadros: 128 },
    { t: 20, tipo: 'recovered', faixa: 'baixo' },
  ]);
  evs[0].faixa = 'outro';
  assert.equal(log.ler()[0].faixa, 'baixo');
});

test('circular: passa do limite e o mais antigo sai', () => {
  const log = new AudioDiagLog(3);
  for (let i = 0; i < 5; i++) log.registrar({ t: i, tipo: 'longtask', duracaoMs: 60 + i });
  assert.deepEqual(log.ler().map((e) => e.t), [2, 3, 4]);
  assert.equal(AUDIO_DIAG_MAX, 200);
});

test('limpar zera o diário', () => {
  const log = new AudioDiagLog(2);
  log.registrar({ t: 1, tipo: 'longtask' });
  log.registrar({ t: 2, tipo: 'longtask' });
  log.registrar({ t: 3, tipo: 'longtask' });
  log.limpar();
  assert.deepEqual(log.ler(), []);
  log.registrar({ t: 4, tipo: 'underrun' });
  assert.deepEqual(log.ler().map((e) => e.t), [4]);
});

test('texto: tempo relativo ao primeiro, uma linha por evento', () => {
  const log = new AudioDiagLog();
  assert.equal(log.comoTexto(), 'diag audio: nenhum evento');
  log.registrar({ t: 1000, tipo: 'longtask', duracaoMs: 180.4 });
  log.registrar({ t: 1250, tipo: 'underrun', faixa: 'piano', folgaQuadros: 0 });
  assert.equal(log.comoTexto(), [
    'diag audio: 2 eventos',
    '+0.000s longtask dur=180ms',
    '+0.250s underrun faixa=piano folga=0',
  ].join('\n'));
});

test('largada registra a espera do extra e a primeira leitura', () => {
  const log = new AudioDiagLog();
  log.registrar({ t: 0, tipo: 'largada', duracaoMs: 42.6, leituraMs: 31.2, faixa: '7/8' });
  assert.deepEqual(log.ler(), [{ t: 0, tipo: 'largada', duracaoMs: 42.6, leituraMs: 31.2, faixa: '7/8' }]);
  assert.equal(log.comoTexto(), ['diag audio: 1 eventos', '+0.000s largada faixa=7/8 dur=43ms leitura=31ms'].join('\n'));
});

test('iniciar fora do navegador não quebra e pode ser chamado de novo', () => {
  iniciarAudioDiag();
  iniciarAudioDiag();
});
