import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Laptop,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  UserCheck,
  Users,
} from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import BarChart from '@/components/admin/BarChart';
import {
  adminApi,
  dateTime,
  FEATURE_LABELS,
  money,
  num,
  relative,
} from '@/components/admin/adminApi';
import type {
  FeatureUse,
  InsightsData,
  Overview,
  SubscriberInsight,
  SuspiciousInsight,
  TrialInsight,
} from '@/components/admin/adminApi';
import { btnDanger, btnGhost, btnPrimary, Empty, ErrorBox, Kpi, Loading, Panel, PeriodPicker } from '@/components/admin/ui';

function EmailStatusBadge({ confirmedAt }: { confirmedAt: string | null | undefined }) {
  if (confirmedAt) {
    return (
      <span
        title={`E-mail confirmado em ${dateTime(confirmedAt)}`}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-logic-lcd-green/10 text-logic-lcd-green border border-logic-lcd-green/25 w-fit mt-1"
      >
        <CheckCircle2 size={10} className="shrink-0" />
        <span>Confirmado: {dateTime(confirmedAt)}</span>
      </span>
    );
  }
  return (
    <span
      title="Aguardando confirmação do e-mail"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-logic-lcd-amber/10 text-logic-lcd-amber border border-logic-lcd-amber/25 w-fit mt-1"
    >
      <AlertTriangle size={10} className="shrink-0" />
      <span>E-mail não confirmado</span>
    </span>
  );
}

const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

type ViewSection = 'subscribers' | 'trials' | 'suspicious' | 'analytics';

