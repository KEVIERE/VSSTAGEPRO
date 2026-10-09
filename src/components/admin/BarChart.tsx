import { useState } from 'react';

// Gráfico de barras de uma série (por dia), com tooltip ao passar o mouse e visão em tabela.
export default function BarChart({
  title, data, color, format = (v) => String(v),
}: {
  title: string;
  data: Array<{ label: string; value: number }>;
  color: string;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const H = 120;
  const n = data.length || 1;
  const ticks = [max, Math.round(max / 2), 0].filter((v, i, a) => a.indexOf(v) === i);
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="bg-logic-bg-panel border border-logic-border rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="text-xs font-semibold text-logic-text-dim">{title}</h3>
          <p className="text-lg font-bold tabular-nums text-logic-text">{format(total)}</p>
        </div>
        <button
          type="button" onClick={() => setTable((t) => !t)}
          className="text-2xs text-logic-text-muted hover:text-logic-text transition"
        >
          {table ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </div>

      {table ? (
        <div className="max-h-[160px] overflow-y-auto text-xs">
          <table className="w-full">
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.label} className="border-b border-logic-border/50">
                  <td className="py-1 text-logic-text-dim">{d.label}</td>
                  <td className="py-1 text-right tabular-nums">{format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative flex gap-2">
          <div className="flex flex-col justify-between text-[9px] text-logic-text-muted tabular-nums text-right w-6 shrink-0" style={{ height: H }}>
            {ticks.map((t) => <span key={t}>{t}</span>)}
          </div>
          <div className="relative flex-1">
            <svg
              viewBox={`0 0 ${n * 10} ${H}`} preserveAspectRatio="none" className="w-full block" style={{ height: H }}
              onMouseLeave={() => setHover(null)} role="img" aria-label={`${title}: total ${format(total)}`}
            >
              {[0, 0.5, 1].map((f) => (
                <line key={f} x1={0} x2={n * 10} y1={H * f} y2={H * f} stroke="#3a3a3a" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={f === 1 ? undefined : '2 3'} />
              ))}
              {data.map((d, i) => {
                const bh = d.value ? Math.max(2, (d.value / max) * (H - 4)) : 0;
                return (
                  <g key={d.label}>
                    <rect x={i * 10} y={0} width={10} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
                    {bh > 0 && (
                      <rect
                        x={i * 10 + 1} y={H - bh} width={8} height={bh} rx={1.2}
                        fill={color} opacity={hover === null || hover === i ? 1 : 0.45}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
            {h && hover !== null && (
              <div
                className="absolute -top-2 -translate-y-full -translate-x-1/2 px-2 py-1 rounded bg-logic-bg-elevated border border-logic-border-light text-2xs whitespace-nowrap pointer-events-none shadow-xl z-10"
                style={{ left: `${((hover + 0.5) / n) * 100}%` }}
              >
                <span className="text-logic-text-dim">{h.label}</span>{' '}
                <span className="font-bold text-logic-text tabular-nums">{format(h.value)}</span>
              </div>
            )}
            <div className="flex justify-between text-[9px] text-logic-text-muted mt-1">
              <span>{data[0]?.label}</span>
              <span>{data[data.length - 1]?.label}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
