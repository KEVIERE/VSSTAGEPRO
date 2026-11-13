import AiStemSeparatorDialog from '@/components/AiStemSeparatorDialog';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import { useStore } from '@/store';
import { isPixReturnSearch } from '@/lib/pixReturn';
import { captureAffiliateRef } from '@/lib/affiliateRef';
import { claimAffiliateRef } from '@/lib/affiliateApi';
import { trackSiteVisit } from '@/lib/siteVisits';
import { audioEngine, headPitchFor } from '@/lib/audioEngine';
import { startInstantStartBuilder } from '@/lib/instantStart';
import { pruneAudioLibrary, retainSongs } from '@/lib/audioLibrary';
import { computeNextSongId } from '@/lib/playFlow';
import { togglePlayPause, stopPlayback, startPlayback, watchPlaylistForNextSong } from '@/lib/transportControl';
import { beginGesture, endGesture } from '@/lib/undoGestures';
import MenuBar from '@/components/MenuBar';
import AudioDeviceDialog from '@/components/AudioDeviceDialog';
import TransportBar from '@/components/TransportBar';
import PlaylistPanel from '@/components/PlaylistPanel';
import TimelinePanel from '@/components/TimelinePanel';
import ShowModePanel from '@/components/ShowModePanel';
import { loadOpenedProject, saveCurrentProject } from '@/lib/projectQuickSave';
import { createCoalescedSave } from '@/lib/coalesceSave';
import { openProjectFromPath } from '@/lib/projectSaver';
import { friendlyError } from '@/lib/friendlyError';
import BounceDialog from '@/components/BounceDialog';
import MixerPanel from '@/components/MixerPanel';
import { PadsOrMixer } from '@/components/SamplePadPanel';
import ContextMenu from '@/components/ContextMenu';
import ErrorBoundary from '@/components/ErrorBoundary';
import ShowManagerDialog from '@/components/ShowManagerDialog';
import { startMusicianBookSync } from '@/lib/musicianBookSync';
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
import { confirmLanding } from '@/lib/confirmLanding';
import ResetPasswordPage from '@/components/ResetPasswordPage';
import { emailLinkType, supabase } from '@/lib/supabaseClient';
// Páginas só do site (vendas, planos, download, admin, retorno da assinatura): o programa do
// diretor nunca abre nenhuma delas, então ficam fora do carregamento da abertura.
const MacDownloadPage = lazy(() => import('@/components/MacDownloadPage'));
const SalesPage = lazy(() => import('@/components/sales/SalesPage'));
const PricingPage = lazy(() => import('@/components/sales/PricingPage'));
const SubscriptionReturn = lazy(() => import('@/components/SubscriptionReturn'));
const AdminPage = lazy(() => import('@/components/admin/AdminPage'));
const AffiliatePage = lazy(() => import('@/components/affiliate/AffiliatePage'));
import DirectorAccess, { TrialBadge } from '@/components/DirectorAccess';
import MobileShowRemote from '@/components/MobileShowRemote';
import MissingAudioDialog from '@/components/MissingAudioDialog';
import UnsavedChangesDialog from '@/components/UnsavedChangesDialog';
import { confirmLeaveProject, watchUnsavedChanges } from '@/lib/unsavedChanges';
import { copyClips, duplicateClips, pasteClips } from '@/lib/clipClipboard';
import { trackFeature, useFeatureTracking } from '@/lib/featureUsage';
import type { License } from '@/components/DirectorAccess';
import LocalNetworkDialog from '@/components/network/LocalNetworkDialog';
import { isLocalClient } from '@/lib/localNetwork';
import { useLocalBroadcast } from '@/lib/useLocalBroadcast';
import { applyRemoteCommand } from '@/lib/remoteHost';
import { useOnlineRemote } from '@/lib/useOnlineRemote';
import { useReferenceAutoSync } from '@/lib/useReferenceAutoSync';
import { useLiveBroadcast } from '@/lib/useLiveBroadcast';
import { usePendingRequests } from '@/lib/usePendingRequests';
import JoinRequestsBanner from '@/components/JoinRequestsBanner';
import StemSplitStatus from '@/components/StemSplitStatus';
import ClickStatus from '@/components/ClickStatus';
import { useProjectLyricsSync } from '@/lib/useProjectLyricsSync';
import { startAudioOutputWatcher } from '@/lib/audioOutput';
import { startSongLevelWatcher } from '@/lib/songLevelWatcher';
import { startSongKeyWatcher } from '@/lib/songKeyWatcher';

