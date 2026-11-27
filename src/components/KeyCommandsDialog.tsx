import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Download, Keyboard, Lock, Plus, RotateCcw, Search, Upload, X } from 'lucide-react';
import { comboLabel, eventToCombo } from '@/lib/shortcuts/combo';
import {
  COMMANDS, COMMAND_BY_ID, GROUPS, assignCombo, availableOn, commandHint, exportShortcuts, findConflict, importShortcuts,
  isModified, removeCombo, restoreAll, restoreCommand, validateCombo, type CommandDef,
} from '@/lib/shortcuts/registry';
import {
  closeKeyCommands, commandRanRecently, getBindings, noteCommandRan, noteShortcutCaptured, platform, setBindings, setRecordingShortcut, subscribeBindings, useKeyCommandsOpen,
} from '@/lib/shortcuts/runtime';

type Filter = 'todos' | 'com' | 'sem' | 'alterados';
/** Gravando: qual comando e, se for para trocar, qual atalho dele está sendo regravado. */
type Recording = { id: string; replace?: string } | null;
type Notice =
  | { kind: 'conflict'; id: string; combo: string; replace?: string; other: string }
  | { kind: 'error'; text: string }
  | { kind: 'info'; text: string }
  | null;

const MOD_WORD = platform === 'mac' ? '⌘ (Command)' : 'Ctrl';

/** Tira acento e caixa para a busca achar "edicao" em "Edição". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

async function saveJsonFile(text: string, name: string): Promise<boolean> {
  type Picker = (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>;
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description: 'Atalhos do VS Stage', accept: { 'application/json': ['.json'] } }] });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return true;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return false;
      // sem permissão de gravar pelo seletor: cai no download comum
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/**
 * Janela "Atalhos de teclado" (como os Key Commands do Logic): busca, comandos por grupo,
 * clicar no atalho e apertar a combinação nova, aviso de conflito com troca, padrão de um
 * comando ou de todos, exportar e importar.
 */
export default function KeyCommandsDialog() {
  const open = useKeyCommandsOpen();
  if (!open) return null;
  return <KeyCommandsWindow />;
}

