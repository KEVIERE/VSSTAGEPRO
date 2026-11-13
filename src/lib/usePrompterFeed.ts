import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrompterSnapshot } from '@/lib/prompterTypes';
import { serverLagMs } from '@/lib/liveClock';
import { isLocalClient } from '@/lib/localNetwork';

// Na Rede Local buscar é barato: 4 vezes por segundo deixa troca de música, pulo e aviso
// praticamente instantâneos. Online fica em 1 s.
const POLL_MS = 1000;
const LOCAL_POLL_MS = 250;
// Bloqueado por tentativas: enquanto o IP está bloqueado o banco recusa antes de gravar tentativa,
// então buscar de novo não renova o bloqueio. O intervalo maior só poupa chamadas, e 5 s deixa
// a TV voltar logo quando o bloqueio cai.
const BLOCKED_POLL_MS = 5000;
const TICK_MS = 100;

/**
 * `invalid_code`: PIN errado. `disconnected`: o diretor desconectou este aparelho (a busca para e a
 * tela pede o PIN). `not_ready`: o Mac respondeu, mas o projeto aberto não tem músicas.
 */
export type FeedError = 'invalid_code' | 'too_many_attempts' | 'offline' | 'disconnected' | 'not_ready' | null;

export interface PrompterFeed {
  snap: PrompterSnapshot | null;
  /**
   * `clockOffsetMs`: hora do servidor menos a hora deste aparelho. Serve só para os avisos com
   * tempo (`now + clockOffsetMs` é a hora do servidor). A letra continua no `now` local, junto com
   * o `receivedAt`, que também é local.
   */
  sync: { lagMs: number; receivedAt: number; clockOffsetMs: number };
  now: number;
  error: FeedError;
  refresh: () => Promise<void>;
}

/**
 * `lyricsRev`: versão das letras que este aparelho já tem. Um servidor que entende o parâmetro
 * responde `lyrics: null` quando nada mudou e manda `lyricsRev` com a versão atual. Quem não
 * entende ignora o segundo argumento e manda tudo, como sempre.
 */
type Fetcher = (code: string, lyricsRev?: string | null) => Promise<PrompterSnapshot>;

/** O que pode chegar da rede: `lyrics: null` = "a letra não mudou, use a que você já tem". */
type WireSnapshot = Omit<PrompterSnapshot, 'lyrics'> & {
  lyrics: PrompterSnapshot['lyrics'] | null;
  lyricsRev?: string | null;
};

export function usePrompterFeed(code: string | null, fetcher: Fetcher): PrompterFeed {
  const [snap, setSnap] = useState<PrompterSnapshot | null>(null);
  const [sync, setSync] = useState({ lagMs: 0, receivedAt: 0, clockOffsetMs: 0 });
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<FeedError>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Desconectado pelo diretor ou código recusado: para de buscar. Senão o aparelho entrava de novo
  // com o PIN guardado, ou gravava uma tentativa errada por segundo e trancava o local inteiro.
  const stopped = useRef(false);
  // Bloqueado por tentativas: busca mais devagar até liberar.
  const slow = useRef(false);
  const snapRef = useRef<PrompterSnapshot | null>(null);
  const revRef = useRef<string | null>(null);
  // Resposta de um código antigo que chegou depois da troca: descarta.
  const codeRef = useRef(code);
  codeRef.current = code;

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const t0 = performance.now();
      const s = (await fetcherRef.current(code, revRef.current)) as unknown as WireSnapshot;
      if (codeRef.current !== code) return;
      // metade da ida e volta é o tempo que o dado levou para chegar: a letra não fica atrás
      const transitMs = Math.min(1500, (performance.now() - t0) / 2);
      const prev = snapRef.current;
      // "A letra não mudou", mas este aparelho não tem letra guardada: pede tudo na próxima volta
      // e nunca guarda um snap sem letra.
      if (s.lyrics === null && !prev) { revRef.current = null; return; }
      // Mantém a mesma lista de letras quando ela não mudou: poupa recálculo na TV.
      const next: PrompterSnapshot = s.lyrics === null && prev ? { ...s, lyrics: prev.lyrics } : (s as PrompterSnapshot);
      snapRef.current = next;
      revRef.current = typeof s.lyricsRev === 'string' ? s.lyricsRev : null;
      const receivedAt = Date.now();
      const srv = Date.parse(s.server_now);
      slow.current = false;
      setSnap(next);
      setSync((old) => ({
        lagMs: serverLagMs(s.server_now, s.show.live_at) + transitMs,
        receivedAt,
        // Sem hora do servidor legível, fica a última medida: NaN apagaria os avisos com tempo.
        clockOffsetMs: Number.isFinite(srv) ? srv + transitMs - receivedAt : old.clockOffsetMs,
      }));
      setError(null);
    } catch (e) {
      if (codeRef.current !== code) return;
      const msg = e instanceof Error ? e.message : '';
      // Na nuvem, `screen_state` responde `invalid_screen` para código de tela que não confere
      // (20261105180000_restaura_funcoes_do_produtor.sql:156). É o mesmo caso de `invalid_code`.
      if (msg === 'invalid_code' || msg === 'invalid_screen') {
        stopped.current = true; snapRef.current = null; revRef.current = null;
        setSnap(null); setError('invalid_code');
      } else if (msg === 'disconnected') {
        stopped.current = true; snapRef.current = null; revRef.current = null;
        setSnap(null); setError('disconnected');
      } else if (msg === 'too_many_attempts') { slow.current = true; setError('too_many_attempts'); }
      else if (msg === 'not_ready') setError('not_ready');
      else setError('offline');
    }
  }, [code]);

  useEffect(() => {
    setSnap(null);
    setError(null);
    stopped.current = false;
    slow.current = false;
    snapRef.current = null;
    revRef.current = null;
    if (!code) return;
    let alive = true;
    let timer = 0;
    const loop = async () => {
      await refresh();
      if (alive && !stopped.current) {
        timer = window.setTimeout(loop, slow.current ? BLOCKED_POLL_MS : isLocalClient() ? LOCAL_POLL_MS : POLL_MS);
      }
    };
    loop();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [code, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return { snap, sync, now, error, refresh };
}
