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
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { floatToWav, trimSilence, wavSeconds } = require('./maestroAudio');
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
/** O programa fecha depois deste tempo sem falas (devolve a memória). */
const IDLE_RELEASE_MS = 10 * 60 * 1000;
/** Tempo máximo para abrir o programa e carregar o modelo. */
const LOAD_TIMEOUT_MS = 180_000;

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

/** Semente estável por fala: a mesma fala gerada de novo sai igual. */
function seedFor(text, voiceId) {
  let h = 2166136261;
  for (const ch of `${voiceId}|${text}`) {
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

/** Lê o trecho de referência e o texto dele. */
function referenceOf(voice) {
  const dir = path.join(engineDir(), 'voices');
  return {
    ref: path.join(dir, `${voice.ref}.wav`),
    refText: fs.readFileSync(path.join(dir, `${voice.ref}.txt`), 'utf8').trim(),
  };
}

/**
 * Gera a fala com a voz de IA. Devolve o WAV natural (sem silêncio nas pontas, começando justo no
 * primeiro som) e o fator de velocidade que a tela aplica para caber na marcação.
 */
function render({ text, voice, span, pace }) {
  return serial(async () => {
    const why = unavailableReason();
    if (why) throw new Error(why);
    const clean = cleanText(text);
    if (!clean) throw new Error('O texto não tem palavras para falar.');
    const h = await getHelper();
    touch();
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vs-maestro-ia-'));
    try {
      const out = path.join(tmp, 'fala.f32');
      const { ref, refText } = referenceOf(voice);
      const reply = await ask(h, {
        cmd: 'speak', text: clean, ref, refText, language: 'portuguese',
        seed: seedFor(clean, voice.id), maxTokens: maxTokensFor(clean), out,
      }, Math.max(60_000, clean.length * 1500));
      const raw = await fsp.readFile(out);
      const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
      if (samples.length === 0) throw new Error('A voz de IA não gerou áudio.');
      const buf = trimSilence(floatToWav(samples, reply.sampleRate || h.sampleRate));
      const natural = wavSeconds(buf);
      const fit = fitTempo(natural, span, pace);
      touch();
      return { buf, natural, ...fit, elapsed: reply.elapsed };
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
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
};
