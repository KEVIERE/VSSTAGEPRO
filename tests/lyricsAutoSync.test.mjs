// Letra automática do teleprompter: palavras da IA viram páginas, e as marcações na onda
// podem ser apagadas, criadas e arrastadas sem bagunçar a letra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMarker, buildPages, isHallucination, markChorus, moveMarker, normalizeWords, removeMarker, splitTextAt,
} from '../src/lib/lyricsAutoSync.ts';

let n = 0;
const ids = () => `id${++n}`;

/** Palavras faladas em sequência: [texto, início, fim]. */
const W = (list) => list.map(([w, s, e]) => ({ w, s, e }));

const page = (id, time, text, kind = 'verso') => ({ id, time, text, kind });

test('normalizeWords lê o formato do WhisperX e mantém a ordem', () => {
  const words = normalizeWords([
    { start: 10, end: 12, text: ' Deus é fiel', words: [
      { word: 'Deus', start: 10, end: 10.4, score: 0.9 },
      { word: 'é', start: 10.5, end: 10.7 },
      { word: 'fiel', start: 10.8, end: 11.6 },
    ] },
  ]);
  assert.deepEqual(words.map((w) => w.w), ['Deus', 'é', 'fiel']);
  assert.equal(words[0].s, 10);
  assert.equal(words[2].e, 11.6);
});

test('palavra sem tempo (número) recebe o espaço entre as vizinhas', () => {
  const words = normalizeWords([
    { start: 5, end: 8, text: 'são 12 apóstolos', words: [
      { word: 'são', start: 5, end: 5.5 },
      { word: '12' },
      { word: 'apóstolos', start: 6.5, end: 7.5 },
    ] },
  ]);
  assert.equal(words.length, 3, 'nenhuma palavra some');
  assert.equal(words[1].w, '12');
  assert.ok(words[1].s >= 5.5 && words[1].e <= 6.5, `"12" fica entre as vizinhas (${words[1].s}-${words[1].e})`);
});

test('trecho sem alinhamento reparte o texto no tempo do trecho', () => {
  const words = normalizeWords([{ start: 20, end: 22, text: 'a b c d' }]);
  assert.deepEqual(words.map((w) => w.w), ['a', 'b', 'c', 'd']);
  assert.equal(words[0].s, 20);
  assert.ok(Math.abs(words[3].e - 22) < 1e-9);
});

test('frase inventada pelo Whisper em trecho sem voz é descartada', () => {
  assert.ok(isHallucination('Legendas pela comunidade Amara.org'));
  assert.ok(isHallucination('Obrigado por assistir!'));
  assert.ok(!isHallucination('Obrigado, Senhor, por tudo'));
  const words = normalizeWords([
    { start: 1, end: 3, text: 'Te louvarei', words: [{ word: 'Te', start: 1, end: 1.3 }, { word: 'louvarei', start: 1.4, end: 2.5 }] },
    { start: 200, end: 203, text: ' Obrigado por assistir.', words: [{ word: 'Obrigado', start: 200, end: 201 }] },
  ]);
  assert.deepEqual(words.map((w) => w.w), ['Te', 'louvarei']);
});

test('frase curta com confiança baixa (inventada em trecho sem voz) é descartada', () => {
  const words = normalizeWords([
    { start: 0, end: 1.5, text: 'Tchau, tchau.', avg_logprob: -0.613, words: [{ word: 'Tchau,', start: 0, end: 0.6 }, { word: 'tchau.', start: 0.7, end: 1.4 }] },
    { start: 4, end: 6, text: 'Por que demorou?', avg_logprob: -0.227, words: [{ word: 'Por', start: 4, end: 4.3 }, { word: 'que', start: 4.4, end: 4.6 }, { word: 'demorou?', start: 4.7, end: 5.6 }] },
    { start: 8, end: 9, text: 'Aleluia', avg_logprob: -0.3, words: [{ word: 'Aleluia', start: 8, end: 9 }] },
    { start: 10, end: 14, text: 'frase comprida com pouca certeza mas cantada', avg_logprob: -0.7, words: [] },
  ]);
  assert.deepEqual(words.map((w) => w.w), ['Por', 'que', 'demorou?', 'Aleluia', 'frase', 'comprida', 'com', 'pouca', 'certeza', 'mas', 'cantada']);
});

test('entrada quebrada não derruba a leitura', () => {
  assert.deepEqual(normalizeWords(null), []);
  assert.deepEqual(normalizeWords([null, {}, { words: [{ word: '  ' }] }]), []);
});

