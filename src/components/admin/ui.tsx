import { Loader2 } from 'lucide-react';

export const btn = 'inline-flex items-center justify-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold transition disabled:opacity-50 disabled:pointer-events-none';
export const btnGhost = `${btn} bg-logic-bg-elevated text-logic-text hover:bg-logic-bg-panel-light`;
export const btnPrimary = `${btn} bg-logic-lcd-green text-black hover:brightness-110`;
export const btnDanger = `${btn} bg-logic-lcd-red/15 text-logic-lcd-red hover:bg-logic-lcd-red/25`;
export const input = 'w-full bg-logic-bg-deep text-sm text-logic-text px-3 h-9 rounded-md border border-logic-border-light outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted';

export function Kpi({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-logic-bg-panel border border-logic-border rounded-lg p-4">
      <p className="text-2xs font-semibold tracking-wider text-logic-text-muted uppercase">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${accent ?? 'text-logic-text'}`}>{value}</p>
      {hint && <p className="text-2xs text-logic-text-dim mt-1">{hint}</p>}
    </div>
  );
}

export function Panel({ title, actions, children, className = '' }: {
  title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bg-logic-bg-panel border border-logic-border rounded-lg overflow-hidden ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 h-10 border-b border-logic-border bg-logic-bg-elevated/40">
          <h3 className="text-2xs font-semibold tracking-widest text-logic-text-muted uppercase">{title}</h3>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-logic-text-muted">
      <Loader2 className="animate-spin" />
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 rounded-lg border bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red text-xs">
      {text}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-xs text-logic-text-muted">{text}</p>;
}

const PERIODS = [7, 30, 90] as const;

export function PeriodPicker({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="flex p-0.5 rounded-md bg-logic-bg-deep border border-logic-border-dark">
      {PERIODS.map((d) => (
        <button
          key={d} type="button" onClick={() => onChange(d)}
          className={`px-2.5 h-7 rounded text-2xs font-semibold transition ${value === d ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-muted hover:text-logic-text'}`}
        >
          {d} dias
        </button>
      ))}
    </div>
  );
}
