// Peças da skin Estúdio (Visualizar > Skins), no jeito das DAWs atuais do Mac: cinza liso, fonte
// do sistema, faixas em cores vivas, knob de pan com arco azul, caixinhas de dB, fader cinza claro,
// medidor liso (verde, amarelo, vermelho), teclas M / S arredondadas e o nome do canal embaixo na
// cor da faixa. Só aparecem com a Estúdio vestida.
import { useRef, type ReactNode } from 'react';
import { useMeterLevel } from '@/lib/meterBus';
import { volumeToDb } from '@/lib/audioEngine';

// ---------- cores ----------

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** A cor da faixa mais viva (as faixas desta skin são coloridas, como nas DAWs do Mac). */
export function vivid(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  s = Math.max(s, 0.72);
  const L = Math.min(0.58, Math.max(0.5, l));
  const q = L < 0.5 ? L * (1 + s) : L + s - L * s;
  const p = 2 * L - q;
  const ch = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return toHex(ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255);
}

/** A cor misturada com preto (0 = igual, 1 = preto): a onda escura em cima do clipe colorido. */
export function shade(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return '#0d1420';
  return toHex(...(rgb.map((v) => v * (1 - amount)) as [number, number, number]));
}

// ---------- fader ----------

export type EsCapTone = 'band' | 'cue' | 'master' | 'tc';

/**
 * Capa do fader no jeito das DAWs do Mac: cinza meio transparente (a régua aparece por trás),
 * cantos redondos, mais alta que larga, frisos leves e a linha branca no meio. O tom fica num
 * risquinho colorido na ponta da linha (azul guia/click/maestro, vermelho master, laranja TC).
 */
const CAP_TICK: Record<EsCapTone, string | null> = { band: null, cue: '#0a84ff', master: '#ff453a', tc: '#ff9f0a' };
export function EsCap({ tone, className = '', style }: { tone: EsCapTone; className?: string; style?: React.CSSProperties }) {
  const tick = CAP_TICK[tone];
  return (
    <svg viewBox="0 0 16 32" preserveAspectRatio="none" className={`es-cap ${className}`} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="es-cap-body" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#dedee3" stopOpacity="0.8" />
          <stop offset="0.5" stopColor="#a8a8ae" stopOpacity="0.68" />
          <stop offset="1" stopColor="#8e8e93" stopOpacity="0.74" />
        </linearGradient>
        <linearGradient id="es-cap-side" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="15" height="31" rx="3.5" fill="url(#es-cap-body)" />
      <rect x="0.5" y="0.5" width="15" height="31" rx="3.5" fill="url(#es-cap-side)" stroke="#fff" strokeOpacity="0.3" strokeWidth="0.8" />
      {[5, 7.4, 9.8, 21.8, 24.2, 26.6].map((y) => (
        <rect key={y} x="3" y={y} width="10" height="0.6" fill="#fff" opacity="0.2" />
      ))}
      <rect x="1.4" y="15.2" width="13.2" height="1.6" rx="0.8" fill="#ffffff" />
      {tick && <rect x="1.4" y="15.2" width="2.6" height="1.6" rx="0.8" fill={tick} />}
    </svg>
  );
}

// ---------- cores das faixas ----------

// Faixas com a cor de fábrica ganham o degradê das DAWs do Mac (ciano → azul → roxo → rosa), na
// ordem dos canais. A cor que o usuário escolheu para a faixa continua valendo.
const DEFAULT_TRACK_COLORS = new Set(['#5b8db8', '#5bb87a']);
export const ES_PALETTE = ['#16b4d8', '#13a2e3', '#178ff0', '#2f79f3', '#4a66ef', '#5d57ea', '#7150e3', '#874ad8', '#9d44c9', '#b23fb6', '#c43c9f', '#d24485'];

export function esTrackColor(color: string, order: number): string {
  if (!DEFAULT_TRACK_COLORS.has(color.trim().toLowerCase())) return vivid(color);
  const n = ES_PALETTE.length;
  return ES_PALETTE[((Math.max(0, order) % n) + n) % n];
}

/** Posição do canal no mixer (os de topo, na ordem das faixas). Faixa de dentro usa a da pasta. */
export function esChannelOrder(tracks: Array<{ id: string; parentId?: string | null }>, routable: readonly string[], trackId: string): number {
  const t = tracks.find((x) => x.id === trackId);
  const top = t?.parentId ?? trackId;
  const channels = routable.filter((id) => tracks.some((x) => x.id === id && !x.parentId));
  return channels.indexOf(top);
}

// ---------- knob ----------

/**
 * Knob de pan (ou volume): disco cinza liso dentro de um anel preto, e o risquinho branco no anel
 * mostrando a posição, como nas DAWs do Mac. `value` de -1 a 1.
 */
export function EsKnob({ value, className = '' }: { value: number; bipolar?: boolean; className?: string }) {
  const v = Math.max(-1, Math.min(1, value));
  return (
    <svg viewBox="0 0 28 28" className={`es-knob ${className}`} aria-hidden="true">
      <defs>
        <linearGradient id="es-knob-disc" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#a1a1a6" />
          <stop offset="1" stopColor="#86868b" />
        </linearGradient>
      </defs>
      <circle cx="14" cy="14" r="13" fill="#0e0e10" />
      <circle cx="14" cy="14" r="9.4" fill="url(#es-knob-disc)" />
      <circle cx="14" cy="14" r="9.4" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="0.6" />
      <g transform={`rotate(${v * 135} 14 14)`}>
        <rect x="13.35" y="1.6" width="1.3" height="3.2" rx="0.6" fill="#ffffff" />
      </g>
    </svg>
  );
}

