// Conferência das faixas na importação e o aprendizado das escolhas: certeza de cada áudio,
// janela só com os incertos, solo, renomear, um passo só no Desfazer, o que fica guardado e a
// ordem de quem decide (nome explícito > aprendido > IA).
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aiCertainty, routeCertainty, tallyVotes, loudestWindow, learnedKey, learnRoute, loadLearned, forgetLearned,
  clearLearned, matchLearned, routeByLearned, decideBeforeAi, itemsToReview, finalDestination, applyReview,
  initialChoice, LEARNED_STORAGE_KEY, ambiguousLearnKeys, keepsPersonRoute, sharedSongWords,
} from '../src/lib/routeReview.ts';
import { secondYamnetRoute, routeByYamnetScores } from '../src/lib/yamnetCategories.ts';
import { routeByName } from '../src/lib/nameRouter.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const g = (target, childName, confidence) => ({ target, childName, confidence });

// ---------------------------------------------------------------- certeza

test('certeza alta: nome que diz o instrumento, nome aprendido ou IA bem segura', () => {
  assert.equal(routeCertainty({ byName: true, learned: false, ai: null }), 'high');
  assert.equal(routeCertainty({ byName: false, learned: true, ai: null }), 'high');
  assert.equal(aiCertainty(g('track-contrabaixo', 'Contrabaixo', 0.56), g('track-violoes', 'Violão', 0.31)), 'high');
  assert.equal(aiCertainty(g('track-sanfonas', 'Sanfona', 0.47), g('track-outros', 'Violino', 0.03)), 'high');
  assert.equal(aiCertainty(g('track-teclados', 'Piano', 0.2), null), 'high');
});

test('certeza baixa: nome não diz e a IA ficou em dúvida (ou não reconheceu)', () => {
  assert.equal(routeCertainty({ byName: false, learned: false, ai: null }), 'low');
  // 1º e 2º palpites perto um do outro
  assert.equal(aiCertainty(g('track-violoes', 'Violão', 0.32), g('track-guitarras', 'Guitarra', 0.28)), 'low');
  // nota baixa demais
  assert.equal(aiCertainty(g('track-guia', 'Guia', 0.07), null), 'low');
});

// ---------------------------------------------------------------- palpites da IA

test('o 2º palpite é o som mais forte seguinte em outra faixa', () => {
  const scores = [
    { className: 'Music', probability: 0.89 }, { className: 'Bass guitar', probability: 0.56 },
    { className: 'Guitar', probability: 0.32 }, { className: 'Plucked string instrument', probability: 0.31 },
  ];
  const first = routeByYamnetScores(scores);
  assert.equal(first.target, 'track-contrabaixo');
  const second = secondYamnetRoute(scores, first);
  assert.equal(second.target, 'track-violoes');
  assert.equal(second.confidence, 0.32);
  // bloco com música junto aparece como Percussões, igual ao 1º palpite
  const s2 = secondYamnetRoute([{ className: 'Music', probability: 0.8 }, { className: 'Accordion', probability: 0.4 }, { className: 'Wood block', probability: 0.2 }], { target: 'track-sanfonas' });
  assert.equal(s2.target, 'track-percussoes');
});

test('a votação decide igual a antes e devolve o 1º e o 2º palpites', () => {
  const r = (target, childName, confidence, second = null) => ({ target, childName, confidence, yamnetClass: '', second });
  // 2 votos para violão: decide violão
  let t = tallyVotes([r('track-violoes', 'Violão', 0.3), r('track-guitarras', 'Guitarra', 0.4), r('track-violoes', 'Violão', 0.2)], 3);
  assert.equal(t.route.target, 'track-violoes');
  assert.equal(t.route.confidence, 0.3);
  assert.deepEqual(t.guesses.map((x) => x.target), ['track-violoes', 'track-guitarras']);
  // um voto de cada: nenhuma decisão (como antes), mas os palpites aparecem
  t = tallyVotes([r('track-violoes', 'Violão', 0.3), r('track-guitarras', 'Guitarra', 0.4), null], 3);
  assert.equal(t.route, null);
  assert.deepEqual(t.guesses.map((x) => x.target), ['track-guitarras', 'track-violoes']);
  // um trecho só: decide com 1 voto (como antes)
  t = tallyVotes([r('track-teclados', 'Piano', 0.2, g('track-outros', 'Cordas', 0.1))], 1);
  assert.equal(t.route.target, 'track-teclados');
  assert.deepEqual(t.guesses.map((x) => x.target), ['track-teclados', 'track-outros']);
  // nenhum trecho decidiu: a pista do som mais forte aparece como palpite
  t = tallyVotes([null, null], 2, [g('track-guia', 'Guia', 0.04), g('track-maestro', 'Maestro', 0.2)]);
  assert.equal(t.route, null);
  assert.deepEqual(t.guesses.map((x) => x.target), ['track-maestro', 'track-guia']);
});

