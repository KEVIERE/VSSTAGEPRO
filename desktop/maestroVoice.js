// Vozes do Maestro por IA.
// - Voz de IA brasileira (Qwen3-TTS), em maestroQwen.js: é a voz padrão de "feminina" e
//   "masculina". O programa de voz vem no app; o modelo é baixado uma vez, em silêncio.
// - Voz do Mac (`say`): reserva enquanto o modelo baixa, em Mac Intel ou se a voz de IA falhar,
//   e para quem escolher uma voz do Mac pelo nome. O `say` escreve um AIFF, convertido para WAV
//   com o `afconvert` (os dois já vêm no Mac).
const { execFile } = require('child_process');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { fitPace, trimSilence, wavSeconds } = require('./maestroAudio');
const qwen = require('./maestroQwen');

/** Duração máxima de uma narração (s): evita travar o app com um texto gigante por engano. */
const MAX_SECONDS = 120;
/** Teto de caracteres: o `say` engasga com textos enormes. */
const MAX_CHARS = 1200;
/**
 * Ritmo (palavras por minuto) do `say`. Ele aceita de 80 a 420, mas abaixo de 130 a fala sai
 * arrastada: marcação maior que a fala vira silêncio no fim.
 */
const MIN_RATE = 130;
const MAX_RATE = 420;
/** Ritmo normal do `say` (velocidade 1 da contagem). */
const NATURAL_RATE = 175;

// caminhos completos: o app aberto pelo Finder não herda o PATH do Terminal
const SAY = '/usr/bin/say';
const AFCONVERT = '/usr/bin/afconvert';

const INSTALL_HINT = 'Para instalar: Ajustes do Sistema → Acessibilidade → Conteúdo Falado → Voz do Sistema → Gerenciar Vozes → Português (Brasil).';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim() || err.message));
      else resolve(stdout?.toString() ?? '');
    });
  });
}

/**
 * Vozes preferidas por gênero, da que soa mais natural para a menos (nome sem o idioma).
 * O macOS não diz o gênero da voz: a separação usa os nomes que ele traz.
 */
const FEMALE_FIRST = ['luciana', 'fernanda', 'francisca', 'flo', 'sandy', 'shelley', 'joana', 'catarina', 'grandma'];
const MALE_FIRST = ['felipe', 'thiago', 'antonio', 'antônio', 'eddy', 'reed', 'rocko', 'joaquim', 'grandpa'];
const FEMALE_HINTS = /^(luciana|joana|ana|alice|maria|helena|luísa|luisa|fernanda|francisca|camila|catarina|vitoria|vitória|isabela|beatriz|flo|sandy|shelley|grandma|sara|sarah|karen|samantha|victoria|moira|tessa|fiona|amelie|anna|melina|kyoko|paulina|milena|nora|ellen|linda|silvia|valentina|lucia|elena|ines|mónica|monica)$/i;
const MALE_HINTS = /^(felipe|daniel|joaquim|ricardo|marcos|bruno|thiago|antonio|antônio|paulo|carlos|eduardo|rafael|henrique|jorge|pedro|tomás|tomas|eddy|reed|rocko|grandpa|alex|fred|ralph|albert|bruce|diego|juan|pablo|luca|paolo|yuri|magnus)$/i;

/** Nome da voz sem o idioma e sem a qualidade entre parênteses ("Eddy (Português (Brasil))" → "Eddy"). */
function baseName(name) {
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
}

/** Versões baixadas soam melhor: Premium > Melhorada/Enhanced > a compacta que vem de fábrica. */
function quality(name) {
  if (/premium/i.test(name)) return 2;
  if (/enhanced|melhorad|aprimorad|avançad/i.test(name)) return 1;
  return 0;
}

function genderOf(name) {
  const base = baseName(name).toLowerCase();
  if (FEMALE_FIRST.includes(base) || FEMALE_HINTS.test(base)) return 'feminina';
  if (MALE_FIRST.includes(base) || MALE_HINTS.test(base)) return 'masculina';
  return 'outra';
}

