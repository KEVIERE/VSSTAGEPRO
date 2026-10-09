import { useState } from 'react';
import { AlertTriangle, Globe, Check } from 'lucide-react';
import { isPrivateOrigin, normalizePublicAddress, savePublicAddress, usePublicAddress } from '@/lib/publicUrl';

export default function PublicLinkNotice() {
  const address = usePublicAddress();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const normalized = normalizePublicAddress(draft);
    if (!normalized) { setInvalid(true); return; }
    savePublicAddress(normalized);
    setEditing(false);
    setInvalid(false);
  };

  if (!editing) {
    if (!isPrivateOrigin()) return null;
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-logic-lcd-green/10 border border-logic-lcd-green/30 text-xs text-logic-text-muted">
        <Globe size={13} className="shrink-0 text-logic-lcd-green" />
        <span className="flex-1 min-w-0 truncate">Links online usam <span className="font-mono text-logic-text">{address}</span></span>
        <button
          className="shrink-0 text-logic-accent hover:underline"
          onClick={() => { setDraft(address); setEditing(true); }}
        >
          Alterar
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 rounded-md bg-logic-lcd-amber/10 border border-logic-lcd-amber/40 text-xs leading-relaxed text-logic-lcd-amber space-y-2">
      <div className="flex gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>
          Cole o endereço do VS Stage publicado na internet (o mesmo que abre no navegador, por exemplo <span className="font-mono">https://seu-site.bolt.host</span>). Os links online passam a usar esse endereço.
        </span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); save(); }}
      >
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
          placeholder="https://..."
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-logic-bg-panel border border-logic-border-dark text-logic-text font-mono placeholder:text-logic-text-muted focus:outline-none focus:border-logic-accent transition-colors"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-logic-accent text-white font-semibold disabled:opacity-40 hover:brightness-110 transition"
        >
          <Check size={13} /> Salvar
        </button>
        <button type="button" className="px-2 text-logic-text-muted hover:text-logic-text" onClick={() => { setEditing(false); setInvalid(false); }}>
          Cancelar
        </button>
      </form>
      {invalid && (
        <p className="text-logic-lcd-red">
          Esse endereço não serve. Use o endereço completo da internet, começando com https:// (não vale endereço da rede local nem deste computador).
        </p>
      )}
    </div>
  );
}
