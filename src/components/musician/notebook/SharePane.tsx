import { useEffect, useState } from 'react';
import { ChevronLeft, Share2 } from 'lucide-react';
import type { ColleagueInfo, SheetBackend } from '@/lib/musicianTypes';

export default function SharePane({ backend, sheetId, onBack }: { backend: SheetBackend; sheetId: string | null; onBack: () => void }) {
  const [colleagues, setColleagues] = useState<ColleagueInfo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend.colleagues().then(setColleagues).catch(() => {
      setColleagues([]);
      setResult({ ok: false, text: 'Não foi possível carregar os colegas.' });
    });
  }, [backend]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const send = async () => {
    if (!sheetId) return;
    setBusy(true);
    try {
      const count = await backend.share(sheetId, [...selected]);
      setResult({ ok: true, text: `${count} colega(s) receberam o caderno desta música.` });
      setSelected(new Set());
    } catch {
      setResult({ ok: false, text: 'Não foi possível enviar. Tente novamente.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-logic-border-dark bg-logic-bg-panel">
        <button onClick={onBack} className="p-1.5 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-medium text-logic-text">Compartilhar caderno</span>
      </div>
      <div className="flex-1 overflow-y-auto logic-scroll p-4 space-y-1.5">
        <p className="text-xs text-logic-text-muted mb-3 leading-relaxed">
          Vai tudo junto: texto, cifras, partituras e seus desenhos. O colega pode apagar os desenhos se quiser.
        </p>
        {result && (
          <div className={`mb-2 px-3 py-2 rounded border text-xs ${result.ok ? 'bg-logic-lcd-green/15 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'}`}>
            {result.text}
          </div>
        )}
        {colleagues === null && <p className="text-sm text-logic-text-muted text-center py-8">Carregando...</p>}
        {colleagues?.length === 0 && <p className="text-sm text-logic-text-muted text-center py-8">Nenhum outro músico no show ainda.</p>}
        {colleagues?.map((c) => (
          <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded bg-logic-bg-deep border border-logic-border-dark cursor-pointer hover:border-logic-border-light transition-colors">
            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-logic-accent" />
            <span className="text-sm font-medium text-logic-text">{c.name}</span>
            {c.instrument && <span className="text-2xs text-logic-text-muted">{c.instrument}</span>}
          </label>
        ))}
      </div>
      {!!colleagues?.length && (
        <div className="px-4 py-3 border-t border-logic-border-dark bg-logic-bg-panel">
          <button className="w-full logic-btn-accent py-2.5 flex items-center justify-center gap-2 disabled:opacity-50" onClick={send} disabled={busy || selected.size === 0}>
            <Share2 size={16} /> Enviar para {selected.size} colega(s)
          </button>
        </div>
      )}
    </div>
  );
}
