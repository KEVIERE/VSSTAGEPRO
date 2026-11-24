// Regras puras de quais clipes da música no ar precisam ganhar um reprodutor agora (sem Stop/Play)
// e de quando um preparo guardado ainda vale. Sem dependências do navegador: os testes rodam no Node.

export interface LiveClipInfo {
  id: string;
  songId: string;
  trackId: string;
  startTime: number;
  /** Duração tocada (já sem os cortes). */
  playLength: number;
}

/**
 * Clipes da música no ar que estão na timeline, têm áudio aberto e ainda não têm reprodutor: a
 * fala do Maestro IA que chegou com o Play rodando, a fala gerada de novo (o id muda), o áudio
 * consolidado, uma gravação ou um clipe colado. Antes eles ficavam mudos até o próximo Play.
 * Clipe que já terminou no ponto atual da música fica de fora (não há mais o que tocar).
 */
export function clipsToAttachLive(
  clips: LiveClipInfo[],
  songId: string,
  activeIds: ReadonlySet<string>,
  trackIds: ReadonlySet<string>,
  hasAudio: (clipId: string) => boolean,
  nowPos: number,
): LiveClipInfo[] {
  return clips.filter((c) => c.songId === songId
    && trackIds.has(c.trackId)
    && !activeIds.has(c.id)
    && hasAudio(c.id)
    && nowPos < c.startTime + c.playLength);
}

/**
 * Parte da assinatura de um preparo que descreve os clipes (sem BPM e tom). Memória:
 * "bpm|tom|clipes"; disco: "disk|bpm|tom|clipes".
 */
export function clipPartOfSignature(sig: string): string {
  const skip = sig.startsWith('disk|') ? 3 : 2;
  let at = -1;
  for (let i = 0; i < skip; i++) {
    at = sig.indexOf('|', at + 1);
    if (at < 0) return sig;
  }
  return sig.slice(at + 1);
}

/**
 * Trocar BPM ou tom com um preparo guardado só renova a assinatura dele quando os clipes são os
 * mesmos. Antes a assinatura era trocada sempre: um preparo de clipes velhos passava a valer de novo.
 */
export function canRestampSignature(oldSig: string, newSig: string | null): boolean {
  return !!newSig && clipPartOfSignature(oldSig) === clipPartOfSignature(newSig);
}
