// VS Stage Remote pelo Show Online: o programa e o celular conversam por um canal de tempo real
// do Supabase (só mensagens, nada fica gravado no banco). O nome do canal leva uma chave secreta
// criada no Mac: só quem tem o link (ou o QR) entra.

import { useSyncExternalStore } from 'react';
import { publicLink } from '@/lib/publicUrl';

const LS = 'vs_stage_remote_online';
const listeners = new Set<() => void>();

export interface OnlineRemoteConfig {
  key: string;
  on: boolean;
}

function newKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function read(): OnlineRemoteConfig | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (raw && typeof raw.key === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(raw.key)) return { key: raw.key, on: raw.on !== false };
  } catch { /* nada salvo */ }
  return null;
}

let current: OnlineRemoteConfig | null = typeof localStorage === 'undefined' ? null : read();

function commit(next: OnlineRemoteConfig) {
  current = next;
  try { localStorage.setItem(LS, JSON.stringify(next)); } catch { /* sem armazenamento: vale nesta sessão */ }
  listeners.forEach((l) => l());
}

export function getOnlineRemote(): OnlineRemoteConfig | null {
  return current;
}

export function useOnlineRemoteConfig(): OnlineRemoteConfig | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getOnlineRemote,
  );
}

/** Liga o Remote pelo Show Online (cria a chave na primeira vez). */
export function enableOnlineRemote() {
  commit({ key: current?.key ?? newKey(), on: true });
}

export function disableOnlineRemote() {
  if (current) commit({ ...current, on: false });
}

/** Chave nova: o link antigo para de funcionar e os celulares conectados caem. */
export function renewOnlineRemote() {
  commit({ key: newKey(), on: true });
}

export function remoteChannelName(key: string): string {
  return `vs-remote-${key}`;
}

export function onlineRemoteLink(key: string): string {
  return publicLink(`show&k=${key}`);
}

/** Chave que veio no link do celular (`/show#k=...` ou `#show&k=...`). */
export function remoteKeyFromLink(): string | null {
  try {
    const m = /(?:^#|[#&?])k=([A-Za-z0-9_-]{20,64})(?=$|&)/.exec(window.location.hash || window.location.search);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Quantos celulares estão no canal agora (o hook do Mac atualiza; o cartão do Remote mostra).
let phones = 0;
const phoneListeners = new Set<() => void>();

export function setOnlineRemotePhones(n: number) {
  if (n === phones) return;
  phones = n;
  phoneListeners.forEach((l) => l());
}

export function useOnlineRemotePhones(): number {
  return useSyncExternalStore(
    (cb) => { phoneListeners.add(cb); return () => { phoneListeners.delete(cb); }; },
    () => phones,
  );
}
