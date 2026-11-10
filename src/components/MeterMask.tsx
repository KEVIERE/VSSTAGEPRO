import { useMeterLevel } from '@/lib/meterBus';

export default function MeterMask({ id, className }: { id: string; className: string }) {
  const level = useMeterLevel(id);
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const meterPct = db <= -48 ? 0 : Math.min(100, ((db + 48) / 48) * 100);
  if (meterPct >= 100) return null;
  return <div className={`absolute top-0 left-0 right-0 ${className}`} style={{ height: `${100 - meterPct}%` }} />;
}

// Medidor de LEDs (dBFS) do mixer: degradê verde → amarelo → vermelho, recortado em segmentos.
// A parte apagada fica por cima, meio transparente, para os LEDs apagados aparecerem fracos,
// como numa mesa. "off" (canal mudo ou sem saída) deixa a coluna cinza.
const METER_GRADIENT = 'linear-gradient(to top, #3ee26e 0%, #3ee26e 62.5%, #ffd83d 75%, #ffd83d 93.75%, #ff4136 95.8%, #ff4136 100%)';

export function LedMeter({ id, off, clipping, onClick, title, height = 120, smooth = false }: {
  id: string;
  off?: boolean;
  clipping?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  /** altura em px (o mixer do Mac usa 120; o VS Stage Remote acompanha o tamanho do fader) */
  height?: number;
  /** o nível chega poucas vezes por segundo (VS Stage Remote): a barra desliza entre um e outro */
  smooth?: boolean;
}) {
  return (
    <div className="console-well relative w-2.5 overflow-hidden" style={{ height }} onClick={onClick} title={title}>
      <div className="absolute inset-0" style={{ background: off ? '#3a3d42' : METER_GRADIENT }} />
      <MeterMask id={id} className={`bg-[#0b0c0e]/[0.86]${smooth ? ' transition-[height] duration-100 ease-linear' : ''}`} />
      <div className="console-meter-segments" />
      {clipping && (
        <div
          className="absolute top-0 left-0 right-0 h-1.5 cursor-pointer"
          style={{ background: '#ff4136', boxShadow: '0 0 6px #ff4136' }}
        />
      )}
    </div>
  );
}
