// Vozes clonadas do Maestro IA: o diretor grava a própria voz lendo os textos da tela, o programa
// trata cada gravação como num estúdio e guarda; a voz entra no seletor como as de fábrica
// (Feminina, Masculina). Não há importação de áudio: só a gravação na hora, para ninguém clonar a
// voz de outra pessoa.
//
// Clonar = o motor de voz (Qwen3-TTS) recebe um trecho curto da voz + o texto exato lido nele e
// fala qualquer frase com aquele timbre. Por isso o texto lido TEM de ser o texto guardado.
//
// Modos de fala (tomadas): cada voz tem a tomada 'normal' (obrigatória) e pode ter 'calma' e
// 'forte'. Cada tomada é uma referência curta própria: o modelo copia o jeito de falar da
// referência, então a fala calma sai calma e a forte sai empolgada.
//
// A referência é a voz o mais natural possível, porque o modelo copia tudo o que ouve nela,
// inclusive compressão, EQ e o som metálico da separação. Tudo no próprio computador, nesta ordem:
//  1. tira ruído com o motor de separação SÓ se o fundo medido na gravação original passar de
//     NOISE_DENOISE_DB (-30 dB em relação à voz): o Demucs deixa a voz metálica;
//  2. converte para mono 24 kHz com sinc de boa qualidade (formato das vozes de fábrica: o
//     programa de voz não precisa reamostrar);
//  3. passa-alta suave de 70 Hz (2ª ordem): só grave de microfone, vento e batida na mesa;
//  4. corta o silêncio das pontas; pausas de até 0,5 s ficam inteiras e as maiores viram 0,35 s,
//     com emenda suave e o som do ambiente preservado;
//  5. um único ganho leva a fala a -19 dB, sem passar de -1 dB de pico.
// Sem compressor, EQ, de-esser ou limitador na referência. Esse tratamento de estúdio fica só na
// fala gerada (masterSpeech), em ajuste leve. O áudio de revisão da tela é a tomada com
// masterSpeech: o diretor ouve como a voz vai soar, e a referência guardada continua natural.
//
// Vozes salvas antes disso continuam com a referência e a masterização delas (masterVersion 2 ou
// ausente), para as falas e frases já gravadas continuarem valendo.
//
// Tamanho da referência: o ideal é de 6 a 10 s já sem as pausas. Com referência longa o modelo
// inventa palavras e cada fala fica mais lenta (ele reprocessa a referência inteira toda vez).
//
// Cada voz fica em <pasta do app>/maestro-vozes/<id>/ com info.json e, por modo, voz-<modo>.wav
// e texto-<modo>.txt. Vozes antigas (voz.wav e texto.txt) valem como o modo normal.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { floatToWav } = require('./maestroAudio');

/** Volume das falas prontas do Maestro: fala em -19 dB. */
const TARGET_DB = -19;
/** Teto do limitador (-1 dB). */
const CEILING_DB = -1;
const CEILING = Math.pow(10, CEILING_DB / 20);
/** Tamanho da tomada já tratada: ideal de 6 a 10 s. */
const MIN_SECONDS = 4;
const SHORT_SECONDS = 5;
const LONG_SECONDS = 10.5;
const MAX_SECONDS = 13;
/** Pausa entre frases: até PAUSE_MAX fica inteira; acima disso, encurta para PAUSE_KEEP. */
const PAUSE_MAX = 0.5;
const PAUSE_KEEP = 0.35;
/** Formato da referência guardada: o mesmo das vozes de fábrica (mono, 16 bits). */
const REF_RATE = 24000;
/**
 * Limiar do Demucs: fundo (percentil 3 das janelas com som) em relação à voz (percentil 95), na
 * gravação original. Sala quieta fica perto de -45 dB; acima de -30 dB o ruído atrapalha mais do
 * que o som metálico da separação. É o mesmo limiar do aviso de lugar ruidoso.
 * Percentil 3 porque numa leitura contínua menos de 10% das janelas são pausa: o percentil 10 já
 * era voz (referência real: p3 -64 dB, p5 -45 dB, p10 -27 dB) e gravação limpa ia para o Demucs.
 */
const NOISE_DENOISE_DB = -30;
const NOISE_FLOOR_PERCENTILE = 0.03;
/** Abaixo disto é zero digital (o microfone ainda abrindo), não o ruído do lugar. */
const DIGITAL_SILENCE = 1e-5;
/** Quantas tomadas processadas ficam esperando o "Salvar" (as mais antigas saem). */
const PENDING_MAX = 9;
/** Os modos de fala. 'normal' é obrigatório. */
const MODES = ['normal', 'calma', 'forte'];
/** Masterização leve, das vozes gravadas com a referência natural. */
const MASTER_VERSION = 3;
/** Masterização das vozes antigas: mantida para as falas e frases já guardadas continuarem valendo. */
const LEGACY_MASTER_VERSION = 2;

// ---------------------------------------------------------------------------------------------
// Onde ficam

function baseDir() {
  if (process.env.VS_MAESTRO_CLONES_HOME) return process.env.VS_MAESTRO_CLONES_HOME;
  try {
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), 'maestro-vozes');
  } catch { /* fora do Electron */ }
  return path.join(os.homedir(), '.vs-maestro-vozes');
}

