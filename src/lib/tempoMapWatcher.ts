// Confere em segundo plano os mapas de andamento de projetos já salvos contra a faixa de click.
// Uma música por vez, só com o programa parado. Mapa que bate com o click, música sem click, mapa
// feito à mão ou vindo do REAPER nunca são tocados. O que já foi conferido fica guardado neste
// computador, para não refazer a conta toda vez que o projeto abre. O mapa corrigido não entra nessa
// lista: fechou sem salvar, ele é corrigido de novo. Quem recusa a troca é o Desfazer, e a recusa fica
// gravada na própria música, para valer em qualquer computador.
// Depois das batidas vem o tempo 1: qual batida abre o compasso. A marca dessa conferência fica na
// música, fora do Desfazer, e não deixa o projeto como "não salvo" quando nada mudou.
import { hasUnsavedChanges, useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { getClipAudio, getClipSource, onAudioLibraryCleared } from '@/lib/audioLibrary';
import { barCheckMark, checkSavedBarPhase, checkSavedTempoMap, isImportRunning, tempoCheckKey } from '@/lib/importManager';
import { canReplaceTempoMap, tempoKeepKey } from '@/lib/tempoFollow';

const STORE_KEY = 'vs-tempo-map-check-v1';
const MAX_KEPT = 600;
const MAX_TRIES = 4;
const tries = new Map<string, number>();
/** Tempo 1 que parou por falta de áudio da banda: quantos clipes tinham arquivo. Volta quando chegar mais. */
const waitingAudio = new Map<string, number>();
/** Mapas de antes de cada troca desta sessão (batidas e tempo 1): se um deles voltar, foi Desfazer. */
const replacedFrom = new Map<string, string[]>();
const BAR_PREFIX = 'tempo1:';

let running = false;
let again = false;
let project = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let checked: string[] | null = null;

function checkedKeys(): string[] {
  if (checked) return checked;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    checked = Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    checked = [];
  }
  return checked;
}

function remember(key: string) {
  const list = checkedKeys();
  if (list.includes(key)) return;
  list.push(key);
  if (list.length > MAX_KEPT) list.splice(0, list.length - MAX_KEPT);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch { /* sem espaço: confere de novo na próxima abertura */ }
}

/** Falta conferir as batidas: mapa sem registro de origem (o com registro já saiu da leitura nova). */
function beatCheckPending(id: string): boolean {
  const song = useStore.getState().songs.find((s) => s.id === id);
  if (!song || song.tempoMapSource || !canReplaceTempoMap(song)) return false;
  const key = tempoCheckKey(id);
  return !!key && !checkedKeys().includes(key);
}

/** Falta conferir o tempo 1: mapa automático com click que esta versão da regra ainda não viu. */
function barCheckPending(id: string): boolean {
  // o modelo só roda no programa de computador
  if (typeof window === 'undefined' || !window.vsDesktop) return false;
  const song = useStore.getState().songs.find((s) => s.id === id);
  if (!song || !canReplaceTempoMap(song)) return false;
  const mark = barCheckMark(id);
  if (!mark || song.tempoBarCheck === mark) return false;
  const key = BAR_PREFIX + mark;
  if (waitingAudio.has(key) && waitingAudio.get(key) === audioCount(id)) return false;
  return !checkedKeys().includes(key) && (tries.get(key) ?? 0) < MAX_TRIES;
}

/** Clipes da música com áudio disponível (na memória ou com o arquivo). */
function audioCount(id: string): number {
  return useStore.getState().clips.filter((c) => c.songId === id && (getClipAudio(c.id) || getClipSource(c.id))).length;
}

