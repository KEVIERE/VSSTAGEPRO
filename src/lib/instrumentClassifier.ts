// Motor de escuta treinado com VS de verdade: em vez de ler as 521 notas genéricas do YAMNet
// ("Music", "Guitar", "Piano"...), pega a "impressão digital" de 1024 números que o YAMNet tira
// de cada trecho (o embedding) e passa por uma regressão logística pequena, treinada com stems
// de VS reais (violão x guitarra, sanfona x teclado, voz guia, maestro, click...).
//
// Roda local, sem internet além do YAMNet que o programa já baixa, sem custo e sem dependência
// nativa: é só uma conta de multiplicar (11 x 1024), menos de 1 ms por áudio. Vale igual para
// Mac Apple Silicon, Mac Intel, Catalina e Windows.
//
// Uso (ver aiRouter.ts): o worker devolve a média do embedding de cada trecho de 5 s; aqui se
// tira a média das probabilidades dos trechos. A regra que junta com o motor de hoje fica em
// instrumentOverride (limiares medidos separando por música).
import type { RoutingTarget } from '@/types';
import weights from '@/lib/instrumentClassifier.weights.json';

export const INSTRUMENT_EMBEDDING_SIZE = 1024;

interface ClassifierWeights {
  versao: number;
  classes: string[];
  /** classes treinadas com menos de 2 músicas: o motor novo não decide nelas (fica o de hoje) */
  poucas_musicas: string[];
  /** confiança para trocar a resposta do motor de hoje */
  limiar_troca: number;
  /** confiança para decidir quando o motor de hoje não reconheceu nada */
  limiar_sem_resposta: number;
  /** um vetor de 1024 pesos por classe (já com a normalização embutida) */
  W: number[][];
  b: number[];
}

const MODEL = weights as ClassifierWeights;
const THIN = new Set(MODEL.poucas_musicas);

/** Medido separando por música: trocar o de hoje só com confiança de 70% ou mais. */
export const INSTRUMENT_SWITCH_CONFIDENCE = MODEL.limiar_troca;
/** Sem resposta do motor de hoje, o novo decide a partir de 60%. */
export const INSTRUMENT_MIN_CONFIDENCE = MODEL.limiar_sem_resposta;

/** Classe do motor -> faixa do programa (mesmos nomes do nameRouter). */
const CLASS_ROUTE: Record<string, { target: RoutingTarget; childName: string }> = {
  voz: { target: 'track-guia', childName: 'Guia' },
  click: { target: 'track-click', childName: 'Click' },
  maestro: { target: 'track-maestro', childName: 'Maestro' },
  bateria: { target: 'track-bateria', childName: 'Bateria' },
  percussao: { target: 'track-percussoes', childName: 'Percussão' },
  baixo: { target: 'track-contrabaixo', childName: 'Contrabaixo' },
  guitarra: { target: 'track-guitarras', childName: 'Guitarra' },
  violao: { target: 'track-violoes', childName: 'Violão' },
  sanfona: { target: 'track-sanfonas', childName: 'Sanfona' },
  teclados: { target: 'track-teclados', childName: 'Teclado' },
  metais: { target: 'track-outros', childName: 'Metais' },
  cordas: { target: 'track-outros', childName: 'Cordas' },
};

export interface InstrumentGuess {
  target: RoutingTarget;
  childName: string;
  /** probabilidade média entre os trechos (0 a 1) */
  confidence: number;
  /** nome interno da classe ("violao", "sanfona"...) */
  instrument: string;
}

function softmaxInto(z: Float64Array): void {
  let mx = -Infinity;
  for (let i = 0; i < z.length; i++) if (z[i] > mx) mx = z[i];
  let s = 0;
  for (let i = 0; i < z.length; i++) { z[i] = Math.exp(z[i] - mx); s += z[i]; }
  for (let i = 0; i < z.length; i++) z[i] /= s;
}

/** Probabilidade de cada classe para um trecho (embedding médio de 1024 números). */
export function instrumentProbabilities(embedding: ArrayLike<number>): Float64Array {
  const C = MODEL.classes.length;
  const z = new Float64Array(C);
  if (embedding.length !== INSTRUMENT_EMBEDDING_SIZE) return z;
  for (let c = 0; c < C; c++) {
    const w = MODEL.W[c];
    let acc = MODEL.b[c];
    for (let i = 0; i < INSTRUMENT_EMBEDDING_SIZE; i++) acc += w[i] * embedding[i];
    z[c] = acc;
  }
  softmaxInto(z);
  return z;
}

/**
 * Junta os trechos de um áudio (média das probabilidades) e devolve o 1º e o 2º palpites.
 * Sem trecho válido devolve lista vazia.
 */
