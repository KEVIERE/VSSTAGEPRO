export interface ShowLive {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  songProgress: number;
  nextSongCountdown: number;
  currentSongId: string | null;
  nextSongId: string | null;
  bpm: number | null;
  playFlow: string;
  onAir: boolean;
  publishedAt: number;
  /** Música do medley tocando agora e a próxima que vai tocar */
  sliceName?: string | null;
  nextSliceName?: string | null;
  /** Id da parte do medley tocando agora e da próxima (para trocar o caderno sozinho) */
  sliceId?: string | null;
  nextSliceId?: string | null;
  /** Tuner (meios-tons) no ponto em que a música está: num medley, o da parte tocando */
  tuner?: number | null;
}

export type SignalStatus = 'live' | 'nosignal' | 'ended';

export interface LiveView {
  status: SignalStatus;
  isPlaying: boolean;
  currentTime: number;
  songProgress: number;
  nextSongCountdown: number;
}

export interface SetlistSong {
  id: string;
  name: string;
  duration: number;
  bpm?: number | null;
  baseBpm?: number | null;
  bpmAdjust?: number;
  tuner?: number;
  /** Tom original da música (cifra curta); com o tuner vira o tom que soa. */
  musicKey?: string;
  blockId: string | null;
  /** Partes de um medley (música fatiada), em ordem; cada uma tem seu próprio caderno */
  parts?: SetlistPart[];
}

export interface SetlistPart {
  id: string;
  name: string;
  start: number;
  end: number;
  /** false = o diretor pula esta parte */
  enabled?: boolean;
  /** BPM desta parte (cada parte do medley pode tocar num andamento); sem ele vale o da música */
  bpmAdjust?: number;
}

export interface SetlistBlock {
  id: string;
  name: string;
  color: string;
}

export interface Setlist {
  songs: SetlistSong[];
  blocks: SetlistBlock[];
  order: string[];
}

export interface MusicianInfo {
  id: string;
  name: string;
  instrument: string;
}

export interface MusicianState {
  musician: MusicianInfo;
  show: {
    name: string;
    setlist: Setlist;
    live: ShowLive;
    live_at: string;
  };
  server_now: string;
}

export interface SheetInfo {
  id: string;
  song_id: string;
  title: string;
  content: string;
  shared_from: string | null;
  updated_at: string;
  /** Hora em que a cópia chegou de um colega. Igual a `updated_at`: cópia em que o músico não mexeu. */
  received_at?: string | null;
}

export interface ColleagueInfo {
  id: string;
  name: string;
  instrument: string;
}

/**
 * Botão "Salvar" do músico na Rede Local: como ficou o arquivo do projeto no Mac do diretor.
 * - saved: gravado agora
 * - later: o diretor está tocando; grava assim que a música parar
 * - no_file: o projeto nunca foi salvo (o diretor precisa salvar uma vez)
 * - error: não deu para gravar
 * - unavailable: o programa não tem essa função
 */
export type ProjectSaveStatus = 'saved' | 'later' | 'no_file' | 'error' | 'unavailable';

export const PROJECT_SAVE_STATUSES: readonly ProjectSaveStatus[] = ['saved', 'later', 'no_file', 'error', 'unavailable'];

export interface ShareResult {
  count: number;
  skipped: string[];
}

/** Resposta do envio (online ou Rede Local). Servidor antigo, sem `skipped`: ninguém foi pulado. */
export function readShareResult(data: Record<string, unknown>): ShareResult {
  const skipped = Array.isArray(data.skipped) ? data.skipped.filter((v): v is string => typeof v === 'string') : [];
  return { count: Number(data.count) || 0, skipped };
}

/** Where a musician's sheets live: the online account or the director's Mac on the local network. */
export interface SheetBackend {
  key: string;
  /** Text used where the sheets are stored, e.g. "na sua conta". */
  storedIn: string;
  save(sheetId: string | null, songId: string, title: string, content: string): Promise<string>;
  /** Rede Local: pede ao Mac do diretor para gravar o projeto (onde moram os cadernos). */
  saveProject?(): Promise<ProjectSaveStatus>;
  remove(sheetId: string): Promise<void>;
  songLyrics(songId: string): Promise<string[]>;
  colleagues(): Promise<ColleagueInfo[]>;
  /**
   * Envia o caderno para colegas. `count`: quantos receberam. `skipped`: ids dos colegas que já
   * tinham caderno desta música (feito por eles ou cópia em que mexeram) e ficaram com o deles.
   */
  share(sheetId: string, targets: string[]): Promise<ShareResult>;
  /** Foto de perfil (só na Área do Músico online). */
  avatar?(): Promise<string | null>;
  setAvatar?(avatar: string | null): Promise<void>;
}

export type MemberStatus = 'pending' | 'approved' | 'blocked';

export interface DirectorMusician {
  id: string;
  name: string;
  instrument: string;
  code: string;
  online: boolean;
  status: MemberStatus;
  has_account: boolean;
  created_at: string;
}

export interface Membership {
  id: string;
  show_name: string;
  status: MemberStatus;
  name: string;
  instrument: string;
}

export interface ShowInvite {
  invite_code: string;
  allow_code_login: boolean;
}
