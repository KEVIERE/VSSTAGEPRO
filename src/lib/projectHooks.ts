// Partes do projeto que vivem fora do estado principal (os pads do Modo Show) entram no arquivo
// do projeto por aqui: o salvar pergunta o que gravar e o abrir avisa o que chegou. Sem import de
// nada, para o estado principal e o salvar usarem sem criar volta de import.

export interface ProjectExtraAsset {
  /** Nome do áudio dentro do pacote (ex.: "pad:12"). */
  id: string;
  /** Caminho numa pasta de projeto (ex.: "Pads/Banco B/4 - Aplausos.wav"). */
  relPath: string;
  /** O áudio para gravar (pode buscar no computador). */
  blob: () => Promise<Blob | null>;
  /** O áudio que está na memória agora (sem buscar), para saber se já está no arquivo. */
  current: () => Blob | null;
}

export interface ProjectExtras {
  /** Campos a mais no manifesto do projeto. */
  manifest: () => Record<string, unknown>;
  /** Áudios a mais no pacote. */
  assets: () => ProjectExtraAsset[];
  /** Áudios a mais de uma pasta de projeto: id e caminho de cada um, lidos do manifesto. */
  folderAssets: (manifest: Record<string, unknown>) => Array<{ id: string; path: string }>;
  /** Projeto aberto: o manifesto e os áudios do pacote. */
  loaded: (manifest: Record<string, unknown>, sources: Map<string, Blob>) => void;
  /** Depois de salvar, os áudios passam a ser os pedaços do arquivo novo. */
  rebind: (sources: Map<string, Blob>) => void;
}

const extras: ProjectExtras[] = [];

export function registerProjectExtras(x: ProjectExtras): void {
  if (!extras.includes(x)) extras.push(x);
}

export function projectExtras(): readonly ProjectExtras[] {
  return extras;
}

export function extraManifestFields(): Record<string, unknown> {
  return Object.assign({}, ...extras.map((x) => x.manifest()));
}
