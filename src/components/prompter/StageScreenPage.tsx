import { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorPlay, Maximize, Minimize, LogOut, Loader2, WifiOff, RotateCw, Hand } from 'lucide-react';
import StageScreen from '@/components/prompter/StageScreen';
import StageFullscreenGuide from '@/components/prompter/StageFullscreenGuide';
import PrompterAccess, { feedErrorText } from '@/components/prompter/PrompterAccess';
import { screenState } from '@/lib/prompterApi';
import { useShowLogo } from '@/lib/useShowLogo';
import { usePrompterFeed } from '@/lib/usePrompterFeed';
import { useKeepAwake } from '@/lib/useWakeLock';
import { isLocalClient } from '@/lib/localNetwork';
import { LOCAL_NOTICE, localForget } from '@/lib/localClientApi';
import {
  canFullscreen, enterFullscreen, exitFullscreen, isInstalled, isIPhone, isTouchDevice,
  useFixedLocalAddress, useFullscreen, usePortrait,
} from '@/lib/stageDisplay';

const SCREEN_LS = 'vs_screen_code';
// O guia de tela cheia é só para a primeira vez nesta aba (sobrevive ao Reconectar da Rede Local).
const GUIDE_SS = 'vs_stage_guide_off';
const IDLE_MS = 2500;
// O toque que acorda os botões não pode apertar o botão que ainda estava invisível embaixo do dedo.
const WAKE_GUARD_MS = 600;
// Desconectar pede um segundo toque dentro deste tempo.
const CONFIRM_MS = 3000;
// Na rede local a tela entra sem PIN: ela só mostra o que o diretor e o produtor mandam.
const LOCAL_SCREEN_CODE = 'TELA';

