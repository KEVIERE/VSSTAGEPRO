interface VsLogoProps {
  size?: number;
  className?: string;
}

export default function VsLogo({ size = 40, className = '' }: VsLogoProps) {
  return (
    <svg
      viewBox="0 0 320 320"
      width={size}
      height={size}
      aria-label="VS Stage Pro"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="vsLogoAppBase" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#24262c" />
          <stop offset="100%" stopColor="#0d0e12" />
        </linearGradient>

        <radialGradient id="vsLogoSphereGrad" cx="45%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#555861" />
          <stop offset="35%" stopColor="#15171c" />
          <stop offset="85%" stopColor="#000000" />
          <stop offset="100%" stopColor="#030303" />
        </radialGradient>

        <filter id="vsNeonOrange" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="blur1" />
          <feGaussianBlur stdDeviation="7" result="blur2" />
          <feMerge>
            <feMergeNode in="blur2" />
            <feMergeNode in="blur1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="vsNeonGreen" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="blur1" />
          <feGaussianBlur stdDeviation="7" result="blur2" />
          <feMerge>
            <feMergeNode in="blur2" />
            <feMergeNode in="blur1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="vsPlayShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="3" floodColor="#000000" floodOpacity="0.8" />
        </filter>

        <clipPath id="vsSquircleClip">
          <rect x="-110" y="-110" width="220" height="220" rx="55" />
        </clipPath>
      </defs>

      <g transform="translate(160, 160)">
        <rect
          x="-110"
          y="-110"
          width="220"
          height="220"
          rx="55"
          fill="url(#vsLogoAppBase)"
          stroke="#2f323c"
          strokeWidth="1.5"
        />

        <g clipPath="url(#vsSquircleClip)" opacity="0.26">
          <line x1="-80" y1="-110" x2="-80" y2="110" stroke="#ffffff" strokeWidth="0.8" opacity="0.3" strokeDasharray="3 3" />
          <line x1="-35" y1="-110" x2="-35" y2="110" stroke="#ffffff" strokeWidth="0.8" opacity="0.4" />
          <line x1="10" y1="-110" x2="10" y2="110" stroke="#ffffff" strokeWidth="0.8" opacity="0.3" strokeDasharray="3 3" />
          <line x1="55" y1="-110" x2="55" y2="110" stroke="#ffffff" strokeWidth="0.8" opacity="0.4" />

          <rect x="-110" y="-85" width="220" height="34" fill="#ff9f0a" opacity="0.08" />
          <line x1="-110" y1="-51" x2="110" y2="-51" stroke="#ffffff" strokeWidth="0.8" opacity="0.2" />
          <rect x="-70" y="-80" width="110" height="24" rx="4" fill="#ff9f0a" opacity="0.35" />
          <polyline points="-65,-68 -55,-64 -45,-72 -35,-65 -25,-68 -15,-62 -5,-70 5,-66 15,-71 25,-67" fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.75" />

          <rect x="-110" y="-51" width="220" height="48" fill="#000000" opacity="0.25" />
          <line x1="-110" y1="-3" x2="110" y2="-3" stroke="#ffffff" strokeWidth="0.8" opacity="0.2" />
          <rect x="-100" y="-45" width="85" height="36" rx="5" fill="#38bdf8" opacity="0.35" />
          <polyline points="-95,-27 -85,-18 -75,-35 -65,-22 -55,-30 -45,-25 -35,-32 -25,-27" fill="none" stroke="#e0f2fe" strokeWidth="1.5" opacity="0.8" />
          <rect x="0" y="-45" width="95" height="36" rx="5" fill="#c084fc" opacity="0.35" />
          <polyline points="5,-27 15,-18 25,-34 35,-20 45,-32 55,-24 65,-30 75,-27" fill="none" stroke="#f3e8ff" strokeWidth="1.5" opacity="0.8" />

          <rect x="-110" y="-3" width="220" height="48" fill="#22c55e" opacity="0.06" />
          <line x1="-110" y1="45" x2="110" y2="45" stroke="#ffffff" strokeWidth="0.8" opacity="0.2" />
          <rect x="-60" y="5" width="130" height="34" rx="5" fill="#4ade80" opacity="0.3" />
          <polyline points="-55,22 -45,15 -35,28 -25,18 -15,26 -5,20 5,27 15,19 25,24 35,20 45,26 55,22" fill="none" stroke="#dcfce7" strokeWidth="1.3" opacity="0.7" />
        </g>

        <g transform="rotate(22)">
          <ellipse cx="0" cy="0" rx="90" ry="22" fill="none" stroke="#9a3412" strokeWidth="1.5" opacity="0.4" />
        </g>
        <g transform="rotate(-18)">
          <ellipse cx="0" cy="0" rx="110" ry="28" fill="none" stroke="#14532d" strokeWidth="1.5" opacity="0.4" />
        </g>

        <circle cx="0" cy="0" r="55" fill="url(#vsLogoSphereGrad)" />
        <path d="M -45 -15 A 50 50 0 0 1 45 -15 Q 0 10 -45 -15" fill="#ffffff" opacity="0.08" />
        <path d="M -35 40 A 45 45 0 0 0 35 40 Q 0 30 -35 40" fill="#4ade80" opacity="0.08" />

        <g transform="rotate(22)">
          <path d="M -90 0 A 90 22 0 0 0 90 0" fill="none" stroke="#f59e0b" strokeWidth="3.5" filter="url(#vsNeonOrange)" strokeLinecap="round" />
          <path d="M -90 0 A 90 22 0 0 0 90 0" fill="none" stroke="#fde68a" strokeWidth="1.2" strokeLinecap="round" opacity="0.95" />
        </g>

        <g transform="rotate(-18)">
          <path d="M -110 0 A 110 28 0 0 0 110 0" fill="none" stroke="#22c55e" strokeWidth="3.5" filter="url(#vsNeonGreen)" strokeLinecap="round" />
          <path d="M -110 0 A 110 28 0 0 0 110 0" fill="none" stroke="#bbf7d0" strokeWidth="1.5" strokeLinecap="round" opacity="0.95" />
        </g>

        <polygon points="-8,-16 18,0 -8,16" fill="#ffffff" filter="url(#vsPlayShadow)" stroke="#ffffff" strokeWidth="1" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