test('aiRouter devolve os palpites sem mudar a decisão e o click passa pelo metronomeCheck', () => {
  const ai = src('src/lib/aiRouter.ts');
  assert.match(ai, /export async function classifyByVote\(src: VoteSource, key: string\): Promise<AiRouteResult \| null> \{[^}]*return \(await classifyByVoteDetailed\(src, key, \{ escuta: false \}\)\)\.route;/);
  assert.match(ai, /const route = clickChecked\(best, src\);/);
  assert.match(ai, /fixClickGuesses/);
});

// ---------------------------------------------------------------- trecho para ouvir

test('o trecho para ouvir é o mais forte, não o silêncio do começo', () => {
  const sr = 1000;
  const data = new Float32Array(60 * sr);
  for (let i = 30 * sr; i < 40 * sr; i++) data[i] = Math.sin(i / 3) * 0.8;
  const at = loudestWindow({ length: data.length, sampleRate: sr, channels: 1, sample: (_c, i) => data[i] }, 8);
  assert.ok(at >= 29.5 && at <= 32.5, `começou em ${at}`);
  // áudio mais curto que o trecho: do começo
  assert.equal(loudestWindow({ length: 5 * sr, sampleRate: sr, channels: 1, sample: () => 0.5 }, 8), 0);
});

// ---------------------------------------------------------------- janela

const item = (over = {}) => ({
  clipId: 'c1', songId: 's1', songName: 'Fiquei Sabendo', fileName: 'HELLAN 03.wav', clipName: 'HELLAN 03',
  current: 'track-outros', currentChild: 'Extra', certainty: 'low',
  guesses: [g('track-teclados', 'Piano', 0.2), g('track-guitarras', 'Guitarra', 0.18)], ...over,
});

test('a janela lista só os áudios de certeza baixa', () => {
  const list = itemsToReview([item(), item({ clipId: 'c2', certainty: 'high' }), item({ clipId: 'c3' })]);
  assert.deepEqual(list.map((i) => i.clipId), ['c1', 'c3']);
  assert.deepEqual(itemsToReview([item({ certainty: 'high' })]), []);
  const actions = src('src/lib/routeReviewActions.ts');
  assert.match(actions, /if \(opts\.onlyLow && items\.length === 0\) return false;/);
  assert.match(src('src/lib/importManager.ts'), /openRouteReview\([\s\S]*?\{ onlyLow: true \}\)/);
});

test('"É solo" manda para Solos com o nome do instrumento', () => {
  const d = finalDestination(item(), { clipId: 'c1', target: 'track-guitarras', solo: true });
  assert.deepEqual([d.target, d.childName], ['track-solos', 'Guitarra Solo']);
  // a faixa escolhida usa o nome do palpite da IA para ela
  assert.equal(finalDestination(item(), { clipId: 'c1', target: 'track-teclados', solo: false }).childName, 'Piano');
  // Guia, Click e Maestro não têm solo
  assert.equal(finalDestination(item(), { clipId: 'c1', target: 'track-guia', solo: true }).target, 'track-guia');
});

function fakeApi() {
  const log = [];
  return {
    log,
    beginUndoStep: () => log.push('begin'),
    endUndoStep: () => log.push('end'),
    routeClip: (id, target, child) => log.push(`route ${id} ${target} ${child}`),
    renameClip: (id, name) => log.push(`rename ${id} ${name}`),
    learn: (file, song, c) => log.push(`learn ${file} ${c.target} ${c.childName} ${c.solo}`),
  };
}