export default function StageScreenPage() {
  const local = isLocalClient();
  const [code, setCode] = useState<string | null>(() => (
    local ? LOCAL_SCREEN_CODE : localStorage.getItem(SCREEN_LS) ?? sessionStorage.getItem(SCREEN_LS)
  ));
  const feed = usePrompterFeed(code, screenState);
  // Código recusado (na nuvem): a busca parou e o código saiu da memória. Guarda o motivo para a
  // tela do código mostrar "Código não encontrado", porque trocar o código zera o erro do feed.
  const [rejected, setRejected] = useState<'invalid_code' | null>(null);
  const [idle, setIdle] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try { return sessionStorage.getItem(GUIDE_SS) === '1'; } catch { return false; }
  });
  const fullscreen = useFullscreen();
  const portrait = usePortrait();
  const idleTimer = useRef(0);
  const idleRef = useRef(false);
  const wokeAt = useRef(0);
  const [armedLeave, setArmedLeave] = useState(false);
  const armTimer = useRef(0);
  const [touch] = useState(isTouchDevice);
  const [installed] = useState(isInstalled);
  const [fsSupported] = useState(canFullscreen);

  // O guia é só para a primeira vez. Depois de entrar em tela cheia ou de fechar o guia, sair por
  // gesto, Esc, ligação ou recarga deixa só o botão pequeno, nunca a camada preta por cima da letra.
  const dismissGuide = useCallback(() => {
    setGuideDismissed(true);
    try { sessionStorage.setItem(GUIDE_SS, '1'); } catch { /* só não lembra depois de recarregar */ }
  }, []);
  useEffect(() => { if (fullscreen) dismissGuide(); }, [fullscreen, dismissGuide]);

  const awake = useKeepAwake(!!feed.snap).state;
  useFixedLocalAddress(local && isIPhone() && !installed);
  const logoUrl = useShowLogo(feed.snap ? code : null, feed.snap?.logo ?? null);

  // Só quando a tela entra ou sai do ar, e não a cada busca.
  const hasSnap = !!feed.snap;
  useEffect(() => {
    sessionStorage.removeItem(SCREEN_LS);
    if (!local && hasSnap && code) localStorage.setItem(SCREEN_LS, code);
  }, [local, hasSnap, code]);

  // Na Rede Local o código fixo 'TELA' sempre vale: não apagar, senão a TV pediria um PIN.
  useEffect(() => {
    if (local || feed.error !== 'invalid_code') return;
    localStorage.removeItem(SCREEN_LS);
    setRejected('invalid_code');
    setCode(null);
  }, [local, feed.error]);

  const wake = useCallback(() => {
    setIdle(false);
    idleRef.current = false;
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      idleRef.current = true;
      setIdle(true);
      setArmedLeave(false);
    }, IDLE_MS);
  }, []);

  // Só o toque que acorda os botões ganha a trava; o mouse do Mac continua sem atraso.
  const onTouch = useCallback(() => {
    if (idleRef.current) wokeAt.current = Date.now();
    wake();
  }, [wake]);
  const fresh = () => Date.now() - wokeAt.current < WAKE_GUARD_MS;

  const toggleFs = useCallback(() => {
    if (fullscreen) { dismissGuide(); exitFullscreen(); }
    else enterFullscreen();
  }, [fullscreen, dismissGuide]);

  useEffect(() => {
    wake();
    const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'f') toggleFs(); };
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(idleTimer.current);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('keydown', onKey);
    };
  }, [wake, onTouch, toggleFs]);

  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  const leave = () => {
    window.clearTimeout(armTimer.current);
    setArmedLeave(false);
    setRejected(null);
    if (local) {
      localForget('screen', LOCAL_SCREEN_CODE);
      window.location.reload();
      return;
    }
    localStorage.removeItem(SCREEN_LS);
    window.location.hash = '#tela';
    setCode(null);
  };

  // Botão do canto: um toque arma, o segundo (em até 3 s) desconecta. Um toque solto no meio do
  // show não derruba a TV.
  const askLeave = () => {
    if (fresh()) return;
    if (!armedLeave) {
      setArmedLeave(true);
      window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmedLeave(false), CONFIRM_MS);
      return;
    }
    leave();
  };

  if (!code || feed.error === 'invalid_code' || (feed.error === 'too_many_attempts' && !feed.snap)) {
    return (
      <PrompterAccess
        icon={<MonitorPlay size={22} />}
        title="Tela do palco"
        subtitle="Abra esta página no aparelho ligado à TV. A letra e os avisos aparecem aqui sozinhos."
        error={feedErrorText(feed.error ?? rejected)}
        onSubmit={(c) => { window.location.hash = '#tela'; setRejected(null); setCode(c); }}
      />
    );
  }

  // Desconectada pelo diretor: a busca parou. Na Rede Local a tela entra sem PIN, então basta
  // tocar para voltar.
  if (feed.error === 'disconnected') {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-white/70">O diretor desconectou esta tela.</p>
        <button className="console-key px-4 h-10 text-sm" onClick={leave}>Entrar de novo</button>
      </div>
    );
  }

  if (!feed.snap) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center p-6 text-center">
        {feed.error === 'not_ready'
          ? <p className="flex items-center gap-2 text-white/60"><Loader2 size={18} className="animate-spin shrink-0" /> {LOCAL_NOTICE.notReady}</p>
          : feed.error === 'offline'
            ? <p className="flex items-center gap-2 text-white/60">{local ? <Loader2 size={18} className="animate-spin" /> : <WifiOff size={18} />} {local ? 'Aguardando o Mac do diretor...' : 'Sem internet. Tentando de novo...'}</p>
            : <Loader2 size={28} className="text-white/40 animate-spin" />}
      </div>
    );
  }

  const guide = !touch || installed || fullscreen || guideDismissed
    ? null
    : fsSupported ? 'fullscreen' : isIPhone() ? 'install' : null;
  const hidden = idle ? 'opacity-0 pointer-events-none' : 'opacity-100';
  const showPortrait = touch && portrait && !guide;
  // Sem Wake Lock e sem o primeiro toque: um aviso pequeno no rodapé, só até alguém tocar.
  const needTouch = awake === 'precisaToque' && !guide;
  const awakeTip = awake === 'falhou'
    ? (touch ? 'Esta tela pode apagar. Desligue o Bloqueio Automático do aparelho.' : 'Esta tela pode apagar. Desligue o repouso da tela do computador.')
    : awake === 'video'
      ? (touch ? 'Se a tela apagar, desligue o Bloqueio Automático do aparelho.' : 'Se a tela apagar, desligue o repouso da tela do computador.')
      : null;
  const leaveLabel = touch ? 'Toque de novo para' : 'Clique de novo para';

  return (
    <div className="fixed inset-0 bg-black" style={{ cursor: idle ? 'none' : 'default' }}>
      <StageScreen snap={feed.snap} sync={feed.sync} now={feed.now} logoUrl={logoUrl} />
      <div className={`absolute top-4 right-4 flex flex-col items-end gap-2 transition-opacity duration-300 ${hidden}`} style={{ marginTop: 'env(safe-area-inset-top)', marginRight: 'env(safe-area-inset-right)' }}>
        <div className="flex gap-2">
          {fsSupported && (
            <button onClick={() => { if (!fresh()) toggleFs(); }} className="console-key flex items-center gap-2 h-9 px-3 text-sm" title="Tela cheia (F)">
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />} {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            </button>
          )}
          {armedLeave ? (
            <button onClick={askLeave} className="console-key is-lit-red flex items-center gap-2 px-3 h-9 text-sm">
              <LogOut size={16} /> {leaveLabel} {local ? 'reconectar' : 'desconectar'}
            </button>
          ) : (
            <button onClick={askLeave} className="console-key flex items-center justify-center h-9 w-9" title={local ? 'Reconectar esta tela' : 'Desconectar esta tela'}>
              <LogOut size={16} />
            </button>
          )}
        </div>
        {awakeTip && (
          <p className="console-face border border-black rounded px-3 py-1.5 max-w-[20rem] text-right text-xs leading-snug text-logic-text-dim">{awakeTip}</p>
        )}
      </div>
      {(needTouch || showPortrait) && (
        <div className="absolute bottom-6 inset-x-0 flex flex-col items-center gap-2 px-4 pointer-events-none" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
          {needTouch && (
            <p className="console-key flex items-center gap-2 px-4 h-10 text-sm" style={{ color: 'var(--vs-lime, #b8e85c)', borderColor: 'var(--vs-lime, #b8e85c)' }}>
              <Hand size={16} /> {touch ? 'Toque na tela' : 'Clique na tela'} para ela não apagar durante o show
            </p>
          )}
          {showPortrait && (
            <p className={`flex items-center gap-2 px-4 py-2 console-face border border-black rounded text-logic-text-dim text-sm transition-opacity duration-300 ${hidden}`}>
              <RotateCw size={16} className="text-logic-lcd-amber" /> Vire o celular de lado para a letra ocupar a TV inteira
            </p>
          )}
        </div>
      )}
      {guide && (
        <StageFullscreenGuide
          mode={guide}
          onFullscreen={() => { wake(); enterFullscreen(); }}
          onDismiss={dismissGuide}
        />
      )}
    </div>
  );
}
