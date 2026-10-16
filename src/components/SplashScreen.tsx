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
        className="splash-card w-full max-w-[646px] aspect-[16/9] rounded-[24px] overflow-hidden flex flex-col items-center justify-between p-8 relative"
        style={{
          background: 'radial-gradient(ellipse at 50% 30%, rgba(38, 40, 48, 0.8) 0%, rgba(10, 11, 14, 0.95) 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.15), 0 40px 90px -20px rgba(0,0,0,0.9), 0 0 60px -10px rgba(255,159,10,0.18)',
          transform: leaving ? 'scale(1.03)' : 'scale(1)',
          transition: `transform ${EXIT_MS}ms ease`,
        }}
      >
        {/* Halo neon de fundo da logo */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-gradient-to-tr from-amber-500/20 via-orange-600/15 to-transparent blur-3xl pointer-events-none animate-pulse" />

        {/* Logo Oficial Animada */}
        <div className="relative z-10 flex flex-col items-center mt-3">
          <div className="relative group">
            <div className="absolute -inset-2 bg-gradient-to-r from-amber-500 to-orange-600 rounded-3xl blur-xl opacity-40 group-hover:opacity-75 transition duration-1000 animate-pulse" />
            <img
              src="/vs-stage-icon.png"
              alt="VS Stage Pro"
              className="relative w-32 h-32 rounded-[24px] object-contain shadow-2xl drop-shadow-[0_12px_32px_rgba(255,159,10,0.45)] transform transition-transform duration-700 hover:scale-105 animate-[pop_900ms_cubic-bezier(0.22,1,0.36,1)_both]"
              draggable={false}
            />
          </div>

          {/* Tipografia Estilizada VS STAGE */}
          <div className="mt-5 text-center">
            <h1 className="text-3xl font-black tracking-[0.22em] text-white flex items-center justify-center gap-2 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] font-['Montserrat',sans-serif]">
              <span className="bg-gradient-to-r from-[#e5a882] via-[#d48b62] to-[#b86f48] bg-clip-text text-transparent">VS</span>
              <span className="bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">STAGE</span>
            </h1>
            <p className="text-[10px] font-bold tracking-[0.35em] text-zinc-400 uppercase mt-1 drop-shadow">
              MOTOR DE PERFORMANCE AO VIVO
            </p>
          </div>
        </div>

        {/* Barra de Progresso e Status em Neon Âmbar */}
        <div className="w-full max-w-sm flex flex-col items-center gap-2 z-10">
          <span className="text-xs text-zinc-300 font-medium tracking-wide">
            {current.text}
          </span>
          <div className="w-full h-1.5 rounded-full bg-black/60 border border-white/10 p-[1px] overflow-hidden shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400 shadow-[0_0_12px_rgba(255,159,10,0.8)] transition-all duration-700 ease-out"
              style={{ width: `${current.progress * 100}%` }}
            />
          </div>
        </div>

        {/* Rodapé da Splash */}
        <div className="w-full flex items-center justify-between text-[11px] font-medium text-zinc-500 z-10 pt-1 border-t border-white/[0.04]">
          <span>© 2026 VS Stage</span>
          <span className="text-amber-500 font-bold tracking-wider">v{__APP_VERSION__} PRO</span>
        </div>
      </div>
    </div>
  );
}
