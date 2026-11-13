import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  READY_CUE_GROUPS, findReadyCue, hasRecording, highlightParts, searchReadyCues, type ReadyCue,
} from '@/lib/maestroCues';

interface ReadyCuePickerProps {
  /** Texto atual da fala: a fala pronta igual a ele fica acesa. */
  text: string;
  /** Gerando a voz: escolher outra fala espera terminar. */
  busy: boolean;
  onPick: (cue: ReadyCue) => void;
  /** Enter numa busca sem resultado: o que foi digitado vira o texto da fala (sai na voz do Mac). */
  onFreeText?: (text: string) => void;
  /** Põe o cursor na busca ao abrir (marcação nova, ainda sem texto). */
  autoFocus?: boolean;
}

/** Quantos resultados da busca aparecem de uma vez (o resto aparece refinando a busca). */
const MAX_RESULTS = 80;

/** Atributo que pede à janela para o Esc limpar a busca em vez de fechar. */
export const ESC_CLEARS_ATTR = 'data-esc-clears';

const NO_RECORDING = 'Sem gravação ainda: até ser gravada, sai na voz do Mac';

/**
 * Falas prontas do Maestro por IA: a busca por palavras (em qualquer ordem, sem acento) acha a fala
 * em todos os assuntos; sem busca, um botão por assunto mostra as falas dele. Teclado: ↑ ↓ andam
 * nos resultados, Enter escolhe (o primeiro, se nada foi marcado), Esc limpa a busca.
 */
export default function ReadyCuePicker({ text, busy, onPick, onFreeText, autoFocus = false }: ReadyCuePickerProps) {
  const current = findReadyCue(text);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // o assunto aberto (Tom, Andamento...); abre no assunto da fala atual
  const [group, setGroup] = useState<string | null>(
    () => READY_CUE_GROUPS.find((g) => g.cues.some((c) => c.id === current?.id))?.id ?? null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const hits = useMemo(() => searchReadyCues(query), [query]);
  const shown = hits.slice(0, MAX_RESULTS);
  const searching = query.trim().length > 0;
  const openGroup = READY_CUE_GROUPS.find((g) => g.id === group);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  // busca nova: o primeiro resultado fica marcado
  useEffect(() => { setActive(0); }, [query]);
  // o marcado sempre visível na lista
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (cue: ReadyCue) => {
    if (busy) return;
    onPick(cue);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (!query) return; // busca vazia: o Esc fecha a janela, como sempre
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    } else if (e.key === 'ArrowDown' && shown.length) {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && shown.length) {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      if (!searching) return;
      e.preventDefault();
      const hit = shown[active] ?? shown[0];
      if (hit) pick(hit.cue);
      else onFreeText?.(query.trim());
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="console-well flex items-center gap-1.5 px-2 py-1">
        <Search size={11} className="text-logic-text-muted shrink-0" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          {...{ [ESC_CLEARS_ATTR]: '' }}
          placeholder="Buscar fala pronta (ex.: sobe tom, refrão 2, só voz)"
          className="flex-1 min-w-0 bg-transparent text-[11px] text-logic-text placeholder:text-logic-text-muted focus:outline-none"
          role="combobox"
          aria-label="Buscar nas falas prontas"
          aria-expanded={searching}
          aria-controls={listId}
          aria-activedescendant={searching && shown[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          spellCheck={false}
        />
        {searching && (
          <>
            <span className="font-mono text-[10px] text-logic-text-muted shrink-0" aria-live="polite">
              {hits.length} {hits.length === 1 ? 'fala' : 'falas'}
            </span>
            <button
              className="text-logic-text-muted hover:text-white p-0.5 rounded shrink-0"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              title="Limpar a busca (Esc)"
              aria-label="Limpar a busca"
            >
              <X size={11} />
            </button>
          </>
        )}
      </div>

      {searching ? (
        shown.length ? (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Falas prontas encontradas"
            className="console-well max-h-56 overflow-y-auto p-1 flex flex-col animate-[fadeIn_120ms_ease-out]"
          >
            {shown.map((h, i) => {
              const recorded = hasRecording(h.cue);
              const on = current?.id === h.cue.id;
              return (
                <button
                  key={h.cue.id}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`flex items-baseline gap-2 px-1.5 py-1 rounded text-left text-[11px] transition-colors disabled:opacity-50 ${
                    i === active ? 'bg-white/[0.07] shadow-[inset_2px_0_0_rgb(var(--lg-lcd-green))]' : 'hover:bg-white/5'
                  } ${on ? 'text-logic-lcd-green' : 'text-logic-text-dim'}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(h.cue)}
                  disabled={busy}
                  title={recorded ? 'Usar esta fala pronta (Enter)' : NO_RECORDING}
                >
                  <span className="flex-1 min-w-0 truncate">
                    {highlightParts(h.cue.text, h.ranges).map((p, k) => (p.match
                      ? <mark key={k} className="bg-transparent text-logic-lcd-green font-semibold">{p.text}</mark>
                      : <span key={k}>{p.text}</span>))}
                  </span>
                  {!recorded && <span className="text-[9px] text-logic-lcd-amber/70 shrink-0">sem gravação ainda</span>}
                  <span className="text-[9px] uppercase tracking-wider text-logic-text-muted shrink-0">{h.group.label}</span>
                </button>
              );
            })}
            {hits.length > shown.length && (
              <div className="px-1.5 py-1 text-[10px] text-logic-text-muted">
                Mais {hits.length - shown.length} falas: escreva mais uma palavra para achar.
              </div>
            )}
          </div>
        ) : (
          <div className="console-well px-2 py-1.5 text-[10px] text-logic-text-muted leading-snug">
            Nenhuma fala pronta com essas palavras.
            {onFreeText ? ' Enter usa o que você escreveu como texto da fala (sai na voz do Mac).' : ''}
          </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Falas prontas por assunto">
            {READY_CUE_GROUPS.map((g) => (
              <button
                key={g.id}
                className={`console-key h-6 px-1.5 text-[10px] ${group === g.id ? 'is-lit-green' : ''}`}
                onClick={() => setGroup(group === g.id ? null : g.id)}
                aria-expanded={group === g.id}
              >
                {g.label}
              </button>
            ))}
          </div>
          {openGroup && (
            <div className="console-well flex flex-wrap gap-1 p-1.5 max-h-48 overflow-y-auto animate-[fadeIn_120ms_ease-out]">
              {openGroup.cues.map((c) => {
                const on = current?.id === c.id;
                const recorded = hasRecording(c);
                return (
                  <button
                    key={c.id}
                    className={`px-1.5 py-1 rounded text-[11px] transition-colors ${
                      on ? 'bg-logic-lcd-green/20 text-logic-lcd-green' : 'text-logic-text-dim hover:text-logic-text hover:bg-white/5'
                    }`}
                    onClick={() => pick(c)}
                    disabled={busy}
                    title={recorded ? 'Usar esta fala pronta (voz Felipe ou Bianca, já no tempo)' : NO_RECORDING}
                  >
                    {c.text}
                    {!recorded && <span className="ml-1 inline-block w-1 h-1 rounded-full bg-logic-lcd-amber/60 align-middle" aria-label="sem gravação ainda" />}
                  </button>
                );
              })}
              {openGroup.cues.some((c) => !hasRecording(c)) && (
                <div className="basis-full px-1.5 pt-0.5 text-[10px] text-logic-text-muted">
                  <span className="inline-block w-1 h-1 rounded-full bg-logic-lcd-amber/60 align-middle mr-1" />
                  sem gravação ainda: sai na voz do Mac até ser gravada
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
