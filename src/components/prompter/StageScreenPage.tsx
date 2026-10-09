import { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorPlay, Maximize, Minimize, LogOut, Loader2, WifiOff, RotateCw } from 'lucide-react';
import StageScreen from '@/components/prompter/StageScreen';
import StageFullscreenGuide from '@/components/prompter/StageFullscreenGuide';
import PrompterAccess, { feedErrorText } from '@/components/prompter/PrompterAccess';
import { screenState } from '@/lib/prompterApi';
import { useShowLogo } from '@/lib/useShowLogo';
import { usePrompterFeed } from '@/lib/usePrompterFeed';
import { isLocalClient } from '@/lib/localNetwork';
import { localForget } from '@/lib/localClientApi';
import {
  canFullscreen, enterFullscreen, exitFullscreen, isInstalled, isIPhone, isTouchDevice,
  useFixedLocalAddress, useFullscreen, usePortrait,
} from '@/lib/stageDisplay';

const SCREEN_LS = 'vs_screen_code';
const IDLE_MS = 2500;
// Na rede local a tela entra sem PIN: ela só mostra o que o diretor e o produtor mandam.
const LOCAL_SCREEN_CODE = 'TELA';

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) l.release(); else lock = l;
      } catch { /* the TV still works, it may just dim */ }
    };
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release();
    };
  }, [active]);
}

export default function StageScreenPage() {
  const local = isLocalClient();
  const [code, setCode] = useState<string | null>(() => (
    local ? LOCAL_SCREEN_CODE : localStorage.getItem(SCREEN_LS) ?? sessionStorage.getItem(SCREEN_LS)
  ));
  const feed = usePrompterFeed(code, screenState);
  const [idle, setIdle] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const fullscreen = useFullscreen();
  const portrait = usePortrait();
  const idleTimer = useRef(0);
  const [touch] = useState(isTouchDevice);
  const [installed] = useState(isInstalled);
  const [fsSupported] = useState(canFullscreen);

  useWakeLock(!!feed.snap);
  useFixedLocalAddress(local && isIPhone() && !installed);
  const logoUrl = useShowLogo(feed.snap ? code : null);

  useEffect(() => {
    sessionStorage.removeItem(SCREEN_LS);
    if (!local && feed.snap && code) localStorage.setItem(SCREEN_LS, code);
  }, [local, feed.snap, code]);

  useEffect(() => {
    if (feed.error === 'invalid_code') localStorage.removeItem(SCREEN_LS);
  }, [feed.error]);

  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  const toggleFs = useCallback(() => {
    if (fullscreen) { setGuideDismissed(true); exitFullscreen(); }
    else enterFullscreen();
  }, [fullscreen]);

  useEffect(() => {
    wake();
    const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'f') toggleFs(); };
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(idleTimer.current);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
      window.removeEventListener('keydown', onKey);
    };
  }, [wake, toggleFs]);

  const leave = () => {
    if (local) {
      localForget('screen', LOCAL_SCREEN_CODE);
      window.location.reload();
      return;
    }
    localStorage.removeItem(SCREEN_LS);
    window.location.hash = '#tela';
    setCode(null);
  };

  if (!code || feed.error === 'invalid_code' || (feed.error === 'too_many_attempts' && !feed.snap)) {
    return (
      <PrompterAccess
        icon={<MonitorPlay size={22} />}
        title="Tela do palco"
        subtitle="Abra esta página no aparelho ligado à TV. A letra e os avisos aparecem aqui sozinhos."
        error={feedErrorText(feed.error)}
        onSubmit={(c) => { window.location.hash = '#tela'; setCode(c); }}
      />
    );
  }

  if (!feed.snap) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center p-6 text-center">
        {feed.error === 'offline'
          ? <p className="flex items-center gap-2 text-white/60">{local ? <Loader2 size={18} className="animate-spin" /> : <WifiOff size={18} />} {local ? 'Aguardando o Mac do diretor...' : 'Sem internet. Tentando de novo...'}</p>
          : <Loader2 size={28} className="text-white/40 animate-spin" />}
      </div>
    );
  }

  const guide = !touch || installed || fullscreen || guideDismissed
    ? null
    : fsSupported ? 'fullscreen' : isIPhone() ? 'install' : null;
  const hidden = idle ? 'opacity-0 pointer-events-none' : 'opacity-100';

  return (
    <div className="fixed inset-0 bg-black" style={{ cursor: idle ? 'none' : 'default' }}>
      <StageScreen snap={feed.snap} sync={feed.sync} now={feed.now} logoUrl={logoUrl} />
      <div className={`absolute top-4 right-4 flex gap-2 transition-opacity duration-300 ${hidden}`} style={{ marginTop: 'env(safe-area-inset-top)', marginRight: 'env(safe-area-inset-right)' }}>
        {fsSupported && (
          <button onClick={toggleFs} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm backdrop-blur transition-colors" title="Tela cheia (F)">
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />} {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          </button>
        )}
        <button onClick={leave} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white backdrop-blur transition-colors" title={local ? 'Reconectar esta tela' : 'Desconectar esta tela'}>
          <LogOut size={16} />
        </button>
      </div>
      {touch && portrait && !guide && (
        <div className={`absolute bottom-6 inset-x-0 flex justify-center px-4 transition-opacity duration-300 ${hidden}`}>
          <p className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur text-white/80 text-sm">
            <RotateCw size={16} className="text-amber-400" /> Vire o celular de lado para a letra ocupar a TV inteira
          </p>
        </div>
      )}
      {guide && (
        <StageFullscreenGuide
          mode={guide}
          onFullscreen={() => { wake(); enterFullscreen(); }}
          onDismiss={() => setGuideDismissed(true)}
        />
      )}
    </div>
  );
}
