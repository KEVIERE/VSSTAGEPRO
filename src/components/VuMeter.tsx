// VU de ponteiro do master (skin padrão), na sobra da direita do mixer: mostrador iluminado por
// trás, escala de -20 a +3 VU com a zona vermelha, ponteiro preto com a balística de VU (sobe e
// desce em ~300 ms) e o vidro por cima. Como os VUs de verdade, o ponteiro mostra a média do sinal
// (RMS), não o pico: 0 VU = -12 dBFS RMS, o alinhamento de música masterizada (um master em -13
// LUFS fica dançando em volta do 0). O LED de pico acende pelo pico real, acima de -1 dBFS.
// Embaixo, o loudness do master (LUFS).
import { useEffect, useId, useRef, useState } from 'react';
import { meterLevel } from '@/lib/meterBus';
import { audioEngine } from '@/lib/audioEngine';

export const VU_REF_DBFS = -12;
const VU_MIN = -20;
const VU_MAX = 3;
const SWEEP = 50; // graus para cada lado do centro

/** Posição do ponteiro de 0 a 1 (a escala do VU é linear na tensão, como nos de verdade). */
export function vuPosition(vu: number): number {
  const v = Math.max(VU_MIN, Math.min(VU_MAX + 1, vu));
  const lo = Math.pow(10, VU_MIN / 20);
  const hi = Math.pow(10, VU_MAX / 20);
  return Math.max(0, Math.min(1.04, (Math.pow(10, v / 20) - lo) / (hi - lo)));
}

/** Nível em VU a partir da média do sinal (RMS linear, 0 a 1). */
export function levelToVu(level: number): number {
  return level > 1e-6 ? 20 * Math.log10(level) - VU_REF_DBFS : -60;
}

/** Um passo da balística do VU: o ponteiro anda para o alvo com constante de tempo de ~90 ms. */
export function vuStep(needle: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-Math.max(0, dt) / 0.09);
  return needle + (target - needle) * k;
}

const MARKS: { vu: number; label: string }[] = [
  { vu: -20, label: '20' }, { vu: -10, label: '10' }, { vu: -7, label: '7' }, { vu: -5, label: '5' },
  { vu: -3, label: '3' }, { vu: -2, label: '' }, { vu: -1, label: '1' }, { vu: 0, label: '0' },
  { vu: 1, label: '1' }, { vu: 2, label: '' }, { vu: 3, label: '3' },
];

const W = 120;
const H = 74;
const PX = 60;
const PY = 96; // pivô abaixo do mostrador, como nos VUs de painel
const R = 70;

function polar(angleDeg: number, r: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [PX + Math.cos(a) * r, PY + Math.sin(a) * r];
}

/** Pico real acima de -1 dBFS: acende o LED de pico. */
const PEAK_LED = Math.pow(10, -1 / 20);

