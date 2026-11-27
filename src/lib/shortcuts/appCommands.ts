/**
 * Ações dos comandos que valem no programa inteiro (antes ficavam no tratador de teclado do
 * App). Cada uma faz exatamente o que a tecla fazia; as que não tinham tecla fazem o mesmo que
 * o botão ou o item de menu delas.
 */
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { togglePlayPause, stopPlayback, startPlayback, seekToPosition } from '@/lib/transportControl';
import { saveCurrentProject } from '@/lib/projectQuickSave';
import { copyClips, duplicateClips, pasteClips } from '@/lib/clipClipboard';
import { confirmLeaveProject } from '@/lib/unsavedChanges';
import { registerCommand, openKeyCommands } from './runtime.ts';

export function registerAppCommands(opts: {
  toggleShowMode: () => void;
  openPrompter: () => void;
  openAiSeparator: () => void;
}): () => void {
  const st = () => useStore.getState();
  /** Música que a tecla mexe: a que toca, senão a selecionada, senão a do transporte. */
  const songNow = () => {
    const s = st();
    const id = s.transport.isPlaying ? s.transport.currentSongId : (s.selectedSongId ?? s.transport.currentSongId);
    return id ? s.songs.find((sg) => sg.id === id) : undefined;
  };
  const openSongId = () => { const s = st(); return s.selectedSongId ?? s.playlist[0]?.songId ?? null; };
  const firstSelectedClip = () => st().selectedClipIds[0] ?? null;

  const offs: Array<() => void> = [];
  const on = (id: string, fn: Parameters<typeof registerCommand>[1], priority = 0) => offs.push(registerCommand(id, fn, priority));

  // Transporte
  on('transport.playPause', () => {
    if (st().playlistMaximized) startPlayback();
    else togglePlayPause();
  });
  on('transport.stop', () => { stopPlayback(); });
  on('show.exit', () => {
    const s = st();
    if (!s.playlistMaximized) return false;
    s.togglePlaylistMaximized();
  });
  on('transport.goToStart', () => {
    const song = songNow();
    if (!song) return false;
    seekToPosition(song.id, 0);
  });
  on('transport.goToEnd', () => {
    const song = songNow();
    if (!song) return false;
    // End com a música tocando acabava com ela na hora (e a próxima podia entrar): no show,
    // um End sem querer não pode pular a música. Tocando, a tecla fica tomada e não faz nada.
    if (st().transport.isPlaying) return true;
    seekToPosition(song.id, Math.max(0, song.duration));
  });
  on('transport.cyclePlayFlow', () => { st().cyclePlayFlow(); });
  on('transport.clearSolos', () => { st().clearAllSolos(); });

  // Playlist
  on('playlist.setNext', () => {
    const s = st();
    if (s.transport.playFlow === 'uma-uma') return;
    const sel = s.selectedSongId;
    s.setNextSong(sel && sel !== s.transport.nextSongId ? sel : null);
  });
  on('playlist.createBlock', () => { const s = st(); if (s.selectedSongId) s.createBlock(s.selectedSongId); });
  on('playlist.duplicateSong', () => { const s = st(); if (s.selectedSongId) s.duplicatePlaylistEntry(s.selectedSongId); });
  on('playlist.removeSong', () => { const s = st(); if (s.selectedSongId) s.removeSong(s.selectedSongId); });

  // Arquivo
  on('file.save', () => { saveCurrentProject(); });
  on('file.saveAs', () => { st().setSaveDialogOpen(true); });
  on('file.open', () => { void confirmLeaveProject().then((ok) => { if (ok) st().setOpenDialogOpen(true); }); });
  on('file.new', () => { void confirmLeaveProject().then((ok) => { if (ok) st().newProject(); }); });
  on('file.aiCreateVS', () => { opts.openAiSeparator(); });
  on('file.export', () => { st().setBounceDialogOpen(true); });
  on('settings.audioDevice', () => { st().setAudioDeviceDialogOpen(true); });
  on('tools.teleprompter', () => { opts.openPrompter(); });

  // Edição
  on('edit.undo', () => { useStore.temporal.getState().undo(); });
  on('edit.redo', () => { useStore.temporal.getState().redo(); });
  // só toma a tecla quando há clipe: sem clipe, o copiar/colar normal do sistema continua
  on('edit.copyClips', () => copyClips() > 0);
  on('edit.pasteClips', () => pasteClips().length > 0);
  on('edit.duplicateClips', () => duplicateClips().length > 0);
  // Reserva do Delete quando a timeline não está na tela (ela registra a dela com prioridade maior)
  on('edit.deleteClips', () => {
    const store = st();
    if (store.timelineLocked) return false;
    // No Modo Show a timeline não aparece: apagar daqui tiraria áudio da música no ar sem ninguém ver
    if (store.playlistMaximized) return false;
    if (store.selectedClipIds.length === 0) return false;
    const targetIds = [...store.selectedClipIds];
    audioEngine.stopClipsLive(targetIds);
    store.removeClips(targetIds);
    const selSongId = store.selectedSongId ?? store.playlist[0]?.songId;
    if (selSongId) audioEngine.invalidatePrepared(selSongId);
  });
  on('app.keyCommands', () => { openKeyCommands(); });

  // Clipes selecionados
  on('clip.mute', () => { const s = st(); if (s.selectedClipIds.length === 0) return false; for (const id of s.selectedClipIds) s.toggleClipMute(id); });
  on('clip.solo', () => { const s = st(); if (s.selectedClipIds.length === 0) return false; for (const id of s.selectedClipIds) s.toggleClipSolo(id); });
  on('clip.resetRouting', () => { const s = st(); if (s.selectedClipIds.length === 0) return false; for (const id of s.selectedClipIds) s.resetClipRouting(id); });
  on('clip.reclassifyAi', () => {
    const id = firstSelectedClip();
    if (!id) return false;
    void import('@/lib/aiRouter').then((m) => m.reclassifyClipWithAi(id));
  });
  on('clip.export', () => {
    const id = firstSelectedClip();
    if (!id) return false;
    void import('@/lib/clipExport').then((m) => m.exportClipAudio(id));
  });
  on('clip.stemSplit', () => {
    const id = firstSelectedClip();
    if (!id) return false;
    void import('@/lib/clipStemSplit').then((m) => m.startClipStemSplit(id));
  });
  on('timeline.lock', () => { st().toggleTimelineLocked(); });

  // Visualizar
  on('view.mixer', () => { st().toggleMixer(); });
  on('view.showMode', () => { opts.toggleShowMode(); });
  on('view.playlist', () => { st().togglePlaylist(); });
  on('view.clipControls', () => { st().toggleDawMode(); });
  on('view.bpmTower', () => { st().toggleBpmTower(); });
  on('view.tunerTower', () => { st().toggleTunerTower(); });
  on('timeline.trackHeightUp', () => { const s = st(); s.setZoomV(Math.min(3, Math.round(s.zoomV * 1.25 * 100) / 100)); });
  on('timeline.trackHeightDown', () => { const s = st(); s.setZoomV(Math.max(0.5, Math.round(s.zoomV * 0.8 * 100) / 100)); });
  on('show.sectionKeys', () => { st().toggleSectionKeys(); });

  // Mixer
  on('mixer.levelMatch', () => { const s = st(); s.setLevelMatch(!s.levelMatch); });
  on('mixer.magicRouting', () => { st().toggleMagicRouting(); });
  on('mixer.masterAntiClip', () => { st().toggleMasterAntiClip(); });

  // Faixa selecionada
  on('track.mute', () => { const s = st(); if (!s.selectedTrackId) return false; s.toggleMuteLinked(s.selectedTrackId); });
  on('track.solo', () => { const s = st(); if (!s.selectedTrackId) return false; s.toggleSoloLinked(s.selectedTrackId); });
  on('track.duplicate', () => { const s = st(); if (!s.selectedTrackId) return false; s.duplicateTrack(s.selectedTrackId); });

  // Click (na música aberta)
  // mesmas travas do menu do click: sem outro comando do click rodando e sem bloqueio da música
  const clickTool = (kind: 'generate' | 'bar' | 'remake') => () => {
    const id = openSongId();
    if (!id) return false;
    void import('@/lib/clickTools').then((m) => {
      if (m.isClickToolRunning() || m.clickAddBlocker(id, kind)) return;
      if (kind === 'remake') m.openClickChooser(id);
      else void m.startClickTool(id, kind);
    });
  };
  on('click.generate', clickTool('generate'));
  on('click.addBar', clickTool('bar'));
  on('click.remake', clickTool('remake'));

  // Maestro
  on('maestro.consolidate', () => {
    const id = openSongId();
    if (!id) return false;
    void import('@/lib/maestroConsolidate').then((m) => m.runConsolidateMaestroIa(id));
  });

  return () => { for (const off of offs) off(); };
}
