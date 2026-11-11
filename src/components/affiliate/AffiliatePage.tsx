// Área do afiliado (/afiliado): link e cupom, painel de ganhos, clientes, comissões, chave PIX,
// pedido de saque e histórico. Entra com a mesma conta do site (e-mail e senha).
// Visual da mesa de som (classes console-* e access-*), como a entrada do programa.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, Loader2, Lock, LogOut, Mail, MessageCircle, Share2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { clearLocalSession, supabase } from '@/lib/supabaseClient';
import { friendlyError } from '@/lib/friendlyError';
import { formatBRL } from '@/lib/pixFormat';
import { supportWhatsAppUrl } from '@/lib/support';
import { AccessCard, AccessNotice, AccessStage, AccessStatus, AccessTitle } from '@/components/access/AccessChrome';
import {
  affiliateApi, type AffiliateCommission, type AffiliateCustomer, type AffiliateMe, type AffiliatePayout,
} from '@/lib/affiliateApi';
import {
  COMMISSION_LABEL, PIX_KEY_LABEL, type PixKeyType, affiliateError, affiliateLink, affiliateShareText,
  last12Months, monthLabel, normalizePixKey, payoutBlock,
} from '@/lib/affiliateRules';

const dateBR = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : '—';
const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

const PLAN_LABEL: Record<string, string> = { monthly: 'Mensal', yearly: 'Anual' };
const SITUATION: Record<AffiliateCustomer['situation'], { text: string; cls: string }> = {
  signed_up: { text: 'Só cadastrou', cls: 'text-logic-text-muted' },
  paid: { text: 'Pagou', cls: 'text-logic-lcd-amber' },
  active: { text: 'Assinante ativo', cls: 'text-logic-lcd-green' },
};
const COMMISSION_CLS: Record<string, string> = {
  pending: 'text-logic-text-dim',
  available: 'text-logic-lcd-green',
  reserved: 'text-logic-lcd-amber',
  paid: 'text-logic-text',
  canceled: 'text-[#ff7a70] line-through',
};
const PAYOUT_LABEL: Record<AffiliatePayout['status'], { text: string; cls: string }> = {
  requested: { text: 'Pedido', cls: 'text-logic-lcd-amber' },
  paid: { text: 'Pago', cls: 'text-logic-lcd-green' },
  rejected: { text: 'Recusado', cls: 'text-[#ff7a70]' },
};

