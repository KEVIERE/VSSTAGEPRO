// Falas prontas do Maestro por IA: frases comuns de palco gravadas uma vez, nas vozes Felipe e Moça
// (ElevenLabs, plano pago), em três intensidades. Os arquivos ficam em
// public/maestro-falas/<voz>/<id>.mp3 (Normal) e public/maestro-falas/<voz>/<calma|forte>/<id>.mp3,
// e funcionam sem internet. Texto fora desta lista sai numa voz do próprio Mac (Masculina ou Feminina).

export interface ReadyCue { id: string; text: string }
export interface ReadyCueGroup { id: string; label: string; cues: ReadyCue[] }

export const READY_CUE_GROUPS: ReadonlyArray<ReadyCueGroup> = [
  { id: 'partes-da-musica', label: "Partes da música", cues: [
    { id: 'intro', text: "Intro" },
    { id: 'verso', text: "Verso" },
    { id: 'verso-1', text: "Verso 1" },
    { id: 'verso-2', text: "Verso 2" },
    { id: 'verso-3', text: "Verso 3" },
    { id: 'verso-4', text: "Verso 4" },
    { id: 'pre-refrao', text: "Pré-refrão" },
    { id: 'pre-refrao-2', text: "Pré-refrão 2" },
    { id: 'refrao', text: "Refrão" },
    { id: 'refrao-2', text: "Refrão 2" },
    { id: 'refrao-3', text: "Refrão 3" },
    { id: 'pos-refrao', text: "Pós-refrão" },
    { id: 'ponte', text: "Ponte" },
    { id: 'ponte-2', text: "Ponte 2" },
    { id: 'interludio', text: "Interlúdio" },
    { id: 'instrumental', text: "Instrumental" },
    { id: 'solo', text: "Solo" },
    { id: 'coro', text: "Coro" },
    { id: 'espontaneo', text: "Espontâneo" },
    { id: 'medley', text: "Medley" },
    { id: 'ultimo-verso', text: "Último verso" },
    { id: 'ultimo-refrao', text: "Último refrão" },
    { id: 'ultima-ponte', text: "Última ponte" },
    { id: 'final', text: "Final" },
  ] },
  { id: 'para-onde-ir', label: "Para onde ir", cues: [
    { id: 'vai-pro-refrao', text: "Vai pro refrão" },
    { id: 'vai-pra-ponte', text: "Vai pra ponte" },
    { id: 'vai-pro-solo', text: "Vai pro solo" },
    { id: 'vai-pro-verso', text: "Vai pro verso" },
    { id: 'volta-pro-refrao', text: "Volta pro refrão" },
    { id: 'volta-pra-ponte', text: "Volta pra ponte" },
    { id: 'volta-pro-verso', text: "Volta pro verso" },
    { id: 'volta-pro-inicio', text: "Volta pro início" },
    { id: 'do-comeco', text: "Do começo" },
    { id: 'pula-a-ponte', text: "Pula a ponte" },
    { id: 'pula-o-solo', text: "Pula o solo" },
    { id: 'pula-o-verso', text: "Pula o verso" },
    { id: 'segue', text: "Segue" },
    { id: 'emenda', text: "Emenda" },
    { id: 'emenda-direto', text: "Emenda direto" },
    { id: 'sem-pausa', text: "Sem pausa" },
    { id: 'vamos-pro-final', text: "Vamos pro final" },
    { id: 'proxima-musica', text: "Próxima música" },
  ] },
  { id: 'repeticao', label: "Repetição", cues: [
    { id: 'repete', text: "Repete" },
    { id: 'repete-o-refrao', text: "Repete o refrão" },
    { id: 'repete-a-ponte', text: "Repete a ponte" },
    { id: 'mais-uma-vez', text: "Mais uma vez" },
    { id: 'mais-duas-vezes', text: "Mais duas vezes" },
    { id: 'duas-vezes', text: "Duas vezes" },
    { id: 'tres-vezes', text: "Três vezes" },
    { id: 'quatro-vezes', text: "Quatro vezes" },
    { id: 'mais-uma-no-refrao', text: "Mais uma no refrão" },
    { id: 'ultima-vez', text: "Última vez" },
    { id: 'ultima', text: "Última" },
  ] },
  { id: 'intensidade', label: "Intensidade", cues: [
    { id: 'cresce', text: "Cresce" },
    { id: 'vai-crescendo', text: "Vai crescendo" },
    { id: 'explode', text: "Explode" },
    { id: 'mais-forte', text: "Mais forte" },
    { id: 'mais-leve', text: "Mais leve" },
    { id: 'baixa', text: "Baixa" },
    { id: 'vai-baixando', text: "Vai baixando" },
    { id: 'meia-forca', text: "Meia força" },
    { id: 'pesado', text: "Pesado" },
    { id: 'segura', text: "Segura" },
    { id: 'segura-o-clima', text: "Segura o clima" },
    { id: 'volta-tudo', text: "Volta tudo" },
    { id: 'entra-a-banda', text: "Entra a banda" },
    { id: 'todo-mundo', text: "Todo mundo" },
    { id: 'vai-sumindo', text: "Vai sumindo" },
  ] },
  { id: 'paradas-e-finais', label: "Paradas e finais", cues: [
    { id: 'breque', text: "Breque" },
    { id: 'breque-no-um', text: "Breque no um" },
    { id: 'para-tudo', text: "Para tudo" },
    { id: 'corta', text: "Corta" },
    { id: 'corta-seco', text: "Corta seco" },
    { id: 'corta-no-quatro', text: "Corta no quatro" },
    { id: 'final-em-cima', text: "Final em cima" },
    { id: 'final-no-breque', text: "Final no breque" },
    { id: 'final-segurando', text: "Final segurando" },
    { id: 'segura-no-final', text: "Segura no final" },
    { id: 'final-arrastado', text: "Final arrastado" },
    { id: 'silencio', text: "Silêncio" },
  ] },
  { id: 'quem-toca', label: "Quem toca", cues: [
    { id: 'so-voz', text: "Só voz" },
    { id: 'a-capela', text: "À capela" },
    { id: 'so-voz-e-teclado', text: "Só voz e teclado" },
    { id: 'so-voz-e-violao', text: "Só voz e violão" },
    { id: 'so-voz-e-sanfona', text: "Só voz e sanfona" },
    { id: 'so-bateria', text: "Só bateria" },
    { id: 'so-baixo-e-bateria', text: "Só baixo e bateria" },
    { id: 'so-percussao', text: "Só percussão" },
    { id: 'so-teclado', text: "Só teclado" },
    { id: 'so-violao', text: "Só violão" },
    { id: 'so-sanfona', text: "Só sanfona" },
    { id: 'so-o-pad', text: "Só o pad" },
    { id: 'sem-bateria', text: "Sem bateria" },
    { id: 'sem-baixo', text: "Sem baixo" },
    { id: 'sem-guitarra', text: "Sem guitarra" },
    { id: 'sem-teclado', text: "Sem teclado" },
    { id: 'sem-sanfona', text: "Sem sanfona" },
    { id: 'so-voz-e-piano', text: "Só voz e piano" },
    { id: 'so-piano', text: "Só piano" },
    { id: 'so-cavaco', text: "Só cavaco" },
    { id: 'so-metais', text: "Só metais" },
    { id: 'so-cordas', text: "Só cordas" },
    { id: 'sem-metais', text: "Sem metais" },
    { id: 'sem-percussao', text: "Sem percussão" },
    { id: 'sem-piano', text: "Sem piano" },
    { id: 'sem-cavaco', text: "Sem cavaco" },
  ] },
  { id: 'entradas-e-solos', label: "Entradas e solos", cues: [
    { id: 'entra-a-bateria', text: "Entra a bateria" },
    { id: 'entra-o-baixo', text: "Entra o baixo" },
    { id: 'entra-a-guitarra', text: "Entra a guitarra" },
    { id: 'entra-o-violao', text: "Entra o violão" },
    { id: 'entra-o-teclado', text: "Entra o teclado" },
    { id: 'entra-o-piano', text: "Entra o piano" },
    { id: 'entra-o-orgao', text: "Entra o órgão" },
    { id: 'entra-a-sanfona', text: "Entra a sanfona" },
    { id: 'entra-o-cavaco', text: "Entra o cavaco" },
    { id: 'entra-o-bandolim', text: "Entra o bandolim" },
    { id: 'entra-a-viola', text: "Entra a viola" },
    { id: 'entra-a-percussao', text: "Entra a percussão" },
    { id: 'entra-o-pandeiro', text: "Entra o pandeiro" },
    { id: 'entra-a-zabumba', text: "Entra a zabumba" },
    { id: 'entra-o-triangulo', text: "Entra o triângulo" },
    { id: 'entra-os-metais', text: "Entra os metais" },
    { id: 'entra-o-sax', text: "Entra o sax" },
    { id: 'entra-o-trompete', text: "Entra o trompete" },
    { id: 'entra-o-trombone', text: "Entra o trombone" },
    { id: 'entra-a-flauta', text: "Entra a flauta" },
    { id: 'entra-a-gaita', text: "Entra a gaita" },
    { id: 'entra-o-violino', text: "Entra o violino" },
    { id: 'entra-as-cordas', text: "Entra as cordas" },
    { id: 'entra-o-coro', text: "Entra o coro" },
    { id: 'solo-de-guitarra', text: "Solo de guitarra" },
    { id: 'solo-de-violao', text: "Solo de violão" },
    { id: 'solo-de-teclado', text: "Solo de teclado" },
    { id: 'solo-de-piano', text: "Solo de piano" },
    { id: 'solo-de-orgao', text: "Solo de órgão" },
    { id: 'solo-de-sintetizador', text: "Solo de sintetizador" },
    { id: 'solo-de-sanfona', text: "Solo de sanfona" },
    { id: 'solo-de-cavaco', text: "Solo de cavaco" },
    { id: 'solo-de-bandolim', text: "Solo de bandolim" },
    { id: 'solo-de-viola', text: "Solo de viola" },
    { id: 'solo-de-baixo', text: "Solo de baixo" },
    { id: 'solo-de-bateria', text: "Solo de bateria" },
    { id: 'solo-de-percussao', text: "Solo de percussão" },
    { id: 'solo-de-pandeiro', text: "Solo de pandeiro" },
    { id: 'solo-de-zabumba', text: "Solo de zabumba" },
    { id: 'solo-de-metais', text: "Solo de metais" },
    { id: 'solo-de-sax', text: "Solo de sax" },
    { id: 'solo-de-trompete', text: "Solo de trompete" },
    { id: 'solo-de-trombone', text: "Solo de trombone" },
    { id: 'solo-de-flauta', text: "Solo de flauta" },
    { id: 'solo-de-gaita', text: "Solo de gaita" },
    { id: 'solo-de-violino', text: "Solo de violino" },
  ] },
  { id: 'vozes', label: "Vozes", cues: [
    { id: 'primeira-voz', text: "Primeira voz" },
    { id: 'segunda-voz', text: "Segunda voz" },
    { id: 'terceira-voz', text: "Terceira voz" },
    { id: 'abre-as-vozes', text: "Abre as vozes" },
    { id: 'fecha-as-vozes', text: "Fecha as vozes" },
    { id: 'unissono', text: "Uníssono" },
    { id: 'so-a-primeira-voz', text: "Só a primeira voz" },
    { id: 'entra-a-segunda-voz', text: "Entra a segunda voz" },
  ] },
  { id: 'tom', label: "Tom", cues: [
    { id: 'sobe-o-tom', text: "Sobe o tom" },
    { id: 'sobe-meio-tom', text: "Sobe meio tom" },
    { id: 'sobe-um-tom', text: "Sobe um tom" },
    { id: 'desce-o-tom', text: "Desce o tom" },
    { id: 'desce-meio-tom', text: "Desce meio tom" },
    { id: 'desce-um-tom', text: "Desce um tom" },
    { id: 'tom-original', text: "Tom original" },
  ] },
  { id: 'andamento', label: "Andamento", cues: [
    { id: 'acelera', text: "Acelera" },
    { id: 'mais-rapido', text: "Mais rápido" },
    { id: 'mais-devagar', text: "Mais devagar" },
    { id: 'segura-o-andamento', text: "Segura o andamento" },
    { id: 'dobra-o-tempo', text: "Dobra o tempo" },
    { id: 'meio-tempo', text: "Meio tempo" },
    { id: 'tempo-normal', text: "Tempo normal" },
  ] },
  { id: 'publico', label: "Público", cues: [
    { id: 'publico-canta', text: "Público canta" },
    { id: 'todo-mundo-canta', text: "Todo mundo canta" },
    { id: 'so-o-publico', text: "Só o público" },
    { id: 'chama-o-publico', text: "Chama o público" },
    { id: 'palmas', text: "Palmas" },
    { id: 'maos-pra-cima', text: "Mãos pra cima" },
    { id: 'todo-mundo-pulando', text: "Todo mundo pulando" },
  ] },
  { id: 'momentos-do-show', label: "Momentos do show", cues: [
    { id: 'fala', text: "Fala" },
    { id: 'momento-de-fala', text: "Momento de fala" },
    { id: 'agradecimento', text: "Agradecimento" },
    { id: 'oracao', text: "Oração" },
    { id: 'ministracao', text: "Ministração" },
    { id: 'pausa', text: "Pausa" },
    { id: 'intervalo', text: "Intervalo" },
    { id: 'bis', text: "Bis" },
  ] },
  { id: 'contagem-e-aviso', label: "Contagem e aviso", cues: [
    { id: 'um', text: "Um" },
    { id: 'dois', text: "Dois" },
    { id: 'tres', text: "Três" },
    { id: 'quatro', text: "Quatro" },
    { id: 'cinco', text: "Cinco" },
    { id: 'seis', text: "Seis" },
    { id: 'sete', text: "Sete" },
    { id: 'oito', text: "Oito" },
    { id: 'prepara', text: "Prepara" },
    { id: 'atencao', text: "Atenção" },
    { id: 'agora', text: "Agora" },
    { id: 'vai', text: "Vai" },
    { id: 'ja', text: "Já" },
    { id: 'no-proximo', text: "No próximo" },
    { id: 'ultimo-compasso', text: "Último compasso" },
    { id: 'faltam-dois-compassos', text: "Faltam dois compassos" },
    { id: 'faltam-quatro-compassos', text: "Faltam quatro compassos" },
    { id: 'dois-compassos', text: "Dois compassos" },
    { id: 'quatro-compassos', text: "Quatro compassos" },
    { id: 'oito-compassos', text: "Oito compassos" },
  ] },
];

