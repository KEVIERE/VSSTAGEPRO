import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import type { SavedShow } from '@/lib/useLiveBroadcast';
import type { ProjectState } from '@/types';
import { directorLyricStyleGet, directorLyricStyleRestore, directorLyricsAck, directorLyricsGet, directorLyricsRestore } from '@/lib/prompterApi';
import { sameLyricStyle, type LyricStyle } from '@/lib/prompterTypes';

const POLL_MS = 15000;

// O aviso de letras concluídas fica preso até o diretor confirmar. Guardamos por show a marca
// do último pedido já confirmado, para o lembrete voltar ao reabrir o programa.
const confirmedKey = (showId: string) => `prompter-lyrics-confirmed:${showId}`;

function loadConfirmed(showId: string): string | null {
  try { return localStorage.getItem(confirmedKey(showId)); } catch { return null; }
}

function saveConfirmed(showId: string, at: string): void {
  try { localStorage.setItem(confirmedKey(showId), at); } catch { /* sem espaço */ }
}

export interface ProjectLyricsSync {
  /** O produtor concluiu as letras e o diretor ainda não confirmou. Fica de pé até o "Confirmar". */
  received: { songs: number; at: number } | null;
  /** Fecha o aviso só nesta sessão: ele volta ao reabrir o programa, até confirmar. */
  dismiss: () => void;
  /** Confirmar deu certo: não apaga arquivos (quem apaga é o chamador, via clearShowAudio). */
  confirm: () => void;
  /** Quantas músicas têm letra no projeto — o aviso mostra esse número. */
  songsInProject: number;
}

export function useProjectLyricsSync(show: SavedShow | null): ProjectLyricsSync {
  const [received, setReceived] = useState<ProjectLyricsSync['received']>(null);
  const lyricMaps = useStore((s) => s.lyricMaps);
  const ownMaps = useRef<ProjectState['lyricMaps'] | null>(null);
  const restoredFor = useRef<ProjectState['lyricMaps'] | null>(null);
  const lyricStyle = useStore((s) => s.lyricStyle ?? null);
  // estilo que veio do produtor (não volta para o show) e o último devolvido ao show
  const receivedStyle = useRef<LyricStyle | null>(null);
  const restoredStyle = useRef<LyricStyle | null>(null);
  const requestedAt = useRef<string | null>(null);
  // Pedido que o diretor fechou com "Depois": não volta nesta sessão (volta ao reabrir).
  const dismissed = useRef<string | null>(null);

  // Ao abrir um projeto com mapas, devolve ao show as letras que ainda não estão online.
  useEffect(() => {
    if (!show || lyricMaps === ownMaps.current || lyricMaps === restoredFor.current) return;
    restoredFor.current = lyricMaps;
    const songIds = new Set(useStore.getState().songs.map((s) => s.id));
    const mine = Object.fromEntries(Object.entries(lyricMaps).filter(([id]) => songIds.has(id)));
    directorLyricsRestore(show.showId, show.directorKey, mine).catch(() => { restoredFor.current = null; });
  }, [show, lyricMaps]);

  // Projeto aberto (aqui ou em outro computador): a letra volta a ter o estilo gravado nele.
  useEffect(() => {
    if (!show || !lyricStyle || lyricStyle === receivedStyle.current || lyricStyle === restoredStyle.current) return;
    restoredStyle.current = lyricStyle;
    directorLyricStyleRestore(show.showId, show.directorKey, lyricStyle).catch(() => { restoredStyle.current = null; });
  }, [show, lyricStyle]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await directorLyricsGet(show.showId, show.directorKey);
        if (cancelled || !res.requestedAt) return;
        requestedAt.current = res.requestedAt;
        const pending = loadConfirmed(show.showId) !== res.requestedAt && dismissed.current !== res.requestedAt;
        // Enquanto o diretor não confirmar, o lembrete fica de pé — inclusive depois de o
        // projeto já ter sido salvo uma vez.
        if (pending) setReceived((prev) => prev ?? { songs: res.lyrics.length, at: Date.now() });

        // As letras novas entram no projeto uma vez só (depois do "Salvar projeto" já estão lá).
        if (res.savedAt && Date.parse(res.savedAt) >= Date.parse(res.requestedAt)) return;
        const st = useStore.getState();
        const songIds = new Set(st.songs.map((s) => s.id));
        const next: ProjectState['lyricMaps'] = { ...st.lyricMaps };
        for (const l of res.lyrics) {
          if (!songIds.has(l.song_id)) continue;
          if (l.pages.length > 0) next[l.song_id] = l.pages;
          else delete next[l.song_id];
        }
        ownMaps.current = next;
        st.setLyricMaps(next);
        // tamanho, cor, fonte e "sai antes" vão para o projeto junto com as letras
        try {
          const style = await directorLyricStyleGet(show.showId, show.directorKey);
          if (!cancelled && style && !sameLyricStyle(style, useStore.getState().lyricStyle)) {
            receivedStyle.current = style;
            useStore.getState().setLyricStyle(style);
          }
        } catch { /* sem o estilo, as letras entram assim mesmo */ }
        await directorLyricsAck(show.showId, show.directorKey);
        if (!cancelled) setReceived({ songs: Object.keys(next).length, at: Date.now() });
      } catch {
        // Sem conexão: tenta de novo no próximo ciclo.
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [show]);

  // "Depois": some só nesta sessão. Ao reabrir o programa, o lembrete volta — é o combinado.
  const dismiss = useCallback(() => {
    dismissed.current = requestedAt.current;
    setReceived(null);
  }, []);

  // Marca este pedido como resolvido: a marca fica no aparelho, por show, e o aviso não volta.
  const confirm = useCallback(() => {
    if (!show) return;
    const at = requestedAt.current;
    if (at) saveConfirmed(show.showId, at);
    dismissed.current = null;
    setReceived(null);
  }, [show]);

  return { received, dismiss, confirm, songsInProject: Object.keys(lyricMaps).length };
}