export function classifyInstrumentEmbeddings(embeddings: ArrayLike<number>[]): InstrumentGuess[] {
  const valid = embeddings.filter((e) => e && e.length === INSTRUMENT_EMBEDDING_SIZE);
  if (valid.length === 0) return [];
  const C = MODEL.classes.length;
  const mean = new Float64Array(C);
  for (const e of valid) {
    const p = instrumentProbabilities(e);
    for (let c = 0; c < C; c++) mean[c] += p[c] / valid.length;
  }
  const order = Array.from(mean.keys()).sort((a, b) => mean[b] - mean[a]);
  const out: InstrumentGuess[] = [];
  for (const c of order) {
    const route = CLASS_ROUTE[MODEL.classes[c]];
    if (!route || out.some((o) => o.target === route.target && o.childName === route.childName)) continue;
    out.push({ ...route, confidence: mean[c], instrument: MODEL.classes[c] });
    if (out.length === 2) break;
  }
  return out;
}

/** Faixa do motor de hoje -> classe do motor novo (para saber se é uma classe com poucas músicas). */
function classOfRoute(r: { target: RoutingTarget; childName: string }): string {
  for (const [cls, route] of Object.entries(CLASS_ROUTE)) if (route.target === r.target && route.childName === r.childName) return cls;
  for (const [cls, route] of Object.entries(CLASS_ROUTE)) if (route.target === r.target && r.target !== 'track-outros') return cls;
  return '';
}

/**
 * Junta os dois motores, na regra medida (separação por música, 76 stems de 6 músicas: de 68% para 82%,
 * sem piorar nenhum instrumento):
 * - o motor novo não decide nas classes com poucas músicas no treino (hoje: baixo, bateria, guitarra);
 * - se o motor de hoje respondeu uma dessas classes, fica a resposta dele;
 * - se o motor de hoje respondeu outra coisa, o novo só troca com confiança >= INSTRUMENT_SWITCH_CONFIDENCE;
 * - se o motor de hoje não reconheceu nada, o novo decide com confiança >= INSTRUMENT_MIN_CONFIDENCE.
 * Devolve o palpite do motor novo quando ele vence, ou null para ficar com o de hoje.
 */
export function instrumentOverride(
  today: { target: RoutingTarget; childName: string } | null,
  embeddings: ArrayLike<number>[]
): InstrumentGuess | null {
  return overrideFrom(today, classifyInstrumentEmbeddings(embeddings));
}

/**
 * O motor novo diz o mesmo que o de hoje? Pela faixa: o nome da trilha do de hoje é mais
 * específico ("Piano", "Pad") que o do motor novo ("Teclado") e fica. Em Outros conta o instrumento.
 */
function sameAnswer(today: { target: RoutingTarget; childName: string }, guess: InstrumentGuess): boolean {
  if (today.target !== guess.target) return false;
  return today.target !== 'track-outros' || today.childName === guess.childName || classOfRoute(today) === guess.instrument;
}

function overrideFrom(today: { target: RoutingTarget; childName: string } | null, guesses: InstrumentGuess[]): InstrumentGuess | null {
  const [first] = guesses;
  if (!first || THIN.has(first.instrument)) return null;
  if (today) {
    if (THIN.has(classOfRoute(today))) return null;
    if (sameAnswer(today, first)) return null;
    return first.confidence >= INSTRUMENT_SWITCH_CONFIDENCE ? first : null;
  }
  return first.confidence >= INSTRUMENT_MIN_CONFIDENCE ? first : null;
}

export interface InstrumentVerdict {
  /** o motor novo venceu a votação de hoje (troca a faixa) */
  heard: InstrumentGuess | null;
  /**
   * o motor novo está seguro: venceu, ou concordou com a votação de hoje com confiança de
   * INSTRUMENT_SWITCH_CONFIDENCE ou mais (fora das classes com poucas músicas). Só então os
   * palpites da conferência e o grau de certeza passam a usar a confiança dele.
   */
  sure: boolean;
  /** 1º e 2º palpites do motor novo (vazio sem trecho válido) */
  guesses: InstrumentGuess[];
}

/** A mesma regra de instrumentOverride, dizendo também se o motor novo está seguro. */
export function instrumentVerdict(
  today: { target: RoutingTarget; childName: string } | null,
  embeddings: ArrayLike<number>[]
): InstrumentVerdict {
  const guesses = classifyInstrumentEmbeddings(embeddings);
  const heard = overrideFrom(today, guesses);
  const first = guesses[0];
  const agrees = !heard && !!first && !!today && !THIN.has(first.instrument) && !THIN.has(classOfRoute(today))
    && sameAnswer(today, first)
    && first.confidence >= INSTRUMENT_SWITCH_CONFIDENCE;
  return { heard, sure: !!heard || agrees, guesses };
}
