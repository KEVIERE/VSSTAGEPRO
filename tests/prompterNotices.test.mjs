// Avisos do teleprompter: envio, histórico, agendamento por música e o que a TV mostra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROMPTER } from '../src/lib/prompterTypes.ts';
import { activeNotice, newId, withNotice } from '../src/lib/prompterView.ts';

const OPTS = { level: 'info', layout: 'bar', durationSec: 0 };

test('mandar um aviso coloca na TV na hora e guarda no histórico', () => {
  const next = withNotice(DEFAULT_PROMPTER, '  O prefeito chegou  ', OPTS);
  assert.ok(next, 'com texto deve devolver estado novo');
  assert.equal(next.notice.text, 'O prefeito chegou', 'o texto vai sem espaços nas pontas');
  assert.equal(next.notice.layout, 'bar');
  assert.equal(next.history[0].text, 'O prefeito chegou');
  assert.equal(next.history[0].id, next.notice.id, 'histórico e aviso compartilham o id');
  // o estado anterior não é alterado (o React depende disso)
  assert.equal(DEFAULT_PROMPTER.notice, null);
});

test('aviso vazio não é enviado', () => {
  assert.equal(withNotice(DEFAULT_PROMPTER, '   ', OPTS), null);
});

test('texto passado do limite é cortado em 200 caracteres', () => {
  const next = withNotice(DEFAULT_PROMPTER, 'a'.repeat(500), OPTS);
  assert.equal(next.notice.text.length, 200);
});

test('o mesmo aviso não aparece duas vezes no histórico', () => {
  let s = withNotice(DEFAULT_PROMPTER, 'Agradecer a produção', OPTS);
  s = withNotice(s, 'Outro aviso', OPTS);
  s = withNotice(s, 'Agradecer a produção', OPTS);
  assert.equal(s.history.filter((h) => h.text === 'Agradecer a produção').length, 1);
  assert.equal(s.history[0].text, 'Agradecer a produção', 'o reenviado volta para o topo');
});

test('o histórico para em 20 itens', () => {
  let s = DEFAULT_PROMPTER;
  for (let i = 0; i < 30; i++) s = withNotice(s, `Aviso ${i}`, OPTS);
  assert.equal(s.history.length, 20);
  assert.equal(s.history[0].text, 'Aviso 29');
});

test('aviso com tempo some quando o tempo acaba, e "até tirar" fica', () => {
  const base = 1_700_000_000_000;
  const comTempo = withNotice(DEFAULT_PROMPTER, 'Volta em 10 s', { ...OPTS, durationSec: 10 });
  comTempo.notice.sentAt = base;
  assert.ok(activeNotice(comTempo, base + 5_000, null, 0, false), 'aos 5 s ainda aparece');
  assert.equal(activeNotice(comTempo, base + 11_000, null, 0, false), null, 'aos 11 s já saiu');

  const semTempo = withNotice(DEFAULT_PROMPTER, 'Até tirar', OPTS);
  semTempo.notice.sentAt = base;
  assert.ok(activeNotice(semTempo, base + 600_000, null, 0, false), '"até tirar" fica até o produtor tirar');
});

test('aviso programado aparece só quando a música toca, e só no começo dela', () => {
  const s = { ...DEFAULT_PROMPTER, scheduled: [{ id: 'sc1', songId: 's2', text: 'Chamar o público', level: 'warn', layout: 'bar', durationSec: 15 }] };
  assert.equal(activeNotice(s, 0, null, 0, true), null, 'sem música não aparece');
  assert.equal(activeNotice(s, 0, 's2', 3, false), null, 'com o show parado não aparece');
  const dentro = activeNotice(s, 0, 's2', 3, true);
  assert.equal(dentro?.text, 'Chamar o público');
  assert.equal(activeNotice(s, 0, 's2', 20, true), null, 'depois dos 15 s não aparece');
  assert.equal(activeNotice(s, 0, 's1', 3, true), null, 'outra música não puxa o aviso');
});

test('o aviso manual tem prioridade sobre o programado', () => {
  const manual = withNotice(DEFAULT_PROMPTER, 'Alô do produtor', OPTS);
  const s = { ...manual, scheduled: [{ id: 'sc1', songId: 's2', text: 'Programado', level: 'info', layout: 'bar', durationSec: 15 }] };
  assert.equal(activeNotice(s, Date.now(), 's2', 3, true)?.text, 'Alô do produtor');
});

test('newId gera identificações diferentes', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newId()));
  assert.equal(ids.size, 50);
});

test('o estado enviado ao servidor cabe no limite do banco', () => {
  // producer_set_prompter recusa acima de 60000 bytes e, antes, acima de 8000. Com os limites
  // da própria tela (30 avisos prontos de 200, 20 no histórico, 100 programados) o pior caso
  // precisa passar, senão o produtor fica sem conseguir gravar nada.
  let s = DEFAULT_PROMPTER;
  s = {
    ...s,
    presets: Array.from({ length: 30 }, (_, i) => `Aviso pronto ${i} `.repeat(12).slice(0, 200)),
    history: Array.from({ length: 20 }, (_, i) => ({ id: `9f8e7d6c-1234-4abc-9def-${String(i).padStart(12, '0')}`, text: 'Histórico '.repeat(18).slice(0, 200), at: 1_700_000_000_000 + i })),
    scheduled: Array.from({ length: 100 }, (_, i) => ({ id: `9f8e7d6c-1234-4abc-9def-${String(i).padStart(12, '0')}`, songId: `song-${i}`, text: 'Programado '.repeat(18).slice(0, 200), level: 'warn', layout: 'center', durationSec: 60 })),
  };
  const bytes = Buffer.byteLength(JSON.stringify(s));
  assert.ok(bytes < 60000, `pior caso com todos os limites cheios: ${bytes} bytes`);
});
