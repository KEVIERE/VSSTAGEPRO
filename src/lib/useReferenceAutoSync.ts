import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/store';
import {
  directorReferenceStatus, directorStartSend, directorTakeRepertoireRequest, encodeWav16, parseReferenceStatus,
  renderReference, uploadReferenceBlob, uploadSongWords, type ReferenceStatus,
} from '@/lib/prompterAudio';
import { renderGuideForSong, songHasGuide } from '@/lib/bounceEngine';
import { localBridge, useNetworkMode, type LyricsReaderStatus } from '@/lib/localNetwork';
import type { SavedShow } from '@/lib/useLiveBroadcast';
import type { ProjectState, Song } from '@/types';

/**
 * Repertório para o produtor (aba Letras): o áudio de cada música, e a letra lida pelo Mac.
 *
 * Regras (iguais online e na rede local):
 * - Nada sobe sozinho: o diretor aperta "Enviar repertório".
 * - Enquanto o envio vale, música que muda (corte, BPM, tom) sobe de novo.
 * - O produtor salvou as letras: 10 minutos depois o áudio some (do Supabase ou do Mac).
 * - Para o produtor ouvir de novo, o diretor envia de novo. O pedido do produtor vira um aviso.
 * - "Enviar repertório" manda só o áudio. A letra é outro botão, "Enviar letras": o diretor
 *   marca de quais músicas quer a letra automática (a lista avisa quais já têm letra). O Mac
 *   ouve a faixa Guia só dessas, uma por vez, e nunca enquanto o play está rodando.
 */

const IDLE_MS = 6000;
// A leitura da letra começa logo depois que o áudio da música subiu, junto com o envio das outras.
const READ_DELAY_MS = 1500;
// De quanto em quanto tempo o programa confere o pedido do produtor e a situação do envio.
const POLL_MS = 20000;
const READER_POLL_MS = 4000;
const READER_READING_POLL_MS = 1000;
const sigKey = (scope: string) => `prompter-ref-sigs:${scope}`;
const wordKey = (scope: string) => `prompter-word-sigs:${scope}`;
const selectKey = (scope: string) => `prompter-ref-select:${scope}`;
const lyricsKey = (scope: string) => `prompter-ref-lyrics:${scope}`;
const haltKey = (scope: string) => `prompter-ref-halt:${scope}`;

/** Uma música na lista de escolha do envio. */
export interface RepertoireSong {
  id: string;
  name: string;
  /** Já está com o produtor, na versão atual. */
  withProducer: boolean;
  /** Está com o produtor, mas o som mudou depois (corte, BPM, tom). */
  outdated: boolean;
  /** Escolhida para este envio. */
  selected: boolean;
  /** A letra lida pelo Mac já está com o produtor. */
  lyricsRead: boolean;
  /** O diretor pediu a letra automática desta música. */
  lyricsAsked: boolean;
  /** Já tem letra no projeto (o leitor não precisa ouvir). */
  hasLyrics: boolean;
  /** Tem voz na faixa Guia (sem Guia não há letra automática). */
  hasGuide: boolean;
}

export type RepertoireMode = 'online' | 'local';

