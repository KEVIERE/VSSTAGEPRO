// Voz de IA do Maestro: Qwen3-TTS (Alibaba, Apache-2.0), voz brasileira gerada no próprio Mac.
//
// - Quem fala é o programa vs-maestro-voz (Swift + MLX), que vai junto do app em
//   maestro-voice-engine. O app abre o programa uma vez; ele carrega o modelo e atende as falas
//   uma de cada vez. Depois de 10 min sem falas o programa fecha e a memória volta (~2 GB).
// - O modelo (~1,8 GB) é baixado uma vez, em silêncio (maestroVoiceDownload.js).
// - As duas vozes (feminina e masculina) foram criadas por IA e não pertencem a ninguém: cada uma
//   é um trecho de referência de ~8 s com o texto dele (maestro-voice-engine/voices).
// - Só roda em Mac com chip Apple (o MLX não roda em Intel). Fora disso, a fala sai com a voz do
//   Mac (maestroVoice.js).
// - O Qwen3-TTS não tem controle de velocidade: aqui se calcula o fator (`tempo`) e a tela estica
//   o áudio com o SoundTouch que o app já usa.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { floatToWav, removeDcOffset, splitWords, trimSilence, wavSeconds } = require('./maestroAudio');
const download = require('./maestroVoiceDownload');

const HELPER = 'vs-maestro-voz';

/** As vozes de IA. `ref` é o nome do trecho de referência em maestro-voice-engine/voices. */
const QWEN_VOICES = [
  { id: 'qwen:feminina', name: 'Voz feminina (IA)', gender: 'feminina', ref: 'feminina' },
  { id: 'qwen:masculina', name: 'Voz masculina (IA)', gender: 'masculina', ref: 'masculina' },
];

/** Fala comum: se não couber na marcação, acelera até aqui. Nunca desacelera (sobra silêncio). */
const MAX_FIT_TEMPO = 1.35;
/** Contagem: faixa da velocidade escolhida e o máximo para caber no tempo do click. */
const COUNT_TEMPO_MIN = 0.85;
const COUNT_TEMPO_MAX = 1.8;
/**
 * O programa fecha logo depois da última fala e devolve a memória (~2 GB): num Mac de 8 GB, segurar
 * isso deixava o Mac inteiro lento. Abrir de novo leva ~2 s.
 */
const IDLE_RELEASE_MS = 60 * 1000;
/**
 * Geração mais estável: menos variação de tom de uma fala para outra (0,9 é o padrão do modelo e
 * muda bastante a entonação). Medido: 0,6 diminui a variação sem deixar a voz robótica.
 */
const TEMPERATURE = 0.6;
const TOP_K = 50;
/** Tempo máximo para abrir o programa e carregar o modelo. */
const LOAD_TIMEOUT_MS = 180_000;
/** Quantas falas prontas ficam guardadas (as mais antigas saem). */
const CACHE_MAX_FILES = 400;
/** Muda quando o tratamento do áudio muda (corte do silêncio etc.): as falas antigas não servem mais. */
const CACHE_VERSION = 4;

