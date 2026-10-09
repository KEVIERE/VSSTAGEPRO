import { useState } from 'react';
import { Send, Bookmark, X, RotateCw, Trash2, CalendarClock, Plus } from 'lucide-react';
import { Section } from '@/components/prompter/ScreenControlPanel';
import PresetNotices from '@/components/prompter/PresetNotices';
import type { NoticeLayout, NoticeLevel, PrompterState } from '@/lib/prompterTypes';
import type { SetlistSong } from '@/lib/musicianTypes';
import { newId, withNotice } from '@/lib/prompterView';

const LEVELS: { id: NoticeLevel; label: string; cls: string }[] = [
  { id: 'info', label: 'Aviso', cls: 'border-[#64d2ff] text-[#64d2ff] bg-[#64d2ff]/10' },
  { id: 'warn', label: 'Atenção', cls: 'border-logic-lcd-amber text-logic-lcd-amber bg-logic-lcd-amber/10' },
  { id: 'urgent', label: 'Urgente', cls: 'border-logic-lcd-red text-logic-lcd-red bg-logic-lcd-red/10' },
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
          className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${value === it.id ? (it.cls ?? activeCls ?? 'border-logic-accent text-logic-accent bg-logic-accent/10') : 'border-logic-border text-logic-text-dim hover:text-logic-text'}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export default function NoticeControl({ state, update, songs, now }: {
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
  songs: SetlistSong[];
  now: number;
}) {
  const [text, setText] = useState('');
  const [level, setLevel] = useState<NoticeLevel>('info');
  const [layout, setLayout] = useState<NoticeLayout>('bar');
  const [duration, setDuration] = useState(0);
  const [schedSong, setSchedSong] = useState('');
  const [schedText, setSchedText] = useState('');

  const send = (msg: string) => {
    if (!msg.trim()) return;
    update((s) => withNotice(s, msg, { level, layout, durationSec: duration }) ?? s);
  };

  const active = state.notice;
  const remaining = active && active.durationSec > 0 ? Math.ceil(active.durationSec - (now - active.sentAt) / 1000) : null;
  const isLive = active && (remaining === null || remaining > 0);
  const songName = (id: string) => songs.find((s) => s.id === id)?.name ?? 'Música removida';

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <div className="space-y-4">
        {isLive && active && (
          <div className="rounded-xl border-2 border-logic-lcd-amber bg-logic-lcd-amber/10 p-4 flex items-start gap-3 animate-[fadeIn_160ms_ease-out]">
            <span className="mt-1 w-2.5 h-2.5 rounded-full bg-logic-lcd-amber animate-pulse flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold tracking-wider text-logic-lcd-amber">NA TELA AGORA{remaining !== null ? ` · ${remaining}s` : ''}</p>
              <p className="text-base text-logic-text mt-1 break-words">{active.text}</p>
            </div>
            <button onClick={() => update((s) => ({ ...s, notice: null }))} className="px-4 py-2.5 rounded-lg bg-logic-lcd-amber text-black text-sm font-semibold hover:brightness-110 transition-all">
              Tirar
            </button>
          </div>
        )}

        <Section title="Novo aviso para os artistas">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(text); setText(''); } }}
            rows={3}
            placeholder="Ex.: O prefeito chegou, mandar um alô"
            className="w-full px-3 py-3 rounded-lg bg-logic-bg-deep border border-logic-border text-base text-logic-text leading-relaxed outline-none focus:border-logic-accent resize-none"
          />
          <div className="space-y-3 mt-3">
            <Chips items={LEVELS} value={level} onChange={setLevel} />
            <Chips items={LAYOUTS} value={layout} onChange={setLayout} />
            <Chips items={DURATIONS.map((d) => ({ id: d.sec, label: d.label }))} value={duration} onChange={setDuration} />
            {layout === 'bar' && (
              <div>
                <div className="flex justify-between text-xs text-logic-text-dim mb-1.5">
                  <span>Altura da faixa</span><span className="tabular-nums">{state.barSize}% da tela</span>
                </div>
                <input
                  type="range" min={12} max={50} step={1} value={state.barSize}
                  onChange={(e) => { const v = Number(e.target.value); update((s) => ({ ...s, barSize: v })); }}
                  className="w-full accent-logic-accent"
                />
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => { send(text); setText(''); }}
              disabled={!text.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-lg bg-logic-accent hover:bg-logic-accent-hover text-white font-semibold disabled:opacity-40 transition-all active:scale-[0.98]"
            >
              <Send size={16} /> Mandar para a tela
            </button>
            <button
              onClick={() => { const t = text.trim(); if (t) update((s) => ({ ...s, presets: s.presets.includes(t) ? s.presets : [...s.presets, t].slice(0, 30) })); }}
              disabled={!text.trim()}
              className="px-4 rounded-lg border border-logic-border text-logic-text-dim hover:text-logic-text disabled:opacity-40 transition-colors"
              title="Guardar como aviso pronto"
            >
              <Bookmark size={16} />
            </button>
          </div>
        </Section>

        <Section title="Avisos prontos">
          <PresetNotices presets={state.presets} onSend={send} onChange={(next) => update((s) => ({ ...s, presets: next }))} />
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Avisos programados por música">
          <p className="text-xs text-logic-text-dim mb-3 leading-relaxed">Aparecem sozinhos nos primeiros segundos da música escolhida.</p>
          <div className="space-y-2">
            <select
              value={schedSong}
              onChange={(e) => setSchedSong(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-logic-bg-deep border border-logic-border text-sm text-logic-text outline-none focus:border-logic-accent"
            >
              <option value="">Escolha a música</option>
              {songs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex gap-2">
              <input
                value={schedText}
                onChange={(e) => setSchedText(e.target.value.slice(0, MAX_TEXT))}
                placeholder="Ex.: Chamar o público para cantar"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-logic-bg-deep border border-logic-border text-sm text-logic-text outline-none focus:border-logic-accent"
              />
              <button
                disabled={!schedSong || !schedText.trim()}
                onClick={() => {
                  const t = schedText.trim();
                  update((s) => ({ ...s, scheduled: [...s.scheduled, { id: newId(), songId: schedSong, text: t, level, layout, durationSec: duration || 15 }].slice(0, 100) }));
                  setSchedText('');
                }}
                className="px-3 rounded-lg bg-logic-bg-elevated hover:bg-logic-border-light disabled:opacity-40 transition-colors"
                title="Programar"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5">
            {state.scheduled.map((sc) => (
              <li key={sc.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-logic-bg-deep border border-logic-border">
                <CalendarClock size={14} className="text-logic-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-logic-text-dim truncate">{songName(sc.songId)} · {sc.durationSec}s</p>
                  <p className="text-sm text-logic-text truncate">{sc.text}</p>
                </div>
                <button onClick={() => update((s) => ({ ...s, scheduled: s.scheduled.filter((x) => x.id !== sc.id) }))} className="p-1.5 text-logic-text-muted hover:text-logic-lcd-red transition-colors" title="Remover">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Histórico"
          aside={state.history.length > 0 && (
            <button onClick={() => update((s) => ({ ...s, history: [] }))} className="text-xs text-logic-text-muted hover:text-logic-text">Limpar</button>
          )}
        >
          {state.history.length === 0 && <p className="text-sm text-logic-text-dim">Os avisos enviados aparecem aqui.</p>}
          <ul className="space-y-1">
            {state.history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-logic-bg-elevated transition-colors">
                <span className="text-xs tabular-nums text-logic-text-muted w-11 flex-shrink-0">
                  {new Date(h.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="flex-1 min-w-0 text-sm text-logic-text truncate">{h.text}</span>
                <button onClick={() => send(h.text)} className="p-1.5 text-logic-text-muted hover:text-logic-accent transition-colors" title="Mandar de novo">
                  <RotateCw size={14} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