export interface ReadyVoice {
  /** Id gravado na marcação (na intensidade Normal). */
  id: string;
  label: string;
  /** Pasta dos arquivos em public/maestro-falas. */
  dir: string;
  /** Voz do Mac usada quando o texto não é uma fala pronta. */
  fallback: 'masculina' | 'feminina';
}

/** Quanta energia a voz pronta põe na fala. */
export type ReadyIntensity = 'calma' | 'normal' | 'forte';

export const READY_INTENSITIES: ReadonlyArray<{ id: ReadyIntensity; label: string; hint: string }> = [
  { id: 'calma', label: 'Calma', hint: 'Fala tranquila, para momentos suaves' },
  { id: 'normal', label: 'Normal', hint: 'Fala animada, de maestro no palco' },
  { id: 'forte', label: 'Forte', hint: 'Fala empolgada, como quem grita por cima da banda' },
];

/** A voz pronta escolhida, já com a intensidade. */
export interface ReadyVoiceChoice extends ReadyVoice {
  intensity: ReadyIntensity;
}

export const READY_VOICES: ReadonlyArray<ReadyVoice> = [
  { id: 'pronta:felipe', label: 'Felipe', dir: 'felipe', fallback: 'masculina' },
  { id: 'pronta:moca', label: 'Moça', dir: 'moca', fallback: 'feminina' },
];

