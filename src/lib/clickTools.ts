import { audioEngine } from '@/lib/audioEngine';
import { makeClickClip } from '@/lib/clickClip';
import { generateClickAt } from '@/lib/clickGenerator';
import { barSeconds, clickClipsOf, playLength, remakeClickTimes } from '@/lib/clickEdit';
import { clipInput, toDeviceRate } from '@/lib/clipStemSplit';
import { useStore } from '@/store';
import type { AudioClip } from '@/types';

// Comandos da faixa Click (botão direito na faixa ou no clipe de click):
// - Adicionar um compasso antes do início: empurra o VS 1 compasso para a direita e põe 1
//   compasso de click antes.
// - Recriar metrônomo: usa o click da faixa como guia e troca o som pelo metrônomo padrão.
// Cada um é um passo só de desfazer (Cmd+Z). O áudio antigo continua guardado para o desfazer.

export type ClickToolKind = 'bar' | 'remake';

/** O que impede o comando do click agora (ou null se pode). */
export function clickAddBlocker(songId: string | null, kind: ClickToolKind): string | null {
  if (!songId) return 'Abra uma música primeiro';
  const s = useStore.getState();
  const song = s.songs.find((x) => x.id === songId);
  if (!song) return 'Abra uma música primeiro';
  const click = clickClipsOf(s.clips, songId)[0];
  if (!click) return 'Esta música ainda não tem click';
  return null;
}

/** Um compasso de click antes do primeiro click, copiado do próprio click; o VS anda 1 compasso. */
export async function addClickBefore(songId: string): Promise<void> {
  const blocker = clickAddBlocker(songId, 'bar');
  if (blocker) throw new Error(blocker);
  const state = useStore.getState();
  const song = state.songs.find((x) => x.id === songId)!;
  const click = clickClipsOf(state.clips, songId)[0];

  const bar = barSeconds(song, click.startTime);
  // o compasso novo é uma cópia de um compasso do próprio click (mesmo som e acento)
  const prefix = bar;

  const input = await toDeviceRate(await clipInput(click));
  const sr = input.sampleRate;
  const playStart = Math.round((click.trimStart ?? 0) * sr);
  const playLen = Math.min(input.length - playStart, Math.round(playLength(click) * sr));
  const prefixLen = Math.round(prefix * sr);
  const barLen = Math.round(bar * sr);
  // O som de cada click começa um pouco ANTES da batida (1,5 ms nos clicks novos, ~6 ms nos
  // antigos). Copiar a partir da batida cortava o começo do primeiro click do pedaço novo.
  // Por isso copia junto até 30 ms de antes, e o clipe novo começa esse tanto antes.
  // Usa o 2º compasso quando existe: o 1º click do clipe não tem nada antes dele no áudio.
  const second = playLen >= 2 * barLen + prefixLen ? barLen : 0;
  const copyStart = playStart + second;
  const shift = bar;
  const room = Math.max(0, click.startTime + shift - prefix); // tempo livre antes do pedaço novo
  const lead = Math.max(0, Math.min(Math.round(0.03 * sr), copyStart, Math.floor(room * sr)));
  const pieceLen = lead + prefixLen;
  const out = new AudioBuffer({ length: pieceLen + playLen, numberOfChannels: input.numberOfChannels, sampleRate: sr });
  // No fim do pedaço copiado vem o começo do click seguinte; ele toca é no click original,
  // que entra logo depois. Esses últimos 10 ms ficam em silêncio (com rampa curta) para não
  // soar um ataque picotado colado no click original.
  const cut = Math.min(Math.round(0.01 * sr), prefixLen);
  const ramp = Math.round(0.002 * sr);
  for (let c = 0; c < input.numberOfChannels; c++) {
    const src = input.getChannelData(c);
    const dst = out.getChannelData(c);
    // se o click for mais curto que o pedaço, o resto fica em silêncio
    dst.set(src.subarray(copyStart - lead, Math.min(src.length, copyStart + prefixLen, playStart + playLen)), 0);
    for (let i = pieceLen - cut - ramp; i < pieceLen; i++) {
      if (i < 0) continue;
      dst[i] *= i >= pieceLen - cut ? 0 : (pieceLen - cut - i) / ramp;
    }
    dst.set(src.subarray(playStart, playStart + playLen), pieceLen);
  }

  // Um compasso: o VS anda 1 compasso, e o click novo começa onde o antigo começava
  // (menos o pedacinho de antes da batida).
  const startTime = click.startTime + shift - prefix - lead / sr;
  const clip = await makeClickClip(song, out, Math.max(0, startTime), click);
  useStore.getState().applyClickEdit({ songId, shift, removeClipIds: [click.id], addClips: [clip] });
  audioEngine.invalidatePrepared(songId);
}

