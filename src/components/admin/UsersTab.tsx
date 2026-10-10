import { useEffect, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Clock, CreditCard, ExternalLink, Gift, RefreshCw, Search, ShieldCheck, Trash2, Unlock, X } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, dateTime, num, relative, STATE_CLS, STATE_LABEL } from '@/components/admin/adminApi';
import type { AdminUser, UserState } from '@/components/admin/adminApi';
import { btnDanger, btnGhost, btnPrimary, Empty, ErrorBox, input, Loading, Panel } from '@/components/admin/ui';

const PAGE = 50;
const FILTERS: Array<{ id: '' | UserState; label: string }> = [
  { id: '', label: 'Todos' },
  { id: 'active', label: 'Assinantes' },
  { id: 'trial', label: 'Em teste' },
  { id: 'expired', label: 'Teste encerrado' },
  { id: 'promo', label: 'Bônus' },
  { id: 'blocked', label: 'Suspensos' },
];

function StateBadge({ state }: { state: UserState }) {
  return <span className={`px-1.5 h-5 rounded text-2xs font-bold inline-flex items-center whitespace-nowrap ${STATE_CLS[state]}`}>{STATE_LABEL[state]}</span>;
}

function accessUntil(u: AdminUser) {
  if (u.state === 'active') return u.current_period_end ? `renova ${dateTime(u.current_period_end)}` : 'assinatura manual';
  if (u.state === 'promo') return `bônus até ${dateTime(u.comp_until)}`;
  if (u.state === 'trial') return `teste até ${dateTime(u.trial_ends_at)}`;
  if (u.state === 'expired') return `acabou ${relative(u.trial_ends_at)}`;
  return u.blocked_reason ? `motivo: ${u.blocked_reason}` : 'suspensa';
}

/** Quanto tempo falta (ou já passou) até uma data, em dias+horas — o dado que o admin
 * precisa pra decidir, na hora, se estende o teste e quanto, sem fazer conta de cabeça. */
function timeLeftParts(iso: string | null | undefined): { expired: boolean; days: number; hours: number } | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400e3);
  const hours = Math.floor((abs % 86400e3) / 3600e3);
  return { expired: diff < 0, days, hours };
}

function timeLeftText(iso: string | null | undefined): string {
  const t = timeLeftParts(iso);
  if (!t) return '—';
  const span = t.days > 0 ? `${t.days} ${t.days === 1 ? 'dia' : 'dias'}${t.hours > 0 ? ` e ${t.hours}h` : ''}` : `${t.hours}h`;
  return t.expired ? `encerrado há ${span}` : `faltam ${span}`;
}

/** Barra de 0 a 100% do prazo de teste já consumido, pra ver de cara quanto já passou. */
function trialPercentUsed(u: AdminUser): number | null {
  if (!u.trial_started_at || !u.trial_hours) return null;
  const startedAt = new Date(u.trial_started_at).getTime();
  const totalMs = u.trial_hours * 3600e3;
  if (totalMs <= 0) return null;
  const elapsed = Date.now() - startedAt;
  return Math.min(100, Math.max(0, (elapsed / totalMs) * 100));
}

/** Trial grátis em teste: mostra o prazo que importa pro admin decidir dar mais ou tirar,
 * com uma barra de 0 a 100% do tempo de teste já consumido. */
function TrialCountdown({ user }: { user: AdminUser }) {
  if (user.state !== 'trial' && user.state !== 'expired') return null;
  const t = timeLeftParts(user.trial_ends_at);
  if (!t) return null;
  const pct = trialPercentUsed(user);
  const cls = t.expired ? 'bg-logic-lcd-red/15 text-logic-lcd-red border-logic-lcd-red/30' : 'bg-logic-lcd-green/15 text-logic-lcd-green border-logic-lcd-green/30';
  const barCls = t.expired ? 'bg-logic-lcd-red' : pct !== null && pct > 80 ? 'bg-logic-lcd-amber' : 'bg-logic-lcd-green';
  return (
    <div className={`mt-3 px-3 py-2 rounded-lg border text-xs font-semibold ${cls}`}>
      <div className="flex items-center gap-2">
        <Clock size={13} />
        Teste grátis: {timeLeftText(user.trial_ends_at)}
      </div>
      {pct !== null && (
        <>
          <div className="mt-2 h-1.5 rounded-full bg-black/20 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-2xs font-normal opacity-80">{Math.round(pct)}% do prazo já consumido</div>
        </>
      )}
    </div>
  );
}

