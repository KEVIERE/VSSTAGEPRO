// Aba "Afiliados" do admin: saques pedidos, novo afiliado, tabela com comissão e desconto
// editáveis e o detalhe de cada afiliado (clientes, comissões com cancelar, saques).
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Minus, Plus, UserPlus, X } from 'lucide-react';
import {
  adminApi, dateTime, STATE_CLS, STATE_LABEL,
  type AdminAffiliate, type AdminAffiliateDetail, type AdminPayoutRequest,
} from '@/components/admin/adminApi';
import { btnDanger, btnGhost, btnPrimary, Empty, ErrorBox, input, Kpi, Loading, Panel } from '@/components/admin/ui';
import { formatBRL } from '@/lib/pixFormat';
import { COMMISSION_LABEL, PIX_KEY_LABEL, type PixKeyType, affiliateError, affiliateLink } from '@/lib/affiliateRules';

const STATUS_LABEL: Record<AdminAffiliate['status'], string> = { active: 'Ativo', paused: 'Pausado', ended: 'Encerrado' };
const STATUS_CLS: Record<AdminAffiliate['status'], string> = {
  active: 'bg-logic-lcd-green/15 text-logic-lcd-green',
  paused: 'bg-logic-lcd-amber/15 text-logic-lcd-amber',
  ended: 'bg-logic-bg-elevated text-logic-text-muted',
};
const pixLabel = (t: string | null) => (t && t in PIX_KEY_LABEL ? PIX_KEY_LABEL[t as PixKeyType] : t ?? '');

function CopyButton({ text, title = 'Copiar' }: { text: string; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button" title={title} className={btnGhost}
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {})}
    >
      {done ? <Check size={12} className="text-logic-lcd-green" /> : <Copy size={12} />}
    </button>
  );
}

/** Campo de porcentagem com mais e menos. Salva ao sair do campo ou nos botões. */
function PercentField({ value, min, max, onSave }: { value: number; min: number; max: number; onSave: (v: number) => Promise<void> }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = (n: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setV(String(clamped));
    if (clamped !== value) onSave(clamped).catch(() => setV(String(value)));
  };
  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" className={`${btnGhost} !px-1.5 !h-7`} onClick={() => commit(value - 1)} aria-label="Menos"><Minus size={11} /></button>
      <input
        className="w-11 h-7 text-center bg-logic-bg-deep border border-logic-border-light rounded text-xs tabular-nums outline-none focus:border-logic-accent"
        value={v} inputMode="numeric"
        onChange={(e) => setV(e.target.value.replace(/\D+/g, '').slice(0, 3))}
        onBlur={() => commit(Number(v) || 0)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <span className="text-2xs text-logic-text-muted">%</span>
      <button type="button" className={`${btnGhost} !px-1.5 !h-7`} onClick={() => commit(value + 1)} aria-label="Mais"><Plus size={11} /></button>
    </div>
  );
}

function PayoutRow({ p, onDone }: { p: AdminPayoutRequest; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'pay' | 'reject'>('idle');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'pay') await adminApi.affiliatePayoutPaid(p.id, text.trim());
      else await adminApi.affiliatePayoutReject(p.id, text.trim());
      onDone();
    } catch (e) {
      setError(affiliateError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-4 py-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px]">
          <p className="font-semibold text-logic-text">{p.payout_name} <span className="font-mono text-logic-lcd-amber">{p.code}</span></p>
          <p className="text-2xs text-logic-text-muted">{p.email}</p>
        </div>
        <span className="text-base font-bold tabular-nums text-logic-lcd-green">{formatBRL(p.amount_cents)}</span>
        <span className="text-logic-text-dim">pedido {dateTime(p.requested_at)}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-logic-text-muted">{pixLabel(p.pix_key_type)}:</span>
          <span className="font-mono">{p.pix_key}</span>
          <CopyButton text={p.pix_key} title="Copiar chave PIX" />
        </span>
        {mode === 'idle' && (
          <span className="ml-auto flex gap-1.5">
            <button type="button" className={btnPrimary} onClick={() => { setMode('pay'); setText(''); }}>Marcar como pago</button>
            <button type="button" className={btnDanger} onClick={() => { setMode('reject'); setText(''); }}>Recusar</button>
          </span>
        )}
      </div>
      {mode !== 'idle' && (
        <form className="flex gap-2 items-center" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input
            className={input} autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={200}
            placeholder={mode === 'pay' ? 'Código do PIX enviado (ID da transação)' : 'Motivo da recusa (o afiliado vê)'}
          />
          <button type="submit" disabled={busy || text.trim().length < (mode === 'pay' ? 1 : 3)} className={mode === 'pay' ? btnPrimary : btnDanger}>
            {mode === 'pay' ? 'Confirmar pagamento' : 'Confirmar recusa'}
          </button>
          <button type="button" className={btnGhost} onClick={() => setMode('idle')} aria-label="Cancelar"><X size={12} /></button>
        </form>
      )}
      {error && <ErrorBox text={error} />}
    </li>
  );
}

