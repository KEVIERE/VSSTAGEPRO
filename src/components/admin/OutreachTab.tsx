import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Eye, Loader2, Mail, MessageCircle,
  AtSign, Pause, Play, RefreshCw, Send, Users, X,
} from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { renderEmailHtml } from '../../../supabase/functions/_shared/outreach';
import {
  adminApi, CAMPAIGN_LABEL, dateTime, num,
} from '@/components/admin/adminApi';
import type {
  OutreachAudience, OutreachCampaign, OutreachChannel, OutreachDetail, OutreachPerson,
  OutreachTemplate,
} from '@/components/admin/adminApi';
import { btnDanger, btnGhost, btnPrimary, Empty, ErrorBox, input, Loading, Panel } from '@/components/admin/ui';
import OutreachTemplates from '@/components/admin/OutreachTemplates';
import DirectEmail from '@/components/admin/DirectEmail';
import { runCampaign, whatsappEtaText } from '@/components/admin/outreachRunner';
import type { RunHandle } from '@/components/admin/outreachRunner';

// Área de Comunicação: e-mail em massa pelo Resend. O WhatsApp saiu do admin em 14/11/2026:
// as mensagens de WhatsApp agora saem pelo robô de atendimento, fora do VS Stage.
//
// Três coisas que a tela deixa explícitas porque mudam a decisão de quem envia:
//  - quantas pessoas realmente vão receber, e quantas ficaram de fora por motivo;
//  - que o WhatsApp é lento por natureza (uma mensagem a cada 3 segundos);
//  - que o e-mail leva descadastro no rodapé, e quem sai não volta para as próximas listas.

const STATES: Array<{ id: string; label: string }> = [
  { id: '', label: 'Toda a base' },
  { id: 'trial', label: 'Em teste' },
  { id: 'expired', label: 'Teste encerrado' },
  { id: 'active', label: 'Assinantes' },
  { id: 'promo', label: 'Bônus' },
  { id: 'blocked', label: 'Suspensos' },
];