function VuFace({ side, label }: { side: 'L' | 'R'; label: string }) {
  const uid = useId().replace(/:/g, '');
  const needleRef = useRef<SVGGElement>(null);
  const peakRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let needle = 0;
    let peakUntil = 0;
    let shownAngle = NaN;
    let shownLed = '';
    const tick = (now: number) => {
      const target = vuPosition(levelToVu(meterLevel(`master-rms:${side}`)));
      needle = vuStep(needle, target, (now - last) / 1000);
      last = now;
      // só escreve quando o ponteiro anda de verdade (parado, nada é redesenhado)
      const angle = Math.round((-SWEEP + needle * SWEEP * 2) * 20) / 20;
      if (angle !== shownAngle) {
        shownAngle = angle;
        needleRef.current?.setAttribute('transform', `rotate(${angle} ${PX} ${PY})`);
      }
      // LED de pico: o pico real passou de -1 dBFS; segura 1 s
      if (meterLevel(`master:${side}`) >= PEAK_LED) peakUntil = now + 1000;
      const led = now < peakUntil ? '1' : '0.15';
      if (led !== shownLed) {
        shownLed = led;
        peakRef.current?.setAttribute('opacity', led);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [side]);

  const zeroPos = vuPosition(0);
  const arc = (from: number, to: number, r: number) => {
    const [x1, y1] = polar(-SWEEP + from * SWEEP * 2, r);
    const [x2, y2] = polar(-SWEEP + to * SWEEP * 2, r);
    return `M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`;
  };

  return (
    <div className="vu-bezel" title={`VU do master (${label}): média do sinal, 0 VU = ${VU_REF_DBFS} dBFS RMS. O LED vermelho acende quando o pico passa de -1 dBFS.`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-full" aria-label={`VU do master, canal ${label}`} role="img">
        <defs>
          {/* mostrador iluminado por trás: mais claro no meio */}
          <radialGradient id={`${uid}-face`} cx="50%" cy="75%" r="80%">
            <stop offset="0" stopColor="#fbf0cf" />
            <stop offset="0.55" stopColor="#ecd9a4" />
            <stop offset="1" stopColor="#bfa36a" />
          </radialGradient>
          {/* vidro: reflexo na diagonal */}
          <linearGradient id={`${uid}-glass`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="0.38" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="0.39" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.18" />
          </linearGradient>
          <clipPath id={`${uid}-clip`}>
            <rect x="0" y="0" width={W} height={H} rx="3" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${uid}-clip)`}>
          <rect x="0" y="0" width={W} height={H} fill={`url(#${uid}-face)`} />
          {/* arco da escala: preto até o 0, vermelho acima */}
          <path d={arc(0, zeroPos, R)} fill="none" stroke="#1b1b1b" strokeWidth="0.9" />
          <path d={arc(zeroPos, 1, R)} fill="none" stroke="#c8231b" strokeWidth="3" />
          {MARKS.map((m) => {
            const p = vuPosition(m.vu);
            const ang = -SWEEP + p * SWEEP * 2;
            const [x1, y1] = polar(ang, R);
            const [x2, y2] = polar(ang, R + (m.label ? 5 : 3.5));
            const [tx, ty] = polar(ang, R + 10.5);
            const red = m.vu > 0;
            return (
              <g key={m.vu}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={red ? '#c8231b' : '#1b1b1b'} strokeWidth="0.9" />
                {m.label && (
                  <text x={tx} y={ty + 2} textAnchor="middle" fontSize="6.4" fontWeight="600" fill={red ? '#c8231b' : '#1b1b1b'} fontFamily="Inter, system-ui, sans-serif">
                    {m.label}
                  </text>
                )}
              </g>
            );
          })}
          <text x={PX - 46} y="20" fontSize="7" fontWeight="700" fill="#1b1b1b" fontFamily="Inter, system-ui, sans-serif">−</text>
          <text x={PX + 42} y="20" fontSize="7" fontWeight="700" fill="#c8231b" fontFamily="Inter, system-ui, sans-serif">+</text>
          <text x={PX} y="54" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1b1b1b" fontFamily="Montserrat, Inter, system-ui, sans-serif" letterSpacing="1">VU</text>
          <text x={PX} y="63" textAnchor="middle" fontSize="5.5" fontWeight="600" fill="#5a4a2a" fontFamily="Inter, system-ui, sans-serif" letterSpacing="0.8">{label}</text>
          {/* LED de pico */}
          <circle ref={peakRef} cx={W - 9} cy={H - 9} r="2.4" fill="#ff2a1a" opacity="0.15" style={{ filter: 'drop-shadow(0 0 2px #ff2a1a)' }} />
          {/* ponteiro (sombra no mostrador e o ponteiro preto) */}
          <g ref={needleRef} transform={`rotate(${-SWEEP} ${PX} ${PY})`}>
            <line x1={PX + 1.2} y1={PY - 22} x2={PX + 1.2} y2={PY - R - 4} stroke="#000" strokeOpacity="0.18" strokeWidth="1.4" />
            <line x1={PX} y1={PY - 20} x2={PX} y2={PY - R - 5} stroke="#111" strokeWidth="1" strokeLinecap="round" />
          </g>
          {/* tampa do pivô */}
          <rect x="0" y={H - 12} width={W} height="12" fill="#1a1a1c" />
          <rect x="0" y={H - 12} width={W} height="1" fill="#000" opacity="0.5" />
          {/* vidro */}
          <rect x="0" y="0" width={W} height={H} fill={`url(#${uid}-glass)`} />
        </g>
      </svg>
    </div>
  );
}

/** LUFS para o visor: "-14.2" ou "--" em silêncio. */
export function lufsText(lufs: number): string {
  return Number.isFinite(lufs) && lufs > -70 ? lufs.toFixed(1) : '--';
}

/** Cor do loudness: verde no normal, laranja acima de -9 LUFS, vermelho acima de -6. */
export function lufsTone(lufs: number): 'ok' | 'hot' | 'over' | 'off' {
  if (!Number.isFinite(lufs) || lufs <= -70) return 'off';
  return lufs > -6 ? 'over' : lufs > -9 ? 'hot' : 'ok';
}

/** Visor do loudness do master (momentâneo e curto, em LUFS). */
function LoudnessReadout() {
  const [lu, setLu] = useState({ momentary: -Infinity, shortTerm: -Infinity });
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = audioEngine.getMasterLoudness();
      setLu((prev) => (lufsText(prev.momentary) === lufsText(next.momentary) && lufsText(prev.shortTerm) === lufsText(next.shortTerm) ? prev : next));
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="vu-clock" title="Loudness do master em LUFS (M: últimos 400 ms; S: últimos 3 s), medido na saída 1-2 como as plataformas medem.">
      <div className="vu-lufs">
        <span className="vu-clock-label">LUFS</span>
        <span className="vu-lufs-item">M <b className={`is-${lufsTone(lu.momentary)}`}>{lufsText(lu.momentary)}</b></span>
        <span className="vu-lufs-item">S <b className={`is-${lufsTone(lu.shortTerm)}`}>{lufsText(lu.shortTerm)}</b></span>
      </div>
    </div>
  );
}

/** VUs do master (L e R) e o loudness, para a sobra da direita do mixer. */
export default function MasterVuPanel() {
  return (
    <div className="vs-side-gear" aria-label="VU e loudness do master">
      <div className="vu-pair">
        <VuFace side="L" label="LEFT" />
        <VuFace side="R" label="RIGHT" />
      </div>
      <LoudnessReadout />
    </div>
  );
}
