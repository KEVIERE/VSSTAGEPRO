// Formato do arquivo único do projeto (.vss, antigo .vsc):
// [magic][áudios...][manifest][f64 manifestOffset][u32 manifestLen][magic]
// O índice fica no final. Por isso, quando os áudios não mudaram, dá para trocar só o fim do
// arquivo (letras, mixagem, ordem das músicas) sem regravar centenas de megabytes de áudio.

export const VSC_MAGIC = 'VSSTAGE1';
export const TRAILER_SIZE = 20;

export interface PackageTail {
  /** Onde começa o manifest, que é também onde terminam os áudios. */
  manifestStart: number;
  manifestLen: number;
}

export interface PackageAsset {
  clipId: string;
  path: string;
  offset: number;
  size: number;
}

// Se o programa caiu no meio de uma gravação do app do Mac (que acrescenta o manifest novo no fim),
// o rodapé anterior continua inteiro um pouco antes do fim: procura ele de trás para frente.
const SCAN_BACK = 64 * 1024 * 1024;

function trailerEndingAt(view: DataView, viewStart: number, end: number): PackageTail | null {
  const at = end - TRAILER_SIZE - viewStart;
  if (at < 0 || at + TRAILER_SIZE > view.byteLength) return null;
  for (let i = 0; i < 8; i++) if (view.getUint8(at + 12 + i) !== VSC_MAGIC.charCodeAt(i)) return null;
  const manifestStart = view.getFloat64(at, true);
  const manifestLen = view.getUint32(at + 8, true);
  if (!Number.isFinite(manifestStart) || manifestStart < VSC_MAGIC.length) return null;
  if (manifestStart + manifestLen !== end - TRAILER_SIZE) return null;
  return { manifestStart, manifestLen };
}

/** Lê o rodapé do arquivo; devolve null quando não é um .vss inteiro. */
export async function readPackageTail(file: Blob): Promise<PackageTail | null> {
  const dataStart = VSC_MAGIC.length;
  if (file.size < dataStart + TRAILER_SIZE) return null;
  if (await file.slice(0, dataStart).text() !== VSC_MAGIC) return null;
  const last = new DataView(await file.slice(file.size - TRAILER_SIZE).arrayBuffer());
  const direct = trailerEndingAt(last, file.size - TRAILER_SIZE, file.size);
  if (direct) return direct;
  const start = Math.max(dataStart, file.size - SCAN_BACK);
  const bytes = new Uint8Array(await file.slice(start).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const m0 = VSC_MAGIC.charCodeAt(0);
  for (let i = bytes.length - 8; i >= 12; i--) {
    if (bytes[i] !== m0) continue;
    const found = trailerEndingAt(view, start, start + i + 8);
    if (found) return found;
  }
  return null;
}

export function packageTrailer(manifestStart: number, manifestLen: number): ArrayBuffer {
  const trailer = new ArrayBuffer(TRAILER_SIZE);
  const dv = new DataView(trailer);
  dv.setFloat64(0, manifestStart, true);
  dv.setUint32(8, manifestLen, true);
  for (let i = 0; i < 8; i++) dv.setUint8(12 + i, VSC_MAGIC.charCodeAt(i));
  return trailer;
}

/** Áudio que já está dentro do arquivo: posição absoluta no .vss e tamanho. */
export interface KeptAsset {
  clipId: string;
  path: string;
  begin: number;
  size: number;
}

// Clipe apagado deixa o áudio dele sobrando no arquivo. Até um pouco tudo bem; passou disso, vale
// regravar o arquivo inteiro uma vez para ele não crescer à toa.
const MAX_WASTE_SHARE = 0.25;
const MAX_WASTE_BYTES = 16 * 1024 * 1024;

/**
 * Índice novo apontando para os áudios que já estão no arquivo, ou null quando é melhor regravar
 * tudo (áudio fora da área de áudios, ou muito áudio sobrando de clipes apagados).
 */
export function keptAssetIndex(kept: KeptAsset[], tail: PackageTail): PackageAsset[] | null {
  const dataStart = VSC_MAGIC.length;
  const dataEnd = tail.manifestStart;
  const ranges: Array<[number, number]> = [];
  for (const k of kept) {
    if (!(k.size > 0) || k.begin < dataStart || k.begin + k.size > dataEnd) return null;
    ranges.push([k.begin, k.begin + k.size]);
  }
  // clipe duplicado aponta para o mesmo áudio: conta o trecho uma vez só
  ranges.sort((a, b) => a[0] - b[0]);
  let used = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of ranges) {
    if (s > curEnd) {
      used += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  used += curEnd - curStart;
  const waste = dataEnd - dataStart - used;
  if (waste > MAX_WASTE_BYTES && waste > (dataEnd - dataStart) * MAX_WASTE_SHARE) return null;
  return kept.map((k) => ({ clipId: k.clipId, path: k.path, offset: k.begin - dataStart, size: k.size }));
}

/** O que gravar no arquivo aberto: só aceita escrita numa posição e cortar o tamanho. */
export interface TailWriter {
  write(params: { type: 'write'; position: number; data: ArrayBuffer }): Promise<void>;
  truncate(size: number): Promise<void>;
}

/** Troca o manifest e o rodapé, mantendo os áudios onde estão. Devolve o tamanho final. */
export async function writePackageTail(writer: TailWriter, manifestStart: number, manifestJson: string): Promise<number> {
  const bytes = new TextEncoder().encode(manifestJson);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await writer.write({ type: 'write', position: manifestStart, data });
  await writer.write({ type: 'write', position: manifestStart + bytes.byteLength, data: packageTrailer(manifestStart, bytes.byteLength) });
  const size = manifestStart + bytes.byteLength + TRAILER_SIZE;
  await writer.truncate(size);
  return size;
}
