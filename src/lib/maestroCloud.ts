// Vozes online gratuitas do Maestro por IA. O áudio é gerado pelo app do Mac (desktop/), que fala
// com o serviço; nada passa pelo Supabase (o plano dele tem limite de memória e de tráfego) e nada
// é cobrado. No navegador não há como gerar.
//
// Tudo é opcional: sem internet ou sem o serviço, a tela avisa e as vozes padrão continuam.

export interface OnlineSpeech {
  bytes: Uint8Array;
  mime: string;
  voiceName: string;
}

/** Situação das vozes online para a tela: prontas, ou o motivo de não estarem. */
export type OnlineStatus = { ready: true } | { ready: false; reason: string };

/** Teto da fala: o mesmo da tela. */
const MAX_CHARS = 1200;

export async function onlineStatus(): Promise<OnlineStatus> {
  const bridge = typeof window !== 'undefined' ? window.vsDesktop?.maestroOnlineSpeak : undefined;
  if (!bridge) return { ready: false, reason: 'As vozes online só funcionam no app do Mac.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ready: false, reason: 'Sem internet: as vozes online precisam de conexão.' };
  }
  return { ready: true };
}

/** Esquece a situação guardada (mantido para quem chama depois de entrar ou sair da conta). */
export function forgetOnlineStatus(): void { /* sem estado guardado */ }

/** Gera a fala na voz online (velocidade e tom naturais: o app ajusta depois). */
export async function synthesizeOnline(text: string, voiceId: string): Promise<OnlineSpeech> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Escreva o texto que o maestro deve falar.');
  if (trimmed.length > MAX_CHARS) {
    throw new Error(`Texto longo demais para uma fala (máximo de ${MAX_CHARS} letras). Divida em mais marcações.`);
  }
  const bridge = window.vsDesktop?.maestroOnlineSpeak;
  if (!bridge) throw new Error('As vozes online só funcionam no app do Mac.');
  const out = await bridge({ text: trimmed, voice: voiceId });
  const bin = atob(out.audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: out.mime || 'audio/mpeg', voiceName: out.voice || voiceId };
}
