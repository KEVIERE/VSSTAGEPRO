import { useEffect, useState } from 'react';
import { FileText, Radio, X } from 'lucide-react';
import { useStore } from '@/store';
import { audioEngine, headPitchFor } from '@/lib/audioEngine';
import { startInstantStartBuilder } from '@/lib/instantStart';
import { pruneAudioLibrary, retainSongs } from '@/lib/audioLibrary';
import { computeNextSongId } from '@/lib/playFlow';
import { togglePlayPause, stopPlayback, startPlayback, watchPlaylistForNextSong } from '@/lib/transportControl';
import { beginGesture, endGesture } from '@/lib/undoGestures';
import MenuBar from '@/components/MenuBar';
import TransportBar from '@/components/TransportBar';
import PlaylistPanel from '@/components/PlaylistPanel';
import TimelinePanel from '@/components/TimelinePanel';
import ShowModePanel from '@/components/ShowModePanel';
import { saveCurrentProject } from '@/lib/projectQuickSave';
import BounceDialog from '@/components/BounceDialog';
import MixerPanel from '@/components/MixerPanel';
import ContextMenu from '@/components/ContextMenu';
import ErrorBoundary from '@/components/ErrorBoundary';
import ShowManagerDialog from '@/components/ShowManagerDialog';
import MusicianArea from '@/components/MusicianArea';
import StageScreenPage from '@/components/prompter/StageScreenPage';
import ProducerArea from '@/components/prompter/ProducerArea';
import PrompterDialog from '@/components/prompter/PrompterDialog';
import LocalMusicianArea from '@/components/LocalMusicianArea';
import LocalLanding from '@/components/LocalLanding';
import SplashScreen from '@/components/SplashScreen';
import ReopenLastBar from '@/components/ReopenLastBar';
import UpdateBanner from '@/components/UpdateBanner';
import EmailConfirmedPage from '@/components/EmailConfirmedPage';
import { emailLinkType } from '@/lib/supabaseClient';
import MacDownloadPage from '@/components/MacDownloadPage';
import SalesPage from '@/components/sales/SalesPage';
import DirectorAccess, { TrialBadge } from '@/components/DirectorAccess';
import SubscriptionReturn from '@/components/SubscriptionReturn';
import AdminPage from '@/components/admin/AdminPage';
import { trackFeature, useFeatureTracking } from '@/lib/featureUsage';
import type { License } from '@/components/DirectorAccess';
import LocalNetworkDialog from '@/components/network/LocalNetworkDialog';
import { isLocalClient } from '@/lib/localNetwork';
import { useLocalBroadcast } from '@/lib/useLocalBroadcast';
import { useReferenceAutoSync } from '@/lib/useReferenceAutoSync';
import { useLiveBroadcast } from '@/lib/useLiveBroadcast';
import { usePendingRequests } from '@/lib/usePendingRequests';
import { useProjectLyricsSync } from '@/lib/useProjectLyricsSync';

function routeFromUrl(): 'musician' | 'screen' | 'producer' | 'download' | 'director' | 'sales' | 'subscribed' | 'admin' {
  const { pathname, hash, search } = window.location;
  // No build de staging (servido em /staging/, mesmo domínio), o próprio prefixo
  // entra no pathname — ignora esse primeiro segmento pra rotear igual à produção.
  const seg = pathname.replace(/^\/+|\/+$/g, '').toLowerCase().replace(/^staging\/?/, '');
  if (seg === 'admin' || hash.startsWith('#admin')) return 'admin';
  if (seg === 'baixar') return 'download';
  if (seg === 'tela') return 'screen';
  if (seg === 'produtor') return 'producer';
  if (seg === 'musico') return 'musician';
  if (hash.startsWith('#baixar')) return 'download';
  if (hash.startsWith('#tela')) return 'screen';
  if (hash.startsWith('#produtor')) return 'producer';
  if (hash.startsWith('#m=') || hash.startsWith('#join=') || hash.startsWith('#musico')
    || new URLSearchParams(search).has('musico')) return 'musician';
  if (hash.startsWith('#assinatura')) return 'subscribed';
  if (hash.startsWith('#programa')) return 'director';
  // Na web pública, rota sem hash mostra a página de vendas. No app do Mac e na
  // preview do editor, o editor abre direto — lá não existe ambiente de publicidade.
  if (!hash && !window.vsDesktop) return 'sales';
  return 'director';
}

