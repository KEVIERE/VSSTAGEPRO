// Aparelhos desenhados em CSS para mostrar as telas do VS Stage (sem imagens de terceiros):
// computador de mesa, notebook, celular e tablet. Cada um ocupa a largura de quem o contém;
// as medidas internas usam cqw (porcentagem da largura do próprio aparelho), então o desenho
// fica igual em qualquer tamanho. O estilo está em sales.css (.vs-imac, .vs-mbook, .vs-phone2, .vs-tab).

type ScreenProps = { src: string; alt: string; eager?: boolean; width: number; height: number };

function Shot({ src, alt, eager, width, height }: ScreenProps) {
  return <img src={src} alt={alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} decoding="async" />;
}

export function IMac(props: ScreenProps) {
  return (
    <div className="vs-imac">
      <div className="vs-imac-display">
        <div className="vs-imac-screen"><Shot {...props} /><span className="vs-glare" /></div>
        <div className="vs-imac-chin" />
      </div>
      <div className="vs-imac-neck" />
      <div className="vs-imac-foot" />
    </div>
  );
}

export function MacBook(props: ScreenProps) {
  return (
    <div className="vs-mbook">
      <div className="vs-mbook-lid">
        <div className="vs-mbook-screen">
          <Shot {...props} />
          <span className="vs-mbook-notch" />
          <span className="vs-glare" />
        </div>
      </div>
      <div className="vs-mbook-base"><span className="vs-mbook-scoop" /></div>
    </div>
  );
}

function StatusIcons() {
  return (
    <svg viewBox="0 0 68 12" className="vs-phone2-icons" aria-hidden="true">
      {/* sinal */}
      <rect x="0" y="8" width="3" height="4" rx="0.8" />
      <rect x="4.5" y="6" width="3" height="6" rx="0.8" />
      <rect x="9" y="3.5" width="3" height="8.5" rx="0.8" />
      <rect x="13.5" y="1" width="3" height="11" rx="0.8" />
      {/* wi-fi */}
      <path d="M29 3.2a10 10 0 0 1 13 0l-1.5 1.6a7.8 7.8 0 0 0-10 0z M31.6 6a6.2 6.2 0 0 1 7.8 0l-1.6 1.6a4 4 0 0 0-4.6 0z M34.3 8.8a2.2 2.2 0 0 1 2.4 0L35.5 10.2z" />
      {/* bateria */}
      <rect x="47" y="1.5" width="18" height="9" rx="2.6" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" />
      <rect x="48.6" y="3.1" width="13.6" height="5.8" rx="1.4" />
      <rect x="66" y="4.3" width="1.6" height="3.4" rx="0.8" fillOpacity="0.45" />
    </svg>
  );
}

export function IPhone({ time = '20:45', ...props }: ScreenProps & { time?: string }) {
  return (
    <div className="vs-phone2">
      <span className="vs-phone2-btn is-action" />
      <span className="vs-phone2-btn is-up" />
      <span className="vs-phone2-btn is-down" />
      <span className="vs-phone2-btn is-power" />
      <div className="vs-phone2-body">
        <div className="vs-phone2-screen">
          <Shot {...props} />
          <span className="vs-phone2-time">{time}</span>
          <StatusIcons />
          <span className="vs-phone2-island" />
          <span className="vs-phone2-home" />
          <span className="vs-glare" />
        </div>
      </div>
    </div>
  );
}

export function Tablet(props: ScreenProps) {
  return (
    <div className="vs-tab">
      <div className="vs-tab-body">
        <span className="vs-tab-cam" />
        <div className="vs-tab-screen"><Shot {...props} /><span className="vs-glare" /></div>
      </div>
    </div>
  );
}
