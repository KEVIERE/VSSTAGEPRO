import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw, Send, X, XCircle } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, dateTime, num } from '@/components/admin/adminApi';
import type { DirectEmailRecord, DirectRecipientRow, DirectSendResult } from '@/components/admin/adminApi';
import { btnGhost, btnPrimary, Empty, ErrorBox, input, Loading, Panel } from '@/components/admin/ui';
import {
  DIRECT_BODY_MAX, DIRECT_EMAIL_LIMIT, DIRECT_SUBJECT_MAX, friendlyDirectError, parseRecipients,
  renderDirectEmailHtml, validateDirectEmail,
} from '../../../supabase/functions/_shared/directEmail';

// E-mail avulso: endereços quaisquer, digitados à mão, sem precisar de conta no VS Stage.
//
// O fluxo tem três passos e não pula nenhum: escrever, revisar (prévia do e-mail como vai
// chegar e a lista de quem recebe) e confirmar. O resultado mostra destinatário por
// destinatário, e o envio fica no histórico logo abaixo.

type Step = 'write' | 'review' | 'done';

export default function DirectEmail() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [step, setStep] = useState<Step>('write');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DirectSendResult | null>(null);

  const [history, setHistory] = useState<DirectEmailRecord[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const parsed = useMemo(() => parseRecipients(to), [to]);
  const check = useMemo(() => validateDirectEmail({ to, subject, body, replyTo }), [to, subject, body, replyTo]);
  const previewHtml = useMemo(() => renderDirectEmailHtml(body || 'Escreva a mensagem para ver a prévia.'), [body]);

  const loadHistory = async () => {
    setHistoryError(null);
    try { setHistory(await adminApi.outreachDirectList()); } catch (e) {
      setHistory([]);
      setHistoryError(friendlyError((e as Error).message));
    }
  };
  useEffect(() => { loadHistory(); }, []);

  const review = () => {
    setError(null);
    if (!check.ok) { setError(friendlyDirectError(check.error)); return; }
    setStep('review');
  };

  const send = async () => {
    if (!check.ok || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await adminApi.outreachDirectSend({
        to: check.to, subject: check.subject, body: check.body, replyTo: check.replyTo,
      });
      setResult(r);
      setStep('done');
      loadHistory();
    } catch (e) {
      const code = (e as Error).message;
      setError(friendlyDirectError(code) === code ? friendlyError(code) : friendlyDirectError(code));
    } finally {
      setSending(false);
    }
  };

  const restart = (keepText: boolean) => {
    setResult(null);
    setError(null);
    setStep('write');
    if (!keepText) { setTo(''); setSubject(''); setBody(''); setReplyTo(''); }
  };

  /** Reaproveita só os que falharam, para tentar de novo. */
  const retryFailed = () => {
    if (!result) return;
    setTo(result.results.filter((r) => r.status === 'failed' && r.error !== 'optout').map((r) => r.address).join('\n'));
    setResult(null);
    setStep('write');
  };

  const count = parsed.valid.length;
  const overLimit = count > DIRECT_EMAIL_LIMIT;

  return (
    <div className="space-y-4">
      {step === 'write' && (
        <Panel title="E-mail avulso">
          <div className="p-4 space-y-3">
            <p className="text-xs text-logic-text-dim">
              Para quem você quiser, com ou sem conta no VS Stage Pro. Cada pessoa recebe um e-mail só dela, com o visual
              dos e-mails do VS Stage. Até {DIRECT_EMAIL_LIMIT} endereços por envio; para mais, use a campanha.
            </p>

            <div>
              <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Para</label>
              <textarea
                className={`${input} h-20 py-2 resize-y font-mono text-xs`}
                value={to} onChange={(e) => setTo(e.target.value)}
                placeholder={'ana@exemplo.com, joao@exemplo.com\nou um por linha'}
              />
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
                <span className={overLimit ? 'text-logic-lcd-red font-semibold' : 'text-logic-text-muted'}>
                  {num(count)} de {DIRECT_EMAIL_LIMIT} destinatários
                </span>
                {parsed.duplicates.length > 0 && (
                  <span className="text-logic-text-muted">{parsed.duplicates.length} repetido(s), conta uma vez só</span>
                )}
              </div>
              {parsed.invalid.length > 0 && (
                <p className="mt-1 text-2xs text-logic-lcd-red">
                  Não são e-mail válido: <span className="font-mono">{parsed.invalid.join(', ')}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Assunto</label>
              <input className={input} value={subject} maxLength={DIRECT_SUBJECT_MAX}
                onChange={(e) => setSubject(e.target.value)} placeholder="Assunto do e-mail" />
            </div>

            <div>
              <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Mensagem</label>
              <textarea className={`${input} h-48 py-2 resize-y`} value={body} maxLength={DIRECT_BODY_MAX}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'Olá,\n\nEscreva aqui. Linha em branco separa parágrafos.'} />
              <p className="mt-1 text-2xs text-logic-text-muted">
                Linha em branco abre parágrafo. **negrito**, _itálico_ e [texto](https://link) funcionam.
              </p>
            </div>

            <div>
              <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Responder para (opcional)</label>
              <input className={input} type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)}
                placeholder="contato@vsstagepro.com.br" />
            </div>

            {error && <ErrorBox text={error} />}

            <div className="flex justify-end">
              <button type="button" className={btnPrimary} onClick={review} disabled={!to.trim() || !subject.trim() || !body.trim()}>
                Revisar antes de enviar <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </Panel>
      )}

      {step === 'review' && check.ok && (
        <Panel title="Revisar e confirmar"
          actions={<button type="button" className={btnGhost} onClick={() => setStep('write')} disabled={sending}><X size={12} /> Voltar e editar</button>}>
          <div className="p-4 grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="rounded-lg border border-logic-border overflow-hidden bg-black">
              <div className="px-3 py-2 bg-logic-bg-elevated text-2xs text-logic-text-muted space-y-0.5">
                <p><span className="text-logic-text-dim">Assunto:</span> <span className="text-logic-text font-semibold">{check.subject}</span></p>
                <p><span className="text-logic-text-dim">De:</span> VS Stage Pro{check.replyTo ? <> · <span className="text-logic-text-dim">resposta vai para</span> {check.replyTo}</> : null}</p>
              </div>
              <iframe title="Prévia do e-mail avulso" srcDoc={previewHtml} className="w-full h-[28rem] bg-black" sandbox="" />
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-2xs font-semibold tracking-widest text-logic-text-muted uppercase mb-1">Vai para {num(check.to.length)}</p>
                <ul className="max-h-72 overflow-auto rounded-md border border-logic-border-dark bg-logic-bg-deep divide-y divide-logic-border-dark">
                  {check.to.map((a) => <li key={a} className="px-2.5 py-1.5 text-xs font-mono text-logic-text truncate">{a}</li>)}
                </ul>
              </div>
              <p className="text-2xs text-logic-text-dim">
                Confira a prévia e os endereços. Depois de enviado, o e-mail não volta. Quem pediu para não receber
                mensagens do VS Stage fica de fora.
              </p>
              {error && <ErrorBox text={error} />}
              <button type="button" onClick={send} disabled={sending}
                className="console-key is-lit-amber w-full h-10 inline-flex items-center justify-center gap-2 text-sm uppercase tracking-wider disabled:opacity-60">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? 'Enviando…' : `Confirmar envio para ${num(check.to.length)}`}
              </button>
            </div>
          </div>
        </Panel>
      )}

      {step === 'done' && result && (
        <Panel title="Resultado do envio">
          <div className="p-4 space-y-3">
            <div className={`px-3 py-2 rounded-lg border text-xs ${result.failed === 0 ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-accent/10 border-logic-accent/40 text-logic-accent-hover'}`}>
              {result.failed === 0
                ? `Enviado para ${num(result.sent)} destinatário(s).`
                : `${num(result.sent)} enviado(s), ${num(result.failed)} com falha.`}
            </div>
            <RecipientList rows={result.results} />
            <div className="flex flex-wrap justify-end gap-2">
              {result.results.some((r) => r.status === 'failed' && r.error !== 'optout') && (
                <button type="button" className={btnGhost} onClick={retryFailed}><RefreshCw size={12} /> Tentar de novo os que falharam</button>
              )}
              <button type="button" className={btnGhost} onClick={() => restart(true)}>Usar o mesmo texto</button>
              <button type="button" className={btnPrimary} onClick={() => restart(false)}>Novo e-mail avulso</button>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Avulsos enviados"
        actions={<button type="button" className={btnGhost} onClick={loadHistory}><RefreshCw size={12} /> Atualizar</button>}>
        {history === null ? <Loading /> : historyError ? <div className="p-4"><ErrorBox text={historyError} /></div> : history.length === 0 ? (
          <Empty text="Nenhum e-mail avulso enviado ainda." />
        ) : (
          <ul className="divide-y divide-logic-border">
            {history.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => setOpen(open === h.id ? null : h.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-logic-bg-elevated/40">
                  {open === h.id ? <ChevronDown size={13} className="text-logic-text-muted" /> : <ChevronRight size={13} className="text-logic-text-muted" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-logic-text truncate">{h.subject}</span>
                    <span className="block text-2xs text-logic-text-muted">
                      {dateTime(h.created_at)}{h.sent_by_email ? ` · por ${h.sent_by_email}` : ''}
                    </span>
                  </span>
                  <span className="text-2xs tabular-nums text-logic-lcd-green">{num(h.sent)} enviado(s)</span>
                  {h.failed > 0 && <span className="text-2xs tabular-nums text-logic-lcd-red">{num(h.failed)} falha(s)</span>}
                </button>
                {open === h.id && (
                  <div className="px-4 pb-3 space-y-2">
                    <pre className="whitespace-pre-wrap text-xs text-logic-text-dim bg-logic-bg-deep border border-logic-border-dark rounded-md p-2.5 max-h-48 overflow-auto font-sans">{h.body}</pre>
                    <RecipientList rows={h.recipients ?? []} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function RecipientList({ rows }: { rows: DirectRecipientRow[] }) {
  return (
    <ul className="rounded-md border border-logic-border-dark bg-logic-bg-deep divide-y divide-logic-border-dark">
      {rows.map((r) => (
        <li key={r.address} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
          {r.status === 'sent'
            ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-logic-lcd-green" />
            : r.error === 'optout'
              ? <AlertTriangle size={13} className="mt-0.5 shrink-0 text-logic-accent-hover" />
              : <XCircle size={13} className="mt-0.5 shrink-0 text-logic-lcd-red" />}
          <span className="font-mono text-logic-text truncate">{r.address}</span>
          <span className={`ml-auto text-right ${r.status === 'sent' ? 'text-logic-lcd-green' : 'text-logic-text-dim'}`}>
            {r.status === 'sent' ? 'enviado' : `falhou: ${friendlyDirectError(r.error) || 'sem motivo informado'}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
