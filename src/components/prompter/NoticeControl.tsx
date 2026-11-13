import { useState } from 'react';
import { Send, Bookmark, RotateCw, Trash2, CalendarClock, Plus, Clock3 } from 'lucide-react';
import { Section } from '@/components/prompter/ScreenControlPanel';
import type { NoticeLayout, NoticeLevel, PrompterState } from '@/lib/prompterTypes';
import type { SetlistSong } from '@/lib/musicianTypes';
import { newId, withNotice } from '@/lib/prompterView';

// A cor de cada tipo é a da TV. Com ! para não sumir no hover da tecla (que fica grudado depois
// do toque no celular).
const LEVELS: { id: NoticeLevel; label: string; cls: string; dot: string }[] = [
  { id: 'info', label: 'Aviso', cls: '!border-[#b8e85c] !text-[#b8e85c] !bg-[#b8e85c]/15', dot: '#b8e85c' },
  { id: 'warn', label: 'Atenção', cls: '!border-logic-lcd-amber !text-logic-lcd-amber !bg-logic-lcd-amber/15', dot: '#ff8a1e' },
  { id: 'urgent', label: 'Urgente', cls: '!border-logic-lcd-red !text-logic-lcd-red !bg-logic-lcd-red/15', dot: '#ff4c4c' },
];

const LAYOUTS: { id: NoticeLayout; label: string }[] = [
  { id: 'bar', label: 'Faixa inferior' },
  { id: 'center', label: 'Centro da tela' },
];

const DURATIONS = [
  { sec: 0, label: 'Até tirar' },
  { sec: 10, label: '10 s' },
  { sec: 30, label: '30 s' },
  { sec: 60, label: '1 min' },
];

const MAX_TEXT = 200;

