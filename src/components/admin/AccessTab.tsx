import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, num, relative } from '@/components/admin/adminApi';
import type { AccessStats } from '@/components/admin/adminApi';
import BarChart from '@/components/admin/BarChart';
import { btnGhost, Empty, ErrorBox, Kpi, Loading, Panel, PeriodPicker } from '@/components/admin/ui';

const PAGE_LABELS: Record<string, string> = {
  sales: 'Página inicial',
  pricing: 'Planos',
  download: 'Baixar',
  subscribed: 'Assinatura concluída',
  musician: 'Área do músico',
  remote: 'VS Stage Remote',
  screen: 'Tela do palco',
  producer: 'Produtor',
  affiliate: 'Afiliados',
  recovery: 'Recuperar senha',
  director: 'Programa no navegador',
  outra: 'Outra',
};
const DEVICE_LABELS: Record<string, string> = { desktop: 'Computador', mobile: 'Celular', tablet: 'Tablet' };
const ARCH_LABELS: Record<string, string> = { arm64: 'Apple Silicon', x64: 'Intel', unknown: 'Versão antiga (sem informação)' };
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};
const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : '0%');

function peakLabel<T>(rows: T[], value: (r: T) => number, label: (r: T) => string) {
  if (rows.length === 0) return '–';
  const best = rows.reduce((a, b) => (value(b) > value(a) ? b : a));
  return value(best) > 0 ? `Pico: ${label(best)}` : '–';
}