/** Frases do Whisper: cada uma é uma lista de [texto, início, fim]; a primeira palavra abre a frase. */
const F = (...phrases) => phrases.flatMap((ph) => ph.map(([w, s, e], i) => (i === 0 ? { w, s, e, br: true } : { w, s, e })));

test('buildPages: cada frase do Whisper vira uma linha, silêncio grande fecha a página', () => {
  const words = F(
    [['Quão', 1.0, 1.3], ['grande', 1.35, 1.8], ['és', 1.85, 2.4], ['tu', 2.45, 3.0]],
    [['meu', 3.2, 3.5], ['Senhor', 3.55, 4.8]],
    // instrumental de 5 s
    [['Eu', 10.0, 10.2], ['te', 10.25, 10.4], ['adoro', 10.45, 11.2]],
  );
  const pages = buildPages(words, {}, ids);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].time, 1);
  assert.equal(pages[0].text, 'Quão grande és tu\nMeu Senhor');
  assert.equal(pages[1].time, 10);
  assert.equal(pages[1].text, 'Eu te adoro');
});

test('buildPages: vírgula depois de 3 palavras abre linha nova; antes disso não', () => {
  const words = F([['você,', 0, 0.3], ['nosso', 0.35, 0.6], ['amor,', 0.65, 1], ['nós', 1.05, 1.3], ['três', 1.35, 1.8]]);
  assert.equal(buildPages(words, {}, ids)[0].text, 'Você, nosso amor\nNós três');
});

test('buildPages: respiro longo fecha a página só se ela já tem duas linhas', () => {
  const words = F(
    [['um', 0, 0.5], ['dois', 0.6, 1]],
    [['três', 2.6, 3], ['quatro', 3.1, 3.5]], // respiro de 1,6 s com uma linha só: continua
    [['cinco', 5.1, 5.5], ['seis', 5.6, 6]], // respiro de 1,6 s com duas linhas: página nova
  );
  const pages = buildPages(words, {}, ids);
  assert.deepEqual(pages.map((p) => [p.time, p.text]), [[0, 'Um dois\nTrês quatro'], [5.1, 'Cinco seis']]);
});

test('buildPages: frase comprida vira linhas parecidas e a página nunca passa do limite', () => {
  // 40 palavras numa frase só, sem respiro: só o tamanho decide.
  const words = [];
  for (let i = 0; i < 40; i++) words.push({ w: 'aleluia', s: i * 0.5, e: i * 0.5 + 0.45, br: i === 0 });
  const pages = buildPages(words, { maxLineChars: 32, maxLines: 4 }, ids);
  assert.ok(pages.length >= 3, 'mais de uma página');
  for (const p of pages) {
    const lines = p.text.split('\n');
    assert.ok(lines.length <= 4, 'no máximo 4 linhas por página');
    for (const l of lines) assert.ok(l.length <= 32, `linha com no máximo 32 caracteres: "${l}"`);
  }
  const total = pages.reduce((s, p) => s + p.text.split(/\s+/).length, 0);
  assert.equal(total, 40, 'nenhuma palavra se perde');
  for (let i = 1; i < pages.length; i++) assert.ok(pages[i].time > pages[i - 1].time, 'tempos em ordem');
});

test('buildPages: frase que não cabe no resto da página começa na seguinte', () => {
  const long = 'esta frase tem muitas palavras e ocupa duas linhas da tela'.split(' ').map((w, i) => [w, 3 + i * 0.3, 3.25 + i * 0.3]);
  const pages = buildPages(F([['a', 0, 0.2], ['b', 0.3, 0.5]], [['c', 0.8, 1], ['d', 1.1, 1.3]], [['e', 1.6, 1.8], ['f', 1.9, 2.1]], long), { maxLines: 4 }, ids);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].text, 'A b\nC d\nE f');
  assert.equal(pages[1].time, 3);
});

test('buildPages: tira vírgula e ponto do fim da linha e põe maiúscula', () => {
  const pages = buildPages(F([['santo', 0, 0.4], ['santo,', 0.45, 0.9]], [['santo', 1.0, 1.4], ['é.', 1.45, 1.8]]), {}, ids);
  assert.equal(pages[0].text, 'Santo santo\nSanto é');
});

test('normalizeWords marca a primeira palavra de cada frase', () => {
  const words = normalizeWords([
    { start: 0, end: 1, text: 'a b', words: [{ word: 'a', start: 0, end: 0.4 }, { word: 'b', start: 0.5, end: 1 }] },
    { start: 2, end: 3, text: 'c', words: [{ word: 'c', start: 2, end: 3 }] },
  ]);
  assert.deepEqual(words.map((w) => !!w.br), [true, false, true]);
});