function Field({ icon, ...props }: { icon?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="access-input relative">
      {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">{icon}</span>}
      <input {...props} className={`access-field ${icon ? '' : 'is-plain'} ${props.className ?? ''}`} />
    </div>
  );
}

/** Visor com um número aceso. */
function Readout({ label, value, hint, tone = 'text' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'text' | 'green' | 'amber' }) {
  const color = tone === 'green' ? 'text-logic-lcd-green' : tone === 'amber' ? 'text-logic-lcd-amber' : 'text-logic-text';
  return (
    <div className="console-bezel">
      <div className="console-display px-3 py-2.5 h-full">
        <p className="console-legend uppercase tracking-[0.12em] text-logic-text-muted">{label}</p>
        <p className={`font-stage font-bold text-[1.35rem] leading-tight tabular-nums mt-1 ${color}`}>{value}</p>
        {hint && <p className="text-[0.7rem] text-logic-text-dim mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function CopyKey({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`console-key h-9 px-3 text-sm flex items-center gap-1.5 shrink-0 ${done ? 'is-lit-green' : ''}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }).catch(() => {});
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copiado' : label}
    </button>
  );
}

function Section({ label, status, children }: { label: string; status?: ReactNode; children: ReactNode }) {
  return (
    <AccessCard label={label} status={status} width={880} className="w-full">
      <div className="p-5">{children}</div>
    </AccessCard>
  );
}

function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0;
  if (!rows && empty) return <p className="text-xs text-logic-text-muted text-center py-6">{empty}</p>;
  return (
    <div className="console-bezel overflow-x-auto">
      <table className="console-display w-full text-xs">
        <thead>
          <tr className="text-left">
            {head.map((h) => <th key={h} className="console-legend uppercase tracking-[0.1em] text-logic-text-muted font-normal px-3 py-2 whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-white/[0.05]">{children}</tbody>
      </table>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError(friendlyError(err.message));
    setBusy(false);
  };
  return (
    <AccessCard label="Afiliados">
      <form onSubmit={submit} className="px-6 pt-7 pb-6 space-y-3">
        <AccessTitle title="Área do afiliado" subtitle="Entre com a conta do VS Stage Pro que recebeu o convite." />
        {error && <AccessNotice tone="red">{error}</AccessNotice>}
        <Field icon={<Mail size={14} />} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" autoComplete="email" required autoFocus />
        <Field icon={<Lock size={14} />} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" autoComplete="current-password" required />
        <button type="submit" disabled={busy} className="access-key">
          {busy && <Loader2 size={16} className="animate-spin" />} Entrar
        </button>
        <p className="text-center"><a href="/recuperar" className="access-link">Esqueci minha senha</a></p>
      </form>
    </AccessCard>
  );
}

/** Ganhos por mês: barras simples, o mês atual por último. */
function MonthlyBars({ rows }: { rows: AffiliateMe['monthly'] }) {
  const months = last12Months(rows);
  const max = Math.max(1, ...months.map((m) => m.cents));
  return (
    <div className="console-bezel">
      <div className="console-display px-3 pt-3 pb-2">
        <p className="console-legend uppercase tracking-[0.12em] text-logic-text-muted mb-2">Ganhos por mês</p>
        <div className="flex items-end gap-1.5 h-28">
          {months.map((m) => (
            <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full" title={`${monthLabel(m.month)}: ${formatBRL(m.cents)}`}>
              <div
                className="w-full rounded-[2px] bg-logic-lcd-amber/80 shadow-[0_0_8px_rgba(255,171,31,0.35)]"
                style={{ height: `${Math.max(m.cents ? 4 : 1, (m.cents / max) * 100)}%`, opacity: m.cents ? 1 : 0.25 }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-1.5">
          {months.map((m) => <span key={m.month} className="flex-1 text-center text-[0.6rem] text-logic-text-muted">{monthLabel(m.month).split('/')[0]}</span>)}
        </div>
      </div>
    </div>
  );
}

function PixForm({ me, onSaved }: { me: AffiliateMe; onSaved: () => void }) {
  const [type, setType] = useState<PixKeyType>(me.pix_key_type ?? 'cpf');
  const [key, setKey] = useState(me.pix_key ?? '');
  const [name, setName] = useState(me.payout_name ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const [editing, setEditing] = useState(!me.pix_key);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!normalizePixKey(type, key)) { setMsg({ tone: 'red', text: affiliateError('pix_key_invalid') }); return; }
    if (name.trim().length < 3) { setMsg({ tone: 'red', text: affiliateError('pix_name_invalid') }); return; }
    setBusy(true);
    try {
      await affiliateApi.setPix(type, key, name);
      setMsg({ tone: 'green', text: 'Chave PIX salva.' });
      setEditing(false);
      onSaved();
    } catch (err) {
      setMsg({ tone: 'red', text: affiliateError((err as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  if (!editing && me.pix_key) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <div className="console-bezel flex-1 min-w-[220px]">
          <div className="console-display px-3 py-2.5 text-xs">
            <p className="console-legend uppercase tracking-[0.12em] text-logic-text-muted">Chave PIX ({PIX_KEY_LABEL[me.pix_key_type ?? 'cpf']})</p>
            <p className="text-logic-text mt-1 break-all">{me.pix_key}</p>
            <p className="text-logic-text-dim mt-0.5">{me.payout_name}</p>
          </div>
        </div>
        <button type="button" className="console-key h-9 px-3 text-sm" onClick={() => setEditing(true)}>Trocar chave</button>
        {msg && <div className="w-full"><AccessNotice tone={msg.tone}>{msg.text}</AccessNotice></div>}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(PIX_KEY_LABEL) as PixKeyType[]).map((t) => (
          <button
            key={t} type="button" onClick={() => setType(t)}
            className={`console-key h-8 px-3 text-sm flex items-center gap-1.5 ${type === t ? 'is-lit-amber' : ''}`}
          >
            {PIX_KEY_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field value={key} onChange={(e) => setKey(e.target.value)} placeholder={`Chave PIX (${PIX_KEY_LABEL[type]})`} maxLength={120} required />
        <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo do titular" maxLength={120} required />
      </div>
      {msg && <AccessNotice tone={msg.tone}>{msg.text}</AccessNotice>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="console-key is-lit-amber h-9 px-4 text-sm flex items-center gap-1.5">
          {busy && <Loader2 size={13} className="animate-spin" />} Salvar chave PIX
        </button>
        {me.pix_key && <button type="button" className="console-key h-9 px-3 text-sm" onClick={() => setEditing(false)}>Cancelar</button>}
      </div>
    </form>
  );
}

function Dashboard({ me, reload }: { me: AffiliateMe; reload: () => void }) {
  const [customers, setCustomers] = useState<AffiliateCustomer[] | null>(null);
  const [commissions, setCommissions] = useState<AffiliateCommission[] | null>(null);
  const [payouts, setPayouts] = useState<AffiliatePayout[] | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);

  const loadLists = useCallback(() => {
    affiliateApi.customers().then(setCustomers, () => setCustomers([]));
    affiliateApi.commissions().then(setCommissions, () => setCommissions([]));
    affiliateApi.payouts().then(setPayouts, () => setPayouts([]));
  }, []);
  useEffect(loadLists, [loadLists]);

  const link = affiliateLink(me.code, window.location.origin.includes('localhost') ? window.location.origin : undefined);
  const share = affiliateShareText(me.code, me.discount_percent, link);
  const { block, missingCents } = payoutBlock({
    status: me.status,
    availableCents: me.available_cents,
    hasPixKey: !!me.pix_key && !!me.payout_name,
    hasOpenRequest: !!me.open_payout,
  });

  const requestPayout = async () => {
    setRequesting(true);
    setPayoutMsg(null);
    try {
      const r = await affiliateApi.requestPayout();
      setPayoutMsg({ tone: 'green', text: `Saque de ${formatBRL(r.amount_cents)} pedido. Você vê aqui quando for pago.` });
      reload();
      loadLists();
    } catch (err) {
      setPayoutMsg({ tone: 'red', text: affiliateError((err as Error).message) });
    } finally {
      setRequesting(false);
    }
  };

  const statusLed = me.status === 'active'
    ? <AccessStatus tone="green">Ativo</AccessStatus>
    : me.status === 'paused' ? <AccessStatus tone="amber">Pausado</AccessStatus> : <AccessStatus tone="red">Encerrado</AccessStatus>;

  return (
    <>
      {me.status !== 'active' && (
        <div className="w-full max-w-[880px]">
          <AccessNotice tone="red">
            {me.status === 'paused'
              ? 'Sua participação está pausada: o link e o cupom não geram comissão por enquanto. O saldo que já existe continua seu.'
              : 'Sua participação foi encerrada. O link e o cupom não valem mais.'}
          </AccessNotice>
        </div>
      )}

      <Section label="Seu link e seu cupom" status={statusLed}>
        <div className="space-y-3">
          <div className="flex gap-2 items-stretch">
            <div className="console-bezel flex-1 min-w-0">
              <div className="console-display px-3 h-9 flex items-center text-sm text-logic-text truncate">{link}</div>
            </div>
            <CopyKey text={link} label="Copiar link" />
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <div className="console-bezel">
              <div className="console-display px-3 h-9 flex items-center gap-2 text-sm">
                <span className="console-legend uppercase tracking-[0.12em] text-logic-text-muted">Cupom</span>
                <span className="font-stage font-bold text-logic-lcd-amber tracking-wide">{me.code}</span>
                <span className="text-logic-text-dim">{me.discount_percent}% no primeiro pagamento</span>
              </div>
            </div>
            <CopyKey text={me.code} label="Copiar cupom" />
            <a
              className="console-key h-9 px-3 text-sm flex items-center gap-1.5"
              href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer"
            >
              <Share2 size={13} /> Compartilhar no WhatsApp
            </a>
          </div>
          <p className="text-[0.75rem] text-logic-text-dim leading-relaxed">
            Você ganha {me.commission_percent}% de cada pagamento das pessoas que vierem pelo seu link ou usarem seu cupom,
            enquanto elas continuarem pagando. Cada comissão fica disponível 7 dias depois do pagamento.
          </p>
        </div>
      </Section>

      <Section label="Painel de ganhos">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <Readout label="Cadastros" value={me.signups} />
          <Readout label="Clientes pagantes" value={me.paying_customers} />
          <Readout label="Assinantes ativos" value={me.active_subscribers} tone="green" />
          <Readout label="Ganho do mês" value={formatBRL(me.earned_month_cents)} />
          <Readout label="Ganho total" value={formatBRL(me.earned_total_cents)} />
          <Readout label="Disponível para saque" value={formatBRL(me.available_cents)} tone="amber" />
          <Readout
            label="A liberar" value={formatBRL(me.pending_cents)}
            hint={me.releases.length ? `Próxima em ${dayMonth(me.releases[0].available_at)}: ${formatBRL(me.releases[0].commission_cents)}` : 'Nada esperando'}
          />
          <Readout label="Em saque" value={formatBRL(me.reserved_cents)} />
          <Readout label="Já recebido" value={formatBRL(me.paid_cents)} tone="green" />
        </div>
        {me.releases.length > 1 && (
          <p className="text-[0.72rem] text-logic-text-dim mt-3">
            Liberações: {me.releases.map((r) => `${dayMonth(r.available_at)} (${formatBRL(r.commission_cents)})`).join(' · ')}
          </p>
        )}
        <div className="mt-4"><MonthlyBars rows={me.monthly} /></div>
      </Section>

      <Section label="Saque">
        <div className="space-y-4">
          <PixForm me={me} onSaved={reload} />
          <div className="border-t border-white/[0.06] pt-4 space-y-2">
            {me.open_payout ? (
              <AccessNotice tone="green">
                Saque de {formatBRL(me.open_payout.amount_cents)} pedido em {dayMonth(me.open_payout.requested_at)}, aguardando pagamento.
              </AccessNotice>
            ) : (
              <>
                <button type="button" className="access-key max-w-sm" disabled={!!block || requesting} onClick={requestPayout}>
                  {requesting && <Loader2 size={16} className="animate-spin" />}
                  Solicitar saque{!block ? ` de ${formatBRL(me.available_cents)}` : ''}
                </button>
                {block === 'below_minimum' && (
                  <p className="text-xs text-logic-text-dim">Faltam {formatBRL(missingCents)} para o saque mínimo de {formatBRL(me.min_payout_cents)}.</p>
                )}
                {block === 'no_pix_key' && <p className="text-xs text-logic-text-dim">Cadastre sua chave PIX acima para pedir o saque.</p>}
                {block === 'ended' && <p className="text-xs text-logic-text-dim">{affiliateError('affiliate_ended')}</p>}
              </>
            )}
            {payoutMsg && <AccessNotice tone={payoutMsg.tone}>{payoutMsg.text}</AccessNotice>}
            <p className="text-[0.72rem] text-logic-text-dim">O saque leva todo o saldo disponível. O pagamento é feito por PIX na chave cadastrada.</p>
          </div>
        </div>
      </Section>

      <Section label="Histórico de saques">
        {payouts === null ? <Loader2 className="animate-spin mx-auto text-logic-text-muted" /> : (
          <Table head={['Pedido em', 'Valor', 'Situação', 'Detalhe']} empty="Nenhum saque pedido ainda.">
            {payouts.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 whitespace-nowrap">{dateBR(p.requested_at)}</td>
                <td className="px-3 py-2 tabular-nums">{formatBRL(p.amount_cents)}</td>
                <td className={`px-3 py-2 ${PAYOUT_LABEL[p.status].cls}`}>{PAYOUT_LABEL[p.status].text}</td>
                <td className="px-3 py-2 text-logic-text-dim">
                  {p.status === 'paid' ? `Pago em ${dateBR(p.paid_at)}${p.reference ? ` · código ${p.reference}` : ''}` : p.status === 'rejected' ? p.reject_reason : 'Aguardando pagamento'}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section label="Clientes">
        {customers === null ? <Loader2 className="animate-spin mx-auto text-logic-text-muted" /> : (
          <Table head={['Cliente', 'E-mail', 'Cadastro', 'Veio por', 'Situação', 'Você ganhou']} empty="Ninguém chegou pelo seu link ainda.">
            {customers.map((c, i) => (
              <tr key={`${c.email}-${i}`}>
                <td className="px-3 py-2">{c.name ?? '—'}</td>
                <td className="px-3 py-2 text-logic-text-dim">{c.email}</td>
                <td className="px-3 py-2 whitespace-nowrap">{dateBR(c.created_at)}</td>
                <td className="px-3 py-2 text-logic-text-dim">{c.source === 'coupon' ? 'Cupom' : 'Link'}</td>
                <td className={`px-3 py-2 ${SITUATION[c.situation].cls}`}>{SITUATION[c.situation].text}</td>
                <td className="px-3 py-2 tabular-nums">{formatBRL(c.earned_cents)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section label="Ganhos">
        {commissions === null ? <Loader2 className="animate-spin mx-auto text-logic-text-muted" /> : (
          <Table head={['Data', 'Cliente', 'Plano', 'Pagamento', '%', 'Comissão', 'Situação']} empty="Nenhuma comissão ainda.">
            {commissions.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 whitespace-nowrap">{dateBR(c.created_at)}</td>
                <td className="px-3 py-2">{c.customer_name ?? '—'}</td>
                <td className="px-3 py-2">{c.plan ? PLAN_LABEL[c.plan] ?? c.plan : '—'}</td>
                <td className="px-3 py-2 tabular-nums">{formatBRL(c.base_cents)}</td>
                <td className="px-3 py-2 tabular-nums">{c.percent}%</td>
                <td className="px-3 py-2 tabular-nums">{formatBRL(c.commission_cents)}</td>
                <td className={`px-3 py-2 whitespace-nowrap ${COMMISSION_CLS[c.status] ?? ''}`} title={c.cancel_reason ?? undefined}>
                  {COMMISSION_LABEL[c.status]}{c.status === 'pending' ? ` até ${dayMonth(c.available_at)}` : ''}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}

export default function AffiliatePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<AffiliateMe | false | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'VS Stage Pro — Área do afiliado';
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(() => {
    setError(null);
    affiliateApi.me().then(
      (r) => setMe(r.affiliate ? r : false),
      (e) => setError(affiliateError((e as Error).message)),
    );
  }, []);

  useEffect(() => {
    if (!session) { setMe(null); return; }
    load();
  }, [session, load]);

  const signOut = () => { clearLocalSession(); setSession(null); setMe(null); };

  let body: ReactNode;
  if (!ready || (session && me === null && !error)) {
    body = <Loader2 className="animate-spin text-logic-text-muted" />;
  } else if (!session) {
    body = <Login />;
  } else if (error) {
    body = (
      <AccessCard label="Afiliados">
        <div className="p-6 space-y-3">
          <AccessNotice tone="red">{error}</AccessNotice>
          <button type="button" className="access-key" onClick={load}>Tentar de novo</button>
        </div>
      </AccessCard>
    );
  } else if (me === false) {
    body = (
      <AccessCard label="Afiliados">
        <div className="px-6 pt-7 pb-6 space-y-4">
          <AccessTitle title="Área do afiliado" subtitle={<>A conta <span className="text-logic-text">{session.user.email}</span> não está no programa de afiliados.</>} />
          <a
            className="access-key"
            href={supportWhatsAppUrl('Olá! Quero saber como participar do programa de afiliados do VS Stage Pro.')}
            target="_blank" rel="noopener noreferrer"
          >
            <MessageCircle size={17} /> Fale com a gente pelo WhatsApp
          </a>
          <p className="text-center"><button type="button" onClick={signOut} className="access-link">Entrar com outra conta</button></p>
        </div>
      </AccessCard>
    );
  } else if (me) {
    body = (
      <div className="w-full max-w-[880px] flex flex-col items-center gap-5">
        <div className="w-full flex items-center justify-between gap-3">
          <div>
            <p className="console-legend uppercase tracking-[0.14em] text-logic-text-muted">VS Stage Pro</p>
            <h1 className="font-stage font-bold text-[1.8rem] leading-tight text-logic-text">Área do afiliado</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-logic-text-dim hidden sm:inline">{session.user.email}</span>
            <button type="button" onClick={signOut} className="console-key h-8 px-3 text-sm flex items-center gap-1.5">
              <LogOut size={13} /> Sair
            </button>
          </div>
        </div>
        <Dashboard me={me} reload={load} />
      </div>
    );
  }

  return <AccessStage>{body}</AccessStage>;
}
