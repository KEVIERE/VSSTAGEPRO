// Motor de escuta (instrumentClassifier): regressão logística sobre a impressão digital do YAMNet,
// treinada com VS de verdade. Confere os pesos, a regra que junta com a votação de hoje e a ligação
// com o aiRouter (stems separados por IA continuam com a votação de sempre).
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// o módulo importa os pesos com o caminho do Vite ('@/lib/...json'): aqui vira um módulo comum
const hooks = `
import { readFileSync } from 'node:fs';
const W = ${JSON.stringify(new URL('../src/lib/instrumentClassifier.weights.json', import.meta.url).href)};
export async function resolve(s, c, n) { return s === '@/lib/instrumentClassifier.weights.json' ? { url: W + '?m', shortCircuit: true } : n(s, c); }
export async function load(u, c, n) { return u === W + '?m' ? { format: 'module', source: 'export default ' + readFileSync(new URL(W), 'utf8'), shortCircuit: true } : n(u, c); }
`;
register('data:text/javascript,' + encodeURIComponent(hooks));
const ic = await import('../src/lib/instrumentClassifier.ts');
const weights = JSON.parse(readFileSync(new URL('../src/lib/instrumentClassifier.weights.json', import.meta.url), 'utf8'));
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/**
 * Impressão digital que dá ao motor a nota pedida: a classe pedida fica `margin` acima das outras
 * (solução de norma mínima de W·e + b = z). margin 20 = certeza total; margin 0,5 = dúvida.
 */
function embOf(cls, margin = 20) {
  const C = weights.classes.length, D = weights.W[0].length;
  const z = weights.classes.map((c, k) => (c === cls ? margin : 0) - weights.b[k]);
  const G = weights.W.map((ri) => weights.W.map((rj) => ri.reduce((s, v, i) => s + v * rj[i], 0)));
  // resolve G·y = z (eliminação de Gauss) e e = Wᵀ·y
  const A = G.map((row, i) => [...row, z[i]]);
  for (let i = 0; i < C; i++) {
    let p = i; for (let r = i + 1; r < C; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < C; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let k = i; k <= C; k++) A[r][k] -= f * A[i][k]; }
  }
  const y = A.map((row, i) => row[C] / row[i]);
  const e = new Float64Array(D);
  for (let k = 0; k < C; k++) for (let i = 0; i < D; i++) e[i] += weights.W[k][i] * y[k];
  return e;
}
const route = (target, childName) => ({ target, childName });

test('pesos: 11 classes, 1024 números por classe, limites medidos e classes com poucas músicas', () => {
  assert.equal(weights.classes.length, 11);
  assert.equal(weights.W.length, 11);
  for (const row of weights.W) assert.equal(row.length, ic.INSTRUMENT_EMBEDDING_SIZE);
  assert.equal(weights.b.length, 11);
  assert.equal(ic.INSTRUMENT_SWITCH_CONFIDENCE, 0.7);
  assert.equal(ic.INSTRUMENT_MIN_CONFIDENCE, 0.6);
  assert.deepEqual([...weights.poucas_musicas].sort(), ['baixo', 'bateria', 'guitarra']);
});

test('cada classe é reconhecida pela impressão digital dela, com o 2º palpite em outra faixa', () => {
  for (const cls of weights.classes) {
    const [first, second] = ic.classifyInstrumentEmbeddings([embOf(cls)]);
    assert.equal(first.instrument, cls);
    assert.ok(first.confidence > 0.6, `${cls} ${first.confidence}`);
    assert.ok(second && !(second.target === first.target && second.childName === first.childName));
  }
});

test('sem trecho válido não há palpite (o motor de hoje decide sozinho)', () => {
  assert.deepEqual(ic.classifyInstrumentEmbeddings([]), []);
  assert.deepEqual(ic.classifyInstrumentEmbeddings([new Float32Array(10)]), []);
  assert.equal(ic.instrumentOverride(route('track-violoes', 'Violão'), []), null);
  assert.equal(ic.instrumentVerdict(null, []).sure, false);
});

test('regra: o de hoje sem resposta, o novo decide seguro; nas classes de poucas músicas nunca', () => {
  const v = ic.instrumentVerdict(null, [embOf('maestro')]);
  assert.equal(v.heard?.target, 'track-maestro');
  assert.equal(v.sure, true);
  assert.equal(ic.instrumentVerdict(null, [embOf('baixo')]).heard, null);
  assert.equal(ic.instrumentVerdict(null, [embOf('guitarra')]).sure, false);
});

test('regra: troca a resposta de hoje só com 70%; se hoje deu baixo, bateria ou guitarra, fica a de hoje', () => {
  assert.equal(ic.instrumentOverride(route('track-teclados', 'Teclado'), [embOf('sanfona')])?.target, 'track-sanfonas');
  assert.equal(ic.instrumentOverride(route('track-contrabaixo', 'Contrabaixo'), [embOf('sanfona')]), null);
  assert.equal(ic.instrumentOverride(route('track-bateria', 'Bateria'), [embOf('percussao')]), null);
  assert.equal(ic.instrumentOverride(route('track-guitarras', 'Guitarra'), [embOf('violao')]), null);
  // pouca certeza: fica a de hoje
  const weak = ic.instrumentVerdict(route('track-teclados', 'Teclado'), [embOf('sanfona', 0.5)]);
  assert.equal(weak.heard, null);
  assert.equal(weak.sure, false);
});

test('concordando com a votação de hoje e seguro, a faixa fica e a certeza passa a ser a dele', () => {
  const v = ic.instrumentVerdict(route('track-violoes', 'Violão'), [embOf('violao')]);
  assert.equal(v.heard, null);
  assert.equal(v.sure, true);
  assert.equal(v.guesses[0].target, 'track-violoes');
});

test('aiRouter: motor novo só na importação, palpites e certeza dele quando seguro, Click pelo metronomeCheck', () => {
  const ai = src('src/lib/aiRouter.ts');
  assert.match(ai, /instrumentVerdict\(voted, embeddings\)/);
  assert.match(ai, /classifyByVoteDetailed\(src, key, \{ escuta: false \}\)\)\.route/, 'stems separados por IA ficam com a votação de sempre');
  assert.match(ai, /verdict\?\.sure\s*\?\s*verdict\.guesses/);
  assert.match(ai, /yamnetClass: `escuta:\$\{heard\.instrument\}`/);
  assert.match(ai, /const route = clickChecked\(best, src\);/);
  const worker = src('src/workers/aiRouter.worker.ts');
  assert.match(worker, /embeddingsTensor\.mean\(0\)/);
  assert.match(worker, /\[embedding\.buffer\]\)/);
});

test('mesma faixa com nome mais específico ("Piano") fica como o de hoje, sem virar "Teclado"', () => {
  const v = ic.instrumentVerdict(route('track-teclados', 'Piano'), [embOf('teclados')]);
  assert.equal(v.heard, null);
  assert.equal(v.sure, true);
  assert.equal(ic.instrumentOverride(route('track-teclados', 'Pad'), [embOf('teclados')]), null);
});
