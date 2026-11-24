// Voz de IA do Maestro: Qwen3-TTS (Alibaba, Apache-2.0), voz brasileira gerada no próprio Mac.
//
// - Quem fala é o programa vs-maestro-voz (Swift + MLX), que vai junto do app em
//   maestro-voice-engine. O app abre o programa uma vez; ele carrega o modelo e atende as falas
//   uma de cada vez. Depois de 5 min sem falas (ou sem aquecer, maestroWarm) o programa fecha e a
//   memória volta (~2 GB).
// - O modelo (~1,8 GB) é baixado uma vez, em silêncio (maestroVoiceDownload.js).
// - Feminina e masculina foram criadas por IA e não pertencem a ninguém: cada uma
//   é um trecho de referência de ~8 s com o texto dele (maestro-voice-engine/voices).
// - Mac com chip Apple: o programa vs-maestro-voz (MLX, rápido).
// - Mac Intel, Catalina e Windows: o mesmo modelo em PyTorch, no motor de IA embutido
//   (maestroVoiceCpu.py, mesmo protocolo). Bem mais lento: cada fala leva dezenas de segundos e fica
//   guardada. Enquanto não fica pronta, a fala sai com a voz do sistema (maestroVoice.js).
// - Vozes clonadas pelo diretor (maestroClone.js) entram na lista como as de fábrica.
// - O Qwen3-TTS não tem controle de velocidade: aqui se calcula o fator (`tempo`) e a tela estica
//   o áudio com o SoundTouch que o app já usa.
const { spawn } = require('child_process');
const NICE = '/usr/bin/nice';
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { checkCountWord, floatToWav, removeDcOffset, splitWords, trimSilence, wavSeconds } = require('./maestroAudio');
const download = require('./maestroVoiceDownload');
const { isAppleSilicon } = require('./machineArch');
const clones = require('./maestroClone');

/** true: motor no processador (PyTorch), para Mac Intel, Catalina e Windows. */
// VS_MAESTRO_FORCE_CPU=1: testar o motor do processador num Mac com chip Apple
const CPU = process.env.VS_MAESTRO_FORCE_CPU === '1' || !(process.platform === 'darwin' && isAppleSilicon());
const CPU_SCRIPT = 'maestroVoiceCpu.py';

const HELPER = 'vs-maestro-voz';

/** As vozes de IA. `ref` é o nome do trecho de referência em maestro-voice-engine/voices. */
const QWEN_VOICES = [
  { id: 'qwen:feminina', name: 'Voz feminina (IA)', gender: 'feminina', ref: 'feminina' },
  { id: 'qwen:masculina', name: 'Voz masculina (IA)', gender: 'masculina', ref: 'masculina' },
];

// Vozes apagadas em 12/11/2026 (a pedido do dono): Cubas e Keven (gravações dele) e Henrique (voz
// de pessoa real, sem autorização por escrito). Marcação antiga nelas fala com a Masculina.
const REMOVED_VOICES = Object.fromEntries(['cubas', 'keven', 'henrique'].flatMap((v) => [[v, 'qwen:masculina'], [`qwen:${v}`, 'qwen:masculina']]));

/** Fala comum: se não couber na marcação, acelera até aqui. Nunca desacelera (sobra silêncio). */
const MAX_FIT_TEMPO = 1.35;
/** Contagem: faixa da velocidade escolhida e o máximo para caber no tempo do click. */
const COUNT_TEMPO_MIN = 0.85;
const COUNT_TEMPO_MAX = 1.8;
/**
 * O programa fecha 5 min depois da última fala ou do último aquecimento (warm) e devolve a memória
 * (~2 GB). Com 60 s ele fechava enquanto o diretor ainda montava as falas, e cada fala nova pagava
 * a abertura do programa e o preparo da referência de novo (a demora que mais incomodava).
 */
const IDLE_RELEASE_MS = 5 * 60 * 1000;
/**
 * No processador, abrir de novo custa caro (carregar o modelo e preparar a voz: até 1 min), e as
 * falas vêm em sequência enquanto o diretor monta o show. Fica aberto 10 min sem uso.
 */
const CPU_IDLE_RELEASE_MS = 10 * 60 * 1000;
/**
 * Temperatura do modelo: a padrão (0,9). Testado: 0,6 varia um pouco menos o tom, mas às vezes o
 * modelo empaca em silêncio e larga palavras ("Vamos pra ponte." sem o "Segura!").
 */
const TEMPERATURE = 0.9;
const TOP_K = 50;
/** Tempo máximo para abrir o programa e carregar o modelo (a variável serve só para os testes). */
const LOAD_TIMEOUT_MS = Number(process.env.VS_MAESTRO_LOAD_TIMEOUT_MS) || 180_000;
/** Quantas falas prontas ficam guardadas (as mais antigas saem). */
const CACHE_MAX_FILES = 400;
/** Arquivo temporário de gravação mais velho que isto sobrou de um app fechado no meio. */
const CACHE_TMP_MAX_AGE_MS = 60 * 60 * 1000;
/** Muda quando o tratamento do áudio muda (corte do silêncio etc.): as falas antigas não servem mais. */
const CACHE_VERSION = 6;
/**
 * Corte das pontas das vozes clonadas (speechOnset). Fica fora do CACHE_VERSION para não mexer nas
 * vozes de fábrica. As frases salvas com o corte antigo continuam valendo (pinnedFileFor).
 */
const CLONE_TRIM_VERSION = 2;

/** A voz pedida: 'feminina'/'masculina'/'henrique', o id de uma voz de IA ou de uma voz clonada. */
function qwenVoiceFor(wanted) {
  const short = { feminina: 'qwen:feminina', masculina: 'qwen:masculina', ...REMOVED_VOICES };
  const id = short[wanted] ?? wanted;
  return QWEN_VOICES.find((v) => v.id === id) ?? clones.voiceFor(id);
}

/** As vozes que o seletor mostra (as aposentadas ficam só para marcações antigas). */
const OFFERED_VOICES = QWEN_VOICES.filter((v) => !v.retired);

// ---------------------------------------------------------------------------------------------
// Onde estão as coisas

/**
 * O MLX só roda em Mac com chip Apple (um app Intel traduzido no chip Apple também roda). Nos
 * outros, o motor no processador, se o Python embutido veio no app.
 */
function supported() {
  return CPU ? !!cpuPython() : true;
}

