import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Maximize, Minus, PenLine, Plus } from 'lucide-react';
import type { LiveView, SetlistSong, SheetBackend, SheetInfo, ShowLive } from '@/lib/musicianTypes';
import { bpmAdjustToAlpha } from '@/lib/timeStretch';
import { useNotebook } from './notebook/useNotebook';
import NotebookPage from './notebook/NotebookPage';
import { bpmText, NowNextBlock, SignalBanner } from './LivePanel';

// Modo Palco da Área do Músico: em cima só a música tocando e a próxima; embaixo a cifra /
// partitura da música NO AR, que troca sozinha quando o diretor passa de música. A cifra pode
// rolar sozinha acompanhando a música ou caber inteira na tela.

type Fit = 'scroll' | 'page';
const FIT_LS = 'vs_stage_fit';
const ZOOM_LS = 'vs_stage_zoom';
// depois que o músico rola com o dedo, a rolagem automática espera um pouco antes de voltar
const MANUAL_PAUSE_MS = 6000;

const noop = () => {};

export default function StageView({
  lv, live, currentSong, nextSong, backend, sheets, onSheetsChanged, onEdit, keyOf,
}: {
  lv: LiveView;
  live: ShowLive | null;
  currentSong: SetlistSong | null | undefined;
  nextSong: SetlistSong | null | undefined;
  backend: SheetBackend;
  sheets: SheetInfo[];
  onSheetsChanged: () => Promise<void>;
  /** Abre o caderno desta música para escrever. */
  onEdit: (songId: string) => void;
  /** Tom (cifra curta) de uma música, já com o tuner. */
  keyOf?: (song: SetlistSong | null | undefined) => string;
}) {
  const [fit, setFit] = useState<Fit>(() => (localStorage.getItem(FIT_LS) === 'page' ? 'page' : 'scroll'));
  const [zoom, setZoom] = useState(() => {
    const z = Number(localStorage.getItem(ZOOM_LS));
    return z >= 0.6 && z <= 2.5 ? z : 1;
  });
  const songId = currentSong?.id ?? null;
  const nb = useNotebook({ backend, songId, songName: currentSong?.name ?? '', sheet: sheets.find((s) => s.song_id === songId), onSheetsChanged });
  const doc = nb.doc;
  const isEmpty = doc.lines.length === 0 && doc.strokes.length === 0;

  const boxRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const manualUntil = useRef(0);
  const [scale, setScale] = useState(1);
  const [cols, setCols] = useState(1);

  const isPlaying = lv.isPlaying && !!currentSong;
  const secondsLeft = currentSong ? (currentSong.duration - lv.currentTime) * bpmAdjustToAlpha(currentSong.bpmAdjust ?? 0) : Infinity;
  const finalCountdown = isPlaying && secondsLeft <= 10 ? Math.max(0, Math.ceil(secondsLeft)) : null;
  const progress = Math.max(0, Math.min(1, lv.songProgress));

  const saveFit = (f: Fit) => { setFit(f); try { localStorage.setItem(FIT_LS, f); } catch { /* só conveniência */ } };
  const saveZoom = (z: number) => {
    const v = Math.round(Math.max(0.6, Math.min(2.5, z)) * 10) / 10;
    setZoom(v);
    try { localStorage.setItem(ZOOM_LS, String(v)); } catch { /* só conveniência */ }
  };

  // Página inteira: como num caderno de músicas impresso — em tela larga a cifra se divide em
  // colunas e, se ainda não couber, é reduzida (centralizada). Com desenhos à mão fica numa
  // coluna só, para os traços não saírem do lugar.
  useLayoutEffect(() => {
    if (fit !== 'page') { setScale(1); setCols(1); return; }
    const box = boxRef.current;
    const page = pageRef.current;
    if (!box || !page) return;
    const measure = () => {
      const W = box.clientWidth;
      const H = box.clientHeight;
      const maxCols = doc.strokes.length ? 1 : Math.max(1, Math.min(4, Math.floor(W / 340)));
      let best = { n: 1, s: 0 };
      for (let n = 1; n <= maxCols; n++) {
        page.style.columnCount = String(n);
        page.style.width = `${W}px`;
        const s = Math.min(1, H / Math.max(1, page.scrollHeight), W / Math.max(1, page.scrollWidth));
        if (s > best.s + 0.01) best = { n, s };
      }
      page.style.columnCount = String(best.n);
      setCols(best.n);
      setScale(Number.isFinite(best.s) && best.s > 0 ? best.s : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [fit, doc, zoom]);

  // Rolagem automática: a posição da cifra acompanha o andamento da música, um pouco à frente
  // (para o músico ler o que vem). Suave, e pausa quando o músico rola com o dedo.
  useEffect(() => {
    if (fit !== 'scroll' || !isPlaying) return;
    let raf = 0;
    const tick = () => {
      const box = boxRef.current;
      if (box && Date.now() > manualUntil.current) {
        const max = box.scrollHeight - box.clientHeight;
        if (max > 0) {
          const target = Math.max(0, Math.min(1, (progress - 0.04) / 0.92)) * max;
          const delta = target - box.scrollTop;
          if (Math.abs(delta) > 0.5) box.scrollTop += delta * 0.08;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fit, isPlaying, progress]);

  // música nova: volta ao topo
  useEffect(() => {
    manualUntil.current = 0;
    if (boxRef.current) boxRef.current.scrollTop = 0;
  }, [songId]);

  const onManual = () => { manualUntil.current = Date.now() + MANUAL_PAUSE_MS; };
  const key = keyOf?.(currentSong);
  const nextKey = keyOf?.(nextSong);
  const meta = (song: SetlistSong | null | undefined, k: string | undefined) =>
    [k ? `${k}` : '', bpmText(song) ? `${bpmText(song)}` : ''].filter(Boolean).join('  ·  ');

  const btn = (on: boolean) => `flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs transition-colors ${
    on ? 'bg-logic-accent/15 border-logic-accent/60 text-logic-accent' : 'border-logic-border-light text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light'
  }`;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-logic-bg-deep">
      <div className="px-3 pt-2 pb-2 bg-logic-bg border-b border-logic-border-dark">
        <SignalBanner status={lv.status} isPlaying={lv.isPlaying} paused={!!live?.isPaused} />
        <div className={`mt-2 logic-lcd px-3 py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 ${finalCountdown !== null ? 'shadow-[0_0_0_1px_rgba(255,69,58,0.5),0_0_18px_rgba(255,69,58,0.18)]' : ''}`}>
          <div>
            <NowNextBlock
              label="Tocando"
              badge={finalCountdown !== null ? `Restam ${finalCountdown}s` : undefined}
              name={currentSong && live?.sliceName ? live.sliceName : currentSong?.name}
              medley={currentSong && live?.sliceName ? currentSong.name : undefined}
              active={isPlaying}
              color="#30d158"
              meta={isPlaying ? meta(currentSong, key) : ''}
            />
            <div className="mt-1 h-1 rounded-full bg-black/40 overflow-hidden">
              <div className={`h-full rounded-full transition-[width] duration-200 ${finalCountdown !== null ? 'bg-logic-lcd-red' : 'bg-logic-lcd-green'}`} style={{ width: `${isPlaying ? progress * 100 : 0}%` }} />
            </div>
          </div>
          <NowNextBlock
            label="Próxima"
            name={isPlaying && live?.nextSliceName ? live.nextSliceName : nextSong?.name}
            medley={isPlaying && live?.nextSliceName && currentSong ? currentSong.name : undefined}
            active={!!nextSong || !!live?.nextSliceName}
            color="#ff9f0a"
            meta={nextSong ? meta(nextSong, nextKey) : ''}
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <button className={btn(fit === 'scroll')} onClick={() => saveFit('scroll')} title="A cifra rola sozinha acompanhando a música">
            <ArrowDownWideNarrow size={14} /> Rolar sozinho
          </button>
          <button className={btn(fit === 'page')} onClick={() => saveFit('page')} title="A cifra inteira cabe na tela">
            <Maximize size={14} /> Página inteira
          </button>
          <div className="flex items-center ml-1">
            <button className="w-8 h-8 rounded-l-md border border-logic-border-light text-logic-text-dim hover:text-logic-text flex items-center justify-center" onClick={() => saveZoom(zoom - 0.1)} aria-label="Letra menor"><Minus size={13} /></button>
            <span className="h-8 px-2 border-y border-logic-border-light text-2xs font-mono text-logic-text-dim flex items-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button className="w-8 h-8 rounded-r-md border border-logic-border-light text-logic-text-dim hover:text-logic-text flex items-center justify-center" onClick={() => saveZoom(zoom + 0.1)} aria-label="Letra maior"><Plus size={13} /></button>
          </div>
          {songId && (
            <button className={`${btn(false)} ml-auto`} onClick={() => onEdit(songId)} title="Abrir o caderno desta música para escrever">
              <PenLine size={13} /> Editar cifra
            </button>
          )}
        </div>
      </div>

      <div
        ref={boxRef}
        className={`flex-1 min-h-0 ${fit === 'page' ? 'overflow-hidden' : 'overflow-y-auto logic-scroll'}`}
        onWheel={onManual}
        onTouchStart={onManual}
        onPointerDown={onManual}
      >
        {!songId ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <p className="text-sm text-logic-text-dim">Aguardando o diretor dar o play</p>
            <p className="text-xs text-logic-text-muted mt-1">A cifra da música no ar aparece aqui sozinha.</p>
          </div>
        ) : isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <PenLine size={28} className="text-logic-text-muted mb-2" />
            <p className="text-sm text-logic-text-dim">Sem cifra para {currentSong?.name}</p>
            <button onClick={() => onEdit(songId)} className="mt-3 h-9 px-3 rounded-lg bg-logic-accent text-white text-xs font-semibold hover:brightness-110">Escrever a cifra</button>
          </div>
        ) : (
          <div
            ref={pageRef}
            key={songId}
            className="animate-[fadeIn_220ms_ease-out]"
            style={fit === 'page'
              ? { transform: `scale(${scale})`, transformOrigin: 'top center', columnCount: cols, columnGap: 28, columnRule: cols > 1 ? '1px solid rgba(255,255,255,0.06)' : undefined, marginLeft: 'auto', marginRight: 'auto' }
              : undefined}
          >
            <div style={{ zoom }}>
              <NotebookPage
                doc={doc}
                update={noop as never}
                tool={null}
                inkColor="#fff"
                inkWidth={4}
                markerColor="#ff0"
                selectedId={null}
                onSelect={noop}
                editingId={null}
                onEditing={noop}
                activeChord={null}
                selectedNote={null}
                onSelectNote={noop}
                brush={{ dur: 'q', rest: false, dot: false, acc: null }}
                onAdd={noop}
                readOnly
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