test('trecho que se repete vira Refrão', () => {
  const pages = markChorus([
    page('a', 0, 'Eu vou cantar de alegria'),
    page('b', 10, 'Santo santo é o Senhor\nDigno de louvor'),
    page('c', 20, 'Outra parte bem diferente da letra'),
    page('d', 30, 'Santo, santo é o Senhor\nDigno de todo louvor'),
  ]);
  assert.deepEqual(pages.map((p) => p.kind), ['verso', 'refrao', 'verso', 'refrao']);
});

test('música que se repete inteira: só o que aparece 3 vezes ou mais vira Refrão', () => {
  const verso = 'Por que demorou tanto pra chegar aqui';
  const refrao = 'O que eu não vivi em dez anos vivi num mês';
  const pages = markChorus([verso, refrao, refrao, verso, refrao, refrao].map((t, i) => page(`p${i}`, i * 10, t)));
  assert.deepEqual(pages.map((p) => p.kind), ['verso', 'refrao', 'refrao', 'verso', 'refrao', 'refrao']);
});

test('arrastar marcação: anda livre entre as vizinhas', () => {
  const pages = [page('a', 10, 'um'), page('b', 20, 'dois'), page('c', 30, 'três')];
  const moved = moveMarker(pages, 'b', 22.34);
  assert.equal(moved[1].time, 22.3);
  assert.equal(pages[1].time, 20, 'não altera o array original');
});

test('arrastar marcação: não passa por cima da vizinha', () => {
  const pages = [page('a', 10, 'um'), page('b', 20, 'dois'), page('c', 30, 'três')];
  assert.equal(moveMarker(pages, 'b', 45)[1].time, 29.8, 'para antes da seguinte');
  assert.equal(moveMarker(pages, 'b', 2)[1].time, 10.2, 'para depois da anterior');
  assert.equal(moveMarker(pages, 'a', -5)[0].time, 0, 'não vai para antes do zero');
  assert.equal(moveMarker(pages, 'c', 500, 240)[2].time, 240, 'não passa do fim da música');
});

test('arrastar para o mesmo lugar devolve o mesmo array (não cria passo no desfazer)', () => {
  const pages = [page('a', 10, 'um'), page('b', 20, 'dois')];
  assert.equal(moveMarker(pages, 'b', 20.01), pages);
  assert.equal(moveMarker(pages, 'x', 5), pages, 'id que não existe');
});

test('apagar marcação junta o trecho ao de antes', () => {
  const pages = [page('a', 10, 'Primeira linha'), page('b', 20, 'Segunda linha'), page('c', 30, 'Terceira')];
  const out = removeMarker(pages, 'b');
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'a');
  assert.equal(out[0].time, 10);
  assert.equal(out[0].text, 'Primeira linha\nSegunda linha');
  assert.equal(out[1].id, 'c');
});

test('apagar a primeira marcação junta o trecho seguinte ao primeiro', () => {
  const pages = [page('a', 10, 'Primeira'), page('b', 20, 'Segunda'), page('c', 30, 'Terceira')];
  const out = removeMarker(pages, 'a');
  assert.deepEqual(out.map((p) => p.id), ['a', 'c']);
  assert.equal(out[0].time, 10, 'o primeiro trecho continua começando no mesmo tempo');
  assert.equal(out[0].text, 'Primeira\nSegunda');
});

test('com uma página só não há marcação para apagar', () => {
  const pages = [page('a', 10, 'Só')];
  assert.equal(removeMarker(pages, 'a'), pages);
});

test('nova marcação divide o trecho na palavra certa (com as palavras da IA)', () => {
  const words = W([
    ['Quão', 1.0, 1.3], ['grande', 1.35, 1.8], ['és', 1.85, 2.4], ['tu', 2.45, 3.0],
    ['meu', 3.6, 3.9], ['Senhor', 3.95, 4.8],
  ]);
  const pages = [page('a', 1, 'Quão grande és tu\nmeu Senhor')];
  const out = addMarker(pages, 3.5, words, 0, ids);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, 'Quão grande és tu');
  assert.equal(out[1].text, 'Meu Senhor');
  assert.equal(out[1].time, 3.6, 'gruda no começo de "meu"');
  assert.equal(out[0].id, 'a', 'o trecho de antes mantém o id');
});

test('clique dentro de uma palavra (mesmo perto do fim): o trecho novo começa nela', () => {
  // tempos reais lidos da Guia de uma música
  const words = W([['Já', 14.18, 14.48], ['tem', 14.48, 14.84], ['Aparentemente', 18.16, 18.88], ['você', 18.88, 19.6]]);
  const pages = [page('a', 14.2, 'Já tem\nAparentemente você')];
  for (const click of [18.2, 18.4, 18.7]) {
    const out = addMarker(pages, click, words, 0, ids);
    assert.deepEqual(out.map((p) => [p.time, p.text]), [[14.2, 'Já tem'], [18.2, 'Aparentemente você']], `clique em ${click}`);
  }
});

