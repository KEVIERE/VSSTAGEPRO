import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, dateTime } from '@/components/admin/adminApi';
import type { AuditEntry } from '@/components/admin/adminApi';
import { btnGhost, Empty, ErrorBox, Loading, Panel } from '@/components/admin/ui';

function describe(a: AuditEntry) {
  const d = (a.details ?? {}) as Record<string, string | number | null>;
  switch (a.action) {
    case 'extend_trial': return `${Number(d.hours) > 0 ? 'Aumentou' : 'Reduziu'} o teste em ${Math.abs(Number(d.hours))}h`;
    case 'set_comp': return Number(d.days) > 0 ? `Deu bônus de ${d.days} dia(s)` : 'Removeu o bônus';
    case 'set_subscription': return d.subscription === 'active' ? `Ativou assinatura ${d.plan === 'yearly' ? 'anual' : 'mensal'}` : 'Cancelou a assinatura';
    case 'block': return `Derrubou a conta${d.reason ? ` (${d.reason})` : ''}`;
    case 'unblock': return 'Reativou a conta';
    case 'promo_create': return `Criou o código ${d.code}`;
    case 'promo_enable': return `Ativou o código ${d.code}`;
    case 'promo_disable': return `Desativou o código ${d.code}`;
    case 'promo_delete': return `Apagou o código ${d.code}`;
    default: return a.action;
  }
}

export default function AuditTab() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setRows(await adminApi.audit()); } catch (e) { setError(friendlyError((e as Error).message)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Histórico da administração</h2>
        <p className="text-xs text-logic-text-dim">Tudo que foi feito neste painel, por quem e quando.</p>
      </div>
      {error && <ErrorBox text={error} />}
      <Panel
        title="Ações recentes"
        actions={<button type="button" className={btnGhost} onClick={load} aria-label="Atualizar"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>}
      >
        {loading && rows.length === 0 ? <Loading /> : rows.length === 0 ? <Empty text="Nenhuma ação registrada." /> : (
          <ul className="divide-y divide-logic-border">
            {rows.map((a, i) => (
              <li key={i} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-logic-text-muted tabular-nums w-28">{dateTime(a.created_at)}</span>
                <span className="font-medium">{describe(a)}</span>
                {a.target_email && <span className="text-logic-text-dim">→ {a.target_email}</span>}
                <span className="ml-auto text-2xs text-logic-text-muted">{a.admin_email ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
