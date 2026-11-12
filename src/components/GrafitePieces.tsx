// Peças da skin Grafite (Visualizar > Skins), no jeito das mesas digitais de palco atuais:
// tela de vidro preto em cima de cada canal (faixa na cor do canal, nome e valor), encoder com anel
// de LED, teclas escuras que acendem por dentro (SOLO amarelo, MUTE vermelho, CLIP azul) e fader
// de capa preta fosca com a linha colorida, com o medidor de LEDs fino ao lado. Só aparecem com a
// Grafite vestida; a Analógica continua com as peças de sempre.
import { useRef, type ReactNode } from 'react';
import { useMeterLevel } from '@/lib/meterBus';

export type GfCapTone = 'band' | 'cue' | 'master' | 'tc';

// Linha de referência da capa: diz a função do canal, como nas mesas digitais.
const CAP_LINE: Record<GfCapTone, string> = { band: '#f4f6f9', cue: '#56c8ff', master: '#ff4d42', tc: '#ffb53d' };

/** Capa do fader: preta fosca, com quina de luz em cima, frisos leves e a linha colorida no meio. */
export function GfCap({ tone, className = '', style }: { tone: GfCapTone; className?: string; style?: React.CSSProperties }) {
  const line = CAP_LINE[tone];
  return (
    <svg viewBox="0 0 26 36" preserveAspectRatio="none" className={`gf-cap ${className}`} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="gf-cap-body" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#4a4e55" />
          <stop offset="0.12" stopColor="#2a2d32" />
          <stop offset="0.5" stopColor="#1a1c20" />
          <stop offset="0.88" stopColor="#121316" />
          <stop offset="1" stopColor="#0a0b0c" />
        </linearGradient>
        <linearGradient id="gf-cap-side" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="0.03" />
          <stop offset="0.78" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <radialGradient id="gf-cap-dish" cx="50%" cy="50%" r="60%">
          <stop offset="0" stopColor="#000" stopOpacity="0.28" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="25" height="35" rx="3" fill="url(#gf-cap-body)" stroke="#050506" strokeWidth="1" />
      <rect x="0.5" y="0.5" width="25" height="35" rx="3" fill="url(#gf-cap-side)" />
      {/* a parte de cima é côncava: escurece no meio */}
      <ellipse cx="13" cy="18" rx="11" ry="14" fill="url(#gf-cap-dish)" />
      <rect x="2" y="1.3" width="22" height="1" rx="0.5" fill="#fff" opacity="0.4" />
      {[6, 9, 27, 30].map((y) => (
        <rect key={y} x="3" y={y} width="20" height="0.7" fill="#fff" opacity="0.08" />
      ))}
      {/* linha de referência, acesa */}
      <rect x="1.5" y="17.2" width="23" height="1.6" fill={line} />
      <rect x="1.5" y="16.6" width="23" height="2.8" fill={line} opacity="0.25" />
    </svg>
  );
}

/**
 * Encoder com anel de LED em volta. `value` de -1 a 1. Bipolar (pan): acende do centro até o
 * valor; unipolar (volume): do começo até o valor.
 */
const RING = 15;
export function GfKnob({ value, color = '#46b4ff', bipolar = true, className = '' }: {
  value: number;
  color?: string;
  bipolar?: boolean;
  className?: string;
}) {
  const v = Math.max(-1, Math.min(1, value));
  const pos = ((v + 1) / 2) * (RING - 1); // 0..14
  const mid = (RING - 1) / 2;
  return (
    <svg viewBox="0 0 34 34" className={`gf-knob ${className}`} aria-hidden="true">
      <defs>
        <radialGradient id="gf-knob-body" cx="45%" cy="35%" r="70%">
          <stop offset="0" stopColor="#3d4148" />
          <stop offset="0.6" stopColor="#181a1e" />
          <stop offset="1" stopColor="#0b0c0e" />
        </radialGradient>
        <radialGradient id="gf-knob-cap" cx="42%" cy="30%" r="75%">
          <stop offset="0" stopColor="#4b5058" />
          <stop offset="0.5" stopColor="#24272c" />
          <stop offset="1" stopColor="#121417" />
        </radialGradient>
      </defs>
      {Array.from({ length: RING }, (_, i) => {
        const a = ((-135 + (i / (RING - 1)) * 270 - 90) * Math.PI) / 180;
        const on = bipolar
          ? (i === Math.round(mid)) || (pos >= mid ? i >= mid && i <= pos + 0.01 : i <= mid && i >= pos - 0.01)
          : v > -1 && i <= pos + 0.01;
        return (
          <circle
            key={i}
            cx={17 + 15.2 * Math.cos(a)} cy={17 + 15.2 * Math.sin(a)} r={1.05}
            fill={on ? color : '#33373d'}
            style={on ? { filter: `drop-shadow(0 0 1.6px ${color})` } : undefined}
          />
        );
      })}
      <circle cx="17" cy="18" r="11.6" fill="#000" opacity="0.55" />
      <circle cx="17" cy="17" r="11.2" fill="url(#gf-knob-body)" stroke="#000" strokeWidth="0.6" />
      <circle cx="17" cy="17" r="10.2" fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="1.4" strokeDasharray="0.7 0.9" />
      <circle cx="17" cy="17" r="8.4" fill="url(#gf-knob-cap)" stroke="#060708" strokeWidth="0.5" />
      <ellipse cx="15.2" cy="13.2" rx="5" ry="2.6" fill="#fff" opacity="0.08" />
      <g transform={`rotate(${v * 135} 17 17)`}>
        <rect x="16.3" y="9.6" width="1.4" height="4.2" rx="0.7" fill="#f4f7fa" />
      </g>
    </svg>
  );
}

