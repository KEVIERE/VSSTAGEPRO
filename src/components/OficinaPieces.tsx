// Peças da skin Oficina (Visualizar > Skins), no jeito dos editores de áudio clássicos: a parte de
// cima do canal tingida na cor dele (seletor em pílula e knob branco brilhante), a parte de baixo
// escura com a capa cromada em dois blocos, botões escuros de letra colorida (M vermelho, S
// amarelo), o botão verde no estilo FX, o medidor que avermelha quando o som passa de -6 dB, e
// embaixo o nome na cor do canal e o número numa faixa colorida. Só aparecem com a Oficina.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { AudioLines, Drum, Guitar, KeyboardMusic, Megaphone, MicVocal, Music, Piano, Timer, type LucideIcon } from 'lucide-react';
import { bindMeter, holdDeadline, holdStep, levelDb, meterBarWriter, meterTextPaint, vivid, type MeterHold } from '@/components/EstudioPieces';

// Como no visual padrão desses editores, as faixas com a cor de fábrica ficam cinza; a cor só
// aparece quando o usuário escolhe uma (pelo menu da faixa, na timeline ou no mixer).
const DEFAULT_TRACK_COLORS = new Set(['#5b8db8', '#5bb87a', '#8e9097']);
// (cores antigas da Oficina; ficam para quem quiser voltar a pintar por canal)
export const OF_PALETTE = ['#a020f0', '#5e8274', '#a99cff', '#c98f8c', '#8a63f0', '#45cde6', '#6fdc6f', '#f07a55', '#8f8f8f', '#9a7fd6', '#d9b84a', '#4fb59a'];

export const OF_NEUTRAL = '#a4a9ae';

export function ofTrackColor(color: string, _order: number): string {
  if (!DEFAULT_TRACK_COLORS.has(color.trim().toLowerCase())) return vivid(color);
  return OF_NEUTRAL;
}

// ---------- fader ----------

export type OfCapTone = 'band' | 'cue' | 'master' | 'tc';
const CAP_INDEX: Record<OfCapTone, string> = { band: '#f2f3f5', cue: '#f2f3f5', master: '#ff5a46', tc: '#ffad33' };

/**
 * Capa do fader como a dos editores clássicos: estreita e alta, dois blocos de metal grafite
 * (claros em cima e escurecendo para baixo, como um cilindro com luz de cima), separados por um
 * vão preto fino, contorno escuro e as laterais um pouco mais escuras.
 */
export function OfCap({ tone, className = '', style }: { tone: OfCapTone; className?: string; style?: React.CSSProperties }) {
  const block = (y: number) => (
    <g>
      <rect x="0.6" y={y} width="14.8" height="13.6" rx="2" fill="url(#of-gun)" />
      <rect x="0.6" y={y} width="14.8" height="13.6" rx="2" fill="url(#of-gun-edges)" />
      <rect x="1.6" y={y + 0.7} width="12.8" height="1.4" rx="0.7" fill="#fff" opacity="0.8" />
      <rect x="0.6" y={y} width="14.8" height="13.6" rx="2" fill="none" stroke="#0e0e0f" strokeWidth="0.7" />
    </g>
  );
  return (
    <svg viewBox="0 0 16 30" preserveAspectRatio="none" className={`of-cap ${className}`} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="of-gun" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f6f3f3" />
          <stop offset="0.22" stopColor="#ddd5d5" />
          <stop offset="0.5" stopColor="#a39696" />
          <stop offset="0.8" stopColor="#635959" />
          <stop offset="1" stopColor="#3c3535" />
        </linearGradient>
        <linearGradient id="of-gun-edges" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.4" />
          <stop offset="0.15" stopColor="#000" stopOpacity="0.05" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="0.85" stopColor="#000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {block(0.6)}
      <rect x="1.4" y="14.3" width="13.2" height="1.4" fill="#050505" />
      {tone !== 'band' && tone !== 'cue' && <rect x="2.4" y="14.6" width="11.2" height="0.8" fill={CAP_INDEX[tone]} />}
      {block(15.8)}
    </svg>
  );
}

// ---------- knob ----------

/**
 * Knob redondo branco com o ponto preto mostrando a posição. Fora do centro, acende em volta um
 * arco verde do centro até onde o knob está (como o pan desses editores).
 */
