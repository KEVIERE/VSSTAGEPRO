// Aviso de disco atrasado na barra de cima, sem precisar entrar no programa.
// Abrir com o servidor de desenvolvimento: /tests/browser/disklag-smoke.html
// No console: window.vsTest.lag(['Piano 1']) mostra a etiqueta; window.vsTest.lag([]) apaga.
import { createRoot } from 'react-dom/client';
import TransportBar from '../../src/components/TransportBar';
import { setDiskLag } from '../../src/lib/diskLag';
import '/src/index.css';

createRoot(document.getElementById('root')!).render(
  <div className="flex flex-col h-screen bg-logic-bg-deep text-logic-text">
    <TransportBar />
    <div className="flex-1 grid place-items-center text-logic-text-muted text-sm">(timeline)</div>
  </div>,
);

(window as unknown as { vsTest: unknown }).vsTest = { lag: (names: string[]) => setDiskLag(names) };
setDiskLag(['Piano 1']);
