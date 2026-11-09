import { useRef, useState } from 'react';
import type { NotebookDoc } from '@/lib/notebook';
import { IMAGE_IMPORT_ERRORS, imagesToLines } from '@/lib/sheetImage';

type Update = (fn: (d: NotebookDoc) => NotebookDoc, coalesce?: string) => void;

/**
 * Importar fotos de partitura / cifra para o caderno da música. Devolve o campo de arquivo
 * (escondido) para pôr na tela e a função que abre a escolha das fotos.
 * `afterId`: as imagens entram logo abaixo desta linha (ou no fim do caderno).
 */
export function useImageImport({ doc, update, afterId, onResult }: {
  doc: NotebookDoc;
  update: Update;
  afterId?: string | null;
  onResult: (r: { ok: boolean; text: string }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);

  const run = async (files: FileList | null) => {
    if (!files?.length) return;
    setAdding(true);
    try {
      const res = await imagesToLines([...files], doc);
      if (!res.ok) { onResult({ ok: false, text: IMAGE_IMPORT_ERRORS[res.reason] }); return; }
      update((d) => {
        const idx = afterId ? d.lines.findIndex((l) => l.id === afterId) : -1;
        const lines = [...d.lines];
        lines.splice(idx >= 0 ? idx + 1 : lines.length, 0, ...res.lines);
        return { ...d, lines };
      });
      onResult({
        ok: true,
        text: res.lines.length === 1
          ? 'Imagem adicionada. Ela aparece no Modo show quando esta música tocar.'
          : `${res.lines.length} imagens adicionadas. Elas aparecem no Modo show quando esta música tocar.`,
      });
    } finally {
      setAdding(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={(e) => void run(e.target.files)}
    />
  );

  return { adding, open: () => fileRef.current?.click(), input };
}
