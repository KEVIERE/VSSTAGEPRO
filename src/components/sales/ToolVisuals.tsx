import { useEffect, useState, type CSSProperties } from 'react';
import { ListMusic, MonitorPlay, Plus, Smartphone, Wand2, Wifi, Zap } from 'lucide-react';
import SegmentDisplay from '@/components/SegmentDisplay';
import { prefersReducedMotion } from './useScrollScene';

// Miniaturas das ferramentas no painel "Tudo o que o VS Stage faz". Cada uma mostra a ideia da
// ferramenta em poucos traços, com as mesmas peças do programa (LEDs, displays, etiquetas creme).
// As animações só rodam quando o painel está na tela (classe .is-in) e param para quem pede menos
// movimento.

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

function Routing() {
  const rows = [['kick_take2.wav', 'Bateria'], ['baixo final.wav', 'Contrabaixo'], ['vozguia.wav', 'Guia']];
  return (
    <div className="grid gap-2">
      {rows.map(([file, fader], k) => (
        <div key={file} className="vs-route-row" style={v({ '--k': k })}>
          <span className="vs-chip">{file}</span>
          <span className="vs-route-line" />
          <span className="vs-label">{fader}</span>
        </div>
      ))}
    </div>
  );
}

function Timecode({ active }: { active: boolean }) {
  const [frames, setFrames] = useState(72 * 30 + 8);
  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    const t0 = performance.now();
    const start = 72 * 30 + 8;
    let raf = 0;
    const tick = (t: number) => {
      setFrames(start + Math.floor(((t - t0) / 1000) * 30));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const f = frames % 30;
  const s = Math.floor(frames / 30);
  const text = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="vs-lcd vs-mini-lcd self-start"><SegmentDisplay text={text} className="text-[#ffab1f]" label="Timecode tocando" /></div>
      <div className="vs-square" aria-hidden="true">
        <svg viewBox="0 0 400 20" preserveAspectRatio="none">
          <path d="M0 16 H10 V4 H18 V16 H22 V4 H34 V16 H42 V4 H46 V16 H58 V4 H66 V16 H70 V4 H82 V16 H90 V4 H94 V16 H106 V4 H114 V16 H118 V4 H130 V16 H138 V4 H142 V16 H154 V4 H162 V16 H166 V4 H178 V16 H186 V4 H190 V16 H200 V4 H210 V16 H218 V4 H222 V16 H234 V4 H242 V16 H246 V4 H258 V16 H266 V4 H270 V16 H282 V4 H290 V16 H294 V4 H306 V16 H314 V4 H318 V16 H330 V4 H338 V16 H342 V4 H354 V16 H362 V4 H366 V16 H378 V4 H386 V16 H390 V4 H400" fill="none" stroke="#ffab1f" strokeOpacity="0.7" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}

function Equalize() {
  const start = [92, 40, 74, 28, 100, 55, 82, 35];
  return (
    <div className="flex items-end gap-4">
      <div className="vs-bars flex-1" aria-hidden="true">
        {start.map((h, k) => <i key={k} style={v({ '--h0': `${h}%`, '--k': k })} />)}
      </div>
      <span className="vs-key vs-key-sm vs-key-steel !h-8 !text-[0.85rem] gap-2"><span className="vs-led is-green" />IGUALAR</span>
    </div>
  );
}

function AntiClip() {
  return (
    <div className="flex items-end gap-3">
      <div className="vs-ceiling" aria-hidden="true"><i /></div>
      <span className="vs-chip !text-[color:var(--amber)]"><span className="vs-led is-amber" />ANTI-CLIP</span>
    </div>
  );
}

const PHRASES = ['Um, dois, três, quatro', 'Prepara o refrão', 'Segura, só teclado', 'Último refrão, todo mundo!'];

/** Texto sendo digitado e, logo depois, "falado" (barras da voz). Usado no painel e na seção do Maestro. */
export function MaestroTyping({ active, big = false }: { active: boolean; big?: boolean }) {
  const reduce = prefersReducedMotion();
  const [idx, setIdx] = useState(0);
  const [chars, setChars] = useState(reduce ? PHRASES[0].length : 0);
  const [speaking, setSpeaking] = useState(reduce);
  useEffect(() => {
    if (!active || reduce) return;
    const phrase = PHRASES[idx];
    if (chars < phrase.length) {
      const t = window.setTimeout(() => setChars((c) => c + 1), 55);
      return () => window.clearTimeout(t);
    }
    setSpeaking(true);
    const t = window.setTimeout(() => {
      setSpeaking(false);
      setChars(0);
      setIdx((i) => (i + 1) % PHRASES.length);
    }, 1800);
    return () => window.clearTimeout(t);
  }, [active, reduce, chars, idx]);
  const bars = big ? 26 : 16;
  return (
    <div className={`vs-maestro-box vs-lcd ${big ? '' : '!p-3'}`}>
      <span className={`vs-maestro-text ${big ? '' : '!text-[1.15rem]'}`} aria-live="off">
        {PHRASES[idx].slice(0, chars)}<span className="vs-caret" aria-hidden="true" />
      </span>
      <span className={`vs-voice ${speaking ? 'is-speaking' : ''}`} aria-hidden="true">
        {Array.from({ length: bars }, (_, k) => <i key={k} style={v({ '--k': k, '--hh': `${35 + ((k * 37) % 60)}%` })} />)}
      </span>
    </div>
  );
}

function Bpm() {
  return (
    <div className="flex items-center gap-3">
      <div className="vs-lcd vs-mini-lcd"><SegmentDisplay text="128" className="text-[#3ee26e]" label="128 BPM" /></div>
      <span className="vs-led vs-beat !w-3 !h-3" aria-hidden="true" />
      <span className="text-[0.85rem] text-[color:var(--cream-dim)]">BPM</span>
    </div>
  );
}

function Tune() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="vs-chip">Tom <b className="text-[color:var(--amber)] text-[1rem] ml-1">G</b><span className="mx-1 opacity-60">para</span><b className="text-[color:var(--amber)] text-[1rem]">A</b></span>
      <span className="vs-chip">BPM <b className="text-[color:var(--cream)] ml-1">74</b><b className="text-[color:var(--green)] ml-1">+2</b></span>
    </div>
  );
}

