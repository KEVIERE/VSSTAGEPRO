import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrompterState } from '@/lib/prompterTypes';
import { producerSetPrompter } from '@/lib/prompterApi';

const SEND_DEBOUNCE_MS = 120;
// Polling can return the server copy from before our last write; ignore it for a moment so the screen doesn't jump back.
const ECHO_GUARD_MS = 2500;

export interface PrompterControl {
  state: PrompterState | null;
  update: (fn: (s: PrompterState) => PrompterState) => void;
  saving: boolean;
  error: string | null;
}

export function usePrompterControl(code: string | null, server: PrompterState | null): PrompterControl {
  const [local, setLocal] = useState<PrompterState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLocalAt = useRef(0);
  const latest = useRef<PrompterState | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!server) return;
    if (Date.now() - lastLocalAt.current < ECHO_GUARD_MS || timer.current !== null) return;
    latest.current = server;
    setLocal(server);
  }, [server]);

  const flush = useCallback(async () => {
    timer.current = null;
    if (!code || !latest.current) return;
    setSaving(true);
    try {
      await producerSetPrompter(code, latest.current);
      setError(null);
    } catch {
      setError('Não foi possível enviar para a tela');
    } finally {
      lastLocalAt.current = Date.now();
      setSaving(false);
    }
  }, [code]);

  const update = useCallback((fn: (s: PrompterState) => PrompterState) => {
    const base = latest.current;
    if (!base) return;
    const next = fn(base);
    latest.current = next;
    lastLocalAt.current = Date.now();
    setLocal(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SEND_DEBOUNCE_MS);
  }, [flush]);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  return { state: local, update, saving, error };
}
