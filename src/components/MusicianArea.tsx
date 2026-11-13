import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2, WifiOff } from 'lucide-react';
import MusicianAccess from '@/components/MusicianAccess';
import { AccessStage } from '@/components/access/AccessChrome';
import MusicianWorkspace from '@/components/musician/MusicianWorkspace';
import { serverLagMs } from '@/lib/liveClock';
import { musicianSheetsStamp, musicianState, musicianSheets, onlineSheetBackend, sheetsListStamp } from '@/lib/musicianApi';
import { clearLocalSession } from '@/lib/supabaseClient';

// Mesma chave usada em MusicianAccess: o músico com conta fica lembrado aqui.
const MEMBER_LS = 'vs_member_id';
import type { MusicianState, SheetInfo } from '@/lib/musicianTypes';

const CODE_LS = 'vs_musician_code';
const POLL_MS = 1000;
// "Muitas tentativas" na rede do palco: consulta mais devagar até a trava do servidor cair
// (consultar durante a trava não a prolonga)
const LIMITED_POLL_MS = 5000;
// entrada automática com o código guardado: tenta de novo sozinha quando a internet falha
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 10000;
const LIMITED_RETRY_MS = 60000;
// conferência leve de cadernos novos (enviados por colega ou feitos no outro aparelho)
const SHEETS_CHECK_MS = 10000;

type View = 'login' | 'main';

function inviteFromUrl(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#join=')) return null;
  const v = hash.slice(6).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return v || null;
}

interface AccessOpts {
  claimCode: string | null;
  autoEnter: boolean;
  initialView: 'signin' | 'signup';
}

