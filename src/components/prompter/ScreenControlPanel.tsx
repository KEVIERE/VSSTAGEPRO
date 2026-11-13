import { useEffect, useRef, useState } from 'react';
import {
  MonitorOff, FlipHorizontal, Image as ImageIcon, ChevronLeft, ChevronRight, RotateCcw, FileText, Clock, Timer,
  ListMusic, Megaphone, PlayCircle, QrCode, AlertTriangle,
} from 'lucide-react';
import StageScreen from '@/components/prompter/StageScreen';
import ProducerLogoUpload from '@/components/prompter/ProducerLogoUpload';
import QuickNotices from '@/components/prompter/QuickNotices';
import type { PrompterSnapshot, PrompterState, ScreenToggles } from '@/lib/prompterTypes';
import { computeLiveView, holdForward } from '@/lib/liveClock';
import { autoPageIndex } from '@/lib/prompterView';

const TOGGLES: { id: keyof ScreenToggles; label: string; icon: typeof Clock }[] = [
  { id: 'lyrics', label: 'Letra', icon: FileText },
  { id: 'clock', label: 'Relógio', icon: Clock },
  { id: 'showTime', label: 'Tempo de Show', icon: Timer },
  { id: 'nowNext', label: 'Atual e próxima', icon: PlayCircle },
  { id: 'playlist', label: 'Playlist lateral', icon: ListMusic },
  { id: 'notices', label: 'Avisos', icon: Megaphone },
  { id: 'logo', label: 'Logo da banda/artista', icon: ImageIcon },
  { id: 'logoCorner', label: 'Logo no canto (sempre)', icon: ImageIcon },
  { id: 'joinQr', label: 'QR code dos músicos (Rede Local)', icon: QrCode },
];

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** Painel da mesa: chassi grafite com o título gravado no trilho de alumínio. */
export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="console-face border-2 border-black rounded-lg shadow-lg overflow-hidden">
      {/* min-h e não h fixa: o aviso relâmpago do trilho quebra em duas linhas no celular */}
      <div className="console-rail min-h-8 px-3 py-1 flex items-center justify-between gap-2 border-b-2 border-black">
        <h3 className="console-legend leading-tight truncate">{title}</h3>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-flex w-8 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-logic-lcd-green' : 'bg-logic-border-light'}`} style={{ height: 18 }}>
      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </span>
  );
}

