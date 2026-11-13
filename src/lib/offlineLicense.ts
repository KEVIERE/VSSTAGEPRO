// Licença sem internet: o que fazer quando o programa não consegue conferir a conta no servidor.
//
// Quem manda é sempre o servidor. Toda conferência que dá certo é guardada no Mac (criptografada
// pelo Keychain, em desktop/licenseCache.js). Esta regra só entra quando não dá para conferir:
// - bloqueio e teste encerrado continuam valendo sem internet;
// - teste grátis: o prazo continua contando pelo relógio do Mac;
// - assinante: até 30 dias desde a última conferência, e nunca depois do fim do período pago
//   que o servidor informou, mais 3 dias de folga com aviso (OFFLINE_GRACE_MS);
// - relógio do Mac voltado para trás, ou fora da hora do servidor na última conferência:
//   não vale o guardado, precisa de internet;
// - nunca conferiu neste Mac, ou outra conta: precisa de internet.

export const OFFLINE_MAX_MS = 30 * 24 * 3600 * 1000;
// Assinante sem internet: depois do fim do período (ou dos 30 dias), mais 3 dias de folga com
// aviso na tela. Quem renovou pelo celular e está sem internet no show não fica travado; quem não
// renovou ganha no máximo 3 dias, e só se ficar o tempo todo sem internet.
export const OFFLINE_GRACE_MS = 3 * 24 * 3600 * 1000;
// Ajuste automático do relógio mexe em segundos; mais de 1 hora para trás é relógio voltado.
export const CLOCK_BACK_TOLERANCE_MS = 3600 * 1000;

export type CachedLicense = {
  status: 'anonymous' | 'trial' | 'active' | 'expired' | 'blocked';
  reason?: string | null;
  ends_at?: string;
  hours_left?: number;
  plan?: string | null;
  subscription?: string;
  current_period_end?: string | null;
  partner?: boolean;
};

export type LicenseCache = {
  userId: string;
  license: CachedLicense;
  /** quando o servidor respondeu pela última vez (relógio do Mac, em ms) */
  checkedAt: number;
  /** maior hora já vista neste Mac antes desta abertura (ms) */
  maxSeen: number;
  /** na última conferência o relógio do Mac não batia com o do servidor */
  clockWrong?: boolean;
};

export type NeedInternetReason = 'never_checked' | 'other_account' | 'clock_back' | 'too_long' | 'paid_period_over' | 'unknown';

export type OfflineDecision =
  /** `graceFrom`: está na folga desde esta hora (o prazo normal já passou) */
  | { kind: 'use'; license: CachedLicense; checkedAt: number; until: number; graceFrom?: number; graceReason?: NeedInternetReason }
  | { kind: 'expired'; checkedAt: number }
  | { kind: 'blocked'; license: CachedLicense; checkedAt: number }
  | { kind: 'need_internet'; reason: NeedInternetReason };

const time = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

export function decideOffline(cache: LicenseCache | null | undefined, userId: string, now: number): OfflineDecision {
  if (!cache || !cache.license || !Number.isFinite(cache.checkedAt)) return { kind: 'need_internet', reason: 'never_checked' };
  if (cache.userId !== userId) return { kind: 'need_internet', reason: 'other_account' };
  if (cache.clockWrong) return { kind: 'need_internet', reason: 'clock_back' };
  const seen = Math.max(cache.maxSeen || 0, cache.checkedAt);
  if (now < seen - CLOCK_BACK_TOLERANCE_MS) return { kind: 'need_internet', reason: 'clock_back' };
  // dentro da tolerância, a hora nunca anda para trás
  const t = Math.max(now, seen);
  const { license, checkedAt } = cache;
  const offlineEnd = checkedAt + OFFLINE_MAX_MS;

  if (license.status === 'blocked') return { kind: 'blocked', license, checkedAt };
  if (license.status === 'expired') return { kind: 'expired', checkedAt };

  if (license.status === 'trial') {
    const end = time(license.ends_at)
      ?? (typeof license.hours_left === 'number' ? checkedAt + license.hours_left * 3600 * 1000 : null);
    if (end === null) return { kind: 'need_internet', reason: 'unknown' };
    if (t >= end) return { kind: 'expired', checkedAt };
    if (t >= offlineEnd) return { kind: 'need_internet', reason: 'too_long' };
    return { kind: 'use', license, checkedAt, until: Math.min(end, offlineEnd) };
  }

  if (license.status === 'active') {
    const periodEnd = time(license.current_period_end) ?? time(license.ends_at);
    // Data que já tinha passado quando o servidor respondeu "ativa" não é o fim do período: é
    // resto de outra forma de pagamento (assinatura ativada pela administração herdava a data do
    // Stripe antigo). O servidor liberou mesmo assim, então vale só o limite de 30 dias. Sem
    // isso, essa conta ficava sem nenhum tempo de uso sem internet.
    const paidEnd = periodEnd !== null && periodEnd > checkedAt ? periodEnd : Infinity;
    const limit = Math.min(paidEnd, offlineEnd);
    const reason: NeedInternetReason = paidEnd <= offlineEnd ? 'paid_period_over' : 'too_long';
    const until = limit + OFFLINE_GRACE_MS;
    if (t >= until) return { kind: 'need_internet', reason };
    if (t >= limit) return { kind: 'use', license, checkedAt, until, graceFrom: limit, graceReason: reason };
    return { kind: 'use', license, checkedAt, until };
  }

  return { kind: 'need_internet', reason: 'unknown' };
}

export const NEED_INTERNET_TEXT: Record<NeedInternetReason, string> = {
  never_checked: 'Este Mac ainda não conferiu sua conta. Conecte à internet uma vez para liberar o uso sem internet nos próximos shows.',
  other_account: 'A última conferência deste Mac foi com outra conta. Conecte à internet para conferir esta.',
  clock_back: 'A data e a hora do Mac estão erradas. Acerte o relógio do Mac ou conecte à internet para conferir sua conta.',
  too_long: 'Faz mais de 30 dias que sua conta não é conferida. Conecte à internet um instante para continuar.',
  paid_period_over: 'O período pago da sua assinatura terminou. Conecte à internet para confirmar a renovação.',
  unknown: 'Não foi possível conferir sua conta. Conecte à internet e tente de novo.',
};
