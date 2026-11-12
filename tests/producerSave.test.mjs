// O produtor aperta "Salvar no projeto" várias vezes seguidas: vale a última, o programa do diretor
// salva uma vez só. E o estilo geral da letra (tamanho, cor, fonte, "sai antes") vai para o projeto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCoalescedSave } from '../src/lib/coalesceSave.ts';
import { DEFAULT_PROMPTER, lyricStyleOf, normalizeLyricStyle, sameLyricStyle } from '../src/lib/prompterTypes.ts';

const require = createRequire(import.meta.url);
const { LocalServer } = require('../desktop/localServer.js');

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await new Promise((r) => setImmediate(r));
      }
      now = end;
    },
  };
}

function setup({ busy = () => false, runMs = 0 } = {}) {
  const clock = fakeClock();
  const calls = [];
  const done = [];
  let release = null;
  const s = createCoalescedSave({
    delayMs: 3000,
    busy,
    run: () => { calls.push(clock); return runMs ? new Promise((r) => { release = () => r(true); }) : Promise.resolve(true); },
    onDone: (ok) => done.push(ok),
    retryMs: 1000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { s, clock, calls, done, release: () => release?.() };
}

test('três pedidos seguidos: salva uma vez só, depois que param', async () => {
  const { s, clock, calls, done } = setup();
  s.request();
  await clock.advance(1000);
  s.request();
  await clock.advance(1000);
  s.request();
  await clock.advance(2900);
  assert.equal(calls.length, 0, 'ainda esperando os pedidos pararem');
  await clock.advance(200);
  assert.equal(calls.length, 1);
  assert.deepEqual(done, [true]);
  await clock.advance(10_000);
  assert.equal(calls.length, 1, 'não salva de novo sozinho');
});

test('pedido durante o salvamento: mais um salvamento no fim, com a letra mais nova', async () => {
  const { s, clock, calls, done, release } = setup({ runMs: 1 });
  s.request();
  await clock.advance(3000);
  assert.equal(calls.length, 1);
  s.request();
  s.request();
  release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(done, [], 'o primeiro não conta: chegou pedido novo no meio');
  await clock.advance(3000);
  assert.equal(calls.length, 2, 'um só a mais, mesmo com dois pedidos no meio');
  release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(done, [true]);
});

test('outro salvamento em andamento (⌘S da pessoa): espera terminar em vez de falhar', async () => {
  let busy = true;
  const { s, clock, calls, done } = setup({ busy: () => busy });
  s.request();
  await clock.advance(3000);
  await clock.advance(5000);
  assert.equal(calls.length, 0);
  busy = false;
  await clock.advance(1000);
  assert.equal(calls.length, 1);
  assert.deepEqual(done, [true]);
});

test('estilo da letra: só o que é de toda a letra, com os limites de sempre', () => {
  const s = normalizeLyricStyle({ ...DEFAULT_PROMPTER, fontScale: 1.4, lyricColor: '#ffd60a', lyricLead: 0.8, blackout: true });
  assert.deepEqual(Object.keys(s).sort(), ['fontScale', 'lyricAlign', 'lyricColor', 'lyricFont', 'lyricLead']);
  assert.equal(s.fontScale, 1.4);
  assert.equal(s.lyricLead, 0.8);
  assert.equal(normalizeLyricStyle({ fontScale: 9, lyricLead: -3 }).fontScale, 1.6);
  assert.equal(normalizeLyricStyle(null), null);
  assert.ok(sameLyricStyle(s, { ...s }));
  assert.ok(!sameLyricStyle(s, { ...s, lyricLead: 0.3 }));
  assert.deepEqual(lyricStyleOf(DEFAULT_PROMPTER).lyricLead, DEFAULT_PROMPTER.lyricLead);
});

test('rede local: o estilo do produtor sai com as letras e volta quando o projeto é aberto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-estilo-'));
  const make = () => new LocalServer({ webRoot: dir, storePath: path.join(dir, 'rede-local.json'), version: 't' });
  const srv = make();
  srv.prompter = { ...DEFAULT_PROMPTER, fontScale: 1.3, lyricLead: 0.9, blackout: true };
  assert.deepEqual(srv.lyricStyle(), { fontScale: 1.3, lyricColor: '#ffffff', lyricFont: 'inter', lyricAlign: 'center', lyricLead: 0.9 });
  // outro Mac, outro servidor: o projeto devolve o estilo sem mexer no resto da tela do palco
  const other = make();
  other.prompter = { ...DEFAULT_PROMPTER, blackout: true, mirror: true };
  assert.equal(other.applyLyricStyle({ fontScale: 1.2, lyricColor: '#ffd60a', lyricFont: 'inter', lyricAlign: 'left', lyricLead: 0.5, blackout: false }), true);
  assert.equal(other.prompter.fontScale, 1.2);
  assert.equal(other.prompter.lyricAlign, 'left');
  assert.equal(other.prompter.blackout, true, 'o resto fica como estava');
  assert.equal(other.prompter.mirror, true);
  assert.equal(make().prompter.lyricLead, 0.5, 'fica gravado no Mac');
  assert.equal(other.applyLyricStyle('x'), false);
});