test('Confirmar aplica tudo num passo só de Desfazer, com solo e nome novo', () => {
  const api = fakeApi();
  const items = [item(), item({ clipId: 'c2', fileName: 'GTR LEAD.wav', clipName: 'Guitarra 1', current: 'track-guitarras', currentChild: 'Guitarra' })];
  const n = applyReview(api, items, [
    { clipId: 'c1', target: 'track-teclados', solo: false, rename: 'Hellan' },
    { clipId: 'c2', target: 'track-guitarras', solo: true, rename: '' },
  ]);
  assert.equal(n, 2);
  assert.equal(api.log[0], 'begin');
  assert.equal(api.log.at(-1), 'end');
  assert.equal(api.log.filter((l) => l === 'begin').length, 1);
  assert.ok(api.log.includes('route c1 track-teclados Piano'));
  assert.ok(api.log.includes('rename c1 Hellan'));
  assert.ok(api.log.includes('route c2 track-solos Guitarra Solo'));
  assert.ok(api.log.includes('learn GTR LEAD.wav track-guitarras Guitarra true'));
  // quem fica onde estava não muda de faixa nem de nome
  const api2 = fakeApi();
  assert.equal(applyReview(api2, [item()], [initialChoice(item())]), 0);
  assert.ok(!api2.log.some((l) => l.startsWith('route') || l.startsWith('rename')));
  // o passo do Desfazer é o mesmo do arrasto (undoGestures) e Pular não aprende nada
  const actions = src('src/lib/routeReviewActions.ts');
  assert.match(actions, /beginUndoStep: beginGesture,\s*endUndoStep: endGesture/);
  assert.match(actions, /export function skipRouteReview\(\): void \{\s*closeRouteReview\(\);\s*\}/);
});