test('clique num respiro logo antes da palavra: gruda no começo dela', () => {
  const words = W([['Já', 14.18, 14.48], ['tem', 14.48, 14.84], ['Aparentemente', 18.16, 18.88]]);
  const out = addMarker([page('a', 14.2, 'Já tem Aparentemente')], 17.8, words, 0, ids);
  assert.deepEqual(out.map((p) => [p.time, p.text]), [[14.2, 'Já tem'], [18.2, 'Aparentemente']]);
});

test('clique longe de qualquer palavra não gruda: corta pelo tempo do clique', () => {
  const words = W([['um', 0, 0.5], ['dois', 0.6, 1], ['três', 6, 6.5]]);
  const pages = [page('a', 0, 'um dois três')];
  const out = addMarker(pages, 3, words, 0, ids);
  assert.deepEqual(out.map((p) => [p.time, p.text]), [[0, 'um dois'], [3, 'Três']]);
});

test('nova marcação sem as palavras divide pelo tempo, proporcional', () => {
  const pages = [page('a', 0, 'um dois três quatro'), page('b', 8, 'cinco')];
  const out = addMarker(pages, 4, [], 0, ids);
  assert.deepEqual(out.map((p) => p.text), ['um dois', 'Três quatro', 'cinco']);
  assert.deepEqual(out.map((p) => p.time), [0, 4, 8]);
});

test('texto editado pelo produtor: o corte vira proporcional (não usa palavras desatualizadas)', () => {
  const words = W([['a', 0, 0.5], ['b', 1, 1.5]]);
  const pages = [page('a', 0, 'um dois três quatro'), page('b', 8, 'fim')];
  const out = addMarker(pages, 6, words, 0, ids);
  assert.deepEqual(out.map((p) => p.text), ['um dois três', 'Quatro', 'fim']);
});

test('nova marcação antes da primeira cria uma página vazia no começo', () => {
  const pages = [page('a', 10, 'Primeira')];
  const out = addMarker(pages, 3, [], 0, ids);
  assert.equal(out.length, 2);
  assert.equal(out[0].time, 3);
  assert.equal(out[0].text, '');
  assert.equal(out[1].id, 'a');
});

test('nova marcação colada numa que já existe é ignorada', () => {
  const pages = [page('a', 10, 'Primeira segunda')];
  assert.equal(addMarker(pages, 10.05, [], 0, ids), pages);
});

test('nova marcação depois da última, sem fim conhecido, vem vazia', () => {
  const pages = [page('a', 10, 'Primeira segunda')];
  const out = addMarker(pages, 50, [], 0, ids);
  assert.deepEqual(out.map((p) => [p.time, p.text]), [[10, 'Primeira segunda'], [50, '']]);
});

test('splitTextAt mantém as quebras de linha', () => {
  assert.deepEqual(splitTextAt('a b\nc d\ne', 3), ['a b\nc', 'D\ne']);
  assert.deepEqual(splitTextAt('a b', 0), ['', 'A b']);
});

test('de ponta a ponta: IA -> páginas -> apagar -> criar -> arrastar', () => {
  const words = normalizeWords([
    { start: 2, end: 4, text: 'Em teus braços', words: [{ word: 'Em', start: 2, end: 2.2 }, { word: 'teus', start: 2.3, end: 2.7 }, { word: 'braços', start: 2.8, end: 3.6 }] },
    { start: 8, end: 10, text: 'é meu descanso', words: [{ word: 'é', start: 8, end: 8.2 }, { word: 'meu', start: 8.3, end: 8.6 }, { word: 'descanso', start: 8.7, end: 9.8 }] },
  ]);
  let pages = buildPages(words, {}, ids);
  assert.deepEqual(pages.map((p) => [p.time, p.text]), [[2, 'Em teus braços'], [8, 'É meu descanso']]);
  pages = removeMarker(pages, pages[1].id);
  assert.equal(pages.length, 1);
  pages = addMarker(pages, 8, words, 0, ids);
  assert.deepEqual(pages.map((p) => [p.time, p.text]), [[2, 'Em teus braços'], [8, 'É meu descanso']]);
  pages = moveMarker(pages, pages[1].id, 7.6);
  assert.equal(pages[1].time, 7.6);
  for (const p of pages) assert.deepEqual(Object.keys(p).sort(), ['id', 'kind', 'text', 'time'], 'mesmo formato de página do teleprompter');
});