/** A voz pedida: 'feminina'/'masculina' ou o id de uma voz de IA. */
function qwenVoiceFor(wanted) {
  if (wanted === 'feminina') return QWEN_VOICES[0];
  if (wanted === 'masculina') return QWEN_VOICES[1];
  return QWEN_VOICES.find((v) => v.id === wanted) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Onde estão as coisas

/** O MLX só roda em Mac com chip Apple (o app Intel rodando no chip Apple também fica de fora). */
function supported() {
  return process.platform === 'darwin' && process.arch === 'arm64';
}

/** Pasta com o programa de voz e as vozes: dentro do app instalado ou, em desenvolvimento, aqui. */
function engineDir() {
  const candidates = [
    process.env.VS_MAESTRO_ENGINE_DIR,
    process.resourcesPath && path.join(process.resourcesPath, 'maestro-voice-engine'),
    path.join(__dirname, 'maestro-voice-engine'),
  ].filter(Boolean);
  return candidates.find((d) => fs.existsSync(path.join(d, HELPER))
    && QWEN_VOICES.every((v) => fs.existsSync(path.join(d, 'voices', `${v.ref}.wav`)))) ?? null;
}

/** Pasta do modelo: a baixada pelo app ou, em desenvolvimento, a de VS_MAESTRO_MODEL_DIR. */
function modelDir() {
  return process.env.VS_MAESTRO_MODEL_DIR || download.modelDir();
}

function modelReady() {
  if (process.env.VS_MAESTRO_MODEL_DIR) return fs.existsSync(path.join(process.env.VS_MAESTRO_MODEL_DIR, 'config.json'));
  return download.isReady();
}

/**
 * Situação da voz de IA para a tela:
 * - supported: o Mac tem chip Apple; engine: o programa e as vozes vieram no app;
 * - model: situação do download (missing, downloading, paused, error, ready) e o progresso;
 * - ready: dá para falar agora.
 */
function status() {
  const engine = !!engineDir();
  const model = process.env.VS_MAESTRO_MODEL_DIR
    ? { state: modelReady() ? 'ready' : 'missing', progress: modelReady() ? 1 : 0, error: null }
    : download.status();
  return { supported: supported(), engine, model, ready: supported() && engine && model.state === 'ready' };
}

/** Por que a voz de IA não pode falar agora (para o aviso da tela), ou null se pode. */
function unavailableReason() {
  const s = status();
  if (!s.supported) return 'A voz brasileira de IA só funciona em Mac com chip Apple.';
  if (!s.engine) return 'A voz brasileira de IA não veio completa nesta instalação.';
  if (s.model.state === 'error') return `A voz brasileira de IA não terminou de baixar (${s.model.error}). O app tenta de novo sozinho.`;
  if (s.model.state !== 'ready') return `A voz brasileira de IA ainda está sendo baixada (${Math.round((s.model.progress ?? 0) * 100)}%).`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Texto

/**
 * Rótulo de compasso usado como texto da fala ("a1", "A4"): sobra só o número. Lido como está,
 * "a1" vira "a um" — era o "a um, a dois, a três, a quatro" que na contagem deveria ser só "um,
 * dois, três, quatro". Só a letra "a" sai: "B2" e "C3" podem ser nome de nota.
 */
function stripCompassLabel(text) {
  return text
    .replace(/\b[aA]\s*(\d+)\b/g, '$1')
    .replace(/([A-Za-zÀ-ÿ])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-zÀ-ÿ])/g, '$1 $2');
}

