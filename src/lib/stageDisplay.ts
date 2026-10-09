import { useEffect, useState } from 'react';

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as FsDocument;

export function isFullscreen(): boolean {
  return !!(doc().fullscreenElement || doc().webkitFullscreenElement);
}

export function canFullscreen(): boolean {
  return !!(doc().fullscreenEnabled || doc().webkitFullscreenEnabled);
}

/** Aberta pelo ícone da tela inicial: o celular já mostra sem a barra do navegador. */
export function isInstalled(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches;
}

export function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

export async function enterFullscreen() {
  const el = document.documentElement as FsElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch { return; }
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  orientation?.lock?.('landscape').catch(() => {});
}

export function exitFullscreen() {
  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  else doc().webkitExitFullscreen?.();
}

export function useFullscreen(): boolean {
  const [fs, setFs] = useState(isFullscreen);
  useEffect(() => {
    const on = () => setFs(isFullscreen());
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);
  return fs;
}

export function usePortrait(): boolean {
  const query = '(orientation: portrait)';
  const [portrait, setPortrait] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPortrait(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return portrait;
}

/**
 * No iPhone, o ícone da tela inicial guarda o endereço exato da página. Se ela foi aberta pelo IP
 * (que muda a cada rede), passa para o nome fixo do Mac antes de o músico criar o ícone.
 */
export function useFixedLocalAddress(enabled: boolean) {
  useEffect(() => {
    const host = window.__VS_HOST__;
    if (!enabled || !host || window.location.host === host) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2500);
    fetch(`http://${host}/api/local/ping`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
      .then(() => { window.location.replace(`http://${host}/#tela`); })
      .catch(() => {})
      .finally(() => window.clearTimeout(timer));
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, [enabled]);
}
