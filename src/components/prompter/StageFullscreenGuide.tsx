import { Maximize, Share, SquarePlus, Smartphone, X } from 'lucide-react';

interface Props {
  mode: 'fullscreen' | 'install';
  onFullscreen: () => void;
  onDismiss: () => void;
}

const IPHONE_STEPS = [
  { icon: Share, text: <>Toque em <b className="text-white">Compartilhar</b> na barra do Safari</> },
  { icon: SquarePlus, text: <>Escolha <b className="text-white">Adicionar à Tela de Início</b></> },
  { icon: Smartphone, text: <>Abra pelo ícone <b className="text-white">VS_STAGE - TELEPROMPT</b></> },
];

export default function StageFullscreenGuide({ mode, onFullscreen, onDismiss }: Props) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 backdrop-blur-sm p-6 animate-[fadeIn_200ms_ease-out]">
      <button
        onClick={onDismiss}
        className="absolute top-4 right-4 p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        title="Continuar no navegador"
      >
        <X size={18} />
      </button>

      {mode === 'fullscreen' ? (
        <div className="flex flex-col items-center text-center gap-6 max-w-sm">
          <button
            onClick={onFullscreen}
            className="group flex flex-col items-center gap-4 px-10 py-8 rounded-3xl bg-white/10 hover:bg-white/15 active:scale-[0.98] border border-white/15 text-white transition-all"
          >
            <span className="flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-400 text-black shadow-lg shadow-amber-400/20 group-hover:scale-105 transition-transform">
              <Maximize size={30} />
            </span>
            <span className="text-2xl font-semibold leading-tight">Toque para tela cheia</span>
            <span className="text-sm text-white/60 leading-normal">A barra do navegador some e a TV mostra só a letra.</span>
          </button>
          <button onClick={onDismiss} className="text-sm text-white/50 hover:text-white underline-offset-4 hover:underline transition-colors">
            Continuar no navegador
          </button>
        </div>
      ) : (
        <div className="w-full max-w-md max-h-full overflow-y-auto flex flex-col gap-6 text-white">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Espelhamento sem barra</p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight">Instale a tela no iPhone</h2>
            <p className="mt-2 text-sm text-white/60 leading-normal">
              Pelo Safari a barra do navegador aparece na TV. Aberta pelo ícone, a tela ocupa tudo. Você faz isso uma vez só.
            </p>
          </div>
          <ol className="flex flex-col gap-2">
            {IPHONE_STEPS.map(({ icon: Icon, text }, i) => (
              <li key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.06] border border-white/10">
                <span className="flex items-center justify-center w-8 h-8 shrink-0 rounded-full bg-amber-400 text-black text-sm font-semibold">{i + 1}</span>
                <span className="flex-1 text-sm text-white/75 leading-normal">{text}</span>
                <Icon size={22} className="shrink-0 text-amber-400" />
              </li>
            ))}
          </ol>
          <button onClick={onDismiss} className="self-center text-sm text-white/50 hover:text-white underline-offset-4 hover:underline transition-colors">
            Continuar no navegador
          </button>
        </div>
      )}
    </div>
  );
}
