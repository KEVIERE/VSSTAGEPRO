import { Clapperboard, MonitorPlay, Music, Wifi } from 'lucide-react';

const OPTIONS = [
  { hash: '#musico', label: 'Sou músico', hint: 'Repertório e música tocando agora', icon: Music, tone: 'text-logic-lcd-green bg-logic-lcd-green/15' },
  { hash: '#produtor', label: 'Sou produtor', hint: 'Letras, avisos e controle da TV', icon: Clapperboard, tone: 'text-logic-accent bg-logic-accent/15' },
  { hash: '#tela', label: 'Tela do palco', hint: 'Abrir no computador ligado à TV', icon: MonitorPlay, tone: 'text-logic-lcd-amber bg-logic-lcd-amber/15' },
];

export default function LocalLanding() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-logic-bg-deep px-4">
      <div className="w-full max-w-sm animate-[fadeIn_200ms_ease-out]">
        <div className="flex items-center gap-2 text-logic-text-dim text-xs mb-3">
          <Wifi size={14} className="text-logic-lcd-green" /> Rede local do palco
        </div>
        <h1 className="text-2xl font-semibold text-logic-text">VS Stage</h1>
        <p className="text-sm text-logic-text-dim mt-2 mb-6 leading-relaxed">Escolha como você vai usar este aparelho no show.</p>
        <div className="space-y-3">
          {OPTIONS.map(({ hash, label, hint, icon: Icon, tone }) => (
            <a
              key={hash} href={hash}
              className="flex items-center gap-4 p-4 rounded-xl bg-logic-bg-panel border border-logic-border hover:border-logic-border-light hover:bg-logic-bg-elevated active:scale-[0.99] transition-all"
            >
              <span className={`w-11 h-11 rounded-lg flex items-center justify-center ${tone}`}><Icon size={20} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-logic-text">{label}</span>
                <span className="block text-xs text-logic-text-dim mt-0.5">{hint}</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
