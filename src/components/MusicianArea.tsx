import { useState, useEffect, useCallback, useMemo } from 'react';
import { Music } from 'lucide-react';
import MusicianAccess from '@/components/MusicianAccess';
import MusicianWorkspace from '@/components/musician/MusicianWorkspace';
import { serverLagMs } from '@/lib/liveClock';
import { musicianState, musicianSheets, onlineSheetBackend } from '@/lib/musicianApi';
import type { MusicianState, SheetInfo } from '@/lib/musicianTypes';

const CODE_LS = 'vs_musician_code';
const POLL_MS = 1000;

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
  const [access, setAccess] = useState<AccessOpts>({ claimCode: null, autoEnter: true, initialView: 'signin' });
  const [code, setCode] = useState(() => localStorage.getItem(CODE_LS) ?? '');
  const [state, setState] = useState<MusicianState | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sync, setSync] = useState({ lagMs: 0, receivedAt: 0 });

  const applyState = useCallback((s: MusicianState) => {
    setState(s);
    setSync({ lagMs: serverLagMs(s.server_now, s.show.live_at), receivedAt: Date.now() });
  }, []);

  const loadState = useCallback(async (c: string) => {
    try {
      const s = await musicianState(c);
      applyState(s);
      setError(null);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'invalid_code') {
        setError(c.startsWith('acct:')
          ? 'Seu acesso a este show foi removido ou bloqueado pelo diretor.'
          : 'Código inválido.');
        setState(null);
      } else if (msg === 'too_many_attempts') {
        setError('Muitas tentativas. Aguarde alguns minutos.');
      }
    }
  }, [applyState]);

  const loadSheets = useCallback(async (c: string) => {
    try {
      const list = await musicianSheets(c);
      setSheets(list);
    } catch { /* ignore */ }
  }, []);

  const reloadSheets = useCallback(() => loadSheets(code), [loadSheets, code]);

  const enterWithCode = async (raw: string): Promise<string | null> => {
    const c = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (c.length < 8) return 'Código inválido.';
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
    setState(null);
    setView('login');
  };

  // entrada automática só com código já digitado neste aparelho
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#m=')) history.replaceState(null, '', '#musico');
    const saved = hash.startsWith('#join=') || hash.startsWith('#m=') ? null : localStorage.getItem(CODE_LS);
    if (saved && saved.length >= 8) {
      setCode(saved);
      setLoading(true);
      (async () => {
        const s = await musicianState(saved).catch(() => null);
        if (s) {
          applyState(s);
          localStorage.setItem(CODE_LS, saved);
          await loadSheets(saved);
          setView('main');
        }
        setLoading(false);
      })();
    }
  }, [applyState, loadSheets]);

  useEffect(() => {
    if (!code || view === 'login') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      await loadState(code);
      if (!cancelled) timer = setTimeout(loop, POLL_MS);
    };
    timer = setTimeout(loop, POLL_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [code, view, loadState]);

  const isAccount = code.startsWith('acct:');
  const backend = useMemo(() => onlineSheetBackend(code), [code]);

  const handleLogout = () => {
    if (!isAccount) localStorage.removeItem(CODE_LS);
    setAccess({ claimCode: null, autoEnter: false, initialView: 'signin' });
    setCode('');
    setState(null);
    setSheets([]);
    setError(null);
    setView('login');
  };

  if (view === 'login') {
    if (loading) {
      return (
        <div className="flex items-center justify-center bg-logic-bg-deep" style={{ height: '100%' }}>
          <Music size={32} className="text-logic-lcd-green animate-pulse" />
        </div>
      );
    }
    return (
      <MusicianAccess
        key={`${access.claimCode ?? ''}-${access.initialView}-${access.autoEnter}`}
        invite={invite}
        claimCode={access.claimCode}
        autoEnter={access.autoEnter}
        initialView={access.initialView}
        onEnterAccount={enterWithAccount}
        onEnterCode={enterWithCode}
      />
    );
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center bg-logic-bg-deep" style={{ height: '100%' }}>
        <div className="text-center">
          {error && <p className="text-sm text-logic-lcd-red mb-3">{error}</p>}
          <button className="logic-btn" onClick={handleLogout}>Voltar ao login</button>
        </div>
      </div>
    );
  }

  return (
    <MusicianWorkspace
      state={state} sync={sync} sheets={sheets} backend={backend}
      onSheetsChanged={reloadSheets} onCreateAccount={isAccount ? null : openCreateAccount}
      status={<span className="text-2xs text-logic-text-muted truncate block">{state.show.name}</span>}
      logoutLabel={isAccount ? 'Meus shows' : 'Sair'} onLogout={handleLogout}
    />
  );
}
