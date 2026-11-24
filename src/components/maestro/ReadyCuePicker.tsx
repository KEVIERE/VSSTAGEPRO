import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, X } from 'lucide-react';
import {
  READY_CUE_GROUPS, cueInPicker, findReadyCue, highlightParts, searchReadyCues, subscribeVoicePacks, voicePacksVersion, type ReadyCue,
} from '@/lib/maestroCues';

interface ReadyCuePickerProps {
  /** Texto atual da fala: a fala pronta igual a ele fica acesa. */
  text: string;
  onPick: (cue: ReadyCue) => void;
  /** O ponteiro chegou na fala: o áudio dela passa na frente da pré-carga. */
  onPrime?: (text: string) => void;
  /** Enter numa busca sem resultado: o que foi digitado vira o texto da fala (sai na voz do Mac). */
  onFreeText?: (text: string) => void;
  /** Avisa quais falas estão na tela, para deixar o áudio delas pronto antes do clique. */
  onVisible?: (texts: string[]) => void;
  /** Põe o cursor na busca ao abrir (marcação nova, ainda sem texto). */
  autoFocus?: boolean;
  /** Voz escolhida: a lista mostra só as falas que ela tem gravadas. */
  voice?: string;
  /** Escolher a fala já toca (voz pronta)? Nas vozes clonadas ela só vai para o texto. */
  playsOnPick?: boolean;
}

/** Quantos resultados da busca aparecem de uma vez (o resto aparece refinando a busca). */
const MAX_RESULTS = 80;

/** Atributo que pede à janela para o Esc limpar a busca em vez de fechar. */
export const ESC_CLEARS_ATTR = 'data-esc-clears';

/**
 * Falas do Maestro (biblioteca de frases de palco): a busca por palavras (em qualquer ordem, sem acento) acha a fala
 * em todos os assuntos; sem busca, um botão por assunto mostra as falas dele. Teclado: ↑ ↓ andam
 * nos resultados, Enter escolhe (o primeiro, se nada foi marcado), Esc limpa a busca. Escolher
 * nunca espera geração: no Maestro IA a fala toca na hora; nas vozes clonadas ela vai para o texto.
 */
export default function ReadyCuePicker({ text, onPick, onPrime, onFreeText, onVisible, autoFocus = false, voice, playsOnPick = false }: ReadyCuePickerProps) {
  const current = findReadyCue(text);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // o assunto aberto (Tom, Andamento...); abre no assunto da fala atual
  const packs = useSyncExternalStore(subscribeVoicePacks, voicePacksVersion);
  // só os assuntos e as falas que esta voz tem gravados
  const groups = useMemo(
    () => READY_CUE_GROUPS.map((g) => ({ ...g, cues: g.cues.filter((c) => cueInPicker(voice, c)) })).filter((g) => g.cues.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voice, packs],
  );
  const [group, setGroup] = useState<string | null>(
    () => READY_CUE_GROUPS.find((g) => g.cues.some((c) => c.id === current?.id))?.id ?? null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hits = useMemo(() => searchReadyCues(query, Infinity, (c) => cueInPicker(voice, c)), [query, voice, packs]);
  const shown = hits.slice(0, MAX_RESULTS);
  const searching = query.trim().length > 0;
  const openGroup = groups.find((g) => g.id === group);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  // busca nova: o primeiro resultado fica marcado
  useEffect(() => { setActive(0); }, [query]);
  // o marcado sempre visível na lista
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // as falas à vista de verdade (dentro da área rolável): só elas pré-carregam
  const lastVisible = useRef<string | null>(null);
  const reportVisible = useCallback(() => {
    const box = listRef.current;
    let texts: string[] = [];
    if (box) {
      const area = box.getBoundingClientRect();
      texts = [...box.querySelectorAll<HTMLElement>('[data-cue-text]')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > area.top && r.top < area.bottom; })
        .map((el) => el.dataset.cueText as string);
    }
    const key = texts.join('\n');
    if (key === lastVisible.current) return;
    lastVisible.current = key;
    onVisible?.(texts);
  }, [onVisible]);
  const scrollFrame = useRef(0);
  const onListScroll = () => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = 0; reportVisible(); });
  };
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  const listKey = (searching ? shown.map((h) => h.cue.id) : openGroup?.cues.map((c) => c.id) ?? []).join('\n');
  useEffect(() => { reportVisible(); }, [listKey, reportVisible]);

  const pick = (cue: ReadyCue) => onPick(cue);

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
          placeholder="Buscar fala (ex.: sobe tom, refrão 2, só voz)"
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
            onScroll={onListScroll}
            className="console-well max-h-40 overflow-y-auto p-1 flex flex-col animate-[fadeIn_120ms_ease-out]"
          >
            {shown.map((h, i) => {
              const on = current?.id === h.cue.id;
              return (
                <button
                  key={h.cue.id}
                  id={`${listId}-${i}`}
                  data-index={i}
                  data-cue-text={h.cue.text}
                  role="option"
                  aria-selected={i === active}
                  className={`flex items-baseline gap-2 px-1.5 py-1 rounded text-left text-[11px] transition-colors disabled:opacity-50 ${
                    i === active ? 'bg-white/[0.07] shadow-[inset_2px_0_0_rgb(var(--lg-lcd-green))]' : 'hover:bg-white/5'
                  } ${on ? 'text-logic-lcd-green' : 'text-logic-text-dim'}`}
                  onMouseEnter={() => setActive(i)}
                  onPointerEnter={() => onPrime?.(h.cue.text)}
                  onPointerDown={() => onPrime?.(h.cue.text)}
                  onClick={() => pick(h.cue)}
                  title={playsOnPick ? 'Tocar esta fala (Enter)' : 'Pôr esta fala no texto (Enter)'}
                >
                  <span className="flex-1 min-w-0 truncate">
                    {highlightParts(h.cue.text, h.ranges).map((p, k) => (p.match
                      ? <mark key={k} className="bg-transparent text-logic-lcd-green font-semibold">{p.text}</mark>
                      : <span key={k}>{p.text}</span>))}
                  </span>
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
            Nenhuma fala com essas palavras.
            {onFreeText ? ' Enter usa o que você escreveu como texto da fala.' : ''}
          </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Falas prontas por assunto">
            {groups.map((g) => (
              <button
                key={g.id}
                className={`console-key h-5 px-1.5 text-[10px] ${group === g.id ? 'is-lit-green' : ''}`}
                onClick={() => setGroup(group === g.id ? null : g.id)}
                aria-expanded={group === g.id}
              >
                {g.label}
              </button>
            ))}
          </div>
          {openGroup && (
            <div ref={listRef} onScroll={onListScroll} className="console-well flex flex-wrap gap-1 p-1.5 max-h-32 overflow-y-auto animate-[fadeIn_120ms_ease-out]">
              {openGroup.cues.map((c) => {
                const on = current?.id === c.id;
                return (
                  <button
                    key={c.id}
                    data-cue-text={c.text}
                    className={`px-1.5 py-1 rounded text-[11px] transition-colors ${
                      on ? 'bg-logic-lcd-green/20 text-logic-lcd-green' : 'text-logic-text-dim hover:text-logic-text hover:bg-white/5'
                    }`}
                    onPointerEnter={() => onPrime?.(c.text)}
                    onPointerDown={() => onPrime?.(c.text)}
                    onClick={() => pick(c)}
                    title={playsOnPick ? 'Tocar esta fala' : 'Pôr esta fala no texto'}
                  >
                    {c.text}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
