import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './sw';
import { applySkin, savedSkin } from './lib/skins';
import { applyPerfMode } from './lib/perfMode';

// Veste a skin escolhida antes de desenhar, para a tela não piscar na padrão.
applySkin(savedSkin());
// Modo leve (versão Intel, ou escolhido em Visualizar): menos efeitos de desenho desde o começo.
applyPerfMode();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