/** Bônus de acesso completo: mesma lógica, pra quem já recebeu dias de cortesia. */
function CompCountdown({ user }: { user: AdminUser }) {
  if (!user.comp_until) return null;
  const t = timeLeftParts(user.comp_until);
  if (!t) return null;
  const cls = t.expired ? 'bg-logic-text-muted/15 text-logic-text-muted border-logic-border' : 'bg-logic-lcd-yellow/15 text-logic-lcd-yellow border-logic-lcd-yellow/30';
  return (
    <div className={`mt-2 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-2 ${cls}`}>
      <Gift size={13} />
      Bônus: {timeLeftText(user.comp_until)}
    </div>
  );
}

export default function UsersTab() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'' | UserState>('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => { setQuery(search.trim()); setPage(0); }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.users(query, state, PAGE, page * PAGE);
      setRows(res.rows);
      setTotal(res.total);
      setSelected((s) => (s ? res.rows.find((r) => r.id === s.id) ?? s : s));
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [query, state, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Usuários e assinaturas</h2>
        <p className="text-xs text-logic-text-dim">Aumente o prazo de teste, dê bônus, ative assinaturas manuais ou derrube contas.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72 max-w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted pointer-events-none" />
          <input className={`${input} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou e-mail" />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id} type="button" onClick={() => { setState(f.id); setPage(0); }}
              className={`px-2.5 h-8 rounded-md text-2xs font-semibold transition ${state === f.id ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-muted hover:text-logic-text'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className={`${btnGhost} ml-auto`} onClick={load} aria-label="Atualizar">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <ErrorBox text={error} />}

      <Panel>
        {loading && rows.length === 0 ? <Loading /> : rows.length === 0 ? <Empty text="Nenhuma conta encontrada." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wider text-logic-text-muted border-b border-logic-border">
                  <th className="px-4 py-2.5 font-semibold">Conta</th>
                  <th className="px-3 py-2.5 font-semibold">Situação</th>
                  <th className="px-3 py-2.5 font-semibold">Plano</th>
                  <th className="px-3 py-2.5 font-semibold">Acesso</th>
                  <th className="px-3 py-2.5 font-semibold">Último uso</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Usos 30d</th>
                  <th className="px-4 py-2.5 font-semibold">Cadastro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-logic-border/60">
                {rows.map((u) => (
                  <tr
                    key={u.id} onClick={() => setSelected(u)}
                    className={`cursor-pointer transition-colors hover:bg-logic-bg-elevated/50 ${selected?.id === u.id ? 'bg-logic-bg-elevated/60' : ''}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium flex items-center gap-1.5">
                        {u.name || <span className="text-logic-text-muted">Sem nome</span>}
                        {u.is_admin && <ShieldCheck size={12} className="text-logic-accent" aria-label="Administrador" />}
                      </div>
                      <div className="text-logic-text-dim">{u.email}</div>
                    </td>
                    <td className="px-3 py-2.5"><StateBadge state={u.state} /></td>
                    <td className="px-3 py-2.5 text-logic-text-dim">{u.state === 'active' ? (u.plan === 'yearly' ? 'Anual' : u.plan === 'monthly' ? 'Mensal' : 'Manual') : '—'}</td>
                    <td className="px-3 py-2.5 text-logic-text-dim whitespace-nowrap">{accessUntil(u)}</td>
                    <td className="px-3 py-2.5 text-logic-text-dim whitespace-nowrap">{relative(u.last_seen_at ?? u.last_sign_in_at)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(u.uses_30d)}</td>
                    <td className="px-4 py-2.5 text-logic-text-muted whitespace-nowrap">{dateTime(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="flex items-center justify-between px-4 h-10 border-t border-logic-border text-2xs text-logic-text-muted">
          <span>{num(total)} {total === 1 ? 'conta' : 'contas'}</span>
          <span className="flex items-center gap-2">
            <button type="button" className={btnGhost} disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior"><ChevronLeft size={13} /></button>
            {page + 1} / {pages}
            <button type="button" className={btnGhost} disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página"><ChevronRight size={13} /></button>
          </span>
        </footer>
      </Panel>

      {selected && <UserDrawer user={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function UserDrawer({ user, onClose, onChanged }: { user: AdminUser; onClose: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hours, setHours] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => { setMsg(null); setReason(''); }, [user.id]);

  const run = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      await onChanged();
      setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  const extend = (h: number) => run(`t${h}`, () => adminApi.extendTrial(user.id, h),
    h > 0 ? `Teste aumentado em ${h % 24 === 0 ? `${h / 24} dia(s)` : `${h}h`}.` : `Teste reduzido em ${-h}h.`);
  const comp = (d: number) => run(`c${d}`, () => adminApi.setComp(user.id, d), d > 0 ? `Bônus de ${d} dia(s) concedido.` : 'Bônus removido.');

  const blocked = user.state === 'blocked';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="w-[420px] max-w-full h-full bg-logic-bg-panel border-l border-logic-border-light shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Conta ${user.email}`}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between px-4 h-11 border-b border-logic-border bg-logic-bg-elevated">
          <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">CONTA</span>
          <button className="p-1 rounded hover:bg-logic-bg-panel-light" onClick={onClose} aria-label="Fechar"><X size={15} /></button>
        </header>

        <div className="p-5 space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">{user.name || 'Sem nome'}</h3>
              <StateBadge state={user.state} />
            </div>
            <p className="text-xs text-logic-text-dim">{user.email}</p>
            <TrialCountdown user={user} />
            <CompCountdown user={user} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-xs">
              <dt className="text-logic-text-muted">Cadastro</dt><dd>{dateTime(user.created_at)}</dd>
              <dt className="text-logic-text-muted">Último login</dt><dd>{dateTime(user.last_sign_in_at)}</dd>
              <dt className="text-logic-text-muted">Último uso</dt><dd>{dateTime(user.last_seen_at)}</dd>
              <dt className="text-logic-text-muted">Teste até</dt><dd>{dateTime(user.trial_ends_at)}</dd>
              <dt className="text-logic-text-muted">Bônus até</dt><dd>{dateTime(user.comp_until)}</dd>
              <dt className="text-logic-text-muted">Assinou em</dt><dd>{dateTime(user.subscribed_at)}</dd>
              <dt className="text-logic-text-muted">Renovação</dt><dd>{dateTime(user.current_period_end)}</dd>
              <dt className="text-logic-text-muted">Usos (30 dias)</dt><dd className="tabular-nums">{num(user.uses_30d)}</dd>
            </dl>
            {user.stripe_customer_id && (
              <a
                href={`https://dashboard.stripe.com/customers/${user.stripe_customer_id}`} target="_blank" rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-logic-accent-hover hover:underline"
              >
                <ExternalLink size={12} /> Ver no Stripe
              </a>
            )}
          </div>

          {msg && (
            <div className={`px-3 py-2 rounded-lg border text-xs ${msg.ok ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'}`}>
              {msg.text}
            </div>
          )}

          <Section icon={Clock} title="Prazo do teste grátis" hint="Soma ou tira dias a partir do fim atual do teste (ou de agora, se já acabou).">
            <div className="flex flex-wrap gap-1.5">
              <button className={btnGhost} disabled={!!busy} onClick={() => extend(-24)}>−1 dia</button>
              <button className={btnGhost} disabled={!!busy} onClick={() => extend(24)}>+1 dia</button>
              <button className={btnGhost} disabled={!!busy} onClick={() => extend(24 * 3)}>+3 dias</button>
              <button className={btnGhost} disabled={!!busy} onClick={() => extend(24 * 30)}>+30 dias</button>
            </div>
            <form className="flex gap-1.5 mt-2" onSubmit={(e) => { e.preventDefault(); const h = parseInt(hours, 10); if (h) extend(h); setHours(''); }}>
              <input className={input} type="number" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Horas (use negativo para reduzir)" />
              <button className={btnPrimary} disabled={!!busy || !parseInt(hours, 10)}>Aplicar</button>
            </form>
          </Section>

          <Section icon={Gift} title="Bônus de acesso completo" hint="Libera o programa como se fosse assinante, sem cobrança.">
            <div className="flex flex-wrap gap-1.5">
              {[7, 30, 90, 365].map((d) => (
                <button key={d} className={btnGhost} disabled={!!busy} onClick={() => comp(d)}>+{d} dias</button>
              ))}
              {user.comp_until && <button className={btnDanger} disabled={!!busy} onClick={() => comp(0)}>Remover bônus</button>}
            </div>
            <form className="flex gap-1.5 mt-2" onSubmit={(e) => { e.preventDefault(); const d = parseInt(days, 10); if (d > 0) comp(d); setDays(''); }}>
              <input className={input} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} placeholder="Dias" />
              <button className={btnPrimary} disabled={!!busy || !(parseInt(days, 10) > 0)}>Dar bônus</button>
            </form>
          </Section>

          <Section icon={CreditCard} title="Assinatura manual" hint="Para quem pagou por fora do Stripe (Pix, transferência). Assinaturas do Stripe são atualizadas sozinhas.">
            <div className="flex flex-wrap gap-1.5">
              {user.subscription !== 'active' ? (
                <>
                  <button className={btnGhost} disabled={!!busy} onClick={() => run('sm', () => adminApi.setSubscription(user.id, 'active', 'monthly'), 'Assinatura mensal ativada.')}>Ativar mensal</button>
                  <button className={btnGhost} disabled={!!busy} onClick={() => run('sy', () => adminApi.setSubscription(user.id, 'active', 'yearly'), 'Assinatura anual ativada.')}>Ativar anual</button>
                </>
              ) : (
                <button
                  className={btnDanger} disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`Cancelar a assinatura de ${user.email}? Se ela for do Stripe, cancele também no painel do Stripe para parar a cobrança.`)) return;
                    run('sc', () => adminApi.setSubscription(user.id, 'canceled'), 'Assinatura cancelada.');
                  }}
                >
                  Cancelar assinatura
                </button>
              )}
            </div>
          </Section>

          <Section icon={Ban} title={blocked ? 'Conta suspensa' : 'Derrubar usuário'} danger
            hint={blocked
              ? `Suspensa ${user.blocked_reason ? `— motivo: ${user.blocked_reason}` : ''}`
              : 'Tira a pessoa do programa na hora, encerra os logins abertos e impede de entrar de novo.'}
          >
            {blocked ? (
              <button className={btnPrimary} disabled={!!busy} onClick={() => run('ub', () => adminApi.block(user.id, false), 'Conta reativada.')}>
                <Unlock size={13} /> Reativar conta
              </button>
            ) : user.is_admin ? (
              <p className="text-xs text-logic-text-muted">Administradores não podem ser derrubados por aqui.</p>
            ) : (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!window.confirm(`Derrubar ${user.email}? A pessoa perde o acesso imediatamente.`)) return;
                  run('b', () => adminApi.block(user.id, true, reason), 'Usuário derrubado.');
                }}
              >
                <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (aparece para o usuário)" maxLength={200} />
                <button className={`${btnDanger} w-full`} disabled={!!busy}><Ban size={13} /> Derrubar usuário</button>
              </form>
            )}
          </Section>

          {!user.is_admin && (
            <Section icon={Trash2} title="Excluir conta" danger
              hint="Remove a conta por completo (login, licença, histórico). Ela some da lista e a pessoa pode se cadastrar de novo com o mesmo e-mail. Não dá pra desfazer."
            >
              <button
                className={`${btnDanger} w-full`} disabled={!!busy}
                onClick={() => {
                  if (window.prompt(`Pra confirmar, digite o e-mail da conta (${user.email}):`)?.trim().toLowerCase() !== user.email.toLowerCase()) return;
                  run('del', async () => { await adminApi.deleteUser(user.id); onClose(); }, 'Conta excluída.');
                }}
              >
                <Trash2 size={13} /> Excluir conta definitivamente
              </button>
            </Section>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ icon: Icon, title, hint, danger, children }: {
  icon: typeof Clock; title: string; hint?: string; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={`rounded-lg border p-4 ${danger ? 'border-logic-lcd-red/30 bg-logic-lcd-red/5' : 'border-logic-border bg-logic-bg-deep/40'}`}>
      <h4 className={`text-xs font-semibold flex items-center gap-1.5 ${danger ? 'text-logic-lcd-red' : ''}`}><Icon size={13} /> {title}</h4>
      {hint && <p className="text-2xs text-logic-text-muted mt-1 mb-3 leading-snug">{hint}</p>}
      {children}
    </section>
  );
}
