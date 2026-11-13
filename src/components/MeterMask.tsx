import { useLayoutEffect, useRef } from 'react';
import { meterLevel, meterMaskCover, subscribeMeters } from '@/lib/meterBus';

/**
 * Parte apagada do medidor, por cima do degradê. O nível chega umas 30 vezes por segundo com o
 * programa tocando. Antes cada chegada redesenhava pelo React e mudava a altura, o que refaz
 * layout e pintura da coluna (e do que está embaixo dela) o show inteiro. Agora o medidor ouve
 * o meterBus direto e só muda o transform: a placa de vídeo aplica, sem repintar nada. O desenho
 * é o mesmo (a máscara é uma cor lisa).
 * `smooth` (VS Stage Remote, poucos níveis por segundo): continua mudando a altura, com a transição.
 */
export default function MeterMask({ id, className, horizontal = false, smooth = false }: {
  id: string;
  className: string;
  horizontal?: boolean;
  smooth?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = -1;
    const apply = () => {
      const cover = meterMaskCover(meterLevel(id));
      if (cover === last) return;
      last = cover;
      if (smooth) {
        if (horizontal) el.style.width = `${cover * 100}%`;
        else el.style.height = `${cover * 100}%`;
      } else {
        el.style.transform = horizontal ? `scaleX(${cover})` : `scaleY(${cover})`;
      }
    };
    apply();
    return subscribeMeters(apply);
  }, [id, horizontal, smooth]);
  // Deitado (coluna das faixas da timeline): a parte apagada fica à direita.
  if (smooth) {
    return <div ref={ref} className={`absolute ${horizontal ? 'top-0 bottom-0 right-0' : 'top-0 left-0 right-0'} ${className}`} />;
  }
  return <div ref={ref} className={`absolute inset-0 will-change-transform ${horizontal ? 'origin-right' : 'origin-top'} ${className}`} />;
}

// Medidor de LEDs (dBFS) do mixer: degradê verde → amarelo → vermelho, recortado em segmentos.
// A parte apagada fica por cima, meio transparente, para os LEDs apagados aparecerem fracos,
// como numa mesa. "off" (canal mudo ou sem saída) deixa a coluna cinza.
const METER_GRADIENT = 'linear-gradient(to top, #3ee26e 0%, #3ee26e 62.5%, #ffd83d 75%, #ffd83d 93.75%, #ff4136 95.8%, #ff4136 100%)';

export function LedMeter({ id, off, clipping, onClick, title, height = 120, smooth = false, stereo = false }: {
  id: string;
  off?: boolean;
  clipping?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  /** altura em px (o mixer do Mac usa 120; o VS Stage Remote acompanha o tamanho do fader) */
  height?: number;
  /** o nível chega poucas vezes por segundo (VS Stage Remote): a barra desliza entre um e outro */
  smooth?: boolean;
  /** estéreo: duas colunas, L e R (níveis "ID:L" e "ID:R" que o motor publica) */
  stereo?: boolean;
}) {
  if (stereo) {
    return (
      <div className="console-well console-meter-stereo relative flex gap-px p-px overflow-hidden w-[13px]" style={{ height }} onClick={onClick} title={title}>
        {(['L', 'R'] as const).map((side) => (
          <div key={side} className="relative flex-1 overflow-hidden">
            <div className="absolute inset-0" style={{ background: off ? '#3a3d42' : METER_GRADIENT }} />
            <MeterMask id={`${id}:${side}`} smooth={smooth} className={`bg-[#0b0c0e]/[0.86]${smooth ? ' transition-[height] duration-100 ease-linear' : ''}`} />
            <div className="console-meter-segments" />
          </div>
        ))}
        {clipping && (
          <div
            className="absolute top-0 left-0 right-0 h-1.5 cursor-pointer"
            style={{ background: '#ff4136', boxShadow: '0 0 6px #ff4136' }}
          />
        )}
      </div>
    );
  }
  return (
    <div className="console-well relative w-2.5 overflow-hidden" style={{ height }} onClick={onClick} title={title}>
      <div className="absolute inset-0" style={{ background: off ? '#3a3d42' : METER_GRADIENT }} />
      <MeterMask id={id} smooth={smooth} className={`bg-[#0b0c0e]/[0.86]${smooth ? ' transition-[height] duration-100 ease-linear' : ''}`} />
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

// O mesmo medidor do mixer, deitado: vai da esquerda (silêncio) para a direita (0 dBFS).
// Fica na faixa mãe da timeline, embaixo do fader.
const METER_GRADIENT_H = METER_GRADIENT.replace('to top', 'to right');

export function LedMeterH({ id, off, width, height = 4, title }: {
  id: string;
  off?: boolean;
  width: number;
  height?: number;
  title?: string;
}) {
  return (
    <div className="console-well relative overflow-hidden" style={{ width, height }} title={title}>
      <div className="absolute inset-0" style={{ background: off ? '#3a3d42' : METER_GRADIENT_H }} />
      <MeterMask id={id} horizontal className="bg-[#0b0c0e]/[0.86]" />
      <div className="console-meter-segments is-horizontal" />
    </div>
  );
}
