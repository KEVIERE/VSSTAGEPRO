// Página só para tirar as fotos do site (dev server): abre o editor de verdade, sem a tela de
// login, e carrega um show .vss por URL. Uso no console: await window.loadShow('http://...vss')
import '../../src/index.css';
import { createRoot } from 'react-dom/client';
import { applySkin, savedSkin } from '../../src/lib/skins';
import { DirectorApp } from '../../src/App';
import { readPackage } from '../../src/lib/projectSaver';
import { useStore } from '../../src/store';
import { startPlayback, stopPlayback } from '../../src/lib/transportControl';
import { importPadFile, selectPad, triggerPad } from '../../src/lib/padPlayer';
import type { License } from '../../src/components/DirectorAccess';
import type { AudioClip, Song } from '../../src/types';

applySkin(savedSkin());

const license = { status: 'active', plan: 'yearly', subscription: 'active' } as License;

declare global {
  interface Window {
    loadShow: (url: string) => Promise<{ songs: number; clips: number }>;
    vsStore: typeof useStore;
  }
}

window.vsStore = useStore;
let lastLoaded: Awaited<ReturnType<typeof readPackage>> | null = null;
window.loadShow = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const name = decodeURIComponent(url.split('/').pop() || 'show.vss');
  const loaded = await readPackage(new File([blob], name), () => {});
  lastLoaded = loaded;
  useStore.getState().applyLoadedProject(loaded.manifest as never, loaded.sources);
  const s = useStore.getState();
  return { songs: s.songs.length, clips: s.clips.length };
};

/**
 * Show de exemplo para as fotos: a música do .vss vira 8 músicas com nomes genéricos, em dois
 * blocos, com partes coloridas, tom e BPM diferentes. O áudio é o mesmo (só para as ondas).
 */
const DEMO = [
  { name: 'Música 01', bpm: 128, key: 'G', block: 0 },
  { name: 'Música 02', bpm: 75, key: 'D', block: 0 },
  { name: 'Música 03', bpm: 68, key: 'A', block: 0 },
  { name: 'Música 04', bpm: 140, key: 'E', block: 0 },
  { name: 'Música 05', bpm: 82, key: 'C', block: 0 },
  { name: 'Música 06', bpm: 90, key: 'Bm', block: 1 },
  { name: 'Música 07', bpm: 76, key: 'F', block: 1 },
  { name: 'Música 08', bpm: 120, key: 'Em', block: 1 },
];
const PARTS: Array<[string, string, number]> = [
  ['Intro', '#30d158', 0.07], ['Verso', '#0a84ff', 0.2], ['Pré', '#ffd60a', 0.08], ['Refrão', '#ff453a', 0.16],
  ['Verso 2', '#0a84ff', 0.14], ['Refrão', '#ff453a', 0.14], ['Ponte', '#bf5af2', 0.09], ['Refrão final', '#ff9f0a', 0.12],
];
(window as unknown as { buildDemo: (showName?: string) => unknown }).buildDemo = (showName = 'Show Prefeitura') => {
  if (!lastLoaded) throw new Error('Chame loadShow antes');
  const m = lastLoaded.manifest as unknown as Record<string, unknown> & { songs: Song[]; clips: AudioClip[] };
  const base = m.songs[0];
  const baseClips = m.clips.filter((c) => c.songId === base.id);
  const sources = new Map<string, Blob>();
  const blocks = [
    { id: 'blk-1', name: 'Bloco 1', color: '#0a84ff', order: 0 },
    { id: 'blk-2', name: 'Bloco 2', color: '#ff9f0a', order: 1 },
  ];
  const songs: Song[] = [];
  const clips: AudioClip[] = [];
  DEMO.forEach((d, i) => {
    const id = `demo-${i + 1}`;
    const dur = base.duration * (0.85 + ((i * 37) % 30) / 100);
    const ids: string[] = [];
    for (const c of baseClips) {
      const cid = `${c.id}-d${i}`;
      ids.push(cid);
      const part = c.name.split(/\s+-\s+/).pop() || c.name;
      clips.push({ ...c, id: cid, songId: id, name: `${d.name} - ${part}` });
      const src = lastLoaded!.sources.get(c.id);
      if (src) sources.set(cid, src);
    }
    let at = 0;
    const regions = PARTS.map(([n, color, frac], k) => {
      const start = at;
      at += frac * dur;
      return { id: `${id}-r${k}`, name: n, start, end: Math.min(dur, at), color, loop: false };
    });
    songs.push({
      ...base, id, name: d.name, clips: ids, bpm: d.bpm, bpmDetected: true, bpmAdjust: 0, tuner: 0, duration: dur,
      blockId: blocks[d.block].id, regions, musicKey: d.key, medley: undefined,
      narrations: [
        ['Um, dois, três, quatro', 0.2], ['Prepara o verso', regions[1].start - 2.5], ['Pré-refrão', regions[2].start - 2.2],
        ['Refrão!', regions[3].start - 1.8], ['Segura o verso dois', regions[4].start - 2.5], ['Agora a ponte', regions[6].start - 2.2],
        ['Último refrão', regions[7].start - 2.2],
      ].map(([text, start], k) => ({
        id: `${id}-n${k}`, text: String(text), voice: 'feminina', start: Math.max(0, Number(start)), end: Math.max(0, Number(start)) + 3.2, status: 'pending',
      })),
    } as Song);
  });
  const playlist = songs.map((s, i) => ({ id: `pl-${i}`, songId: s.id, name: s.name, order: i, bpm: s.bpm, blockId: s.blockId, duration: s.duration }));
  useStore.getState().applyLoadedProject({
    ...m, projectName: showName, songs, clips, blocks, playlist, playlistOrder: playlist.map((p) => p.songId),
    shows: [{ id: 'show-1', name: showName, playlist }], activeShowId: 'show-1', zoomH: 7,
  } as never, sources);
  return { songs: songs.length, clips: clips.length };
};

/** Pads de exemplo: sons curtos gerados aqui, com nomes de efeitos de show, no banco A. */
function toneWav(seconds: number, freq: number, name: string): File {
  const rate = 44100;
  const frames = Math.round(rate * seconds);
  const buf = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(buf);
  const w = (o: number, t: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const env = Math.min(1, i / 2000) * Math.max(0, 1 - i / frames);
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * env * 12000), true);
  }
  return new File([buf], `${name}.wav`, { type: 'audio/wav' });
}
(window as unknown as { vsPadsDemo: () => Promise<number> }).vsPadsDemo = async () => {
  const names = ['Vinheta de abertura', 'Aplausos', 'Subida', 'Impacto', 'Grito da galera', 'Loop percussão', 'Sirene', 'Efeito de voz', 'Final do show'];
  let ok = 0;
  for (let i = 0; i < names.length; i++) {
    if (await importPadFile(i, toneWav(4 + (i % 3) * 3, 220 + i * 40, names[i]))) ok++;
  }
  selectPad(0);
  triggerPad(0);
  return ok;
};

/** Toca a música a partir de um ponto (no Chrome sem som das fotos). */
(window as unknown as { vsPlay: (songId: string, at: number) => Promise<void> }).vsPlay = async (songId, at) => {
  const st = useStore.getState();
  st.selectSong(songId);
  st.setCurrentTime(at);
  await startPlayback();
};
(window as unknown as { vsStop: () => void }).vsStop = () => stopPlayback();

createRoot(document.getElementById('root')!).render(<DirectorApp license={license} />);
