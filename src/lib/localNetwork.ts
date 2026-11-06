import { useSyncExternalStore } from 'react';
import type { Setlist, ShowLive } from '@/lib/musicianTypes';
import type { LyricPage } from '@/lib/prompterTypes';

export type NetworkMode = 'online' | 'local';
export type LocalRole = 'musician' | 'producer' | 'screen' | 'remote';
export type PinRole = 'musician' | 'producer' | 'remote';

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

/** Situação da voz brasileira de IA do Maestro (Qwen3-TTS) no app do Mac. */
/**
 * Resultado da separação da bateria em peças. `why` vem preenchido quando não deu para separar:
 * aí a música fica com a bateria inteira, como antes.
 */
export interface DrumPiecesResult {
  bumbo?: ArrayBuffer;
  caixa?: ArrayBuffer;
  pratos?: ArrayBuffer;
  tons?: ArrayBuffer;
  why?: string;
}

export interface MaestroVoiceStatus {
  /** Mac com chip Apple: a voz de IA roda no próprio Mac (Qwen3-TTS) */
  supported: boolean;
  /** o programa de voz e as vozes vieram no app */
  engine: boolean;
  /** download do modelo (~1,8 GB, uma vez só, em silêncio) */
  model: { state: 'missing' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'error'; progress?: number; error?: string | null };
  /** dá para falar com a voz de IA do próprio Mac agora */
  ready: boolean;
}

declare global {
  interface Window {
    vsLocal?: LocalBridge;
    vsDesktop?: {
      appReady: () => void;
      checkUpdate: (supabaseUrl: string) => Promise<UpdateInfo | null>;
      installUpdate: (info: UpdateInfo) => Promise<void>;
      onUpdateProgress: (cb: (pct: number) => void) => () => void;
      onManualUpdateCheck?: (cb: () => void) => () => void;
      /** Menu Visualizar → Modo Show (⌘M) do app do Mac */
      onMenuShowMode?: (cb: () => void) => () => void;
      hasLocalDemucs?: () => Promise<boolean>;
      /** Vozes do Maestro por IA instaladas no Mac. */
      maestroVoices?: () => Promise<Array<{ id: string; name: string; gender: string; locale: string; engine?: 'qwen' | 'mac' }>>;
      /** Gera a fala com uma voz online gratuita (áudio em base64). */
      maestroOnlineSpeak?: (payload: { text: string; voice: string }) => Promise<{ voice: string; mime: string; audioBase64: string }>;
      /** Gera o áudio de uma narração do Maestro com a voz do sistema (WAV em base64). */
      maestroSpeak?: (payload: { text: string; voice: string; wpm: number; span?: number; pace?: number; group?: string[] }) => Promise<{
        ok: boolean;
        voice: string;
        voiceGender?: string;
        locale?: string;
        /** Aviso quando a voz pedida não está instalada e outra foi usada no lugar. */
        note?: string | null;
        /** Ritmo que o motor realmente usou (pode ter subido para caber na marcação). */
        rate: number;
        /** Voz de IA: fator de velocidade que a tela aplica (o WAV vem na velocidade natural). */
        tempo?: number;
        seconds: number;
        /** true quando nem no ritmo máximo a fala coube na marcação. */
        overflow?: boolean;
        /** Qual motor falou: a voz de IA (Qwen3-TTS) ou a voz do Mac. */
        engine?: 'qwen' | 'mac';
        wavBase64: string;
      }>;
      /** Voz brasileira de IA do Maestro: programa, vozes e download do modelo. */
      maestroVoiceStatus?: () => Promise<MaestroVoiceStatus>;
      /** Avisa se uma música está tocando: o download da voz pausa durante o show. */
      maestroVoicePlaying?: (playing: boolean) => Promise<void>;
      separateStemsLocal?: (
        filename: string,
        audioData: ArrayBuffer
      ) => Promise<{
        vocals: ArrayBuffer;
        bass: ArrayBuffer;
        drums: ArrayBuffer;
        other: ArrayBuffer;
        guitar?: ArrayBuffer | null;
        piano?: ArrayBuffer | null;
      }>;
      /** Para a separação por IA em andamento (botão Cancelar do diálogo). */
      cancelStemSeparation?: () => Promise<boolean>;
      /** Separa a bateria já isolada em peças (bumbo, caixa, pratos, tons). */
      separateDrumPieces?: (drumsWav: ArrayBuffer) => Promise<DrumPiecesResult>;
      /** Se a separação da bateria está pronta (modelo baixado e runtime instalado). */
      drumPiecesStatus?: () => Promise<{ ready: boolean; state: string; progress: number; error?: string | null }>;
      /** Abre o painel do macOS para baixar as vozes premium (Luciana Premium). */
      openVoiceSettings?: () => Promise<boolean>;
      onSeparationProgress?: (cb: (data: { percent: number; message: string }) => void) => () => void;
      onRemoteTransport?: (cb: (cmd: { action: string; songId?: string }) => void) => () => void;
      /** Projeto aberto no Finder: caminho no disco (a tela lê por projectFileUrl). */
      onOpenProjectFile?: (cb: (file: { name: string; path: string }) => void) => () => void;
      projectFileUrl?: (filePath: string) => string;
      /** Avisa o app do Mac que o pedido de abrir projeto foi atendido (abriu, cancelou ou falhou). */
      projectTaken?: () => void;
      /** Avisa o app do Mac se o projeto tem alteração não salva (fechar ou sair pergunta antes). */
      setProjectUnsaved?: (unsaved: boolean, projectName: string) => void;
      /** A pessoa escolheu "Salvar" ao fechar: a tela salva e responde se deu certo. */
      onSaveBeforeClose?: (cb: () => Promise<boolean>) => () => void;
      notifySessionState?: (active: boolean) => void;
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
  // O programa instalado é o do processador errado (Intel num Mac com chip Apple): a
  // atualização só troca pelo instalador certo, igual à versão.
  archSwap?: boolean;
}

/**
 * PIN vindo no link / QR code (`#pin=123456`). É lido uma vez e apagado do endereço, para não
 * ficar à vista nem ir parar em favoritos.
 */
export function takePinFromLink(): string | null {
  try {
    const m = /(?:^#|[#&])pin=(\d{6})\b/.exec(window.location.hash);
    if (!m) return null;
    const rest = window.location.hash.replace(/[#&]?pin=\d{6}/, '').replace(/^#?&?/, '');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`);
    return m[1];
  } catch {
    return null;
  }
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
  remote: 'Controle Celular',
};
