import { useId } from 'react';

interface VsLogoProps {
  size?: number;
  className?: string;
}

// Logo oficial VS Stage Pro: squircle grafite 3D com onda neon (ciano -> azul -> âmbar)
// atravessando um botão Play em vidro fosco (glassmorphism). Geometria e gradientes
// exatos do arquivo-fonte oficial (ver public/logo-nova.svg).
//
// Todos os ids internos (gradientes/filtros/máscaras/paths) são namespaced com useId()
// porque este componente é renderizado várias vezes na mesma página (header + footer,
// por exemplo) — sem isso, ids como "wave-path" colidiriam entre instâncias e o SVG
// de uma instância passaria a referenciar os defs de outra.
export default function VsLogo({ size = 40, className = '' }: VsLogoProps) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 1000"
      width={size}
      height={size}
      className={className}
      aria-label="VS Stage Pro"
    >
      <defs>
        {/* ===================================================== */}
        {/* FILTROS DE SOMBRA, BRILHO E REFRAÇÃO                  */}
        {/* ===================================================== */}

        <filter id={id('squircle-shadow')} x="-12%" y="-10%" width="124%" height="124%">
          <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#000000" floodOpacity={0.58} />
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#000000" floodOpacity={0.35} />
        </filter>

        <filter id={id('neon-glow-wide')} x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="38" />
        </filter>

        <filter id={id('neon-glow-mid')} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="14" />
        </filter>

        <filter id={id('tube-drop-shadow')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="11" />
        </filter>

        <filter id={id('core-soft')} x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur stdDeviation="4.2" />
        </filter>

        <filter id={id('spec-soft')} x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur stdDeviation="2" />
        </filter>

        <filter id={id('frost-refraction')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6.5" />
        </filter>

        <filter id={id('glass-drop-shadow')} x="-25%" y="-25%" width="155%" height="155%">
          <feDropShadow dx="4" dy="24" stdDeviation="19" floodColor="#000000" floodOpacity={0.68} />
          <feDropShadow dx="2" dy="8" stdDeviation="7" floodColor="#000000" floodOpacity={0.45} />
        </filter>

        <filter id={id('flare-blur')} x="-60%" y="-30%" width="220%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>

        {/* ===================================================== */}
        {/* GRADIENTES DA BASE SQUIRCLE                           */}
        {/* ===================================================== */}

        <linearGradient id={id('squircle-rim-grad')} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#4e515c" />
          <stop offset="8%" stopColor="#383a43" />
          <stop offset="90%" stopColor="#1b1c21" />
          <stop offset="100%" stopColor="#131418" />
        </linearGradient>

        <linearGradient id={id('squircle-face-grad')} x1="20%" y1="5%" x2="80%" y2="95%">
          <stop offset="0%" stopColor="#2d2f37" />
          <stop offset="50%" stopColor="#24252c" />
          <stop offset="100%" stopColor="#1b1c21" />
        </linearGradient>

        <radialGradient id={id('ambient-cyan')} cx="27%" cy="43%" r="34%">
          <stop offset="0%" stopColor="#00d9ff" stopOpacity={0.28} />
          <stop offset="55%" stopColor="#008cff" stopOpacity={0.09} />
          <stop offset="100%" stopColor="#008cff" stopOpacity={0} />
        </radialGradient>

        <radialGradient id={id('ambient-blue')} cx="56%" cy="63%" r="30%">
          <stop offset="0%" stopColor="#1c56ff" stopOpacity={0.22} />
          <stop offset="65%" stopColor="#1c56ff" stopOpacity={0.05} />
          <stop offset="100%" stopColor="#1c56ff" stopOpacity={0} />
        </radialGradient>

        <radialGradient id={id('ambient-orange')} cx="78%" cy="55%" r="28%">
          <stop offset="0%" stopColor="#ff7816" stopOpacity={0.27} />
          <stop offset="55%" stopColor="#ff5100" stopOpacity={0.08} />
          <stop offset="100%" stopColor="#ff5100" stopOpacity={0} />
        </radialGradient>

        {/* ===================================================== */}
        {/* GRADIENTES DO TUBO NEON 3D                            */}
        {/* ===================================================== */}

        <linearGradient id={id('tube-wall-grad')} x1="140" y1="450" x2="860" y2="550" gradientUnits="userSpaceOnUse">
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

        <linearGradient id={id('tube-core-grad')} x1="140" y1="450" x2="860" y2="550" gradientUnits="userSpaceOnUse">
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

        <linearGradient id={id('tube-spec-grad')} x1="140" y1="450" x2="860" y2="550" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
          <stop offset="18%" stopColor="#bff6ff" stopOpacity={0.88} />
          <stop offset="34%" stopColor="#8ad4ff" stopOpacity={0.78} />
          <stop offset="50%" stopColor="#5aa4ff" stopOpacity={0.58} />
          <stop offset="65%" stopColor="#5894ff" stopOpacity={0.62} />
          <stop offset="77%" stopColor="#a688cf" stopOpacity={0.52} />
          <stop offset="89%" stopColor="#ffb880" stopOpacity={0.85} />
          <stop offset="100%" stopColor="#ffebb3" stopOpacity={0.95} />
        </linearGradient>

        <radialGradient id={id('tip-cyan-glow')} cx="158" cy="496" r="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
          <stop offset="40%" stopColor="#8cfaff" stopOpacity={0.75} />
          <stop offset="100%" stopColor="#00d5ff" stopOpacity={0} />
        </radialGradient>

        <radialGradient id={id('tip-orange-glow')} cx="836" cy="490" r="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff0bd" stopOpacity={0.9} />
          <stop offset="45%" stopColor="#ff9e2c" stopOpacity={0.65} />
          <stop offset="100%" stopColor="#eb5a0f" stopOpacity={0} />
        </radialGradient>

        {/* ===================================================== */}
        {/* GRADIENTES DO BOTÃO PLAY DE VIDRO                     */}
        {/* ===================================================== */}

        <linearGradient id={id('glass-base-grad')} x1="347" y1="300" x2="690" y2="630" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#edf4fc" stopOpacity={0.58} />
          <stop offset="40%" stopColor="#cad5e2" stopOpacity={0.44} />
          <stop offset="75%" stopColor="#949eab" stopOpacity={0.36} />
          <stop offset="100%" stopColor="#bd968d" stopOpacity={0.44} />
        </linearGradient>

        <linearGradient id={id('glass-upper-sheen')} x1="347" y1="295" x2="565" y2="490" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.56} />
          <stop offset="55%" stopColor="#e4ecf7" stopOpacity={0.40} />
          <stop offset="100%" stopColor="#c8d4e3" stopOpacity={0.26} />
        </linearGradient>

        <linearGradient id={id('glass-lower-smoky')} x1="347" y1="510" x2="695" y2="660" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#525a66" stopOpacity={0.38} />
          <stop offset="55%" stopColor="#696f7a" stopOpacity={0.28} />
          <stop offset="100%" stopColor="#c48a78" stopOpacity={0.36} />
        </linearGradient>

        <radialGradient id={id('glass-right-warmth')} cx="695" cy="498" r="170" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff944d" stopOpacity={0.40} />
          <stop offset="50%" stopColor="#d97a64" stopOpacity={0.16} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>

        <linearGradient id={id('inner-bevel-grad')} x1="389" y1="360" x2="625" y2="610" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
          <stop offset="35%" stopColor="#6e7b8f" stopOpacity={0.42} />
          <stop offset="70%" stopColor="#9ab4d6" stopOpacity={0.48} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0.65} />
        </linearGradient>

        <linearGradient id={id('inner-rim-stroke')} x1="396" y1="365" x2="624" y2="590" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.82} />
          <stop offset="45%" stopColor="#96a5ba" stopOpacity={0.45} />
          <stop offset="80%" stopColor="#b8d8ff" stopOpacity={0.75} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0.88} />
        </linearGradient>

        <linearGradient id={id('outer-rim-stroke')} x1="347" y1="295" x2="706" y2="700" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
          <stop offset="35%" stopColor="#ffffff" stopOpacity={0.75} />
          <stop offset="70%" stopColor="#e0c5bc" stopOpacity={0.58} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0.85} />
        </linearGradient>

        {/* ===================================================== */}
        {/* GEOMETRIAS MESTRAS MATEMATICAMENTE EXATAS             */}
        {/* ===================================================== */}

        <path
          id={id('wave-path')}
          fill="none"
          d="
            M 154, 496
            C 176, 502, 206, 464, 248, 390
            C 290, 316, 326, 268, 366, 268
            C 408, 268, 435, 336, 468, 444
            C 501, 552, 528, 636, 560, 688
            C 576, 714, 590, 726, 606, 726
            C 638, 726, 676, 672, 724, 598
            C 766, 534, 804, 484, 842, 498
          "
        />

        <mask id={id('tube-mask')} maskUnits="userSpaceOnUse" x="100" y="200" width="800" height="600">
          <use href={`#${id('wave-path')}`} stroke="#ffffff" strokeWidth="44" strokeLinecap="round" />
        </mask>

        <path
          id={id('outer-triangle')}
          d="
            M 347, 318.44
            A 24, 24 0 0, 1 383, 297.66
            L 694, 477.22
            A 24, 24 0 0, 1 694, 518.78
            L 383, 698.34
            A 24, 24 0 0, 1 347, 677.56
            Z
          "
        />

        <path
          id={id('inner-bevel-ridge')}
          d="
            M 389, 368.67
            A 11, 11 0 0, 1 405.5, 359.14
            L 629.5, 488.47
            A 11, 11 0 0, 1 629.5, 507.53
            L 405.5, 636.86
            A 11, 11 0 0, 1 389, 627.33
            Z
          "
        />

        <path
          id={id('inner-hole')}
          d="
            M 396, 375.60
            A 8, 8 0 0, 1 408, 368.67
            L 620, 491.07
            A 8, 8 0 0, 1 620, 504.93
            L 408, 627.33
            A 8, 8 0 0, 1 396, 620.40
            Z
          "
        />

        <path
          id={id('glass-ring-shape')}
          fillRule="evenodd"
          clipRule="evenodd"
          d="
            M 347, 318.44
            A 24, 24 0 0, 1 383, 297.66
            L 694, 477.22
            A 24, 24 0 0, 1 694, 518.78
            L 383, 698.34
            A 24, 24 0 0, 1 347, 677.56
            Z
            M 396, 375.60
            L 396, 620.40
            A 8, 8 0 0, 0 408, 627.33
            L 620, 504.93
            A 8, 8 0 0, 0 620, 491.07
            L 408, 368.67
            A 8, 8 0 0, 0 396, 375.60
            Z
          "
        />

        <path
          id={id('inner-bevel-band')}
          fillRule="evenodd"
          d="
            M 389, 368.67
            A 11, 11 0 0, 1 405.5, 359.14
            L 629.5, 488.47
            A 11, 11 0 0, 1 629.5, 507.53
            L 405.5, 636.86
            A 11, 11 0 0, 1 389, 627.33
            Z
            M 396, 375.60
            L 396, 620.40
            A 8, 8 0 0, 0 408, 627.33
            L 620, 504.93
            A 8, 8 0 0, 0 620, 491.07
            L 408, 368.67
            A 8, 8 0 0, 0 396, 375.60
            Z
          "
        />

        <clipPath id={id('squircle-face-clip')}>
          <rect x="62" y="73" width="876" height="855" rx="214" ry="214" />
        </clipPath>

        <clipPath id={id('glass-clip')}>
          <use href={`#${id('glass-ring-shape')}`} />
        </clipPath>
      </defs>

      {/* ===================================================== */}
      {/* 1. BASE SQUIRCLE COM CHANFRO 3D                       */}
      {/* ===================================================== */}
      <g>
        <rect
          x="60" y="60" width="880" height="880" rx="218" ry="218"
          fill={`url(#${id('squircle-rim-grad')})`} filter={`url(#${id('squircle-shadow')})`}
        />

        <rect
          x="61" y="61" width="878" height="878" rx="217" ry="217"
          fill="none" stroke="#ffffff" strokeOpacity={0.16} strokeWidth="1.2"
        />

        <g clipPath={`url(#${id('squircle-face-clip')})`}>
          <rect x="62" y="73" width="876" height="855" fill={`url(#${id('squircle-face-grad')})`} />
          <rect x="62" y="73" width="876" height="855" fill={`url(#${id('ambient-cyan')})`} />
          <rect x="62" y="73" width="876" height="855" fill={`url(#${id('ambient-blue')})`} />
          <rect x="62" y="73" width="876" height="855" fill={`url(#${id('ambient-orange')})`} />
        </g>

        <rect
          x="62" y="73" width="876" height="855" rx="214" ry="214"
          fill="none" stroke="#ffffff" strokeOpacity={0.05} strokeWidth="1.2"
        />
      </g>

      {/* ===================================================== */}
      {/* 2. ONDA NEON ACRÍLICA 3D                              */}
      {/* ===================================================== */}
      <g>
        <use
          href={`#${id('wave-path')}`} transform="translate(8, 18)"
          stroke="#000000" strokeWidth="42" strokeLinecap="round"
          opacity={0.65} filter={`url(#${id('tube-drop-shadow')})`}
        />

        <use
          href={`#${id('wave-path')}`} stroke={`url(#${id('tube-wall-grad')})`} strokeWidth="72"
          strokeLinecap="round" opacity={0.42} filter={`url(#${id('neon-glow-wide')})`}
        />

        <use
          href={`#${id('wave-path')}`} stroke={`url(#${id('tube-wall-grad')})`} strokeWidth="48"
          strokeLinecap="round" opacity={0.65} filter={`url(#${id('neon-glow-mid')})`}
        />

        <g mask={`url(#${id('tube-mask')})`}>
          <use href={`#${id('wave-path')}`} stroke={`url(#${id('tube-wall-grad')})`} strokeWidth="44" strokeLinecap="round" />

          <use
            href={`#${id('wave-path')}`} transform="translate(0, 1.5)"
            stroke={`url(#${id('tube-core-grad')})`} strokeWidth="25"
            strokeLinecap="round" filter={`url(#${id('core-soft')})`}
          />

          <circle cx="158" cy="496" r="46" fill={`url(#${id('tip-cyan-glow')})`} />
          <circle cx="836" cy="490" r="42" fill={`url(#${id('tip-orange-glow')})`} />

          <use
            href={`#${id('wave-path')}`} transform="translate(0, 13)"
            stroke={`url(#${id('tube-wall-grad')})`} strokeWidth="6"
            strokeLinecap="round" filter={`url(#${id('spec-soft')})`} opacity={0.78}
          />

          <use
            href={`#${id('wave-path')}`} transform="translate(-1.5, -12)"
            stroke={`url(#${id('tube-spec-grad')})`} strokeWidth="8"
            strokeLinecap="round" filter={`url(#${id('spec-soft')})`} opacity={0.92}
          />

          <use
            href={`#${id('wave-path')}`} transform="translate(-2, -14.5)"
            stroke="#ffffff" strokeWidth="2"
            strokeLinecap="round" opacity={0.60}
          />
        </g>
      </g>

      {/* ===================================================== */}
      {/* 3. BOTÃO PLAY EM VIDRO FOSCO (GLASSMORPHISM)          */}
      {/* ===================================================== */}
      <g>
        <use href={`#${id('glass-ring-shape')}`} fill="#000000" filter={`url(#${id('glass-drop-shadow')})`} />

        <g clipPath={`url(#${id('glass-clip')})`}>
          <rect x="335" y="285" width="380" height="430" fill={`url(#${id('glass-base-grad')})`} />

          <g filter={`url(#${id('frost-refraction')})`} opacity={0.84}>
            <use href={`#${id('wave-path')}`} stroke="#09235c" strokeWidth="50" strokeLinecap="round" />
            <use href={`#${id('wave-path')}`} stroke={`url(#${id('tube-wall-grad')})`} strokeWidth="34" strokeLinecap="round" />
            <use
              href={`#${id('wave-path')}`} transform="translate(-1.5, -10)"
              stroke="#9ee0ff" strokeWidth="9" strokeLinecap="round"
            />
          </g>

          <rect x="335" y="285" width="380" height="430" fill={`url(#${id('glass-right-warmth')})`} />

          <polygon
            points="340,549.7 396,512 546,444 584,412 720,412 720,715 340,715"
            fill={`url(#${id('glass-lower-smoky')})`}
          />

          <polygon
            points="340,285 720,285 584,412 546,444 396,512 340,549.7"
            fill={`url(#${id('glass-upper-sheen')})`}
          />

          <path
            d="M 345, 546.3 L 396, 512 M 546, 444 L 584, 412"
            stroke="#ffffff" strokeWidth="1.4" strokeOpacity={0.42} fill="none"
          />

          <use href={`#${id('inner-bevel-band')}`} fill={`url(#${id('inner-bevel-grad')})`} />

          <line
            x1="391" y1="368" x2="391" y2="628"
            stroke="#ffffff" strokeWidth="2" strokeOpacity={0.45} filter={`url(#${id('spec-soft')})`}
          />

          <use
            href={`#${id('outer-triangle')}`} fill="none" stroke="#ffffff"
            strokeWidth="10" strokeOpacity={0.18} filter={`url(#${id('spec-soft')})`}
          />
        </g>

        <use href={`#${id('inner-bevel-ridge')}`} fill="none" stroke="#ffffff" strokeOpacity={0.34} strokeWidth="1.2" />

        <use href={`#${id('inner-hole')}`} fill="none" stroke={`url(#${id('inner-rim-stroke')})`} strokeWidth="2.2" />

        <use href={`#${id('outer-triangle')}`} fill="none" stroke={`url(#${id('outer-rim-stroke')})`} strokeWidth="2.4" />

        <path
          d="M 347, 352 L 347, 318.44 A 24, 24 0 0, 1 383, 297.66 L 432, 325.95"
          fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" opacity={0.92}
        />

        <path
          d="M 347, 646 L 347, 677.56 A 24, 24 0 0, 0 383, 698.34 L 418, 678.13"
          fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity={0.88}
        />

        <ellipse cx="348" cy="462" rx="3.5" ry="44" fill="#ffffff" opacity={0.82} filter={`url(#${id('flare-blur')})`} />
        <line x1="347" y1="412" x2="347" y2="514" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
