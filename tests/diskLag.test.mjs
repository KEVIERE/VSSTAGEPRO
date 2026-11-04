// Aviso de áudio atrasado do disco: atraso curto (a música ainda carregando) não avisa;
// só a faixa que fica sem áudio pelo tempo de espera inteiro aparece, numa etiqueta curta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISK_LAG_GRACE_MS, diskLagLabel, getDiskLag, lateClipIds, setDiskLag, subscribeDiskLag } from '../src/lib/diskLag.ts';

test('atraso curto não avisa; diz quando olhar de novo', () => {
  const since = new Map([['piano', 1000]]);
  const r = lateClipIds(since, 1000 + DISK_LAG_GRACE_MS - 500);
  assert.deepEqual(r.late, []);
  assert.equal(r.nextCheckIn, 500);
});

test('passou do tempo de espera: a faixa entra no aviso', () => {
  const since = new Map([['piano', 1000]]);
  const r = lateClipIds(since, 1000 + DISK_LAG_GRACE_MS);
  assert.deepEqual(r.late, ['piano']);
  assert.equal(r.nextCheckIn, null);
});

test('cada faixa conta o próprio tempo: a que atrasou agora ainda espera', () => {
  const since = new Map([['piano', 0], ['baixo', 3500]]);
  const r = lateClipIds(since, DISK_LAG_GRACE_MS);
  assert.deepEqual(r.late, ['piano']);
  assert.equal(r.nextCheckIn, 3500);
});

test('etiqueta curta: até dois nomes e "+N"', () => {
  assert.equal(diskLagLabel(['Piano 1']), 'Piano 1');
  assert.equal(diskLagLabel(['Piano 1', 'Baixo']), 'Piano 1, Baixo');
  assert.equal(diskLagLabel(['Piano 1', 'Baixo', 'Guitarra', 'Sanfona']), 'Piano 1, Baixo +2');
});

test('a tela só redesenha quando a lista muda', () => {
  let calls = 0;
  const off = subscribeDiskLag(() => { calls++; });
  setDiskLag(['Piano 1']);
  const first = getDiskLag();
  setDiskLag(['Piano 1']);
  assert.equal(getDiskLag(), first);
  setDiskLag([]);
  off();
  assert.equal(calls, 2);
  assert.deepEqual(getDiskLag(), []);
});