function KeyCommandsWindow() {
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [recording, setRecording] = useState<Recording>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    setRecordingShortcut(recording !== null);
    return () => setRecordingShortcut(false);
  }, [recording]);

  const tryAssign = (id: string, combo: string, replace?: string) => {
    const err = validateCombo(id, combo, platform);
    if (err) { setNotice({ kind: 'error', text: `${comboLabel(combo, platform)}: ${err}` }); return; }
    const cur = getBindings();
    if ((cur[id] ?? []).includes(combo) && combo !== replace) { setNotice({ kind: 'info', text: `${comboLabel(combo, platform)} já é deste comando.` }); return; }
    const other = findConflict(cur, id, combo);
    if (other) { setNotice({ kind: 'conflict', id, combo, replace, other }); return; }
    setBindings(assignCombo(cur, id, combo, { replace }));
    setNotice(null);
  };

  // Teclas: gravando, a próxima combinação vira o atalho; fora disso, Esc fecha a janela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const rec = recordingRef.current;
      if (rec) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        // Esc sozinho cancela a gravação (para gravar o Esc, use "Padrão" no comando que o tinha)
        if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { setRecording(null); return; }
        const combo = eventToCombo(e, platform);
        if (!combo) return; // só o modificador por enquanto: espera a tecla
        // o menu do sistema pode mandar o comando desta tecla logo depois (⌘M, ⌥K): não dispara
        noteShortcutCaptured();
        setRecording(null);
        tryAssign(rec.id, combo, rec.replace);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (notice) setNotice(null);
        else closeKeyCommands();
        return;
      }
      // o mesmo atalho que abre a janela também fecha (⌥K / Alt+K)
      const combo = eventToCombo(e, platform);
      if (combo && (getBindings()['app.keyCommands'] ?? []).includes(combo)) {
        e.preventDefault();
        // o menu do Mac/Windows tem o mesmo atalho: se ele acabou de abrir a janela, este aperto
        // é o mesmo e não fecha; se não, fecha e o menu que chega depois não reabre
        if (commandRanRecently('app.keyCommands')) return;
        noteCommandRan('app.keyCommands');
        closeKeyCommands();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [notice]);

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return COMMANDS.filter((c) => {
      if (!availableOn(c, platform)) return false;
      const list = bindings[c.id] ?? [];
      if (filter === 'com' && list.length === 0) return false;
      if (filter === 'sem' && list.length > 0) return false;
      if (filter === 'alterados' && !isModified(bindings, c.id)) return false;
      if (!q) return true;
      const labels = list.map((b) => comboLabel(b, platform)).join(' ');
      return fold(`${c.name} ${c.group} ${commandHint(c, platform)} ${labels}`).includes(q);
    });
  }, [bindings, query, filter]);

  const grouped = useMemo(() => GROUPS
    .map((g) => ({ group: g, items: visible.filter((c) => c.group === g) }))
    .filter((g) => g.items.length > 0), [visible]);

  const modifiedCount = COMMANDS.filter((c) => availableOn(c, platform) && isModified(bindings, c.id)).length;

  const doExport = async () => {
    const ok = await saveJsonFile(exportShortcuts(getBindings()), 'atalhos-vs-stage.json');
    if (ok) setNotice({ kind: 'info', text: 'Atalhos exportados.' });
  };
  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const { bindings: next, ignored } = importShortcuts(text, platform);
      setBindings(next);
      setNotice({ kind: 'info', text: ignored > 0 ? `Atalhos importados. ${ignored} ficaram de fora (repetidos, inválidos ou do sistema).` : 'Atalhos importados.' });
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message || 'Não foi possível ler o arquivo.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const filterKey = (f: Filter, label: string) => (
    <button
      type="button"
      className={`console-key h-6 px-2 text-[11px] ${filter === f ? 'is-lit-amber' : ''}`}
      onClick={() => setFilter(f)}
      aria-pressed={filter === f}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/60" onMouseDown={() => { if (!recording) closeKeyCommands(); }}>
      <div
        role="dialog"
        aria-label="Atalhos de teclado"
        className="console-face w-[820px] max-w-[94vw] h-[82vh] flex flex-col border border-logic-border-light shadow-logic-raised rounded-md overflow-hidden animate-[fadeIn_120ms_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-black/60 shrink-0">
          <span className="console-well w-8 h-8 flex items-center justify-center text-logic-lcd-amber">
            <Keyboard size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-stage text-[15px] font-semibold tracking-wide text-logic-text leading-tight">Atalhos de teclado</h2>
            <p className="console-legend mt-1">
              CLIQUE NO ATALHO E APERTE A COMBINAÇÃO NOVA · MODIFICADOR: {MOD_WORD.toUpperCase()}
            </p>
          </div>
          <button type="button" className="console-key w-7 h-7 flex items-center justify-center" onClick={closeKeyCommands} aria-label="Fechar">
            <X size={14} />
          </button>
        </div>

        {/* Busca, filtros e arquivo */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-black/60 shrink-0">
          <div className="console-well flex items-center gap-1.5 px-2.5 h-7 flex-1 min-w-[200px]">
            <Search size={12} className="text-logic-text-muted shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar comando ou tecla..."
              className="flex-1 bg-transparent text-xs text-logic-text placeholder:text-logic-text-muted outline-none"
            />
            {query && (
              <button type="button" className="text-logic-text-muted hover:text-logic-text" onClick={() => setQuery('')} aria-label="Limpar busca"><X size={11} /></button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {filterKey('todos', 'Todos')}
            {filterKey('com', 'Com atalho')}
            {filterKey('sem', 'Sem atalho')}
            {filterKey('alterados', `Alterados${modifiedCount ? ` (${modifiedCount})` : ''}`)}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <button type="button" className="console-key h-6 px-2 text-[11px] flex items-center gap-1" onClick={() => fileRef.current?.click()} title="Trazer atalhos de um arquivo .json">
              <Upload size={11} /> Importar
            </button>
            <button type="button" className="console-key h-6 px-2 text-[11px] flex items-center gap-1" onClick={() => void doExport()} title="Guardar os atalhos num arquivo .json">
              <Download size={11} /> Exportar
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void doImport(e.target.files?.[0])} />
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto logic-scroll px-4 pb-3">
          {grouped.length === 0 && (
            <div className="py-12 text-center text-xs text-logic-text-muted">Nenhum comando encontrado.</div>
          )}
          {grouped.map(({ group, items }) => (
            <section key={group}>
              <h3 className="console-legend sticky top-0 z-10 pt-3 pb-1.5 bg-[#24282d] uppercase">{group}</h3>
              <div className="console-well divide-y divide-black/70">
                {items.map((c) => (
                  <CommandRow
                    key={c.id}
                    def={c}
                    combos={bindings[c.id] ?? []}
                    modified={isModified(bindings, c.id)}
                    recording={recording?.id === c.id ? recording : null}
                    onRecord={(replace) => { setNotice(null); setRecording({ id: c.id, replace }); }}
                    onCancel={() => setRecording(null)}
                    onRemove={(combo) => { setBindings(removeCombo(getBindings(), c.id, combo)); setNotice(null); }}
                    onRestore={() => { setBindings(restoreCommand(getBindings(), c.id)); setNotice(null); }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Aviso e rodapé */}
        {notice && <NoticeBar notice={notice} onClose={() => setNotice(null)} onSwap={(n) => {
          setBindings(assignCombo(getBindings(), n.id, n.combo, { steal: true, replace: n.replace }));
          setNotice(null);
        }} />}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-black/60 shrink-0">
          <span className="text-2xs text-logic-text-muted flex-1 min-w-0">
            Os atalhos ficam guardados neste computador e valem para todos os projetos. Ao digitar num campo de texto, só o Salvar funciona.
          </span>
          {confirmAll ? (
            <>
              <span className="text-2xs text-logic-lcd-amber">Voltar todos ao padrão?</span>
              <button type="button" className="console-key is-lit-red h-6 px-2.5 text-[11px]" onClick={() => { setBindings(restoreAll()); setConfirmAll(false); setNotice({ kind: 'info', text: 'Todos os atalhos voltaram ao padrão.' }); }}>Voltar</button>
              <button type="button" className="console-key h-6 px-2.5 text-[11px]" onClick={() => setConfirmAll(false)}>Cancelar</button>
            </>
          ) : (
            <button type="button" className="console-key h-6 px-2.5 text-[11px] flex items-center gap-1" disabled={modifiedCount === 0} onClick={() => setConfirmAll(true)}>
              <RotateCcw size={11} /> Restaurar todos
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandRow({ def, combos, modified, recording, onRecord, onCancel, onRemove, onRestore }: {
  def: CommandDef;
  combos: string[];
  modified: boolean;
  recording: Recording;
  onRecord: (replace?: string) => void;
  onCancel: () => void;
  onRemove: (combo: string) => void;
  onRestore: () => void;
}) {
  const locked = !!def.locked;
  return (
    <div className={`flex items-center gap-3 px-3 py-1.5 ${recording ? 'bg-logic-lcd-amber/[0.06]' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-logic-text">
          {modified && <span className="console-led is-on-amber shrink-0" title="Alterado" />}
          <span className="truncate">{def.name}</span>
        </div>
        {def.hint && <div className="text-2xs text-logic-text-muted truncate mt-0.5">{commandHint(def, platform)}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 shrink-0 max-w-[55%]">
        {combos.map((combo) => {
          const isRec = recording?.replace === combo;
          return (
            <span key={combo} className="group relative inline-flex">
              <button
                type="button"
                disabled={locked}
                className={`console-display h-6 min-w-[44px] px-2 text-[12px] font-semibold tracking-wide transition-colors
                  ${isRec ? '!text-logic-lcd-amber animate-pulse' : modified ? '!text-logic-lcd-amber' : ''}
                  ${locked ? 'opacity-70 cursor-default' : 'hover:brightness-125'}`}
                onClick={() => (isRec ? onCancel() : onRecord(combo))}
                title={locked ? 'Atalho do sistema' : 'Clique e aperte a combinação nova'}
              >
                {isRec ? 'Aperte...' : comboLabel(combo, platform)}
              </button>
              {!locked && !isRec && (
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#3a3f46] border border-black text-logic-text-dim hover:text-white hover:bg-logic-lcd-red items-center justify-center hidden group-hover:flex"
                  onClick={() => onRemove(combo)}
                  aria-label={`Apagar ${comboLabel(combo, platform)}`}
                  title="Apagar este atalho"
                >
                  <X size={9} />
                </button>
              )}
            </span>
          );
        })}
        {locked ? (
          <span className="w-6 h-6 flex items-center justify-center text-logic-text-muted" title="Atalho do sistema: não dá para trocar"><Lock size={11} /></span>
        ) : recording && !recording.replace ? (
          <button type="button" className="console-display h-6 px-2 text-[12px] font-semibold !text-logic-lcd-amber animate-pulse" onClick={onCancel}>
            Aperte a combinação...
          </button>
        ) : (
          <button
            type="button"
            className="console-key w-6 h-6 flex items-center justify-center"
            onClick={() => onRecord()}
            title={combos.length ? 'Adicionar outro atalho' : 'Dar um atalho'}
            aria-label="Adicionar atalho"
          >
            <Plus size={11} />
          </button>
        )}
        {!locked && (
          <button
            type="button"
            className={`console-key w-6 h-6 flex items-center justify-center ${modified ? '' : 'invisible'}`}
            onClick={onRestore}
            title={def.defaults.length ? `Voltar ao padrão (${def.defaults.map((d) => comboLabel(d, platform)).join(', ')})` : 'Voltar ao padrão (sem atalho)'}
            aria-label="Voltar ao padrão"
          >
            <RotateCcw size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function NoticeBar({ notice, onClose, onSwap }: {
  notice: NonNullable<Notice>;
  onClose: () => void;
  onSwap: (n: Extract<NonNullable<Notice>, { kind: 'conflict' }>) => void;
}) {
  if (notice.kind === 'conflict') {
    const otherName = COMMAND_BY_ID.get(notice.other)?.name ?? notice.other;
    return (
      <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-md border border-logic-lcd-amber/50 bg-logic-lcd-amber/10 text-2xs text-logic-lcd-amber shrink-0" role="alert">
        <AlertTriangle size={13} className="shrink-0" />
        <span className="flex-1 min-w-0">
          <b>{comboLabel(notice.combo, platform)}</b> já é de <b>{otherName}</b>. Trocar tira o atalho de lá e põe aqui.
        </span>
        <button type="button" className="console-key is-lit-amber h-6 px-2.5 text-[11px]" onClick={() => onSwap(notice)}>Trocar</button>
        <button type="button" className="console-key h-6 px-2.5 text-[11px]" onClick={onClose}>Cancelar</button>
      </div>
    );
  }
  const err = notice.kind === 'error';
  return (
    <div
      className={`mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-md border text-2xs shrink-0
        ${err ? 'border-logic-lcd-red/50 bg-logic-lcd-red/10 text-logic-lcd-red' : 'border-logic-lcd-green/40 bg-logic-lcd-green/10 text-logic-lcd-green'}`}
      role={err ? 'alert' : 'status'}
    >
      {err && <AlertTriangle size={13} className="shrink-0" />}
      <span className="flex-1 min-w-0">{notice.text}</span>
      <button type="button" className="text-current opacity-70 hover:opacity-100" onClick={onClose} aria-label="Fechar aviso"><X size={12} /></button>
    </div>
  );
}
