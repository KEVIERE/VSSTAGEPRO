// Mixer isolado, sem login nem áudio, para conferir o alinhamento das colunas.
// Abrir com o servidor de desenvolvimento: /tests/browser/mixer-smoke.html
// No console: window.vsTest.medir() devolve a posição de topo de cada elemento por coluna.
import '../../src/index.css';
import { createRoot } from 'react-dom/client';
import MixerPanel from '../../src/components/MixerPanel';
import { useStore } from '../../src/store';

// abre o mixer (ele começa escondido)
useStore.setState({ mixerVisible: true });

createRoot(document.getElementById('root')!).render(
  <div className="flex flex-col justify-end h-screen bg-logic-bg-deep text-logic-text">
    <MixerPanel />
  </div>,
);

(window as unknown as { vsTest: unknown }).vsTest = {
  medir: () => {
    const strips = [...document.querySelectorAll('.console-strip')] as HTMLElement[];
    return strips.map((el) => {
      const base = el.getBoundingClientRect().top;
      const linhas: Record<string, number> = {};
      el.querySelectorAll(':scope > *').forEach((filho, i) => {
        const r = filho.getBoundingClientRect();
        linhas[`${i}:${(filho.textContent ?? '').trim().slice(0, 12) || filho.className.split(' ')[0]}`] =
          Math.round(r.top - base);
      });
      return { largura: Math.round(el.getBoundingClientRect().width), linhas };
    });
  },
};
