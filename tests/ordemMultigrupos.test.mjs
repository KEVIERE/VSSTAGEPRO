// Ordem das faixas de topo (multigrupos de fábrica e da pessoa): o multigrupo criado entra logo
// antes de Outros, e arrastar a faixa mãe na timeline muda a ordem em todo o programa (timeline,
// mixer, Modo Show, Rede Local), com Desfazer num passo e salva no .vss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) {
    try { return await next(SRC + spec.slice(2) + '.ts', ctx); } catch { return next(SRC + spec.slice(2) + '.tsx', ctx); }
  }
  return next(spec, ctx);
}
`));
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window ??= globalThis;

const { useStore, routableTrackIds } = await import(SRC + 'store.ts');
const ug = await import(SRC + 'lib/userGroups.ts');
const review = await import(SRC + 'lib/routeReview.ts');
const { manifestJson } = await import(SRC + 'lib/projectSaver.ts');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const st = () => useStore.getState();
const undo = () => useStore.temporal.getState().undo();
const redo = () => useStore.temporal.getState().redo();
const song = { id: 's1', name: 'Música', duration: 10, bpm: 120, key: 'C', timeSignature: '4/4', regions: [], color: '#fff' };
const clip = (id, fileName) => ({
  id, songId: 's1', trackId: 'track-outros', name: fileName.replace(/\.wav$/, ''), fileName, startTime: 0, duration: 10,
  color: '#fff', markers: [], routingMethod: 'name', routingConfidence: 1, waveformPeaks: [],
});
function freshProject(files = []) {
  st().newProject();
  st().addSong(song);
  for (const [i, f] of files.entries()) st().addClip(clip(`c${i}`, f));
  st().reconcileTracks();
}
/** A lista de topo como está na tela (só as que existem). */
const shown = () => routableTrackIds(st().tracks).filter((id) => st().tracks.some((t) => t.id === id && !t.parentId));
const metais = () => ({ name: 'Metais', color: '#ff9f0a', words: ug.suggestWords('Metais') });
const backs = () => ({ name: 'Backs', color: '#bf5af2', words: ug.suggestWords('Backs') });

test('ordem padrão: o multigrupo criado entra logo antes de Outros (depois de Solos)', () => {
  freshProject(['Trompete.wav']);
  assert.deepEqual(routableTrackIds(st().tracks), ug.FIXED_ROUTABLE_TRACKS, 'sem grupo: a ordem de fábrica');
  const a = st().createUserGroup(metais());
  const b = st().createUserGroup(backs());
  const o = routableTrackIds(st().tracks);
  assert.deepEqual(o.slice(-4), ['track-solos', a, b, 'track-outros']);
  assert.deepEqual(o.filter((id) => !ug.isUserGroupId(id)), ug.FIXED_ROUTABLE_TRACKS, 'as de fábrica não mudam de lugar');
  // a janela Conferir faixas também mostra o grupo logo antes de Outros
  const r = review.reviewTargets();
  assert.deepEqual(r.slice(-4), ['track-solos', a, b, 'track-outros']);
});

test('arrastar para cima e para baixo muda a ordem; Desfazer volta num passo', () => {
  freshProject(['Trompete.wav', 'Bateria.wav']);
  const a = st().createUserGroup(metais());
  const before = shown();
  const tracksBefore = st().tracks;
  // Metais para o topo (antes da Guia)
  st().reorderTopTrack(a, 0);
  assert.equal(shown()[0], a);
  assert.deepEqual(shown().slice(1), before.filter((id) => id !== a));
  // Bateria desce para depois de Teclados
  const now = shown();
  st().reorderTopTrack('track-bateria', now.indexOf('track-teclados') + 1);
  const after = shown();
  assert.equal(after[after.indexOf('track-teclados') + 1], 'track-bateria');
  // soltar no mesmo lugar não muda nada (nem entra no Desfazer)
  const same = st().tracks;
  st().reorderTopTrack('track-bateria', after.indexOf('track-bateria'));
  assert.equal(st().tracks, same);
  undo();
  assert.deepEqual(shown(), now, 'o Desfazer volta só o último arraste');
  undo();
  assert.deepEqual(shown(), before);
  assert.deepEqual(st().tracks.map((t) => [t.id, t.topOrder]), tracksBefore.map((t) => [t.id, t.topOrder]));
  redo();
  assert.equal(shown()[0], a);
  // a pasta vai com as de dentro: as filhas continuam nela
  assert.ok(st().tracks.find((t) => t.id === a).children.length > 0);
});

test('multigrupo criado depois de mexer na ordem entra antes de Outros', () => {
  freshProject();
  st().reorderTopTrack('track-outros', 0);
  st().reorderTopTrack('track-guia', shown().length);
  const b = st().createUserGroup(backs());
  const o = shown();
  assert.equal(o[0], b, 'Outros foi para o topo: o grupo novo entra logo antes dele');
  assert.equal(o[1], 'track-outros');
  assert.equal(o[o.length - 1], 'track-guia');
  // e apagar o grupo não mexe no resto
  st().deleteUserGroup(b);
  assert.equal(shown()[0], 'track-outros');
});

test('salvar e reabrir mantém a ordem; projeto novo, outro projeto e projeto antigo na ordem padrão', () => {
  freshProject(['Trompete.wav']);
  const a = st().createUserGroup(metais());
  st().reorderTopTrack(a, 1);
  st().reorderTopTrack('track-click', shown().length);
  const mine = shown();
  const json = manifestJson(st(), 'Culto', []);
  st().newProject();
  assert.deepEqual(routableTrackIds(st().tracks), ug.FIXED_ROUTABLE_TRACKS, 'projeto novo: ordem padrão');
  st().loadProject(JSON.parse(json));
  assert.deepEqual(shown(), mine, 'reaberto na ordem arrumada');
  // projeto antigo (sem a posição nas faixas): ordem de sempre
  const old = JSON.parse(json);
  old.tracks = old.tracks.map(({ topOrder, ...t }) => t);
  st().loadProject(old);
  assert.equal(st().tracks.some((t) => 'topOrder' in t), false);
  assert.deepEqual(routableTrackIds(st().tracks).slice(-3), ['track-solos', a, 'track-outros']);
  // outro projeto sem grupos nem ordem
  const other = JSON.parse(json);
  delete other.userGroups;
  other.tracks = other.tracks.filter((t) => !ug.isUserGroupId(t.id) && !ug.isUserGroupId(t.parentId ?? '')).map(({ topOrder, ...t }) => t);
  other.clips = [];
  st().loadProject(other);
  assert.deepEqual(routableTrackIds(st().tracks), ug.FIXED_ROUTABLE_TRACKS);
});

test('ordem com posição estragada no arquivo é ignorada; pasta de fábrica sem posição fica perto da vizinha', () => {
  const tracks = ug.FIXED_ROUTABLE_TRACKS.map((id, i) => ({ id, parentId: null, topOrder: ug.FIXED_ROUTABLE_TRACKS.length - i }));
  // tudo invertido
  assert.deepEqual(routableTrackIds(tracks), [...ug.FIXED_ROUTABLE_TRACKS].reverse());
  const bad = ug.FIXED_ROUTABLE_TRACKS.map((id) => ({ id, parentId: null, topOrder: 'x' }));
  assert.deepEqual(routableTrackIds(bad), ug.FIXED_ROUTABLE_TRACKS);
  const partial = ug.FIXED_ROUTABLE_TRACKS.map((id, i) => ({ id, parentId: null, ...(id === 'track-bateria' ? {} : { topOrder: i }) }));
  assert.deepEqual(routableTrackIds(partial), ug.FIXED_ROUTABLE_TRACKS);
});

test('timeline: faixa de topo arrastável pela mãe, filhas continuam arrastáveis; mixer e Rede Local seguem a ordem', () => {
  const tl = read('../src/components/TimelinePanel.tsx');
  assert.match(tl, /\{routableTrackIds\(tracks\)\.map\(\(id\) =>/);
  assert.match(tl, /data-top-row=\{track\.id\}/);
  assert.match(tl, /reorderTopTrack\(trackId, slot\)/);
  assert.match(tl, /onTopReorderStart=\{startTopReorder\}/);
  // as filhas: o arrastar de sempre, na lista da pasta
  assert.match(tl, /if \(active && slot >= 0\) reorderChildTrack\(childId, slot\);/);
  assert.match(tl, /onReorderStart=\{startReorder\}/);
  assert.match(tl, /:scope > \[data-child-row\]/);
  // fader, knob e teclas M e S não pegam a faixa
  assert.match(tl, /if \(el !== e\.currentTarget && !el\.closest\('\[data-reorder-grip\]'\)\) return;/);
  assert.match(read('../src/components/MixerPanel.tsx'), /routableTrackIds\(s\.tracks\)/);
  assert.match(read('../src/lib/remoteHost.ts'), /routableTrackIds\(st\.tracks\)/);
  // filha arrastada no store continua funcionando
  freshProject(['Bateria Kick.wav', 'Bateria Caixa.wav']);
  const kids = st().tracks.find((t) => t.id === 'track-bateria').children;
  assert.ok(kids.length >= 2);
  st().reorderChildTrack(kids[1], 0);
  assert.deepEqual(st().tracks.find((t) => t.id === 'track-bateria').children, [kids[1], kids[0], ...kids.slice(2)]);
});
