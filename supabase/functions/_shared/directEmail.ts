// E-mail avulso da área de Comunicação: o admin digita os endereços, o assunto e o texto, e
// cada destinatário recebe um e-mail só dele, com a pele do VS Stage.
//
// Diferente da campanha, aqui os endereços não precisam ser de usuários cadastrados. Por isso
// a validação é mais dura (endereço por endereço) e há um teto de destinatários por envio:
// isto é para mensagem pontual, não para lista. Lista grande vai pela campanha, que tem fila,
// descadastro e retomada.
//
// Função pura, sem rede: usada pela outreach-send, pela tela do admin (prévia) e pelos testes
// (tests/direct-email.test.mjs).
import { normalizeAddress, renderEmailHtml } from './outreach.ts';
import { SKIN } from './emailSkin.ts';

const FOOTER_STYLE = `margin:0;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;line-height:1.7;color:${SKIN.cremeMudo};`;

/** Teto de destinatários por envio avulso. */
export const DIRECT_EMAIL_LIMIT = 50;
export const DIRECT_SUBJECT_MAX = 200;
export const DIRECT_BODY_MAX = 20_000;

export type ParsedRecipients = {
  /** Endereços válidos, normalizados e sem repetição, na ordem em que foram digitados. */
  valid: string[];
  /** O que foi digitado e não é e-mail, como foi digitado. */
  invalid: string[];
  /** Endereços que apareceram mais de uma vez (já contados uma vez em `valid`). */
  duplicates: string[];
};

/**
 * Lê o campo de destinatários. Aceita vírgula, ponto e vírgula, espaço ou quebra de linha
 * entre os endereços, e também o formato "Nome <email@x.com>" que sai ao copiar do Gmail.
 */
export function parseRecipients(raw: string): ParsedRecipients {
  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const tokens: string[] = [];
  for (const piece of (raw ?? '').split(/[,;\n\r]+/)) {
    const t = piece.trim();
    if (!t) continue;
    const angle = t.match(/<([^<>]+)>/);
    if (angle) tokens.push(angle[1].trim());
    else tokens.push(...t.split(/\s+/).filter(Boolean));
  }
  for (const token of tokens) {
    const addr = normalizeAddress('email', token.replace(/^mailto:/i, ''));
    if (!addr) {
      if (!invalid.includes(token)) invalid.push(token);
      continue;
    }
    if (valid.includes(addr)) {
      if (!duplicates.includes(addr)) duplicates.push(addr);
      continue;
    }
    valid.push(addr);
  }
  return { valid, invalid, duplicates };
}

export type DirectEmailError =
  | 'no_recipients'
  | 'invalid_addresses'
  | 'too_many_recipients'
  | 'subject_required'
  | 'subject_too_long'
  | 'body_required'
  | 'body_too_long'
  | 'invalid_reply_to';

/**
 * Confere o pedido inteiro. O servidor roda esta mesma conferência: a tela só antecipa o
 * aviso, quem decide é a função.
 */
export function validateDirectEmail(input: {
  to: string[] | string;
  subject: string;
  body: string;
  replyTo?: string | null;
}): { ok: true; to: string[]; subject: string; body: string; replyTo: string | null } | { ok: false; error: DirectEmailError; invalid?: string[] } {
  const parsed = parseRecipients(Array.isArray(input.to) ? input.to.join('\n') : input.to);
  if (parsed.invalid.length) return { ok: false, error: 'invalid_addresses', invalid: parsed.invalid };
  if (!parsed.valid.length) return { ok: false, error: 'no_recipients' };
  if (parsed.valid.length > DIRECT_EMAIL_LIMIT) return { ok: false, error: 'too_many_recipients' };
  const subject = (input.subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!subject) return { ok: false, error: 'subject_required' };
  if (subject.length > DIRECT_SUBJECT_MAX) return { ok: false, error: 'subject_too_long' };
  const body = (input.body ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) return { ok: false, error: 'body_required' };
  if (body.length > DIRECT_BODY_MAX) return { ok: false, error: 'body_too_long' };
  let replyTo: string | null = null;
  if (input.replyTo && input.replyTo.trim()) {
    replyTo = normalizeAddress('email', input.replyTo);
    if (!replyTo) return { ok: false, error: 'invalid_reply_to' };
  }
  return { ok: true, to: parsed.valid, subject, body, replyTo };
}

/** Rodapé do avulso: não é lista, então não leva descadastro; diz como responder. */
export function directEmailFooter(): string {
  return `<p style="${FOOTER_STYLE}">
          Mensagem enviada pela equipe do VS Stage Pro.<br>
          Para falar com a gente, é só responder este e-mail.
        </p>`;
}

/** HTML que sai para o destinatário. Mesma marcação da campanha: **negrito**, _itálico_, [texto](url). */
export function renderDirectEmailHtml(body: string): string {
  return renderEmailHtml(body, {}, directEmailFooter());
}

/** Texto puro do e-mail, para cliente que não mostra HTML. */
export function renderDirectEmailText(body: string): string {
  return `${(body ?? '').trim()}\n\n--\nVS Stage Pro\nhttps://vsstagepro.com.br`;
}

export type DirectRecipientResult = {
  address: string;
  status: 'sent' | 'failed';
  error?: string | null;
  providerId?: string | null;
};

export function summarizeDirect(results: DirectRecipientResult[]): { total: number; sent: number; failed: number } {
  const sent = results.filter((r) => r.status === 'sent').length;
  return { total: results.length, sent, failed: results.length - sent };
}

/** Mensagens em português para os erros do avulso. */
export const DIRECT_EMAIL_ERRORS: Record<string, string> = {
  no_recipients: 'Digite pelo menos um endereço de e-mail.',
  invalid_addresses: 'Há endereços que não são e-mail válido.',
  too_many_recipients: `No máximo ${DIRECT_EMAIL_LIMIT} destinatários por envio avulso. Para mais, use a campanha.`,
  subject_required: 'O e-mail precisa de um assunto.',
  subject_too_long: `O assunto passa de ${DIRECT_SUBJECT_MAX} caracteres.`,
  body_required: 'Escreva a mensagem antes de enviar.',
  body_too_long: 'A mensagem está longa demais para um e-mail.',
  invalid_reply_to: 'O endereço de resposta não é um e-mail válido.',
  optout: 'Pediu para não receber mensagens do VS Stage.',
  resend_rejected: 'O serviço de e-mail recusou este endereço.',
  resend_unconfirmed: 'O serviço de e-mail não confirmou. Pode ter saído; confira antes de reenviar.',
  resend_not_configured: 'O envio de e-mail não está configurado no servidor.',
};

export function friendlyDirectError(code: string | null | undefined): string {
  if (!code) return '';
  return DIRECT_EMAIL_ERRORS[code] ?? code;
}