export default function MusicianArea() {
  const [view, setView] = useState<View>('login');
  const [invite] = useState(inviteFromUrl);
  // endereço com que a página abriu (a entrada automática troca o #m= por #musico)
  const [startHash] = useState(() => window.location.hash);
  const [access, setAccess] = useState<AccessOpts>({ claimCode: null, autoEnter: true, initialView: 'signin' });
  const [code, setCode] = useState(() => localStorage.getItem(CODE_LS) ?? '');
  const [state, setState] = useState<MusicianState | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sync, setSync] = useState({ lagMs: 0, receivedAt: 0 });
  // hora (do servidor) em que este aparelho entrou no show: "Desconectar" do diretor depois
  // dela derruba o aparelho
  const since = useRef<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  // intervalo da próxima consulta do show (fica maior com "Muitas tentativas")
  const pollDelay = useRef(POLL_MS);
  // entrada automática com o código guardado neste aparelho
  const [autoTry, setAutoTry] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  // a entrada automática não deu: o login abre com o código guardado já preenchido e o motivo
  const [fallback, setFallback] = useState<{ code: string; error: string | null } | null>(null);
  // cadernos: só a resposta mais nova vale, e a marca diz se a lista do servidor mudou
  const sheetsSeq = useRef(0);
  const sheetsStamp = useRef('');

  const applyState = useCallback((s: MusicianState) => {
    if (!since.current) since.current = s.server_now;
    setState(s);
    setSync({ lagMs: serverLagMs(s.server_now, s.show.live_at), receivedAt: Date.now() });
  }, []);

  /** Entrando agora (código, conta ou de novo depois de desconectado): conta a partir daqui. */
  const freshEntry = () => { since.current = null; setDisconnected(false); };

  const loadState = useCallback(async (c: string) => {
    try {
      const s = await musicianState(c, since.current);
      applyState(s);
      setError(null);
      pollDelay.current = POLL_MS;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'disconnected') {
        setDisconnected(true);
        setError('O diretor musical desconectou você deste show.');
        setState(null);
      } else if (msg === 'invalid_code') {
        setState(null);
        if (c.startsWith('acct:')) {
          // conta: o servidor não conta tentativa, e pode ser só a sessão vencida enquanto a
          // internet volta; continua consultando e volta sozinho quando a sessão renovar
          setError('Seu acesso a este show foi removido ou bloqueado pelo diretor.');
        } else {
          // código pessoal que deixou de valer: cada consulta grava uma tentativa errada para o IP
          // do palco, e em segundos o servidor trancaria a banda toda nessa rede. Para de consultar;
          // "Entrar de novo" tenta uma vez só.
          setDisconnected(true);
          setError('Este código não vale mais. Peça o código novo ao diretor musical.');
        }
      } else if (msg === 'too_many_attempts') {
        pollDelay.current = LIMITED_POLL_MS;
        setError('Muitas tentativas. Aguarde alguns minutos.');
      }
    }
  }, [applyState]);

  const loadSheets = useCallback(async (c: string) => {
    const seq = ++sheetsSeq.current;
    try {
      const list = await musicianSheets(c);
      // uma resposta velha que chega depois de uma mais nova não volta a lista para trás
      if (seq !== sheetsSeq.current) return;
      sheetsStamp.current = sheetsListStamp(list);
      setSheets(list);
    } catch { /* ignore */ }
  }, []);

  const reloadSheets = useCallback(() => loadSheets(code), [loadSheets, code]);

  const enterWithCode = async (raw: string): Promise<string | null> => {
    const c = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (c.length < 8) return 'Código inválido.';
    freshEntry();
    try {
      const s = await musicianState(c);
      applyState(s);
      setError(null);
      setCode(c);
      localStorage.setItem(CODE_LS, c);
      await loadSheets(c);
      setView('main');
      return null;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'too_many_attempts') return 'Muitas tentativas. Aguarde alguns minutos.';
      if (msg === 'invalid_code') return 'Código inválido, ou a entrada por código foi desativada pelo diretor.';
      return 'Sem conexão. Verifique a internet.';
    }
  };

  const enterWithAccount = useCallback(async (memberId: string) => {
    const cred = `acct:${memberId}`;
    localStorage.removeItem(CODE_LS);
    setLoading(true);
    freshEntry();
    try {
      const s = await musicianState(cred);
      applyState(s);
      setError(null);
      setCode(cred);
      await loadSheets(cred);
      setView('main');
    } catch {
      setError('Não foi possível abrir o show. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [applyState, loadSheets]);

  const openCreateAccount = () => {
    setAccess({ claimCode: code, autoEnter: false, initialView: 'signup' });
    setFallback(null);
    setState(null);
    setView('login');
  };

  // Entrada automática só com código já digitado neste aparelho. Com a internet falhando (o
  // Safari do iPhone recarrega a aba ao voltar de outro app), tenta de novo sozinha; só um
  // código que não vale mais leva ao login, com o código já preenchido.
  useEffect(() => {
    if (!autoTry) return;
    if (startHash.startsWith('#m=') && window.location.hash.startsWith('#m=')) history.replaceState(null, '', '#musico');
    const saved = startHash.startsWith('#join=') || startHash.startsWith('#m=') ? null : localStorage.getItem(CODE_LS);
    if (!saved || saved.length < 8) return;
    let cancelled = false;
    let busy = false;
    let delay = RETRY_MIN_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setCode(saved);
    setLoading(true);
    const attempt = async () => {
      if (cancelled || busy) return;
      busy = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try {
        const s = await musicianState(saved);
        if (cancelled) return;
        applyState(s);
        await loadSheets(saved);
        if (cancelled) return;
        setRetrying(null);
        setView('main');
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        const msg = (e as Error).message;
        if (msg === 'invalid_code') {
          // definitivo: cada consulta com código que não existe grava tentativa para o IP do palco
          setRetrying(null);
          setFallback({ code: saved, error: 'Código inválido, ou a entrada por código foi desativada pelo diretor.' });
          setLoading(false);
          return;
        }
        // a trava por muitas tentativas não aumenta com a repetição; espera ela cair
        const limited = msg === 'too_many_attempts';
        setRetrying(limited ? 'Muitas tentativas nesta rede. Tentando de novo em 1 minuto...' : 'Sem internet. Tentando de novo...');
        timer = setTimeout(() => { void attempt(); }, limited ? LIMITED_RETRY_MS : delay);
        if (!limited) delay = Math.min(delay * 2, RETRY_MAX_MS);
      } finally {
        busy = false;
      }
    };
    // a internet voltou ou o músico voltou para a aba: tenta na hora
    const wake = () => {
      if (document.visibilityState === 'visible' && timer) { delay = RETRY_MIN_MS; void attempt(); }
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [autoTry, startHash, applyState, loadSheets]);

  /** Desiste da entrada automática: vai ao login com o código guardado já preenchido. */
  const stopAutoTry = () => {
    setAutoTry(false);
    setRetrying(null);
    setFallback({ code, error: null });
    setLoading(false);
  };

  useEffect(() => {
    if (!code || view === 'login' || disconnected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      await loadState(code);
      if (!cancelled) timer = setTimeout(loop, pollDelay.current);
    };
    timer = setTimeout(loop, pollDelay.current);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [code, view, loadState, disconnected]);

  // Cadernos novos (partitura enviada por colega, caderno feito no outro aparelho): a cada 10 s
  // vai e volta só uma resposta de poucos bytes; a lista inteira só é baixada quando mudou.
  // Para sozinha depois de "Desconectar" e de código inválido.
  const hasState = state !== null;
  useEffect(() => {
    if (!code || view !== 'main' || disconnected || !hasState) return;
    let stop = false;
    let busy = false;
    const tick = async () => {
      if (stop || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const stamp = await musicianSheetsStamp(code);
        if (stop) return;
        if (stamp === null) { stop = true; return; }
        if (stamp !== sheetsStamp.current) await loadSheets(code);
      } catch { /* sem rede: confere de novo no próximo ciclo */ }
      finally { busy = false; }
    };
    const onTick = () => { void tick(); };
    const id = window.setInterval(onTick, SHEETS_CHECK_MS);
    document.addEventListener('visibilitychange', onTick);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onTick);
    };
  }, [code, view, disconnected, hasState, loadSheets]);

  /** Depois de desconectado pelo diretor: entra de novo com o mesmo código ou conta. */
  const reconnect = async () => {
    freshEntry();
    setError(null);
    await loadState(code);
  };

  const isAccount = code.startsWith('acct:');
  const backend = useMemo(() => onlineSheetBackend(code), [code]);

  const handleLogout = () => {
    if (!isAccount) localStorage.removeItem(CODE_LS);
    // O músico com conta precisa sair DE VERDADE. Antes o botão dizia
    // "Meus shows" e não encerrava a sessão: reabrir a área já entrava na
    // conta de novo. Aqui a sessão é limpa na hora, sem esperar a rede.
    if (isAccount) {
      try { localStorage.removeItem(MEMBER_LS); } catch { /* ignore */ }
      clearLocalSession();
    }
    setAccess({ claimCode: null, autoEnter: false, initialView: 'signin' });
    setFallback(null);
    setCode('');
    setState(null);
    sheetsSeq.current++;
    sheetsStamp.current = '';
    setSheets([]);
    setError(null);
    freshEntry();
    setView('login');
  };

  if (view === 'login') {
    if (loading) {
      // mesmo palco da entrada (e da Rede Local): o carregamento não aparece em cinza liso
      return (
        <AccessStage>
          <div className="flex flex-col items-center gap-5 text-center">
            <Loader2 size={28} className="text-logic-lcd-green animate-spin" />
            {retrying && (
              <>
                <p className="flex items-center gap-2 text-sm text-logic-text-dim"><WifiOff size={16} className="flex-shrink-0" /> {retrying}</p>
                <button type="button" className="access-link" onClick={stopAutoTry}>Voltar ao login</button>
              </>
            )}
          </div>
        </AccessStage>
      );
    }
    return (
      <MusicianAccess
        key={`${access.claimCode ?? ''}-${access.initialView}-${access.autoEnter}`}
        invite={invite}
        claimCode={access.claimCode}
        autoEnter={access.autoEnter}
        initialView={access.initialView}
        initialCode={fallback?.code ?? null}
        initialError={fallback?.error ?? null}
        onEnterAccount={enterWithAccount}
        onEnterCode={enterWithCode}
      />
    );
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center bg-logic-bg-deep" style={{ height: '100%' }}>
        <div className="text-center px-6">
          {error && <p className="text-sm text-logic-lcd-red mb-3">{error}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            {disconnected && <button className="console-key is-lit-amber h-10 px-4 text-[13px]" onClick={reconnect}>Entrar de novo</button>}
            <button className="logic-btn" onClick={handleLogout}>Voltar ao login</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MusicianWorkspace
      state={state} sync={sync} sheets={sheets} backend={backend}
      onSheetsChanged={reloadSheets} onCreateAccount={isAccount ? null : openCreateAccount}
      status={<span className="text-2xs text-logic-text-muted truncate block">{state.show.name}</span>}
      onLogout={handleLogout}
    />
  );
}