export default function OutreachTab({ composeTo, onClearCompose }: {
  /** Pessoa escolhida no drawer de Usuários, para o envio individual. */
  composeTo?: OutreachPerson | null;
  onClearCompose?: () => void;
}) {
  // Só e-mail. O tipo continua OutreachChannel porque o resto da tela e o servidor aceitam os dois.
  const channel = 'email' as OutreachChannel;
  /** Campanha para a base, ou e-mail avulso para endereços digitados à mão. */
  const [view, setView] = useState<'campaign' | 'direct'>('campaign');
  const [state, setState] = useState('');
  const [audience, setAudience] = useState<OutreachAudience | null>(null);
  const [people, setPeople] = useState<OutreachPerson[] | null>(null);
  const [loadingAudience, setLoadingAudience] = useState(false);
  const [audienceError, setAudienceError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState('');

  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; failed: number; left: number; eta: string | null } | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<string | null>(null);
  /** Marca que quem parou foi o botão Pausar, não o fim natural do envio. */
  const stoppedByUser = useRef(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const runner = useRef<RunHandle | null>(null);

  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [detail, setDetail] = useState<OutreachDetail | null>(null);
  const [senderOnline, setSenderOnline] = useState<boolean | null>(null);

  // Pessoa vinda do drawer de Usuários: vira campanha de um destinatário só.
  const [individual, setIndividual] = useState<OutreachPerson | null>(null);

  useEffect(() => {
    if (composeTo) {
      setIndividual(composeTo);
      setView('campaign');
      setMsg(null);
    }
  }, [composeTo]);

  const loadAudience = async () => {
    setLoadingAudience(true);
    setAudienceError(null);
    try {
      const [a, list] = await Promise.all([
        adminApi.outreachAudience(channel, individual ? '' : state),
        adminApi.outreachAudienceList(channel, individual ? '' : state),
      ]);
      setAudience(a);
      setPeople(list);
    } catch (e) {
      // Zera a contagem antiga: manter o número anterior ao lado de um erro faria o admin
      // disparar para um público que não é mais o que a tela está mostrando.
      setAudience(null);
      setPeople(null);
      setAudienceError(friendlyError((e as Error).message));
    } finally {
      setLoadingAudience(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const list = await adminApi.outreachTemplates(channel);
      setTemplates(list.filter((t) => t.active));
    } catch {
      setTemplates([]);
    }
  };

  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    try { setCampaigns(await adminApi.outreachList()); } catch { /* histórico vazio é inofensivo */ } finally { setLoadingCampaigns(false); }
  };

  useEffect(() => { loadAudience(); }, [channel, state, individual?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTemplates(); }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadCampaigns(); }, []);

  // Só o WhatsApp depende de remetente liberado. Consultar aqui evita o envio falhar no meio.
  // Falha na consulta fica como "desconhecido" (null) e não como "bloqueado": dizer que o
  // número não está liberado quando o que caiu foi a rede manda o admin resolver o problema
  // errado.
  const [senderCheckFailed, setSenderCheckFailed] = useState(false);
  useEffect(() => {
    if (channel !== 'whatsapp') { setSenderOnline(null); setSenderCheckFailed(false); return; }
    let alive = true;
    setSenderCheckFailed(false);
    adminApi.outreachSenderStatus()
      .then((r) => { if (alive) setSenderOnline(Boolean(r.online)); })
      .catch(() => { if (alive) { setSenderOnline(null); setSenderCheckFailed(true); } });
    return () => { alive = false; };
  }, [channel]);

  // Sair da aba no meio do envio pausa a campanha: o laço para e o lease é liberado na hora,
  // para ela poder ser retomada pelo histórico sem esperar os 150s do lease vencerem.
  // Não dá para aguardar a resposta aqui (o componente já saiu da tela), por isso o
  // stop() roda sem await: o pior caso é o lease vencer sozinho.
  useEffect(() => () => {
    void runner.current?.stop();
    runner.current = null;
  }, []);

  // Fechar ou recarregar a aba no meio do envio não perde nada (a fila está no banco), mas
  // avisa antes: quem saiu sem saber volta e encontra a campanha pausada no histórico.
  useEffect(() => {
    if (!sending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sending]);

  // Ao escolher um modelo, o texto dele vem para o campo: o admin edita em cima, e a
  // campanha guarda a cópia do que foi enviado.
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject ?? '');
    setBody(t.body);
    if (!title) setTitle(t.name);
  };

  // ─── Seleção de destinatários ─────────────────────────────────────────────
  // Três estados, para não trafegar milhares de endereços quando a escolha é "todos":
  //   'all'    → vai todo mundo do filtro; entram as pessoas que aparecerem depois.
  //   'except' → todo mundo do filtro menos as desmarcadas.
  //   'only'   → só as marcadas.
  // Desmarcar uma pessoa de "todos" vira 'except', e é isso que deixa a tela mostrar
  // "todos, menos o fulano" sem precisar listar quem ficou.
  const [selection, setSelection] = useState<{ mode: 'all' | 'except' | 'only'; ids: Set<string> }>({ mode: 'all', ids: new Set() });

  // Trocar de filtro ou canal muda o conjunto, então a seleção antiga não vale mais.
  useEffect(() => { setSelection({ mode: 'all', ids: new Set() }); }, [state, channel, individual?.user_id]);

  const isChecked = (userId: string) =>
    selection.mode === 'all' ? true : selection.mode === 'except' ? !selection.ids.has(userId) : selection.ids.has(userId);

  const togglePerson = (userId: string) => {
    setSelection((s) => {
      const ids = new Set(s.ids);
      if (s.mode === 'all') {
        // Desmarcar de "todos": guarda só quem saiu.
        ids.add(userId);
        return { mode: ids.size === (people?.length ?? 0) ? 'only' : 'except', ids: ids.size === (people?.length ?? 0) ? new Set() : ids };
      }
      if (ids.has(userId)) ids.delete(userId); else ids.add(userId);
      return { mode: s.mode, ids };
    });
  };

  const selectAll = () => setSelection({ mode: 'all', ids: new Set() });
  const selectNone = () => setSelection({ mode: 'only', ids: new Set() });

  // Quantos vão receber de fato. Conta sobre a lista carregada; o servidor recalcula.
  const selectedCount = !people
    ? 0
    : selection.mode === 'all'
      ? people.length
      : selection.mode === 'except'
        ? people.filter((p) => !selection.ids.has(p.user_id)).length
        : people.filter((p) => selection.ids.has(p.user_id)).length;

  /** Endereços a enviar, ou null quando é a base inteira do filtro. */
  const selectedAddresses = (): string[] | null => {
    if (individual) return [individual.address];
    if (!people) return null;
    if (selection.mode === 'all') return null;
    if (selection.mode === 'except') return people.filter((p) => !selection.ids.has(p.user_id)).map((p) => p.address);
    return people.filter((p) => selection.ids.has(p.user_id)).map((p) => p.address);
  };

  // Quantos vão receber: a seleção manda. Sem seleção mexida, é a contagem do filtro.
  const targetCount = individual ? 1 : selectedCount;
  // Só bloqueia quando a Twilio disse de fato que o remetente não está liberado.
  // No WhatsApp só libera o botão quando a Twilio confirmou que o remetente está online.
  // "Não consegui consultar" não é "pode enviar": o envio falharia no primeiro lote.
  const senderReady = channel !== 'whatsapp' || senderOnline === true;
  const canSend = !sending
    && Boolean(body.trim())
    && (channel === 'email' ? Boolean(subject.trim()) : true)
    && targetCount > 0
    && senderReady;

  const start = async () => {
    if (!canSend) return;
    if (channel === 'whatsapp' && targetCount > 5) {
      const ok = window.confirm(
        `Enviar para ${num(targetCount)} números pelo WhatsApp?\n\nO WhatsApp entrega cerca de uma mensagem a cada 3 segundos, então isso leva ${whatsappEtaText(targetCount)}. Mantenha esta aba aberta enquanto o envio acontece: fechar pausa a campanha, e você retoma pelo histórico.`,
      );
      if (!ok) return;
    }
    setSending(true);
    setMsg(null);
    stoppedByUser.current = false;
    setProgress({ sent: 0, failed: 0, left: targetCount, eta: channel === 'whatsapp' ? whatsappEtaText(targetCount) : null });
    try {
      // null = usa a base inteira do filtro; lista = só esses endereços.
      const addresses = selectedAddresses();
      const created = await adminApi.outreachCreate({
        channel,
        template: templateId || null,
        subject: channel === 'email' ? subject : null,
        body,
        variables: Array.from(new Set((body.match(/\{\{\s*([\w.-]+)\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, '')))),
        title: title || (individual ? `Mensagem para ${individual.name ?? individual.address}` : null),
        state: individual ? null : state || null,
        replyTo: channel === 'email' ? (replyTo || null) : null,
        addresses,
        audience: { state: individual ? null : state, individual: individual?.user_id ?? null },
      });

      if (!created.total) {
        const why = created.skipped?.[0]?.reason;
        setMsg({
          ok: false,
          text: why === 'descadastrado'
            ? 'Essa pessoa pediu para não receber mais mensagens. Para voltar a falar com ela, remova o descadastro na lista de quem saiu.'
            : why === 'sem_contato'
              ? 'Essa conta não tem número de telefone cadastrado, então não dá para mandar pelo WhatsApp.'
              : why === 'email_invalido'
                ? 'O e-mail cadastrado não é válido.'
                : 'Nenhum destinatário válido para este envio.',
        });
        setSending(false);
        setProgress(null);
        await loadCampaigns();
        return;
      }

      setActiveCampaign(created.id);
      const handle = runCampaign(created.id, (p) => {
        setProgress({ sent: p.sent, failed: p.failed, left: p.left, eta: p.eta });
      });
      runner.current = handle;
      await handle.finished;
      // A pausa já escreveu a mensagem dela. Sobrescrever com "concluído" faria o painel
      // dizer que terminou um envio que parou na metade.
      if (!stoppedByUser.current) {
        setMsg({ ok: true, text: 'Envio concluído.' });
      }
      setProgress(null);
      setIndividual(null);
      onClearCompose?.();
      await loadCampaigns();
    } catch (e) {
      const text = friendlyError((e as Error).message);
      setMsg({ ok: false, text: /outra aba|already_running|run_superseded/i.test((e as Error).message)
        ? 'Esta campanha está sendo enviada em outra aba. O progresso aparece no histórico abaixo.'
        : /send_stalled/i.test((e as Error).message)
          ? 'O envio parou de responder do servidor. O que já saiu está no histórico, e você pode retomar de onde parou.'
          : text });
      if (activeCampaign) await loadCampaigns();
    } finally {
      setSending(false);
      runner.current = null;
    }
  };

  const pause = async () => {
    stoppedByUser.current = true;
    await runner.current?.stop();
    setSending(false);
    setProgress(null);
    if (activeCampaign) await loadCampaigns();
    setMsg({ ok: true, text: 'Envio pausado. Você retoma pelo histórico quando quiser.' });
  };

  const resume = async (campaign: OutreachCampaign) => {
    if (channel === 'whatsapp' || campaign.channel === 'whatsapp') {
      const left = campaign.pending;
      const ok = window.confirm(`Retomar o envio para ${num(left)} números?\n\nIsso leva ${whatsappEtaText(left)} com a aba aberta.`);
      if (!ok) return;
    }
    setSending(true);
    setMsg(null);
    stoppedByUser.current = false;
    setActiveCampaign(campaign.id);
    setProgress({ sent: campaign.sent, failed: campaign.failed, left: campaign.pending, eta: campaign.channel === 'whatsapp' ? whatsappEtaText(campaign.pending) : null });
    try {
      const handle = runCampaign(campaign.id, (p) => setProgress({ sent: p.sent, failed: p.failed, left: p.left, eta: p.eta }));
      runner.current = handle;
      await handle.finished;
      // Mesma regra do envio novo: pausa não vira "concluído".
      if (!stoppedByUser.current) setMsg({ ok: true, text: 'Envio concluído.' });
      setProgress(null);
      await loadCampaigns();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError((e as Error).message) });
      await loadCampaigns();
    } finally {
      setSending(false);
      runner.current = null;
    }
  };

  const previewHtml = useMemo(() => {
    const vars: Record<string, string> = { nome: 'Ana', quando: 'hoje às 18h', versao: '1.2.6' };
    return renderEmailHtml(body || 'Escreva a mensagem para ver a prévia.', vars);
  }, [body]);

  const shownPeople = individual
    ? [individual]
    : (people ?? []).slice(0, 40);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Comunicação com os usuários</h2>
          <p className="text-xs text-logic-text-dim">
            E-mail para quem tem conta no VS Stage Pro. Escolha o público, escreva a mensagem e o sistema entrega,
            registra falha e tira da lista quem pediu para sair.
          </p>
        </div>
        <div className="flex p-0.5 rounded-md bg-logic-bg-deep border border-logic-border-dark">
          {([['email', 'E-mail', Mail]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => { setView('campaign'); setTemplateId(''); }}
              className={`flex items-center gap-1.5 px-3 h-8 rounded text-xs font-semibold transition ${view === 'campaign' && channel === id ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-muted hover:text-logic-text'}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
          <button type="button" onClick={() => setView('direct')} disabled={sending}
            title={sending ? 'Espere a campanha terminar de enviar' : 'Escrever para endereços quaisquer'}
            className={`flex items-center gap-1.5 px-3 h-8 rounded text-xs font-semibold transition disabled:opacity-50 ${view === 'direct' ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-muted hover:text-logic-text'}`}>
            <AtSign size={13} /> E-mail avulso
          </button>
        </div>
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg border text-xs ${msg.ok ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'}`}>
          {msg.text}
        </div>
      )}

      {view === 'direct' ? <DirectEmail /> : (<>

      {individual && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-logic-accent/40 bg-logic-accent/10 text-xs">
          <Users size={13} className="text-logic-accent-hover" />
          <span>
            Envio individual para <span className="font-semibold text-logic-text">{individual.name ?? individual.address}</span>
            <span className="text-logic-text-dim"> ({individual.address})</span>
          </span>
          <button type="button" className="ml-auto p-1 rounded hover:bg-logic-bg-panel-light" onClick={() => { setIndividual(null); onClearCompose?.(); }} aria-label="Cancelar envio individual">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ─── Compor ─── */}
        <Panel title={channel === 'email' ? 'Escrever o e-mail' : 'Escrever a mensagem'}>
          <div className="p-4 space-y-3">
            <div>
              <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Mensagem pronta</label>
              <select className={`${input} h-9`} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">Escrever do zero</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id} disabled={channel === 'whatsapp' && t.approval_status === 'rejected'}>
                    {t.name}{channel === 'whatsapp' && t.approval_status !== 'approved' ? ' (sem aprovação)' : ''}
                  </option>
                ))}
              </select>
              {channel === 'whatsapp' && templateId && (() => {
                const t = templates.find((x) => x.id === templateId);
                if (!t) return null;
                if (t.approval_status === 'approved') return null;
                return (
                  <p className="text-[10px] text-logic-lcd-amber mt-1 flex items-start gap-1 leading-snug">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    Este modelo ainda não foi aprovado pelo WhatsApp. Fora de uma conversa aberta nas últimas 24 horas, a mensagem não é entregue.
                  </p>
                );
              })()}
            </div>

            {channel === 'email' && (
              <>
                <div>
                  <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Assunto</label>
                  <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: Seu teste termina em breve" maxLength={150} />
                </div>
              </>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-2xs font-semibold text-logic-text-muted">Mensagem</label>
                <div className="flex items-center gap-1">
                  <button type="button" className={btnGhost} onClick={() => setBody((b) => `${b}**negrito**`)}>B</button>
                  <button type="button" className={btnGhost} onClick={() => setBody((b) => `${b}_itálico_`)}>I</button>
                  {channel === 'email' && (
                    <button type="button" className={btnGhost} onClick={() => setBody((b) => `${b}[texto](https://)`)}>Link</button>
                  )}
                  <button type="button" className={btnGhost} onClick={() => setBody((b) => `${b}{{nome}}`)}>{'{{nome}}'}</button>
                  {channel === 'email' && (
                    <button type="button" className={`${btnGhost} ${preview ? 'ring-1 ring-logic-accent' : ''}`} onClick={() => setPreview((p) => !p)} aria-label="Prévia">
                      <Eye size={13} />
                    </button>
                  )}
                </div>
              </div>
              <textarea
                className={`${input} h-44 py-2 leading-relaxed resize-y`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={channel === 'email'
                  ? 'Oi, {{nome}},\n\nEscreva aqui.\n\nUma linha em branco separa parágrafos.'
                  : 'Oi, {{nome}}! Escreva aqui. Responda SAIR para não receber mais mensagens.'}
                maxLength={channel === 'whatsapp' ? 1024 : 4000}
              />
              {channel === 'whatsapp' && (
                <p className="text-[10px] text-logic-text-muted mt-1">
                  {body.length}/1024 caracteres. Inclua sempre a frase de SAIR: é o que permite a pessoa sair sem denunciar.
                </p>
              )}
            </div>

            {channel === 'email' && (
              <div>
                <label className="block text-2xs font-semibold text-logic-text-muted mb-1">Responder para (opcional)</label>
                <input className={input} type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="contato@vsstagepro.com.br" />
              </div>
            )}

            {preview && channel === 'email' && (
              <div className="rounded-lg border border-logic-border overflow-hidden bg-black">
                <div className="flex items-center justify-between px-3 h-8 bg-logic-bg-elevated text-2xs text-logic-text-muted">
                  <span>Prévia do e-mail</span>
                  <button type="button" onClick={() => setPreview(false)} className="hover:text-logic-text"><X size={12} /></button>
                </div>
                <iframe title="Prévia do e-mail" srcDoc={previewHtml} className="w-full h-80 bg-black" sandbox="" />
              </div>
            )}
          </div>
        </Panel>

        {/* ─── Público ─── */}
        <Panel title="Quem vai receber">
          <div className="p-4 space-y-3">
            {!individual && (
              <div className="flex flex-wrap gap-1">
                {STATES.map((s) => (
                  <button key={s.id} type="button" onClick={() => setState(s.id)}
                    className={`px-2.5 h-7 rounded-md text-2xs font-semibold transition ${state === s.id ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-muted hover:text-logic-text'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {audienceError && <ErrorBox text={audienceError} />}

            {loadingAudience && !audience ? (
              <div className="flex items-center gap-2 text-xs text-logic-text-muted"><Loader2 size={13} className="animate-spin" /> Contando destinatários…</div>
            ) : !audience && audienceError ? (
              // Sem contagem não existe número: mostrar "0 pessoas vão receber" ao lado de um
              // erro faria parecer que a base está vazia, quando o que falhou foi a consulta.
              <div className="flex items-center gap-2 py-2">
                <span className="text-xs text-logic-text-muted">Não foi possível contar os destinatários.</span>
                <button type="button" className={btnGhost} onClick={loadAudience} aria-label="Tentar de novo"><RefreshCw size={12} /> Tentar de novo</button>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums">{num(individual ? 1 : (people ? selectedCount : (audience?.eligible ?? 0)))}</span>
                  <span className="text-xs text-logic-text-dim">
                    {targetCount === 1 ? 'pessoa vai receber' : 'pessoas vão receber'}
                    {!individual && people && selectedCount < people.length && (
                      <span className="text-logic-text-muted"> · de {num(people.length)} no filtro</span>
                    )}
                  </span>
                  <button type="button" className={`${btnGhost} ml-auto`} onClick={loadAudience} aria-label="Recalcular"><RefreshCw size={12} className={loadingAudience ? 'animate-spin' : ''} /></button>
                </div>

                {audience && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <MiniStat label="Sem contato" value={audience.sem_contato} />
                    <MiniStat label={channel === 'email' ? 'E-mail inválido' : 'Telefone inválido'} value={audience.email_invalido} />
                    <MiniStat label="Descadastrados" value={audience.descadastrado} />
                  </div>
                )}

                {channel === 'whatsapp' && targetCount > 0 && (
                  <p className="text-2xs text-logic-text-muted">
                    Pelo envio automático (Twilio), o tempo estimado seria{' '}
                    <span className="text-logic-text">{whatsappEtaText(targetCount)}</span>, com esta aba aberta. Pelo botão
                    de abrir a conversa, você envia {targetCount === 1 ? 'a mensagem' : 'as mensagens'} na hora, sem espera.
                  </p>
                )}

                {!individual && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xs text-logic-text-muted">
                      {selection.mode === 'all'
                        ? 'Todos marcados'
                        : selection.mode === 'except'
                          ? `Todos, menos ${num(selection.ids.size)}`
                          : `${num(selectedCount)} de ${num(people?.length ?? 0)} marcados`}
                    </span>
                    <button type="button" className={`${btnGhost} ml-auto`} onClick={selectAll} disabled={selection.mode === 'all'}>
                      Marcar todos
                    </button>
                    <button type="button" className={btnGhost} onClick={selectNone} disabled={selectedCount === 0}>
                      Desmarcar todos
                    </button>
                  </div>
                )}

                <div className="max-h-44 overflow-y-auto rounded-md border border-logic-border divide-y divide-logic-border/60">
                  {shownPeople.length === 0 ? (
                    <p className="px-3 py-6 text-center text-2xs text-logic-text-muted">Ninguém com contato válido neste filtro.</p>
                  ) : shownPeople.map((p) => {
                    return (
                      <div key={p.user_id} className={`flex items-center gap-2 px-3 py-1.5 text-2xs ${isChecked(p.user_id) ? '' : 'opacity-45'}`}>
                        {!individual && (
                          <input
                            type="checkbox"
                            className="shrink-0 accent-[var(--logic-accent,#ffab1f)]"
                            checked={isChecked(p.user_id)}
                            onChange={() => togglePerson(p.user_id)}
                            aria-label={`Enviar para ${p.name ?? p.address}`}
                          />
                        )}
                        <span className="truncate text-logic-text">{p.name ?? 'Sem nome'}</span>
                        <span className="truncate text-logic-text-muted">{p.address}</span>
                      </div>
                    );
                  })}
                </div>
                {(people?.length ?? 0) > 40 && !individual && (
                  <p className="text-[10px] text-logic-text-muted">Mostrando 40 de {num(people!.length)}. Todos entram no envio.</p>
                )}
                {senderCheckFailed && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-logic-border bg-logic-bg-deep/40 text-xs text-logic-text-dim">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Não foi possível consultar o número na Twilio agora, então o envio automático continua bloqueado.
                      O botão de abrir a conversa em cada pessoa não depende disso e segue funcionando.
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {sending ? (
                    <>
                      <button type="button" className={btnGhost} onClick={pause}><Pause size={13} /> Pausar</button>
                      <span className="text-2xs text-logic-text-dim">
                        Enviados {num(progress?.sent ?? 0)} · falhas {num(progress?.failed ?? 0)} · faltam {num(progress?.left ?? 0)}
                        {progress?.eta ? ` · ${progress.eta}` : ''}
                      </span>
                    </>
                  ) : (
                    <button type="button" className={btnPrimary} disabled={!canSend} onClick={start}>
                      <Send size={13} /> {individual ? 'Enviar para esta pessoa' : `Enviar para ${num(targetCount)}`}
                    </button>
                  )}
                  {!sending && (!body.trim() || (channel === 'email' && !subject.trim())) && (
                    <span className="text-2xs text-logic-text-muted">Preencha {channel === 'email' ? 'assunto e mensagem' : 'a mensagem'} para enviar.</span>
                  )}
                </div>

                {sending && progress && (
                  <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
                    <div className="h-full bg-logic-lcd-green transition-all"
                      style={{ width: `${Math.min(100, Math.round((progress.sent + progress.failed) / Math.max(1, progress.sent + progress.failed + progress.left) * 100))}%` }} />
                  </div>
                )}

                {channel === 'email' && (
                  <p className="text-[10px] text-logic-text-muted leading-snug">
                    Todo e-mail leva um link de descadastro no rodapé, e o botão nativo do Gmail e do Outlook também funciona.
                    Quem sair não entra em nenhuma lista futura.
                  </p>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>

      <OutreachTemplates channel={channel} />

      {/* ─── Histórico ─── */}
      <Panel
        title="Histórico de envios"
        actions={<button type="button" className={btnGhost} onClick={loadCampaigns} aria-label="Atualizar histórico"><RefreshCw size={13} className={loadingCampaigns ? 'animate-spin' : ''} /></button>}
      >
        {loadingCampaigns && campaigns.length === 0 ? <Loading /> : campaigns.length === 0 ? <Empty text="Nenhum envio ainda." /> : (
          <ul className="divide-y divide-logic-border">
            {campaigns.map((c) => {
              const pct = c.total ? Math.round(((c.sent + c.failed + c.skipped) / c.total) * 100) : 0;
              return (
                <li key={c.id}>
                  <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <button type="button" className="p-0.5 rounded hover:bg-logic-bg-elevated text-logic-text-muted" aria-label="Ver detalhes"
                      onClick={() => adminApi.outreachDetail(c.id).then(setDetail).catch(() => {})}>
                      {detail?.campaign.id === c.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <span className="inline-flex items-center gap-1 text-2xs text-logic-text-dim">
                      {c.channel === 'email' ? <Mail size={12} /> : <MessageCircle size={12} />}
                      {c.channel === 'email' ? 'E-mail' : 'WhatsApp'}
                    </span>
                    <span className="text-xs font-medium truncate max-w-[18rem]">{c.title ?? c.subject ?? 'Sem título'}</span>
                    <span className={`px-1.5 h-4 rounded text-[10px] font-bold inline-flex items-center ${
                      c.status === 'done' ? 'bg-logic-lcd-green/15 text-logic-lcd-green'
                        : c.status === 'running' ? 'bg-logic-accent/15 text-logic-accent-hover'
                        : c.status === 'canceled' ? 'bg-logic-lcd-red/15 text-logic-lcd-red'
                        : 'bg-logic-lcd-amber/15 text-logic-lcd-amber'}`}>
                      {c.stalled ? 'Interrompida' : CAMPAIGN_LABEL[c.status]}
                    </span>
                    <span className="text-2xs text-logic-text-muted tabular-nums">
                      {num(c.sent)} enviados{c.failed ? ` · ${num(c.failed)} falhas` : ''}{c.pending ? ` · ${num(c.pending)} restantes` : ''} de {num(c.total)}
                    </span>
                    <span className="text-2xs text-logic-text-muted ml-auto">{dateTime(c.created_at)}</span>
                    {(c.status === 'paused' || c.stalled) && c.pending > 0 && (
                      <button type="button" className={btnGhost} disabled={sending} onClick={() => resume(c)}>
                        <Play size={12} /> Retomar
                      </button>
                    )}
                    {(c.status === 'running' || c.status === 'paused') && (
                      <button type="button" className={btnDanger} disabled={sending}
                        onClick={() => { if (window.confirm('Cancelar este envio? Quem ainda não recebeu não vai receber.')) adminApi.outreachCancel(c.id).then(loadCampaigns).catch(() => {}); }}>
                        Cancelar
                      </button>
                    )}
                  </div>
                  <div className="px-4 pb-2">
                    <div className="h-1 rounded-full bg-black/30 overflow-hidden">
                      <div className="h-full bg-logic-lcd-green/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  {detail?.campaign.id === c.id && (
                    <div className="px-10 pb-3 space-y-2">
                      <div className="flex flex-wrap gap-3 text-2xs text-logic-text-dim">
                        <span className="text-logic-lcd-green inline-flex items-center gap-1"><CheckCircle2 size={11} /> {num(detail.counts.sent)} enviados</span>
                        {detail.counts.failed > 0 && <span className="text-logic-lcd-red">{num(detail.counts.failed)} falhas</span>}
                        {detail.counts.skipped > 0 && <span className="text-logic-text-muted">{num(detail.counts.skipped)} pulados</span>}
                        {detail.counts.pending > 0 && <span className="text-logic-lcd-amber">{num(detail.counts.pending)} na fila</span>}
                        {detail.campaign.created_by_email && <span>por {detail.campaign.created_by_email}</span>}
                      </div>
                      <div className="max-h-56 overflow-y-auto rounded-md border border-logic-border divide-y divide-logic-border/60">
                        {detail.recipients.map((r) => (
                          <div key={r.id} className="flex items-start gap-2 px-3 py-1.5 text-2xs">
                            <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                              r.status === 'sent' ? 'bg-logic-lcd-green'
                                : r.status === 'failed' ? 'bg-logic-lcd-red'
                                : r.status === 'skipped' ? 'bg-logic-text-muted'
                                : 'bg-logic-lcd-amber'}`} />
                            <span className="text-logic-text truncate">{r.name ?? '—'}</span>
                            <span className="text-logic-text-muted truncate">{r.address}</span>
                            {r.error && <span className="text-logic-lcd-red truncate">{plainRecipientError(r.error)}</span>}
                            {r.sent_at && <span className="ml-auto text-logic-text-muted shrink-0">{dateTime(r.sent_at)}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      </>)}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-logic-border bg-logic-bg-deep/40 px-2 py-1.5">
      <p className="text-[10px] text-logic-text-muted truncate">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${value > 0 ? 'text-logic-text' : 'text-logic-text-muted'}`}>{num(value)}</p>
    </div>
  );
}

/**
 * Texto que vai para a conversa manual: o mesmo do composer, com as variáveis já trocadas
 * pelo dado da pessoa. Sem isso, o admin abriria a conversa com "{{nome}}" no lugar do nome.
 */

/** Código de erro do provedor em uma frase que o dono do projeto entende. */
function plainRecipientError(code: string): string {
  if (code.startsWith('whatsapp_template_required')) return 'fora da janela de 24h, precisa de modelo aprovado';
  if (code.startsWith('whatsapp_invalid_number')) return 'número sem WhatsApp';
  if (code.startsWith('twilio_429')) return 'limite de envio, tentando de novo';
  if (code.startsWith('lease_expired')) return 'tentativa interrompida';
  if (code.startsWith('optout')) return 'pediu para sair';
  if (code.startsWith('max_attempts')) return 'tentativas esgotadas';
  if (code.startsWith('resend')) return 'recusado pelo serviço de e-mail';
  return code.length > 60 ? `${code.slice(0, 60)}…` : code;
}
