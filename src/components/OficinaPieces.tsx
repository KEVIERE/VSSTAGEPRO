// Peças da skin Oficina (Visualizar > Skins), no jeito dos editores de áudio clássicos: a parte de
// cima do canal tingida na cor dele (seletor em pílula e knob branco brilhante), a parte de baixo
// escura com a capa cromada em dois blocos, botões escuros de letra colorida (M vermelho, S
// amarelo), o botão verde no estilo FX, o medidor que avermelha quando o som passa de -6 dB, e
// embaixo o nome na cor do canal e o número numa faixa colorida. Só aparecem com a Oficina.
import { useRef, type ReactNode } from 'react';
import { useMeterLevel } from '@/lib/meterBus';
import { vivid } from '@/components/EstudioPieces';

// Faixas com a cor de fábrica ganham as cores desses editores, na ordem dos canais. A cor que o
// usuário escolheu continua valendo.
const DEFAULT_TRACK_COLORS = new Set(['#5b8db8', '#5bb87a']);
export const OF_PALETTE = ['#a020f0', '#5e8274', '#a99cff', '#c98f8c', '#8a63f0', '#45cde6', '#6fdc6f', '#f07a55', '#8f8f8f', '#9a7fd6', '#d9b84a', '#4fb59a'];

export function ofTrackColor(color: string, order: number): string {
  if (!DEFAULT_TRACK_COLORS.has(color.trim().toLowerCase())) return vivid(color);
  const n = OF_PALETTE.length;
  return OF_PALETTE[((Math.max(0, order) % n) + n) % n];
}

// ---------- fader ----------

export type OfCapTone = 'band' | 'cue' | 'master' | 'tc';
const CAP_GAP: Record<OfCapTone, string> = { band: '#0c0c0c', cue: '#0c0c0c', master: '#5a0f0a', tc: '#5a3a05' };

/** Capa cromada em dois blocos arredondados (brilho em cima, sombra embaixo), com o vão escuro no meio. */
export function OfCap({ tone, className = '', style }: { tone: OfCapTone; className?: string; style?: React.CSSProperties }) {
  const block = (y: number, id: string) => (
    <g>
      <rect x="0.8" y={y} width="22.4" height="16.4" rx="4" fill={`url(#${id})`} stroke="#0a0a0a" strokeWidth="0.9" />
      <rect x="2.4" y={y + 1.2} width="19.2" height="4.6" rx="2.3" fill="#fff" opacity="0.55" />
      <rect x="0.8" y={y} width="22.4" height="16.4" rx="4" fill="url(#of-cap-side)" />
    </g>
  );
  return (
    <svg viewBox="0 0 24 36" preserveAspectRatio="none" className={`of-cap ${className}`} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="of-cap-top" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#d6d6d6" />
          <stop offset="0.75" stopColor="#8c8c8c" />
          <stop offset="1" stopColor="#5c5c5c" />
        </linearGradient>
        <linearGradient id="of-cap-bottom" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f4f4f4" />
          <stop offset="0.3" stopColor="#c4c4c4" />
          <stop offset="0.8" stopColor="#7a7a7a" />
          <stop offset="1" stopColor="#4a4a4a" />
        </linearGradient>
        <linearGradient id="of-cap-side" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.28" />
          <stop offset="0.18" stopColor="#000" stopOpacity="0" />
          <stop offset="0.82" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
      </defs>
      <rect x="2" y="16.6" width="20" height="2.8" fill={CAP_GAP[tone]} />
      {block(0.6, 'of-cap-top')}
      {block(19, 'of-cap-bottom')}
    </svg>
  );
}

// ---------- knob ----------

/** Knob redondo branco brilhante (como uma bolinha) com o ponto preto mostrando a posição. */
export function OfKnob({ value, className = '' }: { value: number; className?: string }) {
  const v = Math.max(-1, Math.min(1, value));
  return (
    <svg viewBox="0 0 24 24" className={`of-knob ${className}`} aria-hidden="true">
      <defs>
        <radialGradient id="of-knob-ball" cx="42%" cy="32%" r="72%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#e2e2e2" />
          <stop offset="0.8" stopColor="#a6a6a6" />
          <stop offset="1" stopColor="#6e6e6e" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="13" r="10.6" fill="#000" opacity="0.4" />
      <circle cx="12" cy="12" r="10.4" fill="url(#of-knob-ball)" stroke="#1a1a1a" strokeWidth="0.8" />
      <ellipse cx="10.2" cy="7.6" rx="4.6" ry="2.4" fill="#fff" opacity="0.7" />
      <g transform={`rotate(${v * 135} 12 12)`}>
        <circle cx="12" cy="4.2" r="1.5" fill="#111" />
      </g>
    </svg>
  );
}