function cleanText(text) {
  return stripCompassLabel(String(text ?? ''))
    .replace(/[“”«»"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Limite de "tokens" de áudio da fala (12,5 por segundo): folga para uma fala lenta, mas segura o
 * modelo se ele começar a inventar depois do texto (acontece com palavras soltas, como "Um!").
 */
function maxTokensFor(text) {
  const seconds = 2.5 + text.length * 0.16;
  return Math.ceil(Math.min(150, seconds) * 12.5);
}

/** Semente fixa por voz: toda fala da mesma voz sai do mesmo jeito (tom mais parecido) e a mesma fala gerada de novo sai igual. */
function seedFor(voiceId) {
  let h = 2166136261;
  for (const ch of `vs-maestro|${voiceId}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Fator de velocidade (1 = natural, 1,2 = 20% mais rápido) e a duração final.
 * - Fala comum (sem `pace`): só acelera se não couber na marcação, até MAX_FIT_TEMPO.
 * - Contagem (`pace`): a velocidade escolhida; acelera mais só se o número não couber no tempo.
 */
function fitTempo(natural, span, pace) {
  const s = Number(span) > 0 ? Number(span) : 0;
  let tempo;
  if (Number(pace) > 0) {
    tempo = Math.max(COUNT_TEMPO_MIN, Math.min(COUNT_TEMPO_MAX, Number(pace)));
    if (s > 0 && natural / tempo > s) tempo = Math.min(COUNT_TEMPO_MAX, natural / s);
  } else {
    tempo = 1;
    if (s > 0 && natural > s) tempo = Math.min(MAX_FIT_TEMPO, natural / s);
  }
  tempo = Math.round(tempo * 1000) / 1000;
  const seconds = natural / tempo;
  return { tempo, seconds, overflow: s > 0 && seconds > s * 1.02 };
}

// ---------------------------------------------------------------------------------------------
// Programa de voz (aberto na primeira fala)

let helper = null; // { child, sampleRate, pending: Map, ready: Promise }
let idleTimer = null;
let nextId = 1;

function stopHelper() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const h = helper;
  helper = null;
  if (!h) return;
  for (const { reject } of h.pending.values()) reject(new Error('O programa de voz foi fechado.'));
  h.pending.clear();
  try { h.child.stdin.end(); } catch { /* já fechou */ }
  setTimeout(() => { try { h.child.kill('SIGKILL'); } catch { /* já fechou */ } }, 2000).unref?.();
}

function touch() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(stopHelper, IDLE_RELEASE_MS);
  idleTimer.unref?.();
}

function startHelper() {
  const engine = engineDir();
  // VS_MAESTRO_CPU=1: só no teste do GitHub (máquina virtual sem a placa de vídeo completa)
  const args = ['--model', modelDir(), ...(process.env.VS_MAESTRO_CPU === '1' ? ['--cpu'] : [])];
  const child = spawn(path.join(engine, HELPER), args, {
    cwd: engine,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), TMPDIR: os.tmpdir(), HF_HUB_OFFLINE: '1' },
  });
  const h = { child, sampleRate: 24000, pending: new Map(), stderr: '' };
  let buf = '';
  let readyResolve;
  let readyReject;
  h.ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const loadTimer = setTimeout(() => readyReject(new Error('A voz de IA demorou demais para abrir.')), LOAD_TIMEOUT_MS);

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('@@VS ')) continue; // o resto é conversa da biblioteca
      let msg;
      try { msg = JSON.parse(line.slice(5)); } catch { continue; }
      if (msg.id === 'ready') {
        clearTimeout(loadTimer);
        if (msg.ok) { h.sampleRate = msg.sampleRate || 24000; readyResolve(); } else readyReject(new Error(msg.error || 'A voz de IA não abriu.'));
        continue;
      }
      const p = h.pending.get(msg.id);
      if (!p) continue;
      h.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg); else p.reject(new Error(msg.error || 'A voz de IA não gerou a fala.'));
    }
  });
  child.stderr.on('data', (c) => { h.stderr = (h.stderr + c.toString('utf8')).slice(-4000); });
  const fail = (why) => {
    clearTimeout(loadTimer);
    const err = new Error(why);
    readyReject(err);
    for (const { reject } of h.pending.values()) reject(err);
    h.pending.clear();
    if (helper === h) helper = null;
  };
  child.on('error', (e) => fail(`Não foi possível abrir a voz de IA (${e.message}).`));
  child.on('exit', (code, signal) => fail(`A voz de IA fechou sozinha (${signal || code}).${h.stderr ? ` ${h.stderr.trim().split('\n').pop()}` : ''}`));
  h.ready.catch(() => {});
  return h;
}

async function getHelper() {
  if (!helper) helper = startHelper();
  const h = helper;
  await h.ready;
  return h;
}

function ask(h, req, timeoutMs) {
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      h.pending.delete(id);
      reject(new Error('A voz de IA demorou demais para gerar a fala.'));
      stopHelper(); // travou: abre de novo na próxima
    }, timeoutMs);
    h.pending.set(id, {
      resolve: (m) => { clearTimeout(timer); resolve(m); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    h.child.stdin.write(`${JSON.stringify({ id, ...req })}\n`);
  });
}

/** Uma fala por vez: várias marcações (uma contagem, por exemplo) entram em fila. */
let queue = Promise.resolve();
function serial(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------------------------
// Falas já geradas ficam guardadas: a mesma fala com a mesma voz (mesma semente) sai igual, então
// gerar de novo não precisa esperar o modelo. Ajuda muito na contagem ("Um!", "Dois!"... são sempre
// as mesmas palavras). Trocar o modelo ou a voz muda a chave.

function cacheDir() {
  return path.join(path.dirname(download.modelDir()), 'falas-prontas');
}

const refHashes = new Map();
function refHash(file) {
  const st = fs.statSync(file);
  const id = `${file}|${st.size}|${st.mtimeMs}`;
  if (!refHashes.has(id)) refHashes.set(id, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  return refHashes.get(id);
}

function cacheKey(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40);
}

async function cacheGet(key) {
  try { return await fsp.readFile(path.join(cacheDir(), `${key}.wav`)); } catch { return null; }
}

async function cachePut(key, buf) {
  try {
    const dir = cacheDir();
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${key}.wav`), buf);
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.wav'));
    if (files.length > CACHE_MAX_FILES) {
      const dated = await Promise.all(files.map(async (f) => ({ f, t: (await fsp.stat(path.join(dir, f))).mtimeMs })));
      dated.sort((a, b) => a.t - b.t);
      await Promise.all(dated.slice(0, files.length - CACHE_MAX_FILES).map((d) => fsp.rm(path.join(dir, d.f), { force: true })));
    }
  } catch { /* sem cache: só fica mais lento da próxima vez */ }
}

/** Lê o trecho de referência e o texto dele. */
function referenceOf(voice) {
  const dir = path.join(engineDir(), 'voices');
  return {
    ref: path.join(dir, `${voice.ref}.wav`),
    refText: fs.readFileSync(path.join(dir, `${voice.ref}.txt`), 'utf8').trim(),
  };
}

/** Chave do cache com tudo o que muda o som da voz. */
function voiceKey(voice) {
  const { ref, refText } = referenceOf(voice);
  return [CACHE_VERSION, download.MANIFEST.revision, refHash(ref), refText, seedFor(voice.id), TEMPERATURE, TOP_K];
}

/** Pede uma fala ao programa de voz e devolve as amostras cruas. */
async function generate(text, voice, maxTokens) {
  const h = await getHelper();
  touch();
  const { ref, refText } = referenceOf(voice);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vs-maestro-ia-'));
  try {
    const out = path.join(tmp, 'fala.f32');
    const reply = await ask(h, {
      cmd: 'speak', text, ref, refText, language: 'portuguese',
      seed: seedFor(voice.id), maxTokens, temperature: TEMPERATURE, topK: TOP_K, out,
    }, Math.max(60_000, text.length * 1500));
    const raw = await fsp.readFile(out);
    const samples = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + Math.floor(raw.length / 4) * 4));
    if (samples.length === 0) throw new Error('A voz de IA não gerou áudio.');
    touch();
    return { samples, rate: reply.sampleRate || h.sampleRate, elapsed: reply.elapsed };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Uma fala sozinha (o caso comum). */
async function renderSingle(clean, voice, span, pace) {
  const maxTokens = maxTokensFor(clean);
  const key = cacheKey([...voiceKey(voice), clean, maxTokens]);
  const cached = await cacheGet(key);
  if (cached) {
    const natural = wavSeconds(cached);
    return { buf: cached, natural, ...fitTempo(natural, span, pace), elapsed: 0, cached: true };
  }
  const { samples, rate, elapsed } = await generate(clean, voice, maxTokens);
  const buf = trimSilence(floatToWav(samples, rate), { dropTrailingBlips: true });
  const natural = wavSeconds(buf);
  await cachePut(key, buf);
  return { buf, natural, ...fitTempo(natural, span, pace), elapsed, cached: false };
}

/** A palavra sem pontuação e em minúsculas, para achar o número dentro da contagem. */
function wordKey(w) {
  return cleanText(w).replace(/[.!?,;:…]+/g, '').trim().toLowerCase();
}

/** Texto da contagem falada de uma vez: "Um, dois, três, quatro." */
function countUtterance(words) {
  return `${words.map((w, i) => {
    const bare = cleanText(w).replace(/[.!?,;:…]+$/g, '').trim();
    return i === 0 ? bare : bare.toLowerCase();
  }).join(', ')}.`;
}

/** Contagens que não deu para cortar (nesta sessão): vão número a número, sem tentar de novo. */
const splitFailed = new Set();

/**
 * Os números de uma contagem, falados de uma vez e cortados (mesmo tom e ritmo em todos), ou null
 * se não deu para separar com segurança.
 */
async function countPieces(words, voice) {
  const text = countUtterance(words);
  const maxTokens = maxTokensFor(text);
  const keys = words.map((_, k) => cacheKey([...voiceKey(voice), 'contagem', text, maxTokens, k]));
  const cached = await Promise.all(keys.map(cacheGet));
  if (cached.every(Boolean)) return { pieces: cached, cached: true };
  const failKey = keys[0];
  if (splitFailed.has(failKey)) return null;
  const { samples, rate } = await generate(text, voice, maxTokens);
  const full = removeDcOffset(samples, rate);
  const parts = splitWords(full, rate, words.length);
  if (!parts) { splitFailed.add(failKey); return null; }
  const pieces = parts.map(([s, e]) => trimSilence(floatToWav(full.subarray(s, e), rate), { dropTrailingBlips: true }));
  await Promise.all(pieces.map((b, k) => cachePut(keys[k], b)));
  return { pieces, cached: false };
}

/**
 * Gera a fala com a voz de IA. Devolve o WAV natural (sem silêncio nas pontas, começando justo no
 * primeiro som) e o fator de velocidade que a tela aplica para caber na marcação.
 * `group`: as palavras da contagem a que esta fala pertence ("Um!", "Dois!"...). Aí a contagem é
 * falada de uma vez e cortada, e todos os números recebem a mesma velocidade (a do mais longo).
 */
function render({ text, voice, span, pace, group }) {
  return serial(async () => {
    const why = unavailableReason();
    if (why) throw new Error(why);
    const clean = cleanText(text);
    if (!clean) throw new Error('O texto não tem palavras para falar.');

    if (Array.isArray(group) && group.length >= 2) {
      const words = [];
      for (const w of group) if (wordKey(w) && !words.some((x) => wordKey(x) === wordKey(w))) words.push(w);
      const idx = words.findIndex((w) => wordKey(w) === wordKey(clean));
      if (idx >= 0 && words.length >= 2 && words.length <= 16) {
        const got = await countPieces(words, voice);
        if (got) {
          const naturals = got.pieces.map(wavSeconds);
          const tempo = Math.max(...naturals.map((n) => fitTempo(n, span, pace).tempo));
          const natural = naturals[idx];
          const seconds = natural / tempo;
          return {
            buf: got.pieces[idx], natural, tempo, seconds,
            overflow: Number(span) > 0 && seconds > Number(span) * 1.02, elapsed: 0, cached: got.cached, group: true,
          };
        }
      }
    }
    return renderSingle(clean, voice, span, pace);
  });
}

module.exports = {
  QWEN_VOICES,
  qwenVoiceFor,
  supported,
  engineDir,
  modelDir,
  status,
  unavailableReason,
  render,
  stopHelper,
  // para os testes
  fitTempo,
  cleanText,
  stripCompassLabel,
  maxTokensFor,
  seedFor,
  countUtterance,
};
