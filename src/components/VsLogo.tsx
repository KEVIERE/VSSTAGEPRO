interface VsLogoProps {
  size?: number;
  className?: string;
}

export default function VsLogo({ size = 40, className = '' }: VsLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={className}
      aria-label="VS Stage Pro"
      fill="none"
    >
      <defs>
        {/* Fundo Squircle VS STAGE PRO */}
        <linearGradient id="stageBg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1C1D22" />
          <stop offset="100%" stopColor="#0E0F12" />
        </linearGradient>

        <linearGradient id="stageBorder" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#363942" />
          <stop offset="100%" stopColor="#16171B" />
        </linearGradient>

        {/* Gradiente da Onda (Verde Waveform -> Azul Track -> Âmbar LTC) */}
        <linearGradient id="waveGrad" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="28%" stopColor="#10B981" />
          <stop offset="55%" stopColor="#3B82F6" />
          <stop offset="78%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>

        {/* Gradiente do Triângulo Play (Estilo Botão Transporte / Vidro Escuro) */}
        <linearGradient id="playFill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.22} />
          <stop offset="50%" stopColor="#272932" stopOpacity={0.78} />
          <stop offset="100%" stopColor="#121318" stopOpacity={0.92} />
        </linearGradient>

        <linearGradient id="playStroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.95} />
          <stop offset="60%" stopColor="#A1A1AA" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.85} />
        </linearGradient>

        <filter id="waveGlow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="20" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="playDropShadow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="24" stdDeviation="20" floodColor="#000000" floodOpacity={0.8} />
        </filter>
      </defs>

      {/* Base Squircle */}
      <rect x="32" y="32" width="960" height="960" rx="216" ry="216" fill="url(#stageBg)" stroke="url(#stageBorder)" strokeWidth="10" />

      {/* Linhas Verticais Subtis da Timeline (Compasso) */}
      <g stroke="#FFFFFF" strokeOpacity={0.035} strokeWidth="2">
        <line x1="212" y1="80" x2="212" y2="944" />
        <line x1="362" y1="80" x2="362" y2="944" />
        <line x1="512" y1="80" x2="512" y2="944" />
        <line x1="662" y1="80" x2="662" y2="944" />
        <line x1="812" y1="80" x2="812" y2="944" />
      </g>

      {/* Marcador de Playhead (Estilo Cursor Laranja LTC da Timeline) */}
      <line x1="382" y1="140" x2="382" y2="884" stroke="#F59E0B" strokeWidth="3" strokeOpacity={0.35} strokeDasharray="8 8" />

      {/* Onda Sonora Principal (Verde Guia/Click -> Âmbar LTC/Master) */}
      <path
        d="M 164 512 C 230 512, 285 268, 368 268 C 455 268, 555 756, 648 756 C 732 756, 785 512, 860 512"
        fill="none"
        stroke="url(#waveGrad)"
        strokeWidth="54"
        strokeLinecap="round"
        filter="url(#waveGlow)"
      />

      {/* Núcleo Luminoso da Onda */}
      <path
        d="M 164 512 C 230 512, 285 268, 368 268 C 455 268, 555 756, 648 756 C 732 756, 785 512, 860 512"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="10"
        strokeLinecap="round"
        opacity={0.45}
      />

      {/* Triângulo PLAY Central em Vidro Escuro / Metal Escovado */}
      <g filter="url(#playDropShadow)">
        <path
          d="M 382 324 C 382 298, 410 282, 432 295 L 704 459 C 726 472, 726 504, 704 517 L 432 681 C 410 694, 382 678, 382 652 Z"
          fill="url(#playFill)"
          stroke="url(#playStroke)"
          strokeWidth="28"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
