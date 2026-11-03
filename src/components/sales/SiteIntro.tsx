import { useCallback, useEffect, useRef, useState } from 'react';
import VsLogo from '@/components/VsLogo';
import SegmentDisplay from '@/components/SegmentDisplay';

// Abertura do site: a onda neon da logo se desenha, o botão de play de vidro aparece por cima e,
// embaixo, um display de LED faz a contagem "1, 2, 3, 4", como o click antes do show começar.
// No "4" a cena avança na direção de quem está vendo e revela a página.
// Toca uma vez por visita; qualquer tecla, toque, rolagem ou o botão "Pular abertura" encerra.

// Mesma geometria da logo oficial (src/components/VsLogo.tsx)
const WAVE = 'M 154 496 C 176 502 206 464 248 390 C 290 316 326 268 366 268 C 408 268 435 336 468 444 C 501 552 528 636 560 688 C 576 714 590 726 606 726 C 638 726 676 672 724 598 C 766 534 804 484 842 498';
const TRIANGLE = 'M 347 318.44 A 24 24 0 0 1 383 297.66 L 694 477.22 A 24 24 0 0 1 694 518.78 L 383 698.34 A 24 24 0 0 1 347 677.56 Z';

const BEAT_MS = 400; // 150 BPM
const FIRST_BEAT_MS = 450;
const REVEAL_MS = FIRST_BEAT_MS + BEAT_MS * 4 + 120;
const END_MS = REVEAL_MS + 750;

export default function SiteIntro({ onReveal, onDone }: { onReveal: () => void; onDone: () => void }) {
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);
  const revealed = useRef(false);
  // guardados em ref: a abertura não recomeça se a página redesenhar com funções novas
  const cbs = useRef({ onReveal, onDone });
  cbs.current = { onReveal, onDone };

  const reveal = useCallback(() => {
    if (revealed.current) return;
    revealed.current = true;
    setLeaving(true);
    cbs.current.onReveal();
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    reveal();
    window.setTimeout(() => cbs.current.onDone(), 520);
  }, [reveal]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('vs-intro-lock');
    const timers = [1, 2, 3, 4].map((n) => window.setTimeout(() => setBeat(n), FIRST_BEAT_MS + BEAT_MS * (n - 1)));
    timers.push(window.setTimeout(reveal, REVEAL_MS));
    timers.push(window.setTimeout(() => { if (!finished.current) { finished.current = true; cbs.current.onDone(); } }, END_MS));
    const skip = () => finish();
    window.addEventListener('keydown', skip);
    window.addEventListener('wheel', skip, { passive: true });
    window.addEventListener('touchstart', skip, { passive: true });
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('keydown', skip);
      window.removeEventListener('wheel', skip);
      window.removeEventListener('touchstart', skip);
      root.classList.remove('vs-intro-lock');
    };
  }, [reveal, finish]);

  return (
    <div className={`vs-intro${leaving ? ' is-leaving' : ''}`} onClick={finish}>
      <div className="vs-intro-stage" aria-hidden="true">
        <div className="vs-intro-logo">
          <svg viewBox="0 0 1000 1000" className="vs-intro-draw">
            <defs>
              <linearGradient id="vs-intro-tube" x1="140" y1="450" x2="860" y2="550" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#76f7ff" />
                <stop offset="26%" stopColor="#22a6ff" />
                <stop offset="54%" stopColor="#1d56d4" />
                <stop offset="75%" stopColor="#6b56aa" />
                <stop offset="92%" stopColor="#ff7e24" />
                <stop offset="100%" stopColor="#ffa02c" />
              </linearGradient>
              <linearGradient id="vs-intro-base" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3a3d46" />
                <stop offset="100%" stopColor="#15161a" />
              </linearGradient>
              <filter id="vs-intro-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="22" />
              </filter>
            </defs>
            <rect className="vs-intro-base" x="60" y="60" width="880" height="880" rx="218" fill="url(#vs-intro-base)" />
            <path className="vs-intro-wave vs-intro-wave-glow" d={WAVE} pathLength={1} stroke="url(#vs-intro-tube)" filter="url(#vs-intro-glow)" />
            <path className="vs-intro-wave" d={WAVE} pathLength={1} stroke="url(#vs-intro-tube)" />
            <path className="vs-intro-tri" d={TRIANGLE} pathLength={1} />
          </svg>
          <div className="vs-intro-final"><VsLogo size={1000} className="w-full h-full" /></div>
          {beat > 0 && <span key={beat} className="vs-intro-ring" />}
        </div>

        <div className="vs-intro-count">
          <div className="vs-intro-leds">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={`vs-led ${beat >= n ? (n === 4 ? 'is-green' : 'is-amber') : ''}`} />
            ))}
          </div>
          <SegmentDisplay text={beat ? String(beat) : ' '} className={`vs-intro-digit ${beat === 4 ? 'text-[#3ee26e]' : 'text-[#ffab1f]'}`} label="Contagem" />
        </div>

        <p className="vs-intro-word font-stage">VS Stage Pro</p>
      </div>

      <button type="button" className="vs-intro-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>
        Pular abertura
      </button>
    </div>
  );
}
