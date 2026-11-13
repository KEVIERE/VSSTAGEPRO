// Marca do VS Stage na sobra esquerda do mixer (skin padrão), como num equipamento de verdade:
// com espaço, uma placa de alumínio escovado rebitada no chassi, com a onda, o play e o nome
// gravados a laser; com pouco espaço, só a onda e o play gravados direto no chassi.
// Usa as geometrias da logo oficial (VsLogo), sem o quadrado.
import { VS_PLAY_D, VS_WAVE_D } from '@/components/VsLogo';

/** Onda e play gravados: o traço afundado, com a quina de sombra em cima e a de luz embaixo. */
export function BrandMark({ className = '' }: { className?: string }) {
  const shapes = (
    <>
      <path d={VS_PLAY_D} fill="none" strokeWidth="26" strokeLinejoin="round" />
      <path d={VS_WAVE_D} fill="none" strokeWidth="40" strokeLinecap="round" />
    </>
  );
  return (
    <svg viewBox="120 240 760 520" className={`vs-brand-mark ${className}`} aria-hidden="true">
      <g className="is-light" transform="translate(0 9)">{shapes}</g>
      <g className="is-shadow" transform="translate(0 -9)">{shapes}</g>
      <g className="is-cut">{shapes}</g>
    </svg>
  );
}

/** Placa rebitada com a marca (ou só a gravação, se a sobra for estreita). */
export default function BrandPlate() {
  return (
    <div className="vs-brand-side" aria-label="VS Stage Pro">
      <div className="vs-brand-plate">
        <i className="vs-rivet is-tl" /><i className="vs-rivet is-tr" /><i className="vs-rivet is-bl" /><i className="vs-rivet is-br" />
        <BrandMark />
        <span className="vs-brand vs-brand-name">VS Stage Pro</span>
      </div>
      <BrandMark className="vs-brand-etched" />
    </div>
  );
}