/** Python do motor de IA embutido (o mesmo da separação de faixas), para o motor no processador. */
function cpuPython() {
  const rel = process.platform === 'win32' ? ['python', 'python.exe'] : ['python', 'bin', 'python3'];
  const candidates = [
    process.env.VS_MAESTRO_PYTHON,
    process.resourcesPath && path.join(process.resourcesPath, 'ai-engine', ...rel),
    path.join(__dirname, 'ai-engine', ...rel),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** O script do motor no processador: fora do app.asar, que o Python não abre. */
function cpuScript() {
  return path.join(__dirname, CPU_SCRIPT).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

/** Pasta com o programa de voz e as vozes: dentro do app instalado ou, em desenvolvimento, aqui. */
function engineDir() {
  const candidates = [
    process.env.VS_MAESTRO_ENGINE_DIR,
    process.resourcesPath && path.join(process.resourcesPath, 'maestro-voice-engine'),
    path.join(__dirname, 'maestro-voice-engine'),
  ].filter(Boolean);
  return candidates.find((d) => (CPU || fs.existsSync(path.join(d, HELPER)))
    && OFFERED_VOICES.every((v) => fs.existsSync(path.join(d, 'voices', `${v.ref}.wav`)))) ?? null;
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
  if (!s.supported) return 'A voz brasileira de IA não veio completa nesta instalação.';
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

let helper = null; // { child, sampleRate, pending: Map, ready: Promise, lastRef }
let idleTimer = null;
let nextId = 1;

function stopHelper() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const h = helper;
  helper = null;
  if (!h) return;
  h.dead = true;
  for (const { reject } of h.pending.values()) reject(new Error('O programa de voz foi fechado.'));
  h.pending.clear();
  try { h.child.stdin.end(); } catch { /* já fechou */ }
  setTimeout(() => { try { h.child.kill('SIGKILL'); } catch { /* já fechou */ } }, 2000).unref?.();
}

/** Tempo ocioso acabou: fecha o programa, a não ser que ainda tenha fala sendo gerada. */
function idleExpired() {
  idleTimer = null;
  if (helper && helper.pending.size > 0) { touch(); return; } // fala longa em andamento: espera ela
  stopHelper();
}

function touch() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(idleExpired, CPU ? CPU_IDLE_RELEASE_MS : IDLE_RELEASE_MS);
  idleTimer.unref?.();
}

function startHelper() {
  const engine = engineDir();
  // VS_MAESTRO_CPU=1: só no teste do GitHub (máquina virtual sem a placa de vídeo completa)
  const args = ['--model', modelDir(), ...(process.env.VS_MAESTRO_CPU === '1' ? ['--cpu'] : [])];
  const env = process.platform === 'win32'
    ? { ...process.env, HF_HUB_OFFLINE: '1' }
    : { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), TMPDIR: os.tmpdir(), HF_HUB_OFFLINE: '1' };
  // Prioridade um pouco abaixo do normal (nice 10): a música e a tela vêm primeiro quando
  // disputam o processador, mas a voz usa tudo o que estiver livre. Antes era o QoS "utility"
  // (taskpolicy -c utility), que prende o programa nos núcleos lentos e na placa de vídeo
  // reduzida: num Mac de 8 GB com pouca memória livre a fala passava de 60 s e era cancelada
  // (medido em 20/11/2026: 15 s direto, mais de 60 s com o utility). O áudio do programa roda
  // em tempo real e não perde para o nice.
  const [cmd, cmdArgs] = CPU
    ? [cpuPython(), [cpuScript(), '--model', modelDir()]]
    : [path.join(engine, HELPER), args];
  const lowPriority = process.platform === 'darwin' && fs.existsSync(NICE);
  const child = spawn(lowPriority ? NICE : cmd, lowPriority ? ['-n', '10', cmd, ...cmdArgs] : cmdArgs, {
    cwd: engine,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    windowsHide: true,
  });
  // Sem o /usr/bin/nice (Windows, com o motor no processador): a mesma prioridade pelo Node,
  // BELOW_NORMAL no Windows e nice 10 no resto. Antes a voz rodava em prioridade normal no Windows.
  if (!lowPriority) {
    try {
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch { /* já saiu, ou o sistema não deixou: segue na prioridade normal */ }
  }
  const h = { child, sampleRate: 24000, pending: new Map(), stderr: '' };
  let buf = '';
  let readyResolve;
  let readyReject;
  h.ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Passou do tempo: descarta este processo. Vivo, ele seguraria ~2 GB e toda fala seguinte
  // falharia na hora, até reiniciar o app. Morto já, a próxima fala abre um novo sem dois modelos
  // disputando a memória.
  const loadTimer = setTimeout(() => {
    readyReject(new Error('A voz de IA demorou demais para abrir.'));
    if (helper === h) stopHelper();
    try { child.kill('SIGKILL'); } catch { /* já fechou */ }
  }, LOAD_TIMEOUT_MS);

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
    h.dead = true;
    clearTimeout(loadTimer);
    const err = new Error(why);
    readyReject(err);
    for (const { reject } of h.pending.values()) reject(err);
    h.pending.clear();
    if (helper === h) helper = null;
  };
  child.on('error', (e) => fail(`Não foi possível abrir a voz de IA (${e.message}).`));
  // escrever num programa que acabou de morrer (EPIPE) não pode derrubar o processo principal
  child.stdin.on('error', (e) => {
    fail(`A voz de IA fechou sozinha (${e.code || e.message}).`);
    try { child.kill('SIGKILL'); } catch { /* já fechou */ }
  });
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
    // morreu entre ficar pronto e receber o pedido: avisa já, sem prender a fila até o tempo limite
    if (h.dead || !h.child.stdin.writable) {
      reject(new Error('A voz de IA fechou sozinha antes de receber a fala.'));
      return;
    }
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

// ---------------------------------------------------------------------------------------------
// Fila das falas: o modelo gera uma por vez, e cada fala nova custa de 17 a 51 s num Mac de 8 GB
// sem memória livre. Por isso a fila nunca faz o diretor esperar por trabalho evitável:
// - o que ele acabou de pedir passa à frente (a fala que já está gerando termina, não é morta);
// - pedido idêntico entra no mesmo trabalho: prévia e Gerar usam a mesma geração e o mesmo cache;
// - cancelar só solta quem esperava. O que já está gerando termina e fica no cache; o que ainda
//   não começou e ficou sem ninguém esperando sai da fila, sem gerar;
// - frases salvas e aquecimento esperam a música parar; o aquecimento sai da fila se chegar fala.

/** Ordem da fila: menor passa à frente. */
const PRIORITY = { USER: 0, BACKGROUND: 1, PIN: 2, PACK: 3, WARM: 4 };

/** Prioridade pedida pela tela: 'fundo' é a atualização automática; o resto é pedido do diretor. */
function priorityOf(name) {
  return name === 'fundo' ? PRIORITY.BACKGROUND : PRIORITY.USER;
}

function canceledError() {
  const err = new Error('fala_cancelada');
  err.canceled = true;
  return err;
}

/** `isHeld(prioridade)`: true segura os trabalhos dessa prioridade na fila. */
function createSpeechQueue({ isHeld = () => false } = {}) {
  const jobs = new Map(); // chave → trabalho na fila ou rodando
  let running = null;
  let order = 0;
  const rankOf = (job) => Math.min(...job.waiters.map((w) => w.priority));

  function finish(job, settle) {
    jobs.delete(job.key);
    running = null;
    for (const w of job.waiters) settle(w);
    job.waiters = [];
    pump();
  }

  function pump() {
    if (running) return;
    let best = null;
    let bestRank = Infinity;
    for (const job of jobs.values()) {
      const rank = rankOf(job);
      if (isHeld(rank)) continue;
      if (rank < bestRank || (rank === bestRank && job.order < best.order)) { best = job; bestRank = rank; }
    }
    if (!best) return;
    const job = best;
    running = job;
    Promise.resolve().then(job.run).then(
      (value) => finish(job, (w) => w.resolve(value)),
      (err) => finish(job, (w) => w.reject(err)),
    );
  }

  /**
   * Entra na fila (ou no trabalho idêntico que já existe). `yields`: sai da fila, com null, se
   * chegar qualquer outro trabalho antes de começar (o aquecimento).
   */
  function add({ key, priority = PRIORITY.USER, run, yields = false }) {
    if (!yields) {
      for (const other of [...jobs.values()]) {
        if (!other.yields || other === running) continue;
        jobs.delete(other.key);
        for (const w of other.waiters) w.resolve(null);
      }
    }
    let job = jobs.get(key);
    if (!job) {
      job = { key, run, yields, order: order++, waiters: [] };
      jobs.set(key, job);
    }
    let waiter;
    const promise = new Promise((resolve, reject) => {
      waiter = { priority, resolve, reject };
      job.waiters.push(waiter);
    });
    pump();
    const cancel = () => {
      const at = job.waiters.indexOf(waiter);
      if (at < 0) return false;
      job.waiters.splice(at, 1);
      if (job !== running && job.waiters.length === 0) jobs.delete(job.key);
      waiter.reject(canceledError());
      pump();
      return true;
    };
    return { promise, cancel };
  }

  return {
    add,
    pump,
    size: () => jobs.size,
    /** 'gerando', 'na-fila' ou null. */
    stateOf: (key) => (running?.key === key ? 'gerando' : jobs.has(key) ? 'na-fila' : null),
  };
}

// Frases salvas e aquecimento não disputam a máquina com a música (`playing`, mais abaixo).
const speechQueue = createSpeechQueue({ isHeld: (rank) => rank >= PRIORITY.PIN && playing });

/** Pedidos da tela que podem ser cancelados: requestId → { cancelled, cancel }. */
const requests = new Map();

function openRequest(requestId) {
  if (typeof requestId !== 'string' || !requestId) return null;
  const request = { cancelled: false, cancel: null };
  requests.set(requestId, request);
  return request;
}

function closeRequest(requestId, request) {
  if (request && requests.get(requestId) === request) requests.delete(requestId);
}

/** A tela desistiu de esperar: a geração continua e o resultado fica no cache. */
function cancelRender(requestId) {
  const request = requests.get(String(requestId));
  if (!request) return false;
  request.cancelled = true;
  request.cancel?.();
  return true;
}

function schedule(key, { priority = PRIORITY.USER, request = null } = {}, run) {
  if (request?.cancelled) return Promise.reject(canceledError());
  const { promise, cancel } = speechQueue.add({ key, priority, run });
  if (request) request.cancel = cancel;
  return promise;
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

/**
 * Frases salvas pelo diretor (Minhas frases): gravações permanentes, uma subpasta por voz. Nunca
 * entram no limite do cache (CACHE_MAX_FILES). A chave é a mesma da fala comum, então a fala que
 * sai na marcação vem daqui na hora. Voz clonada regravada muda a chave (hash da referência).
 */
function pinnedDir() {
  return path.join(path.dirname(download.modelDir()), 'frases-salvas');
}

function pinnedFile(voice, key) {
  const folder = String(voice.id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'voz';
  return path.join(pinnedDir(), folder, `${key}.wav`);
}

/** Onde procurar a gravação permanente de cada chave (preenchido por singleKey). */
const pinnedPaths = new Map();

/** O arquivo é um WAV com áudio de verdade? (vazio ou só com cabeçalho seria fala muda) */
function playableWav(buf) {
  try { return wavSeconds(buf) > 0; } catch { return false; }
}

async function cacheGet(key) {
  const pinned = pinnedPaths.get(key);
  if (pinned) {
    try {
      const buf = await fsp.readFile(pinned);
      if (playableWav(buf)) return buf;
    } catch { /* não está salva: procura no cache */ }
  }
  const file = path.join(cacheDir(), `${key}.wav`);
  let buf;
  try { buf = await fsp.readFile(file); } catch { return null; }
  if (playableWav(buf)) return buf;
  // gravação quebrada (de versão antiga, app fechado no meio): sai para a fala ser gerada de novo
  await fsp.rm(file, { force: true }).catch(() => {});
  return null;
}

async function cachePut(key, buf) {
  try {
    const dir = cacheDir();
    await fsp.mkdir(dir, { recursive: true });
    // grava ao lado e troca de uma vez: quem lê nunca pega o arquivo pela metade
    const file = path.join(dir, `${key}.wav`);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, file);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    const names = await fsp.readdir(dir);
    await Promise.all(names.filter((f) => f.endsWith('.tmp')).map(async (f) => {
      const old = path.join(dir, f);
      try {
        if (Date.now() - (await fsp.stat(old)).mtimeMs > CACHE_TMP_MAX_AGE_MS) await fsp.rm(old, { force: true });
      } catch { /* outro já limpou */ }
    }));
    const files = names.filter((f) => f.endsWith('.wav'));
    if (files.length > CACHE_MAX_FILES) {
      const dated = await Promise.all(files.map(async (f) => ({ f, t: (await fsp.stat(path.join(dir, f))).mtimeMs })));
      dated.sort((a, b) => a.t - b.t);
      await Promise.all(dated.slice(0, files.length - CACHE_MAX_FILES).map((d) => fsp.rm(path.join(dir, d.f), { force: true })));
    }
  } catch { /* sem cache: só fica mais lento da próxima vez */ }
}

/** Lê o trecho de referência e o texto dele. */
function referenceOf(voice) {
  // voz clonada: o trecho fica na pasta do diretor (maestroClone.js)
  if (voice.refPath) return { ref: voice.refPath, refText: fs.readFileSync(voice.refTextPath, 'utf8').trim() };
  const dir = path.join(engineDir(), 'voices');
  return {
    ref: path.join(dir, `${voice.ref}.wav`),
    refText: fs.readFileSync(path.join(dir, `${voice.ref}.txt`), 'utf8').trim(),
  };
}

/** Chave do cache com tudo o que muda o som da voz. */
function voiceKey(voice, trimVersion = CLONE_TRIM_VERSION) {
  const { ref, refText } = referenceOf(voice);
  const key = [CACHE_VERSION, download.MANIFEST.revision, refHash(ref), refText, seedFor(voice.id), TEMPERATURE, TOP_K];
  // voz clonada: a fala gerada passa pela masterização da própria voz (as antigas mantêm a delas)
  if (voice.clone) {
    key.push(`master${voice.masterVersion ?? clones.LEGACY_MASTER_VERSION}`);
    if (trimVersion) key.push(`corte${trimVersion}`);
  }
  return key;
}

/** Pede uma fala ao programa de voz e devolve as amostras cruas. */
let lastSpeechAt = 0; // última fala de verdade (o aquecimento não conta)

async function generate(text, voice, maxTokens, opts = {}) {
  const h = await getHelper();
  touch();
  const { ref, refText } = referenceOf(voice);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vs-maestro-ia-'));
  try {
    if (helper !== h) throw new Error('A voz de IA fechou sozinha antes de receber a fala.');
    const out = path.join(tmp, 'fala.f32');
    const reply = await ask(h, {
      cmd: 'speak', text, ref, refText, language: 'portuguese',
      seed: opts.seed ?? seedFor(voice.id), maxTokens, temperature: TEMPERATURE, topK: TOP_K, out,
    }, CPU ? Math.max(600_000, text.length * 15_000) : Math.max(150_000, text.length * 4000));
    h.lastRef = ref; // o programa guarda o preparo da última referência usada
    if (!opts.discard) lastSpeechAt = Date.now();
    const raw = await fsp.readFile(out);
    const samples = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + Math.floor(raw.length / 4) * 4));
    if (samples.length === 0) throw new Error('A voz de IA não gerou áudio.');
    touch();
    return { samples, rate: reply.sampleRate || h.sampleRate, elapsed: reply.elapsed };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Uma fala sozinha (o caso comum). `onlyCache`: só devolve se já estiver pronta (senão, null). */
/** Chave da fala comum (sem contagem). Também diz ao cacheGet onde fica a gravação permanente. */
function singleKey(clean, voice) {
  const key = cacheKey([...voiceKey(voice), clean, maxTokensFor(clean)]);
  pinnedPaths.set(key, pinnedFileFor(voice, clean, key));
  return key;
}

/**
 * O arquivo permanente da frase. Voz clonada: a frase salva antes do corte novo tem outra chave e
 * continua valendo como está, sem gerar de novo.
 */
function pinnedFileFor(voice, clean, key) {
  const file = pinnedFile(voice, key);
  if (!voice.clone || fs.existsSync(file)) return file;
  const old = legacyPinnedFile(voice, clean);
  return fs.existsSync(old) ? old : file;
}

/** Onde a frase desta voz clonada foi salva antes do corte novo. */
function legacyPinnedFile(voice, clean) {
  return pinnedFile(voice, cacheKey([...voiceKey(voice, 0), clean, maxTokensFor(clean)]));
}

/** Como cortar a fala gerada: a voz clonada entra no ataque real, sem estalo. */
function trimOptions(voice) {
  return { dropTrailingBlips: true, tightStart: true, preciseEdges: !!voice.clone };
}

async function renderSingle(clean, voice, span, pace, onlyCache = false, job = {}) {
  const maxTokens = maxTokensFor(clean);
  const key = singleKey(clean, voice);
  const cached = await cacheGet(key);
  if (cached) {
    const natural = wavSeconds(cached);
    return { buf: cached, natural, ...fitTempo(natural, span, pace), elapsed: 0, cached: true };
  }
  if (onlyCache) return null;
  const made = await schedule(key, job, async () => {
    // outro pedido pode ter gerado esta fala enquanto este esperava a vez
    const ready = await cacheGet(key);
    if (ready) return { buf: ready, elapsed: 0, cached: true };
    const { samples, rate, elapsed } = await generate(clean, voice, maxTokens);
    let buf = trimSilence(floatToWav(samples, rate), trimOptions(voice));
    if (voice.clone) buf = clones.masterSpeech(buf, voice.masterVersion); // começo e fim exatos
    await cachePut(key, buf);
    return { buf, elapsed, cached: false };
  });
  const natural = wavSeconds(made.buf);
  return { buf: made.buf, natural, ...fitTempo(natural, span, pace), elapsed: made.elapsed, cached: made.cached };
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
async function countPieces(words, voice, onlyCache = false, job = {}) {
  const text = countUtterance(words);
  const maxTokens = maxTokensFor(text);
  const keys = words.map((_, k) => cacheKey([...voiceKey(voice), 'contagem', text, maxTokens, k]));
  const cached = await Promise.all(keys.map(cacheGet));
  if (cached.every(Boolean)) return { pieces: cached, cached: true };
  const failKey = keys[0];
  if (splitFailed.has(failKey)) return null;
  if (onlyCache) return MISS;
  return schedule(`contagem:${failKey}`, job, async () => {
    const ready = await Promise.all(keys.map(cacheGet));
    if (ready.every(Boolean)) return { pieces: ready, cached: true };
    const { samples, rate } = await generate(text, voice, maxTokens);
    const full = removeDcOffset(samples, rate);
    // tamanho esperado de cada número: pelas letras ("quatro" é mais longo que "um")
    const parts = splitWords(full, rate, words.length, words.map((w) => wordKey(w).replace(/\s+/g, '').length));
    if (!parts) { splitFailed.add(failKey); return null; }
    const pieces = parts.map(([s, e]) => {
      const piece = trimSilence(floatToWav(full.subarray(s, e), rate), trimOptions(voice));
      return voice.clone ? clones.masterSpeech(piece, voice.masterVersion) : piece;
    });
    await Promise.all(pieces.map((b, k) => cachePut(keys[k], b)));
    return { pieces, cached: false };
  });
}

/**
 * Gera a fala com a voz de IA. Devolve o WAV natural (sem silêncio nas pontas, começando justo no
 * primeiro som) e o fator de velocidade que a tela aplica para caber na marcação.
 * `group`: as palavras da contagem a que esta fala pertence ("Um!", "Dois!"...). Aí a contagem é
 * falada de uma vez e cortada, e todos os números recebem a mesma velocidade (a do mais longo).
 */
const MISS = Symbol('ainda não gerada');

async function render(args) {
  const request = openRequest(args.requestId);
  try {
    if (CPU) return await renderCpu(args);
    // fala já gravada (cache ou frase salva) sai na hora, sem passar pela fila
    const hit = await renderNow(args, true).catch(() => null);
    if (hit) return hit;
    return await renderNow(args, false, { priority: priorityOf(args.priority), request });
  } finally {
    closeRequest(args.requestId, request);
  }
}

// No processador cada fala leva dezenas de segundos: a fala nova é gerada em segundo plano (uma por
// vez) e a tela usa a voz do sistema até ela ficar pronta. A tela pergunta de tempos em tempos
// (isReady) e troca a fala quando a de IA chega.
const background = new Map(); // chave → geração em andamento
const backgroundFailed = new Map(); // chave → { message, at } (espera FAILED_RETRY_MS para tentar de novo)
/** Depois de uma falha de verdade, a mesma fala só é tentada de novo depois deste tempo. */
const FAILED_RETRY_MS = 5 * 60 * 1000;

/** Falha passageira (programa fechado pelo tempo, travou, Mac dormiu): não marca a fala como falha. */
function transientFailure(message) {
  return /foi fechado|fechou sozinha|demorou demais/i.test(String(message));
}

/** A fala falhou há pouco (e não deve ser tentada de novo agora)? Limpa a falha vencida. */
function recentFailure(key) {
  const f = backgroundFailed.get(key);
  if (!f) return null;
  if (Date.now() - f.at >= FAILED_RETRY_MS) { backgroundFailed.delete(key); return null; }
  return f;
}

/** Começa a gerar a fala em segundo plano (uma por vez), se já não estiver gerando. */
function startBackground(args) {
  const key = backgroundKey(args);
  if (background.has(key)) return;
  const job = renderNow(args, false, { priority: priorityOf(args.priority) })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!transientFailure(message)) backgroundFailed.set(key, { message, at: Date.now() });
    })
    .finally(() => background.delete(key));
  background.set(key, job);
}

function backgroundKey({ text, voice, group }) {
  return JSON.stringify([cleanText(text), voice?.id, Array.isArray(group) ? group : null]);
}

async function renderCpu(args) {
  // fala já gravada sai do disco mesmo com o modelo indisponível
  const hit = await renderNow(args, true);
  if (hit) return hit;
  const why = unavailableReason();
  if (why) throw new Error(why);
  const key = backgroundKey(args);
  const failed = recentFailure(key);
  if (failed) throw new Error(failed.message);
  startBackground(args);
  const err = new Error('A voz de IA está preparando esta fala no processador (leva cerca de 1 minuto).');
  err.preparing = true;
  throw err;
}

/**
 * Estado da fala de IA: 'pronta' (guardada), 'preparando' (gerando em segundo plano) ou 'falhou'
 * (falhou há pouco; é tentada de novo depois de FAILED_RETRY_MS). No processador, uma fala que não
 * está pronta nem gerando (a geração caiu por um motivo passageiro, ou a falha venceu) volta para a fila.
 */
async function readyState(args) {
  if (unavailableReason()) return 'falhou';
  try {
    if (await renderNow(args, true)) return 'pronta';
  } catch {
    return 'falhou';
  }
  if (!CPU) return 'preparando';
  const key = backgroundKey(args);
  if (background.has(key)) return 'preparando';
  if (recentFailure(key)) return 'falhou';
  startBackground(args);
  return 'preparando';
}

/**
 * A fala de IA já está pronta (guardada)? Usado pela tela para trocar a voz de reserva.
 * Uma fala que falhou responde true para a tela parar de esperar e seguir com a voz do sistema;
 * passado FAILED_RETRY_MS ela volta a ser preparada.
 */
async function isReady(args) {
  if (unavailableReason()) return false;
  return (await readyState(args)) !== 'preparando';
}

async function renderNow({ text, voice, span, pace, group }, onlyCache, job = {}) {
  {
    // só gerar precisa do modelo: ler a gravação permanente, não
    const why = unavailableReason();
    if (why && !onlyCache) throw new Error(why);
    const clean = cleanText(text);
    if (!clean) throw new Error('O texto não tem palavras para falar.');

    if (Array.isArray(group) && group.length >= 2) {
      const words = [];
      for (const w of group) if (wordKey(w) && !words.some((x) => wordKey(x) === wordKey(w))) words.push(w);
      const idx = words.findIndex((w) => wordKey(w) === wordKey(clean));
      if (idx >= 0 && words.length >= 2 && words.length <= 16) {
        // voz clonada: o grupo inteiro vem do pacote; se um número não sai, o grupo inteiro cai na
        // contagem falada de uma vez. Nunca mistura as duas, nem calcula o tempo com o grupo pela metade
        const fromPack = voice.clone ? await packPieces(words, idx, voice, onlyCache, job) : null;
        if (fromPack === MISS) return null;
        const got = fromPack ?? await countPieces(words, voice, onlyCache, job);
        if (got === MISS) return null;
        if (got) {
          const naturals = got.pieces.map(wavSeconds);
          const tempo = Math.max(...naturals.map((n) => fitTempo(n, span, pace).tempo));
          const natural = wavSeconds(got.pieces[idx]);
          const seconds = natural / tempo;
          return {
            buf: got.pieces[idx], natural, tempo, seconds,
            overflow: Number(span) > 0 && seconds > Number(span) * 1.02, elapsed: 0, cached: got.cached, group: true,
          };
        }
      }
    }
    return renderSingle(clean, voice, span, pace, onlyCache, job);
  }
}

/**
 * Situação da fala sem gerar nada: 'pronta' (toca na hora), 'gerando', 'na-fila', 'falhou' (há
 * pouco, no processador) ou 'nao' (ninguém pediu ainda).
 */
async function speechState(args) {
  if (unavailableReason()) return 'nao';
  try {
    if (await renderNow(args, true)) return 'pronta';
    const clean = cleanText(args.text);
    const queueKeys = [singleKey(clean, args.voice)];
    const states = [];
    if (Array.isArray(args.group) && args.group.length >= 2) {
      const words = [];
      for (const w of args.group) if (wordKey(w) && !words.some((x) => wordKey(x) === wordKey(w))) words.push(w);
      if (words.length >= 2) {
        const utterance = countUtterance(words);
        queueKeys.push(`contagem:${cacheKey([...voiceKey(args.voice), 'contagem', utterance, maxTokensFor(utterance), 0])}`);
        if (args.voice.clone) for (const w of words) states.push(packWordState(args.voice, w));
      }
    }
    states.push(...queueKeys.map((k) => speechQueue.stateOf(k)));
    if (args.voice.clone) states.push(packWordState(args.voice, clean));
    if (states.includes('gerando')) return 'gerando';
    if (states.includes('na-fila')) return 'na-fila';
    return CPU && recentFailure(backgroundKey(args)) ? 'falhou' : 'nao';
  } catch {
    return 'falhou';
  }
}

// ---------------------------------------------------------------------------------------------
// Frases salvas (Minhas frases): gravação permanente por voz. Gera se precisar (a mesma geração
// das falas, na mesma fila) e guarda fora do cache. Com música tocando, a gravação espera parar.

/** Gravações em andamento: caminho do arquivo permanente → { promise, request }. */
const pinJobs = new Map();
/** Gravações que falharam há pouco: caminho → { message, at }. */
const pinFailed = new Map();

let playing = false;
/** A tela avisa quando a música toca (main.js, maestroVoicePlaying). */
function setPlaying(on) {
  playing = !!on;
  if (!playing) speechQueue.pump(); // o que esperava a música parar volta a andar
}

/** A voz e o arquivo permanente da frase, ou um erro dizendo por que esta voz não grava. */
function pinTarget(text, voiceId) {
  const clean = cleanText(text);
  if (!clean) throw new Error('A frase não tem palavras para gravar.');
  const voice = qwenVoiceFor(voiceId);
  if (!voice) throw new Error('Esta voz não grava frases (só as vozes de IA e as clonadas).');
  const key = singleKey(clean, voice);
  return { clean, voice, key, file: pinnedPaths.get(key) };
}

async function writePinned(file, buf) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, file);
}