// ---------- medidor ----------

// Escala como a das DAWs: de 0 a -24 dB ocupa 60% do medidor (onde a música acontece) e de -24 a
// -60 dB os 40% de baixo. Linear em dB juntava os números de cima um em cima do outro.
export function esMeterPct(db: number): number {
  if (!(db > -60)) return 0;
  if (db >= 0) return 1;
  return db >= -24 ? 1 - (-db / 24) * 0.6 : 0.4 * ((db + 60) / 36);
}
const pctOf = esMeterPct;
export const ES_METER_MARKS = [0, -6, -12, -18, -24, -40, -60];

/**
 * Medidor em duas barrinhas finas, como nas DAWs do Mac: verde, amarelo perto do topo, vermelho
 * no 0 dB; o pico segura 1,5 s. O motor dá um nível por canal: as duas barras mostram o mesmo.
 */
export function EsMeter({ id, height, off, clipping, onClick }: {
  id: string; height: number; off?: boolean; clipping?: boolean; onClick?: (e: React.MouseEvent) => void;
}) {
  const level = useMeterLevel(id);
  const db = level > 1e-5 ? 20 * Math.log10(level) : -Infinity;
  const p = off ? 0 : pctOf(db);
  const hold = useRef({ p: 0, at: 0 });
  const now = performance.now();
  if (p >= hold.current.p || now - hold.current.at > 1500) hold.current = { p, at: now };
  const bar = (
    <div className="es-meter-bar">
      <div className="es-meter-fill" style={{ clipPath: `inset(${(1 - p) * 100}% 0 0 0)` }} />
      {hold.current.p > 0.02 && <div className="es-meter-peak" style={{ bottom: `${hold.current.p * 100}%` }} />}
    </div>
  );
  return (
    <div className="es-meter" style={{ height }} onClick={onClick} title={clipping ? 'Clique para apagar o indicador de clip' : undefined}>
      <i className={`es-meter-clip ${clipping ? 'is-on' : ''}`} />
      <div className="flex gap-[1px] flex-1 min-h-0">{bar}{bar}</div>
    </div>
  );
}

/** Escala do medidor (dBFS), em números miúdos entre o fader e o medidor. */
export function EsMeterScale({ height }: { height: number }) {
  return (
    <div className="relative w-[11px] pointer-events-none" style={{ height }}>
      {ES_METER_MARKS.map((m) => (
        <span key={m} className="es-meter-mark" style={{ bottom: `${pctOf(m) * 100}%` }}>{Math.abs(m)}</span>
      ))}
    </div>
  );
}

// ---------- caixinhas de dB ----------

/** Duas caixinhas: o volume do fader (branco) e o pico do sinal agora (verde, amarelo ou vermelho). */
export function EsDbBoxes({ volume, meterId, title }: { volume: number; meterId: string; title?: string }) {
  const fdb = volumeToDb(volume);
  const fader = fdb === -Infinity ? '-∞' : fdb.toFixed(1);
  const level = useMeterLevel(meterId);
  const hold = useRef({ db: -Infinity, at: 0 });
  const db = level > 1e-5 ? 20 * Math.log10(level) : -Infinity;
  const now = performance.now();
  if (db >= hold.current.db || now - hold.current.at > 1500) hold.current = { db, at: now };
  const peak = hold.current.db;
  const live = peak > -60;
  const tone = peak >= 0 ? 'is-red' : peak >= -6 ? 'is-yellow' : 'is-green';
  return (
    <div className="flex gap-[2px] w-full" title={title}>
      <span className="es-dbbox">{fader}</span>
      <span className={`es-dbbox ${live ? tone : ''}`}>{live ? peak.toFixed(1) : ' '}</span>
    </div>
  );
}

// ---------- teclas e nome ----------

/** Tecla pequena arredondada (M, S...): M acende azul, S acende amarelo, como nas DAWs do Mac. */
export function EsKey({ label, lit, tone = 'solo', pulse, onClick, title, className = '', children }: {
  label: string;
  lit?: boolean;
  tone?: 'solo' | 'mute' | 'on' | 'alert';
  pulse?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const litClass = !lit ? '' : tone === 'mute' || tone === 'on' ? 'is-lit-blue' : tone === 'alert' ? 'is-lit-red' : 'is-lit-amber';
  return (
    <button
      className={`console-key es-key flex items-center justify-center gap-[2px] ${litClass} ${pulse ? 'animate-pulse' : ''} ${className}`}
      onClick={onClick}
      aria-pressed={!!lit}
      aria-label={label}
      title={title}
    >
      {children ?? label}
    </button>
  );
}

/** Nome do canal embaixo da faixa, na cor dela. */
export function EsName({ name, color, title }: { name: ReactNode; color: string; title?: string }) {
  return (
    <div className="es-name" style={{ background: color }} title={title}>
      <span className="line-clamp-2 break-words text-center">{name}</span>
    </div>
  );
}
