import { useCallback, useEffect, useRef, useState } from 'react';

const STEPS = [
  { at: 0, progress: 0.18, text: 'Carregando motor de áudio...' },
  { at: 750, progress: 0.52, text: 'Preparando timecode e periféricos...' },
  { at: 1500, progress: 0.84, text: 'Abrindo o show...' },
  { at: 2100, progress: 1, text: 'Pronto' },
];
const EXIT_AT = 2500;
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
          <linearGradient id="spLogoBase" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#22242a" />
            <stop offset="100%" stopColor="#0f1013" />
          </linearGradient>
          <radialGradient id="spSphere" cx="45%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#555861" />
            <stop offset="35%" stopColor="#15171c" />
            <stop offset="85%" stopColor="#000000" />
            <stop offset="100%" stopColor="#030303" />
          </radialGradient>
          <filter id="spNeon" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="b1" />
            <feGaussianBlur stdDeviation="7" result="b2" />
            <feMerge>
              <feMergeNode in="b2" />
              <feMergeNode in="b1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="spShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.9" />
          </filter>
          <filter id="spPlayShadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.8" />
          </filter>
          <filter id="spBarGlow" x="-20%" y="-200%" width="140%" height="500%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#4ade80" floodOpacity="0.6" />
          </filter>
        </defs>

        <g transform="translate(400, 160)">
          <g className="splash-pop">
            <rect x="-110" y="-110" width="220" height="220" rx="55" fill="url(#spLogoBase)" stroke="#2c2f38" strokeWidth="1" filter="url(#spShadow)" />

            <g className="splash-fade" style={{ animationDelay: '350ms' }}>
              <ellipse transform="rotate(22)" rx="90" ry="22" fill="none" stroke="#9a3412" strokeWidth="1.5" opacity="0.4" />
              <ellipse transform="rotate(-18)" rx="110" ry="28" fill="none" stroke="#14532d" strokeWidth="1.5" opacity="0.4" />
            </g>

            <circle r="55" fill="url(#spSphere)" filter="url(#spShadow)" />
            <path d="M -45 -15 A 50 50 0 0 1 45 -15 Q 0 10 -45 -15" fill="#fff" opacity="0.07" />
            <path d="M -35 40 A 45 45 0 0 0 35 40 Q 0 30 -35 40" fill="#4ade80" opacity="0.08" />

            <g transform="rotate(22)">
              <g className="splash-breathe" style={{ animationDelay: '1300ms' }}>
                <path className="splash-draw" style={{ animationDelay: '450ms' }} pathLength={1} d="M -90 0 A 90 22 0 0 0 90 0" fill="none" stroke="#f59e0b" strokeWidth="3.5" filter="url(#spNeon)" strokeLinecap="round" />
                <path className="splash-draw" style={{ animationDelay: '450ms' }} pathLength={1} d="M -90 0 A 90 22 0 0 0 90 0" fill="none" stroke="#fde68a" strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
              </g>
            </g>
            <g transform="rotate(-18)">
              <g className="splash-breathe" style={{ animationDelay: '1700ms' }}>
                <path className="splash-draw splash-draw-rev" style={{ animationDelay: '600ms' }} pathLength={1} d="M -110 0 A 110 28 0 0 0 110 0" fill="none" stroke="#22c55e" strokeWidth="3.5" filter="url(#spNeon)" strokeLinecap="round" />
                <path className="splash-draw splash-draw-rev" style={{ animationDelay: '600ms' }} pathLength={1} d="M -110 0 A 110 28 0 0 0 110 0" fill="none" stroke="#bbf7d0" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
              </g>
            </g>

            <polygon className="splash-play" points="-8,-16 18,0 -8,16" fill="#fff" stroke="#fff" strokeWidth="1" strokeLinejoin="round" filter="url(#spPlayShadow)" />
          </g>
        </g>

        <text x="400" y="325" textAnchor="middle" fontFamily={FONT} fontSize="28" fontWeight="800" fill="#fff" letterSpacing="4">
          {TITLE.split('').map((ch, i) => (
            <tspan key={i} className="splash-letter" style={{ animationDelay: `${900 + i * 55}ms` }}>{ch}</tspan>
          ))}
        </text>
        <text className="splash-rise" style={{ animationDelay: '1400ms' }} x="400" y="348" textAnchor="middle" fontFamily={FONT} fontSize="11" fontWeight="600" fill="#6b7280" letterSpacing="3">
          MOTOR DE PERFORMANCE AO VIVO
        </text>

        <g className="splash-fade" style={{ animationDelay: '500ms' }}>
          <text key={step} className="splash-status" x="400" y="380" textAnchor="middle" fontFamily={FONT} fontSize="11" fill="#8b929e">
            {current.text}
          </text>
          <g transform="translate(250, 395)">
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