function voiceDir(slug) {
  return path.join(baseDir(), slug);
}

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

/** Os arquivos de cada modo gravado ({ normal: { refPath, refTextPath }, ... }). */
function takeFiles(dir) {
  const files = {};
  for (const mode of MODES) {
    const refPath = path.join(dir, `voz-${mode}.wav`);
    const refTextPath = path.join(dir, `texto-${mode}.txt`);
    if (fs.existsSync(refPath) && fs.existsSync(refTextPath)) files[mode] = { refPath, refTextPath };
  }
  if (!files.normal) {
    // voz gravada antes dos modos
    const refPath = path.join(dir, 'voz.wav');
    const refTextPath = path.join(dir, 'texto.txt');
    if (fs.existsSync(refPath) && fs.existsSync(refTextPath)) files.normal = { refPath, refTextPath };
  }
  return files;
}

function readInfo(slug) {
  if (!SLUG_RE.test(slug)) return null;
  try {
    const dir = voiceDir(slug);
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'info.json'), 'utf8'));
    const files = takeFiles(dir);
    if (!files.normal) return null;
    return {
      id: `clone:${slug}`,
      slug,
      dir,
      name: String(info.name ?? 'Voz clonada'),
      gender: info.gender === 'feminina' ? 'feminina' : 'masculina',
      created: info.created,
      modes: MODES.filter((m) => files[m]),
      masterVersion: Number(info.masterVersion) || LEGACY_MASTER_VERSION,
      files,
      // a tomada normal (o padrão)
      mode: 'normal',
      refPath: files.normal.refPath,
      refTextPath: files.normal.refTextPath,
      clone: true,
    };
  } catch {
    return null;
  }
}

/** Separa o id: "clone:<pasta>" (normal) ou "clone:<pasta>:<modo>". null se não for válido. */
function parseId(id) {
  if (typeof id !== 'string') return null;
  const m = /^clone:([a-z0-9-]{1,64})(?::(normal|calma|forte))?$/.exec(id);
  if (!m) return null;
  return { slug: m[1], mode: m[2] ?? 'normal' };
}