/**
 * Grava a frase para a voz, para sempre. Devolve 'gravada' quando o arquivo está salvo (na hora,
 * se a fala já estava no cache). Pode demorar: no chip Apple de 15 s a 70 s, no processador
 * minutos. Gravar a mesma frase duas vezes espera a mesma gravação. Devolve 'cancelada' se a
 * frase foi apagada antes de terminar (nada fica salvo).
 */
async function pinPhrase({ text, voice: voiceId }) {
  const why = unavailableReason();
  if (why) throw new Error(why);
  const { clean, voice, key, file } = pinTarget(text, voiceId);
  if (fs.existsSync(file)) return 'gravada';
  if (pinJobs.has(file)) return pinJobs.get(file).promise;
  const request = { cancelled: false, cancel: null };
  const job = (async () => {
    // já gerada antes (cache comum): só copia, e só se o arquivo estiver bom
    let buf = await cacheGet(key);
    // mesma fila das falas, atrás do que o diretor pedir e só com a música parada. Se ele pedir
    // esta mesma frase, os dois pedidos viram um trabalho só, com a prioridade do pedido dele.
    if (!buf) buf = (await renderSingle(clean, voice, 0, undefined, false, { priority: PRIORITY.PIN, request })).buf;
    if (request.cancelled) throw canceledError();
    await writePinned(file, buf);
    pinFailed.delete(file);
    return 'gravada';
  })().catch((err) => {
    if (err?.canceled) return 'cancelada';
    throw err;
  });
  pinJobs.set(file, { promise: job, request });
  try {
    return await job;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!transientFailure(message)) pinFailed.set(file, { message, at: Date.now() });
    throw err;
  } finally {
    pinJobs.delete(file);
  }
}

