import { useSyncExternalStore } from 'react';

// Endereço publicado do VS Stage na internet. Os links enviados para celulares usam este endereço
// quando o programa está aberto no app do Mac ou na visualização do editor, que só existem nesta máquina.
const DEFAULT_PUBLIC_ADDRESS = 'https://vsstage-pro-showonline.bolt.host/';
const STORAGE_KEY = 'vs-public-app-url-v2';
const CHANGE_EVENT = 'vs-public-app-url-change';

function isPrivateHost(protocol: string, hostname: string): boolean {
  if (protocol !== 'https:' && protocol !== 'http:') return true;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')
    || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(hostname)
    || hostname.endsWith('.webcontainer-api.io') || hostname.endsWith('.webcontainer.io')
    || hostname.includes('local-credentialless');
}

export function isPrivateOrigin(): boolean {
  return isPrivateHost(window.location.protocol, window.location.hostname);
}

function savedPublicAddress(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function baseUrl(): string {
  if (!isPrivateOrigin()) return `${window.location.origin}${window.location.pathname}`;
  return savedPublicAddress() ?? DEFAULT_PUBLIC_ADDRESS;
}

// Aceita o que a pessoa colar ("meusite.com", "https://meusite.com/#musico") e devolve só o endereço base.
export function normalizePublicAddress(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || isPrivateHost(url.protocol, url.hostname)) return null;
  return `${url.origin}${url.pathname.replace(/\/?$/, '/')}`;
}

export function savePublicAddress(address: string | null): void {
  try {
    if (address) localStorage.setItem(STORAGE_KEY, address);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* armazenamento indisponível */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function usePublicAddress(): string {
  return useSyncExternalStore(subscribe, baseUrl);
}

export function publicLink(hash: string): string {
  return `${baseUrl()}#${hash}`;
}
