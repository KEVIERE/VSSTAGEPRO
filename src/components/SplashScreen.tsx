import { useCallback, useEffect, useRef, useState } from 'react';

const STEPS = [
  { at: 0, progress: 0.18, text: 'Carregando motor de áudio...' },
  { at: 900, progress: 0.52, text: 'Preparando timecode e periféricos...' },
  { at: 1800, progress: 0.84, text: 'Abrindo o show...' },
  { at: 2600, progress: 1, text: 'Pronto' },
];
const EXIT_AT = 3600;
const EXIT_MS = 450;
const TITLE = 'VS STAGE';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const leave = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    const timers = STEPS.slice(1).map((s, i) => window.setTimeout(() => setStep(i + 1), s.at));
    timers.push(window.setTimeout(leave, EXIT_AT));
    return () => timers.forEach(clearTimeout);
  }, [leave]);

  useEffect(() => {
    if (!leaving) return;
    setStep(STEPS.length - 1);
    const t = window.setTimeout(() => doneRef.current(), EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      leave();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [leave]);

  const current = STEPS[step];

  return (
    <div
      className="splash fixed inset-0 z-[200] flex items-center justify-center p-6 cursor-default select-none"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(27, 28, 32, 0.55) 0%, rgba(6, 7, 9, 0.82) 75%)',
        backdropFilter: 'blur(24px) saturate(140%)',
        WebkitBackdropFilter: 'blur(24px) saturate(140%)',
        opacity: leaving ? 0 : 1,
        transition: `opacity ${EXIT_MS}ms ease`,
      }}
      onMouseDown={leave}
      role="status"
      aria-label="Abrindo o VS Stage"
    >
      <div
        className="splash-card w-full max-w-[646px] aspect-[16/9] rounded-[24px] overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(36, 38, 43, 0.6) 0%, rgba(12, 13, 16, 0.78) 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09), inset 0 1px 0 rgba(255,255,255,0.12), 0 40px 80px -20px rgba(0,0,0,0.8)',
          transform: leaving ? 'scale(1.03)' : 'scale(1)',
          transition: `transform ${EXIT_MS}ms ease`,
        }}
      >
      <svg viewBox="0 0 800 450" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Gradientes/filtros do logo oficial (squircle + onda neon + play de vidro),
              prefixados "sp-" por estarem na mesma árvore de outros <defs> deste arquivo. */}
          <linearGradient id="sp-squircle-rim-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4e515c" />
            <stop offset="8%" stopColor="#383a43" />
            <stop offset="90%" stopColor="#1b1c21" />
            <stop offset="100%" stopColor="#131418" />
          </linearGradient>
          <linearGradient id="sp-squircle-face-grad" x1="20%" y1="5%" x2="80%" y2="95%">
            <stop offset="0%" stopColor="#2d2f37" />
            <stop offset="50%" stopColor="#24252c" />
            <stop offset="100%" stopColor="#1b1c21" />
          </linearGradient>
          <radialGradient id="sp-ambient-cyan" cx="27%" cy="43%" r="34%">
            <stop offset="0%" stopColor="#00d9ff" stopOpacity={0.28} />
            <stop offset="55%" stopColor="#008cff" stopOpacity={0.09} />
            <stop offset="100%" stopColor="#008cff" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="sp-ambient-blue" cx="56%" cy="63%" r="30%">
            <stop offset="0%" stopColor="#1c56ff" stopOpacity={0.22} />
            <stop offset="65%" stopColor="#1c56ff" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#1c56ff" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="sp-ambient-orange" cx="78%" cy="55%" r="28%">
            <stop offset="0%" stopColor="#ff7816" stopOpacity={0.27} />
            <stop offset="55%" stopColor="#ff5100" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#ff5100" stopOpacity={0} />
          </radialGradient>

          <linearGradient id="sp-tube-wall-grad" x1="140" y1="450" x2="860" y2="550" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#76f7ff" />
            <stop offset="12%" stopColor="#1ae0ff" />
            <stop offset="26%" stopColor="#22a6ff" />
            <stop offset="40%" stopColor="#2578ed" />
            <stop offset="54%" stopColor="#1d56d4" />
            <stop offset="66%" stopColor="#2d60db" />
            <stop offset="75%" stopColor="#6b56aa" />
            <stop offset="84%" stopColor="#cf5e4c" />
            <stop offset="92%" stopColor="#ff7e24" />
            <stop offset="100%" stopColor="#ffa02c" />
          </linearGradient>
          <linearGradient id="sp-tube-core-grad" x1="140" y1="450" x2="860" y2="550" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#b8fcff" />
            <stop offset="9%" stopColor="#22cbf0" />
            <stop offset="22%" stopColor="#0d7ec4" />
            <stop offset="36%" stopColor="#10448a" />
            <stop offset="50%" stopColor="#0c2663" />
            <stop offset="64%" stopColor="#112b6e" />
            <stop offset="74%" stopColor="#352659" />
            <stop offset="84%" stopColor="#873323" />
            <stop offset="94%" stopColor="#cc4e10" />
            <stop offset="100%" stopColor="#b83c08" />
          </linearGradient>
          <radialGradient id="sp-tip-cyan-glow" cx="158" cy="496" r="46" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
            <stop offset="40%" stopColor="#8cfaff" stopOpacity={0.75} />
            <stop offset="100%" stopColor="#00d5ff" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="sp-tip-orange-glow" cx="836" cy="490" r="42" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fff0bd" stopOpacity={0.9} />
            <stop offset="45%" stopColor="#ff9e2c" stopOpacity={0.65} />
            <stop offset="100%" stopColor="#eb5a0f" stopOpacity={0} />
          </radialGradient>

          <linearGradient id="sp-glass-base-grad" x1="347" y1="300" x2="690" y2="630" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#edf4fc" stopOpacity={0.58} />
            <stop offset="40%" stopColor="#cad5e2" stopOpacity={0.44} />
            <stop offset="75%" stopColor="#949eab" stopOpacity={0.36} />
            <stop offset="100%" stopColor="#bd968d" stopOpacity={0.44} />
          </linearGradient>
          <linearGradient id="sp-glass-upper-sheen" x1="347" y1="295" x2="565" y2="490" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.56} />
            <stop offset="55%" stopColor="#e4ecf7" stopOpacity={0.40} />
            <stop offset="100%" stopColor="#c8d4e3" stopOpacity={0.26} />
          </linearGradient>
          <linearGradient id="sp-glass-lower-smoky" x1="347" y1="510" x2="695" y2="660" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#525a66" stopOpacity={0.38} />
            <stop offset="55%" stopColor="#696f7a" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#c48a78" stopOpacity={0.36} />
          </linearGradient>
          <radialGradient id="sp-glass-right-warmth" cx="695" cy="498" r="170" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ff944d" stopOpacity={0.40} />
            <stop offset="50%" stopColor="#d97a64" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </radialGradient>
          <linearGradient id="sp-inner-bevel-grad" x1="389" y1="360" x2="625" y2="610" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
            <stop offset="35%" stopColor="#6e7b8f" stopOpacity={0.42} />
            <stop offset="70%" stopColor="#9ab4d6" stopOpacity={0.48} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0.65} />
          </linearGradient>
          <linearGradient id="sp-inner-rim-stroke" x1="396" y1="365" x2="624" y2="590" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.82} />
            <stop offset="45%" stopColor="#96a5ba" stopOpacity={0.45} />
            <stop offset="80%" stopColor="#b8d8ff" stopOpacity={0.75} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0.88} />
          </linearGradient>
          <linearGradient id="sp-outer-rim-stroke" x1="347" y1="295" x2="706" y2="700" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
            <stop offset="35%" stopColor="#ffffff" stopOpacity={0.75} />
            <stop offset="70%" stopColor="#e0c5bc" stopOpacity={0.58} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0.85} />
          </linearGradient>

          {/* pathLength=1 normaliza o comprimento do traçado para 0..1: é o que permite
              stroke-dasharray/stroke-dashoffset:1 (classes splash-wave-draw/-core-draw)
              desenharem a onda progressivamente. Precisa estar aqui, no <path> real —
              colocar pathLength num <use> que referencia este path não tem efeito, pois
              não é uma propriedade CSS herdável, é um atributo de geometria do próprio nó. */}
          <path
            id="sp-wave-path"
            fill="none"
            d="M 154, 496 C 176, 502, 206, 464, 248, 390 C 290, 316, 326, 268, 366, 268 C 408, 268, 435, 336, 468, 444 C 501, 552, 528, 636, 560, 688 C 576, 714, 590, 726, 606, 726 C 638, 726, 676, 672, 724, 598 C 766, 534, 804, 484, 842, 498"
          />
          <mask id="sp-tube-mask" maskUnits="userSpaceOnUse" x="100" y="200" width="800" height="600">
            <use href="#sp-wave-path" stroke="#ffffff" strokeWidth="44" strokeLinecap="round" />
          </mask>
          <path
            id="sp-outer-triangle"
            d="M 347, 318.44 A 24, 24 0 0, 1 383, 297.66 L 694, 477.22 A 24, 24 0 0, 1 694, 518.78 L 383, 698.34 A 24, 24 0 0, 1 347, 677.56 Z"
          />
          <path
            id="sp-inner-bevel-ridge"
            d="M 389, 368.67 A 11, 11 0 0, 1 405.5, 359.14 L 629.5, 488.47 A 11, 11 0 0, 1 629.5, 507.53 L 405.5, 636.86 A 11, 11 0 0, 1 389, 627.33 Z"
          />
          <path
            id="sp-inner-hole"
            d="M 396, 375.60 A 8, 8 0 0, 1 408, 368.67 L 620, 491.07 A 8, 8 0 0, 1 620, 504.93 L 408, 627.33 A 8, 8 0 0, 1 396, 620.40 Z"
          />
          <path
            id="sp-glass-ring-shape"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M 347, 318.44 A 24, 24 0 0, 1 383, 297.66 L 694, 477.22 A 24, 24 0 0, 1 694, 518.78 L 383, 698.34 A 24, 24 0 0, 1 347, 677.56 Z M 396, 375.60 L 396, 620.40 A 8, 8 0 0, 0 408, 627.33 L 620, 504.93 A 8, 8 0 0, 0 620, 491.07 L 408, 368.67 A 8, 8 0 0, 0 396, 375.60 Z"
          />
          <path
            id="sp-inner-bevel-band"
            fillRule="evenodd"
            d="M 389, 368.67 A 11, 11 0 0, 1 405.5, 359.14 L 629.5, 488.47 A 11, 11 0 0, 1 629.5, 507.53 L 405.5, 636.86 A 11, 11 0 0, 1 389, 627.33 Z M 396, 375.60 L 396, 620.40 A 8, 8 0 0, 0 408, 627.33 L 620, 504.93 A 8, 8 0 0, 0 620, 491.07 L 408, 368.67 A 8, 8 0 0, 0 396, 375.60 Z"
          />
          <clipPath id="sp-squircle-face-clip">
            <rect x="62" y="73" width="876" height="855" rx="214" ry="214" />
          </clipPath>
          <clipPath id="sp-glass-clip">
            <use href="#sp-glass-ring-shape" />
          </clipPath>

          <filter id="sp-squircle-shadow" x="-12%" y="-10%" width="124%" height="124%">
            <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#000000" floodOpacity={0.58} />
          </filter>
          <filter id="sp-neon-glow-wide" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="38" />
          </filter>
          <filter id="sp-neon-glow-mid" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id="sp-core-soft" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="4.2" />
          </filter>
          <filter id="sp-spec-soft" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <filter id="sp-frost-refraction" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6.5" />
          </filter>
          <filter id="sp-glass-drop-shadow" x="-25%" y="-25%" width="155%" height="155%">
            <feDropShadow dx="4" dy="24" stdDeviation="19" floodColor="#000000" floodOpacity={0.68} />
          </filter>

          <filter id="spBarGlow" x="-20%" y="-200%" width="140%" height="500%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#4ade80" floodOpacity={0.6} />
          </filter>
          <radialGradient id="spStageAura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff9f0a" stopOpacity={0.4} />
            <stop offset="40%" stopColor="#10b981" stopOpacity={0.2} />
            <stop offset="70%" stopColor="#0a84ff" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#0a84ff" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* Aura de Holofote do Palco Pulsante Atrás do Logo */}
        <circle cx="400" cy="128" r="140" fill="url(#spStageAura)" className="splash-stage-aura" />

        <svg x="310" y="38" width="180" height="180" viewBox="0 0 1000 1000" className="splash-logo-pop overflow-visible">
          {/* Base Squircle (gradiente + luzes ambiente do logo oficial) */}
          <g>
            <rect x="60" y="60" width="880" height="880" rx="218" ry="218" fill="url(#sp-squircle-rim-grad)" filter="url(#sp-squircle-shadow)" />
            <rect x="61" y="61" width="878" height="878" rx="217" ry="217" fill="none" stroke="#ffffff" strokeOpacity={0.16} strokeWidth="1.2" />
            <g clipPath="url(#sp-squircle-face-clip)">
              <rect x="62" y="73" width="876" height="855" fill="url(#sp-squircle-face-grad)" />
              <rect x="62" y="73" width="876" height="855" fill="url(#sp-ambient-cyan)" />
              <rect x="62" y="73" width="876" height="855" fill="url(#sp-ambient-blue)" />
              <rect x="62" y="73" width="876" height="855" fill="url(#sp-ambient-orange)" />
            </g>
          </g>

          {/* Onda Sonora Neon 3D Completa Desenhada Dinamicamente da Esquerda para a Direita */}
          {/* Ponta inicial (ciano) acende no início do traçado */}
          <circle className="splash-tip-left" cx="158" cy="496" r="46" fill="url(#sp-tip-cyan-glow)" />

          {/* Brilho atmosférico amplo: desenha dinamicamente com a onda */}
          <use className="splash-wave-draw" href="#sp-wave-path" stroke="url(#sp-tube-wall-grad)" strokeWidth="72" strokeLinecap="round" opacity={0.42} filter="url(#sp-neon-glow-wide)" />

          {/* Brilho médio volumétrico: desenha dinamicamente com a onda */}
          <use className="splash-wave-draw" href="#sp-wave-path" stroke="url(#sp-tube-wall-grad)" strokeWidth="48" strokeLinecap="round" opacity={0.65} filter="url(#sp-neon-glow-mid)" />

          {/* Sombra do tubo: desenha dinamicamente com a onda */}
          <use className="splash-wave-draw" href="#sp-wave-path" transform="translate(8, 18)" stroke="#000000" strokeWidth="42" strokeLinecap="round" opacity={0.55} filter="url(#sp-tube-drop-shadow)" />

          {/* Tubo neon principal: desenha dinamicamente com o gradiente oficial */}
          <use className="splash-wave-draw" href="#sp-wave-path" stroke="url(#sp-tube-wall-grad)" strokeWidth="44" strokeLinecap="round" />

          {/* Núcleo 3D cilíndrico interno translúcido: desenha dinamicamente */}
          <use className="splash-wave-draw" href="#sp-wave-path" transform="translate(0, 1.5)" stroke="url(#sp-tube-core-grad)" strokeWidth="25" strokeLinecap="round" filter="url(#sp-core-soft)" />

          {/* Destaque especular branco superior fino */}
          <use className="splash-wave-spec-draw" href="#sp-wave-path" transform="translate(-1.5, -12)" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" filter="url(#sp-spec-soft)" />

          {/* Ponta final (âmbar): surge quando a onda completa o desenho */}
          <circle className="splash-tip-right" cx="836" cy="490" r="44" fill="url(#sp-tip-orange-glow)" />

          {/* Botão Play em vidro fosco, com o mesmo salto elástico de antes */}
          <g className="splash-play-pop" filter="url(#sp-glass-drop-shadow)">
            <g clipPath="url(#sp-glass-clip)">
              <rect x="335" y="285" width="380" height="430" fill="url(#sp-glass-base-grad)" />
              <g filter="url(#sp-frost-refraction)" opacity={0.84}>
                <use href="#sp-wave-path" stroke="#09235c" strokeWidth="50" strokeLinecap="round" />
                <use href="#sp-wave-path" stroke="url(#sp-tube-wall-grad)" strokeWidth="34" strokeLinecap="round" />
              </g>
              <rect x="335" y="285" width="380" height="430" fill="url(#sp-glass-right-warmth)" />
              <polygon points="340,549.7 396,512 546,444 584,412 720,412 720,715 340,715" fill="url(#sp-glass-lower-smoky)" />
              <polygon points="340,285 720,285 584,412 546,444 396,512 340,549.7" fill="url(#sp-glass-upper-sheen)" />
              <use href="#sp-inner-bevel-band" fill="url(#sp-inner-bevel-grad)" />
              <use href="#sp-outer-triangle" fill="none" stroke="#ffffff" strokeWidth="10" strokeOpacity={0.18} filter="url(#sp-spec-soft)" />
            </g>
            <use href="#sp-inner-bevel-ridge" fill="none" stroke="#ffffff" strokeOpacity={0.34} strokeWidth="1.2" />
            <use href="#sp-inner-hole" fill="none" stroke="url(#sp-inner-rim-stroke)" strokeWidth="2.2" />
            <use href="#sp-outer-triangle" fill="none" stroke="url(#sp-outer-rim-stroke)" strokeWidth="2.4" />
          </g>
        </svg>

        <text x="400" y="260" textAnchor="middle" fontFamily={FONT} fontSize="28" fontWeight="800" fill="#fff" className="splash-title-cinematic">
          {TITLE}
        </text>
        <text className="splash-rise" style={{ animationDelay: '1200ms' }} x="400" y="285" textAnchor="middle" fontFamily={FONT} fontSize="11" fontWeight="600" fill="#9ca3af" letterSpacing="4">
          LIVE PERFORMANCE ENGINE
        </text>

        <g className="splash-fade" style={{ animationDelay: '500ms' }}>
          <text key={step} className="splash-status" x="400" y="325" textAnchor="middle" fontFamily={FONT} fontSize="11" fill="#8b929e">
            {current.text}
          </text>
          <g transform="translate(250, 342)">
            <rect width="300" height="6" rx="3" fill="#0d0e11" stroke="#2a2c34" strokeWidth="1" />
            <rect
              x="1" y="1" width="298" height="4" rx="2" fill="#4ade80" filter="url(#spBarGlow)"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'left center',
                transform: `scaleX(${current.progress})`,
                transition: 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          </g>
        </g>

        <g className="splash-fade" style={{ animationDelay: '800ms' }}>
          <text x="40" y="425" fontFamily={FONT} fontSize="11" fontWeight="500" fill="#71717a">© 2026 VS Stage</text>
          <text x="760" y="425" textAnchor="end" fontFamily={FONT} fontSize="11" fontWeight="600" fill="#f59e0b">v{__APP_VERSION__} PRO</text>
        </g>
      </svg>
      </div>
    </div>
  );
}
