import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  Download,
  ExternalLink,
  Flame,
  Globe,
  HardDrive,
  History,
  Laptop,
  Loader2,
  Lock,
  Mail,
  Play,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  Users,
  Zap,
} from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import {
  adminApi,
  dateTime,
  num,
  relative,
  type FunnelData,
  type ServiceHealthEntry,
  type TamperAlert,
  type TimelineEvent,
} from '@/components/admin/adminApi';
import { btnDanger, btnGhost, btnPrimary, Empty, ErrorBox, Loading, Panel } from '@/components/admin/ui';

type Section = 'crack' | 'health' | 'funnel' | 'timeline';

export default function MonitoringTab() {
  const [section, setSection] = useState<Section>('crack');
  const [health, setHealth] = useState<ServiceHealthEntry[]>([]);
  const [tamper, setTamper] = useState<TamperAlert[]>([]);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, t, f, tl] = await Promise.all([
        adminApi.serviceHealth().catch(() => []),
        adminApi.tamperAlerts(50).catch(() => []),
        adminApi.funnel(30).catch(() => null),
        adminApi.timeline(60).catch(() => []),
      ]);
      setHealth(h);
      setTamper(t);
      setFunnel(f);
      setTimeline(tl);
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const runHealthCheckNow = async () => {
    setCheckingHealth(true);
    setMsg(null);
    try {
      const res = await adminApi.runHealthCheck();
      setMsg({ ok: true, text: 'Checagem executada com sucesso! Todos os serviços foram testados.' });
      const h = await adminApi.serviceHealth().catch(() => []);
      setHealth(h);
    } catch (e) {
      setMsg({ ok: false, text: `Erro na checagem: ${friendlyError((e as Error).message)}` });
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleCopy = (txt: string, id: string) => {
    navigator.clipboard?.writeText(txt).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const handleBlockHardware = async (hwId: string, currentBlocked: boolean) => {
    setActionBusyId(hwId);
    try {
      if (currentBlocked) {
        await adminApi.unblockHardware(hwId);
        setMsg({ ok: true, text: 'Dispositivo desbloqueado com sucesso.' });
      } else {
        const reason = window.prompt('Motivo do bloqueio do dispositivo:') || 'Uso ilegal / código adulterado';
        await adminApi.blockHardware(hwId, reason);
        setMsg({ ok: true, text: 'Dispositivo bloqueado na blacklist de hardware.' });
      }
      const t = await adminApi.tamperAlerts(50).catch(() => []);
      setTamper(t);
    } catch (e) {
      setMsg({ ok: false, text: friendlyError((e as Error).message) });
    } finally {
      setActionBusyId(null);
    }
  };

  const criticalTamperCount = tamper.filter((t) => t.tampered).length;
  const downServicesCount = health.filter((h) => h.status !== 'up').length;

  return (
    <div className="space-y-6">
      {/* Topo / Cabeçalho */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <ShieldAlert size={22} className="text-logic-lcd-green" />
              <span>Monitoramento & Antifraude Ativo</span>
            </h2>
            <span className="px-2 py-0.5 rounded text-2xs font-extrabold bg-logic-lcd-green/15 text-logic-lcd-green border border-logic-lcd-green/30">
              TELEGRAM CONECTADO
            </span>
          </div>
          <p className="text-xs text-logic-text-dim mt-1">
            Detecção em tempo real de tentativas de crack, uso sem login, saúde dos serviços e funil de conversão.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runHealthCheckNow}
            disabled={checkingHealth}
            className="px-3.5 h-9 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs font-bold text-white border border-white/15 transition flex items-center gap-2 disabled:opacity-50"
          >
            {checkingHealth ? <Loader2 size={13} className="animate-spin text-logic-lcd-green" /> : <Activity size={13} className="text-logic-lcd-green" />}
            <span>Testar serviços agora</span>
          </button>

          <button
            type="button"
            className={btnGhost}
            onClick={loadAll}
            disabled={loading}
            aria-label="Atualizar dados"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center gap-2 ${
            msg.ok
              ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40 text-logic-lcd-green'
              : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'
          }`}
        >
          {msg.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{msg.text}</span>
        </div>
      )}

      {error && <ErrorBox text={error} />}

      {/* Navegação entre seções */}
      <div className="flex items-center gap-2 border-b border-logic-border pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setSection('crack')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
            section === 'crack'
              ? 'bg-logic-lcd-red/20 text-logic-lcd-red border border-logic-lcd-red/40'
              : 'text-logic-text-dim hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <ShieldAlert size={14} />
          <span>Detecção de Crack & Uso Ilegal</span>
          {criticalTamperCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-logic-lcd-red text-black">
              {criticalTamperCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSection('health')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
            section === 'health'
              ? 'bg-logic-lcd-green/20 text-logic-lcd-green border border-logic-lcd-green/40'
              : 'text-logic-text-dim hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <Server size={14} />
          <span>Saúde dos Serviços</span>
          {downServicesCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-logic-lcd-amber text-black">
              {downServicesCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSection('funnel')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
            section === 'funnel'
              ? 'bg-logic-accent/20 text-logic-accent border border-logic-accent/40'
              : 'text-logic-text-dim hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <Zap size={14} />
          <span>Funil de Conversão</span>
        </button>

        <button
          type="button"
          onClick={() => setSection('timeline')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
            section === 'timeline'
              ? 'bg-white/15 text-white border border-white/20'
              : 'text-logic-text-dim hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <History size={14} />
          <span>Linha do Tempo</span>
        </button>
      </div>

      {/* ─── SEÇÃO 1: DETECÇÃO DE CRACK & USO ILEGAL ────────────────────────────── */}
      {section === 'crack' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-gradient-to-r from-red-950/30 to-black border border-red-500/30 flex items-start gap-3">
            <ShieldAlert size={20} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-white">Como a detecção de crack funciona:</p>
              <p className="text-logic-text-dim leading-relaxed">
                O processo principal do Electron no Mac calcula o hash SHA-256 do pacote <code className="text-red-300">app.asar</code> antes de abrir a janela e lê o <code className="text-red-300">IOPlatformUUID</code> imutável da placa-mãe. Se o código for adulterado para pular a tela de login ou se o app rodar sem sessão legítima, um sinal silencioso é disparado para a internet e você recebe o alerta no Telegram com o motivo exato.
              </p>
            </div>
          </div>

          <Panel title={`Tentativas e Anomalias Detectadas (${tamper.length})`}>
            {loading && tamper.length === 0 ? (
              <Loading />
            ) : tamper.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <ShieldCheck size={40} className="mx-auto text-logic-lcd-green" />
                <p className="text-sm font-bold text-white">Nenhum crack ou uso ilegal detectado</p>
                <p className="text-xs text-logic-text-dim max-w-md mx-auto">
                  Todos os executáveis em execução bateram com as assinaturas oficiais do VS Stage Pro.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-logic-border">
                {tamper.map((t) => {
                  const hwShort = t.hw_id.slice(0, 12);
                  return (
                    <div key={t.id} className="p-4 space-y-2 hover:bg-white/[0.02] transition">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-extrabold flex items-center gap-1 ${
                              t.tampered
                                ? 'bg-logic-lcd-red/20 text-logic-lcd-red border border-logic-lcd-red/40'
                                : 'bg-logic-lcd-amber/20 text-logic-lcd-amber border border-logic-lcd-amber/40'
                            }`}
                          >
                            <Flame size={11} />
                            {t.tampered ? 'CÓDIGO MODIFICADO / CRACK' : 'SUSPEITA DE BYPASS'}
                          </span>

                          {t.is_blacklisted && (
                            <span className="px-2 py-0.5 rounded text-2xs font-extrabold bg-red-900/40 text-red-300 border border-red-700/60">
                              HARDWARE BLOQUEADO
                            </span>
                          )}

                          <span className="text-2xs text-logic-text-muted">{dateTime(t.created_at)}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleBlockHardware(t.hw_id, t.is_blacklisted)}
                            disabled={actionBusyId === t.hw_id}
                            className={`px-2.5 py-1 rounded text-xs font-bold transition flex items-center gap-1 ${
                              t.is_blacklisted
                                ? 'bg-logic-lcd-green/20 text-logic-lcd-green hover:bg-logic-lcd-green/30 border border-logic-lcd-green/40'
                                : 'bg-logic-lcd-red/20 text-logic-lcd-red hover:bg-logic-lcd-red/30 border border-logic-lcd-red/40'
                            }`}
                          >
                            {t.is_blacklisted ? <Unlock size={12} /> : <Ban size={12} />}
                            <span>{t.is_blacklisted ? 'Desbloquear Mac' : 'Bloquear Dispositivo'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Motivo em destaque claro */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-white/10 text-xs text-red-200">
                        <strong className="text-white">Motivo detectado:</strong> {t.reason || 'Alteração de integridade no pacote executável'}
                      </div>

                      {/* Metadados técnicos da máquina */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-2xs text-logic-text-dim pt-1">
                        <div>
                          <span className="text-logic-text-muted">Hardware ID:</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(t.hw_id, `hw-${t.id}`)}
                            className="font-mono text-white flex items-center gap-1 hover:underline"
                          >
                            <span>{hwShort}...</span>
                            <Copy size={9} />
                            {copiedId === `hw-${t.id}` && <span className="text-logic-lcd-green">copiado</span>}
                          </button>
                        </div>

                        <div>
                          <span className="text-logic-text-muted">IP:</span>
                          <span className="font-mono text-white block">{t.ip || '—'}</span>
                        </div>

                        <div>
                          <span className="text-logic-text-muted">Versão rodando:</span>
                          <span className="font-mono text-white block">{t.app_version}</span>
                        </div>

                        <div>
                          <span className="text-logic-text-muted">Sessão no app:</span>
                          <span className={`block font-semibold ${t.has_session ? 'text-logic-lcd-green' : 'text-logic-lcd-red'}`}>
                            {t.has_session ? 'Conta autenticada' : 'Nenhuma (bypass da tela)'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ─── SEÇÃO 2: SAÚDE DOS SERVIÇOS EXTERNOS ───────────────────────────────── */}
      {section === 'health' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.map((s) => {
              const isUp = s.status === 'up';
              const isDegraded = s.status === 'degraded';
              const nameMap: Record<string, { label: string; desc: string }> = {
                supabase: { label: 'Supabase Database', desc: 'PostgreSQL, Auth e Storage' },
                resend: { label: 'Resend SMTP', desc: 'Envio de e-mails transacionais' },
                stripe: { label: 'Stripe Payments', desc: 'Assinaturas e Checkout' },
                replicate: { label: 'Replicate AI', desc: 'Motor de separação de Stems' },
                github: { label: 'GitHub Actions', desc: 'Pipelines de deploy contínuo' },
              };
              const info = nameMap[s.service] || { label: s.service.toUpperCase(), desc: 'Serviço externo' };

              return (
                <div
                  key={s.service}
                  className={`p-4 rounded-xl border transition-all ${
                    isUp
                      ? 'bg-logic-bg-panel/90 border-logic-border hover:border-logic-lcd-green/40'
                      : isDegraded
                      ? 'bg-amber-950/20 border-amber-500/40'
                      : 'bg-red-950/30 border-red-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white">{info.label}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-2xs font-extrabold flex items-center gap-1 ${
                        isUp
                          ? 'bg-logic-lcd-green/15 text-logic-lcd-green border border-logic-lcd-green/30'
                          : isDegraded
                          ? 'bg-logic-lcd-amber/20 text-logic-lcd-amber border border-logic-lcd-amber/30'
                          : 'bg-logic-lcd-red/20 text-logic-lcd-red border border-logic-lcd-red/40'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isUp ? 'bg-logic-lcd-green animate-pulse' : 'bg-logic-lcd-red'}`} />
                      {s.status.toUpperCase()}
                    </span>
                  </div>

                  <p className="text-2xs text-logic-text-muted mb-3">{info.desc}</p>
                  <p className="text-xs text-logic-text-dim leading-snug">{s.detail}</p>

                  <div className="mt-3 pt-2.5 border-t border-logic-border flex items-center justify-between text-2xs text-logic-text-muted">
                    <span>Latência: <strong className="text-white font-mono">{s.latency_ms}ms</strong></span>
                    <span>{relative(s.checked_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 rounded-xl bg-logic-bg-deep border border-logic-border text-xs text-logic-text-dim flex items-center gap-2">
            <Zap size={14} className="text-logic-lcd-green shrink-0" />
            <span>
              A checagem roda automaticamente a cada 5 minutos no servidor. Se qualquer serviço cair, um alerta é disparado instantaneamente no seu Telegram.
            </span>
          </div>
        </div>
      )}

      {/* ─── SEÇÃO 3: FUNIL DE CONVERSÃO ────────────────────────────────────────── */}
      {section === 'funnel' && (
        <div className="space-y-4">
          <Panel title="Funil de Conversão (Últimos 30 Dias)">
            {!funnel ? (
              <Loading />
            ) : (
              <div className="p-6 space-y-6">
                {[
                  {
                    step: 1,
                    label: 'Cadastros Realizados',
                    count: funnel.signups,
                    icon: Users,
                    color: 'from-blue-500 to-indigo-500',
                    desc: 'Pessoas que preencheram nome, e-mail e senha no site ou app.',
                  },
                  {
                    step: 2,
                    label: 'E-mails Confirmados',
                    count: funnel.confirmed,
                    icon: Mail,
                    color: 'from-indigo-500 to-purple-500',
                    desc: 'Clicaram no link de confirmação do Resend e ativaram a conta.',
                  },
                  {
                    step: 3,
                    label: 'Abriram o VS Stage no Mac',
                    count: funnel.app_opened,
                    icon: Laptop,
                    color: 'from-purple-500 to-pink-500',
                    desc: 'Baixaram o instalador .dmg e abriram o programa pela 1ª vez.',
                  },
                  {
                    step: 4,
                    label: 'Usaram Ferramentas de Show',
                    count: funnel.stage_used,
                    icon: Play,
                    color: 'from-amber-500 to-orange-500',
                    desc: 'Deram Play na timeline, usaram Mixer, Modo Show ou Rede Local.',
                  },
                  {
                    step: 5,
                    label: 'Assinaturas Pagas',
                    count: funnel.subscribed,
                    icon: DollarSign,
                    color: 'from-emerald-500 to-logic-lcd-green',
                    desc: 'Concluíram o pagamento no Stripe (Mensal ou Anual).',
                  },
                ].map((item, idx, arr) => {
                  const Icon = item.icon;
                  const prevCount = idx === 0 ? item.count : arr[idx - 1].count;
                  const convPct = prevCount > 0 ? Math.round((item.count / prevCount) * 100) : 0;
                  const totalPct = funnel.signups > 0 ? Math.round((item.count / funnel.signups) * 100) : 0;

                  return (
                    <div key={item.step} className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center font-bold text-white text-2xs">
                            {item.step}
                          </div>
                          <Icon size={15} className="text-white" />
                          <span className="font-bold text-white">{item.label}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-black text-white tabular-nums">{num(item.count)}</span>
                          {idx > 0 && (
                            <span className="text-2xs text-logic-text-muted ml-2">
                              ({convPct}% do passo anterior)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Barra visual de progresso */}
                      <div className="w-full bg-black/40 h-2.5 rounded-full overflow-hidden border border-white/10">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${item.color} transition-all duration-700`}
                          style={{ width: `${Math.max(4, totalPct)}%` }}
                        />
                      </div>
                      <p className="text-2xs text-logic-text-muted">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ─── SEÇÃO 4: LINHA DO TEMPO UNIFICADA ───────────────────────────────────── */}
      {section === 'timeline' && (
        <div className="space-y-4">
          <Panel title={`Linha do Tempo de Eventos (${timeline.length})`}>
            {loading && timeline.length === 0 ? (
              <Loading />
            ) : timeline.length === 0 ? (
              <Empty text="Nenhum evento registrado no histórico recente." />
            ) : (
              <div className="divide-y divide-logic-border">
                {timeline.map((ev, i) => {
                  const badgeMap = {
                    positive: 'bg-logic-lcd-green/20 text-logic-lcd-green border-logic-lcd-green/40',
                    negative: 'bg-logic-lcd-red/20 text-logic-lcd-red border-logic-lcd-red/40',
                    warning: 'bg-logic-lcd-amber/20 text-logic-lcd-amber border-logic-lcd-amber/40',
                    critical: 'bg-red-600 text-white border-red-500 animate-pulse',
                    neutral: 'bg-white/10 text-logic-text-dim border-white/15',
                  };
                  return (
                    <div key={i} className="p-3.5 flex items-start gap-3 hover:bg-white/[0.02] transition text-xs">
                      <span className="text-2xs text-logic-text-muted tabular-nums whitespace-nowrap mt-0.5">
                        {dateTime(ev.created_at)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold uppercase border ${badgeMap[ev.severity]}`}>
                            {ev.event_type}
                          </span>
                          <span className="font-bold text-white truncate">{ev.title}</span>
                          <span className="text-logic-text-dim truncate">{ev.subtitle}</span>
                        </div>
                        {ev.detail && (
                          <p className="text-2xs text-logic-text-muted mt-1 truncate">{ev.detail}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