export default function OverviewTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [usage, setUsage] = useState<FeatureUse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<ViewSection>('subscribers');
  const [searchTerm, setSearchTerm] = useState('');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const load = async (d = days) => {
    setLoading(true);
    setError(null);
    try {
      const [o, u, ins] = await Promise.all([
        adminApi.overview(d),
        adminApi.featureUsage(d),
        adminApi.insights().catch((err) => {
          console.warn('adminApi.insights fallback:', err);
          return null;
        }),
      ]);
      setData(o);
      setUsage(u);
      setInsights(ins);
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(days);
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleExtendTrial = async (userId: string, hours: number) => {
    setActionBusyId(userId);
    try {
      await adminApi.extendInsightTrial(userId, hours);
      await load(days);
    } catch (err) {
      alert(friendlyError(err));
    } finally {
      setActionBusyId(null);
    }
  };

  const handleBlockUser = async (userId: string, email: string) => {
    const reason = window.prompt(`Digite o motivo para suspender a conta ${email}:`, 'Suspeita de burla de teste gratuito');
    if (!reason) return;
    setActionBusyId(userId);
    try {
      await adminApi.blockInsightUser(userId, reason);
      await load(days);
    } catch (err) {
      alert(friendlyError(err));
    } finally {
      setActionBusyId(null);
    }
  };

  const handleUnblockUser = async (userId: string) => {
    if (!window.confirm('Deseja reativar esta conta?')) return;
    setActionBusyId(userId);
    try {
      await adminApi.unblockInsightUser(userId);
      await load(days);
    } catch (err) {
      alert(friendlyError(err));
    } finally {
      setActionBusyId(null);
    }
  };

  const conversion = data && data.total_users ? Math.round((data.active / data.total_users) * 1000) / 10 : 0;
  const topUsage = usage.filter((u) => u.feature !== 'app_open').slice(0, 6);
  const maxUse = Math.max(1, ...topUsage.map((u) => u.uses));

  const filterText = searchTerm.trim().toLowerCase();
  const filteredSubscribers = (insights?.subscribers || []).filter(
    (s) =>
      !filterText ||
      s.email.toLowerCase().includes(filterText) ||
      (s.name && s.name.toLowerCase().includes(filterText)) ||
      (s.lastIp && s.lastIp.includes(filterText)) ||
      (s.phone && s.phone.includes(filterText))
  );

  const filteredTrials = (insights?.trials || []).filter(
    (t) =>
      !filterText ||
      t.email.toLowerCase().includes(filterText) ||
      (t.name && t.name.toLowerCase().includes(filterText)) ||
      (t.lastIp && t.lastIp.includes(filterText)) ||
      (t.phone && t.phone.includes(filterText))
  );

  const filteredSuspicious = (insights?.suspicious || []).filter(
    (s) =>
      !filterText ||
      s.email.toLowerCase().includes(filterText) ||
      (s.name && s.name.toLowerCase().includes(filterText)) ||
      (s.lastIp && s.lastIp.includes(filterText)) ||
      s.reason.toLowerCase().includes(filterText)
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <span>Visão Geral & Central de Operações</span>
            <span className="px-2 py-0.5 rounded text-2xs font-extrabold bg-logic-lcd-green/15 text-logic-lcd-green border border-logic-lcd-green/30">
              AO VIVO
            </span>
          </h2>
          <p className="text-xs text-logic-text-dim mt-0.5">
            Monitoramento de assinantes ativos, testes de 48h, antifraude e saúde do ecossistema.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker value={days} onChange={setDays} />
          <button type="button" className={btnGhost} onClick={() => load()} aria-label="Atualizar" title="Atualizar dados">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <ErrorBox text={error} />}
      {!data && loading && <Loading />}

      {data && (
        <>
          {/* KPIs Principais em Destaque */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div
              onClick={() => setActiveSection('subscribers')}
              className="cursor-pointer bg-logic-bg-panel hover:bg-logic-bg-panel-light border border-logic-border hover:border-logic-lcd-green/50 rounded-xl p-4 transition-all"
            >
              <div className="flex items-center justify-between">
                <p className="text-2xs font-semibold tracking-wider text-logic-text-muted uppercase">Receita (MRR)</p>
                <CreditCard size={14} className="text-logic-lcd-green" />
              </div>
              <p className="text-2xl font-black tabular-nums mt-1 text-logic-lcd-green">{money(data.mrr_cents)}</p>
              <p className="text-2xs text-logic-text-dim mt-1">
                {num(data.monthly)} mensais · {num(data.yearly)} anuais
              </p>
            </div>

            <div
              onClick={() => setActiveSection('subscribers')}
              className="cursor-pointer bg-logic-bg-panel hover:bg-logic-bg-panel-light border border-logic-border hover:border-logic-lcd-green/50 rounded-xl p-4 transition-all"
            >
              <div className="flex items-center justify-between">
                <p className="text-2xs font-semibold tracking-wider text-logic-text-muted uppercase">Assinantes Ativos</p>
                <UserCheck size={14} className="text-logic-lcd-green" />
              </div>
              <p className="text-2xl font-black tabular-nums mt-1 text-white">
                {num(insights?.stats.subscribersCount ?? data.active)}
              </p>
              <p className="text-2xs text-logic-lcd-green font-bold mt-1">
                {conversion}% de conversão do total
              </p>
            </div>

            <div
              onClick={() => setActiveSection('trials')}
              className="cursor-pointer bg-logic-bg-panel hover:bg-logic-bg-panel-light border border-logic-border hover:border-logic-lcd-amber/50 rounded-xl p-4 transition-all"
            >
              <div className="flex items-center justify-between">
                <p className="text-2xs font-semibold tracking-wider text-logic-text-muted uppercase">Em Teste Grátis (48h)</p>
                <Clock size={14} className="text-logic-lcd-amber" />
              </div>
              <p className="text-2xl font-black tabular-nums mt-1 text-logic-lcd-amber">
                {num(insights?.stats.trialsCount ?? data.trial)}
              </p>
              <p className="text-2xs text-logic-text-dim mt-1">
                {num(data.expired)} com teste já finalizado
              </p>
            </div>

            <div
              onClick={() => setActiveSection('suspicious')}
              className={`cursor-pointer bg-logic-bg-panel hover:bg-logic-bg-panel-light border rounded-xl p-4 transition-all ${
                (insights?.stats.suspiciousCount ?? 0) > 0
                  ? 'border-logic-lcd-red/40 hover:border-logic-lcd-red bg-logic-lcd-red/5'
                  : 'border-logic-border hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-2xs font-semibold tracking-wider text-logic-text-muted uppercase">Antifraude / Suspeitos</p>
                <ShieldAlert
                  size={14}
                  className={(insights?.stats.suspiciousCount ?? 0) > 0 ? 'text-logic-lcd-red animate-pulse' : 'text-logic-text-muted'}
                />
              </div>
              <p
                className={`text-2xl font-black tabular-nums mt-1 ${
                  (insights?.stats.suspiciousCount ?? 0) > 0 ? 'text-logic-lcd-red' : 'text-white'
                }`}
              >
                {num(insights?.stats.suspiciousCount ?? 0)}
              </p>
              <p className="text-2xs text-logic-text-dim mt-1">
                {(insights?.stats.suspiciousCount ?? 0) > 0 ? 'Requer atenção imediata' : 'Nenhuma suspeita detectada'}
              </p>
            </div>
          </div>

          {/* Abas e Filtros da Visão Geral */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-white/[0.08]">
            {/* Seletor de visualização */}
            <div className="flex p-1 bg-black/40 rounded-xl border border-white/10 gap-1 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveSection('subscribers')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                  activeSection === 'subscribers'
                    ? 'bg-logic-lcd-green text-black shadow'
                    : 'text-logic-text-dim hover:text-white'
                }`}
              >
                <UserCheck size={14} />
                <span>Assinantes Ativos</span>
                <span className="px-1.5 py-0.2 rounded-full text-2xs bg-black/20 text-current font-extrabold">
                  {insights?.stats.subscribersCount ?? data.active}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('trials')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                  activeSection === 'trials'
                    ? 'bg-logic-lcd-amber text-black shadow'
                    : 'text-logic-text-dim hover:text-white'
                }`}
              >
                <Clock size={14} />
                <span>Em Teste Grátis (48h)</span>
                <span className="px-1.5 py-0.2 rounded-full text-2xs bg-black/20 text-current font-extrabold">
                  {insights?.stats.trialsCount ?? data.trial}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('suspicious')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                  activeSection === 'suspicious'
                    ? 'bg-logic-lcd-red text-white shadow'
                    : 'text-logic-text-dim hover:text-white'
                }`}
              >
                <ShieldAlert size={14} />
                <span>Contas Suspeitas & Antifraude</span>
                <span className={`px-1.5 py-0.2 rounded-full text-2xs font-extrabold ${
                  (insights?.stats.suspiciousCount ?? 0) > 0 ? 'bg-logic-lcd-red text-white' : 'bg-white/10'
                }`}>
                  {insights?.stats.suspiciousCount ?? 0}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSection('analytics')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                  activeSection === 'analytics'
                    ? 'bg-logic-accent text-white shadow'
                    : 'text-logic-text-dim hover:text-white'
                }`}
              >
                <Sparkles size={14} />
                <span>Métricas & Gráficos</span>
              </button>
            </div>

            {/* Barra de Busca rápida */}
            {activeSection !== 'analytics' && (
              <div className="relative min-w-[240px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por e-mail, nome ou IP..."
                  className="w-full bg-[#0a0b0f] text-xs text-white pl-8 pr-3 h-9 rounded-xl border border-white/15 outline-none focus:border-logic-lcd-green transition-colors placeholder:text-logic-text-muted"
                />
              </div>
            )}
          </div>

          {/* ============================================================== */}
          {/* SEÇÃO 1: LISTA DE CONTAS ATIVAS COM ASSINATURAS                */}
          {/* ============================================================== */}
          {activeSection === 'subscribers' && (
            <Panel
              title={
                <div className="flex items-center gap-2 text-white">
                  <UserCheck size={14} className="text-logic-lcd-green" />
                  <span>Assinantes com Pagamento Ativo ({filteredSubscribers.length})</span>
                </div>
              }
            >
              {filteredSubscribers.length === 0 ? (
                <Empty text="Nenhum assinante ativo encontrado com os critérios de busca." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.02] text-2xs uppercase tracking-wider text-logic-text-muted font-bold">
                        <th className="py-3 px-4">Assinante / Contato</th>
                        <th className="py-3 px-4">Plano & Valor</th>
                        <th className="py-3 px-4">Tempo Restante / Renovação</th>
                        <th className="py-3 px-4">IP do Computador</th>
                        <th className="py-3 px-4">Versão do App</th>
                        <th className="py-3 px-4">Último Acesso</th>
                        <th className="py-3 px-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredSubscribers.map((sub) => (
                        <tr key={sub.userId} className="hover:bg-white/[0.02] transition">
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-white text-[13px] flex items-center gap-1.5">
                                {sub.name || 'Sem nome informado'}
                              </span>
                              <span className="text-2xs text-logic-text-dim flex items-center gap-1 mt-0.5">
                                {sub.email}
                              </span>
                              <EmailStatusBadge confirmedAt={sub.emailConfirmedAt} />
                              {sub.phone && (
                                <a
                                  href={`https://wa.me/${sub.phone.replace(/\D/g, '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-logic-lcd-green hover:underline flex items-center gap-1 mt-1 font-semibold"
                                >
                                  <MessageCircle size={11} />
                                  <span>{sub.phone}</span>
                                </a>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-2xs font-extrabold bg-logic-lcd-green/15 text-logic-lcd-green border border-logic-lcd-green/30">
                              {sub.plan === 'yearly' ? 'Plano Anual' : 'Plano Mensal'}
                            </span>
                            <div className="text-2xs text-white/90 font-bold mt-1">
                              {sub.priceFormatted}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="font-bold text-logic-lcd-green text-xs flex items-center gap-1">
                                <CheckCircle2 size={13} />
                                {sub.renewalText}
                              </span>
                              {sub.currentPeriodEnd && (
                                <span className="text-2xs text-logic-text-dim mt-0.5">
                                  Vencimento: {dateTime(sub.currentPeriodEnd)}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {sub.lastIp ? (
                              <button
                                type="button"
                                onClick={() => handleCopy(sub.lastIp!)}
                                title="Clique para copiar o IP"
                                className="font-mono text-2xs bg-black/40 hover:bg-black/60 border border-white/10 px-2 py-1 rounded text-white flex items-center gap-1.5 transition"
                              >
                                <span>{sub.lastIp}</span>
                                <Copy size={10} className="text-logic-text-muted" />
                              </button>
                            ) : (
                              <span className="text-2xs text-logic-text-muted italic">Em captura</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-2xs font-mono font-bold bg-white/[0.05] border border-white/10 text-white">
                              {sub.lastAppVersion}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap text-2xs text-logic-text-dim">
                            {relative(sub.lastSeenAt)}
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {sub.stripeCustomerId && (
                                <a
                                  href={`https://dashboard.stripe.com/customers/${sub.stripeCustomerId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-white text-2xs font-bold transition flex items-center gap-1 border border-white/10"
                                >
                                  <CreditCard size={11} />
                                  <span>Stripe</span>
                                  <ExternalLink size={10} />
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => handleBlockUser(sub.userId, sub.email)}
                                disabled={actionBusyId === sub.userId}
                                title="Suspender conta do assinante"
                                className="p-1 rounded-lg text-logic-lcd-red hover:bg-logic-lcd-red/15 transition"
                              >
                                <Ban size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {/* ============================================================== */}
          {/* SEÇÃO 2: LISTA DE CONTAS EM TESTE GRÁTIS (TRIAL 48H)           */}
          {/* ============================================================== */}
          {activeSection === 'trials' && (
            <Panel
              title={
                <div className="flex items-center gap-2 text-white">
                  <Clock size={14} className="text-logic-lcd-amber" />
                  <span>Contas em Período de Teste Grátis ({filteredTrials.length})</span>
                </div>
              }
            >
              {filteredTrials.length === 0 ? (
                <Empty text="Nenhuma conta ativa em teste no momento." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.02] text-2xs uppercase tracking-wider text-logic-text-muted font-bold">
                        <th className="py-3 px-4">Usuário em Teste</th>
                        <th className="py-3 px-4">Tempo Restante (48h)</th>
                        <th className="py-3 px-4">Período de Teste</th>
                        <th className="py-3 px-4">IP do Computador</th>
                        <th className="py-3 px-4">Versão</th>
                        <th className="py-3 px-4">Último Acesso</th>
                        <th className="py-3 px-4 text-right">Ações Rápidas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredTrials.map((tr) => (
                        <tr key={tr.userId} className="hover:bg-white/[0.02] transition">
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-white text-[13px]">{tr.name || 'Sem nome informado'}</span>
                              <span className="text-2xs text-logic-text-dim mt-0.5">{tr.email}</span>
                              <EmailStatusBadge confirmedAt={tr.emailConfirmedAt} />
                              {tr.phone && (
                                <a
                                  href={`https://wa.me/${tr.phone.replace(/\D/g, '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-logic-lcd-green hover:underline flex items-center gap-1 mt-1 font-semibold"
                                >
                                  <MessageCircle size={11} />
                                  <span>{tr.phone}</span>
                                </a>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap min-w-[180px]">
                            <div className="space-y-1.5">
                              <span
                                className={`px-2 py-0.5 rounded text-2xs font-extrabold flex items-center gap-1 w-fit ${
                                  tr.hoursRemaining <= 12
                                    ? 'bg-logic-lcd-amber/20 text-logic-lcd-amber border border-logic-lcd-amber/30'
                                    : 'bg-logic-lcd-green/15 text-logic-lcd-green border border-logic-lcd-green/30'
                                }`}
                              >
                                <Clock size={11} />
                                {tr.timeLeftText}
                              </span>
                              <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden border border-white/10">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    tr.percentUsed > 80 ? 'bg-logic-lcd-amber' : 'bg-logic-lcd-green'
                                  }`}
                                  style={{ width: `${tr.percentUsed}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-logic-text-muted">
                                {tr.percentUsed}% do teste decorrido
                              </span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap text-2xs text-logic-text-dim">
                            <div>Iniciou: {dateTime(tr.trialStartedAt)}</div>
                            <div className="text-white font-medium mt-0.5">Expira: {dateTime(tr.trialEndsAt)}</div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {tr.lastIp ? (
                              <button
                                type="button"
                                onClick={() => handleCopy(tr.lastIp!)}
                                title="Clique para copiar o IP"
                                className="font-mono text-2xs bg-black/40 hover:bg-black/60 border border-white/10 px-2 py-1 rounded text-white flex items-center gap-1.5 transition"
                              >
                                <span>{tr.lastIp}</span>
                                <Copy size={10} className="text-logic-text-muted" />
                              </button>
                            ) : (
                              <span className="text-2xs text-logic-text-muted italic">Em captura</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-2xs font-mono font-bold bg-white/[0.05] border border-white/10 text-white">
                              {tr.lastAppVersion}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap text-2xs text-logic-text-dim">
                            {relative(tr.lastSeenAt)}
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleExtendTrial(tr.userId, 24)}
                                disabled={actionBusyId === tr.userId}
                                title="Dar mais 24 horas de teste"
                                className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-bold text-logic-lcd-green border border-logic-lcd-green/30 transition flex items-center gap-1"
                              >
                                <Plus size={11} />
                                <span>+24h</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleExtendTrial(tr.userId, 48)}
                                disabled={actionBusyId === tr.userId}
                                title="Dar mais 48 horas de teste"
                                className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-bold text-logic-lcd-amber border border-logic-lcd-amber/30 transition flex items-center gap-1"
                              >
                                <Plus size={11} />
                                <span>+48h</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleBlockUser(tr.userId, tr.email)}
                                disabled={actionBusyId === tr.userId}
                                title="Bloquear conta"
                                className="p-1 rounded-lg text-logic-lcd-red hover:bg-logic-lcd-red/15 transition ml-1"
                              >
                                <Ban size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {/* ============================================================== */}
          {/* SEÇÃO 3: CENTRAL ANTIFRAUDE & CONTAS SUSPEITAS                 */}
          {/* ============================================================== */}
          {activeSection === 'suspicious' && (
            <Panel
              title={
                <div className="flex items-center gap-2 text-white">
                  <ShieldAlert size={14} className="text-logic-lcd-red" />
                  <span>Central de Detecção de Fraude e Burlas ({filteredSuspicious.length})</span>
                </div>
              }
            >
              {/* Card Educativo do Antifraude */}
              <div className="p-4 bg-logic-lcd-red/10 border-b border-logic-lcd-red/20 text-xs text-logic-text-dim flex items-start gap-3">
                <ShieldAlert size={18} className="text-logic-lcd-red shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-white text-xs">Proteção Automática de Receita & Burlas de Teste</p>
                  <p className="leading-relaxed text-2xs">
                    O sistema analisa automaticamente os IPs das máquinas, domínios de e-mails descartáveis e tentativas de criar múltiplas contas para duplicar as 48 horas gratuitas.
                  </p>
                </div>
              </div>

              {filteredSuspicious.length === 0 ? (
                <div className="p-10 text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-logic-lcd-green/15 text-logic-lcd-green border border-logic-lcd-green/30 flex items-center justify-center mx-auto">
                    <ShieldCheck size={24} />
                  </div>
                  <h3 className="text-sm font-bold text-white">Nenhuma atividade suspeita detectada</h3>
                  <p className="text-xs text-logic-text-dim max-w-md mx-auto">
                    Todas as contas em teste e assinantes estão operando dentro dos parâmetros de segurança normais.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.02] text-2xs uppercase tracking-wider text-logic-text-muted font-bold">
                        <th className="py-3 px-4">Nível de Risco</th>
                        <th className="py-3 px-4">Conta Analisada</th>
                        <th className="py-3 px-4">Diagnóstico da Suspeita</th>
                        <th className="py-3 px-4">IP Registrado</th>
                        <th className="py-3 px-4">Data do Cadastro</th>
                        <th className="py-3 px-4 text-right">Ação Imediata</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredSuspicious.map((sus, idx) => (
                        <tr key={idx} className="hover:bg-white/[0.02] transition">
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded text-2xs font-extrabold flex items-center gap-1 w-fit ${
                                sus.riskLevel === 'alto'
                                  ? 'bg-logic-lcd-red/20 text-logic-lcd-red border border-logic-lcd-red/40'
                                  : 'bg-logic-lcd-amber/20 text-logic-lcd-amber border border-logic-lcd-amber/40'
                              }`}
                            >
                              <AlertTriangle size={11} />
                              <span>{sus.riskLevel === 'alto' ? 'Risco Alto' : 'Risco Médio'}</span>
                            </span>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="font-bold text-white">{sus.name || 'Sem nome'}</div>
                            <div className="text-2xs text-logic-text-dim">{sus.email}</div>
                            <EmailStatusBadge confirmedAt={sus.emailConfirmedAt} />
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="font-medium text-white max-w-md leading-relaxed">
                              {sus.reason}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {sus.lastIp ? (
                              <button
                                type="button"
                                onClick={() => handleCopy(sus.lastIp!)}
                                className="font-mono text-2xs bg-black/40 hover:bg-black/60 border border-white/10 px-2 py-1 rounded text-white flex items-center gap-1.5 transition"
                              >
                                <span>{sus.lastIp}</span>
                                <Copy size={10} className="text-logic-text-muted" />
                              </button>
                            ) : (
                              <span className="text-2xs text-logic-text-muted">—</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap text-2xs text-logic-text-dim">
                            {dateTime(sus.createdAt)}
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            {sus.blocked ? (
                              <button
                                type="button"
                                onClick={() => handleUnblockUser(sus.userId)}
                                disabled={actionBusyId === sus.userId}
                                className="px-3 py-1.5 rounded-lg bg-logic-lcd-green/15 hover:bg-logic-lcd-green/25 text-logic-lcd-green border border-logic-lcd-green/30 text-xs font-bold transition flex items-center gap-1 ml-auto"
                              >
                                <Unlock size={12} />
                                <span>Reativar Conta</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleBlockUser(sus.userId, sus.email)}
                                disabled={actionBusyId === sus.userId}
                                className="px-3 py-1.5 rounded-lg bg-logic-lcd-red/20 hover:bg-logic-lcd-red/30 text-logic-lcd-red border border-logic-lcd-red/40 text-xs font-bold transition flex items-center gap-1 ml-auto"
                              >
                                <Ban size={12} />
                                <span>Bloquear Imediatamente</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {/* ============================================================== */}
          {/* SEÇÃO 4: MÉTRICAS & GRÁFICOS DIÁRIOS                           */}
          {/* ============================================================== */}
          {activeSection === 'analytics' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi
                  label={`Vendas em ${data.days} dias`}
                  value={num(data.subs_period)}
                  hint={`${money(data.revenue_period_cents)} em novas assinaturas`}
                />
                <Kpi
                  label={`Cancelamentos em ${data.days} dias`}
                  value={num(data.cancels_period)}
                  accent={data.cancels_period ? 'text-logic-lcd-amber' : undefined}
                />
                <Kpi label={`Cadastros em ${data.days} dias`} value={num(data.signups_period)} />
                <Kpi
                  label={`Usaram o programa em ${data.days} dias`}
                  value={num(data.active_users_period)}
                  hint="contas diferentes ativas"
                />
              </div>

              <div className="grid lg:grid-cols-3 gap-3">
                <BarChart
                  title="Novas assinaturas por dia"
                  color="#30d158"
                  data={data.series.map((s) => ({ label: shortDay(s.day), value: s.subs }))}
                />
                <BarChart
                  title="Cadastros por dia"
                  color="#0a84ff"
                  data={data.series.map((s) => ({ label: shortDay(s.day), value: s.signups }))}
                />
                <BarChart
                  title="Contas ativas por dia"
                  color="#ff9f0a"
                  data={data.series.map((s) => ({ label: shortDay(s.day), value: s.active_users }))}
                />
              </div>

              <div className="grid lg:grid-cols-2 gap-3">
                <Panel title="Funções mais usadas">
                  {topUsage.length === 0 ? (
                    <Empty text="Ainda não há uso registrado neste período." />
                  ) : (
                    <ul className="p-4 space-y-2.5">
                      {topUsage.map((u) => (
                        <li key={u.feature}>
                          <div className="flex justify-between text-xs mb-1">
                            <span>{FEATURE_LABELS[u.feature] ?? u.feature}</span>
                            <span className="text-logic-text-dim tabular-nums">
                              {num(u.uses)} usos · {num(u.users)} contas
                            </span>
                          </div>
                          <div className="h-2 rounded bg-logic-bg-deep overflow-hidden">
                            <div className="h-full rounded bg-logic-accent" style={{ width: `${(u.uses / maxUse) * 100}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title="Últimas vendas confirmadas">
                  {data.recent_sales.length === 0 ? (
                    <Empty text="Nenhuma venda concluída ainda." />
                  ) : (
                    <ul className="divide-y divide-logic-border">
                      {data.recent_sales.map((s, i) => (
                        <li key={i} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                          <span className="px-1.5 h-5 rounded text-2xs font-bold flex items-center bg-logic-lcd-green/15 text-logic-lcd-green">
                            VENDA
                          </span>
                          <span className="flex-1 min-w-0 truncate">
                            {s.name ? <span className="font-medium text-white">{s.name} </span> : null}
                            <span className="text-logic-text-dim">{s.email}</span>
                          </span>
                          <span className="text-logic-text-dim">
                            {money(s.amount_cents)} · {s.plan === 'yearly' ? 'Anual' : 'Mensal'}
                          </span>
                          <span className="text-logic-text-muted tabular-nums w-24 text-right">
                            {dateTime(s.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </div>
          )}
        </>
      )}

      {copiedText && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#14151b] border border-logic-lcd-green/50 text-logic-lcd-green px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-[fadeIn_150ms_ease-out]">
          <Check size={14} />
          <span>IP copiado com sucesso!</span>
        </div>
      )}
    </div>
  );
}