export default function ScreenControlPanel({ code, snap, sync, now, state, update, logoUrl, onManageNotices }: {
  code: string;
  snap: PrompterSnapshot;
  sync: { lagMs: number; receivedAt: number };
  now: number;
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
  logoUrl: string | null;
  onManageNotices: () => void;
}) {
  const mem = useRef<{ songId: string | null; t: number }>({ songId: null, t: 0 });
  const live = snap.show.live;
  const current = live?.currentSongId ? snap.show.setlist.songs.find((s) => s.id === live.currentSongId) ?? null : null;
  const lv = holdForward(computeLiveView(live, current?.duration, sync.lagMs, sync.receivedAt, now), current?.id ?? null, mem.current, current?.duration);
  const pages = current ? snap.lyrics.find((l) => l.song_id === current.id)?.pages ?? [] : [];
  const autoIdx = autoPageIndex(pages, lv.currentTime);
  const delta = current && state.nudge.songId === current.id ? state.nudge.delta : 0;
  const shownIdx = Math.max(-1, Math.min(pages.length - 1, autoIdx + delta));

  const nudge = (d: number) => {
    if (!current) return;
    update((s) => {
      const cur = s.nudge.songId === current.id ? s.nudge.delta : 0;
      const target = Math.max(-1, Math.min(pages.length - 1, autoIdx + cur + d));
      return { ...s, nudge: { songId: current.id, delta: target - autoIdx } };
    });
  };

  const statusText = lv.status === 'live' ? (lv.isPlaying ? 'Diretor tocando' : 'Diretor parado') : lv.status === 'nosignal' ? 'Sem sinal do diretor' : 'Show fora do ar';
  // LED da mesa: apagado ele é escuro e aparece no alumínio; aceso, brilha
  const statusLed = lv.status === 'live' ? (lv.isPlaying ? 'is-on-green' : '') : 'is-on-amber';

  // Duração e início: o campo é um rascunho e só vai para a TV ao terminar (sair do campo ou
  // Enter). Antes cada tecla ia ao vivo: apagar "120" para digitar "90" passava por 1 minuto e a
  // TV mostrava "Passou do horário" em vermelho para a banda.
  const durFocus = useRef(false);
  const durSkip = useRef(false);
  const [durDraft, setDurDraft] = useState(String(state.showDurationMin));
  useEffect(() => { if (!durFocus.current) setDurDraft(String(state.showDurationMin)); }, [state.showDurationMin]);
  const commitDur = () => {
    durFocus.current = false;
    if (durSkip.current) { durSkip.current = false; return; }
    const n = Math.round(Number(durDraft.replace(',', '.')));
    if (!durDraft.trim() || !Number.isFinite(n)) { setDurDraft(String(state.showDurationMin)); return; }
    const v = Math.min(600, Math.max(1, n));
    setDurDraft(String(v));
    if (v !== state.showDurationMin) update((s) => ({ ...s, showDurationMin: v }));
  };

  const startFocus = useRef(false);
  const startSkip = useRef(false);
  const [startDraft, setStartDraft] = useState(toLocalInput(state.showStartAt));
  useEffect(() => { if (!startFocus.current) setStartDraft(toLocalInput(state.showStartAt)); }, [state.showStartAt]);
  const commitStart = () => {
    startFocus.current = false;
    if (startSkip.current) { startSkip.current = false; return; }
    const d = startDraft ? new Date(startDraft) : null;
    // no Chrome o campo dispara valores válidos enquanto se digita o ano (0002, 0020...)
    if (d && (Number.isNaN(d.getTime()) || d.getFullYear() < 2000)) { setStartDraft(toLocalInput(state.showStartAt)); return; }
    const iso = d ? d.toISOString() : null;
    if (iso === state.showStartAt) return;
    if (d && state.showStartAt && toLocalInput(state.showStartAt) === startDraft) return; // mesmo minuto
    update((s) => ({ ...s, showStartAt: iso }));
  };

  const bigToggles = [
    { on: state.blackout, label: 'Tela preta', icon: MonitorOff, set: () => update((s) => ({ ...s, blackout: !s.blackout })), color: 'border-logic-lcd-red text-logic-lcd-red bg-logic-lcd-red/10' },
    { on: state.mirror, label: 'Espelhar', icon: FlipHorizontal, set: () => update((s) => ({ ...s, mirror: !s.mirror })), color: 'border-logic-lcd-amber text-logic-lcd-amber bg-logic-lcd-amber/10' },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start">
      <div className="space-y-4">
        <Section
          title="Na TV agora"
          aside={<span className="flex items-center gap-1.5 text-xs text-logic-text-dim"><span className={`console-led shrink-0 ${statusLed}`} />{statusText}</span>}
        >
          <div className="aspect-video rounded-lg overflow-hidden ring-1 ring-logic-border-light">
            <StageScreen snap={{ ...snap, prompter: state }} sync={sync} now={now} logoUrl={logoUrl} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {bigToggles.map(({ on, label, icon: Icon, set, color }) => (
              <button
                key={label}
                onClick={set}
                className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 px-2 py-3 rounded-lg border text-sm font-medium transition-all active:scale-[0.97] ${on ? color : 'border-logic-border text-logic-text-dim hover:text-logic-text hover:border-logic-border-light'}`}
              >
                <Icon size={17} /> <span className="text-center leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Página da letra">
          {current && pages.length > 0 ? (
            <div className="flex items-center gap-3">
              <button onClick={() => nudge(-1)} className="flex-1 flex items-center justify-center gap-1.5 py-4 rounded-lg bg-logic-bg-elevated hover:bg-logic-border-light font-medium transition-colors active:scale-[0.98]">
                <ChevronLeft size={18} /> Voltar
              </button>
              <div className="text-center min-w-[96px]">
                <p className="text-2xl font-semibold tabular-nums text-logic-text">{shownIdx + 1}<span className="text-logic-text-muted text-base">/{pages.length}</span></p>
                {delta !== 0 ? (
                  <button onClick={() => update((s) => ({ ...s, nudge: { songId: null, delta: 0 } }))} className="mt-1 flex items-center gap-1 mx-auto text-xs text-logic-lcd-amber hover:underline">
                    <RotateCcw size={12} /> Voltar ao automático
                  </button>
                ) : <p className="text-xs text-logic-text-muted mt-1">Automático</p>}
              </div>
              <button onClick={() => nudge(1)} className="flex-1 flex items-center justify-center gap-1.5 py-4 rounded-lg bg-logic-bg-elevated hover:bg-logic-border-light font-medium transition-colors active:scale-[0.98]">
                Avançar <ChevronRight size={18} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-logic-text-dim">{current ? `"${current.name}" ainda não tem letra. Escreva na aba Letras.` : 'Nenhuma música tocando agora.'}</p>
          )}
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="O que aparece na tela">
          <div className="grid grid-cols-2 gap-2">
            {TOGGLES.map(({ id, label, icon: Icon }) => {
              const on = state.toggles[id];
              return (
                <button
                  key={id}
                  onClick={() => update((s) => ({ ...s, toggles: { ...s.toggles, [id]: !s.toggles[id] } }))}
                  className={`flex items-center gap-2 px-3 py-3 rounded-lg border text-sm text-left transition-colors ${on ? 'border-logic-border-light bg-logic-bg-elevated text-logic-text' : 'border-logic-border text-logic-text-dim hover:text-logic-text'}`}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  <span className="flex-1 leading-tight">{label}</span>
                  <Switch on={on} />
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Logo">
          <ProducerLogoUpload code={code} logoUrl={logoUrl} />
        </Section>

        <Section
          title="Avisos prontos"
          aside={<button onClick={onManageNotices} className="console-key h-6 px-2 text-[11px]">Gerenciar</button>}
        >
          <QuickNotices state={state} update={update} now={now} onManage={onManageNotices} />
        </Section>

        <Section title="Tempo de Show">
          <p className="text-xs text-logic-text-dim mb-3 leading-relaxed">Antes do show, a tela conta quanto falta para começar. Depois, quanto tempo de show ainda resta.</p>
          {!state.showStartAt && state.toggles.showTime && (
            <p className="flex items-start gap-1.5 text-xs text-logic-lcd-amber mb-3 leading-relaxed">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>O visor está na TV zerado. Preencha o início abaixo ou toque em "Começar a contar agora".</span>
            </p>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
            <label className="text-xs text-logic-text-dim">
              Início
              <input
                type="datetime-local"
                value={startDraft}
                onFocus={() => { startFocus.current = true; }}
                onChange={(e) => setStartDraft(e.target.value)}
                onBlur={commitStart}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') { startSkip.current = true; setStartDraft(toLocalInput(state.showStartAt)); e.currentTarget.blur(); }
                }}
                className="console-well mt-1 w-full px-3 py-2.5 rounded-lg border border-black text-sm text-logic-text outline-none focus:border-logic-accent [color-scheme:dark]"
              />
            </label>
            <label className="text-xs text-logic-text-dim">
              Duração (min)
              <input
                type="number" min={1} max={600} inputMode="numeric" value={durDraft}
                onFocus={() => { durFocus.current = true; }}
                onChange={(e) => setDurDraft(e.target.value)}
                onBlur={commitDur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') { durSkip.current = true; setDurDraft(String(state.showDurationMin)); e.currentTarget.blur(); }
                }}
                className="console-well mt-1 w-full px-3 py-2.5 rounded-lg border border-black text-sm text-logic-text tabular-nums outline-none focus:border-logic-accent"
              />
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => update((s) => ({ ...s, showStartAt: new Date().toISOString() }))} className="flex-1 py-2.5 rounded-lg bg-logic-accent hover:bg-logic-accent-hover text-white text-sm font-medium transition-colors">
              Começar a contar agora
            </button>
            {state.showStartAt && (
              <button onClick={() => update((s) => ({ ...s, showStartAt: null }))} className="px-3 py-2.5 rounded-lg border border-logic-border text-sm text-logic-text-dim hover:text-logic-text transition-colors">
                Limpar
              </button>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
