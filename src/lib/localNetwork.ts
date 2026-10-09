import { useSyncExternalStore } from 'react';
import type { Setlist, ShowLive } from '@/lib/musicianTypes';
import type { LyricPage } from '@/lib/prompterTypes';

export type NetworkMode = 'online' | 'local';
export type LocalRole = 'musician' | 'producer' | 'screen';
export type PinRole = 'musician' | 'producer';

export interface LocalClient {
  id: string;
  role: LocalRole;
  name: string;
  address: string;
  lastSeen: number;
}

export interface LocalInfo {
  running: boolean;
  port: number;
  hostName: string | null;
  addresses: string[];
  pins: Record<PinRole, string>;
  qr: Record<LocalRole, string | null>;
  urls: Record<LocalRole, string | null>;
  clients: LocalClient[];
  lyrics: Record<string, LyricPage[]>;
  lyricsSaveRequestedAt: string | null;
  error: string | null;
}

export type CheckStatus = 'ok' | 'warn' | 'fail';
export type CheckAction = 'router' | 'firewall' | 'network' | 'sharing';

export interface NetworkCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  action?: CheckAction;
}

export interface LocalPublish {
  name: string;
  setlist: Setlist | null;
  live: ShowLive;
  lyrics: Record<string, LyricPage[]>;
}

/** Ponte que o app de Mac coloca na janela do diretor. Não existe no navegador. */
export interface LocalBridge {
  getInfo: () => Promise<LocalInfo>;
  start: () => Promise<LocalInfo>;
  stop: () => Promise<void>;
  publish: (payload: LocalPublish) => Promise<void>;
  regeneratePin: (role: PinRole) => Promise<LocalInfo>;
  kick: (clientId: string) => Promise<void>;
  ackLyricsSave: () => Promise<void>;
  networkCheck: () => Promise<NetworkCheck[]>;
  openAction: (action: CheckAction) => Promise<void>;
}

declare global {
  interface Window {
    vsLocal?: LocalBridge;
    vsDesktop?: {
      appReady: () => void;
      checkUpdate: (supabaseUrl: string) => Promise<UpdateInfo | null>;
      installUpdate: (info: UpdateInfo) => Promise<void>;
      onUpdateProgress: (cb: (pct: number) => void) => () => void;
    };
    __VS_LOCAL__?: number;
    __VS_HOST__?: string;
    __VS_VERSION__?: string;
  }
}

export interface UpdateInfo {
  version: string;
  base: string;
  build: { arch: 'arm64' | 'x64'; label: string; file: string; size: number; sha256: string; parts: string[] };
  // "upgrade": versão mais nova publicada. "downgrade": o backoffice reverteu para uma
  // versão anterior — todo app mais novo também precisa voltar.
  direction: 'upgrade' | 'downgrade';
  // Marcada pelo admin: o app fica bloqueado (tela cheia, sem fechar) até atualizar.
  required: boolean;
}

export function localBridge(): LocalBridge | null {
  return typeof window !== 'undefined' && window.vsLocal ? window.vsLocal : null;
}

/** A página foi aberta a partir do servidor da rede local (celular, tablet ou TV na mesma rede). */
export function isLocalClient(): boolean {
  return typeof window !== 'undefined' && window.__VS_LOCAL__ === 1 && !window.vsLocal;
}

/** Versão do VS Stage instalada no Mac do diretor, vista de um celular na rede local. */
export function localServerVersion(): string | null {
  return typeof window !== 'undefined' && typeof window.__VS_VERSION__ === 'string' ? window.__VS_VERSION__ : null;
}

const MODE_LS = 'vs_stage_network_mode';
const listeners = new Set<() => void>();

function readMode(): NetworkMode {
  return localStorage.getItem(MODE_LS) === 'local' && localBridge() ? 'local' : 'online';
}

let current: NetworkMode = typeof window === 'undefined' ? 'online' : readMode();

export function getNetworkMode(): NetworkMode {
  return current;
}

export function setNetworkMode(mode: NetworkMode) {
  current = mode;
  localStorage.setItem(MODE_LS, mode);
  listeners.forEach((l) => l());
}

export function useNetworkMode(): NetworkMode {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getNetworkMode,
  );
}

export const ROLE_LABEL: Record<LocalRole, string> = {
  musician: 'Músicos',
  producer: 'Produtor',
  screen: 'Tela do palco',
};
