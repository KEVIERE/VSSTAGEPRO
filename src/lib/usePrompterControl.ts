import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrompterState } from '@/lib/prompterTypes';
import { producerState, producerSetPrompter } from '@/lib/prompterApi';

const SEND_DEBOUNCE_MS = 120;
// A consulta periódica pode trazer a cópia do servidor de antes da nossa última gravação; ignora
// por um instante para a tela não voltar atrás sozinha.
const ECHO_GUARD_MS = 1200;

export interface PrompterControl {
  state: PrompterState | null;
  update: (fn: (s: PrompterState) => PrompterState) => void;
  saving: boolean;
  error: string | null;
  /** Quando o último envio deu certo (o painel mostra "salvo"). */
  savedAt: number | null;
  /** Lê o estado do servidor de novo, descartando o que havia localmente. */
  resync: () => Promise<void>;
}

export function usePrompterControl(code: string | null, server: PrompterState | null): PrompterControl {
  const [local, setLocal] = useState<PrompterState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const lastLocalAt = useRef(0);
  const latest = useRef<PrompterState | null>(null);
  const timer = useRef<number | null>(null);
  // Gravação em andamento: a resposta do servidor durante ela é velha por definição.
  const inFlight = useRef(0);

  useEffect(() => {
    if (!server) return;
    if (inFlight.current > 0) return;
    if (Date.now() - lastLocalAt.current < ECHO_GUARD_MS || timer.current !== null) return;
    latest.current = server;
    setLocal(server);
  }, [server]);

  const flush = useCallback(async () => {
    timer.current = null;
    if (!code || !latest.current) return;
    const sending = latest.current;
    setSaving(true);
    inFlight.current += 1;
    try {
      await producerSetPrompter(code, sending);
      setError(null);
      setSavedAt(Date.now());
    } catch (err) {
      // O banco recusou (limite de tamanho, código inválido, rede). Sem isso o painel
      // continuava mostrando o aviso como se estivesse na tela, e ele sumia sozinho na
      // consulta seguinte: era o "aviso não funciona".
      const msg = err instanceof Error ? err.message : '';
      setError(msg === 'invalid_input'
        ? 'O servidor recusou o envio: há avisos prontos ou programados demais. Apague alguns e tente de novo.'
        : msg === 'invalid_code'
          ? 'O código do produtor não vale mais. Saia e entre de novo.'
          : 'Não foi possível enviar para a tela');
      // Volta para o que o servidor realmente tem, em vez de deixar a tela mentindo.
      try {
        const fresh = await producerState(code);
        latest.current = fresh.prompter;
        setLocal(fresh.prompter);
        lastLocalAt.current = 0;
      } catch { /* sem rede: mantém o local e o aviso de erro */ }
    } finally {
      inFlight.current -= 1;
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
    setSavedAt(null);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SEND_DEBOUNCE_MS);
  }, [flush]);

  const resync = useCallback(async () => {
    if (!code) return;
    try {
      const fresh = await producerState(code);
      latest.current = fresh.prompter;
      setLocal(fresh.prompter);
      setError(null);
      lastLocalAt.current = 0;
    } catch {
      setError('Não foi possível ler a tela agora');
    }
  }, [code]);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  return { state: local, update, saving, error, savedAt, resync };
}
