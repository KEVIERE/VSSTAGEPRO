import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, ImagePlus, Loader2, Maximize, Minus, MoveHorizontal, PenLine, Plus, Rabbit, Share2, Turtle } from 'lucide-react';
import type { LiveView, SetlistSong, SheetBackend, SheetInfo, ShowLive } from '@/lib/musicianTypes';
import { currentPart, liveSheetKey } from '@/lib/medleySheets';
import { docIsImageOnly, type NotebookLine } from '@/lib/notebook';
import {
  SCROLL_SPEEDS, directorJumped, easeToward, offsetFor, parseScrollSpeed, respeedOffset, scrollSpeedLabel, scrollTarget, stepScrollSpeed,
} from '@/lib/autoScroll';
import { useNotebook } from './notebook/useNotebook';
import { useImageImport } from './notebook/useImageImport';
import NotebookPage from './notebook/NotebookPage';
import SharePane from './notebook/SharePane';
import SaveButton from './notebook/SaveButton';
import { NowNextDisplays, SignalBanner } from './LivePanel';

// Modo Show da Área do Músico: em cima os dois displays do programa (Tocando e Próxima); embaixo,
// ocupando o resto da tela, a cifra / partitura / foto da partitura da música NO AR, que troca
// sozinha quando o diretor passa de música. Texto pode rolar sozinho ou caber inteiro na tela;
// fotos enchem a tela (ou a largura, rolando sozinhas).

type Fit = 'scroll' | 'page';
type ImgFit = 'fill' | 'width';
const FIT_LS = 'vs_stage_fit';
const IMG_FIT_LS = 'vs_stage_img_fit';
const ZOOM_LS = 'vs_stage_zoom';
const SPEED_LS = 'vs_stage_scroll_speed';
// enquanto o dedo mexe (e o embalo da rolagem termina) a rolagem automática espera; depois
// continua de onde o músico deixou
const MANUAL_PAUSE_MS = 2000;

type ImageLine = Extract<NotebookLine, { kind: 'image' }>;

const noop = () => {};

function readLs<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
  } catch { return fallback; }
}

function writeLs(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* só conveniência */ }
}