// Enquanto chega o código de uma página do site: só o fundo, sem piscar branco.
function SitePageFallback() {
  return <div className="min-h-screen bg-black" />;
}

function routeFromUrl(): 'musician' | 'screen' | 'producer' | 'download' | 'director' | 'sales' | 'subscribed' | 'admin' | 'recovery' | 'pricing' | 'remote' | 'affiliate' {
  const { pathname, hash, search } = window.location;
  // No build de staging (servido em /staging/, mesmo domínio), o próprio prefixo
  // entra no pathname — ignora esse primeiro segmento pra rotear igual à produção.
  const seg = pathname.replace(/^\/+|\/+$/g, '').toLowerCase().replace(/^staging\/?/, '');
  if (seg === 'show' || seg === 'controle' || seg === 'remoto' || hash.startsWith('#show') || hash.startsWith('#controle') || hash.startsWith('#remoto')) return 'remote';
  if (seg === 'admin' || hash.startsWith('#admin')) return 'admin';
  if (seg === 'afiliado' || hash.startsWith('#afiliado')) return 'affiliate';
  if (
    seg === 'recuperar' ||
    seg === 'recuperar-senha' ||
    hash.startsWith('#recuperar') ||
    hash.startsWith('#reset') ||
    hash.includes('error_code=otp_expired') ||
    hash.includes('Email+link') ||
    hash.includes('type=recovery') ||
    search.includes('type=recovery')
  ) return 'recovery';
  if (seg === 'planos' || seg === 'assinar' || hash.startsWith('#planos') || hash.startsWith('#assinar')) return 'pricing';
  if (seg === 'baixar') return 'download';
  if (seg === 'tela') return 'screen';
  if (seg === 'produtor') return 'producer';
  if (seg === 'musico') return 'musician';
  if (hash.startsWith('#baixar')) return 'download';
  if (hash.startsWith('#tela')) return 'screen';
  if (hash.startsWith('#produtor')) return 'producer';
  if (hash.startsWith('#m=') || hash.startsWith('#join=') || hash.startsWith('#musico')
    || new URLSearchParams(search).has('musico')) return 'musician';
  // No celular/smartphone ou tablet na web pública, NUNCA abre o editor DAW (que fica tela preta no mobile).
  // Sempre direciona para a página de vendas oficial (ou áreas específicas: músico, tela, produtor, controle remoto, download, planos).
  const isMobileDevice = typeof window !== 'undefined' && (
    window.innerWidth < 768 ||
    /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent)
  );

  if (isMobileDevice && !window.vsDesktop) {
    if (hash.startsWith('#show') || hash.startsWith('#controle') || hash.startsWith('#remoto') || seg === 'show' || seg === 'controle' || seg === 'remoto') return 'remote';
    if (hash.startsWith('#assinatura') || seg === 'assinatura' || hash.startsWith('#obrigado') || seg === 'obrigado' || isPixReturnSearch(search)) return 'subscribed';
    if (hash.startsWith('#baixar') || seg === 'baixar') return 'download';
    if (hash.startsWith('#planos') || seg === 'planos' || hash.startsWith('#assinar')) return 'pricing';
    if (hash.startsWith('#musico') || hash.startsWith('#m=') || hash.startsWith('#join=') || new URLSearchParams(search).has('musico')) return 'musician';
    if (hash.startsWith('#tela') || seg === 'tela') return 'screen';
    if (hash.startsWith('#produtor') || seg === 'produtor') return 'producer';
    if (seg === 'admin' || hash.startsWith('#admin')) return 'admin';
    if (seg === 'afiliado' || hash.startsWith('#afiliado')) return 'affiliate';
    if (seg === 'recuperar' || hash.startsWith('#recuperar')) return 'recovery';
    return 'sales';
  }

  if (hash.startsWith('#assinatura') || seg === 'assinatura' || hash.startsWith('#obrigado') || seg === 'obrigado' || isPixReturnSearch(search)) return 'subscribed';
  if (hash.startsWith('#programa')) return 'director';

  // Na web pública, rota sem hash ou apenas "#" mostra a página de vendas (nunca o editor/tela preta).
  // No app do Mac ou em /staging/ (desktop), abre o editor.
  const isBareOrEmptyHash = !hash || hash === "#" || hash === "#/" || hash === "#!";
  if (isBareOrEmptyHash && !window.vsDesktop) {
    return /^\/staging(\/|$)/i.test(pathname) && !isMobileDevice ? "director" : "sales";
  }

  // Na web pública em navegadores (fora do app desktop oficial do Mac):
  // NUNCA abre o editor desktop (que fica tela preta). Sempre vai para a página de vendas!
  if (!window.vsDesktop) {
    if (/^\/staging(\/|$)/i.test(pathname) && !isMobileDevice) return "director";
    return "sales";
  }

  return "director";
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

  // Visitas do site para a aba "Acessos" do admin (o próprio admin não conta).
  useEffect(() => {
    if (route !== 'admin') trackSiteVisit(route);
  }, [route]);

  // Trava scroll apenas quando o editor/DAW estiver aberto. Em páginas públicas
  // (vendas, downloads, planos, admin), o scroll vertical nativo corre livremente.
  useEffect(() => {
    if (route === 'director') {
      document.documentElement.style.height = '100%';
      document.documentElement.style.overflow = 'hidden';
      document.body.style.height = '100%';
      document.body.style.overflow = 'hidden';
      const root = document.getElementById('root');
      if (root) {
        root.style.height = '100%';
        root.style.overflow = 'hidden';
      }
      return () => {
        document.documentElement.style.height = '';
        document.documentElement.style.overflow = '';
        document.body.style.height = '';
        document.body.style.overflow = '';
        if (root) {
          root.style.height = '';
          root.style.overflow = '';
        }
      };
    }
  }, [route]);

  const [isRecovery, setIsRecovery] = useState(() => emailLinkType === 'recovery');

  useEffect(() => {
    // Link de afiliado (?ref=CODIGO): guarda o código por 60 dias. Quando a pessoa entra na
    // conta (qualquer tela de cadastro ou login do site), liga a conta ao afiliado uma vez.
    if (!window.vsDesktop) captureAffiliateRef();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        // fora do fluxo do Supabase Auth: chamar o banco dentro do aviso pode travar a sessão
        window.setTimeout(() => { claimAffiliateRef().catch(() => {}); }, 0);
      }
      if (event === "PASSWORD_RECOVERY") {
        try { sessionStorage.setItem("vs_password_recovery", "1"); } catch {}
        setIsRecovery(true);
        setRoute("recovery");
      }
    });
    return () => sub?.subscription?.unsubscribe();
  }, []);

  // Link ou rota de recuperação de senha: abre a página dedicada para criar nova senha
  if (emailLinkType === 'recovery' || isRecovery || route === 'recovery') {
    return (
      <ErrorBoundary>
        <ResetPasswordPage />
      </ErrorBoundary>
    );
  }

  // Link de confirmação de e-mail: nunca o editor por trás, qualquer que seja a rota do link.
  // Conta do programa vai direto para a página de downloads; conta do músico, para o card dele.
  const landing = confirmLanding(emailLinkType, window.location.search);
  if (landing === 'musician') {
    return (
      <ErrorBoundary>
        <EmailConfirmedPage />
      </ErrorBoundary>
    );
  }
  if (landing === 'download') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<SitePageFallback />}><MacDownloadPage /></Suspense>
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
        <Suspense fallback={<SitePageFallback />}><MacDownloadPage /></Suspense>
      </ErrorBoundary>
    );
  }
  if (route === 'remote') {
    return (
      <ErrorBoundary>
        <MobileShowRemote />
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
        <Suspense fallback={<SitePageFallback />}><AdminPage /></Suspense>
      </ErrorBoundary>
    );
  }
  if (route === 'affiliate') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<SitePageFallback />}><AffiliatePage /></Suspense>
      </ErrorBoundary>
    );
  }
  if (route === 'subscribed') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<SitePageFallback />}><SubscriptionReturn /></Suspense>
      </ErrorBoundary>
    );
  }
  if (route === 'pricing') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<SitePageFallback />}><PricingPage /></Suspense>
      </ErrorBoundary>
    );
  }
  if (route === 'sales') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<SitePageFallback />}><SalesPage /></Suspense>
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

