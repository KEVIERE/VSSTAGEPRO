import { useStore } from '@/store';
import { getClipAudio, getClipSource, putClipAudio, registerClipSource, clipPlayLength } from '@/lib/audioLibrary';
import type { AudioClip } from '@/types';
import type { ClipAudio } from '@/lib/audioLibrary';

interface ClipboardItem {
  clip: AudioClip;
  source: Blob | null;
  audio: ClipAudio | null;
}

let clipboard: ClipboardItem[] = [];

export function hasCopiedClips(): boolean {
  return clipboard.length > 0;
}

export function copyClips(clipIds?: string[]): number {
  const store = useStore.getState();
  const targetIds = clipIds && clipIds.length > 0 ? clipIds : store.selectedClipIds;
  if (targetIds.length === 0) return 0;

  const targetSet = new Set(targetIds);
  const targets = store.clips.filter((c) => targetSet.has(c.id));
  if (targets.length === 0) return 0;

  clipboard = targets.map((c) => ({
    clip: { ...c },
    source: getClipSource(c.id),
    audio: getClipAudio(c.id),
  }));

  const msg = clipboard.length === 1 ? '1 clipe copiado' : `${clipboard.length} clipes copiados`;
  store.setImportProgress({
    clipId: 'clipboard',
    status: 'done',
    message: `${msg} (⌘V para colar)`,
  });
  setTimeout(() => {
    if (useStore.getState().importProgress?.message?.includes('copiado')) {
      useStore.getState().setImportProgress(null);
    }
  }, 2500);

  return clipboard.length;
}

export function pasteClips(targetTrackId?: string, targetTime?: number): string[] {
  if (clipboard.length === 0) return [];
  const store = useStore.getState();
  const currentSongId = store.selectedSongId ?? store.playlist[0]?.songId;
  if (!currentSongId) return [];

  const pasteTime = targetTime !== undefined ? targetTime : store.transport.currentTime;
  const minStart = Math.min(...clipboard.map((c) => c.clip.startTime));
  const now = Date.now();
  const newClips: AudioClip[] = [];

  for (let i = 0; i < clipboard.length; i++) {
    const item = clipboard[i];
    const newId = `c-paste-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    const offset = item.clip.startTime - minStart;
    const newStart = Math.max(0, pasteTime + offset);
    const assignedTrackId = targetTrackId && clipboard.length === 1 ? targetTrackId : item.clip.trackId;

    if (item.source) registerClipSource(newId, currentSongId, item.source);
    if (item.audio) putClipAudio(newId, currentSongId, item.audio);

    newClips.push({
      ...item.clip,
      id: newId,
      songId: currentSongId,
      trackId: assignedTrackId,
      startTime: newStart,
      name: item.clip.name.includes('(Cópia)') ? item.clip.name : `${item.clip.name} (Cópia)`,
    });
  }

  store.addClips(newClips);

  const msg = newClips.length === 1 ? '1 clipe colado' : `${newClips.length} clipes colados`;
  store.setImportProgress({
    clipId: 'clipboard',
    status: 'done',
    message: msg,
  });
  setTimeout(() => {
    if (useStore.getState().importProgress?.message?.includes('colado')) {
      useStore.getState().setImportProgress(null);
    }
  }, 2500);

  return newClips.map((c) => c.id);
}

export function duplicateClips(clipIds?: string[]): string[] {
  const store = useStore.getState();
  const targetIds = clipIds && clipIds.length > 0 ? clipIds : store.selectedClipIds;
  if (targetIds.length === 0) return [];

  const targetSet = new Set(targetIds);
  const targets = store.clips.filter((c) => targetSet.has(c.id));
  if (targets.length === 0) return [];

  // Padrão DAW profissional (Logic Pro / Pro Tools): o duplicar insere logo após o final do clipe original
  const maxEnd = Math.max(...targets.map((c) => c.startTime + clipPlayLength(c)));
  const minStart = Math.min(...targets.map((c) => c.startTime));
  const span = Math.max(0.05, maxEnd - minStart);
  const now = Date.now();
  const duplicates: AudioClip[] = [];

  for (let i = 0; i < targets.length; i++) {
    const orig = targets[i];
    const newId = `c-dup-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    const source = getClipSource(orig.id);
    const audio = getClipAudio(orig.id);
    const offsetFromMin = orig.startTime - minStart;
    const newStart = minStart + span + offsetFromMin;

    if (source) registerClipSource(newId, orig.songId, source);
    if (audio) putClipAudio(newId, orig.songId, audio);

    duplicates.push({
      ...orig,
      id: newId,
      startTime: newStart,
      name: orig.name.includes('(Cópia)') ? orig.name : `${orig.name} (Cópia)`,
    });
  }

  store.addClips(duplicates);

  const msg = duplicates.length === 1 ? '1 clipe duplicado' : `${duplicates.length} clipes duplicados`;
  store.setImportProgress({
    clipId: 'clipboard',
    status: 'done',
    message: `${msg} (logo a seguir na timeline)`,
  });
  setTimeout(() => {
    if (useStore.getState().importProgress?.message?.includes('duplicado')) {
      useStore.getState().setImportProgress(null);
    }
  }, 2500);

  return duplicates.map((c) => c.id);
}
