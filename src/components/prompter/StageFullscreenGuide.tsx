import { Maximize, Share, SquarePlus, Smartphone, X } from 'lucide-react';

interface Props {
  mode: 'fullscreen' | 'install';
  onFullscreen: () => void;
  onDismiss: () => void;
}

// O nome do ícone vem de index.html (apple-mobile-web-app-title) e do manifest.webmanifest.
const IPHONE_STEPS = [
  { icon: Share, text: <>Toque em <b className="text-logic-text">Compartilhar</b> na barra do Safari</> },
  { icon: SquarePlus, text: <>Escolha <b className="text-logic-text">Adicionar à Tela de Início</b></> },
  { icon: Smartphone, text: <>Abra pelo ícone <b className="vs-brand text-logic-text">VS STAGE PRO</b></> },
];

export default function StageFullscreenGuide({ mode, onFullscreen, onDismiss }: Props) {
  return (
    // Sem desfoque: pesa no aparelho fraco ligado à TV.
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 p-6 animate-[fadeIn_200ms_ease-out]">
      <button
        onClick={onDismiss}
        className="console-key absolute top-4 right-4 flex items-center justify-center h-9 w-9"
        title="Continuar no navegador"
      >
        <X size={18} />
      </button>

      {mode === 'fullscreen' ? (
        <div className="flex flex-col items-center text-center gap-6 max-w-sm">
          {/* O cartão inteiro é o botão: o pedido de tela cheia precisa vir do toque. */}
          <button
            onClick={onFullscreen}
            className="group flex flex-col items-center gap-4 px-10 py-8 console-face border-2 border-black rounded-lg shadow-2xl text-logic-text transition-all active:translate-y-px"
          >
            <span className="console-key is-lit-amber flex items-center justify-center w-16 h-16">
              <Maximize size={30} />
            </span>
            <span className="font-stage text-2xl font-bold tracking-wide leading-tight">Toque para tela cheia</span>
            <span className="text-sm text-logic-text-dim leading-normal">A barra do navegador some e a TV mostra só a letra.</span>
          </button>
          <button onClick={onDismiss} className="text-sm text-logic-text-dim hover:text-logic-text underline-offset-4 hover:underline transition-colors">
            Continuar no navegador
          </button>
        </div>
      ) : (
        <div className="w-full max-w-md max-h-full overflow-y-auto flex flex-col gap-6 text-logic-text">
          <div className="text-center">
            <p className="console-legend uppercase">Espelhamento sem barra</p>
            <h2 className="mt-2 font-stage text-2xl font-bold tracking-wide leading-tight">Instale a tela no iPhone</h2>
            <p className="mt-2 text-sm text-logic-text-dim leading-normal">
              Pelo Safari a barra do navegador aparece na TV. Aberta pelo ícone, a tela ocupa tudo. Você faz isso uma vez só.
            </p>
          </div>
          <ol className="flex flex-col gap-2">
            {IPHONE_STEPS.map(({ icon: Icon, text }, i) => (
              <li key={i} className="flex items-center gap-4 p-4 console-face border-2 border-black rounded">
                {/* Número gravado no alumínio: letra escura, como nos trilhos do programa. */}
                <span className="console-rail flex items-center justify-center w-8 h-8 shrink-0 border border-black rounded font-stage font-bold text-sm">{i + 1}</span>
                <span className="flex-1 text-sm text-logic-text-dim leading-normal">{text}</span>
                <Icon size={22} className="shrink-0 text-logic-lcd-amber" />
              </li>
            ))}
          </ol>
          <button onClick={onDismiss} className="self-center text-sm text-logic-text-dim hover:text-logic-text underline-offset-4 hover:underline transition-colors">
            Continuar no navegador
          </button>
        </div>
      )}
    </div>
  );
}
