// Um Mac por vez em cada conta (regra no banco: device_claim, migração um_mac_por_vez).
//
// A cada conferência da conta o programa do Mac avisa "estou aqui". O servidor responde:
// - ok: este Mac está liberado;
// - conflict: a conta está aberta em outro Mac; a tela pergunta se pode desconectar o outro;
// - replaced: outro Mac entrou e desconectou este; o programa sai da conta.
// Sem internet vale a última conferência guardada (offlineLicense.ts): o Mac desconectado só
// fica sabendo na próxima conferência com internet. Erro ou servidor antigo: não bloqueia.

export type DeviceVerdict =
  | { status: 'ok' }
  | { status: 'conflict'; otherName: string | null; otherSeen: string | null }
  | { status: 'replaced'; otherName: string | null };

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

/** Lê a resposta do servidor. Qualquer coisa fora do esperado conta como liberado. */
export function readDeviceVerdict(data: unknown): DeviceVerdict {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (d.status === 'conflict') return { status: 'conflict', otherName: text(d.other_name), otherSeen: text(d.other_seen) };
  if (d.status === 'replaced') return { status: 'replaced', otherName: text(d.other_name) };
  return { status: 'ok' };
}

/** Nome do outro Mac para a frase ("o Mac "Estúdio"" ou "outro computador"). */
export function otherDeviceLabel(name: string | null | undefined): string {
  const n = text(name);
  return n ? `o computador "${n}"` : 'outro computador';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Quando o outro Mac conferiu a conta pela última vez, em palavras. */
export function lastSeenText(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 5) return 'em uso agora';
  if (min < 60) return `usado há ${min} min`;
  const d = new Date(t);
  return `usado pela última vez em ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const REPLACED_TEXT = 'Sua conta foi aberta em outro computador e este Mac foi desconectado. Para usar aqui, entre de novo.';
export const REFUSED_TEXT = 'Tudo certo: sua conta continua aberta no outro computador.';