/** Lista com barra proporcional, no visual dos medidores da mesa. */
function MeterList({ rows, empty }: { rows: Array<{ key: string; label: string; value: number; hint?: string }>; empty: string }) {
  if (rows.length === 0) return <Empty text={empty} />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="divide-y divide-logic-border/60">
      {rows.map((r) => (
        <li key={r.key} className="px-4 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-logic-text">{r.label}</span>
            <span className="shrink-0 tabular-nums text-logic-text-dim">
              {num(r.value)} <span className="text-logic-text-muted">· {pct(r.value, total)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-logic-bg-deep overflow-hidden">
            <div className="h-full rounded-full bg-logic-lcd-green/80" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          {r.hint && <p className="mt-1 text-2xs text-logic-text-muted">{r.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

export default function AccessTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AccessStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (d = days) => {
    setLoading(true);
    setError(null);
    try { setData(await adminApi.accessStats(d)); } catch (e) { setError(friendlyError((e as Error).message)); } finally { setLoading(false); }
  };
  useEffect(() => { load(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = data?.program;
  const s = data?.site;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Acessos</h2>
          <p className="text-xs text-logic-text-dim">Quem usa o programa e quem visita o site, por dia, semana e mês. Horário de Brasília.</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker value={days} onChange={setDays} />
          <button type="button" className={btnGhost} onClick={() => load()} aria-label="Atualizar">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <ErrorBox text={error} />}
      {loading && !data && <Loading />}

      {p && s && (
        <>
          {/* ─── Programa ─────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-2xs font-semibold tracking-widest text-logic-text-muted uppercase">Programa</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi
                label="Abertos agora"
                value={num(p.online_now)}
                accent={p.online_now ? 'text-logic-lcd-green' : undefined}
                hint={`${num(p.online_logged)} com conta entrada · sinal da última meia hora`}
              />
              <Kpi label="Hoje" value={num(p.users_today)} hint={`contas diferentes · ${num(p.opens_today)} aberturas`} />
              <Kpi label="Últimos 7 dias" value={num(p.users_7d)} hint={`contas diferentes · ${num(p.opens_7d)} aberturas`} />
              <Kpi label="Últimos 30 dias" value={num(p.users_30d)} hint={`contas diferentes · ${num(p.opens_30d)} aberturas`} />
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              <BarChart
                title={`Contas que usaram por dia (${data.days} dias)`}
                color="#ff9f0a"
                summary={`${num(p.users_period)} contas no período`}
                data={p.series.map((r) => ({ label: shortDay(r.day), value: r.users }))}
              />
              <BarChart
                title="Aberturas do programa por dia"
                color="#30d158"
                data={p.series.map((r) => ({ label: shortDay(r.day), value: r.opens }))}
              />
              <BarChart
                title="Horário de uso"
                color="#0a84ff"
                summary={peakLabel(p.hours, (r) => r.users, (r) => `${String(r.hour).padStart(2, '0')}h`)}
                data={p.hours.map((r) => ({ label: `${String(r.hour).padStart(2, '0')}h`, value: r.users }))}
              />
              <BarChart
                title="Dia da semana"
                color="#bf5af2"
                summary={peakLabel(p.weekdays, (r) => r.users, (r) => WEEKDAYS[r.dow] ?? '')}
                data={p.weekdays.map((r) => ({ label: WEEKDAYS[r.dow] ?? String(r.dow), value: r.users }))}
              />
            </div>

            <div className="grid lg:grid-cols-3 gap-3">
              <Panel title="Versões em uso (Macs, 30 dias)">
                <MeterList
                  empty="Nenhum Mac mandou sinal nos últimos 30 dias."
                  rows={p.versions.map((v) => ({ key: v.version, label: `v${v.version}`, value: v.macs }))}
                />
              </Panel>
              <Panel title="Tipo de Mac (30 dias)">
                <MeterList
                  empty="Nenhum Mac mandou sinal nos últimos 30 dias."
                  rows={p.archs.map((a) => ({ key: a.arch, label: ARCH_LABELS[a.arch] ?? a.arch, value: a.macs }))}
                />
              </Panel>
              <Panel title={`Contas mais ativas (${data.days} dias)`}>
                {p.top_users.length === 0 ? <Empty text="Ninguém usou o programa neste período." /> : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-2xs uppercase tracking-wider text-logic-text-muted border-b border-logic-border">
                        <th className="px-4 py-2 font-semibold">Conta</th>
                        <th className="px-2 py-2 font-semibold text-right">Dias</th>
                        <th className="px-4 py-2 font-semibold text-right">Último uso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-logic-border/60">
                      {p.top_users.map((u) => (
                        <tr key={u.email}>
                          <td className="px-4 py-2 truncate max-w-[160px] text-logic-text" title={u.email}>{u.email}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{num(u.days_active)}</td>
                          <td className="px-4 py-2 text-right text-logic-text-dim whitespace-nowrap">{relative(u.last_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
            </div>
          </section>

          {/* ─── Site ─────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h3 className="text-2xs font-semibold tracking-widest text-logic-text-muted uppercase">Site vsstagepro.com.br</h3>
              <p className="text-2xs text-logic-text-muted">
                {s.since ? `Contando desde ${shortDay(s.since)}/${s.since.slice(0, 4)}` : 'Ainda sem visitas registradas: a contagem começa com a próxima publicação do site.'}
              </p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Visitantes hoje" value={num(s.visitors_today)} hint={`${num(s.views_today)} páginas vistas`} />
              <Kpi label="Últimos 7 dias" value={num(s.visitors_7d)} hint={`${num(s.views_7d)} páginas vistas`} />
              <Kpi label="Últimos 30 dias" value={num(s.visitors_30d)} hint={`${num(s.views_30d)} páginas vistas`} />
              <Kpi
                label={`Cadastros em ${data.days} dias`}
                value={num(s.signups_period)}
                hint={`${pct(s.signups_period, s.visitors_period)} dos ${num(s.visitors_period)} visitantes do período`}
              />
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              <BarChart
                title={`Visitantes por dia (${data.days} dias)`}
                color="#0a84ff"
                summary={`${num(s.visitors_period)} visitantes no período`}
                data={s.series.map((r) => ({ label: shortDay(r.day), value: r.visitors }))}
              />
              <BarChart
                title="Páginas vistas por dia"
                color="#30d158"
                data={s.series.map((r) => ({ label: shortDay(r.day), value: r.views }))}
              />
            </div>

            <div className="grid lg:grid-cols-3 gap-3">
              <Panel title="Páginas mais visitadas">
                <MeterList
                  empty="Sem visitas neste período."
                  rows={s.pages.map((r) => ({ key: r.page, label: PAGE_LABELS[r.page] ?? r.page, value: r.visitors, hint: `${num(r.views)} vezes aberta` }))}
                />
              </Panel>
              <Panel title="De onde vieram">
                <MeterList
                  empty="Sem visitas neste período."
                  rows={s.referrers.map((r) => ({ key: r.referrer, label: r.referrer === 'direct' ? 'Direto (link digitado, favorito ou app)' : r.referrer, value: r.visitors }))}
                />
              </Panel>
              <Panel title="Aparelho">
                <MeterList
                  empty="Sem visitas neste período."
                  rows={s.devices.map((r) => ({ key: r.device, label: DEVICE_LABELS[r.device] ?? r.device, value: r.visitors }))}
                />
              </Panel>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
