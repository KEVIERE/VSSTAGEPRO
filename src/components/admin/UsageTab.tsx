import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, FEATURE_LABELS, num } from '@/components/admin/adminApi';
import type { FeatureUse } from '@/components/admin/adminApi';
import { btnGhost, Empty, ErrorBox, Loading, Panel, PeriodPicker } from '@/components/admin/ui';

export default function UsageTab() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<FeatureUse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (d = days) => {
    setLoading(true);
    setError(null);
    try { setRows(await adminApi.featureUsage(d)); } catch (e) { setError(friendlyError((e as Error).message)); } finally { setLoading(false); }
  };
  useEffect(() => { load(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const opens = rows.find((r) => r.feature === 'app_open');
  const features = rows.filter((r) => r.feature !== 'app_open');
  const max = Math.max(1, ...features.map((r) => r.uses));
  const activeUsers = opens?.users ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Funções mais usadas</h2>
          <p className="text-xs text-logic-text-dim">
            {opens ? `${num(opens.uses)} aberturas do programa por ${num(opens.users)} contas no período.` : 'Quantas vezes cada função do programa foi usada.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker value={days} onChange={setDays} />
          <button type="button" className={btnGhost} onClick={() => load()} aria-label="Atualizar">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <ErrorBox text={error} />}

      <Panel>
        {loading && rows.length === 0 ? <Loading /> : features.length === 0 ? <Empty text="Ainda não há uso registrado neste período." /> : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wider text-logic-text-muted border-b border-logic-border">
                <th className="px-4 py-2.5 font-semibold w-8">#</th>
                <th className="px-3 py-2.5 font-semibold">Função</th>
                <th className="px-3 py-2.5 font-semibold w-[40%]">Usos</th>
                <th className="px-3 py-2.5 font-semibold text-right">Contas</th>
                <th className="px-4 py-2.5 font-semibold text-right">Alcance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-logic-border/60">
              {features.map((r, i) => (
                <tr key={r.feature}>
                  <td className="px-4 py-2.5 text-logic-text-muted tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5 font-medium">{FEATURE_LABELS[r.feature] ?? r.feature}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded bg-logic-bg-deep overflow-hidden">
                        <div className="h-full rounded bg-logic-accent" style={{ width: `${(r.uses / max) * 100}%` }} />
                      </div>
                      <span className="tabular-nums w-14 text-right">{num(r.uses)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.users)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-logic-text-dim">
                    {activeUsers ? `${Math.round((r.users / activeUsers) * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <p className="text-2xs text-logic-text-muted">Alcance = parte das contas que abriram o programa no período e usaram a função.</p>
    </div>
  );
}
