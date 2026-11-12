import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Play, Pause, Flag, Plus, Trash2, ChevronUp, ChevronDown, ClipboardPaste, Check, Loader2,
  AlertTriangle, Radio, Eye, X, RotateCcw, Undo2, Redo2, Sparkles,
} from 'lucide-react';
import LyricsWaveform, { decodePeaks } from '@/components/prompter/LyricsWaveform';
import StageScreen, { StageLyricsPreview } from '@/components/prompter/StageScreen';
import type { LyricPage, PageKind, PrompterSnapshot } from '@/lib/prompterTypes';
import { LYRIC_COLORS, PAGE_KINDS, PAGE_SIZE_MAX, PAGE_SIZE_MIN, kindInfo } from '@/lib/prompterTypes';
import type { SetlistSong } from '@/lib/musicianTypes';
import { computeLiveView } from '@/lib/liveClock';
import { autoPageIndex, formatClock, newId } from '@/lib/prompterView';
import { addMarker, buildPages, clampMarker, moveMarker, normalizeWords, removeMarker, type RawSegment, type TimedWord } from '@/lib/lyricsAutoSync';

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

export default function SongLyricsEditor({ wordsUrl, song, cloudUrl, autoPlay, pages, setPages, history, status, snap, sync, now, words, onWords, styleControls }: {
  /** Letra lida pelo Mac do diretor (palavras com tempo), quando já chegou. */
  wordsUrl: string | null;
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
  /** Palavras com tempo da última letra automática: deixam a nova marcação cortar na palavra certa. */
  words: TimedWord[];
  onWords: (words: TimedWord[]) => void;
  /** Controles de estilo da letra na TV (cor, tamanho, fonte...), mostrados ao lado do monitor. */
  styleControls?: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gen, setGen] = useState(false);
  const [genMsg, setGenMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmGen, setConfirmGen] = useState(false);
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

  // Marcações na onda: escolher, arrastar, apagar e criar (a lógica fica em lyricsAutoSync).
  const selected = pages.find((p) => p.id === selectedId && p.time !== null) ?? null;
  const selIdx = selected ? pages.indexOf(selected) : -1;
  const clampTime = useCallback((id: string, time: number) => clampMarker(pages, id, time, duration), [pages, duration]);
  const moveTo = useCallback((id: string, time: number) => setPages((ps) => moveMarker(ps, id, time, duration)), [setPages, duration]);
  const deleteMarker = useCallback((id: string) => { setPages((ps) => removeMarker(ps, id)); setSelectedId(null); }, [setPages]);
  const createMarker = useCallback((time: number) => {
    let created: string | null = null;
    setPages((ps) => addMarker(ps, time, words, duration, () => (created = newId())));
    if (created) setSelectedId(created);
  }, [setPages, words, duration]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space' || e.key.toLowerCase() === 'p') { e.preventDefault(); if (!e.repeat) togglePlay(); return; }
      if (!selected || selected.time === null) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteMarker(selected.id); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
        moveTo(selected.id, selected.time + step);
      } else if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, selected, deleteMarker, moveTo]);

  // A letra é lida no Mac do diretor (sem internet e sem custo) e chega junto com o áudio.
  const canGenerate = !!wordsUrl && !gen;

  const generate = async () => {
    if (!wordsUrl) return;
    setConfirmGen(false);
    setGenMsg(null);
    setGen(true);
    try {
      const res = await fetch(wordsUrl);
      if (!res.ok) throw new Error('fetch');
      const body = await res.json() as { segments?: RawSegment[] };
      const heard = normalizeWords(body.segments ?? []);
      const built = buildPages(heard);
      if (built.length === 0) {
        setGenMsg({ ok: false, text: 'O leitor de letra não encontrou voz cantada nesta música.' });
        return;
      }
      setPages(() => built);
      onWords(heard);
      setSelectedId(null);
      setMarkIdx(0);
      setGenMsg({ ok: true, text: `Letra gerada: ${built.length} trechos já marcados na onda. Confira o texto, porque a IA pode errar alguma palavra. Para voltar ao que era antes, use Desfazer.` });
    } catch {
      setGenMsg({ ok: false, text: 'Não foi possível buscar a letra agora. Atualize a lista de músicas e tente de novo.' });
    } finally {
      setGen(false);
    }
  };

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

  // Clicar numa marcação leva a página dela para o topo da lista (debaixo da prévia, no celular).
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const scrollToPage = useCallback((id: string) => {
    const el = rowRefs.current.get(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const selectMarker = useCallback((id: string | null) => {
    setSelectedId(id);
    if (!id) return;
    const i = pages.findIndex((x) => x.id === id);
    if (i >= 0) setMarkIdx(i);
    // espera o React desenhar o destaque antes de rolar
    window.requestAnimationFrame(() => scrollToPage(id));
  }, [pages, scrollToPage]);

  const previewPlaying = playing || (useLive && lv.isPlaying);
  const previewP = { ...snap.prompter, nudge: { songId: null, delta: 0 } };
  const shownPage = activeIdx >= 0 ? pages[activeIdx] : null;

  /*
   * Tela de editor fixa, como num editor de vídeo:
   *   [ páginas (rolam sozinhas) ][ monitor da TV          ]
   *   [                          ][ letra automática/estilo ]
   *   [ linha do tempo: play, onda, marcações (de ponta a ponta) ]
   * Nada disso rola junto com a página. No celular as áreas ficam empilhadas, com o monitor
   * preso no topo.
   */
  return (
    <div className="grid gap-3 min-w-0 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] lg:grid-rows-[auto_minmax(0,1fr)_auto]">
      {/* MONITOR: a TV. Parado mostra o estilo; tocando, a letra em tempo real. */}
      <section className="order-1 lg:order-none lg:col-start-2 lg:row-start-1 sticky top-0 z-20 lg:static lg:z-auto -mx-3 px-3 sm:-mx-4 sm:px-4 lg:mx-0 lg:px-0 pt-1 pb-2 lg:p-0 bg-logic-bg-deep lg:bg-transparent">
        <div className="console-face border-2 border-black rounded-lg p-2 shadow-lg">
          <div className="console-rail -mx-2 -mt-2 mb-2 px-3 h-7 rounded-t flex items-center gap-2 border-b-2 border-black">
            <span className={`console-led ${previewPlaying ? 'is-on-green animate-pulse' : ''}`} />
            <p className="console-legend flex-1 !text-logic-text">{previewPlaying ? 'Na TV agora' : 'Prévia da TV'}</p>
            <button onClick={() => setRehearsal(true)} disabled={pages.length === 0} className="console-key flex items-center gap-1 px-2 h-5 text-[10px] disabled:opacity-40" title="Tela inteira, do jeito que os artistas veem">
              <Eye size={11} /> Ensaiar
            </button>
          </div>
          <div className="flex gap-3 lg:block">
            <div className="w-[48%] max-w-[260px] lg:w-full lg:max-w-none shrink-0 aspect-video rounded overflow-hidden ring-1 ring-black">
              <StageLyricsPreview pages={pages} t={t} playing={previewPlaying} songId={song.id} p={previewP} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-center lg:flex-row lg:items-center gap-1 lg:gap-2 lg:mt-2 text-[11px] min-h-[20px]">
              {shownPage ? (
                <>
                  <span className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-black" style={{ background: kindInfo(shownPage.kind).color }}>{activeIdx + 1}</span>
                    <span className="tabular-nums text-logic-text-dim">{fmtPrecise(shownPage.time)}</span>
                  </span>
                  <span className="flex-1 min-w-0 text-logic-text line-clamp-2 lg:truncate">{shownPage.text.split('\n')[0] || 'trecho vazio'}</span>
                  <button onClick={() => scrollToPage(shownPage.id)} className="self-start lg:self-auto text-logic-text-muted hover:text-logic-text underline-offset-2 hover:underline shrink-0">ver na lista</button>
                </>
              ) : (
                <span className="text-logic-text-muted">{pages.length ? 'Antes do primeiro trecho.' : 'Sem letra ainda.'} Toque Tocar para acompanhar em tempo real.</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* AJUSTES: letra automática e estilo da letra na TV (rola sozinho se faltar espaço). */}
      <section className="order-3 lg:order-none lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto logic-scroll space-y-3">
        <div className="rounded-lg border-2 border-black console-face px-3 py-2.5">
          <button
            onClick={() => (pages.length ? setConfirmGen(true) : void generate())}
            disabled={!canGenerate}
            className="console-key w-full flex items-center justify-center gap-1.5 px-3.5 h-9 text-[12px] disabled:opacity-40"
            title="Escreve a letra que o Mac do diretor ouviu e marca o começo de cada trecho"
          >
            {gen ? <Loader2 size={14} className="animate-spin text-logic-lcd-amber" /> : <Sparkles size={14} className="text-logic-lcd-amber" />} Letra automática
          </button>
          <p className="text-[11px] text-logic-text-dim leading-relaxed mt-2">
            {wordsUrl
              ? 'O Mac do diretor já ouviu a faixa Guia desta música, leu a letra e marcou o início de cada trecho.'
              : 'A letra desta música ainda não chegou. O Mac do diretor ouve a faixa Guia de cada música depois de enviar o repertório, uns 3 minutos por música, com o programa parado. Música sem Guia não tem letra automática.'}
          </p>
          {confirmGen && (
            <div className="mt-2.5 rounded-md border border-logic-lcd-amber/40 bg-logic-lcd-amber/10 px-3 py-2 text-xs animate-[fadeIn_160ms_ease-out]">
              <p className="text-logic-text">
                Esta música já tem {pages.length} {pages.length === 1 ? 'página' : 'páginas'}, com as suas correções. Trocar pela letra que o Mac do diretor ouviu
                apaga essas correções nesta música. Dá para voltar com Desfazer.
              </p>
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setConfirmGen(false)} className="console-key is-lit-amber px-3 h-7 text-[11px]">Manter a minha letra</button>
                <button onClick={() => void generate()} className="console-key px-3 h-7 text-[11px] hover:!text-logic-lcd-red">Trocar mesmo assim</button>
              </div>
            </div>
          )}
          {genMsg && !gen && (
            <p className={`mt-2 text-xs flex items-start gap-1.5 leading-relaxed ${genMsg.ok ? 'text-logic-lcd-green' : 'text-logic-lcd-red'}`}>
              {genMsg.ok ? <Check size={13} className="shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
              <span className="flex-1">{genMsg.text}</span>
              <button onClick={() => setGenMsg(null)} className="text-logic-text-muted hover:text-logic-text" aria-label="Fechar aviso"><X size={12} /></button>
            </p>
          )}
        </div>
        {styleControls && (
          <div className="rounded-lg border border-logic-border bg-logic-bg-panel px-3 py-3">
            <p className="console-legend mb-3">Estilo da letra na TV</p>
            {styleControls}
            <p className="text-[11px] text-logic-text-muted mt-3">Muda na TV na hora. Pause para ver o estilo no monitor.</p>
          </div>
        )}
      </section>

      {/* PÁGINAS: a letra, trecho por trecho (rola sozinha). */}
      <section className="order-4 lg:order-none lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:min-h-0 flex flex-col bg-logic-bg-panel border border-logic-border rounded-xl">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-logic-border shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-logic-text truncate">{song.name}</h2>
            <p className="text-[11px] text-logic-text-dim">{formatClock(song.duration)}{song.bpm ? ` · ${song.bpm} BPM` : ''} · {pages.length} {pages.length === 1 ? 'página' : 'páginas'}</p>
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
          <button onClick={() => setPasteOpen((v) => !v)} className="flex items-center gap-1.5 text-xs text-logic-accent hover:text-logic-accent-hover transition-colors">
            <ClipboardPaste size={14} /> Colar letra inteira
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto logic-scroll p-3">
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
            <p className="text-sm text-logic-text-dim py-6 text-center">Nenhuma página ainda. Use a Letra automática, cole a letra inteira ou adicione página por página.</p>
          )}

          <ol className="space-y-2">
            {pages.map((p, i) => (
              <PageRow
                key={p.id}
                rowRef={(el) => { if (el) rowRefs.current.set(p.id, el); else rowRefs.current.delete(p.id); }}
                selected={p.id === selectedId}
                defaultColor={snap.prompter.lyricColor}
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
      </section>

      {/* LINHA DO TEMPO: play, onda e marcações, de ponta a ponta embaixo. */}
      <section className="order-2 lg:order-none lg:col-span-2 lg:row-start-3 console-face border-2 border-black rounded-xl px-3 py-2.5 shadow-lg">
        <div className="flex flex-wrap items-center gap-2">
          <label className="console-key flex items-center gap-1.5 px-2.5 h-8 text-[11px] cursor-pointer" title={audioName || 'Carregar áudio do computador'}>
            {decoding ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            <span className="hidden sm:inline">{decoding ? 'Carregando...' : audioName ? 'Outro arquivo' : 'Carregar áudio'}</span>
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
          </label>
          <button onClick={() => skip(-5)} disabled={!audioUrl || useLive} className="console-key flex items-center justify-center w-8 h-8 disabled:opacity-40" title="Voltar 5 segundos">
            <RotateCcw size={14} />
          </button>
          <button onClick={togglePlay} disabled={!audioUrl || useLive} className="flex items-center gap-1.5 px-4 h-8 rounded-md bg-logic-accent hover:bg-logic-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors" title="Espaço">
            {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pausar' : 'Tocar'}
          </button>
          <span className="font-stage text-sm tabular-nums text-logic-lcd-amber min-w-[92px] px-2 h-8 flex items-center rounded bg-black/50 border border-black">{formatClock(t)} / {formatClock(duration)}</span>
          <button
            onClick={() => { audioRef.current?.pause(); setPlaying(false); setFollowLive((v) => !v); }}
            className={`console-key flex items-center gap-1.5 px-2.5 h-8 text-[11px] ${followLive ? 'is-lit-amber' : ''}`}
            title="Usa o tempo do play do diretor para marcar"
          >
            <Radio size={13} /> <span className="hidden sm:inline">Seguir o diretor</span>
          </button>
          <span className="flex-1" />
          <button
            onClick={mark}
            disabled={pages.length === 0}
            className="flex items-center gap-1.5 px-4 h-8 rounded-md bg-logic-lcd-amber text-black text-sm font-semibold hover:brightness-110 active:scale-[0.98] disabled:opacity-40 transition-all"
            title="Marca agora o começo da página armada"
          >
            <Flag size={14} /> Marcar página {pages.length ? armedIdx + 1 : ''}
          </button>
          <button
            onClick={() => createMarker(t)}
            disabled={!duration}
            className="console-key flex items-center gap-1.5 px-2.5 h-8 text-[11px] disabled:opacity-40"
            title="Cria uma marcação no ponto em que a música está, dividindo o trecho ali"
          >
            <Plus size={13} /> Nova marcação
          </button>
        </div>
        {followLive && !liveOnSong && <p className="text-xs text-logic-lcd-amber mt-2">Aguardando o diretor tocar esta música.</p>}
        {audioError && <p className="text-xs text-logic-lcd-red mt-2 flex items-center gap-1.5"><AlertTriangle size={13} /> {audioError}</p>}
        {audioUrl && <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} preload="auto" />}

        <div className="mt-2">
          <LyricsWaveform
            peaks={peaks}
            duration={duration}
            t={t}
            pages={pages}
            activeIdx={activeIdx}
            selectedId={selectedId}
            onSelect={selectMarker}
            clampTime={clampTime}
            onSeek={(time) => { if (!useLive) seek(time); }}
            onMoveMarker={moveTo}
            onPlace={(time) => {
              // Ainda há trecho sem tempo: o duplo clique coloca ali o trecho armado (jeito manual).
              // Todos já marcados (letra automática): o duplo clique cria uma marcação nova.
              if (pages.length && pages.some((p) => p.time === null)) {
                const at = Math.round(time * 10) / 10;
                setPages((ps) => ps.map((p, i) => (i === armedIdx ? { ...p, time: at } : p)));
                setMarkIdx(Math.min(pages.length - 1, armedIdx + 1));
              } else {
                createMarker(time);
              }
            }}
          />
        </div>

        <div className="mt-1.5 min-h-[34px] flex flex-wrap items-center gap-2 text-xs">
          {selected && selected.time !== null ? (
            <>
              <span className="font-semibold text-logic-lcd-amber">Marcação {selIdx + 1}</span>
              <span className="tabular-nums text-logic-text-dim">{fmtPrecise(selected.time)}</span>
              <span className="truncate text-logic-text-dim min-w-0 max-w-[32ch]">{selected.text.split('\n')[0] || 'trecho vazio'}</span>
              <span className="flex items-center rounded-md border border-logic-border overflow-hidden ml-auto" title="Mover a marcação (setas do teclado; Shift move 1 s)">
                {[-0.1, 0.1].map((d) => (
                  <button
                    key={d}
                    onClick={() => moveTo(selected.id, (selected.time ?? 0) + d)}
                    className="px-2 py-1 font-mono text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition-colors"
                    aria-label={d < 0 ? 'Mover 0,1 s para a esquerda' : 'Mover 0,1 s para a direita'}
                  >
                    {d < 0 ? '◀ 0,1' : '0,1 ▶'}
                  </button>
                ))}
              </span>
              <button onClick={() => { if (!useLive && selected.time !== null) seek(selected.time); }} className="flex items-center gap-1 px-2 py-1 rounded-md text-logic-text-dim hover:text-logic-text transition-colors">
                <Play size={12} /> Ouvir
              </button>
              <button
                onClick={() => deleteMarker(selected.id)}
                disabled={pages.length < 2}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-logic-text-dim hover:text-logic-lcd-red disabled:opacity-40 transition-colors"
                title={selIdx === 0 ? 'Junta o trecho seguinte a este' : 'O trecho desta marcação passa a fazer parte do anterior'}
              >
                <Trash2 size={12} /> Apagar marcação
              </button>
              <button onClick={() => setSelectedId(null)} className="p-1 text-logic-text-muted hover:text-logic-text" aria-label="Fechar"><X size={12} /></button>
            </>
          ) : (
            <span className="text-logic-text-muted">
              Espaço toca e pausa. Marcar: toque na hora em que o trecho começa. Toque num número da onda para escolher a marcação (arraste, setas ou Delete); duplo clique cria uma nova.
            </span>
          )}
        </div>
      </section>

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

/**
 * Cor e tamanho só desta página. Sem mexer, ela segue o estilo geral (o quadro "Estilo da letra
 * na TV"); a página seguinte não herda nada desta.
 */
function PageStyle({ page, defaultColor, onChange }: { page: LyricPage; defaultColor: string; onChange: (patch: Partial<LyricPage>) => void }) {
  const size = page.size ?? 1;
  const setSize = (v: number) => {
    const next = Math.round(Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, v)) * 10) / 10;
    onChange({ size: next === 1 ? undefined : next });
  };
  const custom = page.color !== undefined || page.size !== undefined;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
      <span className="console-legend !text-[10px]">Cor</span>
      <span className="flex items-center gap-1">
        <button
          onClick={() => onChange({ color: undefined })}
          className={`h-5 px-1.5 rounded text-[10px] border transition-colors ${page.color === undefined ? 'border-logic-lcd-amber text-logic-lcd-amber' : 'border-logic-border text-logic-text-muted hover:text-logic-text'}`}
          title="Usa a cor geral do estilo da letra"
        >
          <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: defaultColor }} />Padrão
        </button>
        {LYRIC_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChange({ color: c })}
            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${page.color === c ? 'border-logic-lcd-amber scale-110' : 'border-black/60'}`}
            style={{ background: c }}
            aria-label={`Cor ${c} só nesta página`}
          />
        ))}
      </span>
      <span className="console-legend !text-[10px] ml-1">Tamanho</span>
      <span className="flex items-center rounded-md border border-logic-border overflow-hidden">
        <button onClick={() => setSize(size - 0.1)} disabled={size <= PAGE_SIZE_MIN} className="px-2 h-6 text-xs text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated disabled:opacity-30" aria-label="Letra menor nesta página">A−</button>
        <span className={`px-1.5 text-[11px] tabular-nums min-w-[52px] text-center ${page.size === undefined ? 'text-logic-text-muted' : 'text-logic-lcd-amber'}`}>
          {page.size === undefined ? 'padrão' : `${Math.round(size * 100)}%`}
        </span>
        <button onClick={() => setSize(size + 0.1)} disabled={size >= PAGE_SIZE_MAX} className="px-2 h-6 text-xs text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated disabled:opacity-30" aria-label="Letra maior nesta página">A+</button>
      </span>
      {custom && (
        <button onClick={() => onChange({ color: undefined, size: undefined })} className="text-[11px] text-logic-text-muted hover:text-logic-text underline-offset-2 hover:underline">
          voltar ao padrão
        </button>
      )}
    </div>
  );
}

function PageRow({ rowRef, selected, defaultColor, page, index, total, active, armed, onArm, onChange, onMarkNow, onSeek, onMove, onDelete }: {
  rowRef: (el: HTMLLIElement | null) => void; selected: boolean; defaultColor: string;
  page: LyricPage; index: number; total: number; active: boolean; armed: boolean;
  onArm: () => void; onChange: (patch: Partial<LyricPage>) => void; onMarkNow: () => void;
  onSeek: () => void; onMove: (d: number) => void; onDelete: () => void;
}) {
  const [timeText, setTimeText] = useState(fmtPrecise(page.time));
  useEffect(() => setTimeText(fmtPrecise(page.time)), [page.time]);
  const kind = kindInfo(page.kind);
  return (
    <li
      ref={rowRef}
      onClick={onArm}
      // no celular o monitor fica preso no topo: a página escolhida para logo abaixo dele
      className={`scroll-mt-[200px] lg:scroll-mt-2 flex gap-3 p-3 rounded-lg border transition-colors ${selected ? 'ring-2 ring-logic-lcd-amber/70' : ''} ${active ? 'border-logic-lcd-green/70 bg-logic-lcd-green/5' : armed ? 'border-logic-lcd-amber/60 bg-logic-lcd-amber/5' : 'border-logic-border bg-logic-bg-deep'}`}
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
          {page.time !== null && (
            <span className="flex items-center rounded-md border border-logic-border overflow-hidden" title="Ajuste fino da entrada">
              {[-0.1, 0.1].map((d) => (
                <button
                  key={d}
                  onClick={(e) => { e.stopPropagation(); onChange({ time: Math.max(0, Math.round(((page.time ?? 0) + d) * 10) / 10) }); }}
                  className="px-1.5 py-1.5 text-2xs font-mono text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition-colors"
                  aria-label={d < 0 ? 'Entrar 0,1 s antes' : 'Entrar 0,1 s depois'}
                >
                  {d < 0 ? '−0,1' : '+0,1'}
                </button>
              ))}
            </span>
          )}
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
          className="w-full px-3 py-2 rounded-md bg-logic-bg-panel border border-logic-border text-base leading-relaxed outline-none focus:border-logic-accent resize-y"
          style={{ color: page.color ?? undefined }}
        />
        <PageStyle page={page} defaultColor={defaultColor} onChange={onChange} />
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
