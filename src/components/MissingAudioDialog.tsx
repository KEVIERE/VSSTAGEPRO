import { useState } from 'react';
import { AlertTriangle, FolderOpen, FileAudio, CheckCircle2, X } from 'lucide-react';
import { useStore } from '@/store';
import { registerClipSource } from '@/lib/audioLibrary';
import { rememberProject } from '@/lib/recentProjects';
import { stopPlayback } from '@/lib/transportControl';
import type { AudioClip } from '@/types';

function pickAudioFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.aif,.aiff';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

function pickAudioFolder(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });
    input.click();
  });
}

export default function MissingAudioDialog() {
  const missingProject = useStore((s) => s.missingAudioProject);
  const setMissingAudioProject = useStore((s) => s.setMissingAudioProject);
  const applyLoadedProject = useStore((s) => s.applyLoadedProject);
  const [relinkedMap, setRelinkedMap] = useState<Map<string, File>>(new Map());

  if (!missingProject) return null;

  const { manifest, sources, target } = missingProject;
  const songsMap = new Map((manifest.songs ?? []).map((s) => [s.id, s.name]));
  const tracksMap = new Map((manifest.tracks ?? []).map((t) => [t.id, t.name]));

  const missingClips = (manifest.clips ?? []).filter((c) => {
    const src = sources.get(c.id);
    return (!src || src.size === 0) && !relinkedMap.has(c.id);
  });

  const allMissing = (manifest.clips ?? []).filter((c) => {
    const src = sources.get(c.id);
    return !src || src.size === 0;
  });

  const handleOpenProject = () => {
    stopPlayback();
    // Aplica os arquivos relocalizados às fontes antes de abrir
    for (const [clipId, file] of relinkedMap.entries()) {
      sources.set(clipId, file);
      const clip = manifest.clips?.find((c) => c.id === clipId);
      if (clip) {
        registerClipSource(clip.id, clip.songId, file);
      }
    }
    applyLoadedProject(manifest, sources, target);
    const name = manifest.projectName || 'Sem Nome';
    void rememberProject(name, target);
    setMissingAudioProject(null);
  };

  const handleRelinkSingle = async (clip: AudioClip) => {
    const file = await pickAudioFile();
    if (!file) return;
    setRelinkedMap((prev) => {
      const next = new Map(prev);
      next.set(clip.id, file);
      return next;
    });
  };

  const handleRelinkFolder = async () => {
    const files = await pickAudioFolder();
    if (files.length === 0) return;
    const fileByName = new Map<string, File>();
    for (const f of files) {
      fileByName.set(f.name.toLowerCase(), f);
    }

    setRelinkedMap((prev) => {
      const next = new Map(prev);
      for (const clip of allMissing) {
        if (next.has(clip.id)) continue;
        const nameCandidates = [
          clip.fileName?.toLowerCase(),
          clip.name?.toLowerCase(),
          clip.filePath ? clip.filePath.split('/').pop()?.toLowerCase() : null,
        ].filter(Boolean) as string[];

        for (const cand of nameCandidates) {
          const match = fileByName.get(cand);
          if (match) {
            next.set(clip.id, match);
            break;
          }
        }
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-[fadeIn_150ms_ease-out]">
      <div className="flex flex-col w-full max-w-xl max-h-[85vh] rounded-xl border border-logic-border-light bg-logic-bg-panel shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-logic-border-dark bg-logic-bg-deep shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-logic-lcd-amber/15 text-logic-lcd-amber">
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-logic-text">Áudios não encontrados no projeto</h2>
            <p className="text-2xs text-logic-text-muted mt-0.5">
              {allMissing.length} {allMissing.length === 1 ? 'áudio não foi localizado' : 'áudios não foram localizados'} no projeto "{manifest.projectName}".
            </p>
          </div>
          <button
            onClick={() => setMissingAudioProject(null)}
            className="p-1 rounded text-logic-text-muted hover:text-logic-text transition-colors"
            title="Cancelar abertura"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 logic-scroll space-y-4">
          <p className="text-xs text-logic-text-dim leading-relaxed">
            Você pode navegar até os arquivos no computador para reconectá-los agora, ou ignorar e abrir o projeto sem eles (as faixas sem áudio ficarão em silêncio).
          </p>

          <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-logic-bg-deep border border-logic-border-dark">
            <div className="text-2xs text-logic-text-muted">
              Tem todos os áudios em uma pasta no seu computador?
            </div>
            <button
              onClick={handleRelinkFolder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-logic-bg-elevated border border-logic-border-light text-xs font-semibold text-logic-text hover:bg-logic-accent hover:text-white hover:border-logic-accent transition-colors"
            >
              <FolderOpen size={14} />
              Localizar pasta de áudios...
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="text-2xs font-semibold uppercase tracking-wider text-logic-text-muted px-1">
              Lista de áudios ({allMissing.length - relinkedMap.size} pendentes)
            </div>
            <div className="rounded-lg border border-logic-border-dark divide-y divide-logic-border-dark bg-logic-bg-deep overflow-hidden">
              {allMissing.map((clip) => {
                const songName = songsMap.get(clip.songId) ?? 'Música';
                const trackName = tracksMap.get(clip.trackId) ?? 'Faixa';
                const fileName = clip.fileName || clip.filePath?.split('/').pop() || clip.name;
                const isResolved = relinkedMap.has(clip.id);

                return (
                  <div key={clip.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <div className="flex-shrink-0">
                      {isResolved ? (
                        <CheckCircle2 size={16} className="text-logic-lcd-green" />
                      ) : (
                        <FileAudio size={16} className="text-logic-lcd-amber/70" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-logic-text truncate">{fileName}</span>
                        {isResolved && (
                          <span className="text-[10px] font-medium text-logic-lcd-green bg-logic-lcd-green/10 px-1.5 py-0.2 rounded">
                            Reconectado
                          </span>
                        )}
                      </div>
                      <div className="text-2xs text-logic-text-muted truncate mt-0.5">
                        {songName} • {trackName}
                      </div>
                    </div>
                    {!isResolved && (
                      <button
                        onClick={() => handleRelinkSingle(clip)}
                        className="flex-shrink-0 px-2 py-1 rounded border border-logic-border-light bg-logic-bg-elevated text-2xs font-medium text-logic-text hover:border-logic-accent hover:text-white transition-colors"
                      >
                        Localizar...
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-logic-border-dark bg-logic-bg-deep shrink-0">
          <button
            onClick={handleOpenProject}
            className="px-4 py-2 rounded-md border border-logic-border-light bg-logic-bg-elevated text-xs font-semibold text-logic-text-muted hover:text-white hover:bg-white/10 transition-colors"
          >
            Ignorar e abrir sem eles
          </button>
          <button
            onClick={handleOpenProject}
            className="px-5 py-2 rounded-md bg-logic-accent text-xs font-semibold text-white hover:brightness-110 shadow transition"
          >
            {relinkedMap.size > 0 ? `Concluir e abrir projeto (${relinkedMap.size} reconectados)` : 'Abrir projeto'}
          </button>
        </div>
      </div>
    </div>
  );
}
