// Aviso de alteração não salva no navegador de verdade: o store, a janela "Salvar as alterações?"
// e o aviso do navegador ao fechar a aba. Abrir com o servidor de desenvolvimento:
// /tests/browser/unsaved-smoke.html — a parte automática mostra OK/FALHOU; window.vsTest guarda
// funções para testar os botões da janela.
import { createRoot } from 'react-dom/client';
import UnsavedChangesDialog from '../../src/components/UnsavedChangesDialog';
import { useStore, hasUnsavedChanges } from '../../src/store';
import { confirmLeaveProject, watchUnsavedChanges } from '../../src/lib/unsavedChanges';
import type { Song } from '../../src/types';
import '/src/index.css';

const out = document.getElementById('out')!;
const check = (ok: boolean, msg: string) => { out.textContent += `${ok ? 'OK     ' : 'FALHOU '} ${msg}\n`; };
createRoot(document.getElementById('root')!).render(<UnsavedChangesDialog />);
watchUnsavedChanges();

const st = () => useStore.getState();
const dirty = () => hasUnsavedChanges(st());
const closingTabWarns = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

const song = (id: string, name: string): Song => ({
  id, name, clips: [], bpm: 120, bpmAdjust: 0, tuner: 0, duration: 180, timelineStart: 0, blockId: null,
});
const manifest = (tracksWithoutMeters = false) => {
  const tracks = st().tracks.map((t) => {
    if (!tracksWithoutMeters) return t;
    const { meterLevel: _m, clipIndicator: _c, clipPeak: _p, ...rest } = t;
    return rest as typeof t;
  });
  return {
    projectName: 'Culto Domingo',
    tracks,
    songs: [song('s1', 'Música 1'), song('s2', 'Música 2')],
    playlist: [
      { id: 'p1', songId: 's1', name: 'Música 1', order: 0, bpm: 120, blockId: null, duration: 180 },
      { id: 'p2', songId: 's2', name: 'Música 2', order: 1, bpm: 120, blockId: null, duration: 180 },
    ],
    playlistOrder: ['s1', 's2'],
  };
};
const audioTrack = () => st().tracks.find((t) => t.id === 'track-guia')!.id;

check(!dirty() && !closingTabWarns(), 'app recém-aberto, sem projeto: fecha sem perguntar');

st().applyLoadedProject(manifest(), new Map());
check(!dirty(), 'projeto recém-aberto: nada a salvar');

st().setVolume(audioTrack(), 0.3);
check(dirty(), 'mexer no fader do mixer: fica "não salvo"');
check(closingTabWarns(), 'com alteração, fechar a aba avisa');

useStore.temporal.getState().undo();
check(!dirty() && !closingTabWarns(), 'desfazer até o salvo: volta a "salvo" e fecha sem perguntar');

for (let i = 0; i < 20; i++) st().updateMeter(audioTrack(), i % 2 ? 1.2 : 0.4);
check(!dirty(), 'medidores e pico de clip tocando não contam como alteração');

st().setTempoAt('s1', 30, 128);
check(dirty(), 'mudança de andamento na régua: fica "não salvo"');
st().markProjectSaved();
check(!dirty(), 'depois de salvar: "salvo"');

st().setLyricMaps({ s1: [] });
check(dirty(), 'mapas de letra que chegam do produtor: fica "não salvo"');
st().markProjectSaved();

st().applyLoadedProject(manifest(true), new Map());
for (let i = 0; i < 5; i++) st().updateMeter(audioTrack(), 1.5);
check(!dirty(), 'projeto antigo sem campos de medidor: tocar não vira "não salvo"');

st().newProject();
check(!dirty(), 'novo projeto vazio: nada a salvar');

st().loadProject(manifest());
check(dirty(), 'backup restaurado (não veio de arquivo): pede para salvar');

st().applyLoadedProject(manifest(), new Map());
st().setVolume(audioTrack(), 0.5);

// Janela "Salvar as alterações?": window.vsTest.ask() abre; o resultado fica em window.vsTest.last
const vsTest = {
  last: null as boolean | null,
  dirty,
  ask: () => { vsTest.last = null; void confirmLeaveProject().then((ok) => { vsTest.last = ok; }); },
  // simula a janela "Salvar Projeto..." (projeto nunca salvo): salvou ou cancelou
  finishSaveDialog: (saved: boolean) => {
    if (saved) st().markProjectSaved();
    st().setSaveDialogOpen(false);
  },
  saveDialogOpen: () => st().saveDialogOpen,
  edit: () => st().setVolume(audioTrack(), Math.random()),
};
(window as unknown as { vsTest: typeof vsTest }).vsTest = vsTest;
out.textContent += '\npronto\n';
