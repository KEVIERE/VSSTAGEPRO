import { useSyncExternalStore } from 'react';
import type { Setlist, ShowLive } from '@/lib/musicianTypes';
import type { LyricPage } from '@/lib/prompterTypes';
import type { RemoteState } from '@/lib/remoteProtocol';

export type NetworkMode = 'online' | 'local';
export type LocalRole = 'musician' | 'producer' | 'screen' | 'remote';
export type PinRole = 'musician' | 'producer' | 'remote';

export interface LocalClient {
  id: string;
  role: LocalRole;
  name: string;
  address: string;
  lastSeen: number;
  /** músico com conta: a conta dele (para a lista de músicos mostrar quem está online) */
  accountId?: string | null;
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
  /** Estilo geral da letra (tamanho, cor, fonte, alinhamento, "sai antes"), cru do servidor. */
  lyricStyle?: unknown;
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
  /** Modo Show inteiro para o VS Stage Remote */
  remote?: RemoteState;
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
  applyLyricStyle?: (style: unknown) => Promise<boolean>;
  networkCheck: () => Promise<NetworkCheck[]>;
  openAction: (action: CheckAction) => Promise<void>;
  /** Contas dos músicos do projeto aberto (versões antigas do app não têm). */
  setMusicianBook?: (book: import('@/types').MusicianBook | null) => Promise<void>;
  onMusicianAccounts?: (cb: (change: { book?: { id: string }; account?: import('@/types').MusicianAccount }) => void) => () => void;
  /** Medidores dos faders para o VS Stage Remote (versões antigas do app não têm). */
  publishMeters?: (meters: import('@/lib/remoteProtocol').RemoteMeters) => void;
  /** Um músico apertou "Salvar": a tela grava o projeto e responde como ficou. */
  onProjectSaveRequest?: (cb: () => Promise<import('@/lib/musicianTypes').ProjectSaveStatus>) => () => void;
  /** Repertório do produtor na rede local (versões antigas do app não têm). */
  refStatus?: () => Promise<RepertoireStatusRaw>;
  refStart?: () => Promise<RepertoireStatusRaw>;
  refPut?: (songId: string, kind: 'audio' | 'words', data: ArrayBuffer | string) => Promise<void>;
  refTakeRequest?: () => Promise<string | null>;
}

/** Situação do repertório do produtor, no formato da nuvem e da rede local. */
export interface RepertoireStatusRaw {
  files?: { songId: string; updatedAt: string | null }[];
  words?: { songId: string; updatedAt: string | null }[];
  released_at?: string | null;
  requested_at?: string | null;
}

