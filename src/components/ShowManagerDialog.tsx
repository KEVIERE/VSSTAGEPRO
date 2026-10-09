import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Copy, RefreshCw, Trash2, Plus, Users, Share2, Radio, Square, AlertTriangle, Check, Ban, Ticket, UserCheck, KeyRound, Type } from 'lucide-react';
import {
  createShow, directorListMusicians,
  directorAddMusician, directorRegenerateCode, directorRemoveMusician,
  directorInvite, directorResetInvite, directorSetCodeLogin, directorSetStatus,
} from '@/lib/musicianApi';
import type { DirectorMusician, ShowInvite } from '@/lib/musicianTypes';
import type { LiveBroadcast } from '@/lib/useLiveBroadcast';
import { publicLink, usePublicAddress } from '@/lib/publicUrl';
import PublicLinkNotice from '@/components/PublicLinkNotice';
import { friendlyError } from '@/lib/friendlyError';

const POLL_MS = 5000;

function formatCode(c: string): string {
  return c.replace(/^(.{4})(.+)$/, '$1-$2');
}

function musicianLink(): string {
  return publicLink('musico');
}

function inviteLink(invite: string): string {
  return publicLink(`join=${invite}`);
}

function requestedAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} dia(s)`;
}

function sentAgo(ts: number | null, now: number): string {
  if (!ts) return 'nenhum sinal enviado ainda';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s <= 2) return 'agora mesmo';
  if (s < 60) return `há ${s} segundos`;
  return `há ${Math.floor(s / 60)} min`;
}

export default function ShowManagerDialog({ open, onClose, broadcast }: {
  open: boolean; onClose: () => void; broadcast: LiveBroadcast;
}) {
  const { show, setShow, onAir, lastSentAt, error: sendError, start, stop, showName } = broadcast;
  const [musicians, setMusicians] = useState<DirectorMusician[]>([]);
  const [invite, setInvite] = useState<ShowInvite | null>(null);
  const [newName, setNewName] = useState('');
  const [newInstr, setNewInstr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  usePublicAddress();
  const [confirmRegen, setConfirmRegen] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [resent, setResent] = useState(false);

  const handleResend = () => {
    broadcast.resendSetlist();
    setResent(true);
    setTimeout(() => setResent(false), 2000);
  };

  const refreshMusicians = useCallback(async () => {
    if (!show) return;
    try {
      const [list, inv] = await Promise.all([
        directorListMusicians(show.showId, show.directorKey),
        directorInvite(show.showId, show.directorKey),
      ]);
      setMusicians(list);
      setInvite(inv);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [show]);

  useEffect(() => {
    if (open && show) {
      refreshMusicians();
      pollRef.current = setInterval(refreshMusicians, POLL_MS);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [open, show, refreshMusicians]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => { if (!open) setConfirmStop(false); }, [open]);

  const handleCreate = async () => {
    setBusy(true); setError(null);
    try {
      const result = await createShow(showName);
      setShow({ showId: result.showId, directorKey: result.directorKey });
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const handleAddMusician = async () => {
    if (!show || !newName.trim()) return;
    setBusy(true); setError(null);
    try {
      await directorAddMusician(show.showId, show.directorKey, newName.trim(), newInstr.trim());
      setNewName(''); setNewInstr('');
      await refreshMusicians();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const handleRegenerate = async (id: string) => {
    if (!show) return;
    setBusy(true); setError(null);
    try {
      await directorRegenerateCode(show.showId, show.directorKey, id);
      await refreshMusicians();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const handleRemove = async (id: string) => {
    if (!show) return;
    setBusy(true); setError(null);
    try {
      await directorRemoveMusician(show.showId, show.directorKey, id);
      await refreshMusicians();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const handleStatus = async (id: string, status: 'approved' | 'blocked') => {
    if (!show) return;
    setBusy(true); setError(null);
    try {
      await directorSetStatus(show.showId, show.directorKey, id, status);
      await refreshMusicians();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const handleResetInvite = async () => {
    if (!show) return;
    setBusy(true); setError(null);
    try {
      await directorResetInvite(show.showId, show.directorKey);
      await refreshMusicians();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const handleCodeLogin = async (allow: boolean) => {
    if (!show) return;
    setBusy(true); setError(null);
    try {
      await directorSetCodeLogin(show.showId, show.directorKey, allow);
      await refreshMusicians();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const handleWhatsAppInvite = () => {
    if (!invite) return;
    const msg = encodeURIComponent(
      `Entre no show pela Área do Músico: ${inviteLink(invite.invite_code)}\nCrie sua conta e peça para entrar. Eu aprovo uma vez só.`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  const pending = musicians.filter((m) => m.status === 'pending');
  const members = musicians.filter((m) => m.status !== 'pending');

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  };

  const accessMessage = (code: string, name: string) =>
    `Olá ${name}! Área do Músico – ${showName}\nLink: ${musicianLink()}\nSenha: ${formatCode(code)}`;

  const handleWhatsApp = (code: string, name: string) => {
    const msg = encodeURIComponent(
      `Olá ${name}! Acesso ao show ${showName}\n\n` +
      `*Link de acesso Área do Músico:*\n${musicianLink()}\n\n` +
      `*Senha:* ${formatCode(code)}`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  const handleStop = async () => {
    setConfirmStop(false);
    await stop();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-hidden bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded-lg flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* cabeçalho */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-logic-border-dark">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-logic-lcd-green" />
            <span className="text-sm font-semibold text-logic-text">Show Online — Músicos</span>
          </div>
          <button onClick={onClose} className="text-logic-text-muted hover:text-logic-text transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto logic-scroll px-5 py-4">
          {show && <div className="mb-3"><PublicLinkNotice /></div>}
          {error && (
            <div className="mb-3 px-3 py-2 rounded bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-xs text-logic-lcd-red">
              {error}
            </div>
          )}

          {!show && (
            <div className="text-center py-8">
              <Users size={40} className="mx-auto text-logic-text-muted mb-3" />
              <p className="text-sm text-logic-text-dim mb-1">
                Publique o show e mande o convite para a banda. Cada músico cria a conta e você aprova uma vez.
              </p>
              <p className="text-xs text-logic-text-muted mb-4">
                Será publicado como <span className="font-medium text-logic-accent">{showName}</span>
              </p>
              <button className="logic-btn-accent" onClick={handleCreate} disabled={busy}>
                {busy ? 'Publicando...' : 'Publicar Show'}
              </button>
            </div>
          )}

          {show && (
            <div className="space-y-4">
              {/* estado do envio */}
              <div
                className={`rounded-lg border px-4 py-3 transition-colors duration-300 ${
                  onAir ? 'bg-logic-lcd-green/10 border-logic-lcd-green/40' : 'bg-logic-bg-deep border-logic-border-dark'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="relative mt-1 flex h-3 w-3 flex-shrink-0">
                    {onAir && <span className="absolute inline-flex h-full w-full rounded-full bg-logic-lcd-green opacity-60 animate-ping" />}
                    <span className={`relative inline-flex h-3 w-3 rounded-full ${onAir ? 'bg-logic-lcd-green' : 'bg-logic-text-muted'}`} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${onAir ? 'text-logic-lcd-green' : 'text-logic-text'}`}>
                      {onAir ? 'No ar' : 'Fora do ar'}
                    </p>
                    <p className="text-xs text-logic-text-dim mt-0.5 leading-relaxed">
                      {onAir
                        ? 'Os músicos estão vendo em tempo real o que toca aqui: música atual, próxima, tempo e repertório. Pode fechar esta janela que o envio continua.'
                        : 'Os músicos não estão recebendo nada. Clique em "Começar a enviar" para que eles acompanhem o show ao vivo.'}
                    </p>
                    {onAir && (
                      <p className="text-2xs text-logic-text-muted mt-1">
                        Último sinal: {sentAgo(lastSentAt, now)}
                      </p>
                    )}
                    {onAir && sendError && (
                      <p className="text-2xs text-logic-lcd-red mt-1 flex items-center gap-1">
                        <AlertTriangle size={12} /> Problema ao enviar. Verifique a internet; o programa continua tentando.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {!onAir ? (
                    <button className="logic-btn-accent flex items-center gap-2 px-4 py-2" onClick={start}>
                      <Radio size={14} /> Começar a enviar
                    </button>
                  ) : (
                    <>
                      <span className="flex items-center gap-2 px-4 py-2 rounded bg-logic-lcd-green/20 text-logic-lcd-green text-xs font-medium">
                        <Radio size={14} className="animate-pulse" /> Enviando ao vivo
                      </span>
                      {!confirmStop ? (
                        <button
                          className="flex items-center gap-2 px-4 py-2 rounded border border-logic-lcd-red/50 text-logic-lcd-red text-xs font-medium hover:bg-logic-lcd-red/15 transition-colors"
                          onClick={() => setConfirmStop(true)}
                        >
                          <Square size={12} /> Parar envio
                        </button>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-logic-lcd-red/10 border border-logic-lcd-red/40">
                          <span className="text-xs text-logic-text">Os músicos vão parar de receber o sinal. Deseja parar?</span>
                          <button
                            className="px-3 py-1 rounded bg-logic-lcd-red text-white text-xs font-medium hover:opacity-90 transition-opacity"
                            onClick={handleStop}
                          >
                            Sim, parar
                          </button>
                          <button className="logic-btn" onClick={() => setConfirmStop(false)}>Continuar enviando</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* nome do show */}
              <div className="rounded-lg border border-logic-border-dark bg-logic-bg-deep px-4 py-3">
                <div className="flex items-center gap-2">
                  <Type size={15} className="text-logic-accent" />
                  <span className="text-sm font-semibold text-logic-text">Show enviado</span>
                  <span key={showName} className="ml-1 min-w-0 truncate px-2 py-0.5 rounded bg-logic-accent/15 text-xs font-medium text-logic-accent animate-[fadeIn_200ms_ease-out]">
                    {showName}
                  </span>
                </div>
                <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
                  Os músicos e o teleprompter veem automaticamente o show ativo. Para trocar, ative outro show no menu Shows.
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  <button className="logic-btn flex items-center gap-1.5" onClick={handleResend} disabled={!onAir}>
                    <RefreshCw size={13} /> {resent ? 'Repertório enviado' : 'Reenviar repertório'}
                  </button>
                  <span className="text-2xs text-logic-text-muted">
                    {onAir ? 'Use se o produtor ou os músicos não estiverem vendo as músicas.' : 'Ligue o envio para mandar o repertório.'}
                  </span>
                </div>
              </div>

              {/* convite da banda */}
              {invite && (
                <div className="rounded-lg border border-logic-border-dark bg-logic-bg-deep px-4 py-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Ticket size={15} className="text-logic-accent" />
                    <span className="text-sm font-semibold text-logic-text">Convite da banda</span>
                  </div>
                  <p className="text-xs text-logic-text-dim leading-relaxed">
                    Mande este link para a banda. Cada músico cria a própria conta e pede para entrar; você aprova uma única vez.
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-xs font-mono text-logic-lcd-amber bg-logic-bg-panel px-2.5 py-1.5 rounded border border-logic-border-dark">
                      {inviteLink(invite.invite_code)}
                    </span>
                    <button
                      className="p-1.5 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors"
                      onClick={() => handleCopy(inviteLink(invite.invite_code), 'invite')}
                      title="Copiar link"
                    >
                      {copiedId === 'invite' ? <span className="text-2xs text-logic-lcd-green">Copiado!</span> : <Copy size={14} />}
                    </button>
                    <button
                      className="p-1.5 rounded text-logic-text-muted hover:text-logic-lcd-green hover:bg-logic-bg-panel-light transition-colors"
                      onClick={handleWhatsAppInvite}
                      title="Enviar por WhatsApp"
                    >
                      <Share2 size={14} />
                    </button>
                    <button
                      className="p-1.5 rounded text-logic-text-muted hover:text-logic-lcd-amber hover:bg-logic-bg-panel-light transition-colors"
                      onClick={handleResetInvite}
                      disabled={busy}
                      title="Trocar convite (o link antigo para de funcionar; quem já entrou continua)"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-logic-text-dim cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-logic-accent"
                      checked={invite.allow_code_login}
                      disabled={busy}
                      onChange={(e) => handleCodeLogin(e.target.checked)}
                    />
                    <KeyRound size={12} />
                    Permitir entrada com código pessoal (músicos convidados sem conta)
                  </label>
                </div>
              )}

              {/* pedidos pendentes */}
              {pending.length > 0 && (
                <div className="rounded-lg border border-logic-lcd-amber/40 bg-logic-lcd-amber/10 px-4 py-3 space-y-2">
                  <p className="text-sm font-semibold text-logic-lcd-amber">
                    Pedidos pendentes ({pending.length})
                  </p>
                  {pending.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded bg-logic-bg-deep border border-logic-border-dark">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-logic-text truncate">{m.name}</span>
                        {m.instrument && <span className="text-2xs text-logic-text-muted ml-2">{m.instrument}</span>}
                        <p className="text-2xs text-logic-text-muted">Pediu {requestedAgo(m.created_at, now)}</p>
                      </div>
                      <button
                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-logic-lcd-green/20 text-logic-lcd-green text-xs font-medium hover:bg-logic-lcd-green/30 transition-colors disabled:opacity-50"
                        onClick={() => handleStatus(m.id, 'approved')}
                        disabled={busy}
                      >
                        <Check size={13} /> Aprovar
                      </button>
                      <button
                        className="px-3 py-1.5 rounded border border-logic-lcd-red/40 text-logic-lcd-red text-xs font-medium hover:bg-logic-lcd-red/15 transition-colors disabled:opacity-50"
                        onClick={() => handleRemove(m.id)}
                        disabled={busy}
                      >
                        Recusar
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* adicionar músico */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-2xs text-logic-text-muted uppercase tracking-wider">Nome do músico</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="João"
                    className="w-full mt-1 bg-logic-bg-deep text-sm text-white px-3 py-2 rounded border border-logic-border-light outline-none focus:border-logic-accent"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddMusician(); }}
                  />
                </div>
                <div className="w-36">
                  <label className="text-2xs text-logic-text-muted uppercase tracking-wider">Instrumento</label>
                  <input
                    value={newInstr}
                    onChange={(e) => setNewInstr(e.target.value)}
                    placeholder="Guitarra"
                    className="w-full mt-1 bg-logic-bg-deep text-sm text-white px-3 py-2 rounded border border-logic-border-light outline-none focus:border-logic-accent"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddMusician(); }}
                  />
                </div>
                <button
                  className="logic-btn-accent flex items-center gap-1"
                  onClick={handleAddMusician}
                  disabled={busy || !newName.trim()}
                >
                  <Plus size={14} /> Adicionar
                </button>
              </div>

              {/* lista de músicos */}
              <div className="space-y-1.5">
                {members.length === 0 && (
                  <p className="text-xs text-logic-text-muted text-center py-4">
                    Nenhum músico no show ainda.
                  </p>
                )}
                {members.map((m) => (
                  <div
                    key={m.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded bg-logic-bg-deep border ${m.status === 'blocked' ? 'border-logic-lcd-red/40 opacity-70' : 'border-logic-border-dark'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${m.online ? 'bg-logic-lcd-green' : 'bg-logic-text-muted'}`} />
                        <span className="text-sm font-medium text-logic-text truncate">{m.name}</span>
                        {m.instrument && (
                          <span className="text-2xs text-logic-text-muted">{m.instrument}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {m.status === 'blocked' ? (
                          <span className="text-2xs font-medium text-logic-lcd-red flex items-center gap-1"><Ban size={11} /> Bloqueado</span>
                        ) : m.has_account ? (
                          <span className="text-2xs text-logic-accent flex items-center gap-1"><UserCheck size={11} /> Conta aprovada</span>
                        ) : (
                          <span className="text-sm font-mono font-semibold tracking-wider text-logic-lcd-amber">Senha: {formatCode(m.code)}</span>
                        )}
                      </div>
                    </div>
                    {!m.has_account && m.status !== 'blocked' && (
                      <>
                        <button
                          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors"
                          onClick={() => handleCopy(accessMessage(m.code, m.name), `${m.id}-link`)}
                          title="Copiar mensagem com o link e a senha escrita"
                        >
                          <Copy size={13} /> {copiedId === `${m.id}-link` ? <span className="text-logic-lcd-green">Copiado!</span> : 'Link + senha'}
                        </button>
                        <button
                          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors"
                          onClick={() => handleCopy(formatCode(m.code), m.id)}
                          title="Copiar senha"
                        >
                          <KeyRound size={13} /> {copiedId === m.id ? <span className="text-logic-lcd-green">Copiado!</span> : 'Senha'}
                        </button>
                        <button
                          className="p-1.5 rounded text-logic-text-muted hover:text-logic-lcd-green hover:bg-logic-bg-panel-light transition-colors"
                          onClick={() => handleWhatsApp(m.code, m.name)}
                          title="Enviar por WhatsApp"
                        >
                          <Share2 size={14} />
                        </button>
                        {confirmRegen === m.id ? (
                          <span className="flex items-center gap-1 animate-[fadeIn_150ms_ease-out]">
                            <button
                              className="px-2 py-1 rounded bg-logic-lcd-amber text-black text-2xs font-medium disabled:opacity-50"
                              onClick={() => { setConfirmRegen(null); handleRegenerate(m.id); }}
                              disabled={busy}
                              title="A senha atual para de funcionar"
                            >
                              Trocar senha
                            </button>
                            <button className="px-1.5 py-1 rounded text-2xs text-logic-text-muted hover:text-logic-text" onClick={() => setConfirmRegen(null)}>
                              Não
                            </button>
                          </span>
                        ) : (
                          <button
                            className="p-1.5 rounded text-logic-text-muted hover:text-logic-lcd-amber hover:bg-logic-bg-panel-light transition-colors"
                            onClick={() => setConfirmRegen(m.id)}
                            title="Trocar senha"
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                      </>
                    )}
                    {m.status === 'blocked' ? (
                      <button
                        className="px-2 py-1 rounded text-2xs font-medium text-logic-lcd-green hover:bg-logic-lcd-green/15 transition-colors"
                        onClick={() => handleStatus(m.id, 'approved')}
                        disabled={busy}
                      >
                        Desbloquear
                      </button>
                    ) : (
                      <button
                        className="p-1.5 rounded text-logic-text-muted hover:text-logic-lcd-red hover:bg-logic-bg-panel-light transition-colors"
                        onClick={() => handleStatus(m.id, 'blocked')}
                        disabled={busy}
                        title="Bloquear acesso"
                      >
                        <Ban size={14} />
                      </button>
                    )}
                    <button
                      className="p-1.5 rounded text-logic-text-muted hover:text-logic-lcd-red hover:bg-logic-bg-panel-light transition-colors"
                      onClick={() => handleRemove(m.id)}
                      title="Remover músico"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