function pending(): string[] {
  const st = useStore.getState();
  const order: string[] = [];
  const add = (id: string | null | undefined) => { if (id && !order.includes(id)) order.push(id); };
  add(st.transport.currentSongId);
  add(st.transport.nextSongId);
  add(st.selectedSongId);
  st.playlist.forEach((p) => add(p.songId));
  st.songs.forEach((s) => add(s.id));
  return order.filter((id) => beatCheckPending(id) || barCheckPending(id));
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function noteReplaced(id: string, keepKey: string | null) {
  if (keepKey) replacedFrom.set(id, [...(replacedFrom.get(id) ?? []), keepKey]);
}

async function checkBeats(id: string, canGoOn: () => boolean) {
  const key = tempoCheckKey(id);
  if (!key || checkedKeys().includes(key) || (tries.get(key) ?? 0) >= MAX_TRIES) return;
  const before = useStore.getState().songs.find((s) => s.id === id);
  const keepKey = before ? tempoKeepKey(before) : null;
  try {
    const result = await checkSavedTempoMap(id, canGoOn);
    if (result === 'interrupted') again = true;
    else if (result === 'failed') {
      // tenta mais algumas vezes nesta sessão; na próxima abertura confere de novo
      tries.set(key, (tries.get(key) ?? 0) + 1);
      again = true;
    } else if (result === 'replaced') noteReplaced(id, keepKey);
    else remember(key);
  } catch (err) {
    console.warn('[mapa] não consegui conferir', id, err);
    tries.set(key, MAX_TRIES);
  }
}

/** Muda a música fora do Desfazer. Uma gravação pode disparar outra: só a de fora religa o histórico. */
function outsideHistory(change: () => void) {
  const history = useStore.temporal.getState();
  const tracking = history.isTracking;
  history.pause();
  try {
    change();
  } finally {
    if (tracking) history.resume();
  }
}

/** Grava que a música foi conferida, fora do Desfazer e sem acusar alteração não salva. */
function markBarChecked(id: string, mark: string) {
  remember(BAR_PREFIX + mark);
  const st = useStore.getState();
  const song = st.songs.find((s) => s.id === id);
  if (!song || song.tempoBarCheck === mark) return;
  const clean = !hasUnsavedChanges(st);
  outsideHistory(() => st.updateSong(id, { tempoBarCheck: mark }));
  if (clean) useStore.getState().markProjectSaved();
}

async function checkBar(id: string, canGoOn: () => boolean) {
  const mark = barCheckMark(id);
  if (!mark) return;
  const key = BAR_PREFIX + mark;
  const before = useStore.getState().songs.find((s) => s.id === id);
  const keepKey = before ? tempoKeepKey(before) : null;
  try {
    const result = await checkSavedBarPhase(id, () => canGoOn() && !isImportRunning());
    if (result === 'interrupted') again = true;
    else if (result === 'failed') {
      tries.set(key, (tries.get(key) ?? 0) + 1);
      again = true;
    } else if (result === 'no-audio') {
      // sem os arquivos da banda nada foi conferido: não marca, e volta quando o áudio aparecer
      waitingAudio.set(key, audioCount(id));
    } else if (result === 'replaced') noteReplaced(id, keepKey);
    else if (barCheckMark(id) === mark) markBarChecked(id, mark);
  } catch (err) {
    console.warn('[tempo 1] não consegui conferir', id, err);
    tries.set(key, MAX_TRIES);
  }
}

async function run() {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      for (const id of pending()) {
        // o Play tem a vez, e o começo da música no ar também
        while (audioEngine.isRunning() || audioEngine.isSettling() || isImportRunning()) await pause(1000);
        const opened = project;
        const canGoOn = () => project === opened && !audioEngine.isRunning() && !audioEngine.isSettling();
        if (beatCheckPending(id)) await checkBeats(id, canGoOn);
        // o tempo 1 só depois das batidas conferidas
        if (project === opened && !beatCheckPending(id) && barCheckPending(id)) await checkBar(id, canGoOn);
        await pause(400);
      }
      if (again) await pause(5000);
    } while (again);
  } finally {
    running = false;
  }
}

/** Um mapa de antes da troca voltou (Desfazer): a recusa fica gravada na música, fora do histórico. */
function noteUndoneReplacement(): void {
  if (!replacedFrom.size) return;
  const st = useStore.getState();
  const refused = new Map<string, string>();
  for (const [id, keys] of replacedFrom) {
    const song = st.songs.find((s) => s.id === id);
    if (!song) { replacedFrom.delete(id); continue; }
    const keepKey = tempoKeepKey(song);
    // a lista fica até trocar de projeto: outro Desfazer pode voltar a música a um estado sem a recusa
    if (keys.includes(keepKey) && song.tempoMapKept !== keepKey) refused.set(id, keepKey);
  }
  if (!refused.size) return;
  outsideHistory(() => useStore.setState((s) => ({
    songs: s.songs.map((sg) => (refused.has(sg.id) ? { ...sg, tempoMapKept: refused.get(sg.id) } : sg)),
  })));
}

export function startTempoMapWatcher(): () => void {
  const kick = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), 5000);
  };
  const offCleared = onAudioLibraryCleared(() => { project++; replacedFrom.clear(); waitingAudio.clear(); });
  kick();
  const offStore = useStore.subscribe((s, prev) => {
    if (s.songs !== prev.songs) noteUndoneReplacement();
    if (s.songs !== prev.songs || s.clips !== prev.clips) kick();
  });
  return () => {
    if (timer) clearTimeout(timer);
    offCleared();
    offStore();
  };
}
