// Cronômetro "Falta no show": começa com a duração do show, conta no relógio de parede a partir do
// Iniciar (a música não interfere), e a duração pode ser trocada à mão (ex.: show de duas horas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clockLabel, durationFor, getShowClock, parseShowDuration, remainingSec, resetShowClock,
  setShowDuration, showKeyOf, startShowClock,
} from '../src/lib/showClock.ts';

test('duração digitada: horas, h:mm, 2h30, minutos e h:mm:ss', () => {
  assert.equal(parseShowDuration('2'), 7200);
  assert.equal(parseShowDuration('2:30'), 9000);
  assert.equal(parseShowDuration('2h30'), 9000);
  assert.equal(parseShowDuration('2h'), 7200);
  assert.equal(parseShowDuration('90min'), 5400);
  assert.equal(parseShowDuration('1:08:55'), 4135);
  assert.equal(parseShowDuration(' 0:45 '), 2700);
});

test('duração inválida não vale', () => {
  for (const t of ['', 'abc', '0', '2:75', '1:00:99', '25', '2:30:00:00']) assert.equal(parseShowDuration(t), null, t);
});

test('sem duração escolhida vale a do show selecionado; cada show guarda a sua', () => {
  resetShowClock();
  const a = showKeyOf('show-a');
  const b = showKeyOf('show-b');
  setShowDuration(a, null, 0);
  setShowDuration(b, null, 0);
  assert.equal(durationFor(getShowClock(), a, 4135), 4135);
  setShowDuration(a, 7200, 4135);
  assert.equal(durationFor(getShowClock(), a, 4135), 7200);
  assert.equal(durationFor(getShowClock(), b, 3000), 3000);
  setShowDuration(a, null, 4135);
  assert.equal(durationFor(getShowClock(), a, 4135), 4135);
  assert.equal(showKeyOf(null), 'padrao');
});

test('conta no relógio a partir do Iniciar e passa do tempo em negativo', () => {
  const t0 = 1_000_000;
  startShowClock(7200, t0);
  const run = getShowClock().run;
  assert.ok(run);
  assert.equal(clockLabel(remainingSec(run, t0)), '2:00:00');
  assert.equal(clockLabel(remainingSec(run, t0 + 1500)), '1:59:59');
  assert.equal(clockLabel(remainingSec(run, t0 + 3600_000)), '1:00:00');
  assert.equal(clockLabel(remainingSec(run, t0 + 7140_000)), '1:00');
  assert.equal(clockLabel(remainingSec(run, t0 + 7200_000)), '0:00');
  assert.equal(clockLabel(remainingSec(run, t0 + 7512_000)), '-5:12');
  resetShowClock();
  assert.equal(getShowClock().run, null);
});

test('mudar a duração com a contagem andando vale a partir do mesmo Iniciar', () => {
  const t0 = 5_000_000;
  const k = showKeyOf('show-c');
  startShowClock(3600, t0);
  setShowDuration(k, 9000, 3600);
  const run = getShowClock().run;
  assert.equal(run.startedAt, t0);
  assert.equal(clockLabel(remainingSec(run, t0 + 1800_000)), '2:00:00');
  resetShowClock();
  setShowDuration(k, null, 0);
});