// O ⌘M pode chegar pelo menu do app do Mac e pelo teclado ao mesmo tempo: um aperto troca uma vez só.
let lastShowToggle = 0;
function toggleShowMode() {
  const now = Date.now();
  if (now - lastShowToggle < 300) return;
  lastShowToggle = now;
  useStore.getState().togglePlaylistMaximized();
}

function DirectorApp({ license }: { license: License }) {
  const [showManagerOpen, setShowManagerOpen] = useState(false);
  const [prompterOpen, setPrompterOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [aiSeparatorOpen, setAiSeparatorOpen] = useState(false);
  const broadcast = useLiveBroadcast();
  const local = useLocalBroadcast();
  // VS Stage Remote pelo Show Online (na Rede Local ele vai pelo servidor do Mac)
  useOnlineRemote(local.mode === 'online' && !broadcast.yielded);
  const joinRequests = usePendingRequests(broadcast.show);
  const pendingRequests = joinRequests.pending.length;
  const lyricsSync = useProjectLyricsSync(broadcast.show);
  const referenceSync = useReferenceAutoSync(broadcast.show);
  const toggleMixer = useStore((s) => s.toggleMixer);
  const playlistMaximized = useStore((s) => s.playlistMaximized);
  const playlistVisible = useStore((s) => s.playlistVisible || s.showBpmTower || s.showTunerTower);
  const audioDeviceDialogOpen = useStore((s) => s.audioDeviceDialogOpen);

  // Quando o produtor salva as letras, o programa guarda o projeto sozinho.
  // Mas gravar no arquivo pode precisar da permissão do Mac, que só vale com um clique da
  // pessoa: sem clique, a gravação falhava em silêncio e as letras ficavam só na memória
  // (sumiam ao fechar). Agora, se não gravar, fica uma faixa de aviso até o diretor salvar.
  const [lyricsNotSaved, setLyricsNotSaved] = useState(false);
  const saveKind = useStore((s) => s.saveStatus?.kind);
  useEffect(() => { if (saveKind === 'saved') setLyricsNotSaved(false); }, [saveKind]);
  // O produtor pode salvar várias vezes seguidas: vale a última. Espera os pedidos pararem e salva
  // uma vez só (e nunca enquanto outro salvamento ainda está gravando).
  const producerSave = useMemo(() => createCoalescedSave({
    delayMs: 3000,
    busy: () => useStore.getState().saveStatus?.kind === 'saving',
    run: () => saveCurrentProject(),
    onDone: (ok) => { if (!ok) setLyricsNotSaved(true); },
  }), []);
  useEffect(() => {
    if (!lyricsSync.received && local.lyricsReceived === null) return;
    producerSave.request();
    lyricsSync.confirm();
    local.dismissLyrics();
  }, [lyricsSync, local, producerSave]);

  useFeatureTracking();
  // contas e cadernos dos músicos: projeto <-> rede local
  useEffect(() => startMusicianBookSync(), []);
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
      const isTextInput = !!el && (
        el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range', 'submit'].includes((el as HTMLInputElement).type?.toLowerCase())) ||
        el.isContentEditable
      );

      // Barra de espaço para Play/Pause tem prioridade absoluta:
      // se o foco estiver em um botão ou select, desmarca o foco e toca a música,
      // nunca reabrindo menus ou clicando no botão.
      if (e.code === 'Space') {
        if (isTextInput) return;
        e.preventDefault();
        el?.blur?.();
        if (e.repeat) return;
        if (useStore.getState().playlistMaximized) startPlayback();
        else togglePlayPause();
        return;
      }

      if (ctrl && key === 's') {
        e.preventDefault();
        if (!e.repeat) saveCurrentProject();
        return;
      }
      if (isTextInput || el?.tagName === 'SELECT') return;

      if (ctrl && key === 'c') {
        const count = copyClips();
        if (count > 0) e.preventDefault();
        return;
      }
      if (ctrl && key === 'v') {
        const pasted = pasteClips();
        if (pasted.length > 0) e.preventDefault();
        return;
      }
      if (ctrl && key === 'd') {
        const dups = duplicateClips();
        if (dups.length > 0) e.preventDefault();
        return;
      }

      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        temporal.undo();
      } else if ((ctrl && key === 'z' && e.shiftKey) || (ctrl && key === 'y')) {
        e.preventDefault();
        temporal.redo();
      } else if (e.key === 'Escape') {
        // uma janela ou menu aberto por cima já tratou o Esc: fecha só ele, não sai do Modo Show
        if (e.defaultPrevented) return;
        e.preventDefault();
        const st = useStore.getState();
        if (st.playlistMaximized) st.togglePlaylistMaximized();
        else stopPlayback();
      } else if (ctrl && key === 'm' && !e.shiftKey && !e.altKey) {
        // ⌘M abre e fecha o Modo Show (no Mac, Minimizar passou para ⌥⌘M)
        e.preventDefault();
        if (!e.repeat) toggleShowMode();
      } else if (key === 'm' && !ctrl) {
        e.preventDefault();
        toggleMixer();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const store = useStore.getState();
        // Se a timeline estiver travada pelo cadeado, não permite deletar clipes
        if (store.timelineLocked) return;
        // No Modo Show a timeline não aparece: apagar daqui tiraria áudio da música no ar sem ninguém ver
        if (store.playlistMaximized) return;

        // Se houver clipes selecionados na timeline, a tecla Delete/Backspace exclui os clipes selecionados
        if (store.selectedClipIds.length > 0) {
          e.preventDefault();
          const targetIds = [...store.selectedClipIds];
          audioEngine.stopClipsLive(targetIds);
          store.removeClips(targetIds);
          const selSongId = store.selectedSongId ?? store.playlist[0]?.songId;
          if (selSongId) audioEngine.invalidatePrepared(selSongId);
          return;
        }

        // Caso contrário, se o foco não estiver em um elemento editável, mantém comportamento de excluir música
        if (store.selectedSongId && !e.target) {
          store.removeSong(store.selectedSongId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleMixer]);

  // ⌘M pelo menu Visualizar → Modo Show do app do Mac
  useEffect(() => window.vsDesktop?.onMenuShowMode?.(toggleShowMode), []);
  // Duplo clique no arquivo do projeto no Finder: o app do Mac manda o arquivo e ele abre aqui.
  useEffect(() => {
    if (!window.vsDesktop?.onOpenProjectFile) return;
    return window.vsDesktop.onOpenProjectFile(async ({ name, path: filePath }) => {
      // Com alteração não salva no projeto aberto, pergunta Salvar / Não salvar / Cancelar antes de trocar.
      if (!(await confirmLeaveProject())) {
        window.vsDesktop?.projectTaken?.();
        return;
      }
      const st = useStore.getState();
      const finish = () => window.vsDesktop?.projectTaken?.();
      window.vsDesktop?.projectTaken?.();
      st.setExportProgress({ active: true, message: `Abrindo "${name}"...` });
      openProjectFromPath(name, filePath, (message) => useStore.getState().setExportProgress({ active: true, message }))
        .then((loaded) => {
          const done = loadOpenedProject(loaded);
          useStore.getState().setExportProgress({ active: false, message: done });
          window.setTimeout(() => {
            if (useStore.getState().exportProgress?.message === done) useStore.getState().setExportProgress(null);
          }, 4000);
        })
        .catch((err) => {
          useStore.getState().setExportProgress(null);
          const message = friendlyError(err, 'Não foi possível abrir este projeto.');
          useStore.getState().setSaveStatus({ kind: 'error', message });
          window.setTimeout(() => {
            if (useStore.getState().saveStatus?.message === message) useStore.getState().setSaveStatus(null);
          }, 8000);
        })
        .finally(finish);
    });
  }, []);

  useEffect(() => {
    useStore.getState().reconcileTracks();
  }, []);

  // Fechar o app (ou a aba) com alteração não salva pergunta antes
  useEffect(() => watchUnsavedChanges(), []);

  useEffect(() => watchPlaylistForNextSong(), []);

  useEffect(() => {
    const id = requestAnimationFrame(() => window.vsDesktop?.appReady());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!window.vsDesktop?.onRemoteTransport) return;
    // VS Stage Remote pela Rede Local: o comando chega do servidor do Mac
    return window.vsDesktop.onRemoteTransport((cmd) => applyRemoteCommand(cmd));
  }, []);

  useEffect(() => startInstantStartBuilder({ isBusy: () => audioEngine.isStarting(), pitchFor: headPitchFor }), []);
  // a placa de som escolhida volta a ser a saída ao abrir o programa, um projeto ou ao reconectar
  useEffect(() => startAudioOutputWatcher(), []);
  // volume igual entre os VS: mede o loudness das músicas em segundo plano quando ligado
  useEffect(() => startSongLevelWatcher(), []);
  // IA de tom: descobre o tom das músicas do show em segundo plano
  useEffect(() => startSongKeyWatcher(), []);

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
    // A música atual NUNCA é desmarcada ao clicar no fundo: só muda se selecionar outra na playlist
    if (st.selectedTrackId) st.selectTrack(null);
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

  // Idem para gain/mute/solo por clipe (modo DAW): como o solo de um clipe silencia os
  // outros da mesma música, um solo mudando reaplica a música inteira; senão, só o clipe
  // que mudou.
  useEffect(() => {
    let prevClips = useStore.getState().clips;
    const soloHashOf = (cs: typeof prevClips) => {
      let h = '';
      for (const c of cs) if (c.solo) h += c.id + '|';
      return h;
    };
    let prevSoloHash = soloHashOf(prevClips);

    const unsub = useStore.subscribe((state) => {
      if (state.clips === prevClips) return;
      const nextSoloHash = soloHashOf(state.clips);
      if (nextSoloHash !== prevSoloHash) {
        for (const c of state.clips) audioEngine.updateClipParams(c.id);
      } else {
        const prevById = new Map(prevClips.map((c) => [c.id, c]));
        const nextIds = new Set(state.clips.map((c) => c.id));
        // Se clipes foram removidos (Delete ou Undo), para os nós de áudio imediatamente
        const removed = prevClips.filter((c) => !nextIds.has(c.id)).map((c) => c.id);
        if (removed.length > 0) {
          audioEngine.stopClipsLive(removed);
        }

        for (const c of state.clips) {
          const p = prevById.get(c.id);
          if (p) {
            // Se o startTime ou o corte do clipe mudar (ex.: mover clipe ou Cmd+Z Desfazer),
            // reposiciona o áudio imediatamente em tempo real sem sair do ritmo
            if (p.startTime !== c.startTime || p.trimStart !== c.trimStart || p.trimEnd !== c.trimEnd) {
              const activeSong = state.songs.find((song) => song.id === c.songId);
              const noProcessing = !!activeSong && (activeSong.bpmAdjust ?? 0) === 0 && activeSong.tuner === 0
                && !activeSong.medley?.some((part) => (part.bpmAdjust ?? 0) !== 0 || (part.tuner ?? 0) !== 0);
              const endCutOnly = noProcessing && p.startTime === c.startTime && (p.trimStart ?? 0) === (c.trimStart ?? 0)
                && (c.trimEnd ?? 0) >= (p.trimEnd ?? 0);
              audioEngine.updateLiveClipPosition(c.id, c.startTime, endCutOnly);
              if (!audioEngine.refreshPreparedAfterEndCut(c.songId)) audioEngine.invalidatePrepared(c.songId);
            }
            if (
              p.gain !== c.gain ||
              p.mute !== c.mute ||
              p.fadeIn !== c.fadeIn ||
              p.fadeOut !== c.fadeOut ||
              p.fadeCurveIn !== c.fadeCurveIn ||
              p.fadeCurveOut !== c.fadeCurveOut
            ) {
              audioEngine.updateClipParams(c.id);
            }
          }
        }
      }
      prevClips = state.clips;
      prevSoloHash = nextSoloHash;
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
      // Cortes e edições de clipes são tratados diretamente por audioEngine.updateLiveClipPosition
      // e stopClipsLive. Disparar reconstrução completa do preparo travaria o Play logo após o corte.
      if (
        selectionChanged ||
        nextChanged ||
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
              onOpenLocal={() => setLocalOpen(true)} onOpenAiSeparator={() => setAiSeparatorOpen(true)} broadcast={broadcast} local={local}
              pendingRequests={pendingRequests}
            />
            <TransportBar />
          </>
        )}
        <ReopenLastBar />
        <UpdateBanner />
        {lyricsNotSaved && (
          <div className="flex items-center gap-2 px-3 h-6 border-b border-logic-border-dark text-2xs text-logic-text-dim animate-[fadeIn_200ms_ease-out]" role="status">
            <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-amber shrink-0" />
            <span className="flex-1 min-w-0 truncate" title="As letras estão no programa: salve para não perder quando fechar.">
              Letras do produtor ainda não gravadas no arquivo do projeto.
            </span>
            <button
              onClick={() => { void saveCurrentProject().then((ok) => { if (ok) setLyricsNotSaved(false); }); }}
              className="shrink-0 text-logic-text-muted hover:text-logic-text hover:underline underline-offset-2"
            >
              Salvar agora
            </button>
          </div>
        )}
        <JoinRequestsBanner
          show={broadcast.show}
          pending={joinRequests.pending}
          onChanged={joinRequests.refresh}
          onOpenList={() => setShowManagerOpen(true)}
        />
        {broadcast.onAir && broadcast.yielded && (
          <div className="flex items-center gap-3 px-3 h-8 bg-logic-lcd-amber/10 border-b border-logic-lcd-amber/30 text-xs text-logic-lcd-amber animate-[fadeIn_200ms_ease-out]">
            <Radio size={13} />
            <span className="flex-1 truncate">O show está sendo transmitido por outra aba deste computador. Esta aba não envia nada para músicos e teleprompter.</span>
            <button className="px-2 h-6 rounded bg-logic-lcd-amber text-black font-semibold hover:brightness-110 transition" onClick={broadcast.takeOver}>
              Transmitir daqui
            </button>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {playlistMaximized ? (
            <>
              <div className="flex flex-col flex-1 min-w-0 min-h-0">
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PlaylistPanel onOpenAiSeparator={() => setAiSeparatorOpen(true)} />
                </div>
                {/* Pads (tecla P) no lugar do mixer (tecla M) */}
                <PadsOrMixer />
              </div>
              <ShowModePanel showName={broadcast.showName} />
            </>
          ) : (
            <>
              {playlistVisible && <PlaylistPanel onOpenAiSeparator={() => setAiSeparatorOpen(true)} />}
              <TimelinePanel />
            </>
          )}
        </div>

        {!playlistMaximized && <MixerPanel />}
        <ContextMenu />
        <StemSplitStatus />
        <ClickStatus />
        <BounceDialog />
        <ShowManagerDialog open={showManagerOpen} onClose={() => setShowManagerOpen(false)} broadcast={broadcast} />
        {/* fica aqui (e não na barra de menu) para abrir também no Modo Show */}
        <AudioDeviceDialog open={audioDeviceDialogOpen} onClose={() => useStore.getState().setAudioDeviceDialogOpen(false)} />
        {localOpen && <LocalNetworkDialog local={local} referenceSync={referenceSync} onClose={() => setLocalOpen(false)} />}
        {prompterOpen && (
          <PrompterDialog
            broadcast={broadcast}
            lyricSongs={lyricsSync.songsInProject}
            referenceSync={referenceSync}
            onClose={() => setPrompterOpen(false)}
            onOpenShowManager={() => { setPrompterOpen(false); setShowManagerOpen(true); }}
          />
        )}
        <AiStemSeparatorDialog
          open={aiSeparatorOpen}
          onClose={() => setAiSeparatorOpen(false)}
        />
        <MissingAudioDialog />
        <UnsavedChangesDialog />
      </div>
    </ErrorBoundary>
  );
}

export default App;