// ---------- medidor ----------

const FLOOR = -60;
export const ofMeterPct = (db: number) => (!(db > FLOOR) ? 0 : db >= 0 ? 1 : (db - FLOOR) / -FLOOR);
export const OF_METER_MARKS = [-6, -18, -30, -42, -54];

/**
 * Medidor escuro com as marcas de dB por dentro. Quando o som passa de -6 dB a coluna fica
 * avermelhada e as marcas acendem em laranja, como nesses editores; o pico segura 1,5 s.
 */
export function OfMeter({ id, height, off, clipping, onClick }: {
  id: string; height: number; off?: boolean; clipping?: boolean; onClick?: (e: React.MouseEvent) => void;
}) {
  const level = useMeterLevel(id);
  const db = level > 1e-5 ? 20 * Math.log10(level) : -Infinity;
  const p = off ? 0 : ofMeterPct(db);
  const hold = useRef({ p: 0, at: 0 });
  const now = performance.now();
  if (p >= hold.current.p || now - hold.current.at > 1500) hold.current = { p, at: now };
  const hot = !off && db > -6;
  return (
    <div className={`of-meter ${hot ? 'is-hot' : ''}`} style={{ height }} onClick={onClick} title={clipping ? 'Clique para apagar o indicador de clip' : undefined}>
      <i className={`of-meter-clip ${clipping ? 'is-on' : ''}`} />
      <div className="of-meter-bar">
        <div className="of-meter-fill" style={{ clipPath: `inset(${(1 - p) * 100}% 0 0 0)` }} />
        {hold.current.p > 0.02 && <div className="of-meter-peak" style={{ bottom: `${hold.current.p * 100}%` }} />}
        {OF_METER_MARKS.map((m) => (
          <span key={m} className="of-meter-mark" style={{ bottom: `${ofMeterPct(m) * 100}%` }}>{m}</span>
        ))}
      </div>
    </div>
  );
}

/** Pico do sinal agora, em texto pequeno. */
export function OfPeak({ meterId, title }: { meterId: string; title?: string }) {
  const level = useMeterLevel(meterId);
  const hold = useRef({ db: -Infinity, at: 0 });
  const db = level > 1e-5 ? 20 * Math.log10(level) : -Infinity;
  const now = performance.now();
  if (db >= hold.current.db || now - hold.current.at > 1500) hold.current = { db, at: now };
  const peak = hold.current.db;
  return (
    <span className={`of-peak ${peak >= 0 ? 'is-red' : ''}`} title={title}>
      {peak > -60 ? peak.toFixed(1) : '-inf'}
    </span>
  );
}

// ---------- teclas e nome ----------

/**
 * Botão escuro de letra colorida: `m` (M vermelho; aceso fica vermelho), `s` (S amarelo; aceso
 * amarelo), `fx` (verde no estilo FX; aceso verde cheio), `plain` (cinza; aceso verde).
 */
export function OfKey({ label, lit, kind = 'plain', alert, pulse, onClick, title, className = '', children }: {
  label: string;
  lit?: boolean;
  kind?: 'm' | 's' | 'fx' | 'plain';
  alert?: boolean;
  pulse?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const litClass = !lit ? '' : alert || kind === 'm' ? 'is-lit-red' : kind === 's' ? 'is-lit-amber' : 'is-lit-green';
  return (
    <button
      className={`console-key of-key is-${kind} flex items-center justify-center ${litClass} ${pulse ? 'animate-pulse' : ''} ${className}`}
      onClick={onClick}
      aria-pressed={!!lit}
      aria-label={label}
      title={title}
    >
      {children ?? label}
    </button>
  );
}

/** Embaixo do canal: o nome na cor dele (fundo claro quando selecionado) e o número numa faixa colorida. */
export function OfName({ name, number, color, selected, title }: { name: ReactNode; number: ReactNode; color: string; selected?: boolean; title?: string }) {
  return (
    <div className={`of-name ${selected ? 'is-selected' : ''}`} title={title} style={{ '--ch': color } as React.CSSProperties}>
      <span className="of-name-text">{name}</span>
      <span className="of-name-num">{number}</span>
    </div>
  );
}
