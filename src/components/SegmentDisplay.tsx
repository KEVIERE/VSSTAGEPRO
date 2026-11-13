// Display de 7 segmentos, desenhado em SVG (não depende de fonte nem de internet).
// Os segmentos apagados aparecem bem fracos atrás dos acesos, como num display de LED de verdade.
// A cor vem do texto (currentColor) e o tamanho, da altura: <SegmentDisplay text="-3:21" className="h-12 text-logic-lcd-green" />
// Nas skins Grafite e Estúdio o mesmo lugar vira um visor de tela: números lisos, sem segmentos, no
// mesmo tamanho (a caixa é a mesma, então nada sai do lugar ao trocar de skin).
import { useSkin } from '@/lib/useSkin';

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};

// Geometria de uma casa de dígito (12 × 20 unidades)
const THICK = 2.2;
const LEFT = 1.4;
const RIGHT = 10.6;
const TOP = 1.4;
const MID = 10;
const BOTTOM = 18.6;
const GAP = 0.55;
const DIGIT_W = 12;
const COLON_W = 4.5;
const SPACING = 1.6;
// inclinação leve, como nos displays de equipamento
const SKEW = -6;
const SKEW_PAD = 20 * Math.tan((Math.abs(SKEW) * Math.PI) / 180);

const half = THICK / 2;
const horizontal = (y: number, x0: number, x1: number) =>
  `${x0},${y} ${x0 + half},${y - half} ${x1 - half},${y - half} ${x1},${y} ${x1 - half},${y + half} ${x0 + half},${y + half}`;
const vertical = (x: number, y0: number, y1: number) =>
  `${x},${y0} ${x + half},${y0 + half} ${x + half},${y1 - half} ${x},${y1} ${x - half},${y1 - half} ${x - half},${y0 + half}`;

const POINTS: Record<string, string> = {
  a: horizontal(TOP, LEFT + GAP, RIGHT - GAP),
  g: horizontal(MID, LEFT + GAP, RIGHT - GAP),
  d: horizontal(BOTTOM, LEFT + GAP, RIGHT - GAP),
  f: vertical(LEFT, TOP + GAP, MID - GAP),
  b: vertical(RIGHT, TOP + GAP, MID - GAP),
  e: vertical(LEFT, MID + GAP, BOTTOM - GAP),
  c: vertical(RIGHT, MID + GAP, BOTTOM - GAP),
};
const ALL = 'abcdefg';

type Cell = { kind: 'digit'; ch: string; x: number } | { kind: 'colon'; x: number };

function layout(text: string): { cells: Cell[]; width: number } {
  const cells: Cell[] = [];
  let x = 0;
  for (const ch of text) {
    if (ch === ':') {
      cells.push({ kind: 'colon', x });
      x += COLON_W;
    } else {
      cells.push({ kind: 'digit', ch, x });
      x += DIGIT_W;
    }
    x += SPACING;
  }
  return { cells, width: Math.max(0, x - SPACING) };
}

export default function SegmentDisplay({
  text,
  className = '',
  label,
  ghost = true,
}: {
  text: string;
  className?: string;
  /** texto lido por leitores de tela (padrão: o próprio texto) */
  label?: string;
  /** mostrar os segmentos apagados */
  ghost?: boolean;
}) {
  const { cells, width } = layout(text);
  const skin = useSkin();
  if (skin !== 'analogica') {
    return (
      <svg
        viewBox={`${-SKEW_PAD - 0.5} -0.5 ${width + SKEW_PAD + 1} 21`}
        className={`segment-display is-tft ${className}`}
        style={{ width: 'auto' }}
        role="img"
        aria-label={label ?? text}
      >
        <text
          x={width / 2}
          y={17.4}
          textAnchor="middle"
          fontSize={19}
          letterSpacing={-0.4}
          fontFamily={skin === 'estudio' || skin === 'oficina' ? "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif" : "'Inter', system-ui, sans-serif"}
          fontWeight={skin === 'oficina' ? 400 : 600}
          style={{ fontVariantNumeric: 'tabular-nums' }}
          fill="currentColor"
        >
          {text}
        </text>
      </svg>
    );
  }
  return (
    <svg
      viewBox={`${-SKEW_PAD - 0.5} -0.5 ${width + SKEW_PAD + 1} 21`}
      className={`segment-display ${className}`}
      style={{ width: 'auto' }}
      role="img"
      aria-label={label ?? text}
    >
      <g transform={`skewX(${SKEW})`}>
        {ghost && (
          <g className="segment-ghost">
            {cells.map((cell, i) =>
              cell.kind === 'digit' ? (
                <g key={i} transform={`translate(${cell.x} 0)`}>
                  {[...ALL].map((s) => <polygon key={s} points={POINTS[s]} />)}
                </g>
              ) : null,
            )}
          </g>
        )}
        <g className="segment-lit">
          {cells.map((cell, i) =>
            cell.kind === 'digit' ? (
              <g key={i} transform={`translate(${cell.x} 0)`}>
                {[...(SEGMENTS[cell.ch] ?? '')].map((s) => <polygon key={s} points={POINTS[s]} />)}
              </g>
            ) : (
              <g key={i} transform={`translate(${cell.x} 0)`}>
                <rect x={COLON_W / 2 - 1.1} y={5.6} width={2.2} height={2.2} />
                <rect x={COLON_W / 2 - 1.1} y={12.6} width={2.2} height={2.2} />
              </g>
            ),
          )}
        </g>
      </g>
    </svg>
  );
}