test('fechar a janela ou tocar outro áudio para o trecho que está tocando', () => {
  const actions = src('src/lib/routeReviewActions.ts');
  assert.match(actions, /export function closeRouteReview\(\): void \{\s*stopReviewPreview\(\);/);
  assert.match(actions, /export async function playReviewPreview\(item: ReviewItem\): Promise<boolean> \{\s*stopReviewPreview\(\);/);
  const dialog = src('src/components/RouteReviewDialog.tsx');
  assert.match(dialog, /Conferir faixas/);
  assert.match(dialog, /É solo/);
  assert.match(dialog, /Pular/);
  assert.match(dialog, /Confirmar/);
});

test('a janela também abre pelo menu Editar e pelo botão direito do clipe', () => {
  assert.match(src('src/components/ContextMenu.tsx'), /Conferir faixas desta música/);
  assert.match(src('src/components/MenuBar.tsx'), /Conferir Faixas desta Música/);
  assert.match(src('src/App.tsx'), /<RouteReviewDialog \/>/);
});

// ---------------------------------------------------------------- aprendizado

test('guarda só a parte útil do nome', () => {
  assert.equal(learnedKey('HELLAN - Fiquei Sabendo VS 03.wav', 'Fiquei Sabendo'), 'HELLAN');
  assert.equal(learnedKey('GTR LEAD 02.wav', 'Outra'), 'GTR LEAD');
  assert.equal(learnedKey('Fiquei_Sabendo_VS_Audio_7.wav', 'Fiquei Sabendo'), null);
  assert.equal(learnedKey('03 - 128 BPM - L.wav'), null);
  assert.equal(learnedKey('Órgão Solo.wav'), 'ORGAO');
});

test('aprende, encontra na próxima importação e dá para apagar', () => {
  const st = memory();
  const e = learnRoute('HELLAN - Fiquei Sabendo VS 03.wav', 'Fiquei Sabendo', { target: 'track-teclados', childName: 'Teclado', solo: false }, st, 10);
  assert.equal(e.key, 'HELLAN');
  learnRoute('GTR LEAD.wav', 'X', { target: 'track-guitarras', childName: 'Guitarra', solo: true }, st, 11);
  assert.equal(loadLearned(st).length, 2);
  assert.ok(st.m.has(LEARNED_STORAGE_KEY));
  // outra música, outro número: o mesmo nome vai direto para a faixa escolhida
  assert.deepEqual(routeByLearned(['hellan_Outra Musica 12.wav'], loadLearned(st)), { target: 'track-teclados', instrumentName: 'Teclado', key: 'HELLAN' });
  assert.deepEqual(routeByLearned(['01 Gtr Lead VS.wav'], loadLearned(st)), { target: 'track-solos', instrumentName: 'Guitarra Solo', key: 'GTR LEAD' });
  // palavra só dentro de outra não conta
  assert.equal(matchLearned(loadLearned(st), ['SHELLANDO.wav']), null);
  // aprender de novo troca a escolha
  learnRoute('HELLAN 2.wav', '', { target: 'track-sanfonas', childName: 'Sanfona', solo: false }, st, 12);
  assert.equal(loadLearned(st).length, 2);
  assert.equal(routeByLearned(['HELLAN.wav'], loadLearned(st)).target, 'track-sanfonas');
  forgetLearned('HELLAN', st);
  assert.equal(routeByLearned(['HELLAN.wav'], loadLearned(st)), null);
  clearLearned(st);
  assert.deepEqual(loadLearned(st), []);
  // guardado estragado não derruba a importação
  st.setItem(LEARNED_STORAGE_KEY, '{nao e json');
  assert.deepEqual(loadLearned(st), []);
  assert.match(src('src/components/RouteReviewDialog.tsx'), /Esquecer tudo/);
});

test('prioridade: nome de instrumento explícito > aprendido > abreviação fraca > IA', () => {
  const learned = { target: 'track-solos', instrumentName: 'Guitarra Solo', key: 'GTR LEAD' };
  // "Guitarra" é nome explícito: o aprendido não passa por cima
  const strong = routeByName('Guitarra GTR LEAD.wav');
  assert.equal(decideBeforeAi(strong, learned).kind, 'name');
  // "GTR" é abreviação: o que a pessoa ensinou vale mais
  const weak = routeByName('GTR LEAD.wav');
  assert.ok(weak && weak.confidence < 1);
  assert.equal(decideBeforeAi(weak, learned).kind, 'learned');
  // sem aprendido, a abreviação continua decidindo como hoje
  assert.equal(decideBeforeAi(weak, null).kind, 'name');
  // sem nome, o aprendido vem antes da IA; sem nada, a IA ouve
  assert.equal(decideBeforeAi(null, learned).kind, 'learned');
  assert.equal(decideBeforeAi(null, null), null);
});

test('na importação, nome reconhecido continua igual e click aprendido só vai para o Click se for metrônomo', () => {
  const im = src('src/lib/importManager.ts');
  assert.match(im, /hit\?\.target === 'track-click' && !looksLikeMetronome\(clipVoteSource\(entry\.audio\)\)\) return null;/);
  assert.match(im, /routeCertainty\(\{ byName: !!route, learned: !!learned/);
  // a IA só ouve quem nem o nome nem o aprendizado decidiram
  assert.match(im, /const unnamed = decodedEntries\.filter\(\(e\): e is DecodedEntry => !!e && !decisions\.get\(e\.index\)\);/);
});

// ---------------------------------------------------------------- correções da revisão

test('Confirmar só aprende o que a pessoa mudou ou ouviu; Outros sem mexer não vira regra', () => {
  const api = fakeApi();
  const items = [
    item({ clipId: 'a', fileName: 'PADS.wav', current: 'track-teclados', currentChild: 'Teclado' }),
    item({ clipId: 'b', fileName: 'ZUMBIDO.wav', current: 'track-outros', currentChild: 'Extra' }),
    item({ clipId: 'c', fileName: 'TROMPA.wav', current: 'track-outros', currentChild: 'Extra' }),
    item({ clipId: 'd', fileName: 'BALAFON.wav', current: 'track-percussoes', currentChild: 'Percussão' }),
  ];
  const locked = [];
  api.lockClip = (id) => locked.push(id);
  applyReview(api, items, [
    initialChoice(items[0]), // ninguém mexeu nem ouviu
    initialChoice(items[1]), // ouviu e deixou em Outros
    { clipId: 'c', target: 'track-teclados', solo: false }, // mudou
    initialChoice(items[3]), // ouviu e deixou onde estava
  ], { heard: new Set(['b', 'd']) });
  const learned = api.log.filter((l) => l.startsWith('learn'));
  assert.deepEqual(learned, ['learn TROMPA.wav track-teclados Piano false', 'learn BALAFON.wav track-percussoes Percussão false']);
  assert.deepEqual(locked.sort(), ['b', 'c', 'd'], 'a reorganização não mexe no que a pessoa decidiu');
  // sem nada ouvido nem mudado (menu "Conferir Faixas desta Música" e Confirmar direto): não aprende nada
  const api2 = fakeApi();
  applyReview(api2, items, items.map(initialChoice));
  assert.ok(!api2.log.some((l) => l.startsWith('learn')));
});

test('palavra em vários stems da música com destinos diferentes não é aprendida', () => {
  const st = memory();
  const song = 'Fiquei Sabendo';
  const items = ['01', '02', '03'].map((n) => item({ clipId: n, fileName: `HELLAN - Fiquei Sabendo VS ${n}.wav`, songName: song }));
  const api = { ...fakeApi(), learn: (f, sn, c) => learnRoute(f, sn, c, st, 1) };
  applyReview(api, items, [
    { clipId: '01', target: 'track-teclados', solo: false },
    { clipId: '02', target: 'track-guitarras', solo: false },
    { clipId: '03', target: 'track-outros', solo: false },
  ]);
  assert.deepEqual(loadLearned(st), [], 'HELLAN não manda em todos');
  assert.equal(routeByLearned(['HELLAN - Outra VS 05.wav'], loadLearned(st)), null);
  // a marca do vendedor em todos os stems, só um conferido: não aprende
  const sib = (id, f) => ({ songId: 's1', songName: song, fileName: f, clipId: id });
  const siblings = [sib('x', '01 - CLUBE DO VS.mp3'), sib('y', '02 - CLUBE DO VS.mp3')];
  assert.ok(ambiguousLearnKeys([{ clipId: 'x', songId: 's1', songName: song, fileName: '01 - CLUBE DO VS.mp3', dest: 'track-teclados|teclado|0' }], siblings).has('CLUBE'));
  // todos conferidos para o mesmo lugar ("GTR 1", "GTR 2" = Teclado): aprende
  const same = ['1', '2'].map((n) => ({ clipId: n, songId: 's1', songName: song, fileName: `GTR ${n}.wav`, dest: 'track-teclados|teclado|0' }));
  assert.equal(ambiguousLearnKeys(same, same.map((x) => sib(x.clipId, x.fileName))).size, 0);
  // o mesmo Confirmar mandando a mesma palavra para lugares diferentes (duas músicas): não aprende
  const two = [
    { clipId: 'p', songId: 's1', songName: 'A', fileName: 'RHODES X.wav', dest: 'track-teclados|teclado|0' },
    { clipId: 'q', songId: 's2', songName: 'B', fileName: 'RHODES X.wav', dest: 'track-outros|extra|0' },
  ];
  assert.ok(ambiguousLearnKeys(two, two.map((x) => ({ ...x }))).has('RHODES'));
  // no programa, a janela passa os outros áudios da música e os ouvidos
  const actions = src('src/lib/routeReviewActions.ts');
  assert.match(actions, /s\.items, choices, \{ heard, siblings \}\)/);
  assert.match(actions, /heardIds\.add\(item\.clipId\);/);
});

test('reorganização das faixas não desfaz o aprendido nem o Confirmar', () => {
  assert.equal(keepsPersonRoute({ routingLocked: true }), true);
  assert.equal(keepsPersonRoute({}), false);
  const store = src('src/store.ts');
  // a trava vem antes da reclassificação pelo nome do arquivo
  assert.match(store, /if \(keepsPersonRoute\(clip\) && onTrack\) \{[\s\S]*?\}\s*const route = routeByName\(clip\.fileName\)/);
  // "voltar ao automático" tira a trava
  assert.match(store, /routingMethod: 'name' as const, routingConfidence: 1, routingLocked: false/);
  const im = src('src/lib/importManager.ts');
  assert.match(im, /\.\.\.\(learned \? \{ routingLocked: true \} : \{\}\)/);
  assert.ok(im.indexOf('routingLocked: true') < im.indexOf('useStore.getState().reconcileTracks();'));
  assert.match(src('src/lib/routeReviewActions.ts'), /lockClip: \(clipId\) => store\(\)\.updateClip\(clipId, \{ routingLocked: true/);
});

test('motor de escuta que troca a votação deixa o áudio na conferência (certeza baixa)', () => {
  const ai = g('track-violoes', 'Violão', 0.92);
  assert.equal(routeCertainty({ byName: false, learned: false, ai, second: null }), 'high');
  assert.equal(routeCertainty({ byName: false, learned: false, ai, second: null, aiSwitched: true }), 'low');
  // nome e aprendido continuam mandando
  assert.equal(routeCertainty({ byName: true, learned: false, ai, aiSwitched: true }), 'high');
  const aiSrc = src('src/lib/aiRouter.ts');
  assert.match(aiSrc, /\.\.\.\(heard \? \{ switched: true \} : \{\}\)/);
  assert.match(src('src/lib/importManager.ts'), /aiSwitched: !!aiDetail\?\.switched/);
});

test('reclassificar pelo botão direito usa o mesmo motor da importação', () => {
  const aiSrc = src('src/lib/aiRouter.ts');
  assert.match(aiSrc, /export async function classifyClipAudio\(audio: ClipAudio, key: string\)[^{]*\{\s*return \(await classifyClipAudioDetailed\(audio, key\)\)\.route;/);
});

test('nome "KEYS" continua criando a trilha Keys; "KEY CHANGE" não é teclado', () => {
  assert.equal(routeByName('KEYS.wav')?.instrumentName, 'Keys');
  assert.equal(routeByName('Keys 2.wav')?.instrumentName, 'Keys');
  assert.equal(routeByName('KEY CHANGE.wav'), null);
  assert.equal(routeByName('KEY.wav')?.target, 'track-teclados');
});

test('marca do vendedor repetida nos stems da música não vira nome de instrumento', () => {
  const st = memory();
  const song = 'Fiquei Sabendo';
  const files = ['01 - CLUBE DO VS.mp3', '02 - CLUBE DO VS - GTR.mp3', '03 - CLUBE DO VS - BAIXO.mp3', '04 - CLUBE DO VS - BATERIA.mp3'];
  const siblings = files.map((f, i) => ({ songId: 's1', songName: song, fileName: f, clipId: `c${i}` }));
  assert.deepEqual([...sharedSongWords(siblings).get('s1')], ['CLUBE']);
  const items = [item({ clipId: 'c0', fileName: files[0], songName: song, songId: 's1' })];
  const api = { ...fakeApi(), learn: (f, sn, c) => learnRoute(f, sn, c, st, 1) };
  // só o 01 conferido como Teclado: CLUBE está em todos os stems, não aprende
  applyReview(api, items, [{ clipId: 'c0', target: 'track-teclados', solo: false }], { siblings });
  assert.deepEqual(loadLearned(st), []);
  const later = routeByLearned(['07 - CLUBE DO VS - GTR.mp3'], loadLearned(st));
  assert.equal(later, null, 'GTR da mesma marca não vai para Teclados');
  // o GTR conferido aprende só "GTR", sem a marca
  const gtr = [item({ clipId: 'c1', fileName: files[1], songName: song, songId: 's1' })];
  applyReview(api, gtr, [{ clipId: 'c1', target: 'track-guitarras', solo: false }], { siblings });
  assert.deepEqual(loadLearned(st).map((e) => e.key), ['GTR']);
  // marca na maioria (4 de 5) também sai; palavra em só 2 de 5 fica
  const five = ['HELLAN GTR', 'HELLAN BAIXO', 'HELLAN PAD', 'HELLAN KEY', 'SANFONA PAD'].map((f, i) => ({ songId: 's2', songName: 'X', fileName: `${f}.wav`, clipId: `h${i}` }));
  assert.deepEqual([...sharedSongWords(five).get('s2')], ['HELLAN']);
  assert.equal(learnedKey('FIQUEI SABENDO - KEY HELLAN VS.wav', 'Fiquei Sabendo', ['HELLAN']), 'KEY');
});

test('"Key" no título não tira da Guia nem de outro instrumento', () => {
  assert.equal(routeByName('Key of David - Guia.wav')?.target, 'track-guia');
  assert.equal(routeByName('Key Gtr.wav')?.target, 'track-guitarras');
  assert.equal(routeByName('GUIA KEY.wav')?.target, 'track-guia');
  assert.equal(routeByName('VOZ GUIA.wav')?.target, 'track-guia');
  assert.equal(routeByName('FIQUEI SABENDO - KEY HELLAN VS.wav')?.target, 'track-teclados');
  assert.equal(routeByName('Bateria Perc.wav')?.target, 'track-bateria');
  assert.equal(routeByName('PERCS.wav')?.target, 'track-percussoes');
});

test('prévia que não tocou não conta como ouvida', () => {
  const actions = src('src/lib/routeReviewActions.ts');
  const body = actions.slice(actions.indexOf('export async function playReviewPreview'));
  const start = body.indexOf('src.start();');
  assert.ok(start > 0);
  assert.equal(body.indexOf('heardIds.add(item.clipId);'), body.indexOf('heardIds.add(item.clipId);', start), 'marca como ouvida só depois do start');
});

test('o trecho da conferência toca na placa escolhida no programa', () => {
  const actions = src('src/lib/routeReviewActions.ts');
  assert.match(actions, /const sink = audioEngine\.getOutputSinkId\(\);/);
  assert.match(actions, /new AudioContext\(\{ latencyHint: hint, sinkId: sink \} as AudioContextOptions\)/);
  assert.match(actions, /ctxSink !== sink/);
});
