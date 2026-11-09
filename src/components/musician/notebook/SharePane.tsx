import { useEffect, useState } from 'react';
import { ChevronLeft, Share2 } from 'lucide-react';
import type { ColleagueInfo, SheetBackend } from '@/lib/musicianTypes';

const musicos = (n: number) => `${n} ${n === 1 ? 'músico' : 'músicos'}`;

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
      setResult({ ok: true, text: count === 1 ? 'Enviado: 1 músico recebeu a partitura desta música.' : `Enviado: ${musicos(count)} receberam a partitura desta música.` });
      setSelected(new Set());
    } catch {
      setResult({ ok: false, text: 'Não foi possível enviar. Tente novamente.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="console-rail flex items-center gap-2 px-3 py-2">
        <button onClick={onBack} className="console-key w-8 h-8 flex items-center justify-center" aria-label="Voltar">
          <ChevronLeft size={18} />
        </button>
        <span className="font-stage text-[15px] font-semibold tracking-wide text-logic-text">Enviar para outro músico</span>
      </div>
      <div className="flex-1 overflow-y-auto logic-scroll p-4 space-y-1.5">
        <p className="text-xs text-logic-text-muted mb-3 leading-relaxed">
          Vai tudo junto: fotos, cifras, partituras, texto e seus desenhos. Cada um recebe uma cópia na própria conta, que troca sozinha quando esta música tocar.
        </p>
        {result && (
          <div className={`mb-2 px-3 py-2 rounded border text-xs ${result.ok ? 'bg-logic-lcd-green/15 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'}`}>
            {result.text}
          </div>
        )}
        {colleagues === null && <p className="text-sm text-logic-text-muted text-center py-8">Carregando...</p>}
        {colleagues?.length === 0 && <p className="text-sm text-logic-text-muted text-center py-8">Nenhum outro músico no show ainda.</p>}
        {colleagues?.map((c) => (
          <label key={c.id} className={`console-key !font-sans flex items-center gap-3 px-3 py-2.5 cursor-pointer ${selected.has(c.id) ? '!border-logic-accent' : ''}`}>
            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-logic-accent" />
            <span className="console-tape px-2 py-1 !text-[13px]">{c.name}</span>
            {c.instrument && <span className="text-2xs text-logic-text-muted">{c.instrument}</span>}
          </label>
        ))}
      </div>
      {!!colleagues?.length && (
        <div className="console-rail px-4 py-3 border-t border-black">
          <button className="w-full logic-btn-accent py-2.5 flex items-center justify-center gap-2 disabled:opacity-50" onClick={send} disabled={busy || selected.size === 0}>
            <Share2 size={16} /> {selected.size ? `Enviar para ${musicos(selected.size)}` : 'Escolha para quem enviar'}
          </button>
        </div>
      )}
    </div>
  );
}
