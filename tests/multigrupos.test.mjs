// Multigrupos criados pela pessoa (Metais, Orquestra, Backs...): pasta igual às de fábrica, com
// canal no mixer, que fica só no projeto em que foi criada (dentro do .vss). Aqui roda o store de
// verdade no node (os '@/...' viram caminhos de src/), o roteamento por nome, o palpite da IA, o
// apagar com Desfazer e o salvar e reabrir pelo mesmo texto que vai para o arquivo.
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
// nada de disco do computador: um localStorage que só conta as gravações
const writes = [];
globalThis.localStorage = { getItem: () => null, setItem: (k, v) => { writes.push([k, v]); }, removeItem() {} };
globalThis.window ??= globalThis;

const { useStore, routableTrackIds } = await import(SRC + 'store.ts');
const { routeByName } = await import(SRC + 'lib/nameRouter.ts');
const ug = await import(SRC + 'lib/userGroups.ts');
const review = await import(SRC + 'lib/routeReview.ts');
const { manifestJson } = await import(SRC + 'lib/projectSaver.ts');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const st = () => useStore.getState();
const undo = () => useStore.temporal.getState().undo();

const clip = (id, fileName, extra = {}) => ({
  id, songId: 's1', trackId: 'track-outros', name: fileName.replace(/\.wav$/, ''), fileName, startTime: 0, duration: 10,
  color: '#fff', markers: [], routingMethod: 'name', routingConfidence: 1, waveformPeaks: [], ...extra,
});
const song = { id: 's1', name: 'Música', duration: 10, bpm: 120, key: 'C', timeSignature: '4/4', regions: [], color: '#fff' };

/** Projeto aberto do zero com estes áudios, já organizados pelo nome. */
function freshProject(files) {
  st().newProject();
  st().addSong(song);
  for (const [i, f] of files.entries()) st().addClip(clip(`c${i}`, f));
  st().reconcileTracks();
}
/** "Pasta/Trilha" de cada áudio, pelo nome do arquivo. */
function where() {
  const s = st();
  return Object.fromEntries(s.clips.map((c) => {
    const t = s.tracks.find((x) => x.id === c.trackId);
    return [c.fileName, t?.parentId ? `${t.parentId}/${t.name}` : t?.id];
  }));
}
const metais = () => ({ name: 'Metais', color: '#ff9f0a', words: ug.suggestWords('Metais') });
const backs = () => ({ name: 'Backs', color: '#bf5af2', words: ug.suggestWords('Backs') });

test('palavras sugeridas pelo nome do grupo (a pessoa edita a lista depois)', () => {
  for (const w of ['trompete', 'trombone', 'sax', 'saxofone', 'horn', 'brass']) assert.ok(ug.suggestWords('Metais').includes(w), `Metais: ${w}`);
  for (const nome of ['Orquestra', 'Cordas']) {
    for (const w of ['strings', 'violino', 'cello', 'violoncelo', 'orchestra', 'orq', 'cordas']) assert.ok(ug.suggestWords(nome).includes(w), `${nome}: ${w}`);
  }
  for (const nome of ['Backs', 'Coral']) {
    for (const w of ['back', 'backs', 'bv', 'coro', 'coral', 'choir']) assert.ok(ug.suggestWords(nome).includes(w), `${nome}: ${w}`);
  }
  // nome desconhecido: o próprio nome (e o singular)
  assert.deepEqual(ug.suggestWords('Pianos'), ['pianos', 'piano']);
  // palavras que puxavam arquivo de outro instrumento ficaram de fora
  assert.ok(!ug.suggestWords('Metais').includes('metal'), 'Metal Guitar não vai para Metais');
  assert.ok(!ug.suggestWords('Orquestra').includes('viola'), 'Viola Caipira não vai para Orquestra');
  assert.ok(!ug.suggestWords('Backs').includes('backing'), 'Backing Track não vai para Backs');
  assert.ok(!ug.suggestWords('Vozes').includes('voze'), 'sem singular estranho');
  assert.deepEqual(ug.parseWords('Trompete, TROMBONE;  sáx\ntrompete'), ['trompete', 'trombone', 'sax']);
});

