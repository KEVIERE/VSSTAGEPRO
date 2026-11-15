/**
 * Decisões puras da exportação de áudio: quais músicas entram, como se chamam as pastas e
 * os arquivos e onde cada WAV fica. Sem áudio nem disco, para dar para testar no node.
 */
import type { ProjectState, Song } from '@/types';

export type ExportScope = 'musica' | 'projeto';
export type ExportPlanMode = 'lr' | 'multipista' | 'show-continuo' | 'projeto-rpp';

export interface ExportSelection {
  scope: ExportScope;
  /** Músicas marcadas (escopo 'musica'), na ordem em que serão exportadas. */
  songIds?: string[];
  /** Forma antiga: uma música só. Vale quando songIds vem vazio. */
  songId?: string;
}

export function sanitize(name: string): string {
  return (name || '').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'Sem Nome';
}

/**
 * Músicas a exportar. No projeto inteiro: as da sequência do show ativo, na ordem dele (todas,
 * inclusive repetidas). Nas marcadas: na ordem recebida, sem repetir e ignorando ids que sumiram.
 */
export function exportSongs(req: ExportSelection, state: Pick<ProjectState, 'songs' | 'playlist' | 'playlistOrder'>): Song[] {
  const byId = new Map(state.songs.map((song) => [song.id, song]));
  if (req.scope === 'musica') {
    const ids = req.songIds?.length ? req.songIds : req.songId ? [req.songId] : [];
    return Array.from(new Set(ids)).map((id) => byId.get(id)).filter((s): s is Song => !!s);
  }
  const fromEntries = state.playlist.map((e) => byId.get(e.songId)).filter((s): s is Song => !!s);
  if (fromEntries.length > 0) return fromEntries;
  const fromOrder = state.playlistOrder.map((id) => byId.get(id)).filter((s): s is Song => !!s);
  return fromOrder.length > 0 ? fromOrder : state.songs;
}

/** Pasta de cada música: nomes iguais (ou que ficam iguais sem os caracteres proibidos) não se sobrescrevem. */
export function songFolderNames(songs: Pick<Song, 'name'>[]): string[] {
  const used = new Set<string>();
  return songs.map((song) => {
    const base = sanitize(song.name);
    let folder = base;
    let n = 2;
    while (used.has(folder.toLocaleLowerCase())) folder = `${base} (${n++})`;
    used.add(folder.toLocaleLowerCase());
    return folder;
  });
}

export type ExportDestination =
  | { kind: 'file'; name: string }
  | { kind: 'folder'; title: string; zipName: string };

export interface ExportPlan {
  /** Mais de uma música: uma pasta por música dentro da pasta principal. */
  multi: boolean;
  destination: ExportDestination;
  /** Pasta principal dentro do destino ('' quando é um arquivo só). */
  baseRel: string;
}

export const SELECTION_LABEL = 'MÚSICAS SELECIONADAS';

export function planExport(scope: ExportScope, mode: ExportPlanMode, songNames: string[], projectName: string): ExportPlan {
  const project = sanitize(projectName);
  const multi = scope === 'projeto' || songNames.length > 1;
  // músicas marcadas (2 ou mais) não usam o mesmo nome do export do projeto inteiro
  const selection = scope === 'musica' && multi;
  const label = selection ? `${project} - ${SELECTION_LABEL}` : project;
  const first = sanitize(songNames[0] ?? '');

  if (mode === 'projeto-rpp') {
    // sempre uma pasta: o .rpp e a pasta Audio com os WAVs de cada faixa
    const name = `${multi ? label : first} - PROJETO RPP`;
    return {
      multi: true,
      destination: { kind: 'folder', title: 'Escolha onde salvar o projeto .RPP', zipName: `${name}.zip` },
      baseRel: `${name}/`,
    };
  }
  if (mode === 'show-continuo') {
    const name = scope === 'projeto' ? `${project} - SHOW COMPLETO CONTÍNUO.wav` : `${project} - ${SELECTION_LABEL} CONTÍNUO.wav`;
    return { multi, destination: { kind: 'file', name }, baseRel: '' };
  }
  if (!multi && mode === 'lr') {
    return { multi, destination: { kind: 'file', name: `${first} - LR MASTER.wav` }, baseRel: '' };
  }
  if (!multi) {
    return {
      multi,
      destination: { kind: 'folder', title: 'Escolha onde salvar a multipista', zipName: `${first} - MULTIPISTA.zip` },
      baseRel: `${first}/`,
    };
  }
  const suffix = mode === 'lr' ? 'LR MASTER' : 'MULTIPISTA';
  return {
    multi,
    destination: {
      kind: 'folder',
      title: selection ? 'Escolha onde salvar as músicas' : 'Escolha onde salvar o projeto',
      zipName: `${label} - ${suffix}.zip`,
    },
    baseRel: `${label}/`,
  };
}

/** Caminho de um arquivo dentro do destino. */
export function exportFilePath(plan: ExportPlan, songFolder: string, fileName: string): string {
  return plan.multi ? `${plan.baseRel}${songFolder}/${fileName}` : `${plan.baseRel}${fileName}`;
}

/** O que o "Mostrar no Finder" aponta no fim. */
export function exportRevealPath(plan: ExportPlan, mode: ExportPlanMode, lrFileName: string): string {
  return !plan.multi && mode === 'lr' ? lrFileName : plan.baseRel.replace(/\/$/, '');
}
