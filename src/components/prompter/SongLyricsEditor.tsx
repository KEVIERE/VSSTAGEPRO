import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Play, Pause, Flag, Plus, Trash2, ChevronUp, ChevronDown, ClipboardPaste, Check, Loader2,
  AlertTriangle, Radio, Eye, X, RotateCcw, Undo2, Redo2,
} from 'lucide-react';
import LyricsWaveform, { decodePeaks } from '@/components/prompter/LyricsWaveform';
import StageScreen from '@/components/prompter/StageScreen';
import type { LyricPage, PageKind, PrompterSnapshot } from '@/lib/prompterTypes';
import { PAGE_KINDS, kindInfo } from '@/lib/prompterTypes';
import type { SetlistSong } from '@/lib/musicianTypes';
import { computeLiveView } from '@/lib/liveClock';
import { autoPageIndex, formatClock, newId } from '@/lib/prompterView';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export interface LyricsHistory { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void }

const MAX_PAGES = 400;
const MAX_PAGE_TEXT = 600;

function parseTime(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const parts = s.split(':').map((x) => Number(x.replace(',', '.')));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 1 ? parts[0] : null;
}

function fmtPrecise(t: number | null): string {
  if (t === null) return '';
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function splitLyrics(raw: string): LyricPage[] {
  return raw.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
    .map((text) => ({ id: newId(), time: null, text: text.slice(0, MAX_PAGE_TEXT), kind: 'verso' as PageKind }));
}

export default function SongLyricsEditor({ song, cloudUrl, autoPlay, pages, setPages, history, status, snap, sync, now }: {
  song: SetlistSong;
  cloudUrl: string | null;
  autoPlay: boolean;
  pages: LyricPage[];
  setPages: (fn: (p: LyricPage[]) => LyricPage[]) => void;
  history: LyricsHistory;
  status: SaveStatus;
  snap: PrompterSnapshot;
  sync: { lagMs: number; receivedAt: number };
  now: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState('');
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [audioDur, setAudioDur] = useState(0);
  const [decoding, setDecoding] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [localT, setLocalT] = useState(0);
  const [followLive, setFollowLive] = useState(false);
  const [markIdx, setMarkIdx] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [rehearsal, setRehearsal] = useState(false);

  const live = snap.show.live;
  const liveOnSong = live?.currentSongId === song.id;
  const lv = computeLiveView(live, song.duration, sync.lagMs, sync.receivedAt, now);
  const useLive = followLive && liveOnSong;
  const t = useLive ? lv.currentTime : localT;
  const duration = audioDur || song.duration || 0;
  const activeIdx = autoPageIndex(pages, t);
  const armedIdx = pages.length ? Math.min(markIdx, pages.length - 1) : 0;

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audioRef.current) setLocalT(audioRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const loadFile = async (file: File) => {
    setAudioError(null);
    setDecoding(true);
    setPlaying(false);
    audioRef.current?.pause();
    setAudioUrl(URL.createObjectURL(file));
    setAudioName(file.name);
    setLocalT(0);
    setFollowLive(false);
    try {
      const { peaks: pk, duration: d } = await decodePeaks(file);
      setPeaks(pk);
      setAudioDur(d);
    } catch {
      setPeaks(null);
      setAudioError('Não foi possível ler este arquivo de áudio. Use WAV, MP3, AAC ou M4A.');
    } finally {
      setDecoding(false);
    }
  };

  useEffect(() => {
    if (!cloudUrl) return;
    let cancelled = false;
    setDecoding(true);
    setAudioError(null);
    (async () => {
      try {
        const res = await fetch(cloudUrl);
        if (!res.ok) throw new Error('fetch');
        const blob = await res.blob();
        if (cancelled) return;
        await loadFile(new File([blob], `${song.name} (do show)`, { type: blob.type || 'audio/mpeg' }));
      } catch {
        if (!cancelled) {
          setDecoding(false);
          setAudioError('Não foi possível baixar o áudio do show. Atualize a lista de músicas ou carregue um arquivo.');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudUrl]);

  const autoPlayPending = useRef(autoPlay);
  useEffect(() => { if (autoPlay) autoPlayPending.current = true; }, [autoPlay]);
  useEffect(() => {
    const a = audioRef.current;
    if (!autoPlayPending.current || !a || !audioUrl || decoding) return;
    autoPlayPending.current = false;
    a.play().then(() => setPlaying(true)).catch(() => setAudioError('O navegador bloqueou o áudio. Toque em Tocar.'));
  }, [audioUrl, decoding, autoPlay]);

  const skip = (d: number) => seek(Math.max(0, Math.min(duration, localT + d)));

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => setAudioError('O navegador bloqueou o áudio. Toque em Tocar de novo.'));
    else { a.pause(); setPlaying(false); }
  }, [audioUrl]);

  const seek = (time: number) => {
    setLocalT(time);
    if (audioRef.current) audioRef.current.currentTime = time;
    if (pages.length) setMarkIdx(Math.min(pages.length - 1, Math.max(0, autoPageIndex(pages, time) + 1)));
  };

  const mark = useCallback(() => {
    if (pages.length === 0) return;
    const time = Math.round(t * 10) / 10;
    setPages((ps) => ps.map((p, i) => (i === armedIdx ? { ...p, time } : p)));
    setMarkIdx(Math.min(pages.length - 1, armedIdx + 1));
  }, [pages.length, armedIdx, t, setPages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space' || e.key.toLowerCase() === 'p') { e.preventDefault(); if (!e.repeat) togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  const update = (id: string, patch: Partial<LyricPage>) => setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const move = (i: number, d: number) => setPages((ps) => {
    const j = i + d;
    if (j < 0 || j >= ps.length) return ps;
    const copy = [...ps];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  const rehearsalSnap: PrompterSnapshot = {
    ...snap,
    prompter: {
      ...snap.prompter, blackout: false, notice: null, scheduled: [],
      toggles: { ...snap.prompter.toggles, lyrics: true }, nudge: { songId: null, delta: 0 },
    },
    lyrics: [{ song_id: song.id, pages, updated_at: '' }],
    show: {
      ...snap.show,
      live: {
        isPlaying: playing || (useLive && lv.isPlaying), isPaused: false, currentTime: t, songProgress: duration ? t / duration : 0,
        nextSongCountdown: 0, currentSongId: song.id, nextSongId: null, bpm: song.bpm ?? null, playFlow: 'manual', onAir: true, publishedAt: now,
      },
    },
  };

  const pasteCount = splitLyrics(pasteText).length;

  return (
    <div className="space-y-4 min-w-0">
      <div className="bg-logic-bg-panel border border-logic-border rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-logic-text truncate">{song.name}</h2>
            <p className="text-xs text-logic-text-dim mt-0.5">{formatClock(song.duration)}{song.bpm ? ` · ${song.bpm} BPM` : ''}</p>
          </div>
          <SaveBadge status={status} />
          <div className="flex items-center rounded-lg bg-logic-bg-elevated">
            <button onClick={history.undo} disabled={!history.canUndo} className="p-2 rounded-l-lg hover:bg-logic-border-light disabled:opacity-30 transition-colors" title="Desfazer (Ctrl/Cmd+Z)" aria-label="Desfazer">
              <Undo2 size={15} />
            </button>
            <button onClick={history.redo} disabled={!history.canRedo} className="p-2 rounded-r-lg hover:bg-logic-border-light disabled:opacity-30 transition-colors" title="Refazer (Ctrl/Cmd+Shift+Z)" aria-label="Refazer">
              <Redo2 size={15} />
            </button>
          </div>
          <button onClick={() => setRehearsal(true)} disabled={pages.length === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-logic-bg-elevated hover:bg-logic-border-light text-sm disabled:opacity-40 transition-colors">
            <Eye size={15} /> Ensaiar
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-logic-bg-elevated hover:bg-logic-border-light text-sm cursor-pointer transition-colors">
            {decoding ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {decoding ? 'Carregando áudio...' : audioName ? 'Usar outro arquivo' : 'Carregar áudio do computador'}
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
          </label>
          <button onClick={() => skip(-5)} disabled={!audioUrl || useLive} className="p-2 rounded-lg bg-logic-bg-elevated hover:bg-logic-border-light text-sm disabled:opacity-40 transition-colors" title="Voltar 5 segundos">
            <RotateCcw size={15} />
          </button>
          <button onClick={togglePlay} disabled={!audioUrl || useLive} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-logic-accent hover:bg-logic-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors" title="Espaço">
            {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? 'Pausar' : 'Tocar'}
          </button>
          <span className="text-sm font-medium tabular-nums text-logic-text-dim min-w-[92px]">{formatClock(t)} / {formatClock(duration)}</span>
          <button
            onClick={() => { audioRef.current?.pause(); setPlaying(false); setFollowLive((v) => !v); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${followLive ? 'border-logic-lcd-green text-logic-lcd-green bg-logic-lcd-green/10' : 'border-logic-border text-logic-text-dim hover:text-logic-text'}`}
            title="Usa o tempo do play do diretor para marcar"
          >
            <Radio size={15} /> Seguir o play do diretor
          </button>
          {audioName && <span className="text-xs text-logic-text-muted truncate max-w-[200px]">{audioName}</span>}
        </div>
        {followLive && !liveOnSong && <p className="text-xs text-logic-lcd-amber mt-2">Aguardando o diretor tocar esta música.</p>}
        {audioError && <p className="text-xs text-logic-lcd-red mt-2 flex items-center gap-1.5"><AlertTriangle size={13} /> {audioError}</p>}
        {audioUrl && <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} preload="auto" />}

        <div className="mt-4">
          <LyricsWaveform
            peaks={peaks}
            duration={duration}
            t={t}
            pages={pages}
            activeIdx={activeIdx}
            onSeek={(time) => { if (!useLive) seek(time); }}
            onMoveMarker={(id, time) => update(id, { time })}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={mark}
            disabled={pages.length === 0}
            className="flex items-center gap-2 px-5 py-3 rounded-lg bg-logic-lcd-amber text-black font-semibold hover:brightness-110 active:scale-[0.98] disabled:opacity-40 transition-all"
          >
            <Flag size={16} /> Marcar página {pages.length ? armedIdx + 1 : ''}
          </button>
          <p className="text-xs text-logic-text-dim leading-relaxed flex-1 min-w-[200px]">
            Aperte <kbd className="px-1.5 py-0.5 rounded bg-logic-bg-elevated text-logic-text">Espaço</kbd> para tocar ou pausar, e toque em Marcar na hora em que cada trecho começa. Arraste os números na onda para ajustar.
          </p>
        </div>
      </div>

      <div className="bg-logic-bg-panel border border-logic-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold tracking-wider uppercase text-logic-text-dim">Páginas da letra</h3>
          <button onClick={() => setPasteOpen((v) => !v)} className="flex items-center gap-1.5 text-xs text-logic-accent hover:text-logic-accent-hover transition-colors">
            <ClipboardPaste size={14} /> Colar letra inteira
          </button>
        </div>

        {pasteOpen && (
          <div className="mb-4 p-3 rounded-lg border border-logic-border-light bg-logic-bg-deep animate-[fadeIn_160ms_ease-out]">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder={'Cole a letra aqui.\nDeixe uma linha em branco entre cada trecho: cada trecho vira uma página.'}
              className="w-full bg-transparent text-sm text-logic-text outline-none resize-y leading-relaxed"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => { setPasteOpen(false); setPasteText(''); }} className="px-3 py-2 text-sm text-logic-text-dim hover:text-logic-text">Cancelar</button>
              <button
                disabled={pasteCount === 0}
                onClick={() => { const add = splitLyrics(pasteText); setPages((ps) => [...ps, ...add].slice(0, MAX_PAGES)); setPasteText(''); setPasteOpen(false); }}
                className="px-4 py-2 rounded-lg bg-logic-accent text-white text-sm font-medium hover:bg-logic-accent-hover disabled:opacity-40"
              >
                Criar {pasteCount || ''} páginas
              </button>
            </div>
          </div>
        )}

        {pages.length === 0 && !pasteOpen && (
          <p className="text-sm text-logic-text-dim py-6 text-center">Nenhuma página ainda. Cole a letra inteira ou adicione página por página.</p>
        )}

        <ol className="space-y-2">
          {pages.map((p, i) => (
            <PageRow
              key={p.id}
              page={p}
              index={i}
              total={pages.length}
              active={i === activeIdx}
              armed={i === armedIdx}
              onArm={() => setMarkIdx(i)}
              onChange={(patch) => update(p.id, patch)}
              onMarkNow={() => update(p.id, { time: Math.round(t * 10) / 10 })}
              onSeek={() => { if (p.time !== null && !useLive) seek(p.time); }}
              onMove={(d) => move(i, d)}
              onDelete={() => setPages((ps) => ps.filter((x) => x.id !== p.id))}
            />
          ))}
        </ol>

        <button
          onClick={() => setPages((ps) => [...ps, { id: newId(), time: null, text: '', kind: 'verso' as PageKind }].slice(0, MAX_PAGES))}
          className="mt-3 w-full flex items-center justify-center gap-1.5 py-3 rounded-lg border border-dashed border-logic-border-light text-sm text-logic-text-dim hover:text-logic-text hover:border-logic-accent transition-colors"
        >
          <Plus size={15} /> Adicionar página
        </button>
      </div>

      {rehearsal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_160ms_ease-out]" onMouseDown={(e) => { if (e.target === e.currentTarget) setRehearsal(false); }}>
          <div className="w-full max-w-5xl">
            <div className="flex items-center justify-between mb-3 gap-3">
              <p className="text-sm text-white/80">Ensaio: assim os artistas vão ver. Espaço toca e pausa.</p>
              <div className="flex gap-2">
                <button onClick={togglePlay} disabled={!audioUrl || useLive} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-logic-accent text-white text-sm disabled:opacity-40">
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button onClick={() => setRehearsal(false)} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20"><X size={16} /></button>
              </div>
            </div>
            <div className="aspect-video rounded-xl overflow-hidden ring-1 ring-white/10">
              <StageScreen snap={rehearsalSnap} sync={{ lagMs: 0, receivedAt: now }} now={now} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PageRow({ page, index, total, active, armed, onArm, onChange, onMarkNow, onSeek, onMove, onDelete }: {
  page: LyricPage; index: number; total: number; active: boolean; armed: boolean;
  onArm: () => void; onChange: (patch: Partial<LyricPage>) => void; onMarkNow: () => void;
  onSeek: () => void; onMove: (d: number) => void; onDelete: () => void;
}) {
  const [timeText, setTimeText] = useState(fmtPrecise(page.time));
  useEffect(() => setTimeText(fmtPrecise(page.time)), [page.time]);
  const kind = kindInfo(page.kind);
  return (
    <li
      onClick={onArm}
      className={`flex gap-3 p-3 rounded-lg border transition-colors ${active ? 'border-logic-lcd-green/70 bg-logic-lcd-green/5' : armed ? 'border-logic-lcd-amber/60 bg-logic-lcd-amber/5' : 'border-logic-border bg-logic-bg-deep'}`}
      style={{ borderLeft: `4px solid ${kind.color}` }}
    >
      <div className="flex flex-col items-center gap-1 w-8 flex-shrink-0">
        <span className="text-sm font-bold tabular-nums text-logic-text">{index + 1}</span>
        <button disabled={index === 0} onClick={(e) => { e.stopPropagation(); onMove(-1); }} className="p-0.5 text-logic-text-muted hover:text-logic-text disabled:opacity-20" title="Subir"><ChevronUp size={15} /></button>
        <button disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); onMove(1); }} className="p-0.5 text-logic-text-muted hover:text-logic-text disabled:opacity-20" title="Descer"><ChevronDown size={15} /></button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select
            value={page.kind}
            onChange={(e) => onChange({ kind: e.target.value as PageKind })}
            className="px-2 py-1.5 rounded-md bg-logic-bg-panel border border-logic-border text-xs font-semibold outline-none focus:border-logic-accent"
            style={{ color: kind.color }}
          >
            {PAGE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <input
            value={timeText}
            onChange={(e) => setTimeText(e.target.value)}
            onBlur={() => { const v = parseTime(timeText); onChange({ time: v }); setTimeText(fmtPrecise(v)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="sem tempo"
            className="w-24 px-2 py-1.5 rounded-md bg-logic-bg-panel border border-logic-border text-xs tabular-nums text-logic-text outline-none focus:border-logic-accent placeholder:text-logic-lcd-amber/70"
            title="Tempo de entrada (min:seg)"
          />
          <button onClick={(e) => { e.stopPropagation(); onMarkNow(); }} className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-logic-bg-elevated hover:bg-logic-border-light text-xs transition-colors" title="Usar o tempo atual">
            <Flag size={12} /> Marcar aqui
          </button>
          {page.time !== null && (
            <button onClick={(e) => { e.stopPropagation(); onSeek(); }} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-logic-text-dim hover:text-logic-text transition-colors" title="Ir para este tempo">
              <Play size={12} /> Ouvir
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="ml-auto p-1.5 text-logic-text-muted hover:text-logic-lcd-red transition-colors" title="Apagar página">
            <Trash2 size={14} />
          </button>
        </div>
        <textarea
          value={page.text}
          onChange={(e) => onChange({ text: e.target.value.slice(0, MAX_PAGE_TEXT) })}
          rows={Math.min(6, Math.max(2, page.text.split('\n').length))}
          placeholder="Texto deste trecho"
          className="w-full px-3 py-2 rounded-md bg-logic-bg-panel border border-logic-border text-base text-logic-text leading-relaxed outline-none focus:border-logic-accent resize-y"
        />
      </div>
    </li>
  );
}

function SaveBadge({ status }: { status: SaveStatus }) {
  if (status === 'saving') return <span className="flex items-center gap-1.5 text-xs text-logic-text-dim"><Loader2 size={13} className="animate-spin" /> Salvando</span>;
  if (status === 'saved') return <span className="flex items-center gap-1.5 text-xs text-logic-lcd-green"><Check size={13} /> Salvo</span>;
  if (status === 'error') return <span className="flex items-center gap-1.5 text-xs text-logic-lcd-red"><AlertTriangle size={13} /> Não salvou. Edite de novo para tentar.</span>;
  return null;
}
