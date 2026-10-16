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
          <linearGradient id="stageBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1C1D22" />
            <stop offset="100%" stopColor="#0E0F12" />
          </linearGradient>

          <linearGradient id="stageBorder" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#363942" />
            <stop offset="100%" stopColor="#16171B" />
          </linearGradient>

          <linearGradient id="waveGrad" x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#4ADE80" />
            <stop offset="28%" stopColor="#10B981" />
            <stop offset="55%" stopColor="#3B82F6" />
            <stop offset="78%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#EA580C" />
          </linearGradient>

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

        <svg x="310" y="38" width="180" height="180" viewBox="0 0 1024 1024" className="splash-logo-pop overflow-visible">
          {/* Base Squircle */}
          <rect x="32" y="32" width="960" height="960" rx="216" ry="216" fill="url(#stageBg)" stroke="url(#stageBorder)" strokeWidth="10" />

          {/* Linhas Verticais Subtis da Timeline */}
          <g className="splash-timeline-grid" stroke="#FFFFFF" strokeOpacity={0.035} strokeWidth="2">
            <line x1="212" y1="80" x2="212" y2="944" />
            <line x1="362" y1="80" x2="362" y2="944" />
            <line x1="512" y1="80" x2="512" y2="944" />
            <line x1="662" y1="80" x2="662" y2="944" />
            <line x1="812" y1="80" x2="812" y2="944" />
          </g>

          {/* Marcador de Playhead */}
          <line className="splash-playhead-sweep" x1="382" y1="140" x2="382" y2="884" stroke="#F59E0B" strokeWidth="3" strokeOpacity={0.4} strokeDasharray="8 8" />

          {/* Onda Sonora Principal com Desenho Laser Dinâmico */}
          <path
            className="splash-wave-draw"
            pathLength={1}
            d="M 164 512 C 230 512, 285 268, 368 268 C 455 268, 555 756, 648 756 C 732 756, 785 512, 860 512"
            fill="none"
            stroke="url(#waveGrad)"
            strokeWidth="56"
            strokeLinecap="round"
            filter="url(#waveGlow)"
          />

          {/* Núcleo Luminoso da Onda */}
          <path
            className="splash-wave-core-draw"
            pathLength={1}
            d="M 164 512 C 230 512, 285 268, 368 268 C 455 268, 555 756, 648 756 C 732 756, 785 512, 860 512"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="11"
            strokeLinecap="round"
            opacity={0.55}
          />

          {/* Triângulo PLAY Central com Efeito Mola Elástica */}
          <g className="splash-play-pop" filter="url(#playDropShadow)">
            <path
              d="M 382 324 C 382 298, 410 282, 432 295 L 704 459 C 726 472, 726 504, 704 517 L 432 681 C 410 694, 382 678, 382 652 Z"
              fill="url(#playFill)"
              stroke="url(#playStroke)"
              strokeWidth="28"
              strokeLinejoin="round"
            />
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
