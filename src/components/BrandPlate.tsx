// Marca do VS Stage na sobra esquerda do mixer (skin padrão), como num equipamento de verdade:
// com espaço, uma plaquinha de alumínio escovado aparafusada no chassi, com a onda, o play e o
// nome gravados a laser, o grão do metal, um arranhão pequeno e as bordas um pouco gastas; com
// pouco espaço, só a onda e o play gravados direto no chassi.
// Usa as geometrias da logo oficial (VsLogo), sem o quadrado.
import { useId, useSyncExternalStore } from 'react';
import { isPerfLite, subscribePerf } from '@/lib/perfMode';
import { VS_PLAY_D, VS_WAVE_D } from '@/components/VsLogo';

/** Onda e play gravados: o traço afundado, com a quina de sombra em cima e a de luz embaixo. */
export function BrandMark({ className = '' }: { className?: string }) {
  const shapes = (
    <>
      <path d={VS_PLAY_D} fill="none" strokeWidth="26" strokeLinejoin="round" />
      <path d={VS_WAVE_D} fill="none" strokeWidth="40" strokeLinecap="round" />
    </>
  );
  return (
    <svg viewBox="120 240 760 520" className={`vs-brand-mark ${className}`} aria-hidden="true">
      <g className="is-light" transform="translate(0 9)">{shapes}</g>
      <g className="is-shadow" transform="translate(0 -9)">{shapes}</g>
      <g className="is-cut">{shapes}</g>
    </svg>
  );
}

/**
 * Parafuso Phillips de aço: cabeça abaulada com a luz em cima, a fenda em cruz (corte escuro com
 * a quina clara) e a sombra curta na chapa. Cada um num ângulo, como os de verdade.
 */
export function PlateScrew({ angle, className = '' }: { angle: number; className?: string }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 10 10" className={`vs-plate-screw ${className}`} aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}-head`} cx="38%" cy="32%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#d9dbde" />
          <stop offset="0.72" stopColor="#8a8d92" />
          <stop offset="1" stopColor="#45474b" />
        </radialGradient>
      </defs>
      {/* sombra na chapa e o rebaixo em volta da cabeça */}
      <circle cx="5.3" cy="5.6" r="4.3" fill="#000" opacity="0.35" />
      <circle cx="5" cy="5" r="4.3" fill="#5d5f63" opacity="0.6" />
      <circle cx="5" cy="5" r="3.9" fill={`url(#${uid}-head)`} stroke="#3c3e42" strokeWidth="0.3" />
      {/* fenda em cruz */}
      <g transform={`rotate(${angle} 5 5)`}>
        <path d="M5 2.4 V7.6 M2.4 5 H7.6" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.05" strokeLinecap="round" transform="translate(0.25 0.3)" />
        <path d="M5 2.4 V7.6 M2.4 5 H7.6" stroke="#2a2b2e" strokeWidth="1.05" strokeLinecap="round" />
      </g>
      <ellipse cx="4" cy="3.5" rx="1.4" ry="0.8" fill="#fff" opacity="0.55" />
    </svg>
  );
}

/** Desgaste da chapa: grão do metal, bordas gastas, sujeira em volta dos parafusos e um arranhão. */
function PlateWear() {
  const uid = useId().replace(/:/g, '');
  const lite = useSyncExternalStore(subscribePerf, isPerfLite);
  return (
    <svg viewBox="0 0 140 48" preserveAspectRatio="none" className="vs-plate-wear" aria-hidden="true">
      <defs>
        <filter id={`${uid}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="11" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.35  0 0 0 0 0.37  0 0 0 0.22 0" />
        </filter>
        <radialGradient id={`${uid}-edge`} cx="50%" cy="50%" r="72%">
          <stop offset="0.62" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#3a3328" stopOpacity="0.35" />
        </radialGradient>
        <radialGradient id={`${uid}-grime`}>
          <stop offset="0" stopColor="#3a3328" stopOpacity="0.32" />
          <stop offset="1" stopColor="#3a3328" stopOpacity="0" />
        </radialGradient>
      </defs>
      {!lite && <rect width="140" height="48" filter={`url(#${uid}-grain)`} />}
      <rect width="140" height="48" fill={`url(#${uid}-edge)`} />
      {/* sujeira em volta dos parafusos */}
      {[[7, 7], [133, 7], [7, 41], [133, 41]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="8" fill={`url(#${uid}-grime)`} />
      ))}
      {/* arranhão pequeno: o sulco escuro e a borda clara meio pixel ao lado */}
      <path d="M104 34.5 Q110 31.6 121.5 28.2" fill="none" stroke="#4a4c50" strokeOpacity="0.55" strokeWidth="0.55" strokeLinecap="round" />
      <path d="M104.3 35.1 Q110.3 32.2 121.8 28.8" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.45" strokeLinecap="round" />
      {/* riscos bem fracos */}
      <path d="M30 40.5 L38 38.8" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.35" strokeLinecap="round" />
      <path d="M86 9.5 L91.5 11" stroke="#3a3c40" strokeOpacity="0.3" strokeWidth="0.35" strokeLinecap="round" />
    </svg>
  );
}

/** Plaquinha aparafusada com a marca (ou só a gravação, se a sobra for estreita). */
export default function BrandPlate() {
  return (
    <div className="vs-brand-side" aria-label="VS Stage Pro">
      <div className="vs-brand-plate">
        <PlateWear />
        <PlateScrew angle={12} className="is-tl" />
        <PlateScrew angle={57} className="is-tr" />
        <PlateScrew angle={-33} className="is-bl" />
        <PlateScrew angle={81} className="is-br" />
        <BrandMark />
        <span className="vs-brand vs-brand-name">VS Stage Pro</span>
      </div>
      <BrandMark className="vs-brand-etched" />
    </div>
  );
}