function App() {
  const [route, setRoute] = useState(routeFromUrl);
  // No app do Mac a abertura é uma janela própria, transparente, por cima da área de trabalho.
  const [splash, setSplash] = useState(() => !window.vsDesktop);

  useEffect(() => {
    const onHash = () => setRoute(routeFromUrl());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Link de confirmação de e-mail: mostra só o card de "confirmado", nunca o editor
  // ou a página de downloads por trás — independente de qual rota o link apontava.
  if (emailLinkType === 'signup') {
    return (
      <ErrorBoundary>
        <EmailConfirmedPage />
      </ErrorBoundary>
    );
  }

  if (route === 'screen') {
    return (
      <ErrorBoundary>
        <StageScreenPage />
      </ErrorBoundary>
    );
  }
  if (route === 'download') {
    return (
      <ErrorBoundary>
        <MacDownloadPage />
      </ErrorBoundary>
    );
  }
  if (route === 'producer') {
    return (
      <ErrorBoundary>
        <ProducerArea />
      </ErrorBoundary>
    );
  }
  if (route === 'musician') {
    return (
      <ErrorBoundary>
        {isLocalClient() ? <LocalMusicianArea /> : <MusicianArea />}
      </ErrorBoundary>
    );
  }
  if (route === 'admin') {
    return (
      <ErrorBoundary>
        <AdminPage />
      </ErrorBoundary>
    );
  }
  if (route === 'subscribed') {
    return (
      <ErrorBoundary>
        <SubscriptionReturn />
      </ErrorBoundary>
    );
  }
  if (route === 'sales') {
    return (
      <ErrorBoundary>
        <SalesPage />
      </ErrorBoundary>
    );
  }
  if (isLocalClient()) return <LocalLanding />;
  return (
    <>
      <DirectorAccess>
        {(license) => <DirectorApp license={license} />}
      </DirectorAccess>
      {splash && <SplashScreen onDone={() => setSplash(false)} />}
    </>
  );
}

function DirectorApp({ license }: { license: License }) {
  const [showManagerOpen, setShowManagerOpen] = useState(false);
  const [prompterOpen, setPrompterOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const broadcast = useLiveBroadcast();
  const local = useLocalBroadcast();
  const pendingRequests = usePendingRequests(broadcast.show);
  const lyricsSync = useProjectLyricsSync(broadcast.show);
  const referenceSync = useReferenceAutoSync(broadcast.show);
  const toggleMixer = useStore((s) => s.toggleMixer);
  const playlistMaximized = useStore((s) => s.playlistMaximized);
  const playlistVisible = useStore((s) => s.playlistVisible || s.showBpmTower || s.showTunerTower);

  useFeatureTracking();
  useEffect(() => { if (showManagerOpen) trackFeature('show_manager'); }, [showManagerOpen]);
  useEffect(() => { if (prompterOpen) trackFeature('teleprompter'); }, [prompterOpen]);
  useEffect(() => { if (localOpen) trackFeature('local_network'); }, [localOpen]);
  useEffect(() => { if (broadcast.onAir) trackFeature('broadcast'); }, [broadcast.onAir]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const temporal = useStore.temporal.getState();
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

      if (ctrl && key === 's') {
        e.preventDefault();
        if (!e.repeat) saveCurrentProject();
        return;
      }
      if (typing) return;

      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        temporal.undo();
      } else if ((ctrl && key === 'z' && e.shiftKey) || (ctrl && key === 'y')) {
        e.preventDefault();
        temporal.redo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        if (useStore.getState().playlistMaximized) startPlayback();
        else togglePlayPause();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const st = useStore.getState();
        if (st.playlistMaximized) st.togglePlaylistMaximized();
        else stopPlayback();
      } else if (e.key === 'm' && !ctrl) {
        e.preventDefault();
        toggleMixer();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const store = useStore.getState();
        if (store.selectedSongId && !e.target) {
          store.removeSong(store.selectedSongId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleMixer]);

  useEffect(() => {
    useStore.getState().reconcileTracks();
  }, []);

  useEffect(() => watchPlaylistForNextSong(), []);

  useEffect(() => {
    const id = requestAnimationFrame(() => window.vsDesktop?.appReady());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => startInstantStartBuilder({ isBusy: () => audioEngine.isStarting(), pitchFor: headPitchFor }), []);

  useEffect(() => {
    window.addEventListener('pointerdown', beginGesture, true);
    window.addEventListener('pointerup', endGesture, true);
    window.addEventListener('pointercancel', endGesture, true);
    window.addEventListener('blur', endGesture);
    return () => {
      window.removeEventListener('pointerdown', beginGesture, true);
      window.removeEventListener('pointerup', endGesture, true);
      window.removeEventListener('pointercancel', endGesture, true);
      window.removeEventListener('blur', endGesture);
    };
  }, []);

  useEffect(() => {
    const prewarm = () => {
      audioEngine.prewarm().catch(() => {});
      window.removeEventListener('pointerdown', prewarm);
      window.removeEventListener('keydown', prewarm);
    };
    window.addEventListener('pointerdown', prewarm, { once: true });
    window.addEventListener('keydown', prewarm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prewarm);
      window.removeEventListener('keydown', prewarm);
    };
  }, []);

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-selectable], button, input, textarea, select, [contenteditable], [role="menu"], [role="menuitem"]')) return;
    const st = useStore.getState();
    if (st.selectedSongId) st.selectSong(null);
    if (st.selectedTrackId) st.selectTrack(null);
    if (st.selectedClipIds.length) st.selectClip(null);
    if (st.selectedBlockId) st.selectBlock(null);
  };

  // Mantém o motor de áudio em dia APENAS quando campos relevantes mudam.
  // Mudanças de medidor (meterLevel, clipIndicator, clipPeak) são ignoradas
  // aqui para não disparar rampas de volume/pan 30 vezes por segundo —
  // essa cascata era o que causava o som trêmulo e a lentidão.
  useEffect(() => {
    let prevTracks = useStore.getState().tracks;
    let prevLr = useStore.getState().lrMasterActive;

    const soloHashOf = (ts: typeof prevTracks) => {
      let h = '';
      for (const t of ts) if (t.solo) h += t.id + '|';
      return h;
    };
    const muteHashOf = (ts: typeof prevTracks) => {
      let h = '';
      for (const t of ts) if (t.mute) h += t.id + '|';
      return h;
    };
    let prevSoloHash = soloHashOf(prevTracks);
    let prevMuteHash = muteHashOf(prevTracks);

    const unsub = useStore.subscribe((state) => {
      if (state.tracks !== prevTracks) {
        const nextSoloHash = soloHashOf(state.tracks);
        const nextMuteHash = muteHashOf(state.tracks);
        const soloOrMuteChanged = nextSoloHash !== prevSoloHash || nextMuteHash !== prevMuteHash;
        const prevById = new Map(prevTracks.map((t) => [t.id, t]));
        const toUpdate: typeof prevTracks = [];
        for (const t of state.tracks) {
          const p = prevById.get(t.id);
          if (!p) { toUpdate.push(t); continue; }
          if (p.volume !== t.volume || p.pan !== t.pan || p.mute !== t.mute || p.solo !== t.solo) {
            toUpdate.push(t);
          }
        }
        if (soloOrMuteChanged) {
          for (const track of state.tracks) {
            audioEngine.updateTrackParams(track.id, track, state.tracks);
          }
        } else if (toUpdate.length > 0) {
          for (const track of toUpdate) {
            audioEngine.updateTrackParams(track.id, track, state.tracks);
          }
        }
        prevTracks = state.tracks;
        prevSoloHash = nextSoloHash;
        prevMuteHash = nextMuteHash;
      }
      if (state.lrMasterActive !== prevLr) {
        prevLr = state.lrMasterActive;
        audioEngine.applyLRMaster(state.lrMasterActive);
      }
    });
    return unsub;
  }, []);

  // Mantém na memória só o áudio da música em uso, da selecionada e da próxima;
  // o das outras é liberado. O carregamento acontece em segundo plano. Reage apenas a
  // mudanças estruturais — BPM/afinador são aplicados ao vivo no preparo em cache.
  useEffect(() => {
    let timer: number | null = null;
    const schedule = (delay = 150) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const st = useStore.getState();
        // Durante a leitura dos arquivos de uma importação, a memória fica toda para ela.
        if (st.importProgress?.status === 'decoding') return;
        const selId = st.selectedSongId ?? st.playlist[0]?.songId ?? null;
        const playingId = st.transport.isStopped ? null : st.transport.currentSongId;
        const anchor = playingId ?? selId;
        const nextId = st.transport.nextSongId
          ?? (anchor ? computeNextSongId(anchor, st.playlist, st.playlistOrder, st.transport.playFlow) : null);
        const keep = [playingId, selId, nextId];
        const { pastStates, futureStates } = useStore.temporal.getState();
        const historyIds = new Set<string>();
        for (const h of [...pastStates, ...futureStates]) h.clips?.forEach((c) => historyIds.add(c.id));
        pruneAudioLibrary(new Set(st.clips.map((c) => c.id)), historyIds);
        retainSongs(keep);
        audioEngine.releaseUnretained(keep);
        const first = selId ?? playingId;
        const loadNext = () => {
          if (nextId && nextId !== first) audioEngine.prepareSong(nextId).catch(() => { /* silencioso */ });
        };
        if (first) audioEngine.prepareSong(first).catch(() => { /* silencioso */ }).finally(loadNext);
        else loadNext();
      }, delay);
    };

    let prev = useStore.getState();
    schedule(0);
    const unsub = useStore.subscribe((state) => {
      const transportStopped = prev.transport.isPlaying && !state.transport.isPlaying;
      const selectionChanged = state.selectedSongId !== prev.selectedSongId;
      const nextChanged = state.transport.nextSongId !== prev.transport.nextSongId
        || state.transport.currentSongId !== prev.transport.currentSongId;
      const clipsChanged = state.clips !== prev.clips;
      const playlistChanged = state.playlist !== prev.playlist;
      // BPM/afinador NÃO entram aqui: são aplicados ao vivo pelo
      // applySongPlaybackParams, que também atualiza o preparo em cache.
      // Reconstruir a cada clique no botão de BPM travaria o aplicativo.
      if (
        selectionChanged ||
        nextChanged ||
        clipsChanged ||
        playlistChanged ||
        transportStopped
      ) {
        prev = state;
        schedule(selectionChanged || nextChanged ? 0 : 180);
      } else {
        prev = state;
      }
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unsub();
    };
  }, []);

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-logic-bg-deep text-logic-text overflow-hidden relative" onMouseDown={handleBackdropMouseDown}>
        {!playlistMaximized && (
          <>
            <MenuBar
              trialBadge={<TrialBadge license={license} />}
              onOpenShowManager={() => setShowManagerOpen(true)} onOpenPrompter={() => setPrompterOpen(true)}
              onOpenLocal={() => setLocalOpen(true)} broadcast={broadcast} local={local}
              pendingRequests={pendingRequests}
            />
            <TransportBar />
          </>
        )}
        <ReopenLastBar />
        <UpdateBanner />
        {broadcast.onAir && broadcast.yielded && (
          <div className="flex items-center gap-3 px-3 h-8 bg-logic-lcd-amber/10 border-b border-logic-lcd-amber/30 text-xs text-logic-lcd-amber animate-[fadeIn_200ms_ease-out]">
            <Radio size={13} />
            <span className="flex-1 truncate">O show está sendo transmitido por outra aba deste computador. Esta aba não envia nada para músicos e teleprompter.</span>
            <button className="px-2 h-6 rounded bg-logic-lcd-amber text-black font-semibold hover:brightness-110 transition" onClick={broadcast.takeOver}>
              Transmitir daqui
            </button>
          </div>
        )}
        {(lyricsSync.received || local.lyricsReceived !== null) && (() => {
          const songs = lyricsSync.received?.songs ?? local.lyricsReceived ?? 0;
          const dismiss = () => { lyricsSync.dismiss(); local.dismissLyrics(); };
          return (
          <div className="flex items-center gap-3 px-3 h-8 bg-logic-lcd-green/10 border-b border-logic-lcd-green/30 text-xs text-logic-lcd-green animate-[fadeIn_200ms_ease-out]">
            <FileText size={13} />
            <span className="flex-1 truncate">
              O produtor enviou os mapas de letra ({songs} {songs === 1 ? 'música' : 'músicas'}). Eles já estão no projeto: salve para guardá-los no arquivo.
            </span>
            <button
              className="px-2 h-6 rounded bg-logic-lcd-green text-black font-semibold hover:brightness-110 transition"
              onClick={() => { dismiss(); saveCurrentProject(); }}
            >
              Salvar projeto
            </button>
            <button className="p-1 rounded hover:bg-white/10 transition" onClick={dismiss} aria-label="Fechar aviso">
              <X size={12} />
            </button>
          </div>
          );
        })()}

        <div className="flex flex-1 overflow-hidden">
          {playlistMaximized ? (
            <>
              <div className="flex flex-col flex-1 min-w-0 min-h-0">
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PlaylistPanel />
                </div>
                <MixerPanel />
              </div>
              <ShowModePanel showName={broadcast.showName} />
            </>
          ) : (
            <>
              {playlistVisible && <PlaylistPanel />}
              <TimelinePanel />
            </>
          )}
        </div>

        {!playlistMaximized && <MixerPanel />}
        <ContextMenu />
        <BounceDialog />
        <ShowManagerDialog open={showManagerOpen} onClose={() => setShowManagerOpen(false)} broadcast={broadcast} />
        {localOpen && <LocalNetworkDialog local={local} onClose={() => setLocalOpen(false)} />}
        {prompterOpen && (
          <PrompterDialog
            broadcast={broadcast}
            lyricSongs={lyricsSync.songsInProject}
            referenceSync={referenceSync}
            onClose={() => setPrompterOpen(false)}
            onOpenShowManager={() => { setPrompterOpen(false); setShowManagerOpen(true); }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
