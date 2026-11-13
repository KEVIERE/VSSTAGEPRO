import { beginHistoryGesture, endHistoryGesture, historyGestureStep } from '@/lib/historyGesture';
import { volumeToDb } from '@/lib/audioEngine';
import { gainToFader } from '@/lib/faderScale';
import { useSkin } from '@/lib/useSkin';

type CapTone = 'cue' | 'band';
// nomes escritos por inteiro para o Tailwind não descartar as classes no build
const CAP_CLASS: Record<CapTone, string> = {
  cue: 'console-cap--cue',
  band: 'console-cap--band',
};

// Marcas impressas, as mesmas do fader do mixer: −∞, −12, −6, 0 (mais clara), +6, +12
const MARK_DB = [-Infinity, -12, -6, 0, 6, 12];
const CAP_W = 9;

/**
 * Fader de mesa deitado, pequeno, para a faixa mãe da coluna da timeline. Mesmo curso do fader
 * do mixer (0 dB = 0,8; máximo 1,5) e mesma capa: grafite para os grupos da banda, branca para
 * guia, click e maestro. Relativo como no mixer: clicar não pula o volume, ele só anda o quanto
 * o mouse arrasta. Shift: ajuste fino. Duplo clique: 0 dB.
 */
export default function MiniFader({ value, onChange, onReset, width, height = 14, tone = 'band' }: {
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
  width: number;
  height?: number;
  tone?: CapTone;
}) {
  const estudio = useSkin() === 'estudio';
  const travel = width - CAP_W;
  const pct = Math.max(0, Math.min(1, value / 1.5));
  const markX = (db: number) => (gainToFader(db === -Infinity ? 0 : Math.pow(10, db / 20)) / 1.5) * travel + CAP_W / 2;

  const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let lastX = e.clientX;
    let acc = value;
    beginHistoryGesture();

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      acc += (dx / travel) * 1.5 * (ev.shiftKey ? 0.1 : 1);
      acc = Math.max(0, Math.min(1.5, acc));
      onChange(Math.round(acc * 1000) / 1000);
      historyGestureStep();
    };
    const up = () => {
      endHistoryGesture();
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const db = volumeToDb(value);
  const dbLabel = db === -Infinity ? '-∞' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;

  if (estudio) {
    // Estúdio: trilho fino com o volume pintado de verde e a bolinha cinza, como nas DAWs do Mac
    const x = pct * travel + CAP_W / 2;
    return (
      <div
        className="es-hslider relative shrink-0 cursor-ew-resize select-none"
        style={{ width: `${width}px`, height: `${height}px`, touchAction: 'none' }}
        onPointerDown={handleDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); onReset(); }}
        title={`Volume: ${dbLabel} dB. Arraste para os lados (Shift: ajuste fino). Duplo clique: 0 dB.`}
      >
        <div className="es-hslider-track" style={{ left: `${CAP_W / 2}px`, right: `${CAP_W / 2}px` }} />
        <div className="es-hslider-fill" style={{ left: `${CAP_W / 2}px`, width: `${Math.max(0, x - CAP_W / 2)}px` }} />
        <div className="es-hslider-thumb" style={{ left: `${x}px` }} />
      </div>
    );
  }

  return (
    <div
      className="relative shrink-0 cursor-ew-resize select-none"
      style={{ width: `${width}px`, height: `${height}px`, touchAction: 'none' }}
      onPointerDown={handleDown}
        onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); onReset(); }}
      title={`Volume: ${dbLabel} dB. Arraste para os lados (Shift: ajuste fino). Duplo clique: 0 dB.`}
    >
      {MARK_DB.map((m) => (
        <div
          key={m}
          className="absolute top-0 bottom-0 w-px pointer-events-none"
          style={{
            left: `${markX(m)}px`,
            background: `linear-gradient(to bottom, rgba(231, 226, 214, ${m === 0 ? 0.8 : 0.32}) 0 3px, transparent 3px calc(100% - 3px), rgba(231, 226, 214, ${m === 0 ? 0.8 : 0.32}) calc(100% - 3px))`,
          }}
        />
      ))}
      <div
        className="console-slot is-horizontal absolute top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ left: `${CAP_W / 2 - 2}px`, right: `${CAP_W / 2 - 2}px` }}
      />
      <div
        className={`console-cap is-horizontal ${CAP_CLASS[tone]} absolute top-0 bottom-0 pointer-events-none`}
        style={{ width: `${CAP_W}px`, left: `${pct * travel}px` }}
      />
    </div>
  );
}
