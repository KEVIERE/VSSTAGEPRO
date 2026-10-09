import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import BarChart from '@/components/admin/BarChart';
import { adminApi, dateTime, FEATURE_LABELS, money, num } from '@/components/admin/adminApi';
import type { FeatureUse, Overview } from '@/components/admin/adminApi';
import { btnGhost, Empty, ErrorBox, Kpi, Loading, Panel, PeriodPicker } from '@/components/admin/ui';

const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

export default function OverviewTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [usage, setUsage] = useState<FeatureUse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (d = days) => {
    setLoading(true);
    setError(null);
    try {
      const [o, u] = await Promise.all([adminApi.overview(d), adminApi.featureUsage(d)]);
      setData(o);
      setUsage(u);
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const conversion = data && data.total_users ? Math.round(((data.active) / data.total_users) * 1000) / 10 : 0;
  const topUsage = usage.filter((u) => u.feature !== 'app_open').slice(0, 6);
  const maxUse = Math.max(1, ...topUsage.map((u) => u.uses));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Visão geral</h2>
          <p className="text-xs text-logic-text-dim">Vendas de assinaturas, testes e uso do programa.</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker value={days} onChange={setDays} />
          <button type="button" className={btnGhost} onClick={() => load()} aria-label="Atualizar">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <ErrorBox text={error} />}
      {!data && loading && <Loading />}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Receita recorrente (MRR)" value={money(data.mrr_cents)} accent="text-logic-lcd-green"
              hint={`${num(data.monthly)} mensais · ${num(data.yearly)} anuais${data.manual ? ` · ${num(data.manual)} manuais` : ''}`} />
            <Kpi label="Assinantes ativos" value={num(data.active)} hint={`${conversion}% das contas`} />
            <Kpi label="Em teste grátis" value={num(data.trial)} hint={`${num(data.expired)} com teste encerrado`} />
            <Kpi label="Contas" value={num(data.total_users)}
              hint={`${num(data.promo)} com bônus · ${num(data.blocked)} suspensas`} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={`Vendas em ${data.days} dias`} value={num(data.subs_period)} hint={`${money(data.revenue_period_cents)} em novas assinaturas`} />
            <Kpi label={`Cancelamentos em ${data.days} dias`} value={num(data.cancels_period)}
              accent={data.cancels_period ? 'text-logic-lcd-amber' : undefined} />
            <Kpi label={`Cadastros em ${data.days} dias`} value={num(data.signups_period)} />
            <Kpi label={`Usaram o programa em ${data.days} dias`} value={num(data.active_users_period)} hint="contas diferentes" />
          </div>

          <div className="grid lg:grid-cols-3 gap-3">
            <BarChart title="Novas assinaturas por dia" color="#30d158"
              data={data.series.map((s) => ({ label: shortDay(s.day), value: s.subs }))} />
            <BarChart title="Cadastros por dia" color="#0a84ff"
              data={data.series.map((s) => ({ label: shortDay(s.day), value: s.signups }))} />
            <BarChart title="Contas ativas por dia" color="#ff9f0a"
              data={data.series.map((s) => ({ label: shortDay(s.day), value: s.active_users }))} />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <Panel title="Funções mais usadas">
              {topUsage.length === 0 ? <Empty text="Ainda não há uso registrado neste período." /> : (
                <ul className="p-4 space-y-2.5">
                  {topUsage.map((u) => (
                    <li key={u.feature}>
                      <div className="flex justify-between text-xs mb-1">
                        <span>{FEATURE_LABELS[u.feature] ?? u.feature}</span>
                        <span className="text-logic-text-dim tabular-nums">{num(u.uses)} usos · {num(u.users)} contas</span>
                      </div>
                      <div className="h-2 rounded bg-logic-bg-deep overflow-hidden">
                        <div className="h-full rounded bg-logic-accent" style={{ width: `${(u.uses / maxUse) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Últimas vendas e cancelamentos">
              {data.recent_sales.length === 0 ? <Empty text="Nenhuma venda ainda." /> : (
                <ul className="divide-y divide-logic-border">
                  {data.recent_sales.map((s, i) => (
                    <li key={i} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                      <span className={`px-1.5 h-5 rounded text-2xs font-bold flex items-center ${s.kind === 'subscribed' ? 'bg-logic-lcd-green/15 text-logic-lcd-green' : 'bg-logic-lcd-amber/15 text-logic-lcd-amber'}`}>
                        {s.kind === 'subscribed' ? 'VENDA' : 'CANCELOU'}
                      </span>
                      <span className="flex-1 min-w-0 truncate">
                        {s.name ? <span className="font-medium">{s.name} </span> : null}
                        <span className="text-logic-text-dim">{s.email}</span>
                      </span>
                      <span className="text-logic-text-dim">{s.plan === 'yearly' ? 'Anual' : s.plan === 'monthly' ? 'Mensal' : 'Manual'}</span>
                      <span className="text-logic-text-muted tabular-nums w-24 text-right">{dateTime(s.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