/** As vozes clonadas guardadas neste computador, da mais nova para a mais antiga. */
function list() {
  let names = [];
  try { names = fs.readdirSync(baseDir()); } catch { return []; }
  return names.map(readInfo).filter(Boolean).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

/**
 * A voz clonada pelo id, já no modo pedido, ou null. Modo que não foi gravado cai no normal (e o
 * id devolvido é o do normal: a mesma fala sai igual e fica guardada uma vez só).
 */
function voiceFor(id) {
  const p = parseId(id);
  if (!p) return null;
  const info = readInfo(p.slug);
  if (!info) return null;
  const mode = info.files[p.mode] ? p.mode : 'normal';
  const { refPath, refTextPath } = info.files[mode];
  return {
    id: mode === 'normal' ? `clone:${p.slug}` : `clone:${p.slug}:${mode}`,
    name: info.name,
    gender: info.gender,
    created: info.created,
    modes: info.modes,
    masterVersion: info.masterVersion,
    mode,
    refPath,
    refTextPath,
    dir: info.dir,
    clone: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Áudio: leitura

/** WAV (PCM 16/24/32 bits ou ponto flutuante 32 bits) → amostras mono em -1..1 e a taxa. */
function readWavMono(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('O áudio não é um WAV.');
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(off + 8);
      const channels = buf.readUInt16LE(off + 10) || 1;
      const rate = buf.readUInt32LE(off + 12);
      const bits = buf.readUInt16LE(off + 22);
      if (format === 0xfffe && size >= 40) format = buf.readUInt16LE(off + 8 + 24); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels, rate, bits };
    } else if (id === 'data' && fmt) {
      const bytes = fmt.bits / 8;
      const start = off + 8;
      const end = Math.min(buf.length, start + size);
      const frames = Math.floor((end - start) / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      const read = fmt.format === 3 && fmt.bits === 32
        ? (p) => buf.readFloatLE(p)
        : fmt.bits === 16 ? (p) => buf.readInt16LE(p) / 32768
          : fmt.bits === 24 ? (p) => buf.readIntLE(p, 3) / 8388608
            : fmt.bits === 32 ? (p) => buf.readInt32LE(p) / 2147483648
              : null;
      if (!read) throw new Error(`Formato de áudio não suportado (${fmt.bits} bits).`);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) s += read(start + (i * fmt.channels + c) * bytes);
        out[i] = s / fmt.channels;
      }
      return { samples: out, rate: fmt.rate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('Não foi possível ler o áudio.');
}

// ---------------------------------------------------------------------------------------------
// Áudio: filtros (biquad, fórmulas do "Audio EQ Cookbook" de Robert Bristow-Johnson)

/**
 * Coeficientes de um biquad. `type`: 'highpass', 'lowpass', 'peaking', 'highshelf'.
 * `q` vale para passa-alta, passa-baixa e peaking; o shelf usa inclinação 1.
 */
function biquad(type, hz, rate, q = Math.SQRT1_2, gainDb = 0) {
  const f = Math.min(hz, rate * 0.49);
  const w0 = (2 * Math.PI * f) / rate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass' || type === 'lowpass') {
    const alpha = sin / (2 * q);
    const hp = type === 'highpass';
    b0 = hp ? (1 + cos) / 2 : (1 - cos) / 2;
    b1 = hp ? -(1 + cos) : 1 - cos;
    b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === 'peaking') {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else if (type === 'highshelf') {
    const alpha = (sin / 2) * Math.SQRT2; // inclinação S = 1
    const sq = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cos + sq);
    b1 = -2 * A * ((A - 1) + (A + 1) * cos);
    b2 = A * ((A + 1) + (A - 1) * cos - sq);
    a0 = (A + 1) - (A - 1) * cos + sq;
    a1 = 2 * ((A - 1) - (A + 1) * cos);
    a2 = (A + 1) - (A - 1) * cos - sq;
  } else {
    throw new Error(`Filtro desconhecido: ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Passa o sinal por um biquad (forma direta I). Devolve um sinal novo. */
function applyBiquad(samples, c) {
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Passa-alta Butterworth de 4ª ordem (dois biquads): tira grave de microfone e de vento. */
function highPass(samples, rate, hz = 80) {
  return applyBiquad(applyBiquad(samples, biquad('highpass', hz, rate, 0.5412)), biquad('highpass', hz, rate, 1.3066));
}

/** EQ de voz. Padrão: -2,5 dB em 250 Hz, +2 dB em 3,5 kHz (presença), +1,5 dB de 10 kHz para cima. */
function eqVoice(samples, rate, { lowDb = -2.5, presenceDb = 2, airDb = 1.5 } = {}) {
  let out = applyBiquad(samples, biquad('peaking', 250, rate, 1.0, lowDb));
  out = applyBiquad(out, biquad('peaking', 3500, rate, 0.9, presenceDb));
  if (rate >= 22050) out = applyBiquad(out, biquad('highshelf', 10000, rate, 0, airDb));
  return out;
}

/** Função de Bessel modificada de ordem zero (para a janela de Kaiser). */
function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

/**
 * Reamostragem por sinc com janela de Kaiser (24 cruzamentos de zero, beta 9). Ao descer a taxa, o
 * corte fica em 97% do novo Nyquist, para não dobrar agudo sobre a voz. O ganho é normalizado em
 * cada amostra, então as pontas do áudio não perdem volume.
 */
function resample(input, from, to = REF_RATE) {
  if (from === to) return Float32Array.from(input);
  const ratio = to / from;
  const cutoff = Math.min(1, ratio) * 0.97;
  const zeros = 24;
  const steps = 512;
  const beta = 9;
  const table = new Float32Array(zeros * steps + 2);
  const i0 = besselI0(beta);
  for (let k = 0; k < table.length; k++) {
    const u = k / steps;
    const r = Math.min(1, u / zeros);
    const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
    table[k] = sinc * (besselI0(beta * Math.sqrt(1 - r * r)) / i0);
  }
  const reach = zeros / cutoff;
  const n = Math.floor(input.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const center = i / ratio;
    const a = Math.max(0, Math.ceil(center - reach));
    const b = Math.min(input.length - 1, Math.floor(center + reach));
    let sum = 0, weight = 0;
    for (let j = a; j <= b; j++) {
      const pos = Math.abs(j - center) * cutoff * steps;
      const k = Math.floor(pos);
      if (k >= table.length - 1) continue;
      const h = table[k] + (table[k + 1] - table[k]) * (pos - k);
      sum += input[j] * h;
      weight += h;
    }
    out[i] = weight > 1e-9 ? sum / weight : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Áudio: medidas

const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-9));

/** Volume (RMS) de cada janela de 20 ms. */
function frameLevels(samples, rate) {
  const size = Math.max(1, Math.round(rate * 0.02));
  const n = Math.ceil(samples.length / size);
  const levels = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    const end = Math.min(samples.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) sum += samples[i] * samples[i];
    levels[f] = Math.sqrt(sum / Math.max(1, end - f * size));
  }
  return { levels, size };
}

/**
 * Volume da fala: RMS só das janelas com voz. Sem `threshold`, conta como voz a janela acima de
 * 1/10 da janela mais forte (-20 dB).
 */
function speechRms(samples, rate, threshold) {
  const { levels } = frameLevels(samples, rate);
  const peak = levels.reduce((m, l) => Math.max(m, l), 0);
  const gate = threshold ?? peak * 0.1;
  let sum = 0, cnt = 0;
  for (const l of levels) if (l > gate) { sum += l * l; cnt++; }
  return Math.sqrt(sum / Math.max(1, cnt));
}

// ---------------------------------------------------------------------------------------------
// Áudio: dinâmica

/** Seguidor de envelope (RMS) com ataque e release, em amplitude. */
function rmsEnvelope(samples, rate, attackMs, releaseMs) {
  const att = Math.exp(-1 / (rate * attackMs / 1000));
  const rel = Math.exp(-1 / (rate * releaseMs / 1000));
  const env = new Float32Array(samples.length);
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const x2 = samples[i] * samples[i];
    const k = x2 > p ? att : rel;
    p = k * p + (1 - k) * x2;
    env[i] = Math.sqrt(p);
  }
  return env;
}

/**
 * De-esser: separa a banda do "s" (5 a 9 kHz) e só abaixa essa banda quando ela passa do limiar
 * (relativo ao volume da fala). Fora dos "s" o sinal sai idêntico.
 * `thresholdDb`: quanto abaixo do volume da fala a banda pode chegar sem ser mexida.
 */
function deEss(samples, rate, { thresholdDb = -12, ratio = 4, maxCutDb = 10, reference } = {}) {
  if (rate < 16000) return Float32Array.from(samples);
  const hi = Math.min(9000, rate * 0.45);
  const band = applyBiquad(applyBiquad(samples, biquad('highpass', 5000, rate)), biquad('lowpass', hi, rate));
  const ref = reference ?? speechRms(samples, rate);
  const thr = Math.max(ref, 1e-6) * Math.pow(10, thresholdDb / 20);
  const env = rmsEnvelope(band, rate, 1, 60);
  const minGain = Math.pow(10, -maxCutDb / 20);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let g = 1;
    if (env[i] > thr) g = Math.max(minGain, Math.pow(thr / env[i], 1 - 1 / ratio));
    out[i] = samples[i] - band[i] + band[i] * g;
  }
  return out;
}

/**
 * Compressor com detector RMS (janela de ~10 ms), joelho suave, ataque e release na redução de
 * ganho e ganho de compensação (a fala volta ao volume que tinha antes de comprimir).
 * `thresholdDb`: relativo ao volume da fala (picos de sílaba acima disso são comprimidos).
 */
function compress(samples, rate, { thresholdDb = -4, ratio = 3, attackMs = 8, releaseMs = 120, kneeDb = 6 } = {}) {
  const before = speechRms(samples, rate);
  if (before <= 1e-6) return Float32Array.from(samples);
  const thr = dbOf(before) + thresholdDb;
  const detector = rmsEnvelope(samples, rate, 10, 10);
  const att = Math.exp(-1 / (rate * attackMs / 1000));
  const rel = Math.exp(-1 / (rate * releaseMs / 1000));
  const out = new Float32Array(samples.length);
  let gr = 0; // redução de ganho em dB (positivo)
  for (let i = 0; i < samples.length; i++) {
    const over = dbOf(detector[i]) - thr;
    let want = 0;
    if (over >= kneeDb / 2) want = over * (1 - 1 / ratio);
    else if (over > -kneeDb / 2) want = (1 - 1 / ratio) * ((over + kneeDb / 2) ** 2) / (2 * kneeDb);
    const k = want > gr ? att : rel;
    gr = k * gr + (1 - k) * want;
    out[i] = samples[i] * Math.pow(10, -gr / 20);
  }
  const after = speechRms(out, rate);
  const makeup = after > 1e-6 ? before / after : 1;
  for (let i = 0; i < out.length; i++) out[i] *= makeup;
  return out;
}

/** Ganho para a fala ficar em `targetDb` (RMS das janelas com voz). */
function setLevel(samples, rate, targetDb = TARGET_DB, threshold) {
  const rms = speechRms(samples, rate, threshold);
  const out = Float32Array.from(samples);
  if (rms <= 1e-6) return out;
  const g = Math.pow(10, targetDb / 20) / rms;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
}

/**
 * Limitador com teto (padrão -1 dB): o ganho desce em rampa antes do pico (como um limitador com
 * "lookahead", sem atrasar o áudio: o começo continua no mesmo lugar) e volta devagar.
 */
function limit(samples, rate, { ceilingDb = CEILING_DB, attackMs = 2, releaseMs = 80 } = {}) {
  const ceil = Math.pow(10, ceilingDb / 20);
  const n = samples.length;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    g[i] = a > ceil ? ceil / a : 1;
  }
  // rampa antes do pico (de trás para a frente)
  const step = 1 / Math.max(1, rate * attackMs / 1000);
  for (let i = n - 2; i >= 0; i--) if (g[i] > g[i + 1] + step) g[i] = g[i + 1] + step;
  // volta suave depois do pico
  const rel = 1 - Math.exp(-1 / (rate * releaseMs / 1000));
  for (let i = 1; i < n; i++) {
    const back = g[i - 1] + (1 - g[i - 1]) * rel;
    if (g[i] > back) g[i] = back;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = samples[i] * g[i];
    out[i] = y > ceil ? ceil : y < -ceil ? -ceil : y;
  }
  return out;
}

/**
 * Cadeia de estúdio depois da limpeza: EQ, de-esser, compressor, volume da fala e limitador.
 * `threshold`: limiar de voz (para medir o volume só nas janelas com fala).
 */
function studioChain(samples, rate, threshold) {
  let out = eqVoice(samples, rate);
  out = deEss(out, rate);
  out = compress(out, rate);
  out = setLevel(out, rate, TARGET_DB, threshold);
  return limit(out, rate);
}

/**
 * Masterização leve da fala gerada: mantém a dinâmica e o timbre da voz. EQ de 1 dB, de-esser só
 * nos "s" fortes, compressor de 1,6:1, fala em -19 dB e limitador em -1 dB.
 */
function lightChain(samples, rate) {
  let out = applyBiquad(samples, biquad('highpass', 70, rate));
  out = eqVoice(out, rate, { lowDb: -1, presenceDb: 1, airDb: 0.5 });
  out = deEss(out, rate, { thresholdDb: -8, ratio: 2.5, maxCutDb: 5 });
  out = compress(out, rate, { thresholdDb: -6, ratio: 1.6, attackMs: 15, releaseMs: 180, kneeDb: 8 });
  out = setLevel(out, rate, TARGET_DB);
  return limit(out, rate);
}

// ---------------------------------------------------------------------------------------------
// Análise da voz (detalhes para a tela)

/**
 * Tom médio da voz por autocorrelação, só nas janelas com voz. Devolve Hz ou null.
 * O áudio é reduzido para ~12 kHz antes (o tom da fala fica entre 60 e 400 Hz).
 */
function pitchOf(samples, rate, threshold) {
  const d = Math.max(1, Math.floor(rate / 12000));
  const r = rate / d;
  const n = Math.floor(samples.length / d);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < d; k++) s += samples[i * d + k];
    x[i] = s / d;
  }
  const win = Math.round(r * 0.04);
  const hop = Math.round(r * 0.02);
  const minLag = Math.floor(r / 400);
  const maxLag = Math.ceil(r / 60);
  if (n < win + maxLag) return null;
  const { levels } = frameLevels(x, r);
  const peak = levels.reduce((m, l) => Math.max(m, l), 0);
  const gate = threshold ?? peak * 0.1;
  const found = [];
  const corr = new Float32Array(maxLag + 2);
  for (let start = 0; start + win + maxLag < n; start += hop) {
    let e0 = 0;
    for (let i = 0; i < win; i++) e0 += x[start + i] * x[start + i];
    if (Math.sqrt(e0 / win) <= gate) continue;
    let best = 0;
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let s = 0, e1 = 0;
      for (let i = 0; i < win; i++) {
        const b = x[start + i + lag];
        s += x[start + i] * b;
        e1 += b * b;
      }
      corr[lag] = s / Math.sqrt(Math.max(e0 * e1, 1e-12));
      if (lag <= maxLag && corr[lag] > best) best = corr[lag];
    }
    if (best < 0.5) continue;
    // o primeiro pico perto do maior (evita pegar a oitava de baixo)
    for (let lag = minLag + 1; lag <= maxLag; lag++) {
      if (corr[lag] >= 0.9 * best && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
        const a = corr[lag - 1], b = corr[lag], c = corr[lag + 1];
        const den = a - 2 * b + c;
        const shift = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
        found.push(r / (lag + shift));
        break;
      }
    }
  }
  if (found.length < 3) return null;
  found.sort((a, b) => a - b);
  return found[Math.floor(found.length / 2)];
}

/** Região da voz pelo tom médio. */
function rangeOf(pitchHz) {
  if (!pitchHz) return null;
  if (pitchHz < 140) return 'grave';
  if (pitchHz > 210) return 'aguda';
  return 'média';
}

/** Quantas palavras tem o texto (só as que têm letra ou número). */
function countWords(text) {
  return String(text ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Detalhes da voz: tom médio e região, volume e pico, brilho (energia acima de 4 kHz) e
 * velocidade da leitura (palavras por minuto).
 */
function analyzeVoice(samples, rate, text, threshold) {
  const pitchHz = pitchOf(samples, rate, threshold);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  let brightness = 'equilibrada';
  if (rate >= 9000) {
    const high = highPass(samples, rate, 4000);
    let eh = 0, et = 0;
    for (let i = 0; i < samples.length; i++) { eh += high[i] * high[i]; et += samples[i] * samples[i]; }
    const ratio = et > 0 ? eh / et : 0;
    brightness = ratio < 0.012 ? 'escura' : ratio > 0.06 ? 'brilhante' : 'equilibrada';
  }
  const seconds = samples.length / rate;
  const words = countWords(text);
  return {
    pitchHz: pitchHz ? Math.round(pitchHz) : null,
    range: rangeOf(pitchHz),
    loudnessDb: Math.round(dbOf(speechRms(samples, rate, threshold)) * 10) / 10,
    peakDb: Math.round(dbOf(peak) * 10) / 10,
    brightness,
    wordsPerMinute: words > 0 && seconds > 0.5 ? Math.round(words / (seconds / 60)) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Tratamento da tomada

/** Avisos e recusa pelo tamanho da tomada já tratada. Lança se passar de MAX_SECONDS. */
function checkLength(seconds) {
  const s = Math.round(seconds * 10) / 10;
  if (seconds > MAX_SECONDS) {
    throw new Error(`A tomada ficou longa demais (${String(s).replace('.', ',')} s sem as pausas). O ideal é de 6 a 10 s: leia um pouco mais depressa, sem parar entre as frases, e grave de novo.`);
  }
  const warnings = [];
  if (seconds < MIN_SECONDS) warnings.push('A gravação ficou curta. Leia o texto inteiro, sem pular frases.');
  else if (seconds < SHORT_SECONDS) warnings.push('A gravação ficou um pouco curta. Leia o texto inteiro, no seu ritmo natural.');
  if (seconds > LONG_SECONDS) warnings.push(`A tomada ficou com ${String(s).replace('.', ',')} s. O ideal é até 10 s: leia um pouco mais depressa.`);
  return warnings;
}

/**
 * Medidas da gravação como ela chegou (antes da limpeza de ruído): picos estourados, fundo
 * (percentil 3 das janelas com som) e voz (percentil 95), depois do passa-alta. A limpeza refaz a forma de onda e tira o
 * fundo, então o relatório usa estas medidas para dizer se o microfone saturou ou se o lugar é ruidoso.
 */
function rawStatsOf(input, rate) {
  const clipped = input.reduce((n, s) => n + (Math.abs(s) >= 0.995 ? 1 : 0), 0) / Math.max(1, input.length);
  const { levels } = frameLevels(highPass(input, rate), rate);
  const sorted = Array.from(levels).sort((a, b) => a - b);
  const audible = sorted.filter((l) => l > DIGITAL_SILENCE);
  const floor = audible[Math.floor(audible.length * NOISE_FLOOR_PERCENTILE)] || 0;
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 0;
  return { clipped, floor, loud };
}

/** Marca como pausa só as sequências de pelo menos `minRun` janelas sem voz (consoante fraca não é pausa). */
function pausesOf(voiced, minRun) {
  const pause = new Array(voiced.length).fill(false);
  for (let f = 0; f < voiced.length;) {
    if (voiced[f]) { f++; continue; }
    let g = f;
    while (g < voiced.length && !voiced[g]) g++;
    if (g - f >= minRun) for (let k = f; k < g; k++) pause[k] = true;
    f = g;
  }
  return pause;
}

/** Junta os trechos [início, fim) com emenda de potência constante (15 ms), sem estalo. */
function joinSpans(samples, spans, rate) {
  const fade = Math.round(rate * 0.015);
  const out = new Float32Array(spans.reduce((n, [a, b]) => n + (b - a), 0));
  let at = 0;
  for (const [a, b] of spans) {
    const n = b - a;
    const overlap = at > 0 ? Math.min(fade, n, at) : 0;
    for (let i = 0; i < overlap; i++) {
      const t = ((i + 0.5) / overlap) * (Math.PI / 2);
      const k = at - overlap + i;
      out[k] = out[k] * Math.cos(t) + samples[a + i] * Math.sin(t);
    }
    out.set(samples.subarray(a + overlap, b), at);
    at += n - overlap;
  }
  return out.slice(0, at);
}

/**
 * Prepara a referência natural: mono 24 kHz, passa-alta suave, pontas cortadas, pausas naturais e
 * um único ganho. Devolve as amostras, a taxa e o relatório para a tela (duração, ruído de fundo,
 * picos estourados, avisos e a análise da voz). Não lança pelo tamanho: quem recusa é o prepare.
 */
function cleanVoice(input, inputRate, { text = '', rawStats = null } = {}) {
  const rate = REF_RATE;
  const filtered = applyBiquad(resample(input, inputRate, rate), biquad('highpass', 70, rate));
  const { levels, size } = frameLevels(filtered, rate);
  const sorted = Array.from(levels).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 0;
  // picos e fundo medidos na gravação original (a limpeza de ruído apaga os dois)
  const raw = rawStats || rawStatsOf(input, inputRate);
  // fala = janelas bem acima do fundo (e não baixinhas demais perto do volume da voz)
  // gravação quase sem silêncio (começou a falar na hora): o "fundo" medido já é voz, então o
  // limiar nunca passa de 1/8 do volume da fala (-18 dB). Com 1/4, um trecho falado mais baixo
  // contava como pausa e era cortado, e a referência deixava de bater com o texto lido
  const threshold = Math.max(Math.min(Math.max(floor * 3.2, loud * 0.06), loud * 0.125), 1e-4);
  const voiced = Array.from(levels, (l) => l > threshold);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) throw new Error('Não deu para ouvir a voz na gravação. Grave de novo, mais perto do microfone.');

  // do primeiro ao último som: 80 ms antes e 120 ms depois (o "s" final é fraco e fica abaixo do limiar)
  const maxPause = Math.round(PAUSE_MAX / 0.02);
  const half = Math.ceil(PAUSE_KEEP / 0.02 / 2);
  const stop = Math.min(levels.length, last + 1 + 6);
  const frameSpans = [];
  let from = Math.max(0, first - 4);
  for (let f = first; f <= last;) {
    if (voiced[f]) { f++; continue; }
    let g = f;
    while (!voiced[g]) g++;
    if (g - f > maxPause) {
      frameSpans.push([from, f + half]);
      from = g - half;
    }
    f = g;
  }
  frameSpans.push([from, stop]);
  const spans = frameSpans.map(([a, b]) => [a * size, Math.min(filtered.length, b * size)]).filter(([a, b]) => b > a);
  const samples = joinSpans(filtered, spans, rate);

  // entrada e saída sem estalo
  const fadeIn = Math.min(samples.length, Math.round(rate * 0.01));
  const fadeOut = Math.min(samples.length, Math.round(rate * 0.03));
  for (let i = 0; i < fadeIn; i++) samples[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) samples[samples.length - 1 - i] *= i / fadeOut;

  // um ganho só: a fala em -19 dB, sem o pico passar de -1 dB (nada de compressor ou limitador)
  const gate = threshold * 0.5;
  const rms = speechRms(samples, rate, gate);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  let gain = rms > 1e-6 ? Math.pow(10, TARGET_DB / 20) / rms : 1;
  if (peak * gain > CEILING) gain = CEILING / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;

  const seconds = samples.length / rate;
  const noiseDb = Math.round(dbOf(raw.floor) - dbOf(raw.loud));
  const clipped = raw.clipped;
  const warnings = seconds <= MAX_SECONDS ? checkLength(seconds) : [];
  if (clipped > 0.001) warnings.push('A gravação estourou em alguns trechos. Grave de novo um pouco mais longe do microfone ou com o volume de entrada mais baixo.');
  if (noiseDb > NOISE_DENOISE_DB) warnings.push('O lugar tem bastante ruído. Num lugar mais quieto a voz fica mais natural e mais parecida.');
  return {
    samples,
    rate,
    report: {
      seconds: Math.round(seconds * 10) / 10,
      noiseDb,
      clipped: clipped > 0.001,
      warnings,
      analysis: analyzeVoice(samples, rate, text, gate * gain),
    },
  };
}

/**
 * Masterização de uma fala já gerada com voz clonada (WAV). O começo e o fim não mudam (o corte no
 * ataque continua onde estava, na grade). `version`: a da voz; as antigas mantêm a cadeia antiga.
 */
function masterSpeech(wav, version = MASTER_VERSION) {
  const { samples, rate } = readWavMono(wav);
  if (samples.length === 0 || speechRms(samples, rate) <= 1e-6) return wav;
  const out = version === LEGACY_MASTER_VERSION
    ? studioChain(highPass(samples, rate), rate)
    : lightChain(samples, rate);
  return floatToWav(out, rate);
}

/** O ruído medido na gravação original é alto o bastante para valer o Demucs? */
function needsDenoise(raw) {
  if (!raw || !(raw.loud > 1e-6)) return false;
  return dbOf(raw.floor) - dbOf(raw.loud) > NOISE_DENOISE_DB;
}

// ---------------------------------------------------------------------------------------------
// Criar, salvar, apagar

/**
 * O motor de separação (Demucs) já está instalado? Só olha os lugares do motor embutido, sem rodar
 * nada: se não estiver, a clonagem não chama a separação, que tentaria baixar e instalar o Python
 * e o Demucs no processo principal (o programa congelaria por minutos).
 */
function denoiseEngineInstalled() {
  const py = (dir) => (process.platform === 'win32' ? path.join(dir, 'python', 'python.exe') : path.join(dir, 'python', 'bin', 'python3'));
  const places = [path.join(__dirname, 'ai-engine')];
  if (process.resourcesPath) places.unshift(path.join(process.resourcesPath, 'ai-engine'));
  if (places.some((d) => fs.existsSync(py(d)))) return true;
  // motor instalado antes pelo próprio programa (separação de música)
  return process.platform === 'darwin'
    && fs.existsSync(path.join(os.homedir(), 'Library', 'Application Support', 'VS Stage', 'ai-engine', 'python', 'bin', 'demucs'));
}

const pending = new Map(); // token → { wav, mode, text, created }

function cleanRefText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Prepara uma tomada: guarda a referência natural e devolve, para o diretor ouvir, a mesma tomada
 * com a masterização das falas geradas (como a voz vai soar).
 * `wav`: a gravação em WAV; `mode`: 'normal', 'calma' ou 'forte'; `text`: o texto lido.
 * `onProgress(percent, message)`: a limpeza de ruído, quando precisa, leva um tempo.
 * `deps`: só para os testes (nunca vem da tela).
 */
async function prepare({ wav, mode = 'normal', text = '', denoise = true, separationBusy = false }, onProgress, deps = {}) {
  if (!MODES.includes(mode)) throw new Error('Modo de fala desconhecido.');
  const refText = cleanRefText(text);
  if (refText.length < 10) throw new Error('Falta o texto que foi lido na gravação.');
  const input = Buffer.from(wav);
  let { samples, rate } = readWavMono(input);
  if (samples.length / rate < 2) throw new Error('A gravação ficou curta demais. Leia o texto inteiro.');
  if (samples.length / rate > 60) throw new Error('A gravação ficou longa demais. Grave só a leitura do texto (até 1 minuto).');

  const rawStats = rawStatsOf(samples, rate);
  const engineInstalled = deps.engineInstalled ?? denoiseEngineInstalled;
  let denoised = false;
  let denoiseNote = null;
  // gravação limpa não passa pelo Demucs: ele deixaria a voz metálica e o modelo copiaria isso
  if (denoise && needsDenoise(rawStats)) {
    if (separationBusy) {
      // o motor de separação é um só: cancelar a música mataria a limpeza da tomada (e vice-versa)
      denoiseNote = 'A limpeza de ruído ficou de fora porque uma separação de música está rodando. Grave num lugar mais quieto ou tente de novo depois.';
    } else if (!engineInstalled()) {
      // sem o motor já instalado não instala agora (baixar e instalar travaria o programa por minutos)
      denoiseNote = 'A limpeza de ruído não está instalada neste computador. Grave num lugar mais quieto.';
    } else {
      onProgress?.(10, 'Tirando o ruído e o som de fundo...');
      try {
        const separate = deps.separate ?? ((...args) => require('./stemSeparatorLocal').separateStemsLocal(...args));
        const stems = await separate(null, 'voz.wav', floatToWav(samples, rate), (pct) => {
          onProgress?.(10 + Math.round(pct * 0.75), 'Tirando o ruído e o som de fundo...');
        });
        ({ samples, rate } = readWavMono(Buffer.from(stems.vocals)));
        denoised = true;
      } catch {
        // o motor de separação falhou ou foi cancelado: segue com a gravação como está
        denoiseNote = 'A limpeza de ruído não terminou (o motor de separação estava ocupado ou falhou). Grave num lugar mais quieto ou tente de novo.';
      }
    }
  }
  onProgress?.(90, 'Preparando a voz natural...');
  const { samples: clean, rate: refRate, report } = cleanVoice(samples, rate, { text: refText, rawStats });
  if (denoiseNote) report.warnings.push(denoiseNote);
  checkLength(clean.length / refRate); // recusa tomada longa demais
  const out = floatToWav(clean, refRate);
  const preview = masterSpeech(out);
  const token = crypto.randomBytes(12).toString('hex');
  pending.set(token, { wav: out, mode, text: refText, created: Date.now() });
  while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value);
  onProgress?.(100, 'Pronto.');
  return { token, wavBase64: preview.toString('base64'), report: { ...report, denoised } };
}

function slugify(name) {
  const base = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'voz';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Guarda a voz com as tomadas tratadas. `takes`: [{ mode, token, text }], com uma 'normal'.
 * Devolve a voz pronta para o seletor.
 */
async function save({ name, gender, takes }) {
  const cleanName = String(name ?? '').trim().slice(0, 40);
  if (!cleanName) throw new Error('Dê um nome para a voz.');
  if (!Array.isArray(takes) || takes.length === 0) throw new Error('Grave a tomada normal antes de salvar.');
  const chosen = new Map();
  for (const t of takes) {
    const mode = t?.mode;
    if (!MODES.includes(mode)) throw new Error('Modo de fala desconhecido.');
    if (chosen.has(mode)) throw new Error('Cada modo de fala tem uma tomada só.');
    const item = pending.get(t?.token);
    if (!item || item.mode !== mode) throw new Error('A gravação expirou. Grave a tomada de novo.');
    const refText = cleanRefText(t.text) || item.text;
    if (refText.length < 10) throw new Error('Falta o texto que foi lido na gravação.');
    chosen.set(mode, { item, refText, token: t.token });
  }
  if (!chosen.has('normal')) throw new Error('A tomada normal é obrigatória.');
  const slug = slugify(cleanName);
  const dir = voiceDir(slug);
  await fsp.mkdir(dir, { recursive: true });
  for (const [mode, { item, refText }] of chosen) {
    await fsp.writeFile(path.join(dir, `voz-${mode}.wav`), item.wav);
    await fsp.writeFile(path.join(dir, `texto-${mode}.txt`), refText, 'utf8');
  }
  await fsp.writeFile(path.join(dir, 'info.json'), JSON.stringify({
    name: cleanName,
    gender: gender === 'feminina' ? 'feminina' : 'masculina',
    created: new Date().toISOString(),
    modes: MODES.filter((m) => chosen.has(m)),
    masterVersion: MASTER_VERSION,
  }, null, 2));
  for (const { token } of chosen.values()) pending.delete(token);
  return readInfo(slug);
}

/** Apaga uma voz clonada (com todos os modos). */
async function remove(id) {
  const v = voiceFor(id);
  if (!v) return false;
  await fsp.rm(v.dir, { recursive: true, force: true });
  return true;
}

/** Só o que a tela precisa (ClonedVoice). */
function publicInfo(v) {
  return { id: v.id, name: v.name, gender: v.gender, created: v.created, modes: v.modes };
}

module.exports = {
  MODES,
  TARGET_DB,
  CEILING_DB,
  MAX_SECONDS,
  LONG_SECONDS,
  MASTER_VERSION,
  LEGACY_MASTER_VERSION,
  REF_RATE,
  NOISE_DENOISE_DB,
  list,
  voiceFor,
  parseId,
  publicInfo,
  prepare,
  save,
  remove,
  masterSpeech,
  // nome antigo (a fala gerada recebe a masterização inteira)
  normalizeSpeech: masterSpeech,
  // funções puras, para os testes
  cleanVoice,
  rawStatsOf,
  needsDenoise,
  resample,
  checkLength,
  analyzeVoice,
  pitchOf,
  rangeOf,
  countWords,
  readWavMono,
  biquad,
  applyBiquad,
  highPass,
  eqVoice,
  deEss,
  compress,
  setLevel,
  limit,
  speechRms,
};