function NewAffiliate({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [commission, setCommission] = useState('10');
  const [discount, setDiscount] = useState('10');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.affiliateCreate(email.trim(), code.trim().toUpperCase(), Number(commission), Number(discount), note.trim());
      setEmail(''); setCode(''); setNote('');
      onCreated();
    } catch (err) {
      setError(affiliateError((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
      <label className="text-2xs text-logic-text-muted space-y-1 lg:col-span-2">
        <span>E-mail da conta (a pessoa já precisa ter cadastro)</span>
        <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="text-2xs text-logic-text-muted space-y-1">
        <span>Código (link e cupom)</span>
        <input
          className={`${input} font-mono uppercase`} value={code} maxLength={32} placeholder="JOAO10" required
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
        />
      </label>
      <label className="text-2xs text-logic-text-muted space-y-1">
        <span>Comissão %</span>
        <input className={input} type="number" min={0} max={100} value={commission} onChange={(e) => setCommission(e.target.value)} required />
      </label>
      <label className="text-2xs text-logic-text-muted space-y-1">
        <span>Desconto do cupom %</span>
        <input className={input} type="number" min={1} max={90} value={discount} onChange={(e) => setDiscount(e.target.value)} required />
      </label>
      <label className="text-2xs text-logic-text-muted space-y-1 sm:col-span-2 lg:col-span-4">
        <span>Observação (só o admin vê)</span>
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </label>
      <button type="submit" disabled={busy} className={`${btnPrimary} h-9`}>Criar afiliado</button>
      {error && <div className="sm:col-span-2 lg:col-span-5"><ErrorBox text={error} /></div>}
    </form>
  );
}

function Detail({ a, onChanged }: { a: AdminAffiliate; onChanged: () => void }) {
  const [d, setD] = useState<AdminAffiliateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    adminApi.affiliateDetail(a.user_id).then(setD, (e) => setError(affiliateError((e as Error).message)));
  }, [a.user_id]);
  useEffect(load, [load]);

  const cancel = async (id: string) => {
    const reason = window.prompt('Motivo do cancelamento (ex.: estorno do cartão):');
    if (!reason) return;
    try {
      await adminApi.affiliateCommissionCancel(id, reason);
      load();
      onChanged();
    } catch (e) {
      window.alert(affiliateError((e as Error).message));
    }
  };

  if (error) return <div className="p-4"><ErrorBox text={error} /></div>;
  if (!d) return <Loading />;
  return (
    <div className="p-4 space-y-4 bg-logic-bg-deep/40">
      <div className="flex flex-wrap gap-4 text-xs text-logic-text-dim">
        <span>Link: <span className="font-mono text-logic-text">{affiliateLink(a.code)}</span></span>
        <span>Chave PIX: {a.pix_key ? <span className="text-logic-text">{pixLabel(a.pix_key_type)} {a.pix_key} ({a.payout_name})</span> : 'não cadastrada'}</span>
        {a.note && <span className="italic">{a.note}</span>}
      </div>

      <div>
        <p className="text-2xs font-semibold tracking-widest text-logic-text-muted uppercase mb-1.5">Clientes ({d.customers.length})</p>
        {d.customers.length === 0 ? <p className="text-2xs text-logic-text-muted">Ninguém ainda.</p> : (
          <ul className="rounded-md border border-logic-border divide-y divide-logic-border/60 text-2xs">
            {d.customers.map((c) => (
              <li key={c.user_id} className="px-3 py-1.5 flex flex-wrap gap-3 items-center">
                <span className="min-w-[200px]">{c.email}</span>
                <span className="text-logic-text-dim">{c.name ?? ''}</span>
                <span className="text-logic-text-muted">{c.source === 'coupon' ? 'cupom' : 'link'} · {dateTime(c.created_at)}</span>
                <span className={`ml-auto px-1.5 rounded ${STATE_CLS[c.state] ?? ''}`}>{STATE_LABEL[c.state] ?? c.state}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-2xs font-semibold tracking-widest text-logic-text-muted uppercase mb-1.5">Comissões ({d.commissions.length})</p>
        {d.commissions.length === 0 ? <p className="text-2xs text-logic-text-muted">Nenhuma ainda.</p> : (
          <ul className="rounded-md border border-logic-border divide-y divide-logic-border/60 text-2xs">
            {d.commissions.map((c) => (
              <li key={c.id} className="px-3 py-1.5 flex flex-wrap gap-3 items-center">
                <span className="w-32">{dateTime(c.created_at)}</span>
                <span className="min-w-[180px] text-logic-text-dim">{c.customer_email ?? '—'}</span>
                <span>{c.plan === 'yearly' ? 'Anual' : c.plan === 'monthly' ? 'Mensal' : '—'}</span>
                <span className="tabular-nums">{formatBRL(c.base_cents)} × {c.percent}% = <b>{formatBRL(c.commission_cents)}</b></span>
                <span className={c.status === 'canceled' ? 'text-logic-lcd-red' : c.status === 'paid' ? 'text-logic-lcd-green' : 'text-logic-text-dim'} title={c.cancel_reason ?? undefined}>
                  {COMMISSION_LABEL[c.status]}{c.status === 'pending' ? ` até ${dateTime(c.available_at)}` : ''}
                </span>
                {(c.status === 'pending' || c.status === 'available') && (
                  <button type="button" className={`${btnDanger} ml-auto !h-6`} onClick={() => cancel(c.id)}>Cancelar</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-2xs font-semibold tracking-widest text-logic-text-muted uppercase mb-1.5">Saques ({d.payouts.length})</p>
        {d.payouts.length === 0 ? <p className="text-2xs text-logic-text-muted">Nenhum pedido.</p> : (
          <ul className="rounded-md border border-logic-border divide-y divide-logic-border/60 text-2xs">
            {d.payouts.map((p) => (
              <li key={p.id} className="px-3 py-1.5 flex flex-wrap gap-3 items-center">
                <span className="w-32">{dateTime(p.requested_at)}</span>
                <span className="tabular-nums font-semibold">{formatBRL(p.amount_cents)}</span>
                <span className={p.status === 'paid' ? 'text-logic-lcd-green' : p.status === 'rejected' ? 'text-logic-lcd-red' : 'text-logic-lcd-amber'}>
                  {p.status === 'paid' ? 'Pago' : p.status === 'rejected' ? 'Recusado' : 'Pedido'}
                </span>
                <span className="text-logic-text-dim">
                  {p.status === 'paid' ? `${dateTime(p.paid_at)} · ${p.reference ?? ''}` : p.status === 'rejected' ? p.reject_reason : `${pixLabel(p.pix_key_type)} ${p.pix_key}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AffiliatesTab({ onOpenPayouts }: { onOpenPayouts?: (count: number) => void }) {
  const [list, setList] = useState<AdminAffiliate[] | null>(null);
  const [payouts, setPayouts] = useState<AdminPayoutRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminApi.affiliates().then(setList, (e) => setError(affiliateError((e as Error).message)));
    adminApi.affiliatePayoutsOpen().then((p) => { setPayouts(p); onOpenPayouts?.(p.length); }, () => setPayouts([]));
  }, [onOpenPayouts]);
  useEffect(load, [load]);

  const update = async (a: AdminAffiliate, p: Parameters<typeof adminApi.affiliateUpdate>[1]) => {
    try {
      await adminApi.affiliateUpdate(a.user_id, p);
      load();
    } catch (e) {
      window.alert(affiliateError((e as Error).message));
      throw e;
    }
  };

  const totals = (list ?? []).reduce(
    (t, a) => ({ revenue: t.revenue + Number(a.revenue_cents), toPay: t.toPay + Number(a.to_pay_cents), paid: t.paid + Number(a.paid_cents) }),
    { revenue: 0, toPay: 0, paid: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Afiliados</h2>
          <p className="text-xs text-logic-text-dim">Quem divulga ganha comissão de cada pagamento dos clientes que trouxe. O cupom vale só no primeiro pagamento.</p>
        </div>
        <button type="button" className={btnPrimary} onClick={() => setCreating((v) => !v)}>
          <UserPlus size={13} /> Novo afiliado
        </button>
      </div>

      {error && <ErrorBox text={error} />}

      <Panel title={`Saques pedidos${payouts?.length ? ` (${payouts.length})` : ''}`}>
        {payouts === null ? <Loading /> : payouts.length === 0 ? <Empty text="Nenhum saque esperando pagamento." /> : (
          <ul className="divide-y divide-logic-border">
            {payouts.map((p) => <PayoutRow key={p.id} p={p} onDone={load} />)}
          </ul>
        )}
      </Panel>

      {creating && (
        <Panel title="Novo afiliado" actions={<button type="button" className={btnGhost} onClick={() => setCreating(false)}><X size={12} /></button>}>
          <NewAffiliate onCreated={() => { setCreating(false); load(); }} />
        </Panel>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Receita trazida" value={formatBRL(totals.revenue)} />
        <Kpi label="A pagar (liberado)" value={formatBRL(totals.toPay)} accent="text-logic-lcd-amber" />
        <Kpi label="Já pago a afiliados" value={formatBRL(totals.paid)} accent="text-logic-lcd-green" />
      </div>

      <Panel title="Afiliados">
        {list === null ? <Loading /> : list.length === 0 ? <Empty text="Nenhum afiliado ainda. Use Novo afiliado." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wider text-logic-text-muted">
                  {['Afiliado', 'Código', 'Comissão', 'Desconto', 'Cadastros', 'Pagantes', 'Receita trazida', 'A pagar', 'Situação', ''].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <Fragment key={a.user_id}>
                    <tr className="border-t border-logic-border">
                      <td className="px-3 py-2">
                        <p className="font-semibold">{a.name ?? a.email}</p>
                        {a.name && <p className="text-2xs text-logic-text-muted">{a.email}</p>}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold text-logic-lcd-amber">{a.code}</td>
                      <td className="px-3 py-2"><PercentField value={a.commission_percent} min={0} max={100} onSave={(v) => update(a, { commission: v })} /></td>
                      <td className="px-3 py-2"><PercentField value={a.discount_percent} min={1} max={90} onSave={(v) => update(a, { discount: v })} /></td>
                      <td className="px-3 py-2 tabular-nums">{a.signups}</td>
                      <td className="px-3 py-2 tabular-nums">{a.paying}</td>
                      <td className="px-3 py-2 tabular-nums">{formatBRL(a.revenue_cents)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatBRL(a.to_pay_cents)}
                        {Number(a.pending_cents) > 0 && <p className="text-2xs text-logic-text-muted">+{formatBRL(a.pending_cents)} a liberar</p>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={`h-7 rounded px-1.5 text-2xs font-bold border-0 outline-none ${STATUS_CLS[a.status]}`}
                          value={a.status}
                          onChange={(e) => {
                            const status = e.target.value as AdminAffiliate['status'];
                            if (status === 'ended' && !window.confirm(`Encerrar ${a.code}? O link e o cupom param de valer e novos pagamentos não geram comissão.`)) return;
                            update(a, { status }).catch(() => {});
                          }}
                        >
                          {(Object.keys(STATUS_LABEL) as AdminAffiliate['status'][]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className={btnGhost} onClick={() => setOpen(open === a.user_id ? null : a.user_id)}>
                          Detalhe <ChevronDown size={12} className={open === a.user_id ? 'rotate-180 transition' : 'transition'} />
                        </button>
                      </td>
                    </tr>
                    {open === a.user_id && (
                      <tr><td colSpan={10} className="p-0 border-t border-logic-border"><Detail a={a} onChanged={load} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