test('roteamento por palavra: o grupo vence a pasta de fábrica, sem roubar Guia, Click e Maestro', () => {
  const groups = [
    { id: 'track-grupo-metais-a', name: 'Metais', color: '#f00', words: ug.suggestWords('Metais') },
    { id: 'track-grupo-backs-b', name: 'Backs', color: '#0f0', words: ug.suggestWords('Backs') },
  ];
  const at = (n) => { const r = routeByName(n, groups); return r && `${r.target}/${r.instrumentName}`; };
  assert.equal(at('Trompete 1.wav'), 'track-grupo-metais-a/Trompete');
  assert.equal(at('SAX.wav'), 'track-grupo-metais-a/Saxofone');
  assert.equal(at('Sax Solo.wav'), 'track-grupo-metais-a/Saxofone Solo');
  assert.equal(at('Back Vocal.wav'), 'track-grupo-backs-b/Backvocal');
  assert.equal(at('BV 2.wav')?.split('/')[0], 'track-grupo-backs-b');
  // Guia, Click e Maestro ditos no nome ficam com eles
  assert.equal(routeByName('Lead Vocal.wav', groups)?.target, 'track-guia');
  assert.equal(routeByName('Guia Backs.wav', groups)?.target, 'track-guia');
  assert.equal(routeByName('Click.wav', groups)?.target, 'track-click');
  // o que não tem palavra do grupo continua igual
  for (const n of ['Bateria.wav', 'Violão 1.wav', 'Teclado.wav', 'KEY CHANGE.wav', 'Audio 3.wav']) {
    assert.deepEqual(routeByName(n, groups), routeByName(n, []), n);
  }
  // sem grupos do projeto aberto, o roteamento de sempre (Trompete vai para Outros)
  assert.equal(routeByName('Trompete 1.wav')?.target, 'track-outros');
});

