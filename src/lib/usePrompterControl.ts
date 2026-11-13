import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrompterState, ScreenToggles } from '@/lib/prompterTypes';
import { producerPatchPrompter, producerState, type PrompterPatch } from '@/lib/prompterApi';

const SEND_DEBOUNCE_MS = 120;
// A consulta periódica pode trazer a cópia do servidor de antes da nossa última gravação: por um
// instante o que acabou de ser confirmado fica por cima dela, para a tela não voltar atrás sozinha.
const ECHO_GUARD_MS = 1200;
// Sem rede (ou servidor fora): o que não chegou à TV volta para a fila e sai de novo, com
// espera crescente até RETRY_MAX_MS enquanto continuar falhando.
const RETRY_MS = 1500;
const RETRY_MAX_MS = 10_000;
// Pedido pendurado no Wi-Fi do palco não pode travar a fila: desiste e tenta de novo.
const SEND_TIMEOUT_MS = 8000;

/** Só as chaves que mudaram de `base` para `next` (as da tela, uma por uma), somadas a `acc`. */
export function prompterDiff(base: PrompterState, next: PrompterState, acc: PrompterPatch = {}): PrompterPatch {
  const out: PrompterPatch = { ...acc };
  for (const k of Object.keys(next) as (keyof PrompterState)[]) {
    if (k === 'toggles') {
      for (const t of Object.keys(next.toggles) as (keyof ScreenToggles)[]) {
        if (next.toggles[t] !== base.toggles?.[t]) out.toggles = { ...out.toggles, [t]: next.toggles[t] };
      }
    } else if (next[k] !== base[k]) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

/** Junta dois pedaços: o de `b` (mais novo) vale mais. */
export function mergePatch(a: PrompterPatch, b: PrompterPatch): PrompterPatch {
  return { ...a, ...b, ...(a.toggles || b.toggles ? { toggles: { ...a.toggles, ...b.toggles } } : {}) };
}

/** Põe um pedaço por cima de uma cópia inteira. */
export function applyPatch(s: PrompterState, p: PrompterPatch | null): PrompterState {
  if (!p || Object.keys(p).length === 0) return s;
  return { ...s, ...p, toggles: p.toggles ? { ...s.toggles, ...p.toggles } : s.toggles } as PrompterState;
}

const isEmptyPatch = (p: PrompterPatch | null) => !p || Object.keys(p).length === 0;

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  let id = 0;
  const limit = new Promise<never>((_, reject) => {
    id = window.setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, ms);
  });
  return Promise.race([run(ctrl.signal), limit]).finally(() => window.clearTimeout(id));
}

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

/**
 * Painel do produtor: cada mudança vira um pedaço (só as chaves mexidas), os pedaços saem um de
 * cada vez e a cópia do servidor que chega pelas consultas recebe por cima o que este aparelho
 * ainda não viu confirmado. Antes cada envio levava a cópia inteira deste aparelho, e quem
 * gravava por último desfazia o que outro aparelho tinha acabado de mandar (aviso, Tela preta,
 * tamanho da letra).
 */
