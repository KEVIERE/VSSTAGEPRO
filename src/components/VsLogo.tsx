interface VsLogoProps {
  size?: number;
}

export default function VsLogo({ size = 40 }: VsLogoProps) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="VS Stage">
      <defs>
        <linearGradient id="vsLogoBase" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#22242a" />
          <stop offset="100%" stopColor="#0f1013" />
        </linearGradient>
        <radialGradient id="vsLogoSphere" cx="45%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#555861" />
          <stop offset="35%" stopColor="#15171c" />
          <stop offset="85%" stopColor="#000" />
          <stop offset="100%" stopColor="#030303" />
        </radialGradient>
        <filter id="vsLogoNeon" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.8" result="b1" />
          <feGaussianBlur stdDeviation="3.5" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="1" y="1" width="98" height="98" rx="24" fill="url(#vsLogoBase)" stroke="#2c2f38" strokeWidth="1" />
      <ellipse transform="rotate(22 50 50)" cx="50" cy="50" rx="41" ry="10" fill="none" stroke="#9a3412" strokeWidth="0.8" opacity="0.35" />
      <ellipse transform="rotate(-18 50 50)" cx="50" cy="50" rx="48" ry="12" fill="none" stroke="#14532d" strokeWidth="0.8" opacity="0.35" />
      <circle cx="50" cy="50" r="25" fill="url(#vsLogoSphere)" />
      <path d="M 30 43 A 23 23 0 0 1 70 43 Q 50 52 30 43" fill="#fff" opacity="0.07" />
      <g transform="rotate(22 50 50)">
        <path d="M 9 50 A 41 10 0 0 0 91 50" fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" filter="url(#vsLogoNeon)" />
      </g>
      <g transform="rotate(-18 50 50)">
        <path d="M 2 50 A 48 12 0 0 0 98 50" fill="none" stroke="#22c55e" strokeWidth="1.8" strokeLinecap="round" filter="url(#vsLogoNeon)" />
      </g>
      <polygon points="46,42 59,50 46,58" fill="#fff" strokeLinejoin="round" />
    </svg>
  );
}
