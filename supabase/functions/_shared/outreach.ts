// Regras da área de Comunicação sem dependências externas.
// Usadas pelas funções outreach-send, outreach-unsubscribe e twilio-inbound, e pelos testes
// (tests/outreach.test.mjs, npm test).
//
// Tudo aqui é função pura para poder ser testado sem rede: token de descadastro, assinatura
// da Twilio, montagem do texto, lotes.

export type Channel = 'email' | 'whatsapp';

// ─── Token de descadastro ────────────────────────────────────────────────────
//
// Formato: v1.<channel>.<base64url(address)>.<base64url(hmac)>
//
// Assina SÓ canal + endereço normalizado. Três decisões que parecem detalhe e não são:
//  - sem expiração: um link de e-mail antigo precisa continuar valendo meses depois. Link que
//    expira vira reclamação de spam.
//  - sem campaign_id: o descadastro é global, então sair por um e-mail tem de valer para os
//    próximos.
//  - o endereço vai junto porque a validação recalcula o HMAC sobre ele. Trocar o endereço
//    invalida a assinatura, então ninguém descadastra outra pessoa.

export const UNSUB_VERSION = 'v1';

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text: string): string {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  return atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

/** Endereço como fica gravado: e-mail em minúsculas, telefone em E.164. */
export function normalizeAddress(channel: Channel, raw: string): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  if (channel === 'email') {
    const v = t.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : null;
  }
  return normalizePhone(t);
}

/** Mesma regra de src/lib/authFlow.ts (normalizePhone) e de _outreach_norm_phone no banco. */
export function normalizePhone(raw: string): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, '');
  if (!digits) return null;
  if (t.startsWith('+')) return /^[1-9]\d{9,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return null;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

export async function buildUnsubToken(
  secret: string, channel: Channel, address: string,
): Promise<string | null> {
  const addr = normalizeAddress(channel, address);
  if (!addr || !secret) return null;
  const mac = await hmacSha256(secret, `${UNSUB_VERSION}|${channel}|${addr}`);
  return `${UNSUB_VERSION}.${channel}.${b64urlEncode(new TextEncoder().encode(addr))}.${b64urlEncode(mac)}`;
}

export type UnsubCheck =
  | { ok: true; channel: Channel; address: string }
  | { ok: false; error: 'bad_format' | 'bad_channel' | 'bad_signature' };

/** Confere o token sem gravar nada. Quem grava é a função, e só quando o método é POST. */
export async function verifyUnsubToken(secret: string, token: string): Promise<UnsubCheck> {
  const parts = (token ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== UNSUB_VERSION) return { ok: false, error: 'bad_format' };
  const [, channel, encodedAddress, encodedMac] = parts;
  if (channel !== 'email' && channel !== 'whatsapp') return { ok: false, error: 'bad_channel' };
  if (!secret) return { ok: false, error: 'bad_signature' };

  let address: string;
  try {
    address = b64urlDecode(encodedAddress);
  } catch {
    return { ok: false, error: 'bad_format' };
  }
  const expected = await buildUnsubToken(secret, channel, address);
  if (!expected) return { ok: false, error: 'bad_signature' };
  // Compara o token inteiro: renormaliza o endereço e reconstrói, então qualquer adulteração
  // (inclusive de maiúsculas no e-mail) não passa.
  return safeEqual(expected, token) ? { ok: true, channel, address: normalizeAddress(channel, address)! } : { ok: false, error: 'bad_signature' };
}

/** Comparação em tempo constante. Mesma ideia do safeEqual de _shared/pix.ts. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ─── Assinatura da Twilio ────────────────────────────────────────────────────
//
// A URL assinada é SEMPRE a pública e exata, montada de constante: proxy e rewrite mudam o
// host do request e a assinatura para de bater sem nenhum aviso.

export function twilioSignatureUrl(baseUrl: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  return keys.reduce((acc, k) => acc + k + params[k], baseUrl);
}

export async function twilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(twilioSignatureUrl(url, params)));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyTwilioSignature(
  authToken: string, url: string, params: Record<string, string>, header: string | null,
): Promise<boolean> {
  if (!header || !authToken) return false;
  const expected = await twilioSignature(authToken, url, params);
  return safeEqual(expected, header.trim());
}

/** Palavras que descadastram no WhatsApp. Sem acento e sem depender de maiúsculas. */
export const STOP_WORDS = ['sair', 'parar', 'stop', 'cancelar', 'descadastrar'];

export function isStopMessage(body: string): boolean {
  const t = (body ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '');
  return STOP_WORDS.includes(t);
}

// ─── Texto e variáveis ───────────────────────────────────────────────────────

export type Vars = Record<string, string>;

/** Troca {{nome}} pelo valor. O que não veio fica como veio, para aparecer no teste em vez de
 *  sair uma saudação vazia ("Oi, !") por um erro de digitação no nome da variável. */
export function fillVars(text: string, vars: Vars, missing?: string[]): string {
  return (text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || v === '') {
      missing?.push(key);
      return whole;
    }
    return v;
  });
}