function Stems() {
  // Mesma ordem da seção da IA (pedido do dono): voz, click, bateria, baixo, guitarra/violão, teclado e outros
  const list = [['Voz', '#e7e2d6'], ['Click', '#3ee26e'], ['Bateria', '#ff7a59'], ['Baixo', '#ffab1f'], ['Guitarra/Violão', '#64d2ff'], ['Teclado', '#b79cff'], ['Outros', '#a7a297']];
  return (
    <div className="vs-mini-stems" aria-hidden="true">
      {list.map(([n, c], k) => <span key={n} style={v({ '--c': c, '--k': k })}><span className="w-[5.4rem] shrink-0">{n}</span><i /></span>)}
    </div>
  );
}

function Medley() {
  const parts = [['01', 3, '#64d2ff', false], ['02', 2, '#30d158', true], ['03', 3, '#ffd60a', false], ['04', 2, '#ff9f0a', false]] as const;
  return (
    <div className="vs-medley" aria-hidden="true">
      {parts.map(([n, w, c, off]) => <span key={n} className={off ? 'is-off' : ''} style={v({ '--w': w, '--c': c })}>{n}</span>)}
    </div>
  );
}

function Loops() {
  return (
    <div className="vs-pads" aria-hidden="true">
      <span className="vs-pad" style={v({ '--c': '#64d2ff' })}>Intro</span>
      <span className="vs-pad is-lit" style={v({ '--c': '#ff9f0a' })}>Refrão ⟳</span>
      <span className="vs-pad" style={v({ '--c': '#ff6482' })}>Solo</span>
    </div>
  );
}

function LrMagic() {
  return (
    <div className="flex flex-col gap-3">
      <div className="vs-lr" aria-hidden="true">
        <div><b>L</b>{['Click', 'Maestro', 'Guia'].map((x) => <span key={x} className="vs-chip">{x}</span>)}</div>
        <div><b>R</b>{['Bateria', 'Baixo', 'Guitarras', 'Teclados', 'Violões'].map((x) => <span key={x} className="vs-chip">{x}</span>)}</div>
      </div>
      <span className="vs-key vs-key-sm vs-key-amber self-start !h-8 !text-[0.9rem]">LR mágico</span>
    </div>
  );
}

function Export() {
  return (
    <div>
      <div className="vs-export">
        {['Música em LR', 'Multipista', 'Show inteiro'].map((x, k) => (
          <span key={x} className="vs-chip"><span className={`vs-led ${k === 2 ? 'is-green' : ''}`} />{x}</span>
        ))}
      </div>
      <div className="vs-progress" aria-hidden="true"><i /></div>
    </div>
  );
}

function Drag() {
  return (
    <div className="vs-drag" aria-hidden="true">
      <div className="vs-drag-row is-shift" style={v({ '--r': 0 })}>1&nbsp;&nbsp;Música 01</div>
      <div className="vs-drag-row is-shift" style={v({ '--r': 1 })}>2&nbsp;&nbsp;Música 02</div>
      <div className="vs-drag-row is-shift" style={v({ '--r': 2 })}>3&nbsp;&nbsp;Música 03</div>
      <div className="vs-drag-row is-moving" style={v({ '--r': 3 })}>4&nbsp;&nbsp;Música 04</div>
    </div>
  );
}

function Icon({ name }: { name: 'timeline' | 'musico' | 'palco' | 'tv' | 'rede' | 'master' | 'mais' }) {
  const Comp = { timeline: ListMusic, musico: Smartphone, palco: Zap, tv: MonitorPlay, rede: Wifi, master: Wand2, mais: Plus }[name];
  return <span className="vs-cell-icon"><Comp size={22} /></span>;
}

export type ToolViz =
  | 'routing' | 'timecode' | 'equal' | 'anticlip' | 'maestro' | 'bpm' | 'tune' | 'stems' | 'medley' | 'loops' | 'lr' | 'export' | 'drag'
  | 'i-timeline' | 'i-musico' | 'i-palco' | 'i-tv' | 'i-rede' | 'i-master' | 'i-mais';

export function ToolVisual({ viz, active }: { viz: ToolViz; active: boolean }) {
  switch (viz) {
    case 'routing': return <Routing />;
    case 'timecode': return <Timecode active={active} />;
    case 'equal': return <Equalize />;
    case 'anticlip': return <AntiClip />;
    case 'maestro': return <MaestroTyping active={active} />;
    case 'bpm': return <Bpm />;
    case 'tune': return <Tune />;
    case 'stems': return <Stems />;
    case 'medley': return <Medley />;
    case 'loops': return <Loops />;
    case 'lr': return <LrMagic />;
    case 'export': return <Export />;
    case 'drag': return <Drag />;
    case 'i-timeline': return <Icon name="timeline" />;
    case 'i-musico': return <Icon name="musico" />;
    case 'i-palco': return <Icon name="palco" />;
    case 'i-tv': return <Icon name="tv" />;
    case 'i-rede': return <Icon name="rede" />;
    case 'i-master': return <Icon name="master" />;
    default: return <Icon name="mais" />;
  }
}
