import { useCallback, useEffect, useState } from 'react';
import { X, Clapperboard, MonitorPlay, Copy, RefreshCw, ExternalLink, Loader2, Radio, Share2, PenLine, FileText, KeyRound } from 'lucide-react';
import type { LiveBroadcast } from '@/lib/useLiveBroadcast';
import { directorPrompterCodes, directorResetPrompterCodes, producerLink, screenLink } from '@/lib/prompterApi';
import PrompterAudioUpload from '@/components/prompter/PrompterAudioUpload';
import BandLogoUpload from '@/components/prompter/BandLogoUpload';
import PublicLinkNotice from '@/components/PublicLinkNotice';
import { usePublicAddress } from '@/lib/publicUrl';
import type { ReferenceSync } from '@/lib/useReferenceAutoSync';

function formatCode(c: string): string {
  return c.replace(/^(.{5})(.+)$/, '$1-$2');
}

export default function PrompterDialog({ broadcast, lyricSongs, referenceSync, onClose, onOpenShowManager }: {
  broadcast: LiveBroadcast;
  lyricSongs: number;
  referenceSync: ReferenceSync;
  onClose: () => void;
  onOpenShowManager: () => void;
}) {
  const show = broadcast.show;
  const [codes, setCodes] = useState<{ producerCode: string; screenCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  usePublicAddress();

  const load = useCallback(async () => {
    if (!show) return;
    setError(null);
    try {
      setCodes(await directorPrompterCodes(show.showId, show.directorKey));
    } catch {
      setError('Não foi possível carregar os acessos do teleprompter. Confira a internet e tente de novo.');
    }
  }, [show]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reset = async () => {
    if (!show) return;
    setBusy(true);
    try {
      await directorResetPrompterCodes(show.showId, show.directorKey);
      await load();
      setConfirmReset(false);
    } catch {
      setError('Não foi possível trocar os códigos.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      setError('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  };

  const rows = codes ? [
    {
      id: 'producer', icon: Clapperboard, title: 'Área do Produtor', code: codes.producerCode, link: producerLink(),
      hint: 'Quem escreve as letras, marca os tempos com o áudio LR Master, escolhe o que vai para a TV e manda avisos. Funciona no celular ou no computador.',
    },
    {
      id: 'screen', icon: MonitorPlay, title: 'Tela do palco', code: codes.screenCode, link: screenLink(),
      hint: 'Abra no MacBook espelhado na TV e coloque em tela cheia. Só mostra, não edita nada.',
    },
  ] : [];

  const showTitle = broadcast.showName;
  const accessBlock = (title: string, link: string, code: string) =>
    `*Link de acesso Teleprompter – ${title}:*\n${link}\n*Senha:* ${formatCode(code)}`;
  const copyMessage = (title: string, link: string, code: string) =>
    `Teleprompter – ${title} (${showTitle})\nLink: ${link}\nSenha: ${formatCode(code)}`;
  const waHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
  const allMessage = rows.length
    ? `Acessos do teleprompter – ${showTitle}\n\n` + rows.map((r) => accessBlock(r.title, r.link, r.code)).join('\n\n—————\n\n')
    : '';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl max-h-[85vh] overflow-hidden bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded-lg flex flex-col animate-[fadeIn_160ms_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-logic-border-dark">
          <div className="flex items-center gap-2">
            <MonitorPlay size={18} className="text-logic-accent" />
            <span className="text-sm font-semibold text-logic-text">Teleprompter</span>
          </div>
          <button onClick={onClose} className="text-logic-text-muted hover:text-logic-text transition-colors" title="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto logic-scroll px-5 py-4 space-y-3">
          {!show ? (
            <div className="text-center py-8">
              <Radio size={36} className="mx-auto text-logic-text-muted mb-3" />
              <p className="text-sm text-logic-text-dim mb-4 leading-relaxed">
                O teleprompter usa o show online. Publique o show primeiro: assim a letra acompanha o seu play na TV.
              </p>
              <button className="logic-btn-accent" onClick={onOpenShowManager}>Publicar o show</button>
            </div>
          ) : (
            <>
              <p className="text-xs text-logic-text-dim leading-relaxed">
                Mande o link e o código para quem vai cuidar do teleprompter. O link sozinho não abre nada: a pessoa precisa digitar ou colar o código.
                {!broadcast.onAir && <span className="text-logic-lcd-amber"> O show está fora do ar agora: ligue o envio no gerenciador do show para a letra acompanhar.</span>}
              </p>
              <PublicLinkNotice />

              {!codes && !error && <div className="py-6 flex justify-center"><Loader2 size={20} className="animate-spin text-logic-text-muted" /></div>}
              {error && (
                <div className="px-3 py-2 rounded bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-xs text-logic-lcd-red">
                  {error} <button className="underline ml-1" onClick={load}>Tentar de novo</button>
                </div>
              )}

              {rows.map(({ id, icon: Icon, title, hint, code, link }) => (
                <div key={id} className="rounded-lg border border-logic-border-dark bg-logic-bg-deep px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Icon size={15} className="text-logic-accent" />
                    <span className="text-sm font-semibold text-logic-text">{title}</span>
                  </div>
                  <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">{hint}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex-1 min-w-0 rounded-md border border-logic-lcd-amber/30 bg-logic-lcd-amber/5 px-3 py-2">
                      <span className="block text-2xs uppercase tracking-wider text-logic-text-muted">Código</span>
                      <span className="block text-xl font-semibold tabular-nums tracking-[0.2em] text-logic-lcd-amber select-all">{formatCode(code)}</span>
                    </div>
                    <button
                      className="shrink-0 h-12 px-3 flex items-center gap-1.5 rounded-md bg-logic-accent text-white text-xs font-medium hover:bg-logic-accent-hover active:scale-[0.97] transition-all"
                      onClick={() => copy(copyMessage(title, link, code), id)}
                      title="Copia o link e a senha escrita para a pessoa digitar"
                    >
                      <Copy size={14} /> {copied === id ? 'Copiado!' : 'Copiar link + senha'}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="flex-1 min-w-0 truncate text-xs text-logic-text-dim bg-logic-bg-panel px-2.5 py-1.5 rounded border border-logic-border-dark">{link}</span>
                    <button className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors" onClick={() => copy(formatCode(code), `${id}-code`)} title="Copiar só a senha">
                      <KeyRound size={13} /> {copied === `${id}-code` ? <span className="text-logic-lcd-green">Copiado!</span> : 'Senha'}
                    </button>
                    <a
                      className="p-1.5 rounded text-logic-text-muted hover:text-logic-lcd-green hover:bg-logic-bg-panel-light transition-colors"
                      href={waHref(`Teleprompter – ${showTitle}\n\n${accessBlock(title, link, code)}`)}
                      target="_blank" rel="noopener noreferrer" title="Enviar link e código por WhatsApp"
                    >
                      <Share2 size={14} />
                    </a>
                    <a className="p-1.5 rounded text-logic-text-muted hover:text-logic-accent hover:bg-logic-bg-panel-light transition-colors" href={link} target="_blank" rel="noopener noreferrer" title="Abrir em nova aba (vai pedir o código)">
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              ))}

              {codes && (
                <a
                  href={waHref(allMessage)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-md border border-logic-lcd-green/40 bg-logic-lcd-green/10 text-sm font-medium text-logic-lcd-green hover:bg-logic-lcd-green/20 transition-colors"
                >
                  <Share2 size={15} /> Enviar tudo para a equipe no WhatsApp
                </a>
              )}

              {codes && (
                <div className="rounded-lg border border-logic-border-dark bg-logic-bg-deep px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-logic-text">
                    <PenLine size={15} className="text-logic-accent" /> Show ativo
                    <span key={showTitle} className="ml-1 min-w-0 truncate px-2 py-0.5 rounded bg-logic-accent/15 text-xs font-medium text-logic-accent animate-[fadeIn_200ms_ease-out]">{showTitle}</span>
                  </div>
                  <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">Aparece automaticamente na tela do palco, para o produtor e para os músicos. Para trocar, ative outro show no menu Shows.</p>
                </div>
              )}

              {codes && <BandLogoUpload show={show} />}

              {codes && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-md border border-logic-border-dark bg-logic-bg-deep text-xs text-logic-text-dim leading-relaxed">
                  <FileText size={14} className="shrink-0 mt-0.5 text-logic-accent" />
                  <span>
                    {lyricSongs > 0
                      ? `Este projeto guarda o mapa de letra de ${lyricSongs} ${lyricSongs === 1 ? 'música' : 'músicas'}, sincronizado com o tempo de cada uma. Ao abrir o projeto de novo, as letras voltam para o teleprompter.`
                      : 'Quando o produtor tocar em "Salvar no projeto", os mapas de letra chegam aqui e ficam guardados junto com o projeto.'}
                  </span>
                </div>
              )}

              {codes && <PrompterAudioUpload sync={referenceSync} />}

              {codes && (
                confirmReset ? (
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded bg-logic-lcd-amber/10 border border-logic-lcd-amber/40">
                    <span className="text-xs text-logic-text flex-1">As senhas antigas param de funcionar e a TV e o produtor vão precisar digitar as novas. Trocar?</span>
                    <button className="px-3 py-1 rounded bg-logic-lcd-amber text-black text-xs font-medium disabled:opacity-50" onClick={reset} disabled={busy}>
                      {busy ? 'Trocando...' : 'Sim, trocar'}
                    </button>
                    <button className="logic-btn" onClick={() => setConfirmReset(false)}>Cancelar</button>
                  </div>
                ) : (
                  <button className="flex items-center gap-1.5 text-xs text-logic-text-muted hover:text-logic-lcd-amber transition-colors" onClick={() => setConfirmReset(true)}>
                    <RefreshCw size={13} /> Trocar as senhas (se alguma vazou)
                  </button>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
