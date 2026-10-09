import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { LOGO_MAX_BYTES, LOGO_TYPES, directorShowLogo, removeShowLogo, uploadShowLogo } from '@/lib/showLogo';
import type { SavedShow } from '@/lib/useLiveBroadcast';

export default function BandLogoUpload({ show }: { show: SavedShow }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setUrl((await directorShowLogo(show.showId, show.directorKey)).url);
      setError(null);
    } catch {
      setError('Não foi possível carregar o logo.');
    } finally {
      setLoaded(true);
    }
  }, [show]);

  useEffect(() => { refresh(); }, [refresh]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Use um arquivo PNG (sem fundo), SVG ou JPEG.'); return; }
    if (file.size > LOGO_MAX_BYTES) { setError('O arquivo passa de 5 MB. Use uma versão menor do logo.'); return; }
    setBusy(true); setError(null);
    try {
      await uploadShowLogo(show.showId, show.directorKey, file);
      await refresh();
    } catch {
      setError('Não foi possível enviar o logo. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true); setError(null);
    try {
      await removeShowLogo(show.showId, show.directorKey);
      setUrl(null);
    } catch {
      setError('Não foi possível remover o logo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-logic-border-dark bg-logic-bg-deep px-4 py-3">
      <div className="flex items-center gap-2">
        <ImagePlus size={15} className="text-logic-accent" />
        <span className="text-sm font-semibold text-logic-text">Logo da banda</span>
      </div>
      <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
        Aparece na TV do palco enquanto nenhuma música está tocando. Use PNG sem fundo, SVG ou JPEG (até 5 MB).
      </p>

      <div className="flex items-center gap-3 mt-3">
        <div className="w-36 h-20 shrink-0 rounded-md bg-black border border-logic-border-dark flex items-center justify-center overflow-hidden">
          {!loaded || busy ? (
            <Loader2 size={18} className="animate-spin text-logic-text-muted" />
          ) : url ? (
            <img src={url} alt="Logo da banda" className="max-w-full max-h-full object-contain p-2 animate-[fadeIn_200ms_ease-out]" />
          ) : (
            <span className="text-2xs text-white/30 tracking-wider">SEM LOGO</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <button className="logic-btn-accent flex items-center gap-1.5 disabled:opacity-40" disabled={busy} onClick={() => inputRef.current?.click()}>
            {url ? <RefreshCw size={13} /> : <ImagePlus size={13} />} {url ? 'Trocar logo' : 'Anexar logo'}
          </button>
          {url && (
            <button className="flex items-center gap-1.5 text-xs text-logic-text-muted hover:text-logic-lcd-red transition-colors disabled:opacity-40" disabled={busy} onClick={remove}>
              <Trash2 size={13} /> Remover
            </button>
          )}
        </div>
        <input
          ref={inputRef} type="file" accept=".png,.svg,.jpg,.jpeg,image/png,image/svg+xml,image/jpeg" className="hidden"
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>
      {error && <p className="text-xs text-logic-lcd-red mt-2">{error}</p>}
    </div>
  );
}
