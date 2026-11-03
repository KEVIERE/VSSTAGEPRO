// Fotos de partitura / cifra no caderno do músico. A imagem é diminuída e vira JPEG antes de
// ir para o caderno: uma foto de celular (3–5 MB) fica com uns 150–300 KB, e o caderno inteiro
// de uma música cabe no limite que o servidor aceita (MAX_DOC_BYTES).
import { MAX_DOC_BYTES, newId, serializeDoc, type NotebookDoc, type NotebookLine } from '@/lib/notebook';

const MAX_SIDE = 1600;
const MIN_SIDE = 700;
const START_QUALITY = 0.72;
const MIN_QUALITY = 0.42;
/** folga para o resto do caderno (título, texto) não estourar o limite depois */
const MARGIN = 20_000;
/** menos que isso por imagem já não dá para ler a partitura */
const MIN_IMAGE_BYTES = 45_000;

export type ImageImportResult =
  | { ok: true; lines: Extract<NotebookLine, { kind: 'image' }>[] }
  | { ok: false; reason: 'full' | 'unreadable' };

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

function encode(img: HTMLImageElement, side: number, quality: number): { src: string; w: number; h: number } {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('unreadable');
  // fundo branco: PNG com transparência não fica preto no JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { src: canvas.toDataURL('image/jpeg', quality), w, h };
}

/** Diminui até caber em `budget` caracteres: primeiro baixa a qualidade, depois o tamanho. */
async function shrink(file: File, budget: number) {
  const img = await loadImage(file);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('unreadable');
  let side = Math.min(MAX_SIDE, Math.max(img.naturalWidth, img.naturalHeight));
  for (;;) {
    for (let q = START_QUALITY; q >= MIN_QUALITY - 0.001; q -= 0.1) {
      const out = encode(img, side, q);
      if (out.src.length <= budget) return out;
    }
    if (side <= MIN_SIDE) return null;
    side = Math.max(MIN_SIDE, Math.round(side * 0.8));
  }
}

/**
 * Transforma os arquivos escolhidos em linhas de imagem do caderno, dividindo o espaço que
 * ainda sobra no caderno desta música entre elas.
 */
export async function imagesToLines(files: File[], doc: NotebookDoc): Promise<ImageImportResult> {
  const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
  if (!images.length) return { ok: false, reason: 'unreadable' };
  const free = MAX_DOC_BYTES - serializeDoc(doc).length - MARGIN;
  const each = Math.floor(free / images.length);
  if (each < MIN_IMAGE_BYTES) return { ok: false, reason: 'full' };
  const lines: Extract<NotebookLine, { kind: 'image' }>[] = [];
  for (const file of images) {
    try {
      const out = await shrink(file, each);
      if (!out) return lines.length ? { ok: true, lines } : { ok: false, reason: 'full' };
      lines.push({ id: newId(), kind: 'image', ...out });
    } catch {
      if (!lines.length && images.length === 1) return { ok: false, reason: 'unreadable' };
    }
  }
  return lines.length ? { ok: true, lines } : { ok: false, reason: 'unreadable' };
}

export const IMAGE_IMPORT_ERRORS: Record<'full' | 'unreadable', string> = {
  full: 'O caderno desta música está cheio. Apague uma imagem ou desenho para caber outra.',
  unreadable: 'Não consegui abrir essa imagem. Use uma foto em JPG ou PNG.',
};