/** Variáveis que um texto usa, na ordem em que aparecem e sem repetir. */
export function varsUsed(text: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function escapeHtml(text: string): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Monta o HTML do e-mail a partir do texto-fonte. Marcação aceita:
 *   linha em branco  -> novo parágrafo
 *   **texto**        -> negrito
 *   _texto_          -> itálico
 *   [texto](url)     -> link
 *
 * O corpo NUNCA vira HTML arbitrário: tudo é escapado antes, e só as três marcações acima
 * viram tags. Assim um texto colado não quebra o layout nem injeta script.
 */
export function renderEmailHtml(body: string, vars: Vars, footerHtml = ''): string {
  const filled = fillVars(body ?? '', vars);
  const paragraphs = filled.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const paragraphsHtml = paragraphs.map((p) => {
    const escaped = escapeHtml(p);
    const withLinks = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_m, label: string, url: string) => `<a href="${url}" style="color:#30d158;text-decoration:none;font-weight:600;">${label}</a>`);
    const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#eaeaea;">$1</strong>');
    const withItalic = withBold.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
    const html = withItalic.replace(/\n/g, '<br>');
    return `<p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#9a9a9a;">${html}</p>`;
  }).join('\n        ');

  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#0a0b0d;">
<div style="background:#0a0b0d;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" style="max-width:440px;margin:0 auto;background:#17181c;border:1px solid #2c2f38;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,0.5);">
    <tr><td style="padding:0;height:4px;background:linear-gradient(90deg,#f59e0b,#22c55e);"></td></tr>
    <tr>
      <td style="padding:36px 32px 28px;text-align:center;">
        <img src="https://vsstagepro.com.br/icon-192.png" alt="VS Stage Pro" width="64" height="64" style="display:block;margin:0 auto 16px;border-radius:14px;border:1px solid #2c2f38;" />
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#30d158;font-weight:700;margin-bottom:20px;">VS STAGE PRO</div>
        <div style="text-align:left;">
        ${paragraphsHtml}
        </div>
      </td>
    </tr>
    ${footerHtml ? `<tr><td style="padding:16px 32px 24px;border-top:1px solid #23252b;text-align:center;">${footerHtml}</td></tr>` : ''}
  </table>
</div>
</body></html>`;
}

/** Rodapé do e-mail em massa: endereço e o link de sair. Exigência de e-mail em massa. */
export function unsubscribeFooter(unsubUrl: string): string {
  return `<p style="margin:0;font-size:11px;line-height:1.7;color:#55555a;">
          Você recebeu este e-mail porque tem uma conta no VS Stage Pro.<br>
          <a href="${escapeHtml(unsubUrl)}" style="color:#6b6b6b;text-decoration:underline;">Não quero mais receber mensagens</a>
        </p>`;
}

// ─── Lotes ───────────────────────────────────────────────────────────────────

export function chunkArray<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// Limites de cada provedor, num só lugar, para o motor e a tela não divergirem.
export const LIMITS = {
  /** Resend: até 100 e-mails por chamada. */
  resendBatch: 100,
  /** WhatsApp: o número entrega ~1 mensagem a cada 3s. */
  whatsappGapMs: 3000,
  /** Lote pequeno de propósito: se a função morrer, no máximo 5 linhas ficam presas. */
  whatsappBatch: 5,
  /** Prazo contado dentro da função (a Edge Function garante 150s). */
  runDeadlineMs: 130_000,
} as const;

/** Quanto tempo a base inteira leva no WhatsApp, para a tela avisar antes de começar. */
export function whatsappEta(total: number): string {
  const seconds = Math.max(0, total) * (LIMITS.whatsappGapMs / 1000);
  if (seconds < 90) return 'menos de 2 minutos';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `cerca de ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `cerca de ${hours}h${String(rest).padStart(2, '0')}` : `cerca de ${hours}h`;
}

// ─── Erros ───────────────────────────────────────────────────────────────────

/** Mensagem em português para o que o painel pode mostrar cru. */
export const OUTREACH_ERRORS: Record<string, string> = {
  not_allowed: 'Você não tem permissão para fazer isso.',
  body_required: 'Escreva a mensagem antes de enviar.',
  subject_required: 'O e-mail precisa de um assunto.',
  name_required: 'Dê um nome para a mensagem pronta.',
  invalid_value: 'Valor inválido.',
  not_found: 'Campanha não encontrada.',
  run_superseded: 'Esta campanha está sendo enviada em outra aba.',
  canceled: 'Esta campanha foi cancelada.',
  no_recipients: 'Nenhum destinatário válido para este canal.',
  resend_not_configured: 'O envio de e-mail não está configurado no servidor.',
  resend_rejected: 'O serviço de e-mail recusou a mensagem.',
  resend_unavailable: 'O serviço de e-mail não respondeu. O lote volta para a fila.',
  whatsapp_not_configured: 'O envio por WhatsApp não está configurado no servidor.',
  whatsapp_sender_offline: 'O número de WhatsApp ainda não está liberado no Twilio.',
  whatsapp_template_required: 'Fora da conversa aberta, o WhatsApp só aceita mensagem pronta aprovada.',
  whatsapp_failed: 'Não foi possível entregar esta mensagem no WhatsApp.',
  already_running: 'Já existe um envio desta campanha em andamento.',
  empty_campaign: 'A campanha não tem destinatários.',
};

export function friendlyOutreachError(code: string | null | undefined): string {
  if (!code) return OUTREACH_ERRORS.request_failed ?? 'Não foi possível concluir.';
  return OUTREACH_ERRORS[code] ?? code;
}

// ─── Erros de execução do motor ──────────────────────────────────────────────
OUTREACH_ERRORS.send_stalled = 'O servidor parou de responder no meio do envio.';