export interface ReferenceSync {
  /** Para onde vai o repertório (null: sem show online e sem rede local). */
  mode: RepertoireMode | null;
  /** Há um envio valendo: o áudio está (ou está indo) para o produtor. */
  active: boolean;
  /** O clique em "Enviar repertório" está sendo confirmado pelo servidor. */
  starting: boolean;
  ready: number;
  total: number;
  working: string | null;
  failed: string[];
  offline: boolean;
  /** O produtor salvou as letras: o áudio sai 10 minutos depois deste horário. */
  releasedAt: number | null;
  /** O áudio já saiu depois do "Salvar" do produtor. */
  cleared: boolean;
  /** Quando o produtor pediu o repertório (null = sem pedido). */
  requestedAt: number | null;
  /** Leitor de letra do Mac (null: programa sem o leitor, ou fora do app do Mac). */
  reader: LyricsReaderStatus | null;
  /** Músicas sem letra (e com faixa Guia) que já têm a letra lida, de quantas. */
  lyricsReady: number;
  lyricsTotal: number;
  /** Músicas sem letra e sem faixa Guia: não há voz para ler. */
  noGuide: string[];
  /** Música que o leitor está lendo agora. */
  reading: string | null;
  lyricsFailed: string[];
  /** Envia o áudio das músicas escolhidas (as já enviadas que forem escolhidas sobem de novo). Sem lista: continua o envio anterior. */
  send: (ids?: string[]) => void;
  /** Pede a letra automática das músicas escolhidas (o áudio delas vai junto, se ainda não foi). */
  sendLyrics: (ids: string[]) => void;
  /** Para o envio e a leitura da letra na hora (o que já subiu continua com o produtor). */
  stop: () => void;
  /** O diretor parou o envio. */
  halted: boolean;
  /** Músicas do projeto, para escolher o que enviar. */
  songs: RepertoireSong[];
  /** Andamento da letra que está sendo lida agora (0 a 1) e há quantos segundos. */
  readProgress: { pct: number; elapsed: number } | null;
  retry: () => void;
  /** Reenvia tudo, mesmo o que já subiu (ação manual do diretor). */
  resendAll: () => void;
  /** Fecha o aviso do pedido. */
  dismissRequest: () => void;
}

interface Backend {
  mode: RepertoireMode;
  scope: string;
  status: () => Promise<ReferenceStatus>;
  start: () => Promise<void>;
  putAudio: (songId: string, mp3: Blob) => Promise<void>;
  putWords: (songId: string, json: string) => Promise<void>;
  takeRequest: () => Promise<string | null>;
}

function cloudBackend(show: SavedShow): Backend {
  return {
    mode: 'online',
    scope: show.showId,
    status: () => directorReferenceStatus(show.showId, show.directorKey),
    start: () => directorStartSend(show.showId, show.directorKey),
    putAudio: (id, mp3) => uploadReferenceBlob(show.showId, show.directorKey, id, mp3),
    putWords: (id, json) => uploadSongWords(show.showId, show.directorKey, id, json),
    takeRequest: () => directorTakeRepertoireRequest(show.showId, show.directorKey),
  };
}

function localBackend(): Backend | null {
  const b = localBridge();
  if (!b?.refStatus || !b.refStart || !b.refPut || !b.refTakeRequest) return null;
  return {
    mode: 'local',
    scope: 'rede-local',
    status: async () => parseReferenceStatus(await b.refStatus!()),
    start: async () => { await b.refStart!(); },
    putAudio: async (id, mp3) => b.refPut!(id, 'audio', await mp3.arrayBuffer()),
    putWords: (id, json) => b.refPut!(id, 'words', json),
    takeRequest: () => b.refTakeRequest!(),
  };
}

function orderedSongs(st: Pick<ProjectState, 'songs' | 'playlistOrder'>): Song[] {
  const list = st.playlistOrder.map((id) => st.songs.find((s) => s.id === id)).filter((s): s is Song => !!s);
  return list.length ? list : st.songs;
}

// Tudo o que muda o som da mixagem LR: se mudar, a música é enviada de novo.
function soundSignature(song: Song, st: ProjectState): string {
  const clips = st.clips
    .filter((c) => c.songId === song.id)
    .map((c) => [c.id, c.trackId, c.startTime.toFixed(3), (c.trimEnd ?? 0).toFixed(3)].join(':'))
    .sort();
  const tracks = st.tracks.map((t) => [t.id, t.volume.toFixed(2), t.pan.toFixed(2), t.mute ? 1 : 0, t.parentId ?? ''].join(':'));
  return JSON.stringify([song.bpmAdjust || 0, song.tuner || 0, st.lrMasterActive, clips, tracks]);
}

function loadMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function saveMap(key: string, value: Record<string, string>) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* cheio */ }
}

