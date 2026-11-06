import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, APPROVAL_CLS, APPROVAL_LABEL, dateTime } from '@/components/admin/adminApi';
import type { OutreachChannel, OutreachTemplate } from '@/components/admin/adminApi';
import { btnDanger, btnGhost, btnPrimary, Empty, ErrorBox, input, Loading, Panel } from '@/components/admin/ui';

// Mensagens prontas. O texto é escrito aqui e, no caso do WhatsApp, vira um template na
// Twilio e vai para aprovação do próprio WhatsApp. Só depois de aprovado ele pode iniciar
// conversa com alguém que não escreveu primeiro, que é o caso de qualquer envio em massa.

/** Variáveis disponíveis nas mensagens. O servidor troca {{chave}} pelo dado do usuário. */
const VARIABLES: Array<{ key: string; label: string }> = [
  { key: 'nome', label: 'Nome da pessoa' },
  { key: 'quando', label: 'Data/hora que você digitar no envio' },
  { key: 'versao', label: 'Versão do programa' },
];

export default function OutreachTemplates({ channel }: { channel: OutreachChannel }) {
  const [list, setList] = useState<OutreachTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [editing, setEditing] = useState<OutreachTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setList(await adminApi.outreachTemplates(channel)); } catch (e) { setError(friendlyError((e as Error).message)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      await load();
      setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Mensagens prontas"
      actions={
        <div className="flex items-center gap-1">
          <button type="button" className={btnGhost} onClick={load} aria-label="Atualizar"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" className={btnGhost} onClick={() => { setCreating(true); setEditing(null); }}><Plus size={13} /> Nova</button>
        </div>
      }
    >
      {(msg || error) && <div className="p-3 pb-0 space-y-2">{error && <ErrorBox text={error} />}{msg && (
        <div className={`px-3 py-2 rounded-lg border text-xs ${msg.ok ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'}`}>{msg.text}</div>
      )}</div>}

      {loading && list.length === 0 ? <Loading /> : list.length === 0 ? <Empty text="Nenhuma mensagem pronta neste canal." /> : (
        <ul className="divide-y divide-logic-border">
          {list.map((t) => (
            <li key={t.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{t.name}</span>
                    {!t.active && <span className="px-1.5 h-4 rounded bg-logic-text-muted/15 text-logic-text-muted text-[10px] font-bold inline-flex items-center">Desativada</span>}
                    {channel === 'whatsapp' && (
                      <span className={`px-1.5 h-4 rounded text-[10px] font-bold inline-flex items-center ${APPROVAL_CLS[t.approval_status]}`}>
                        {APPROVAL_LABEL[t.approval_status]}
                      </span>
                    )}
                  </div>
                  {t.subject && <p className="text-2xs text-logic-text-dim mt-0.5 truncate">{t.subject}</p>}
                  <p className="text-2xs text-logic-text-muted mt-1 line-clamp-2 whitespace-pre-line">{t.body}</p>
                  <p className="text-[10px] text-logic-text-muted mt-1">
                    Atualizada {dateTime(t.updated_at)}
                    {t.twilio_content_sid ? ` · modelo na Twilio: ${t.twilio_content_sid.slice(0, 10)}…` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <button type="button" className={btnGhost} onClick={() => { setEditing(t); setCreating(false); }}>Editar</button>
                  {channel === 'whatsapp' && !t.twilio_content_sid && (
                    <button type="button" className={btnPrimary} disabled={busy !== null}
                      onClick={() => act(`c${t.id}`, () => adminApi.outreachTemplateCreate(t.id).then(() => undefined), 'Modelo criado na Twilio. Agora envie para aprovação.')}>
                      {busy === `c${t.id}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Criar na Twilio
                    </button>
                  )}
                  {channel === 'whatsapp' && t.twilio_content_sid && t.approval_status !== 'approved' && (
                    <>
                      <button type="button" className={btnGhost} disabled={busy !== null}
                        onClick={() => act(`a${t.id}`, () => adminApi.outreachTemplateApprove(t.id).then(() => undefined), 'Enviada para análise do WhatsApp. Costuma levar até um dia útil.')}>
                        Enviar para aprovação
                      </button>
                      <button type="button" className={btnGhost} disabled={busy !== null}
                        onClick={() => act(`s${t.id}`, async () => { const r = await adminApi.outreachTemplateStatus(t.id); setMsg({ ok: true, text: `Estado na Twilio: ${r.status}.` }); }, 'Consultado.')}>
                        Consultar estado
                      </button>
                    </>
                  )}
                  {channel === 'whatsapp' && t.approval_status === 'approved' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-logic-lcd-green"><CheckCircle2 size={11} /> Aprovada</span>
                  )}
                  <button type="button" className={`${btnDanger} px-2`} disabled={busy !== null}
                    onClick={() => { if (window.confirm(`Apagar a mensagem "${t.name}"? Campanhas já enviadas não mudam.`)) act(`d${t.id}`, () => adminApi.outreachTemplateDelete(t.id), 'Mensagem apagada.'); }}
                    aria-label="Apagar">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(editing || creating) && (
        <TemplateDialog
          channel={channel}
          template={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await load(); }}
        />
      )}
    </Panel>
  );
}

function TemplateDialog({ channel, template, onClose, onSaved }: {
  channel: OutreachChannel;
  template: OutreachTemplate | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [active, setActive] = useState(template?.active ?? true);
  const [category, setCategory] = useState<'UTILITY' | 'MARKETING'>(template?.approval_category === 'MARKETING' ? 'MARKETING' : 'UTILITY');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const variables = Array.from((body.match(/\{\{\s*([\w.-]+)\s*\}\}/g) ?? []))
        .map((m) => m.replace(/[{}\s]/g, ''))
        .filter((v, i, arr) => arr.indexOf(v) === i);
      await adminApi.outreachTemplateSave({
        id: template?.id ?? null, name: name.trim(), channel,
        subject: channel === 'email' ? subject : null,
        body, variables, approvalCategory: channel === 'whatsapp' ? category : null, active,
      });
      await onSaved();
    } catch (err) {
      setError(friendlyError((err as Error).message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form className="w-[560px] max-w-full max-h-full overflow-y-auto bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <header className="sticky top-0 flex items-center justify-between px-4 h-11 border-b border-logic-border bg-logic-bg-elevated">
          <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">{template ? 'EDITAR MENSAGEM' : 'NOVA MENSAGEM'}</span>
          <button type="button" className="p-1 rounded hover:bg-logic-bg-panel-light" onClick={onClose} aria-label="Fechar"><X size={15} /></button>
        </header>

        <div className="p-4 space-y-3">
          {error && <ErrorBox text={error} />}
          <div>
            <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Nome (só para você encontrar depois)</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </div>
          {channel === 'email' && (
            <div>
              <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Assunto</label>
              <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={150} />
            </div>
          )}
          <div>
            <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Mensagem</label>
            <textarea
              className={`${input} h-40 py-2 leading-relaxed resize-y`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={channel === 'whatsapp' ? 1024 : 4000}
            />
            <p className="text-[10px] text-logic-text-muted mt-1 leading-snug">
              Use {'{{nome}}'} para o nome da pessoa. No e-mail valem **negrito**, _itálico_ e [texto](link); uma linha em
              branco separa parágrafos.
              {channel === 'whatsapp' && ' No WhatsApp o texto precisa caber em uma mensagem e as variáveis entram na ordem em que aparecem.'}
            </p>
            {channel === 'whatsapp' && (
              <p className="text-[10px] text-logic-text-muted mt-1">{body.length}/1024 caracteres</p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {VARIABLES.map((v) => (
              <button key={v.key} type="button" className={btnGhost} title={v.label}
                onClick={() => setBody((b) => `${b}{{${v.key}}}`)}>
                + {v.key}
              </button>
            ))}
          </div>
          {channel === 'whatsapp' && (
            <div>
              <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Categoria na aprovação do WhatsApp</label>
              <div className="flex p-0.5 rounded-md bg-logic-bg-deep border border-logic-border-dark w-fit">
                {(['UTILITY', 'MARKETING'] as const).map((c) => (
                  <button key={c} type="button" onClick={() => setCategory(c)}
                    className={`px-2.5 h-7 rounded text-2xs font-semibold transition ${category === c ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-muted hover:text-logic-text'}`}>
                    {c === 'UTILITY' ? 'Aviso (mais rápido)' : 'Marketing'}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-logic-text-muted mt-1 leading-snug">
                Aviso é a categoria certa para prazo de teste, versão nova e pagamento. Marketing só para conteúdo promocional,
                e o WhatsApp é mais rígido com ela.
              </p>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Disponível para usar em envios
          </label>
          {template?.approval_status === 'approved' && (
            <p className="text-[10px] text-logic-lcd-amber flex items-center gap-1"><AlertTriangle size={11} /> Mudar o texto de um modelo aprovado exige nova aprovação: o modelo volta para rascunho.</p>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 px-4 h-12 border-t border-logic-border bg-logic-bg-elevated">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button className={btnPrimary} disabled={saving}>{saving && <Loader2 size={13} className="animate-spin" />} Salvar</button>
        </footer>
      </form>
    </div>
  );
}
