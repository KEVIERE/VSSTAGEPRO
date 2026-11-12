import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './sw';
import { applySkin, savedSkin } from './lib/skins';

// Veste a skin escolhida antes de desenhar, para a tela não piscar na padrão.
applySkin(savedSkin());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
