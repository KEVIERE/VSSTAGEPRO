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
}

export interface ColleagueInfo {
  id: string;
  name: string;
  instrument: string;
}

/** Where a musician's sheets live: the online account or the director's Mac on the local network. */
export interface SheetBackend {
  key: string;
  /** Text used where the sheets are stored, e.g. "na sua conta". */
  storedIn: string;
  save(sheetId: string | null, songId: string, title: string, content: string): Promise<string>;
  remove(sheetId: string): Promise<void>;
  songLyrics(songId: string): Promise<string[]>;
  colleagues(): Promise<ColleagueInfo[]>;
  share(sheetId: string, targets: string[]): Promise<number>;
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