// Medidor de LEDs fino ao lado do fader: segmentos miúdos, verde → amarelo → vermelho, com o pico
// segurando 1,5 s e o LED de clip em cima (clique apaga).
const FM_SEGS = 30;
export function GfFaderMeter({ id, height, off, clipping, onClick }: {
  id: string;
  height: number;
  off?: boolean;
  clipping?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const level = useMeterLevel(id);
  const db = level > 1e-5 ? 20 * Math.log10(level) : -Infinity;
  const lit = off ? 0 : Math.max(0, Math.min(FM_SEGS, Math.round(((db + 54) / 54) * FM_SEGS)));
  const hold = useRef({ n: 0, at: 0 });
  const now = performance.now();
  if (lit >= hold.current.n || now - hold.current.at > 1500) hold.current = { n: lit, at: now };
  const peak = hold.current.n;
  return (
    <div className="gf-fmeter" style={{ height }} onClick={onClick} title={clipping ? 'Clique para apagar o indicador de clip' : undefined}>
      <i className={`gf-fmeter-clip ${clipping ? 'is-on' : ''}`} />
      {Array.from({ length: FM_SEGS }, (_, k) => {
        const n = FM_SEGS - k; // de cima para baixo
        const zone = n > FM_SEGS - 2 ? 'is-red' : n > FM_SEGS - 7 ? 'is-yellow' : 'is-green';
        const on = n <= lit || (n === peak && peak > 0);
        return <i key={k} className={`${zone} ${on ? 'is-on' : ''}`} />;
      })}
    </div>
  );
}

/** Tela do canal: faixa na cor do canal com o número, nome, valor e a posição do pan. */
export function GfScreen({ number, name, value, unit = 'dB', color, pan, tags }: {
  number: ReactNode;
  name: ReactNode;
  value: string;
  unit?: string;
  color: string;
  pan?: number;
  tags?: ReactNode;
}) {
  return (
    <div className="gf-screen" style={{ '--ch': color } as React.CSSProperties}>
      <div className="gf-screen-head">
        <span>{number}</span>
        <span className="flex items-center gap-[2px]">{tags}</span>
      </div>
      <div className="gf-screen-body">
        <span className="gf-screen-name">{name}</span>
        <span className="gf-screen-value">{value}<small>{unit}</small></span>
      </div>
      <div className="gf-screen-pan" aria-hidden="true">
        {pan !== undefined && <i style={{ left: `${((pan + 1) / 2) * 100}%` }} />}
      </div>
    </div>
  );
}

/** Marquinha acesa na faixa da tela (S de solo, M de mudo...). */
export function GfTag({ on, tone, children }: { on: boolean; tone: 'solo' | 'mute' | 'clip'; children: ReactNode }) {
  return <b className={`gf-tag is-${tone} ${on ? 'is-on' : ''}`}>{children}</b>;
}

/** Tecla escura que acende por dentro na cor da função. */
export function GfKey({ label, lit, tone = 'solo', pulse, onClick, title, className = '', children }: {
  label: string;
  lit?: boolean;
  tone?: 'solo' | 'mute' | 'clip' | 'on';
  pulse?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const litClass = !lit ? '' : tone === 'mute' ? 'is-lit-red' : tone === 'clip' ? 'is-lit-blue' : tone === 'on' ? 'is-lit-green' : 'is-lit-amber';
  return (
    <button
      className={`console-key gf-key flex items-center justify-center gap-[2px] ${litClass} ${pulse ? 'animate-pulse' : ''} ${className}`}
      onClick={onClick}
      aria-pressed={!!lit}
      aria-label={label}
      title={title}
    >
      {children ?? label}
    </button>
  );
}
