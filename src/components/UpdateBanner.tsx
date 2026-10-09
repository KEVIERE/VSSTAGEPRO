import { useEffect, useState } from 'react';
import { AlertTriangle, DownloadCloud, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { UpdateInfo } from '@/lib/localNetwork';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Confere, de tempos em tempos (e quase na hora, via Supabase Realtime, sempre que o
 * backoffice publica algo novo), se existe uma versão diferente da instalada e avisa:
 *  - "required" (obrigatória): tela cheia, sem jeito de fechar — o app fica bloqueado
 *    até atualizar.
 *  - opcional: barra fina fixa no topo, também sem botão de fechar (fica visível até
 *    a pessoa atualizar), mas o app continua usável normalmente.
 * Ao clicar em "Atualizar agora", baixa e instala por cima do app atual, sem o diretor
 * precisar fazer nada: o processo principal (selfUpdate.js) baixa o .dmg, substitui o
 * .app e reabre sozinho.
 */
export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.vsDesktop) return;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    let alive = true;
    const check = async () => {
      try {
        const result = await window.vsDesktop!.checkUpdate(supabaseUrl);
        if (alive) setInfo(result);
      } catch { /* sem internet ou falha no feed: fica em silêncio */ }
    };
    check();
    const id = window.setInterval(check, CHECK_INTERVAL_MS);

    // Avisa quase na hora: o backoffice grava em release_events a cada publicação/rollback.
    const channel = supabase
      .channel('release-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'release_events' }, () => check())
      .subscribe();

    return () => { alive = false; window.clearInterval(id); supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!window.vsDesktop) return;
    return window.vsDesktop.onUpdateProgress(setProgress);
  }, []);

  if (!info || !window.vsDesktop) return null;

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await window.vsDesktop!.installUpdate(info);
      // Se chegou aqui sem o app reabrir, algo não finalizou — o processo principal
      // já cuidou de desfazer qualquer alteração parcial.
    } catch {
      setError('Não foi possível instalar agora. Tente de novo mais tarde.');
      setInstalling(false);
    }
  };

  const message = info.direction === 'upgrade'
    ? `Uma nova versão do VS Stage (${info.version}) está disponível.`
    : `Há uma atualização de manutenção disponível (versão ${info.version}).`;

  if (info.required) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-[fadeIn_200ms_ease-out]">
        <div className="max-w-sm w-full mx-4 bg-logic-bg-panel border border-logic-lcd-red/40 rounded-xl p-6 text-center shadow-2xl">
          <AlertTriangle size={28} className="mx-auto text-logic-lcd-red mb-3" />
          <h2 className="text-sm font-semibold text-logic-text mb-1">Atualização obrigatória</h2>
          <p className="text-xs text-logic-text-dim mb-4">
            {message} É preciso atualizar para continuar usando o VS Stage.
          </p>
          {error && <p className="text-2xs text-logic-lcd-red mb-3">{error}</p>}
          <button
            className="w-full h-9 rounded-md bg-logic-lcd-red text-white text-xs font-semibold hover:brightness-110 transition flex items-center justify-center gap-1.5 disabled:opacity-60"
            onClick={install}
            disabled={installing}
          >
            {installing ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
            {installing ? `Atualizando... ${Math.round(progress * 100)}%` : error ? 'Tentar de novo' : 'Atualizar agora'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 h-8 bg-logic-lcd-amber/10 border-b border-logic-lcd-amber/30 text-xs text-logic-lcd-amber animate-[fadeIn_200ms_ease-out]">
      {installing ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
      <span className="flex-1 truncate">
        {installing
          ? `Atualizando o VS Stage para a versão ${info.version}... ${Math.round(progress * 100)}%`
          : error
            ? error
            : `${message} Atualize para o bom funcionamento do programa.`}
      </span>
      {!installing && (
        <button
          className="px-2 h-6 rounded bg-logic-lcd-amber text-black font-semibold hover:brightness-110 transition flex items-center gap-1"
          onClick={install}
        >
          {error && <AlertTriangle size={11} />}
          {error ? 'Tentar de novo' : 'Atualizar agora'}
        </button>
      )}
    </div>
  );
}