/**
 * Uma linha de `say -v '?'`. Os nomes das vozes novas trazem o idioma entre parênteses e às
 * vezes só um espaço antes do código do idioma:
 *   "Luciana             pt_BR    # Olá, meu nome é Luciana."
 *   "Eddy (Português (Brasil)) pt_BR    # Olá, meu nome é Eddy."
 */
function parseVoiceLine(line) {
  const m = line.match(/^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]{2,4})\s+#/);
  if (!m) return null;
  const name = m[1].trim();
  return { id: name, name, gender: genderOf(name), locale: m[2] };
}

/** Vozes do `say` instaladas no Mac. */
async function listMacVoices() {
  const raw = await run(SAY, ['-v', '?']);
  return raw.split('\n').map(parseVoiceLine).filter(Boolean);
}

/** Todas as vozes para a tela: as de IA primeiro (se o motor veio no app), depois as do Mac. */
async function listVoices() {
  const st = qwen.status();
  const ia = st.supported && st.engine
    ? qwen.QWEN_VOICES.map((v) => ({ id: v.id, name: v.name, gender: v.gender, locale: 'pt_BR', engine: 'qwen' }))
    : [];
  const mac = (await listMacVoices().catch(() => [])).map((v) => ({ ...v, engine: 'mac' }));
  return [...ia, ...mac];
}

/** Ordem para escolher: português do Brasil, melhor qualidade, depois a preferência de nome. */
function rankVoices(voices, gender) {
  const prefs = gender === 'masculina' ? MALE_FIRST : gender === 'feminina' ? FEMALE_FIRST : [...FEMALE_FIRST, ...MALE_FIRST];
  const pref = (v) => {
    const i = prefs.indexOf(baseName(v.name).toLowerCase());
    return i < 0 ? 99 : i;
  };
  const lang = (v) => (v.locale === 'pt_BR' ? 0 : 1);
  return [...voices].sort((a, b) => lang(a) - lang(b) || quality(b.name) - quality(a.name) || pref(a) - pref(b));
}

/**
 * Escolhe a voz pelo pedido do usuário (feminina/masculina ou o nome exato de uma voz).
 * Só usa voz em português: uma voz inglesa lendo português sai incompreensível. Quando o gênero
 * pedido não está instalado, usa a melhor voz em português que existir e avisa como instalar.
 */
function pickVoice(voices, wanted) {
  const exact = voices.find((v) => v.name === wanted);
  if (exact) return { name: exact.name, gender: exact.gender, locale: exact.locale, note: null };

  const portuguese = voices.filter((v) => /^pt/i.test(v.locale));
  if (portuguese.length === 0) return null;
  const gender = wanted === 'feminina' || wanted === 'masculina' ? wanted : null;
  const sameGender = gender ? portuguese.filter((v) => v.gender === gender) : portuguese;
  const hit = rankVoices(sameGender, gender)[0];
  if (hit) return { name: hit.name, gender: hit.gender, locale: hit.locale, note: null };

  const fallback = rankVoices(portuguese, null)[0];
  return {
    name: fallback.name,
    gender: fallback.gender,
    locale: fallback.locale,
    note: `A voz ${gender} em português não está instalada no Mac. Usei "${baseName(fallback.name)}". ${INSTALL_HINT}`,
  };
}

/**
 * Gera o áudio da narração.
 * - `wpm`: palavras por minuto de partida; a interface tira isso do tamanho da marcação.
 * - `span`: tamanho da marcação (s). O ritmo é ajustado medindo o áudio até caber nela.
 * Devolve o WAV em base64 (o IPC transporta string sem gastar memória com ArrayBuffer gigante).
 */