/**
 * Recriar metrônomo: acha cada batida do click que está na faixa e põe o som padrão do VS Stage
 * exatamente ali. Segue o click de referência, então acompanha mudança de andamento e medley.
 * Só leva para a linha da grade onde o click inteiro está deslocado por igual (ver alignHitsToGrid).
 */
export async function remakeMetronome(songId: string): Promise<number> {
  const blocker = clickAddBlocker(songId, 'remake');
  if (blocker) throw new Error(blocker);
  const state = useStore.getState();
  const song = state.songs.find((x) => x.id === songId)!;
  const clicks = clickClipsOf(state.clips, songId);
  const added: AudioClip[] = [];
  const replaced: string[] = [];
  let beats = 0;
  for (const click of clicks) {
    const input = await toDeviceRate(await clipInput(click));
    const sr = input.sampleRate;
    const playStart = Math.round((click.trimStart ?? 0) * sr);
    const playLen = Math.min(input.length - playStart, Math.round(playLength(click) * sr));
    const channels = Array.from({ length: input.numberOfChannels }, (_, c) => input.getChannelData(c));
    const times = remakeClickTimes(channels, playStart, playLen, sr, click.startTime, song);
    if (times.length < 2) continue;
    const buffer = await generateClickAt(times, playLen / sr, sr);
    added.push(await makeClickClip(song, buffer, click.startTime, click));
    replaced.push(click.id);
    beats += times.length;
  }
  if (!added.length) throw new Error('não achei as batidas no click desta música');
  useStore.getState().applyClickEdit({
    songId,
    removeClipIds: replaced,
    addClips: added,
  });
  audioEngine.invalidatePrepared(songId);
  return beats;
}

// ---------- Situação para a tela (painel no canto, igual ao do Separar stems) ----------

export type ClickToolStatus = {
  state: 'idle' | 'working' | 'done' | 'error';
  title: string;
  percent: number;
  message: string;
};

let status: ClickToolStatus = { state: 'idle', title: '', percent: 0, message: '' };
let running = false;
const listeners = new Set<() => void>();
function setStatus(next: ClickToolStatus) {
  status = next;
  listeners.forEach((l) => l());
}
export function subscribeClickTool(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getClickToolStatus(): ClickToolStatus { return status; }
export function dismissClickTool(): void { setStatus({ ...status, state: 'idle' }); }
export function isClickToolRunning(): boolean { return running; }

const TITLES: Record<ClickToolKind, string> = {
  bar: 'Um compasso antes do início',
  remake: 'Recriar metrônomo',
};

/** Roda um comando do click pelo menu e mostra o resultado no painel. */
export async function startClickTool(songId: string, kind: ClickToolKind): Promise<void> {
  if (running) return;
  running = true;
  const title = TITLES[kind];
  setStatus({ state: 'working', title, percent: 5, message: 'Preparando...' });
  try {
    if (kind === 'remake') {
      const beats = await remakeMetronome(songId);
      setStatus({
        state: 'done', title, percent: 100,
        message: `Metrônomo recriado com o som padrão do VS Stage: ${beats} batidas, no mesmo lugar do click que estava na faixa.`,
      });
      return;
    }
    await addClickBefore(songId);
    setStatus({
      state: 'done', title, percent: 100,
      message: 'O VS andou 1 compasso para a direita e entrou 1 compasso de click antes do início.',
    });
  } catch (err) {
    setStatus({ state: 'error', title, percent: 0, message: `Não deu: ${(err as Error)?.message ?? String(err)}.` });
  } finally {
    running = false;
  }
}
