// Peças da skin Oficina (Visualizar > Skins), no jeito dos editores de áudio clássicos: a parte de
// cima do canal tingida na cor dele (seletor em pílula e knob branco brilhante), a parte de baixo
// escura com a capa cromada em dois blocos, botões escuros de letra colorida (M vermelho, S
// amarelo), o botão verde no estilo FX, o medidor que avermelha quando o som passa de -6 dB, e
// embaixo o nome na cor do canal e o número numa faixa colorida. Só aparecem com a Oficina.
import { useRef, type ReactNode } from 'react';
import { AudioLines, Drum, Guitar, KeyboardMusic, Megaphone, MicVocal, Music, Piano, Timer, type LucideIcon } from 'lucide-react';
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

/**
 * Capa cromada em dois blocos, desenhada como metal de verdade: cada bloco tem as faixas de
 * reflexo do cromo (claro em cima, uma faixa escura, o reflexo forte e a sombra embaixo), as
 * laterais arredondadas mais escuras, o chanfro de luz na quina de cima e a borda escura embaixo.
 * O vão do meio é fundo, com sombra por dentro.
 */
export function OfCap({ tone, className = '', style }: { tone: OfCapTone; className?: string; style?: React.CSSProperties }) {
  const block = (y: number, h: number, metal: string) => (
    <g>
      {/* corpo de metal com as faixas de reflexo */}
      <rect x="0.7" y={y} width="22.6" height={h} rx="3.6" fill={`url(#${metal})`} />
      {/* laterais arredondadas (cilindro): escurecem nas pontas */}
      <rect x="0.7" y={y} width="22.6" height={h} rx="3.6" fill="url(#of-cap-cyl)" />
      {/* reflexo forte e estreito no alto */}
      <rect x="3.2" y={y + 1.1} width="17.6" height="2.2" rx="1.1" fill="#fff" opacity="0.85" />
      <rect x="5" y={y + 1.5} width="7" height="1.2" rx="0.6" fill="#fff" />
      {/* chanfro de luz na quina de cima e sombra na de baixo */}
      <rect x="1.6" y={y + 0.35} width="20.8" height="0.7" rx="0.35" fill="#fff" opacity="0.9" />
      <rect x="1.6" y={y + h - 1.05} width="20.8" height="0.8" rx="0.4" fill="#000" opacity="0.45" />
      {/* contorno */}
      <rect x="0.7" y={y} width="22.6" height={h} rx="3.6" fill="none" stroke="#111111" strokeWidth="0.65" />
    </g>
  );
  return (
    <svg viewBox="0 0 24 36" preserveAspectRatio="none" className={`of-cap ${className}`} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="of-cap-metal-a" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fdfdfd" />
          <stop offset="0.22" stopColor="#d9dadc" />
          <stop offset="0.42" stopColor="#8e9094" />
          <stop offset="0.5" stopColor="#6b6d71" />
          <stop offset="0.6" stopColor="#c9cacc" />
          <stop offset="0.78" stopColor="#a4a6a9" />
          <stop offset="1" stopColor="#4c4e52" />
        </linearGradient>
        <linearGradient id="of-cap-metal-b" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f1f1f2" />
          <stop offset="0.25" stopColor="#c6c7c9" />
          <stop offset="0.45" stopColor="#7d7f83" />
          <stop offset="0.55" stopColor="#5d5f63" />
          <stop offset="0.66" stopColor="#b7b8bb" />
          <stop offset="0.84" stopColor="#8a8c90" />
          <stop offset="1" stopColor="#3d3f42" />
        </linearGradient>
        <linearGradient id="of-cap-cyl" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="0.12" stopColor="#000" stopOpacity="0.12" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.85" stopColor="#000" stopOpacity="0.12" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="of-cap-gap" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" />
          <stop offset="1" stopColor="#262626" />
        </linearGradient>
      </defs>
      {/* vão entre os blocos: fundo, com a cor da função bem escura */}
      <rect x="2.2" y="15.8" width="19.6" height="4.4" rx="1" fill="url(#of-cap-gap)" />
      <rect x="2.2" y="17.4" width="19.6" height="1.2" fill={CAP_GAP[tone]} opacity="0.9" />
      {block(0.6, 15.6, 'of-cap-metal-a')}
      {block(19.8, 15.6, 'of-cap-metal-b')}
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

// ---------- nome da faixa na timeline ----------

// Ícone do instrumento pelo nome da faixa (vale também para faixas criadas pelo usuário).
const ICONS: Array<[RegExp, LucideIcon]> = [
  [/maestro/i, Megaphone],
  [/click|clique|metr[oô]/i, Timer],
  [/guia|voz|vocal|cant|coral|back/i, MicVocal],
  [/bateria|drum|perc|kick|caixa|prato|loop/i, Drum],
  [/sanfon|acorde/i, KeyboardMusic],
  [/teclad|piano|key|synth|órg|org[aã]o|pad/i, Piano],
  [/baixo|bass|guitar|viol|cavaq|ukul/i, Guitar],
  [/solo|sopro|metais|sax|trompet|flaut|string|cord/i, Music],
];

export function ofTrackIcon(name: string): LucideIcon {
  return ICONS.find(([re]) => re.test(name))?.[1] ?? AudioLines;
}

/**
 * Nome da faixa na timeline da Oficina: o ícone do instrumento numa bolinha da cor da faixa, o
 * nome escrito normal (não tudo maiúsculo) e, nas pastas, quantos áudios há dentro.
 */
export function OfTrackLabel({ name, color, count, compact }: { name: string; color: string; count?: number; compact?: boolean }) {
  const Icon = ofTrackIcon(name);
  return (
    <>
      <span className={`of-track-icon ${compact ? 'is-compact' : ''}`} style={{ background: color }} aria-hidden="true">
        <Icon size={compact ? 9 : 11} strokeWidth={2.4} />
      </span>
      <span className="of-track-name truncate">{name}</span>
      {count !== undefined && <span className="of-track-count" title={`${count} áudio(s) nas faixas de dentro`}>{count}</span>}
    </>
  );
}

