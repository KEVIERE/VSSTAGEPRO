// Aviso por e-mail quando faltam 3, 2 e 1 dia para o período pago vencer.
//
// Vale para quem pagou pela InfinitePay (PIX ou cartão) ou recebeu tempo manual do admin:
// nenhum desses renova sozinho. A assinatura antiga com renovação automática, parceiro,
// conta bloqueada e bônus do admin não recebem. Contas puras, sem rede (testadas em
// tests/pixReminder.test.mjs); quem envia é a função pix-renewal-reminder.
import { apoio, botao, moldura, paragrafo, titulo } from './emailSkin.ts';
import { escapeHtml } from './outreach.ts';

export const REMINDER_DAYS = [3, 2, 1] as const;
export const RENEW_URL = 'https://vsstagepro.com.br/#assinar';
const TZ = 'America/Sao_Paulo';
// Horário de envio, em Brasília: ninguém recebe aviso de cobrança de madrugada.
export const SEND_FROM_HOUR = 9;
export const SEND_UNTIL_HOUR = 20;

export type ReminderCandidate = {
  user_id: string;
  email: string | null;
  name: string | null;
  plan: string | null;
  pix_paid_until: string | null;
  /** 'active' = assinatura antiga com renovação automática */
  subscription: string | null;
  partner: boolean | null;
  blocked: boolean | null;
};

export type DueReminder = {
  userId: string;
  email: string;
  name: string;
  plan: string | null;
  paidUntil: string;
  days: (typeof REMINDER_DAYS)[number];
};

/** Data do calendário em Brasília (aaaa-mm-dd). */
function brasiliaDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Quantos dias de calendário (em Brasília) faltam de `now` até `end`. */
export function daysUntil(end: Date, now: Date): number {
  const a = Date.parse(`${brasiliaDate(now)}T00:00:00Z`);
  const b = Date.parse(`${brasiliaDate(end)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function brasiliaHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

export function isSendingHour(now: Date): boolean {
  const h = brasiliaHour(now);
  return h >= SEND_FROM_HOUR && h <= SEND_UNTIL_HOUR;
}

/** Quem recebe aviso agora: período pago ainda valendo, a 3, 2 ou 1 dia de vencer. */
export function dueReminders(rows: ReminderCandidate[], now: Date): DueReminder[] {
  const out: DueReminder[] = [];
  for (const r of rows) {
    if (!r.email || !r.pix_paid_until) continue;
    if (r.subscription === 'active') continue; // assinatura antiga: renova sozinha
    if (r.partner || r.blocked) continue;
    const end = new Date(r.pix_paid_until);
    if (!Number.isFinite(end.getTime()) || end.getTime() <= now.getTime()) continue;
    const days = daysUntil(end, now);
    if (!(REMINDER_DAYS as readonly number[]).includes(days)) continue;
    out.push({
      userId: r.user_id,
      email: r.email,
      name: (r.name ?? '').trim(),
      plan: r.plan,
      paidUntil: end.toISOString(),
      days: days as DueReminder['days'],
    });
  }
  return out;
}

export function formatDueDate(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${date} às ${time}`;
}

const whenText = (days: number) => (days === 1 ? 'amanhã' : `em ${days} dias`);

export function reminderEmail(r: DueReminder): { subject: string; html: string; text: string } {
  const first = r.name.split(/\s+/)[0] ?? '';
  const hello = first ? `Olá, ${escapeHtml(first)}.` : 'Olá.';
  const due = formatDueDate(r.paidUntil);
  const subject = `Sua assinatura do VS Stage Pro vence ${whenText(r.days)}`;
  const html = moldura(
    titulo(`Sua assinatura vence ${whenText(r.days)}`)
    + paragrafo(`${hello} Sua assinatura vale até <strong style="color:#e7e2d6;">${due}</strong> (horário de Brasília).`)
    + paragrafo('O pagamento não renova sozinho, nem no PIX nem no cartão. Renove antes para não ficar sem o programa: o tempo novo entra depois do que ainda falta, você não perde nenhum dia.')
    + botao('Renovar assinatura', RENEW_URL)
    + apoio('Vai tocar sem internet? Renove antes do show: sem internet, o programa para na data do vencimento. Também dá para renovar pelo botão Renovar, no alto do programa.'),
    { tipo: 'acao', rodape: 'Você recebe este aviso porque sua assinatura do VS Stage Pro não tem renovação automática. Se já renovou, pode ignorar.' },
  );
  const text = [
    first ? `Olá, ${first}.` : 'Olá.',
    `Sua assinatura do VS Stage Pro vale até ${due} (horário de Brasília).`,
    'O pagamento não renova sozinho, nem no PIX nem no cartão. Renove antes para não ficar sem o programa: o tempo novo entra depois do que ainda falta.',
    `Renovar: ${RENEW_URL}`,
    'Vai tocar sem internet? Renove antes do show: sem internet, o programa para na data do vencimento.',
    'Se já renovou, pode ignorar.',
  ].join('\n\n');
  return { subject, html, text };
}

/** Uma chave por aviso: o mesmo aviso nunca sai duas vezes, nem se a função rodar junto. */
export const reminderKey = (r: DueReminder) => `pix-reminder:${r.userId}:${r.paidUntil}:${r.days}`;