export function usePrompterControl(code: string | null, server: PrompterState | null): PrompterControl {
  const [local, setLocal] = useState<PrompterState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const latest = useRef<PrompterState | null>(null);
  const timer = useRef<number | null>(null);
  // O que este aparelho mudou: ainda na fila, indo agora e já confirmado (por um instante).
  const pending = useRef<PrompterPatch>({});
  const sending = useRef<PrompterPatch | null>(null);
  const acked = useRef<{ patch: PrompterPatch; at: number } | null>(null);
  // Troca de código ou "Recarregar": a resposta de um envio antigo não mexe mais em nada.
  const epoch = useRef(0);
  const failures = useRef(0);

  const clearTimer = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  };

  useEffect(() => {
    epoch.current += 1;
    pending.current = {};
    sending.current = null;
    acked.current = null;
    failures.current = 0;
    clearTimer();
  }, [code]);

  useEffect(() => {
    if (!server) return;
    let v = server;
    const a = acked.current;
    if (a && Date.now() - a.at < ECHO_GUARD_MS) v = applyPatch(v, a.patch);
    v = applyPatch(applyPatch(v, sending.current), pending.current);
    latest.current = v;
    setLocal(v);
  }, [server]);

  const flushRef = useRef<() => void>(() => {});

  const flush = useCallback(async () => {
    timer.current = null;
    if (!code || !latest.current || sending.current || isEmptyPatch(pending.current)) return;
    const my = epoch.current;
    const patch = pending.current;
    pending.current = {};
    sending.current = patch;
    // a cópia inteira serve para quem ainda não sabe mesclar (Rede Local, banco sem a migração);
    // ela parte da cópia do servidor mais nova que chegou, não de uma cópia velha deste aparelho
    const full = latest.current;
    setSaving(true);
    let retry = false;
    try {
      await withTimeout((signal) => producerPatchPrompter(code, patch, full, signal), SEND_TIMEOUT_MS);
      if (my !== epoch.current) return;
      acked.current = { patch, at: Date.now() };
      failures.current = 0;
      setError(null);
      setSavedAt(Date.now());
    } catch (err) {
      if (my !== epoch.current) return;
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'invalid_input' || msg === 'invalid_code' || msg === 'disconnected') {
        // O banco recusou (limite de tamanho, código inválido). Sem isso o painel continuava
        // mostrando o aviso como se estivesse na tela, e ele sumia sozinho na consulta seguinte:
        // era o "aviso não funciona".
        setError(msg === 'invalid_input'
          ? 'O servidor recusou o envio: há avisos prontos ou programados demais. Apague alguns e tente de novo.'
          : 'O código do produtor não vale mais. Saia e entre de novo.');
        pending.current = {};
        sending.current = null;
        acked.current = null;
        // Volta para o que o servidor realmente tem, em vez de deixar a tela mentindo.
        try {
          const fresh = await producerState(code);
          if (my === epoch.current) { latest.current = fresh.prompter; setLocal(fresh.prompter); }
        } catch { /* sem rede: mantém o local e o aviso de erro */ }
      } else {
        // Não chegou (sem rede, tempo esgotado, servidor fora): volta para a fila, com o que foi
        // mudado depois valendo mais, e sai de novo sozinho.
        pending.current = mergePatch(patch, pending.current);
        failures.current += 1;
        setError('Não foi possível enviar para a tela. Tentando de novo...');
        retry = true;
      }
    } finally {
      if (my === epoch.current) {
        sending.current = null;
        setSaving(false);
        if (!isEmptyPatch(pending.current) && timer.current === null) {
          const wait = retry ? Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** Math.max(0, failures.current - 1)) : 0;
          timer.current = window.setTimeout(() => flushRef.current(), wait);
        }
      }
    }
  }, [code]);
  flushRef.current = () => { void flush(); };

  const update = useCallback((fn: (s: PrompterState) => PrompterState) => {
    const base = latest.current;
    if (!base) return;
    const next = fn(base);
    if (next === base) return;
    pending.current = prompterDiff(base, next, pending.current);
    latest.current = next;
    setLocal(next);
    if (isEmptyPatch(pending.current)) return;
    setSavedAt(null);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), SEND_DEBOUNCE_MS);
  }, []);

  const resync = useCallback(async () => {
    if (!code) return;
    try {
      const fresh = await producerState(code);
      epoch.current += 1;
      pending.current = {};
      sending.current = null;
      acked.current = null;
      failures.current = 0;
      clearTimer();
      latest.current = fresh.prompter;
      setLocal(fresh.prompter);
      setSaving(false);
      setError(null);
    } catch {
      setError('Não foi possível ler a tela agora');
    }
  }, [code]);

  useEffect(() => () => clearTimer(), []);

  return { state: local, update, saving, error, savedAt, resync };
}