/**
 * A voz pronta de uma marcação. A intensidade vai junto no id ("pronta:felipe:forte"); sem ela
 * é a Normal. Assim a última voz usada já traz a intensidade para a próxima fala, e trocar a
 * intensidade gera a fala de novo.
 */
export function readyVoice(voice: string | undefined): ReadyVoiceChoice | null {
  if (!voice) return null;
  const [kind, dir, level, ...rest] = voice.split(':');
  if (kind !== 'pronta' || rest.length > 0) return null;
  const base = READY_VOICES.find((v) => v.dir === dir);
  if (!base) return null;
  if (level === undefined) return { ...base, intensity: 'normal' };
  return level === 'calma' || level === 'forte' ? { ...base, intensity: level } : null;
}

/** Id da voz pronta numa intensidade. */
export function readyVoiceId(voice: ReadyVoice, intensity: ReadyIntensity): string {
  return intensity === 'normal' ? voice.id : `${voice.id}:${intensity}`;
}

// Números por extenso valem o mesmo que em algarismo ("Verso um" = "Verso 1").
const NUMBER_WORDS: Record<string, string> = {
  um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', sete: '7', oito: '8',
};

/** Texto comparável: sem acento, sem pontuação, minúsculo ("Vai pro refrão!" = "vai pro refrao"). */
export function cueKey(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').map((w) => NUMBER_WORDS[w] ?? w).join(' ');
}

const BY_KEY = new Map(READY_CUE_GROUPS.flatMap((g) => g.cues.map((c) => [cueKey(c.text), c] as const)));

/** A fala pronta com este texto (ou null se o diretor escreveu outra coisa). */
export function findReadyCue(text: string): ReadyCue | null {
  return BY_KEY.get(cueKey(text)) ?? null;
}

/** Endereço do arquivo da fala, no site e no app do Mac. */
export function readyCueUrl(voice: ReadyVoiceChoice, cue: ReadyCue, base = '/'): string {
  const level = voice.intensity === 'normal' ? '' : `${voice.intensity}/`;
  return `${base.endsWith('/') ? base : `${base}/`}maestro-falas/${voice.dir}/${level}${cue.id}.mp3`;
}