async function renderNarration(payload) {
  const text = String(payload?.text ?? '').trim();
  if (!text) throw new Error('Escreva o texto que o maestro deve falar.');
  if (text.length > MAX_CHARS) throw new Error(`Texto longo demais para uma fala (máximo de ${MAX_CHARS} letras). Divida em mais marcações.`);

  const span = Number(payload?.span) || 0;
  let wanted = payload?.voice;
  let iaNote = null;

  // Voz de IA brasileira. Se não puder falar (modelo baixando, Mac Intel, erro do motor), cai na
  // voz do Mac do mesmo gênero e avisa o motivo.
  const iaVoice = qwen.qwenVoiceFor(wanted);
  if (iaVoice) {
    try {
      const r = await qwen.render({ text, voice: iaVoice, span, pace: payload?.pace, group: payload?.group });
      if (r.seconds > MAX_SECONDS) throw new Error('A fala passou de 2 minutos. Divida o texto em mais marcações.');
      return {
        ok: true,
        voice: iaVoice.name,
        voiceGender: iaVoice.gender,
        locale: 'pt_BR',
        engine: 'qwen',
        note: null,
        rate: r.tempo,
        /** fator de velocidade que a tela aplica (o WAV vem na velocidade natural) */
        tempo: r.tempo,
        seconds: r.seconds,
        overflow: r.overflow,
        wavBase64: r.buf.toString('base64'),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/2 minutos/.test(msg)) throw err;
      iaNote = `${msg.replace(/\.?$/, '.')} Usei a voz do Mac por enquanto.`;
      wanted = iaVoice.gender;
    }
  }

  const voices = await listMacVoices();
  const picked = pickVoice(voices, wanted);
  if (!picked) throw new Error(iaNote ?? `Nenhuma voz em português está instalada no Mac. ${INSTALL_HINT}`);
  const voice = picked.name;

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vs-maestro-'));
  try {
    // contagem (`pace`): ritmo fixo, só acelera se não couber; senão o tamanho manda
    const fixedRate = Number(payload?.pace) > 0 ? clampRate(NATURAL_RATE * Number(payload.pace)) : null;
    const startRate = fixedRate ?? clampRate(Number(payload?.wpm) || NATURAL_RATE);
    const { pace: rate, result } = span > 0
      ? await fitPace((r) => speakOnce(voice, text, r, tmp), startRate, span, { min: fixedRate ?? MIN_RATE, max: MAX_RATE, round: Math.round, minGap: 4 })
      : { pace: startRate, result: await speakOnce(voice, text, startRate, tmp) };

    if (result.seconds > MAX_SECONDS) throw new Error('A fala passou de 2 minutos. Divida o texto em mais marcações.');
    return {
      ok: true,
      voice,
      voiceGender: picked.gender,
      locale: picked.locale,
      engine: 'mac',
      note: [iaNote, picked.note].filter(Boolean).join(' ') || null,
      rate,
      seconds: result.seconds,
      /** true quando nem no ritmo máximo o texto coube na marcação */
      overflow: span > 0 && result.seconds > span * 1.02,
      wavBase64: result.buf.toString('base64'),
    };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function clampRate(r) {
  return Math.max(MIN_RATE, Math.min(MAX_RATE, Math.round(r)));
}

/** Gera a fala uma vez, já em WAV sem silêncio nas pontas, e devolve a duração real. */
async function speakOnce(voice, text, wpm, tmp) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const aiff = path.join(tmp, `fala-${stamp}.aiff`);
  const wav = path.join(tmp, `fala-${stamp}.wav`);
  // O `say` lê o texto da entrada padrão: evita problemas de escape com aspas e
  // caracteres especiais no texto do usuário.
  await new Promise((resolve, reject) => {
    const child = execFile(SAY, ['-v', voice, '-r', String(wpm), '-o', aiff], { maxBuffer: 8 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim() || err.message));
      else resolve();
    });
    child.stdin.end(text, 'utf8');
  });
  // AIFF → WAV 16 bits a 44,1 kHz, que é o que o motor de áudio do app espera
  await run(AFCONVERT, ['-f', 'WAVE', '-d', 'LEI16@44100', aiff, wav]);
  // Corta o silêncio que o `say` põe antes e depois: sem isso a fala passa do fim da marcação
  const buf = trimSilence(await fsp.readFile(wav));
  await fsp.rm(aiff, { force: true }).catch(() => {});
  await fsp.rm(wav, { force: true }).catch(() => {});
  return { buf, seconds: wavSeconds(buf) };
}

module.exports = {
  listVoices,
  renderNarration,
  pickVoice,
  parseVoiceLine,
  genderOf,
  voiceStatus: () => qwen.status(),
};
