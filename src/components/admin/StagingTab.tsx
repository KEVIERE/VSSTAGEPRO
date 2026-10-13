import { useState, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Laptop,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorPlay,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi } from '@/components/admin/adminApi';
import { btnGhost, btnPrimary, Panel } from '@/components/admin/ui';

// Ambiente de staging (teste interno) — abre direto no editor, sem #programa
const STAGING_URL = 'https://vsstagepro.com.br/staging/';

export default function StagingTab() {
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showEmbeddedPreview, setShowEmbeddedPreview] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeContainerRef = useRef<HTMLDivElement>(null);

  const promote = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setPromoting(true);
    setMsg(null);
    try {
      await adminApi.promoteToProduction();
      setMsg({
        ok: true,
        text: 'Upgrade disparado com sucesso! O site principal e os instaladores do Mac estão sendo atualizados no GitHub Actions.',
      });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError((e as Error).message) });
    } finally {
      setPromoting(false);
      setConfirming(false);
    }
  };

  const toggleFullscreen = () => {
    if (!iframeContainerRef.current) return;
    if (!document.fullscreenElement) {
      iframeContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <FlaskConical size={20} className="text-logic-lcd-amber" />
              <span>Ambiente de Teste Interno (Staging)</span>
            </h2>
            <span className="px-2 py-0.5 rounded text-2xs font-extrabold bg-logic-lcd-amber/15 text-logic-lcd-amber border border-logic-lcd-amber/30">
              ISOLADO (/staging)
            </span>
          </div>
          <p className="text-xs text-logic-text-dim mt-1">
            Espaço seguro para testar novas funções, roteamento de áudio, timelines e o motor DAW antes de publicar para os clientes.
          </p>
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

      {/* Card Destaque: Abrir em Tela Cheia (Recomendado) */}
      <div className="rounded-2xl p-6 bg-gradient-to-br from-[#12141c] to-[#0c0d12] border border-white/15 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-logic-lcd-green/10 border border-logic-lcd-green/30 text-logic-lcd-green text-2xs font-bold uppercase tracking-wider">
              <Sparkles size={12} />
              <span>Experiência Recomendada para DAW</span>
            </div>
            <h3 className="text-lg font-black text-white">
              Testar o VS Stage Pro em Tela Cheia (Nova Aba)
            </h3>
            <p className="text-xs text-logic-text-dim leading-relaxed">
              O VS Stage Pro é uma estação de áudio digital completa (DAW) com timelines multitrack, mixer de múltiplos canais, torre de BPM e Timecode LTC. Para que todos os botões, faders e menus fiquem perfeitamente alinhados e sem sobreposição de controles, teste sempre em resolução completa no seu navegador.
            </p>

            <div className="flex items-center gap-4 pt-2 text-2xs text-logic-text-muted">
              <span className="flex items-center gap-1">
                <ShieldCheck size={13} className="text-logic-lcd-green" /> Não afeta clientes em produção
              </span>
              <span className="flex items-center gap-1">
                <Layers size={13} className="text-logic-lcd-amber" /> Dados e projetos sincronizados
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 w-full lg:w-auto shrink-0">
            <a
              href={STAGING_URL}
              target="_blank"
              rel="noreferrer"
              className="px-6 py-3.5 rounded-xl btn-neon-green text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg shadow-logic-lcd-green/20 hover:scale-[1.02] transition"
            >
              <ExternalLink size={15} />
              <span>Abrir Staging em Tela Cheia</span>
            </a>

            <button
              type="button"
              onClick={() => setShowEmbeddedPreview(!showEmbeddedPreview)}
              className="px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-white font-bold text-xs flex items-center justify-center gap-2 transition"
            >
              <MonitorPlay size={14} className="text-logic-lcd-amber" />
              <span>{showEmbeddedPreview ? 'Ocultar Pré-visualização Embutida' : 'Ver Pré-visualização no Painel'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Card: Upgrade de Produção */}
      <Panel
        title={
          <div className="flex items-center gap-2 text-white">
            <Rocket size={15} className="text-logic-lcd-green" />
            <span>Publicação Oficial (Upgrade de Produção)</span>
          </div>
        }
        actions={
          confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-2xs text-logic-lcd-amber font-semibold flex items-center gap-1">
                <AlertTriangle size={12} /> Confirma publicar para todos agora?
              </span>
              <button
                type="button"
                className={btnGhost}
                onClick={() => setConfirming(false)}
                disabled={promoting}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={promote}
                disabled={promoting}
              >
                {promoting ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
                <span>Sim, publicar agora</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="px-3.5 py-1.5 rounded-lg bg-logic-lcd-green text-black font-bold text-xs hover:brightness-110 transition flex items-center gap-1.5"
              onClick={promote}
              disabled={promoting}
            >
              <Rocket size={13} />
              <span>Upgrade de Produção</span>
            </button>
          )
        }
      >
        <div className="p-4 space-y-2 text-xs text-logic-text-dim leading-relaxed">
          <p>
            Depois de validar suas alterações no ambiente de Staging, clique em <strong className="text-white">Upgrade de Produção</strong> para:
          </p>
          <ul className="list-disc list-inside space-y-1 text-2xs text-logic-text-muted pl-1">
            <li>Publicar o novo código no site oficial (<strong className="text-white">vsstagepro.com.br</strong>).</li>
            <li>Gerar automaticamente os novos instaladores para Mac (<strong className="text-white">Apple Silicon e Intel</strong>).</li>
            <li>Notificar os clientes que já estão com o app aberto para atualizarem em 1 clique.</li>
          </ul>
        </div>
      </Panel>

      {/* Pré-visualização Embutida (Ajustada com Scroll e Modo Tela Cheia) */}
      {showEmbeddedPreview && (
        <Panel
          title={
            <div className="flex items-center gap-2 text-white">
              <MonitorPlay size={14} className="text-logic-lcd-amber" />
              <span>Pré-visualização do Staging no Painel</span>
            </div>
          }
          className="overflow-hidden"
          actions={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={btnGhost}
                onClick={() => setReloadKey((k) => k + 1)}
                aria-label="Recarregar preview"
                title="Recarregar pré-visualização"
              >
                <RefreshCw size={12} /> Recarregar
              </button>

              <button
                type="button"
                className={btnGhost}
                onClick={toggleFullscreen}
                title="Expandir pré-visualização para a tela inteira do monitor"
              >
                {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                <span>{isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}</span>
              </button>

              <a
                href={STAGING_URL}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-logic-lcd-green/20 text-logic-lcd-green border border-logic-lcd-green/40 text-xs font-bold transition flex items-center gap-1"
                title="Abre o staging em tela cheia numa nova aba"
              >
                <ExternalLink size={12} /> Nova Aba
              </a>
            </div>
          }
        >
          {/* Alerta de resolução para DAWs */}
          <div className="px-4 py-2 bg-logic-lcd-amber/10 border-b border-logic-lcd-amber/20 text-2xs text-logic-lcd-amber flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={13} className="shrink-0" />
              <span>
                <strong>Atenção:</strong> Por estar dentro de uma janela menor, alguns botões e canais do mixer podem se ajustar ao espaço. Para a experiência 100% perfeita de estúdio, clique em <strong>Nova Aba</strong> ou <strong>Tela Cheia</strong>.
              </span>
            </span>
          </div>

          <div
            ref={iframeContainerRef}
            className="w-full h-[80vh] min-h-[650px] bg-black overflow-auto"
          >
            <iframe
              key={reloadKey}
              src={STAGING_URL}
              title="VS Stage Pro — Teste interno"
              className="w-full h-full min-w-[1100px] min-h-[600px] border-0"
              allow="autoplay; clipboard-write; microphone"
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
