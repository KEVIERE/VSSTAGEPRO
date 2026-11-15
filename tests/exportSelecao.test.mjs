import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSongs, planExport, exportFilePath, exportRevealPath, songFolderNames } from '../src/lib/exportPlan.ts';

const songs = [
  { id: 'a', name: 'Alfa' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gama' },
];
const state = { songs, playlist: [], playlistOrder: ['c', 'a', 'b'] };

test('marcadas: ordem recebida, sem repetidas, ignora id que sumiu', () => {
  const r = exportSongs({ scope: 'musica', songIds: ['c', 'a', 'c', 'x'] }, state);
  assert.deepEqual(r.map((s) => s.id), ['c', 'a']);
});

test('songId antigo continua valendo quando songIds vem vazio', () => {
  assert.deepEqual(exportSongs({ scope: 'musica', songId: 'b' }, state).map((s) => s.id), ['b']);
  assert.deepEqual(exportSongs({ scope: 'musica', songIds: [], songId: 'b' }, state).map((s) => s.id), ['b']);
  assert.deepEqual(exportSongs({ scope: 'musica' }, state), []);
});

test('projeto inteiro segue a ordem do show', () => {
  assert.deepEqual(exportSongs({ scope: 'projeto' }, state).map((s) => s.id), ['c', 'a', 'b']);
});

test('uma musica marcada: igual ao comportamento antigo', () => {
  const lr = planExport('musica', 'lr', ['Alfa'], 'Meu Show');
  assert.equal(lr.multi, false);
  assert.deepEqual(lr.destination, { kind: 'file', name: 'Alfa - LR MASTER.wav' });
  assert.equal(exportRevealPath(lr, 'lr', 'Alfa - LR MASTER.wav'), 'Alfa - LR MASTER.wav');

  const mp = planExport('musica', 'multipista', ['Alfa'], 'Meu Show');
  assert.equal(mp.multi, false);
  assert.deepEqual(mp.destination, { kind: 'folder', title: 'Escolha onde salvar a multipista', zipName: 'Alfa - MULTIPISTA.zip' });
  assert.equal(exportFilePath(mp, 'Alfa', 'BAIXO.wav'), 'Alfa/BAIXO.wav');
});

test('duas ou mais marcadas: pasta por musica com nome proprio', () => {
  const plan = planExport('musica', 'lr', ['Alfa', 'Beta'], 'Meu Show');
  assert.equal(plan.multi, true);
  assert.deepEqual(plan.destination, {
    kind: 'folder', title: 'Escolha onde salvar as músicas', zipName: 'Meu Show - MÚSICAS SELECIONADAS - LR MASTER.zip',
  });
  assert.equal(plan.baseRel, 'Meu Show - MÚSICAS SELECIONADAS/');
  assert.equal(exportFilePath(plan, 'Beta', 'Beta - LR MASTER.wav'), 'Meu Show - MÚSICAS SELECIONADAS/Beta/Beta - LR MASTER.wav');
  assert.equal(exportRevealPath(plan, 'lr', ''), 'Meu Show - MÚSICAS SELECIONADAS');
});

test('show continuo: marcadas e projeto inteiro com nomes diferentes', () => {
  assert.deepEqual(planExport('musica', 'show-continuo', ['Alfa', 'Beta'], 'Meu Show').destination,
    { kind: 'file', name: 'Meu Show - MÚSICAS SELECIONADAS CONTÍNUO.wav' });
  assert.deepEqual(planExport('projeto', 'show-continuo', ['Alfa', 'Beta'], 'Meu Show').destination,
    { kind: 'file', name: 'Meu Show - SHOW COMPLETO CONTÍNUO.wav' });
});

test('projeto inteiro: nomes de antes', () => {
  const plan = planExport('projeto', 'multipista', ['Alfa'], 'Meu/Show');
  assert.equal(plan.multi, true);
  assert.deepEqual(plan.destination, { kind: 'folder', title: 'Escolha onde salvar o projeto', zipName: 'Meu_Show - MULTIPISTA.zip' });
  assert.equal(exportFilePath(plan, 'Alfa', 'BAIXO.wav'), 'Meu_Show/Alfa/BAIXO.wav');
});

test('pastas de musicas com o mesmo nome nao se sobrescrevem', () => {
  assert.deepEqual(songFolderNames([{ name: 'Hino' }, { name: 'hino' }, { name: 'Hino' }]), ['Hino', 'hino (2)', 'Hino (3)']);
});