test('IA: palpite de instrumento do grupo vai para ele; voz principal fica na Guia', () => {
  const groups = [
    { id: 'track-grupo-metais-a', name: 'Metais', color: '#f00', words: ug.suggestWords('Metais') },
    { id: 'track-grupo-cordas-c', name: 'Cordas', color: '#00f', words: ug.suggestWords('Cordas') },
    { id: 'track-grupo-backs-b', name: 'Backs', color: '#0f0', words: ug.suggestWords('Backs') },
  ];
  const ai = (target, childName) => ug.aiToUserGroup({ target, childName, confidence: 0.7 }, groups).target;
  assert.equal(ai('track-outros', 'Trompete'), 'track-grupo-metais-a');
  assert.equal(ai('track-outros', 'Saxofone'), 'track-grupo-metais-a');
  assert.equal(ai('track-outros', 'Violino'), 'track-grupo-cordas-c');
  assert.equal(ai('track-outros', 'Backvocal'), 'track-grupo-backs-b');
  assert.equal(ai('track-guia', 'Guia'), 'track-guia');
  assert.equal(ai('track-click', 'Click'), 'track-click');
  assert.equal(ai('track-bateria', 'Bateria'), 'track-bateria');
  assert.equal(ug.aiToUserGroup({ target: 'track-outros', childName: 'Trompete', confidence: 1 }, []).target, 'track-outros');
  // a IA da importação usa os grupos do projeto aberto
  assert.match(read('../src/lib/aiRouter.ts'), /const mine = routeToUserGroup\(route\);[\s\S]*?return \{ route: mine,/);
});

test('criar: faixa mãe igual às fixas, canal no mixer antes de Outros, e reorganiza o que é dele', () => {
  freshProject(['Trompete 1.wav', 'Sax.wav', 'Bateria.wav', 'Lead Vocal.wav', 'Back Vocal.wav']);
  assert.equal(where()['Trompete 1.wav'], 'track-outros/Trompete 1');
  const id = st().createUserGroup(metais());
  const id2 = st().createUserGroup(backs());
  assert.ok(ug.isUserGroupId(id) && ug.isUserGroupId(id2));
  const mother = st().tracks.find((t) => t.id === id);
  assert.equal(mother.isSubgroup, true);
  assert.equal(mother.parentId, null);
  assert.equal(mother.name, 'Metais');
  assert.equal(mother.color, '#ff9f0a');
  for (const k of ['volume', 'mute', 'solo', 'outputChannel', 'meterLevel']) assert.ok(k in mother, k);
  const order = routableTrackIds(st().tracks);
  assert.ok(order.indexOf(id) > order.indexOf('track-solos') && order.indexOf(id) === order.indexOf('track-outros') - 2);
  assert.ok(order.indexOf(id2) > order.indexOf(id));
  const w = where();
  assert.equal(w['Trompete 1.wav'], `${id}/Trompete 1`);
  assert.equal(w['Sax.wav'], `${id}/Saxofone 1`);
  assert.equal(w['Back Vocal.wav'], `${id2}/Backvocal 1`);
  assert.equal(w['Bateria.wav'], 'track-bateria/Bateria 1');
  assert.equal(w['Lead Vocal.wav'], 'track-guia');
  // a importação (nameRouter sem lista) já enxerga os grupos do projeto aberto
  assert.equal(ug.activeUserGroups().length, 2);
  assert.equal(routeByName('Trombone.wav')?.target, id);
  // a janela Conferir faixas lista os grupos do projeto
  assert.ok(review.reviewTargets().includes(id));
  assert.equal(review.defaultChildFor(id), 'Metais');
});

test('mixer, timeline, Modo Show e Rede Local usam a lista com os grupos do projeto', () => {
  const mixer = read('../src/components/MixerPanel.tsx');
  assert.match(mixer, /routableTrackIds\(s\.tracks\)\.filter\(\(id\) => s\.tracks\.some\(\(t\) => t\.id === id && !t\.parentId\)\)/);
  assert.doesNotMatch(mixer, /ROUTABLE_TRACKS/);
  const tl = read('../src/components/TimelinePanel.tsx');
  assert.doesNotMatch(tl, /ROUTABLE_TRACKS/);
  assert.match(tl, /\{routableTrackIds\(tracks\)\.map\(\(id\) =>/);
  assert.doesNotMatch(read('../src/lib/remoteHost.ts'), /ROUTABLE_TRACKS/);
  assert.doesNotMatch(read('../src/components/ContextMenu.tsx'), /ROUTABLE_TRACKS/);
  // criar pelo menu Editar e pelo botão direito no espaço vazio; editar pela faixa mãe
  assert.match(read('../src/components/MenuBar.tsx'), /label: 'Novo multigrupo\.\.\.'/);
  assert.match(tl, /Novo multigrupo\.\.\./);
  assert.match(read('../src/components/TrackContextMenu.tsx'), /Editar multigrupo\.\.\./);
  assert.match(read('../src/App.tsx'), /<UserGroupDialog \/>/);
});

test('editar: nome, cor e palavras; palavra nova puxa o áudio', () => {
  freshProject(['Trompete 1.wav', 'Flugel.wav']);
  const id = st().createUserGroup(metais());
  assert.equal(where()['Flugel.wav'].split('/')[0], 'track-outros');
  st().updateUserGroup(id, { name: 'Sopros', color: '#30d158', words: [...ug.suggestWords('Metais'), 'flugel'] });
  const g = st().userGroups.find((x) => x.id === id);
  assert.equal(g.name, 'Sopros');
  assert.equal(st().tracks.find((t) => t.id === id).name, 'Sopros');
  assert.equal(st().tracks.find((t) => t.id === id).color, '#30d158');
  assert.equal(where()['Flugel.wav'].split('/')[0], id);
});

test('apagar: as filhas voltam para onde o roteamento normal mandaria, num passo de Desfazer', () => {
  freshProject(['Trompete 1.wav', 'Sax.wav', 'Audio 3.wav', 'Bateria.wav']);
  const id = st().createUserGroup(metais());
  // áudio sem nome de instrumento que a IA mandou para o grupo (Trompete)
  st().routeClip('c2', id, 'Trompete');
  st().updateClip('c2', { routingMethod: 'ai', routingConfidence: 0.7 });
  const before = where();
  assert.equal(before['Audio 3.wav'].split('/')[0], id);
  const stateBefore = { tracks: st().tracks, clips: st().clips, userGroups: st().userGroups };

  st().deleteUserGroup(id);
  const after = where();
  assert.equal(st().tracks.some((t) => t.id === id || t.parentId === id), false, 'nem a mãe nem as filhas ficam');
  assert.equal(st().userGroups.length, 0);
  assert.equal(ug.activeUserGroups().length, 0);
  assert.equal(after['Trompete 1.wav'].split('/')[0], 'track-outros');
  assert.equal(after['Sax.wav'], 'track-outros/Saxofone 1');
  assert.equal(after['Audio 3.wav'].split('/')[0], 'track-outros', 'o da IA vai para a pasta de fábrica do instrumento');
  assert.equal(after['Bateria.wav'], 'track-bateria/Bateria 1');

  undo();
  assert.deepEqual(where(), before);
  assert.equal(st().tracks, stateBefore.tracks);
  assert.equal(st().userGroups, stateBefore.userGroups);
  assert.equal(ug.activeUserGroups().length, 1, 'o Desfazer devolve o grupo ao roteamento');
});

test('salvar e reabrir o .vss traz os grupos; outro projeto e projeto novo não têm', () => {
  freshProject(['Trompete 1.wav', 'Violino.wav']);
  const id = st().createUserGroup(metais());
  const cordas = st().createUserGroup({ name: 'Orquestra', color: '#64d2ff', words: ug.suggestWords('Orquestra') });
  const json = manifestJson(st(), 'Culto', []);
  const saved = JSON.parse(json);
  assert.deepEqual(saved.userGroups.map((g) => g.name), ['Metais', 'Orquestra']);
  assert.ok(saved.userGroups[0].words.includes('trompete'));
  assert.ok(saved.tracks.some((t) => t.id === id && t.isSubgroup));
  assert.ok(saved.tracks.some((t) => t.parentId === cordas));

  // projeto novo: só os de fábrica
  st().newProject();
  assert.deepEqual(st().userGroups, []);
  assert.equal(st().tracks.some((t) => ug.isUserGroupId(t.id)), false);
  assert.equal(ug.activeUserGroups().length, 0);
  assert.equal(routeByName('Trompete 1.wav')?.target, 'track-outros');

  // reabrindo (em outro computador é o mesmo arquivo): tudo igual
  st().loadProject(JSON.parse(json));
  assert.deepEqual(st().userGroups, saved.userGroups);
  assert.equal(where()['Trompete 1.wav'], `${id}/Trompete 1`);
  assert.equal(where()['Violino.wav'].split('/')[0], cordas);
  assert.equal(routeByName('Trombone.wav')?.target, id, 'importação nesse projeto vai para o grupo');
  assert.ok(routableTrackIds(st().tracks).includes(cordas));

  // outro projeto (sem grupos): some tudo
  const other = JSON.parse(json);
  delete other.userGroups;
  other.tracks = other.tracks.filter((t) => !ug.isUserGroupId(t.id) && !ug.isUserGroupId(t.parentId ?? ''));
  other.clips = [];
  st().loadProject(other);
  assert.deepEqual(st().userGroups, []);
  assert.equal(ug.activeUserGroups().length, 0);

  // nada foi gravado no computador fora do projeto
  assert.deepEqual(writes.filter(([k, v]) => /grupo/i.test(k) || /track-grupo-/.test(String(v))), []);
});

test('projeto sem multigrupo sai igual ao de antes e projeto antigo abre igual', () => {
  freshProject(['Bateria.wav', 'Trompete.wav']);
  const json = manifestJson(st(), 'Antigo', []);
  assert.equal('userGroups' in JSON.parse(json), false, 'sem a chave nova no arquivo');
  const old = JSON.parse(json);
  st().loadProject(old);
  assert.deepEqual(st().userGroups, []);
  assert.deepEqual(st().tracks.map((t) => t.id), old.tracks.map((t) => t.id));
  assert.equal(where()['Trompete.wav'].split('/')[0], 'track-outros');
  // arquivo mexido à mão: faixa de grupo sem cadastro ganha o cadastro pelo nome
  const hand = JSON.parse(json);
  hand.tracks.push({ ...hand.tracks.find((t) => t.id === 'track-outros'), id: 'track-grupo-metais-zz', name: 'Metais', children: [] });
  st().loadProject(hand);
  assert.equal(st().userGroups[0]?.id, 'track-grupo-metais-zz');
  assert.ok(st().userGroups[0].words.includes('trompete'));
});

test('conferência: escolha para um multigrupo não é aprendida no computador', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(review.learnRoute('HELLAN.wav', 'Culto', { target: 'track-grupo-metais-a', childName: 'Trompete', solo: false }, storage), null);
  assert.equal(mem.size, 0);
  assert.ok(review.learnRoute('HELLAN.wav', 'Culto', { target: 'track-teclados', childName: 'Teclado', solo: false }, storage));
  // aprendido antigo apontando para grupo (versão de teste) é ignorado
  mem.set([...mem.keys()][0], JSON.stringify({ entries: [{ key: 'hellan', target: 'track-grupo-x-1', childName: 'X', solo: false, at: 1 }] }));
  assert.deepEqual(review.loadLearned(storage), []);
});