/** Fotos da partitura ocupando a tela toda abaixo dos displays; várias páginas lado a lado. */
function ImageFill({ lines, boxRef, onManual }: {
  lines: ImageLine[];
  boxRef: React.RefObject<HTMLDivElement>;
  onManual: () => void;
}) {
  return (
    <div
      ref={boxRef}
      className="h-full overflow-x-auto overflow-y-hidden logic-scroll"
      onWheel={onManual}
      onTouchStart={onManual}
      onPointerDown={onManual}
    >
      <div className="h-full w-max min-w-full flex justify-center gap-3 p-2">
        {lines.map((l) => (
          <img
            key={l.id}
            src={l.src}
            alt="Partitura ou cifra"
            draggable={false}
            className="h-full w-auto object-contain rounded-sm select-none shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
            style={{ maxWidth: 'calc(100vw - 16px)', aspectRatio: `${l.w} / ${l.h}` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function StageView({
  lv, live, currentSong, nextSong, backend, sheets, onSheetsChanged, onEdit,
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
}) {
  const [fit, setFit] = useState<Fit>(() => readLs(FIT_LS, ['scroll', 'page'] as const, 'scroll'));
  const [imgFit, setImgFit] = useState<ImgFit>(() => readLs(IMG_FIT_LS, ['fill', 'width'] as const, 'fill'));
  const [zoom, setZoom] = useState(() => {
    const z = Number((() => { try { return localStorage.getItem(ZOOM_LS); } catch { return null; } })());
    return z >= 0.6 && z <= 2.5 ? z : 1;
  });
  const [speed, setSpeed] = useState(() => parseScrollSpeed((() => { try { return localStorage.getItem(SPEED_LS); } catch { return null; } })()));
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string; warn?: boolean } | null>(null);

  // Num medley, a cifra mostrada é a da parte tocando (ou a da música inteira, se só ela existir).
  const part = currentPart(currentSong, live, lv.currentTime);
  const songId = currentSong ? liveSheetKey(currentSong, live, lv.currentTime, sheets) : null;
  const onPart = !!part && songId !== currentSong?.id;
  const sheetName = onPart ? part!.name : currentSong?.name ?? '';
  const nb = useNotebook({ backend, songId, songName: sheetName, sheet: sheets.find((s) => s.song_id === songId), onSheetsChanged });
  const doc = nb.doc;
  const isEmpty = doc.lines.length === 0 && doc.strokes.length === 0;
  const imageOnly = docIsImageOnly(doc);
  const images = useImageImport({ doc, update: nb.update, onResult: setToast });

  const boxRef = useRef<HTMLDivElement>(null);
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // rolagem automática: posição atual (com fração de pixel), ajuste do músico e o que foi escrito
  const roll = useRef({ cur: 0, offset: 0, written: -1, speed: 1, manualUntil: 0, last: 0, lastProgress: null as number | null });
  const [scale, setScale] = useState(1);
  const [cols, setCols] = useState(1);

  const isPlaying = lv.isPlaying && !!currentSong;
  const progress = Math.max(0, Math.min(1, lv.songProgress));
  // a rolagem da cifra de uma parte acompanha só o trecho dessa parte
  const scrollProgress = onPart
    ? Math.max(0, Math.min(1, (lv.currentTime - part!.start) / Math.max(1, part!.end - part!.start)))
    : progress;
  const fillImages = imageOnly && imgFit === 'fill';
  const pageFit = !imageOnly && fit === 'page';

  const saveFit = (f: Fit) => { setFit(f); writeLs(FIT_LS, f); };
  const saveImgFit = (f: ImgFit) => { setImgFit(f); writeLs(IMG_FIT_LS, f); };
  const saveZoom = (z: number) => {
    const v = Math.round(Math.max(0.6, Math.min(2.5, z)) * 10) / 10;
    setZoom(v);
    writeLs(ZOOM_LS, String(v));
  };
  const saveSpeed = (s: number) => { setSpeed(s); writeLs(SPEED_LS, String(s)); };
  const scrolls = imageOnly || fit === 'scroll';

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // música nova: fecha o envio e volta ao começo
  useEffect(() => {
    setSharing(false);
    roll.current = { ...roll.current, cur: 0, offset: 0, written: -1, manualUntil: 0, lastProgress: null };
    if (boxRef.current) boxRef.current.scrollTop = 0;
    if (imgBoxRef.current) imgBoxRef.current.scrollLeft = 0;
  }, [songId]);

  // Página inteira: como num caderno de músicas impresso — em tela larga a cifra se divide em
  // colunas e, se ainda não couber, é reduzida (centralizada). Com desenhos à mão fica numa
  // coluna só, para os traços não saírem do lugar.
  useLayoutEffect(() => {
    if (!pageFit) { setScale(1); setCols(1); return; }
    const box = boxRef.current;
    const page = pageRef.current;
    if (!box || !page) return;
    const measure = () => {
      const W = box.clientWidth;
      const H = box.clientHeight;
      const hasImages = doc.lines.some((l) => l.kind === 'image');
      const maxCols = doc.strokes.length || hasImages ? 1 : Math.max(1, Math.min(4, Math.floor(W / 340)));
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
  }, [pageFit, doc, zoom]);

  // Rolagem automática: a cifra (ou as páginas de foto, de lado) acompanha o andamento da
  // música na velocidade escolhida, com a linha tocando a um terço da tela. Se o músico rola
  // com o dedo, ela espera o dedo sair e continua dali (não volta para onde estava).
  // O relógio do diretor chega 4 vezes por segundo; a posição anda suave entre um e outro.
  const rollInput = useRef({ progress: scrollProgress, speed, playing: isPlaying });
  rollInput.current = { progress: scrollProgress, speed, playing: isPlaying };
  useEffect(() => {
    if (pageFit) return;
    const s = roll.current;
    s.written = -1;
    s.last = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = s.last ? now - s.last : 0;
      s.last = now;
      const el = fillImages ? imgBoxRef.current : boxRef.current;
      if (!el) return;
      const across = fillImages;
      const pos = across ? el.scrollLeft : el.scrollTop;
      const content = across ? el.scrollWidth : el.scrollHeight;
      const view = across ? el.clientWidth : el.clientHeight;
      const { progress, speed: sp, playing } = rollInput.current;
      if (s.written < 0) {
        // música nova ou modo trocado: vai suave para o ponto certo da música
        s.cur = pos;
        s.offset = 0;
        s.speed = sp;
        s.written = pos;
      } else if (Math.abs(pos - s.written) > 2) {
        // o músico rolou com o dedo: a rolagem segue de onde ele deixou
        s.cur = pos;
        s.offset = offsetFor(pos, progress, content, view, sp);
        s.written = pos;
      }
      // o diretor pulou para outro ponto (recomeçou, repetiu um trecho): segue a música de novo
      if (directorJumped(s.lastProgress, progress)) s.offset = 0;
      s.lastProgress = progress;
      // velocidade trocada: continua do ponto atual, sem pular
      if (sp !== s.speed) {
        s.offset = respeedOffset(s.offset, progress, content, s.speed, sp);
        s.speed = sp;
      }
      if (!playing || now < s.manualUntil) return;
      s.cur = easeToward(s.cur, scrollTarget(progress, content, view, sp, s.offset), dt);
      const next = Math.round(s.cur);
      if (next !== pos) {
        if (across) el.scrollLeft = next; else el.scrollTop = next;
      }
      s.written = across ? el.scrollLeft : el.scrollTop;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pageFit, fillImages]);

  const onManual = () => { roll.current.manualUntil = performance.now() + MANUAL_PAUSE_MS; };
  const key = (on: boolean) => `console-key flex items-center gap-1.5 h-8 px-2.5 text-[12px] ${on ? 'is-lit-blue' : ''}`;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden bg-logic-bg-deep">
      <div className="console-face px-3 pt-2 pb-2 border-b border-black">
        <SignalBanner status={lv.status} isPlaying={lv.isPlaying} paused={!!live?.isPaused} />
        <div className="mt-2">
          <NowNextDisplays lv={lv} live={live} currentSong={currentSong} nextSong={nextSong} big />
        </div>
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {imageOnly ? (
            <>
              <button className={key(imgFit === 'fill')} onClick={() => saveImgFit('fill')} title="A foto inteira cabe na tela, abaixo dos displays">
                <Maximize size={14} /> Tela inteira
              </button>
              <button className={key(imgFit === 'width')} onClick={() => saveImgFit('width')} title="A foto ocupa a largura toda e rola sozinha acompanhando a música">
                <MoveHorizontal size={14} /> Largura toda
              </button>
            </>
          ) : (
            <>
              <button className={key(fit === 'scroll')} onClick={() => saveFit('scroll')} title="A cifra rola sozinha acompanhando a música">
                <ArrowDownWideNarrow size={14} /> Rolar sozinho
              </button>
              <button className={key(fit === 'page')} onClick={() => saveFit('page')} title="A cifra inteira cabe na tela">
                <Maximize size={14} /> Página inteira
              </button>
              <div className="flex items-center gap-1 ml-1">
                <button className="console-key w-8 h-8 flex items-center justify-center" onClick={() => saveZoom(zoom - 0.1)} aria-label="Letra menor"><Minus size={13} /></button>
                <span className="console-display h-8 px-2 font-stage font-semibold text-[12px] text-logic-lcd-amber flex items-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <button className="console-key w-8 h-8 flex items-center justify-center" onClick={() => saveZoom(zoom + 0.1)} aria-label="Letra maior"><Plus size={13} /></button>
              </div>
            </>
          )}
          {scrolls && (
            <div
              className="flex items-center gap-1 ml-1"
              title={`Velocidade da rolagem. 1x: a cifra inteira passa ao longo da música. Ela rola enquanto o diretor está tocando.${isPlaying ? '' : ' Agora está parada: começa com o play do diretor.'}`}
            >
              <span className="console-legend hidden sm:inline">Velocidade</span>
              <button
                className="console-key w-8 h-8 flex items-center justify-center"
                onClick={() => saveSpeed(stepScrollSpeed(speed, -1))}
                disabled={speed <= SCROLL_SPEEDS[0]}
                aria-label="Rolar mais devagar"
              ><Turtle size={14} /></button>
              <span className="console-display h-8 min-w-[48px] px-2 justify-center font-stage font-semibold text-[12px] text-logic-lcd-amber flex items-center tabular-nums" aria-live="polite">
                {scrollSpeedLabel(speed)}
              </span>
              <button
                className="console-key w-8 h-8 flex items-center justify-center"
                onClick={() => saveSpeed(stepScrollSpeed(speed, 1))}
                disabled={speed >= SCROLL_SPEEDS[SCROLL_SPEEDS.length - 1]}
                aria-label="Rolar mais rápido"
              ><Rabbit size={14} /></button>
              <span className={`console-led ml-0.5 ${isPlaying ? 'is-on-green' : ''}`} aria-hidden />
              {!isPlaying && <span className="console-legend hidden md:inline">Rola com o play</span>}
            </div>
          )}
          {songId && (
            <div className="flex items-center gap-1.5 ml-auto">
              <SaveButton
                saveNow={nb.saveNow}
                status={nb.status}
                backend={backend}
                onResult={(o) => setToast({ ok: o.tone === 'ok', warn: o.tone === 'warn', text: o.text })}
              />
              <button className={key(false)} onClick={images.open} disabled={images.adding} title="Importar a foto da sua partitura ou cifra para esta música">
                {images.adding ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                <span className="hidden sm:inline">Importar imagem</span>
              </button>
              <button
                className={key(false)}
                disabled={!nb.sheetId}
                onClick={async () => { await nb.flush(); setSharing(true); }}
                title={nb.sheetId ? 'Enviar a partitura desta música para outro músico' : 'Escreva algo ou importe uma imagem para poder enviar'}
              >
                <Share2 size={13} /> <span className="hidden sm:inline">Enviar</span>
              </button>
              <button className={key(false)} onClick={() => onEdit(songId)} title="Abrir o caderno desta música para escrever">
                <PenLine size={13} /> <span className="hidden sm:inline">Editar</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {!songId ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <p className="text-sm text-logic-text-dim">Aguardando o diretor dar o play</p>
            <p className="text-xs text-logic-text-muted mt-1">A partitura ou cifra da música no ar aparece aqui sozinha.</p>
          </div>
        ) : isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <PenLine size={28} className="text-logic-text-muted mb-2" />
            <p className="text-sm text-logic-text-dim">Sem partitura para {sheetName}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button onClick={images.open} disabled={images.adding} className="console-key flex items-center gap-2 h-10 px-3 text-[13px] !text-logic-text">
                {images.adding ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} className="text-logic-lcd-amber" />}
                Importar foto da partitura
              </button>
              <button onClick={() => onEdit(songId)} className="console-key flex items-center gap-2 h-10 px-3 text-[13px] !text-logic-text">
                <PenLine size={14} className="text-logic-accent" /> Escrever a cifra
              </button>
            </div>
          </div>
        ) : fillImages ? (
          <ImageFill
            key={songId}
            lines={doc.lines.filter((l): l is ImageLine => l.kind === 'image')}
            boxRef={imgBoxRef}
            onManual={onManual}
          />
        ) : (
          <div
            ref={boxRef}
            className={`h-full ${pageFit ? 'overflow-hidden' : 'overflow-y-auto logic-scroll'}`}
            onWheel={onManual}
            onTouchStart={onManual}
            onPointerDown={onManual}
          >
            <div
              ref={pageRef}
              key={songId}
              className="animate-[fadeIn_220ms_ease-out]"
              style={pageFit
                ? { transform: `scale(${scale})`, transformOrigin: 'top center', columnCount: cols, columnGap: 28, columnRule: cols > 1 ? '1px solid rgba(255,255,255,0.06)' : undefined, marginLeft: 'auto', marginRight: 'auto' }
                : undefined}
            >
              <div style={{ zoom: imageOnly ? 1 : zoom }}>
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
          </div>
        )}
      </div>

      {images.input}

      {sharing && nb.sheetId && (
        <div className="absolute inset-0 z-40 flex flex-col bg-logic-bg-deep animate-[fadeIn_140ms_ease-out]">
          <SharePane backend={backend} sheetId={nb.sheetId} onBack={() => setSharing(false)} />
        </div>
      )}

      {toast && (
        <div role="status" className={`absolute left-1/2 -translate-x-1/2 bottom-4 z-50 max-w-[90%] px-4 py-2.5 rounded-lg border text-xs shadow-2xl animate-[fadeIn_160ms_ease-out] bg-logic-bg-elevated ${
          toast.ok ? 'border-logic-lcd-green/40 text-logic-lcd-green'
            : toast.warn ? 'border-logic-lcd-amber/40 text-logic-lcd-amber'
              : 'border-logic-lcd-red/40 text-logic-lcd-red'
        }`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
