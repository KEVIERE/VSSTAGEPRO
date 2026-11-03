// Peças da entrada do programa (login, boas-vindas, assinatura), no visual de mesa de som do
// programa e com o palco do site: fundo escuro com feixes de luz, cartão de aço com trilho em
// cima, teclas que acendem e LEDs. Os estilos ficam em index.css (classes access-*).
import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import VsLogo from '@/components/VsLogo';
import SegmentDisplay from '@/components/SegmentDisplay';

/** Fundo da entrada: palco escuro com três feixes de luz, como o começo do site. */
export function AccessStage({ children }: { children: ReactNode }) {
  return (
    <div className="access-stage">
      <div className="access-beams" aria-hidden="true">
        <span className="access-beam" />
        <span className="access-beam" />
        <span className="access-beam" />
      </div>
      <div className="access-stage-inner">{children}</div>
    </div>
  );
}

type CardProps = { label: ReactNode; status?: ReactNode; width?: number; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/** Módulo da mesa: trilho escuro com o rótulo impresso e o painel de aço embaixo. */
export function AccessCard({ label, status, width = 420, children, className = '', style, ...rest }: CardProps) {
  return (
    <div {...rest} className={`access-card console-face ${className}`} style={{ width, ...style }}>
      <div className="console-rail flex items-center justify-between gap-3 px-4 h-9">
        <span className="console-legend uppercase tracking-[0.14em] flex items-center gap-2 min-w-0">{label}</span>
        {status ?? <span className="console-led is-on-green" title="Ligado" />}
      </div>
      {children}
    </div>
  );
}

/** Rótulo com LED aceso, para o canto direito do trilho (ex.: "Teste grátis", "Assinante"). */
export function AccessStatus({ tone, children }: { tone: 'green' | 'amber' | 'red'; children: ReactNode }) {
  const led = tone === 'green' ? 'is-on-green' : tone === 'amber' ? 'is-on-amber' : '';
  return (
    <span className={`console-legend uppercase tracking-[0.12em] flex items-center gap-1.5 shrink-0 ${tone === 'red' ? 'text-logic-lcd-red' : ''}`}>
      {tone === 'red' ? <span className="console-lamp is-on" /> : <span className={`console-led ${led}`} />}
      {children}
    </span>
  );
}

/** Logo, título na fonte do programa e uma linha de apoio. */
export function AccessTitle({ title, subtitle, id }: { title: ReactNode; subtitle?: ReactNode; id?: string }) {
  return (
    <div className="text-center mb-6">
      <div className="mx-auto w-[72px] h-[72px] mb-3 flex items-center justify-center">
        <VsLogo size={72} />
      </div>
      <h1 id={id} className="font-stage font-bold text-[2rem] leading-[0.95] tracking-[-0.01em] text-logic-text">{title}</h1>
      {subtitle && <p className="text-[0.82rem] text-logic-text-dim mt-2 leading-relaxed max-w-[22rem] mx-auto">{subtitle}</p>}
    </div>
  );
}

/** Aviso num visor escuro, com LED: verde para tudo certo, vermelho para erro. */
export function AccessNotice({ tone, children }: { tone: 'green' | 'red'; children: ReactNode }) {
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className="console-display px-3 py-2.5 text-xs leading-relaxed flex items-start gap-2.5 text-left">
      {tone === 'red' ? <span className="console-lamp is-on mt-[3px] shrink-0" /> : <span className="console-led is-on-green mt-[5px] shrink-0" />}
      <div className={`flex-1 space-y-1.5 ${tone === 'red' ? 'text-[#ff7a70]' : 'text-logic-lcd-green'}`}>{children}</div>
    </div>
  );
}

/** Rodapé do cartão: trilho escuro com teclas. */
export function AccessFoot({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) {
  return <div className={`access-foot grid gap-2 p-3 ${cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>{children}</div>;
}

/** Tecla do rodapé (emborrachada, da mesa). `lit` acende o LED dela. */
export function FootKey({ lit = false, children, className = '', ...rest }: { lit?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button" {...rest}
      className={`console-key h-10 px-3 text-[0.95rem] whitespace-nowrap flex items-center justify-center gap-2 ${lit ? 'text-logic-text' : ''} ${className}`}
    >
      <span className={`console-led ${lit ? 'is-on-amber' : ''}`} />
      {children}
    </button>
  );
}

/** Tempo que falta do teste grátis, no display de 7 segmentos (horas:minutos). */
export function TrialClock({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15 * 1000);
    return () => window.clearInterval(t);
  }, []);
  const totalMin = Math.max(0, Math.ceil((endsAt - now) / 60000));
  const text = `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
  return (
    <div className="console-bezel">
      <div className="console-display px-4 py-3 flex items-center justify-between gap-4">
        <div className="text-left">
          <p className="console-legend uppercase tracking-[0.12em] flex items-center gap-1.5">
            <span className="console-led is-on-green" /> Teste grátis
          </p>
          <p className="console-legend uppercase tracking-[0.12em] mt-1.5 text-logic-text-muted">Restam · horas : min</p>
        </div>
        <SegmentDisplay text={text} className="h-9 text-logic-lcd-green" />
      </div>
    </div>
  );
}