/** Leitor de letra no Mac (lyricsReader.js). */
export interface LyricsReaderStatus {
  supported: boolean;
  model: { state: 'missing' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'error'; progress: number; error: string | null };
  busy: boolean;
  /** Leitura em andamento: etapa, fração ouvida (0 a 1) e segundos desde o começo. */
  progress?: { stage: string; pct: number; elapsed: number } | null;
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

/** Stems separados no Mac, em bytes (WAV), pelo IPC. */
export interface LocalStemsBytes {
  vocals: ArrayBuffer;
  bass: ArrayBuffer;
  drums: ArrayBuffer;
  other: ArrayBuffer;
  guitar?: ArrayBuffer | null;
  piano?: ArrayBuffer | null;
}

/**
 * Faixas separadas deixadas no disco: `names` são as faixas que existem (vocals, bass... ou
 * bumbo, caixa...), cada uma em `stemFileUrl(token, nome)`. Depois de ler, `stemFilesRelease(token)`.
 */
export interface StemFilesReply {
  stemFiles: { token: string; names: string[] };
}

/** Modo de fala de uma tomada da voz clonada. 'normal' é obrigatório. */
export type CloneMode = 'normal' | 'calma' | 'forte';

/** Voz clonada pelo diretor. `id` é o do modo normal ("clone:<pasta>"); os outros modos usam "clone:<pasta>:calma" e "clone:<pasta>:forte". */
export interface ClonedVoice {
  id: string;
  name: string;
  gender: 'feminina' | 'masculina';
  created: string;
  /** modos gravados (sempre inclui 'normal') */
  modes: CloneMode[];
}

/** Detalhes da voz medidos na tomada tratada. */
export interface CloneAnalysis {
  /** tom médio (Hz), ou null se não deu para medir */
  pitchHz: number | null;
  range: 'grave' | 'média' | 'aguda' | null;
  /** volume da fala (dB, RMS das janelas com voz) */
  loudnessDb: number;
  /** pico (dB) */
  peakDb: number;
  brightness: 'escura' | 'equilibrada' | 'brilhante';
  /** velocidade da leitura */
  wordsPerMinute: number | null;
}

/** Como ficou a tomada depois do tratamento. */
export interface CloneReport {
  /** duração já sem as pausas (ideal de 6 a 10 s) */
  seconds: number;
  /** ruído de fundo em relação à voz (dB, mais negativo = mais limpo) */
  noiseDb: number;
  clipped: boolean;
  denoised: boolean;
  warnings: string[];
  analysis: CloneAnalysis;
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
      /** Arquitetura do programa ('arm64' ou 'x64'; 'x64' = versão Intel, nativa ou no Rosetta). */
      arch?: string;
      /**
       * RAM total do computador em bytes, lida uma vez na abertura (`os.totalmem()` do principal).
       * 0 ou ausente: programa antigo ou sem a medida; quem usa fica com a conta de antes.
       */
      totalMemory?: number;
      appReady: () => void;
      checkUpdate: (supabaseUrl: string) => Promise<UpdateInfo | null>;
      installUpdate: (info: UpdateInfo) => Promise<void>;
      onUpdateProgress: (cb: (pct: number) => void) => () => void;
      onManualUpdateCheck?: (cb: () => void) => () => void;
      /** Menu Visualizar → Modo Show (⌘M) do app do Mac */
      onMenuShowMode?: (cb: () => void) => () => void;
      /** Atalhos do usuário para os itens do menu do Mac/Windows (id do comando → accelerator). */
      setMenuShortcuts?: (map: Record<string, string>) => void;
      /** Item do menu do Mac/Windows que chama um comando da lista de atalhos. */
      onMenuCommand?: (cb: (id: string) => void) => () => void;
      hasLocalDemucs?: () => Promise<boolean>;
      /** Vozes do Maestro por IA instaladas no Mac. */
      maestroVoices?: () => Promise<Array<{ id: string; name: string; gender: string; locale: string; engine?: 'qwen' | 'mac'; clone?: boolean; modes?: CloneMode[] }>>;
      /** A fala de IA desta marcação já ficou pronta? (no processador ela é gerada em segundo plano) */
      maestroSpeechReady?: (payload: { text: string; voice: string; group?: string[] }) => Promise<boolean>;
      /** Situação da fala sem gerar nada: 'pronta' toca na hora. */
      maestroSpeechState?: (payload: { text: string; voice: string; group?: string[] }) => Promise<'pronta' | 'gerando' | 'na-fila' | 'falhou' | 'nao'>;
      /**
       * Desiste de esperar o maestroSpeak com este requestId (ele rejeita com "fala_cancelada").
       * A geração em andamento não é morta e o resultado fica no cache.
       */
      maestroSpeakCancel?: (requestId: string) => Promise<boolean>;
      /** Vozes clonadas pelo diretor (Clonar voz do Maestro). */
      maestroCloneList?: () => Promise<ClonedVoice[]>;
      /** Guarda a referência natural e devolve a tomada masterizada, para ouvir antes de salvar. Recusa tomada acima de 13 s. */
      maestroClonePrepare?: (payload: { wav: ArrayBuffer; mode: CloneMode; text: string }) => Promise<{ token: string; wavBase64: string; report: CloneReport }>;
      /** Guarda a voz com as tomadas tratadas (exige a 'normal'). */
      maestroCloneSave?: (payload: { name: string; gender: 'feminina' | 'masculina'; takes: Array<{ mode: CloneMode; token: string; text: string }> }) => Promise<ClonedVoice>;
      maestroCloneRemove?: (id: string) => Promise<boolean>;
      /** Aquece a voz de IA (motor aberto e referência preparada por 5 min). Chamar de novo renova. Nunca lança. */
      maestroWarm?: (voiceId: string) => Promise<boolean>;
      /** Minhas frases: grava a frase na voz para sempre (gera se precisar; pode levar minutos). */
      maestroPinPhrase?: (payload: { text: string; voice: string }) => Promise<'gravada' | 'cancelada'>;
      /** Apaga a gravação permanente da frase nessa voz. */
      maestroUnpinPhrase?: (payload: { text: string; voice: string }) => Promise<boolean>;
      /** Situação das frases numa voz, sem gerar nada (chave: o texto). */
      maestroPinnedStates?: (payload: { texts: string[]; voice: string }) => Promise<Record<string, 'gravada' | 'gravando' | 'falhou' | 'nao'>>;
      onMaestroCloneProgress?: (cb: (p: { percent: number; message: string }) => void) => () => void;
      /** Inicia ou retoma, em segundo plano, o pacote de contagem da voz clonada e modo. Nunca lança. */
      maestroCountPackEnsure?: (voiceId: string) => Promise<boolean>;
      /** Situação do pacote de contagem, sem gerar nada. */
      maestroCountPackStatus?: (voiceId: string) => Promise<{ state: 'pronta' | 'gerando' | 'na-fila' | 'parcial' | 'nao' | 'falhou'; done: number; total: number; error?: string | null }>;
      /** O número já gravado, sem chamar o modelo. null se ainda não existe. */
      maestroCountWord?: (payload: { voice: string; word: string }) => Promise<{ wavBase64: string; seconds: number } | null>;
      onMaestroCountPackProgress?: (cb: (p: { voice: string; state: string; done: number; total: number }) => void) => () => void;
      /** Pacotes de falas prontas baixados uma vez. "recorded" só traz versão completa e conferida. */
      maestroPackStatus?: () => Promise<Array<{
        voice: 'will' | 'carla';
        state: 'indisponivel' | 'baixando' | 'pausado' | 'pronto' | 'erro';
        progress: number;
        recorded: { normal: string[]; calma: string[]; forte: string[] };
      }>>;
      /** MP3 de uma fala do pacote, lido do disco na hora. null se essa voz não tem a gravação. */
      maestroPackFile?: (payload: { voice: 'will' | 'carla'; mode: 'normal' | 'calma' | 'forte'; id: string }) => Promise<ArrayBuffer | null>;
      onMaestroPackProgress?: (cb: (p: {
        voice: 'will' | 'carla';
        state: 'indisponivel' | 'baixando' | 'pausado' | 'pronto' | 'erro';
        progress: number;
      }) => void) => () => void;
      /** Gera a fala com uma voz online gratuita (áudio em base64). */
      maestroOnlineSpeak?: (payload: { text: string; voice: string }) => Promise<{ voice: string; mime: string; audioBase64: string }>;
      /** Gera o áudio de uma narração do Maestro com a voz do sistema (WAV em base64). */
      maestroSpeak?: (payload: {
        text: string;
        voice: string;
        wpm: number;
        span?: number;
        pace?: number;
        group?: string[];
        /** Identifica o pedido para o maestroSpeakCancel. */
        requestId?: string;
        /** 'fundo': atualização automática, atrás do que o diretor pedir. Padrão: 'usuario'. */
        priority?: 'usuario' | 'fundo';
        /** false: se a voz de IA não puder falar, dá erro em vez de usar a voz do sistema (prévia). */
        fallback?: boolean;
      }) => Promise<{
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
        /** A voz de IA está sendo gerada em segundo plano; esta saiu com a voz do sistema. */
        preparing?: boolean;
        wavBase64: string;
      }>;
      /** Voz brasileira de IA do Maestro: programa, vozes e download do modelo. */
      maestroVoiceStatus?: () => Promise<MaestroVoiceStatus>;
      /** Avisa se uma música está tocando: o download da voz pausa durante o show. */
      maestroVoicePlaying?: (playing: boolean) => Promise<void>;
      /** Leitor de letra no Mac: situação, download do modelo e leitura de uma música (WAV). */
      lyricsReaderStatus?: () => Promise<LyricsReaderStatus>;
      lyricsReaderPrepare?: () => Promise<LyricsReaderStatus>;
      lyricsTranscribe?: (wav: ArrayBuffer, opts?: { separate?: boolean }) => Promise<{ segments: unknown[]; seconds: number | null } | { why: string }>;
      lyricsTranscribeCancel?: () => Promise<boolean>;
      separateStemsLocal?: {
        (filename: string, audioData: ArrayBuffer): Promise<LocalStemsBytes>;
        /**
         * Entrada pelo caminho do arquivo (`{ path }`, de pathForFile) e, com `files: true`, as
         * faixas ficam no disco: lidas por stemFileUrl e soltas com stemFilesRelease. Quem separa
         * ainda sem esse modo devolve os bytes, como na forma de cima.
         */
        (filename: string, audioData: ArrayBuffer | { path: string }, opts: { files?: boolean }): Promise<LocalStemsBytes | StemFilesReply>;
      };
      /** Para a separação por IA em andamento (botão Cancelar do diálogo). */
      cancelStemSeparation?: () => Promise<boolean>;
      /** Separa a bateria já isolada em peças (bumbo, caixa, pratos, tons). */
      separateDrumPieces?: {
        (drumsWav: ArrayBuffer): Promise<DrumPiecesResult>;
        /** Mesmo pedido, com entrada pelo caminho e peças no disco (ver separateStemsLocal). */
        (drumsWav: ArrayBuffer | { path: string }, opts: { files?: boolean }): Promise<DrumPiecesResult | (StemFilesReply & { why?: string })>;
      };
      /** Endereço de uma faixa deixada no disco pela separação (vsstage://stems/<código>/<nome>.wav). */
      stemFileUrl?: (token: string, name: string) => string;
      /** A tela terminou de ler as faixas do código: a pasta temporária sai. */
      stemFilesRelease?: (token: string) => Promise<boolean>;
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
      /** Última conferência da conta guardada no Mac (criptografada), para abrir sem internet. */
      licenseCacheLoad?: () => Promise<import('@/lib/offlineLicense').LicenseCache | null>;
      licenseCacheSave?: (userId: string, license: object) => Promise<boolean>;
      licenseCacheClear?: () => Promise<void>;
      /** quem é este Mac (um Mac por vez em cada conta) */
      deviceInfo?: () => Promise<{ id: string; name: string }>;
      /** Entrar com o Google: abre o retorno local e diz o endereço (ou o erro de porta ocupada). */
      googleAuthPrepare?: () => Promise<{ redirectTo?: string; error?: string }>;
      /** Abre o Google no navegador padrão e espera o retorno. */
      googleAuthWait?: (authUrl: string) => Promise<{ status: 'ok' | 'error' | 'cancelled' | 'timeout'; code?: string; error?: string; description?: string }>;
      googleAuthCancel?: () => Promise<void>;
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

/**
 * Em que modo este cliente está.
 *
 * Dois caminhos levam à Rede Local, e o segundo era esquecido: (1) o app instalado no Mac do
 * diretor, que tem a ponte `window.vsLocal`; (2) um celular/TV/navegador abrindo a página servida
 * pelo próprio Mac, onde só existe a marca `window.__VS_LOCAL__` injetada pelo servidor HTTP.
 *
 * Sem o segundo caso, quem estava na rede pelo navegador era lido como "online": aparecia o botão
 * "Solicitar repertório" — que no modo local não tem para onde ir (o áudio não passa pela nuvem)
 * — e o produtor via "Não foi possível enviar o pedido" sem entender o motivo.
 */
function readMode(): NetworkMode {
  // Página servida pelo próprio Mac na rede local: não há escolha a fazer, ela só existe ali.
  // O `__VS_LOCAL__` é injetado pelo servidor HTTP, então é a marca mais confiável deste caso.
  if (isLocalClient()) return 'local';
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
  remote: 'VS Stage Remote',
};