const hasLyrics = (st: ProjectState, id: string) => (st.lyricMaps?.[id]?.length ?? 0) > 0;
/** Música que o leitor deve ouvir: o diretor pediu a letra dela e ela tem voz na faixa Guia. */
const wantsLyrics = (s: Song, st: ProjectState, asked: Set<string>) => asked.has(s.id) && songHasGuide(s, st);

export function useReferenceAutoSync(show: SavedShow | null): ReferenceSync {
  const songs = useStore((s) => s.songs);
  const clips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  const playlistOrder = useStore((s) => s.playlistOrder);
  const lrMasterActive = useStore((s) => s.lrMasterActive);
  const lyricMaps = useStore((s) => s.lyricMaps);
  const isPlaying = useStore((s) => s.transport.isPlaying);
  const netMode = useNetworkMode();

  // Só troca quando muda o modo ou o show de verdade: um objeto novo do mesmo show (a cada
  // conferência do show online) não pode zerar um envio em andamento.
  const showId = show?.showId ?? null;
  const directorKey = show?.directorKey ?? null;
  const backend = useMemo<Backend | null>(() => {
    if (netMode === 'local') return localBackend();
    return showId && directorKey ? cloudBackend({ showId, directorKey }) : null;
  }, [netMode, showId, directorKey]);

  const [sent, setSent] = useState<Set<string> | null>(null);
  const [words, setWords] = useState<Set<string>>(new Set());
  const [sigs, setSigs] = useState<Record<string, string>>({});
  const [wordSigs, setWordSigs] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [failedSigs, setFailedSigs] = useState<Record<string, string>>({});
  const [failedWords, setFailedWords] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState(false);
  const [releasedAt, setReleasedAt] = useState<number | null>(null);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [sendRequested, setSendRequested] = useState(false);
  const [reader, setReader] = useState<LyricsReaderStatus | null>(null);
  const [round, setRound] = useState(0);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [halted, setHalted] = useState(false);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const running = useRef(false);
  const readingNow = useRef(false);
  const haltRef = useRef(false);
  haltRef.current = halted;

  const applyStatus = useCallback((st: ReferenceStatus) => {
    setSent(new Set(st.files.keys()));
    setWords(new Set(st.words.keys()));
    setReleasedAt(st.releasedAt && !st.requestedAt ? Date.parse(st.releasedAt) : null);
    if (st.releasedAt && !st.requestedAt) setSendRequested(false);
    setOffline(false);
  }, []);

  // Trocou de show ou de modo (online/rede local): começa do zero.
  useEffect(() => {
    setSent(null);
    setWords(new Set());
    setFailedSigs({});
    setFailedWords({});
    setReleasedAt(null);
    setRequestedAt(null);
    setSendRequested(false);
    if (!backend) return;
    setSigs(loadMap(sigKey(backend.scope)));
    setWordSigs(loadMap(wordKey(backend.scope)));
    try {
      const sel = JSON.parse(localStorage.getItem(selectKey(backend.scope)) ?? 'null');
      setSelected(Array.isArray(sel) ? new Set(sel.filter((x: unknown) => typeof x === 'string')) : null);
      setHalted(localStorage.getItem(haltKey(backend.scope)) === '1');
      const ak = JSON.parse(localStorage.getItem(lyricsKey(backend.scope)) ?? '[]');
      setAsked(new Set(Array.isArray(ak) ? ak.filter((x: unknown) => typeof x === 'string') : []));
    } catch {
      setSelected(null);
      setHalted(false);
    }
  }, [backend]);

  // Situação ao abrir, depois de cada envio e a cada 20 s: o que já está com o produtor, se ele
  // salvou, se pediu. (Antes este efeito também zerava o "envio pedido": o clique em "Enviar
  // repertório" era desfeito na mesma hora e nada subia.)
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    const check = async () => {
      try {
        const at = await backend.takeRequest();
        if (!cancelled && at) setRequestedAt(Date.parse(at));
        const st = await backend.status();
        if (!cancelled) applyStatus(st);
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    void check();
    const id = window.setInterval(check, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [backend, round, applyStatus]);

  const active = !!backend && releasedAt === null && !halted && ((sent?.size ?? 0) > 0 || sendRequested);
  // Sem escolha do diretor, nada novo sobe: só as que já estão com o produtor ficam em dia.
  const inSelection = useCallback((id: string) => selected !== null && selected.has(id), [selected]);

  // Leitor de letra: situação (download do modelo e andamento da leitura) enquanto o envio vale.
  // Lendo, pergunta a cada segundo: é o que move a barra de progresso da letra.
  const isReading = reading !== null;
  useEffect(() => {
    const desk = window.vsDesktop;
    if (!desk?.lyricsReaderStatus) { setReader(null); return; }
    let alive = true;
    const tick = () => desk.lyricsReaderStatus!().then((s) => { if (alive) setReader(s.supported ? s : null); }).catch(() => {});
    tick();
    if (!active) return () => { alive = false; };
    const id = window.setInterval(tick, isReading ? READER_READING_POLL_MS : READER_POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [active, isReading]);

  // Play começou: a leitura em andamento para na hora (volta quando o programa ficar parado).
  useEffect(() => {
    if (isPlaying && readingNow.current) void window.vsDesktop?.lyricsTranscribeCancel?.().catch(() => {});
  }, [isPlaying]);

  // 1. Áudio de cada música (MP3 leve).
  useEffect(() => {
    if (!backend || !sent || !active || isPlaying || running.current) return;
    const timer = window.setTimeout(async () => {
      const st = useStore.getState();
      const pending = orderedSongs(st).filter((s) => {
        const sig = soundSignature(s, st);
        if (failedSigs[s.id] === sig) return false;
        // escolhida e ainda não está com o produtor (ou foi escolhida para subir de novo)
        if (inSelection(s.id) && (!sent.has(s.id) || sigs[s.id] !== sig)) return true;
        // já está com o produtor e o som mudou: atualiza
        return sent.has(s.id) && sigs[s.id] !== undefined && sigs[s.id] !== sig;
      });
      if (pending.length === 0) return;
      running.current = true;
      for (const song of pending) {
        const now = useStore.getState();
        if (now.transport.isPlaying || haltRef.current) break;
        const fresh = now.songs.find((s) => s.id === song.id);
        if (!fresh) continue;
        const sig = soundSignature(fresh, now);
        setWorking(fresh.name);
        try {
          await backend.putAudio(fresh.id, await renderReference(fresh));
          // O som mudou (corte, BPM, tom): a letra lida antes não bate mais com o áudio.
          const before = sigs[fresh.id];
          if (before !== undefined && before !== sig) {
            setWordSigs((prev) => {
              const m = { ...prev, [fresh.id]: 'som-mudou' };
              saveMap(wordKey(backend.scope), m);
              return m;
            });
          }
          setSent((prev) => new Set(prev ?? []).add(fresh.id));
          setSigs((prev) => {
            const next = { ...prev, [fresh.id]: sig };
            saveMap(sigKey(backend.scope), next);
            return next;
          });
          setFailedSigs((prev) => { const next = { ...prev }; delete next[fresh.id]; return next; });
        } catch {
          setFailedSigs((prev) => ({ ...prev, [fresh.id]: sig }));
        }
      }
      setWorking(null);
      running.current = false;
    }, IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [backend, sent, sigs, failedSigs, isPlaying, songs, clips, tracks, playlistOrder, lrMasterActive, active, inSelection]);

  // 2. Letra lida pelo Mac, só das músicas que ainda não têm letra (uma por vez, com o programa parado).
  // Depende só de "o leitor está pronto" (um booleano): a situação do leitor chega a cada 4 s
  // como objeto novo, e depender dela zerava a espera de 6 s antes de começar, para sempre.
  const readerReady = !!reader?.supported && reader.model.state === 'ready';
  useEffect(() => {
    const desk = window.vsDesktop;
    // Não espera o envio das outras músicas: lê cada uma assim que o áudio dela subiu.
    if (!backend || !sent || !active || isPlaying || readingNow.current) return;
    if (!desk?.lyricsTranscribe || !readerReady) return;
    const timer = window.setTimeout(async () => {
      const st = useStore.getState();
      const next = orderedSongs(st).find((s) => {
        const sig = soundSignature(s, st);
        return sent.has(s.id) && sigs[s.id] === sig && wantsLyrics(s, st, asked)
          // A letra lida vale enquanto o som for o mesmo. Sem registro deste Mac (outro computador,
          // memória apagada), a que já está lá vale: ler de novo leva minutos.
          && !(words.has(s.id) && (wordSigs[s.id] === undefined || wordSigs[s.id] === sig))
          && failedWords[s.id] !== sig;
      });
      if (!next) return;
      readingNow.current = true;
      const sig = soundSignature(next, st);
      setReading(next.name);
      try {
        // Só a faixa Guia (a voz), no mesmo tempo do áudio do produtor: sem separar nada.
        const wav = encodeWav16(await renderGuideForSong(next, useStore.getState()));
        if (useStore.getState().transport.isPlaying || haltRef.current) return;
        const res = await desk.lyricsTranscribe!(wav, { separate: false });
        if ('why' in res) {
          // Play começou ou o modelo ainda está baixando: tenta de novo depois, sem marcar erro.
          if (res.why !== 'canceled' && res.why !== 'model_missing' && res.why !== 'busy') {
            setFailedWords((prev) => ({ ...prev, [next.id]: sig }));
          }
          return;
        }
        await backend.putWords(next.id, JSON.stringify({ segments: res.segments }));
        setWords((prev) => new Set(prev).add(next.id));
        setWordSigs((prev) => {
          const m = { ...prev, [next.id]: sig };
          saveMap(wordKey(backend.scope), m);
          return m;
        });
      } catch {
        setFailedWords((prev) => ({ ...prev, [next.id]: sig }));
      } finally {
        readingNow.current = false;
        setReading(null);
      }
    }, READ_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [backend, sent, sigs, words, wordSigs, failedWords, isPlaying, active, readerReady, lyricMaps, songs, clips, tracks, asked]);

  const [starting, setStarting] = useState(false);
  const send = useCallback((ids?: string[], opts?: { resend?: boolean }) => {
    if (!backend) return;
    setStarting(true);
    setFailedSigs({});
    setFailedWords({});
    setHalted(false);
    haltRef.current = false;
    try { localStorage.removeItem(haltKey(backend.scope)); } catch { /* ignore */ }
    if (ids) {
      setSelected(new Set(ids));
      try { localStorage.setItem(selectKey(backend.scope), JSON.stringify(ids)); } catch { /* ignore */ }
      // A escolha do diretor: as que já estavam com o produtor e foram marcadas sobem de novo.
      if (opts?.resend !== false) {
        setSigs((prev) => {
          const m = { ...prev };
          for (const id of ids) delete m[id];
          saveMap(sigKey(backend.scope), m);
          return m;
        });
      }
    }
    void window.vsDesktop?.lyricsReaderPrepare?.().then((s) => setReader(s.supported ? s : null)).catch(() => {});
    // Só começa a subir depois que o servidor (ou o Mac, na rede local) aceitou o envio novo:
    // senão o áudio subiria com a marca de "produtor já salvou" e seria apagado na hora.
    backend.start()
      .then(() => {
        setSendRequested(true);
        setReleasedAt(null);
        setRequestedAt(null);
        setOffline(false);
        setRound((r) => r + 1);
      })
      .catch(() => setOffline(true))
      .finally(() => setStarting(false));
  }, [backend]);

  const retry = useCallback(() => {
    setFailedSigs({});
    setFailedWords({});
    setRound((r) => r + 1);
  }, []);

  const sendLyrics = useCallback((ids: string[]) => {
    if (!backend) return;
    // Só as marcadas são lidas. Marcada que já tinha letra lida: lê de novo.
    setAsked(new Set(ids));
    try { localStorage.setItem(lyricsKey(backend.scope), JSON.stringify(ids)); } catch { /* ignore */ }
    setWordSigs((prev) => {
      const m = { ...prev };
      for (const id of ids) if (words.has(id)) m[id] = 'ler-de-novo';
      saveMap(wordKey(backend.scope), m);
      return m;
    });
    // O áudio delas vai junto (sem reenviar o que já está com o produtor).
    const union = new Set([...(selected ?? []), ...ids]);
    send([...union], { resend: false });
  }, [backend, words, selected, send]);

  const resendAll = useCallback(() => {
    // Reenvia o áudio de todas. A letra lida continua valendo: ela só é lida de novo se o som
    // mudar (antes este botão fazia o Mac ler todas as letras outra vez, minutos por música).
    send(orderedSongs(useStore.getState()).map((s) => s.id));
  }, [send]);

  const stop = useCallback(() => {
    if (!backend) return;
    setHalted(true);
    haltRef.current = true;
    setSendRequested(false);
    try { localStorage.setItem(haltKey(backend.scope), '1'); } catch { /* ignore */ }
    void window.vsDesktop?.lyricsTranscribeCancel?.().catch(() => {});
  }, [backend]);

  const dismissRequest = useCallback(() => setRequestedAt(null), []);

  const st = { songs, clips, tracks, playlistOrder, lrMasterActive, lyricMaps } as ProjectState;
  const all = orderedSongs(st);
  // O envio vale para as escolhidas e as que já estão com o produtor.
  const list = all.filter((s) => inSelection(s.id) || !!sent?.has(s.id));
  // Sem registro deste Mac (outro computador, memória apagada), a que está lá conta como em dia.
  const isCurrent = (s: Song) => !!sent?.has(s.id) && (sigs[s.id] === undefined || sigs[s.id] === soundSignature(s, st));
  const ready = list.filter(isCurrent).length;
  const failed = list.filter((s) => failedSigs[s.id] !== undefined).map((s) => s.name);
  const needLyrics = list.filter((s) => wantsLyrics(s, st, asked));
  const noGuide = all.filter((s) => asked.has(s.id) && !songHasGuide(s, st)).map((s) => s.name);
  const lyricsReady = needLyrics.filter((s) => words.has(s.id) && (wordSigs[s.id] === undefined || wordSigs[s.id] === soundSignature(s, st))).length;
  const lyricsFailed = needLyrics.filter((s) => failedWords[s.id] !== undefined).map((s) => s.name);

  const songRows: RepertoireSong[] = all.map((s) => {
    const sig = soundSignature(s, st);
    const onServer = !!sent?.has(s.id);
    return {
      id: s.id,
      name: s.name,
      withProducer: onServer && (sigs[s.id] === undefined || sigs[s.id] === sig),
      outdated: onServer && sigs[s.id] !== undefined && sigs[s.id] !== sig,
      selected: selected === null ? !onServer : selected.has(s.id),
      lyricsRead: words.has(s.id) && (wordSigs[s.id] === undefined || wordSigs[s.id] === sig),
      lyricsAsked: asked.has(s.id),
      hasLyrics: hasLyrics(st, s.id),
      hasGuide: songHasGuide(s, st),
    };
  });
  const rp = reader?.progress ?? null;

  return {
    mode: backend?.mode ?? null,
    stop,
    halted,
    songs: songRows,
    readProgress: rp && reading ? { pct: rp.pct, elapsed: rp.elapsed } : null,
    active,
    starting,
    ready,
    total: list.length,
    working,
    failed,
    offline,
    releasedAt,
    cleared: releasedAt !== null && (sent?.size ?? 0) === 0,
    requestedAt,
    reader,
    lyricsReady,
    lyricsTotal: needLyrics.length,
    noGuide,
    reading,
    lyricsFailed,
    send,
    sendLyrics,
    retry,
    resendAll,
    dismissRequest,
  };
}
