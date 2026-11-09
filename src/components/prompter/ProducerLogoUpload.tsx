import { useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { LOGO_MAX_BYTES, LOGO_TYPES, producerRemoveShowLogo, producerUploadShowLogo } from '@/lib/showLogo';

/**
 * Troca da logo pelo próprio produtor técnico, na aba "Tela". Ele está no show, com a TV à
 * vista, e é quem percebe que a arte está errada. Autoriza pelo código do produtor.
 */
export default function ProducerLogoUpload({ code, logoUrl }: { code: string; logoUrl: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Use um arquivo PNG (sem fundo), SVG ou JPEG.'); return; }
    if (file.size > LOGO_MAX_BYTES) { setError('O arquivo passa de 5 MB. Use uma versão menor do logo.'); return; }
    setBusy(true); setError(null);
    try {
      await producerUploadShowLogo(code, file);
    } catch {
      setError('Não foi possível enviar a logo. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true); setError(null);
    try {
      await producerRemoveShowLogo(code);
    } catch {
      setError('Não foi possível remover a logo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-black bg-black/25 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ImagePlus size={14} className="text-logic-lcd-amber shrink-0" />
        <span className="console-legend flex-1 !text-logic-text">Logo da banda</span>
      </div>

      <div className="flex items-center gap-3 mt-2.5">
        <div className="w-28 h-16 shrink-0 rounded bg-black border border-black flex items-center justify-center overflow-hidden shadow-inner">
          {busy ? (
            <Loader2 size={16} className="animate-spin text-logic-text-muted" />
          ) : logoUrl ? (
            <img src={logoUrl} alt="Logo da banda" className="max-w-full max-h-full object-contain p-1.5" />
          ) : (
            <span className="console-legend !text-[10px] !text-white/30">SEM LOGO</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <button className="console-key flex items-center gap-1.5 h-7 px-2.5 text-[11px]" disabled={busy} onClick={() => inputRef.current?.click()}>
            {logoUrl ? <RefreshCw size={12} /> : <ImagePlus size={12} />} {logoUrl ? 'Trocar' : 'Enviar'}
          </button>
          {logoUrl && (
            <button className="console-key flex items-center gap-1.5 h-7 px-2.5 text-[11px] hover:!text-logic-lcd-red" disabled={busy} onClick={remove}>
              <Trash2 size={12} /> Remover
            </button>
          )}
        </div>
        <input
          ref={inputRef} type="file" accept=".png,.svg,.jpg,.jpeg,image/png,image/svg+xml,image/jpeg" className="hidden"
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>
      <p className="console-legend mt-2 !text-[10px] leading-relaxed">
        Aparece na TV quando nenhuma música está tocando. Ligue "Logo no canto" para ela ficar na tela o tempo todo.
      </p>
      {error && <p className="text-[11px] text-logic-lcd-red mt-1.5">{error}</p>}
    </div>
  );
}
