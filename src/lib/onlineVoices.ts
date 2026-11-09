// Vozes online do Maestro por IA: pacotes de vozes gratuitas da internet, abaixo das vozes padrão
// (Feminina e Masculina). Precisam de internet e NÃO podem custar nada ao dono do projeto: as
// vozes pagas (Google Gemini e ElevenLabs, pela Replicate) foram tiradas em 02/11/2026.
//
// A lista está vazia até as vozes gratuitas entrarem (ver desktop/ e src/lib/maestroCloud.ts).

export type OnlinePackId = string;

export interface OnlineVoice {
  /** Id gravado na marcação: "online:<pacote>:<voz>". */
  id: string;
  pack: OnlinePackId;
  /** Nome da voz no serviço (é o que vai no pedido). */
  name: string;
  gender: 'feminina' | 'masculina';
  /** Como a voz soa, em uma palavra. */
  hint: string;
}

export interface OnlinePack {
  id: OnlinePackId;
  label: string;
  description: string;
  voices: OnlineVoice[];
}

const PREFIX = 'online:';

/**
 * Sem vozes online por enquanto. A tentativa com as vozes neurais da Microsoft (edge-tts) foi
 * tirada em 02/11/2026: o serviço não é oficial, a Microsoft trocou a assinatura (versão 2) e a
 * biblioteca em JavaScript parou de devolver áudio. Voltar só com uma fonte estável e sem custo.
 */
export const ONLINE_PACKS: ReadonlyArray<OnlinePack> = [];

/** As vozes online que viram as vozes padrão (Feminina e Masculina) quando há internet. */
export const ONLINE_DEFAULT: Record<'feminina' | 'masculina', string> = {
  feminina: `${PREFIX}microsoft:Francisca`,
  masculina: `${PREFIX}microsoft:Antonio`,
};

/** Todas as vozes online, de todos os pacotes. */
export const ONLINE_VOICES: ReadonlyArray<OnlineVoice> = ONLINE_PACKS.flatMap((p) => p.voices);

/** É uma voz online? ("online:<pacote>:<voz>") */
export function isOnlineVoice(id: string | undefined): boolean {
  return !!id && id.startsWith(PREFIX);
}

/** A voz online pelo id (null se não existir mais no catálogo). */
export function onlineVoiceById(id: string | undefined): OnlineVoice | null {
  if (!isOnlineVoice(id)) return null;
  return ONLINE_VOICES.find((v) => v.id === id) ?? null;
}

/** Nome do pacote ("Microsoft"). */
export function onlinePackLabel(pack: OnlinePackId): string {
  return ONLINE_PACKS.find((p) => p.id === pack)?.label ?? pack;
}

/** Rótulo curto para a régua e as dicas: "Francisca". */
export function onlineVoiceLabel(id: string | undefined): string | null {
  return onlineVoiceById(id)?.name ?? null;
}