function Chips<T extends string | number>({ items, value, onChange, activeCls }: {
  items: { id: T; label: string; cls?: string }[]; value: T; onChange: (v: T) => void; activeCls?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <button
          key={String(it.id)}
          onClick={() => onChange(it.id)}
          aria-pressed={value === it.id}
          className={`console-key h-8 px-3 text-xs ${value === it.id ? (it.cls ?? activeCls ?? 'is-lit-blue') : ''}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Aviso pronto: toque manda; os botões de editar e apagar só aparecem no hover/foco. */
function PresetCard({ text, onSend, onEdit, onDelete, onScreen }: {
  text: string; onSend: () => void; onEdit: () => void; onDelete: () => void; onScreen: boolean;
}) {
  return (
    <li className={`group flex items-stretch rounded-lg border transition-colors ${onScreen ? 'border-logic-lcd-amber/60 bg-logic-lcd-amber/5' : 'border-logic-border bg-logic-bg-deep hover:border-logic-accent/60'}`}>
      <button
        onClick={onSend}
        className="flex-1 min-w-0 flex items-start gap-2 px-3 py-2.5 text-left"
        title="Mandar para a TV agora"
      >
        <Send size={13} className="mt-0.5 flex-shrink-0 text-logic-accent opacity-60 group-hover:opacity-100 transition-opacity" />
        <span className="text-sm text-logic-text leading-snug line-clamp-2">{text}</span>
      </button>
      <div className="flex items-center pr-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button onClick={onEdit} className="px-2 py-2 text-logic-text-muted hover:text-logic-text rounded transition-colors text-[11px] font-medium" title="Editar">
          Editar
        </button>
        <button onClick={onDelete} className="p-2 text-logic-text-muted hover:text-logic-lcd-red rounded transition-colors" title="Apagar">
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}

/**
 * `now` é a hora do servidor (hora local + `clockOffsetMs`): o "NA TV AGORA" e a contagem do aviso
 * batem com a TV. `clockOffsetMs` carimba o aviso novo na hora do servidor.
 */
export default function NoticeControl({ state, update, songs, now, clockOffsetMs = 0 }: {
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
  songs: SetlistSong[];
  now: number;
  clockOffsetMs?: number;
}) {
  const [text, setText] = useState('');
  const [level, setLevel] = useState<NoticeLevel>('info');
  const [layout, setLayout] = useState<NoticeLayout>('bar');
  const [duration, setDuration] = useState(0);
  const [schedSong, setSchedSong] = useState('');
  const [schedText, setSchedText] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const MAX_PRESETS = 30;

  const flash = (msg: string) => { setHint(msg); window.setTimeout(() => setHint(null), 2600); };

  const send = (msg: string) => {
    if (!msg.trim()) return;
    // Monta a partir do estado mais novo dentro do update: dois toques seguidos não podem
    // partir da mesma cópia (o segundo perderia o aviso do primeiro no histórico).
    update((s) => withNotice(s, msg, { level, layout, durationSec: duration }, Date.now() + clockOffsetMs) ?? s);
    setSaving(true);
    window.setTimeout(() => setSaving(false), 700);
  };

  const addPreset = (t: string) => {
    const clean = t.trim().slice(0, MAX_TEXT);
    if (!clean) return;
    if (state.presets.includes(clean)) { flash('Esse aviso já está na lista.'); return; }
    if (state.presets.length >= MAX_PRESETS) { flash(`Limite de ${MAX_PRESETS} avisos prontos. Apague algum para criar outro.`); return; }
    update((s) => ({ ...s, presets: [...s.presets, clean] }));
    setDraft('');
    flash('Aviso pronto salvo.');
  };

  const saveEdit = (i: number) => {
    const t = editText.trim().slice(0, MAX_TEXT);
    if (!t) { setEditing(null); return; }
    if (state.presets.some((p, j) => j !== i && p === t)) { flash('Já existe um aviso pronto com esse texto.'); return; }
    update((s) => ({ ...s, presets: s.presets.map((p, j) => (j === i ? t : p)) }));
    setEditing(null);
    flash('Aviso pronto alterado.');
  };

  const active = state.notice;
  const remaining = active && active.durationSec > 0 ? Math.ceil(active.durationSec - (now - active.sentAt) / 1000) : null;
  const isLive = active && (remaining === null || remaining > 0);
  const songName = (id: string) => songs.find((s) => s.id === id)?.name ?? 'Música removida';

  return (
    <div className="space-y-4">
      {/* No ar agora: ocupa a largura toda, porque é o que importa num show. */}
      {isLive && active && (
        <div className="rounded-xl border-2 border-logic-lcd-amber bg-logic-lcd-amber/10 p-4 flex items-start gap-3 animate-[fadeIn_160ms_ease-out]">
          <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-logic-lcd-amber animate-pulse flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold tracking-wider text-logic-lcd-amber flex items-center gap-2">
              NA TV AGORA
              {remaining !== null && <span className="tabular-nums font-normal text-logic-lcd-amber/80">{remaining}s</span>}
              <span className="font-normal text-logic-text-muted">· {active.layout === 'center' ? 'centro da tela' : 'faixa inferior'}</span>
            </p>
            <p className="text-base sm:text-lg text-logic-text mt-1 break-words leading-snug">{active.text}</p>
          </div>
          <button onClick={() => update((s) => ({ ...s, notice: null }))} className="px-4 py-2.5 rounded-lg bg-logic-lcd-amber text-black text-sm font-semibold hover:brightness-110 transition-all flex-shrink-0">
            Tirar
          </button>
        </div>
      )}

      {/* Compositor: texto à esquerda, ajustes à direita. Antes era tudo empilhado numa coluna
          estreita, sobrando metade da tela vazia. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        <Section title="Novo aviso para os artistas">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(text); setText(''); } }}
            rows={4}
            maxLength={MAX_TEXT}
            placeholder="Ex.: O prefeito chegou, mandar um alô"
            className="console-well w-full px-3 py-3 rounded-lg border border-black text-base text-logic-text leading-relaxed outline-none focus:border-logic-accent resize-none placeholder:text-logic-text-muted"
          />
          <div className="flex items-center justify-between mt-1.5 text-2xs text-logic-text-muted">
            <span>⌘↵ manda sem tirar a mão do teclado</span>
            <span className="tabular-nums">{text.length}/{MAX_TEXT}</span>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { send(text); setText(''); }}
              disabled={!text.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-lg bg-logic-accent hover:bg-logic-accent-hover text-white font-semibold disabled:opacity-40 transition-all active:scale-[0.98]"
            >
              <Send size={16} /> Mandar para a tela
            </button>
            <button
              onClick={() => addPreset(text)}
              disabled={!text.trim()}
              className="console-key px-4 flex items-center gap-2 text-xs disabled:opacity-40"
              title="Guardar como aviso pronto"
            >
              <Bookmark size={15} /> <span className="hidden sm:inline">Guardar</span>
            </button>
          </div>
        </Section>

        <Section title="Como aparece na TV">
          <div className="space-y-3">
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-logic-text-muted mb-1.5">Tipo</p>
              <Chips items={LEVELS} value={level} onChange={setLevel} />
            </div>
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-logic-text-muted mb-1.5">Posição</p>
              <Chips items={LAYOUTS} value={layout} onChange={setLayout} />
            </div>
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-logic-text-muted mb-1.5">Tempo na tela</p>
              <Chips items={DURATIONS.map((d) => ({ id: d.sec, label: d.label }))} value={duration} onChange={setDuration} />
            </div>
            {layout === 'bar' && (
              <div>
                <div className="flex justify-between text-2xs text-logic-text-muted mb-1.5">
                  <span className="font-semibold uppercase tracking-wider">Altura da faixa</span>
                  <span className="tabular-nums">{state.barSize}% da tela</span>
                </div>
                <input
                  type="range" min={12} max={50} step={1} value={state.barSize}
                  onChange={(e) => { const v = Number(e.target.value); update((s) => ({ ...s, barSize: v })); }}
                  className="w-full accent-logic-accent"
                />
              </div>
            )}
            <p className="text-2xs text-logic-text-muted leading-relaxed pt-1 border-t border-logic-border/60">
              Toque em qualquer aviso pronto para mandar com esse tipo, posição e tempo.
            </p>
          </div>
        </Section>
      </div>

      <Section
        title="Avisos prontos"
        aside={
          <span className="flex items-center gap-2">
            {hint && <span className="text-2xs text-logic-lcd-amber animate-[fadeIn_160ms_ease-out]">{hint}</span>}
            <span className="text-2xs text-logic-text-muted tabular-nums">{state.presets.length}/{MAX_PRESETS}</span>
          </span>
        }
      >
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_TEXT))}
            onKeyDown={(e) => { if (e.key === 'Enter') addPreset(draft); }}
            placeholder="Criar aviso pronto. Ex.: Agradecer a produção"
            className="console-well flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-black text-sm text-logic-text outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted"
          />
          <button
            onClick={() => addPreset(draft)}
            disabled={!draft.trim() || state.presets.length >= MAX_PRESETS}
            className="flex items-center gap-1.5 px-4 rounded-lg bg-logic-accent hover:bg-logic-accent-hover text-white text-sm font-semibold disabled:opacity-40 transition-all active:scale-[0.97]"
          >
            <Plus size={15} /> Salvar
          </button>
        </div>

        {state.presets.length === 0 ? (
          <p className="text-sm text-logic-text-dim mt-3">Nenhum aviso pronto ainda. Crie o primeiro acima.</p>
        ) : (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
            {state.presets.map((pr, i) => (
              editing === i ? (
                <li key={`edit-${i}`} className="flex items-center gap-1 rounded-lg bg-logic-bg-deep border border-logic-accent pl-1 pr-1">
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value.slice(0, MAX_TEXT))}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(i); if (e.key === 'Escape') setEditing(null); }}
                    className="flex-1 min-w-0 px-2 py-2 my-1 rounded bg-logic-bg-panel border border-logic-accent text-sm text-logic-text outline-none"
                  />
                  <button onClick={() => saveEdit(i)} className="p-2 text-logic-lcd-green hover:bg-logic-bg-elevated rounded transition-colors" title="Salvar">
                    <span className="text-[11px] font-semibold">OK</span>
                  </button>
                  <button onClick={() => setEditing(null)} className="p-2 text-logic-text-muted hover:text-logic-text rounded transition-colors" title="Cancelar">
                    <Trash2 size={13} />
                  </button>
                </li>
              ) : (
                <PresetCard
                  key={pr}
                  text={pr}
                  onScreen={Boolean(isLive && active?.text === pr)}
                  onSend={() => send(pr)}
                  onEdit={() => { setEditing(i); setEditText(pr); }}
                  onDelete={() => update((s) => ({ ...s, presets: s.presets.filter((_, j) => j !== i) }))}
                />
              )
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Section
          title="Avisos programados por música"
          aside={<span className="text-2xs text-logic-text-muted tabular-nums">{state.scheduled.length}/100</span>}
        >
          <p className="text-xs text-logic-text-dim mb-3 leading-relaxed">Aparecem sozinhos quando a música começa a tocar na TV.</p>
          <div className="space-y-2">
            <select
              value={schedSong}
              onChange={(e) => setSchedSong(e.target.value)}
              className="console-well w-full px-3 py-2.5 rounded-lg border border-black text-sm text-logic-text outline-none focus:border-logic-accent"
            >
              <option value="">Escolha a música</option>
              {songs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex gap-2">
              <input
                value={schedText}
                onChange={(e) => setSchedText(e.target.value.slice(0, MAX_TEXT))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !schedSong || !schedText.trim()) return;
                  const t = schedText.trim();
                  update((s) => ({ ...s, scheduled: [...s.scheduled, { id: newId(), songId: schedSong, text: t, level, layout, durationSec: duration || 15 }].slice(0, 100) }));
                  setSchedText('');
                }}
                placeholder="Ex.: Chamar o público para cantar"
                className="console-well flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-black text-sm text-logic-text outline-none focus:border-logic-accent placeholder:text-logic-text-muted"
              />
              <button
                disabled={!schedSong || !schedText.trim()}
                onClick={() => {
                  const t = schedText.trim();
                  update((s) => ({ ...s, scheduled: [...s.scheduled, { id: newId(), songId: schedSong, text: t, level, layout, durationSec: duration || 15 }].slice(0, 100) }));
                  setSchedText('');
                }}
                className="console-key px-3 flex items-center justify-center disabled:opacity-40"
                title="Programar"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          {state.scheduled.length === 0 ? (
            <p className="text-sm text-logic-text-dim mt-3">Nenhum aviso programado.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 max-h-72 overflow-y-auto logic-scroll pr-1">
              {state.scheduled.map((sc) => (
                <li key={sc.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-logic-bg-deep border border-logic-border">
                  <CalendarClock size={14} className="text-logic-accent flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-2xs text-logic-text-dim truncate">{songName(sc.songId)} · {sc.durationSec}s</p>
                    <p className="text-sm text-logic-text truncate">{sc.text}</p>
                  </div>
                  <button onClick={() => update((s) => ({ ...s, scheduled: s.scheduled.filter((x) => x.id !== sc.id) }))} className="p-1.5 text-logic-text-muted hover:text-logic-lcd-red transition-colors" title="Remover">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Histórico"
          aside={
            state.history.length > 0 ? (
              <button onClick={() => update((s) => ({ ...s, history: [] }))} className="console-key h-6 px-2 text-[11px]">Limpar</button>
            ) : (
              <span className="text-2xs text-logic-text-muted tabular-nums">{state.history.length}/20</span>
            )
          }
        >
          {state.history.length === 0 ? (
            <p className="text-sm text-logic-text-dim">Os últimos 20 avisos enviados aparecem aqui.</p>
          ) : (
            <ul className="space-y-1 max-h-72 overflow-y-auto logic-scroll pr-1">
              {state.history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-logic-bg-elevated transition-colors group">
                  <span className="text-2xs tabular-nums text-logic-text-muted w-10 flex-shrink-0">
                    {new Date(h.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="flex-1 min-w-0 text-sm text-logic-text truncate" title={h.text}>{h.text}</span>
                  <button onClick={() => send(h.text)} className="p-1.5 text-logic-text-muted hover:text-logic-accent transition-colors" title="Mandar de novo">
                    <RotateCw size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {saving && (
        <p className="flex items-center gap-1.5 text-2xs text-logic-lcd-green" role="status">
          <Clock3 size={11} /> Enviado.
        </p>
      )}
    </div>
  );
}