export function OfKnob({ value, className = '' }: { value: number; className?: string }) {
  const v = Math.max(-1, Math.min(1, value));
  const R = 11.4;
  const pt = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [13 + R * Math.cos(a), 13 + R * Math.sin(a)];
  };
  const to = v * 135;
  const [x0, y0] = pt(Math.min(0, to));
  const [x1, y1] = pt(Math.max(0, to));
  const off = Math.abs(v) > 0.01;
  return (
    <svg viewBox="0 0 26 26" className={`of-knob ${className}`} aria-hidden="true">
      <defs>
        <radialGradient id="of-knob-ball" cx="42%" cy="32%" r="72%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#dedede" />
          <stop offset="1" stopColor="#8a8a8a" />
        </radialGradient>
      </defs>
      {off && (
        <path
          d={`M ${x0} ${y0} A ${R} ${R} 0 ${Math.abs(to) > 180 ? 1 : 0} 1 ${x1} ${y1}`}
          fill="none" stroke="#3ddc84" strokeWidth="2.2" strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 2px rgba(61, 220, 132, 0.7))' }}
        />
      )}
      <circle cx="13" cy="13.8" r="9" fill="#000" opacity="0.4" />
      <circle cx="13" cy="13" r="8.8" fill="url(#of-knob-ball)" stroke="#161616" strokeWidth="0.8" />
      <g transform={`rotate(${to} 13 13)`}>
        <circle cx="13" cy="6.6" r="1.4" fill={off ? '#1f9e57' : '#111'} />
      </g>
    </svg>
  );
}

// ---------- medidor ----------

const FLOOR = -60;
export const ofMeterPct = (db: number) => (!(db > FLOOR) ? 0 : db >= 0 ? 1 : (db - FLOOR) / -FLOOR);
export const OF_METER_MARKS = [-6, -18, -30, -42, -54];

/** Desenho do medidor da Oficina: o recorte, o traço do pico e a coluna avermelhada acima de -6 dB. */
function ofMeterPaint(
  root: { className: string },
  fill: ArrayLike<{ style: { clipPath: string } }>,
  peak: ArrayLike<{ style: { bottom: string; display: string } }>,
  off: boolean,
  hold: MeterHold,
) {
  const write = meterBarWriter(fill, peak);
  let rootClass = root.className;
  return (level: number, now: number): number => {
    const db = levelDb(level);
    const p = off ? 0 : ofMeterPct(db);
    holdStep(hold, p, now);
    const hot = !off && db > -6;
    const nextRoot = `of-meter ${hot ? 'is-hot' : ''}`;
    if (nextRoot !== rootClass) { rootClass = nextRoot; root.className = nextRoot; }
    write(p, hold.v);
    return holdDeadline(hold, p);
  };
}

/**
 * Medidor escuro com as marcas de dB por dentro. Quando o som passa de -6 dB a coluna fica
 * avermelhada e as marcas acendem em laranja, como nesses editores; o pico segura 1,5 s.
 * O nível, o pico e o vermelho são escritos pelo efeito, fora do React (veja bindMeter).
 */
export function OfMeter({ id, height, off, clipping, onClick }: {
  id: string; height: number; off?: boolean; clipping?: boolean; onClick?: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hold = useRef<MeterHold>({ v: 0, at: 0 });
  const isOff = !!off;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fill = el.querySelectorAll<HTMLElement>('.of-meter-fill');
    const peak = el.querySelectorAll<HTMLElement>('.of-meter-peak');
    return bindMeter(id, ofMeterPaint(el, fill, peak, isOff, hold.current));
  }, [id, isOff]);
  return (
    <div ref={ref} className="of-meter " style={{ height }} onClick={onClick} title={clipping ? 'Clique para apagar o indicador de clip' : undefined}>
      <i className={`of-meter-clip ${clipping ? 'is-on' : ''}`} />
      <div className="of-meter-bar">
        <div className="of-meter-fill" />
        <div className="of-meter-peak" />
        {OF_METER_MARKS.map((m) => (
          <span key={m} className="of-meter-mark" style={{ bottom: `${ofMeterPct(m) * 100}%` }}>{m}</span>
        ))}
      </div>
    </div>
  );
}

/** Texto e classe do pico em texto pequeno. */
function ofPeakView(peak: number): { text: string; className: string } {
  return { text: peak > -60 ? peak.toFixed(1) : '-inf', className: `of-peak ${peak >= 0 ? 'is-red' : ''}` };
}

/** Pico do sinal agora, em texto pequeno. O texto e a cor são do efeito, fora do React. */
export function OfPeak({ meterId, title }: { meterId: string; title?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const hold = useRef<MeterHold>({ v: -Infinity, at: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return bindMeter(meterId, meterTextPaint(el, hold.current, ofPeakView));
  }, [meterId]);
  // o React não guarda um nó de texto aqui: o efeito escreve antes de pintar
  return <span ref={ref} className="of-peak " title={title} />;
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