/** Apaga a gravação permanente da frase nessa voz (a fala pode continuar no cache comum). */
async function unpinPhrase({ text, voice: voiceId }) {
  let target;
  try { target = pinTarget(text, voiceId); } catch { return false; }
  // gravação em andamento: sai da fila na hora, sem esperar a música parar nem gerar à toa. Se já
  // estiver gerando, a fala termina no cache comum, mas não vira frase salva. Espera o fim para
  // apagar depois de qualquer escrita (senão o arquivo volta).
  const running = pinJobs.get(target.file);
  if (running) {
    running.request.cancelled = true;
    running.request.cancel?.();
    await running.promise.catch(() => {});
  }
  pinFailed.delete(target.file);
  await fsp.rm(target.file, { force: true }).catch(() => {});
  return true;
}

/**
 * Situação de várias frases numa voz, sem gerar nada: 'gravada', 'gravando', 'falhou' (há pouco)
 * ou 'nao' (ainda não gravada nesta voz).
 */
function pinnedStates({ texts, voice: voiceId }) {
  const out = {};
  for (const text of Array.isArray(texts) ? texts : []) {
    const t = String(text ?? '');
    try {
      const { file } = pinTarget(t, voiceId);
      const failed = pinFailed.get(file);
      if (failed && Date.now() - failed.at >= FAILED_RETRY_MS) pinFailed.delete(file);
      out[t] = fs.existsSync(file) ? 'gravada' : pinJobs.has(file) ? 'gravando' : pinFailed.has(file) ? 'falhou' : 'nao';
    } catch {
      out[t] = 'nao';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pacote de contagem das vozes clonadas: cada número gravado sozinho, por voz e modo, guardado na
// pasta da voz (sai junto quando a voz é apagada). Assim a contagem entra na hora, sem chamar o
// modelo. Roda atrás de tudo o que o diretor pedir, um número por vez, espera a música parar e
// retoma de onde parou, porque o que já foi gravado fica no disco.

/** As palavras do CountInDialog (NUMBER_WORDS em src/lib/narrations.ts) e as sílabas de cada uma. */
const COUNT_WORDS = [
  ['Um', 1], ['Dois', 1], ['Três', 1], ['Quatro', 2], ['Cinco', 2], ['Seis', 1], ['Sete', 2], ['Oito', 2],
  ['Nove', 2], ['Dez', 1], ['Onze', 2], ['Doze', 2], ['Treze', 2], ['Catorze', 3], ['Quinze', 2], ['Dezesseis', 3],
].map(([word, syllables]) => ({ word, syllables, slug: word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }));
/** Muda quando o preparo dos números muda: a pasta antiga é trocada por uma nova. */
const PACK_VERSION = 1;
/** Quantas vezes um número é gerado até sair bom. */
const PACK_MAX_ATTEMPTS = 3;
/** Falhas passageiras seguidas (programa fechou, demorou) até parar e retomar depois. */
const PACK_TRANSIENT_LIMIT = 2;
/** Número fora disto em relação à mediana dos outros soa como outra pessoa (cerca de 5 semitons). */
const PACK_PITCH_RATIO = 1.33;

const packs = new Map(); // id da voz → pacote
const packOrder = [];
const packWordJobs = new Map(); // arquivo → { promise, ctx }
const packPitches = new Map(); // arquivo → tom em Hz
const packWrites = new Map(); // arquivo → gravação em disco em andamento
let packLoop = false;
let packListener = null;

/** main.js avisa a tela do andamento por aqui. */
function setCountPackListener(fn) {
  packListener = fn;
}

const packEntry = (word) => COUNT_WORDS.find((e) => e.word.toLowerCase() === wordKey(word)) ?? null;

function packFolder(voice) {
  const { ref } = referenceOf(voice);
  return path.join(voice.dir, 'contagem', `${voice.mode}-v${PACK_VERSION}-${refHash(ref).slice(0, 12)}`);
}

const packFile = (voice, entry) => path.join(packFolder(voice), `${entry.slug}.wav`);

/** Limite de tokens de um número: folga para o silêncio inicial do modelo, sem deixar inventar. */
const packTokens = (syllables) => Math.ceil((1.7 + 0.3 * syllables) * 12.5);

async function readPlayable(file) {
  try {
    const buf = await fsp.readFile(file);
    return playableWav(buf) ? buf : null;
  } catch {
    return null;
  }
}

function pitchFromWav(buf) {
  try {
    const { samples, rate } = clones.readWavMono(buf);
    return clones.pitchOf(samples, rate) ?? null;
  } catch {
    return null;
  }
}

/** Tom mediano dos números já gravados nesta voz e modo (null com menos de 3). */
async function medianPackPitch(voice) {
  const found = [];
  for (const entry of COUNT_WORDS) {
    const file = packFile(voice, entry);
    if (!packPitches.has(file)) {
      const buf = await readPlayable(file);
      if (!buf) continue;
      packPitches.set(file, pitchFromWav(buf));
    }
    const hz = packPitches.get(file);
    if (hz) found.push(hz);
  }
  if (found.length < 3) return null;
  found.sort((a, b) => a - b);
  return found[Math.floor(found.length / 2)];
}

const pitchDistance = (hz, median) => (hz && median ? Math.max(hz / median, median / hz) : 1);

/**
 * Salva o número sem nunca recriar a pasta da voz: as subpastas nascem uma a uma, então com a voz
 * apagada a gravação falha em vez de trazer a pasta de volta.
 */
function writePackWord(voice, file, buf) {
  const write = (async () => {
    try {
      for (const dir of [path.join(voice.dir, 'contagem'), path.dirname(file)]) {
        await fsp.mkdir(dir).catch((err) => { if (err?.code !== 'EEXIST') throw err; });
      }
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, file);
    } catch (err) {
      if (err?.code === 'ENOENT' && !clones.voiceFor(voice.id)) throw canceledError();
      throw err;
    }
  })().finally(() => packWrites.delete(file));
  packWrites.set(file, write);
  return write;
}

/**
 * Grava um número: gera, corta no ataque, confere e tenta de novo com outra semente se saiu ruim.
 * Cada tentativa é um trabalho na fila, então um pedido do diretor passa à frente entre elas.
 * Pedido do mesmo número em andamento entra no mesmo trabalho, com a prioridade maior.
 */
function producePackWord(voice, entry, priority, pack = null) {
  const file = packFile(voice, entry);
  const running = packWordJobs.get(file);
  if (running) {
    running.ctx.priority = Math.min(running.ctx.priority, priority);
    if (running.ctx.key && speechQueue.stateOf(running.ctx.key) === 'na-fila') {
      speechQueue.add({ key: running.ctx.key, priority, run: async () => null }).promise.catch(() => {});
    }
    return running.promise;
  }
  const ctx = { priority, key: null };
  const promise = (async () => {
    const median = await medianPackPitch(voice);
    let best = null;
    let reason = null;
    for (let attempt = 0; attempt < PACK_MAX_ATTEMPTS; attempt++) {
      ctx.key = `pacote:${voice.id}:${entry.slug}:${attempt}`;
      const take = await schedule(ctx.key, { priority: ctx.priority, request: pack?.request ?? null }, async () => {
        const seed = (seedFor(voice.id) + attempt) >>> 0;
        const { samples, rate } = await generate(`${entry.word}!`, voice, packTokens(entry.syllables), { seed });
        return trimSilence(floatToWav(samples, rate), { dropTrailingBlips: true, tightStart: true, preciseEdges: true, compactTail: true });
      });
      const check = checkCountWord(take, entry.syllables);
      if (!check.ok) { reason = check.reason; continue; }
      const distance = pitchDistance(pitchFromWav(take), median);
      if (!best || distance < best.distance) best = { take, distance };
      if (distance <= PACK_PITCH_RATIO) break;
      reason = 'tom';
    }
    if (!best) {
      const err = new Error(`O número "${entry.word}" não saiu bom (${reason}).`);
      err.quality = true;
      throw err;
    }
    if (pack?.canceled || !clones.voiceFor(voice.id)) throw canceledError();
    // a masterização leve em todas as vozes: mesmo volume e mesmo caráter entre os números
    const buf = clones.masterSpeech(best.take, clones.MASTER_VERSION);
    await writePackWord(voice, file, buf);
    packPitches.set(file, pitchFromWav(buf));
    return buf;
  })().finally(() => packWordJobs.delete(file));
  packWordJobs.set(file, { promise, ctx });
  return promise;
}

/** 'gerando' ou 'na-fila' se este número está sendo gravado no pacote; senão null. */
function packWordState(voice, text) {
  try {
    const entry = packEntry(text);
    if (!entry) return null;
    const running = packWordJobs.get(packFile(voice, entry));
    if (!running) return null;
    return speechQueue.stateOf(running.ctx.key) === 'gerando' ? 'gerando' : 'na-fila';
  } catch {
    return null;
  }
}

/**
 * Os números da contagem vindos do pacote, sempre o grupo completo (os que faltam são gravados,
 * começando pelo pedido em `idx`). MISS: falta número e só podia olhar o que está pronto. null: um
 * número do grupo não sai bom, então o grupo inteiro segue pela contagem falada de uma vez.
 */
async function packPieces(words, idx, voice, onlyCache, job) {
  const entries = words.map(packEntry);
  if (entries.some((e) => !e)) return null;
  const pieces = await Promise.all(entries.map((e) => readPlayable(packFile(voice, e))));
  if (pieces.every(Boolean)) return { pieces, cached: true };
  const failed = packs.get(voice.id)?.failed;
  if (entries.some((e, k) => !pieces[k] && failed?.has(e.word))) return null;
  if (onlyCache) return MISS;
  try {
    // cancelar solta só quem esperava: o número continua e fica guardado no pacote
    const canceled = new Promise((_, reject) => {
      if (job.request) job.request.cancel = () => reject(canceledError());
    });
    canceled.catch(() => {});
    const missing = entries.map((_, k) => k).filter((k) => !pieces[k]).sort((a, b) => (b === idx) - (a === idx));
    for (const k of missing) {
      pieces[k] = await Promise.race([producePackWord(voice, entries[k], job.priority ?? PRIORITY.USER), canceled]);
    }
    return { pieces, cached: false };
  } catch (err) {
    // só o número reprovado troca de caminho; motor fora do ar é erro desta fala
    if (err?.quality) return null;
    throw err;
  }
}

function emitPack(voice) {
  try { packListener?.({ voice: voice.id, ...packStatusOf(voice) }); } catch { /* tela fechada */ }
}

/** Situação do pacote desta voz e modo, lida do disco e da fila. */
function packStatusOf(voice) {
  const total = COUNT_WORDS.length;
  const done = COUNT_WORDS.filter((e) => fs.existsSync(packFile(voice, e))).length;
  const pack = packs.get(voice.id);
  const error = pack?.error ?? (pack?.failed.size ? [...pack.failed.values()][0] : null);
  let state = done === 0 ? 'nao' : 'parcial';
  if (done === total) state = 'pronta';
  else if (pack?.active) {
    // entre um número e outro o pacote segue gerando; com música ele fica esperando na fila
    state = !playing || COUNT_WORDS.some((e) => packWordState(voice, e.word) === 'gerando') ? 'gerando' : 'na-fila';
  } else if (pack && packOrder.includes(pack)) state = 'na-fila';
  else if (error) state = 'falhou';
  return { state, done, total, error: error ?? null };
}

/** Tira as pastas de versões antigas deste modo (nunca as frases salvas, que ficam em outro lugar). */
async function dropOldPacks(voice) {
  const base = path.join(voice.dir, 'contagem');
  const keep = path.basename(packFolder(voice));
  const names = await fsp.readdir(base).catch(() => []);
  await Promise.all(names
    .filter((n) => n.startsWith(`${voice.mode}-v`) && n !== keep)
    .map((n) => fsp.rm(path.join(base, n), { recursive: true, force: true }).catch(() => {})));
}

async function runPack(pack) {
  const { voice } = pack;
  pack.active = true;
  pack.error = null;
  emitPack(voice);
  await dropOldPacks(voice);
  let transient = 0;
  let yielded = false;
  for (let i = 0; i < COUNT_WORDS.length && !pack.canceled;) {
    // o diretor pediu outra voz ou modo: devolve a vez, e o que já foi gravado continua no disco
    if (packOrder[0] !== pack) { yielded = packOrder.includes(pack); break; }
    const entry = COUNT_WORDS[i];
    if (fs.existsSync(packFile(voice, entry)) || pack.failed.has(entry.word)) { i++; continue; }
    if (unavailableReason()) { pack.error = unavailableReason(); break; }
    try {
      await producePackWord(voice, entry, PRIORITY.PACK, pack);
      pack.failed.delete(entry.word);
      transient = 0;
      i++;
    } catch (err) {
      if (err?.canceled || pack.canceled) break;
      const message = err instanceof Error ? err.message : String(err);
      if (err?.quality) {
        // um número ruim não segura os outros
        pack.failed.set(entry.word, message);
        transient = 0;
        i++;
      } else if (!transientFailure(message) || ++transient >= PACK_TRANSIENT_LIMIT) {
        // motor sem abrir ou sem memória: insistir só reabriria o modelo. Retoma no próximo pedido
        pack.error = message;
        break;
      }
    }
    emitPack(voice);
  }
  pack.active = false;
  if (!pack.canceled) emitPack(voice);
  return yielded;
}

function runPacks() {
  if (packLoop) return;
  packLoop = true;
  (async () => {
    try {
      while (packOrder.length) {
        const pack = packOrder[0];
        try {
          if (await runPack(pack)) continue; // cedeu a vez: segue na fila, atrás do pedido novo
        } catch (err) {
          pack.active = false;
          pack.error = err instanceof Error ? err.message : String(err);
        }
        const at = packOrder.indexOf(pack);
        if (at >= 0) packOrder.splice(at, 1);
      }
    } finally {
      packLoop = false;
    }
  })();
}

/**
 * Inicia ou retoma, em segundo plano, o pacote desta voz clonada e modo. Nunca lança. Pedido da
 * tela passa para a frente da fila; `auto` (disparo ao salvar a voz) mantém a ordem de chegada.
 */
async function ensureCountPack(voiceId, { auto = false } = {}) {
  try {
    const voice = clones.voiceFor(voiceId);
    if (!voice || unavailableReason()) return false;
    if (COUNT_WORDS.every((e) => fs.existsSync(packFile(voice, e)))) return true;
    let pack = packs.get(voice.id);
    if (!pack) {
      pack = { voice, active: false, canceled: false, error: null, failed: new Map(), request: { cancelled: false, cancel: null } };
      packs.set(voice.id, pack);
    }
    if (!packOrder.includes(pack)) {
      pack.failed.clear(); // pedido novo: os números que falharam ganham outra chance
      packOrder.push(pack);
    }
    if (!auto && packOrder[0] !== pack) {
      packOrder.splice(packOrder.indexOf(pack), 1);
      packOrder.unshift(pack);
    }
    runPacks();
    return true;
  } catch {
    return false;
  }
}

/** Depois de salvar uma voz: o pacote de todos os modos gravados, começando pela Normal. */
function startCountPacks(voiceId) {
  const p = clones.parseId(voiceId);
  const voice = p && clones.voiceFor(`clone:${p.slug}`);
  if (!voice) return;
  for (const mode of clones.MODES) {
    if (voice.modes.includes(mode)) void ensureCountPack(mode === 'normal' ? `clone:${p.slug}` : `clone:${p.slug}:${mode}`, { auto: true });
  }
}

/** Situação do pacote, sem gerar nada. Voz que não é clonada responde 'nao'. */
function countPackStatus(voiceId) {
  try {
    const voice = clones.voiceFor(voiceId);
    if (!voice) return { state: 'nao', done: 0, total: 0, error: null };
    return packStatusOf(voice);
  } catch (err) {
    return { state: 'falhou', done: 0, total: COUNT_WORDS.length, error: err instanceof Error ? err.message : String(err) };
  }
}

/** O número gravado, direto do disco, sem chamar o modelo. null se ainda não existe. */
async function countWord({ voice: voiceId, word } = {}) {
  try {
    const voice = clones.voiceFor(voiceId);
    const entry = packEntry(String(word ?? ''));
    if (!voice || !entry) return null;
    const buf = await readPlayable(packFile(voice, entry));
    return buf ? { wavBase64: buf.toString('base64'), seconds: wavSeconds(buf) } : null;
  } catch {
    return null;
  }
}

/**
 * A voz vai ser apagada: para o pacote dela em todos os modos, sem gravar mais nada. A promessa
 * termina quando a gravação em disco que já tinha começado acabou, e aí a pasta pode sair.
 */
async function cancelCountPacks(voiceId) {
  const p = clones.parseId(voiceId);
  if (!p) return;
  const dir = clones.voiceFor(`clone:${p.slug}`)?.dir;
  for (const [id, pack] of packs) {
    if (clones.parseId(id)?.slug !== p.slug) continue;
    pack.canceled = true;
    pack.request.cancelled = true;
    pack.request.cancel?.();
    const at = packOrder.indexOf(pack);
    if (at > 0 || (at === 0 && !pack.active)) packOrder.splice(at, 1);
    packs.delete(id);
  }
  if (dir) {
    const prefix = dir + path.sep;
    await Promise.allSettled([...packWrites].filter(([file]) => file.startsWith(prefix)).map(([, write]) => write));
  }
}

// ---------------------------------------------------------------------------------------------
// Aquecer a voz: a tela chama ao abrir uma janela de falas ou escolher a voz, para a primeira fala
// sair rápida. No chip Apple abre o programa e, com memória livre, faz uma fala descartável curtinha
// (o programa guarda o preparo da referência). No processador só renova o tempo aberto.

const WARM_TEXT = 'Ok.';
/** Teve fala de verdade neste tempo: o aquecimento não gera a fala descartável. */
const WARM_SKIP_AFTER_SPEECH_MS = 5 * 60 * 1000;
/**
 * Memória livre mínima (os.freemem) para a fala descartável. Ela não pode ser interrompida e, com
 * pouca memória, leva de 17 a 51 s: quem clicasse em Play nesse meio tempo esperaria por um áudio
 * jogado fora. Abaixo de 1,5 GB só abre o programa, que a primeira fala precisaria abrir de
 * qualquer jeito e que não ocupa a fila. No macOS o os.freemem não conta a memória reaproveitável,
 * então o valor é conservador: na dúvida, não gera a fala descartável.
 */
const WARM_MIN_FREE_BYTES = 1.5 * 1024 * 1024 * 1024;

/** O que o aquecimento deve fazer agora: 'nada', 'abrir' (só o programa) ou 'completo'. */
function warmPlan({ freeBytes, helperOpen, sameRef, busy, playing: musicPlaying, recentSpeech }) {
  if (busy || musicPlaying) return 'nada';
  // programa aberto e em uso: uma fala descartável trocaria a referência guardada à toa
  if (helperOpen && (sameRef || recentSpeech)) return 'nada';
  if (freeBytes < WARM_MIN_FREE_BYTES) return helperOpen ? 'nada' : 'abrir';
  return 'completo';
}

/** Pré-carrega o motor e a referência da voz. Nunca lança: devolve false se não deu. */
async function warm(voiceId) {
  try {
    if (unavailableReason()) return false;
    const voice = qwenVoiceFor(voiceId);
    if (!voice) return false;
    if (CPU) {
      if (helper) touch();
      return true;
    }
    if (helper) touch();
    const { ref } = referenceOf(voice);
    const plan = warmPlan({
      freeBytes: os.freemem(),
      helperOpen: !!helper,
      sameRef: helper?.lastRef === ref,
      busy: speechQueue.size() > 0,
      playing,
      recentSpeech: Date.now() - lastSpeechAt < WARM_SKIP_AFTER_SPEECH_MS,
    });
    if (plan === 'nada') return true;
    if (plan === 'abrir') {
      await getHelper();
      touch();
      return true;
    }
    await speechQueue.add({
      key: `aquecer:${voice.id}`,
      priority: PRIORITY.WARM,
      yields: true,
      run: async () => {
        const { ref: now } = referenceOf(voice);
        if (helper && helper.lastRef === now) { touch(); return; }
        await generate(WARM_TEXT, voice, maxTokensFor(WARM_TEXT), { discard: true }); // descartada, fora do cache
      },
    }).promise;
    return true;
  } catch {
    return false;
  }
}

/**
 * Fecha o programa de voz se ele está aberto e parado: nenhuma fala gerando nem na fila, nenhum
 * pacote de contagem gravando, nenhuma frase salva nem fala de fundo a caminho. main.js chama
 * antes de uma separação de faixas: num Mac de 8 GB os ~2 GB do modelo iam para o swap junto com
 * a IA de separação. Os 5 e 10 min de ocioso continuam valendo no resto do tempo. Efeito: a
 * próxima fala abre o programa de novo (cerca de 15 s no chip Apple, até 1 min no processador).
 * Devolve true se fechou.
 */
function releaseIfIdle() {
  if (!helper) return false;
  if (helper.pending.size > 0 || speechQueue.size() > 0) return false;
  if (packLoop || packWordJobs.size > 0) return false;
  if (background.size > 0 || pinJobs.size > 0) return false;
  stopHelper();
  return true;
}

module.exports = {
  QWEN_VOICES,
  OFFERED_VOICES,
  CPU,
  releaseIfIdle,
  qwenVoiceFor,
  supported,
  engineDir,
  modelDir,
  status,
  unavailableReason,
  render,
  isReady,
  readyState,
  speechState,
  cancelRender,
  warm,
  stopHelper,
  pinPhrase,
  unpinPhrase,
  pinnedStates,
  setPlaying,
  pinnedDir,
  ensureCountPack,
  startCountPacks,
  countPackStatus,
  countWord,
  cancelCountPacks,
  setCountPackListener,
  COUNT_WORDS,
  // para os testes
  legacyPinnedFile,
  PRIORITY,
  createSpeechQueue,
  warmPlan,
  WARM_MIN_FREE_BYTES,
  fitTempo,
  cleanText,
  stripCompassLabel,
  maxTokensFor,
  seedFor,
  countUtterance,
};
