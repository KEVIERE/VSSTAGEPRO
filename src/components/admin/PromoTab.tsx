import { useEffect, useState } from 'react';
import { ChevronDown, Copy, Plus, RefreshCw, Shuffle, Trash2 } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, dateTime, num, PROMO_KIND_LABEL, promoValueText } from '@/components/admin/adminApi';
import type { PromoCode } from '@/components/admin/adminApi';
import { btnDanger, btnGhost, btnPrimary, Empty, ErrorBox, input, Loading, Panel } from '@/components/admin/ui';

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'VS';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function PromoTab() {
  const [list, setList] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [code, setCode] = useState(randomCode);
  const [kind, setKind] = useState<PromoCode['kind']>('trial_hours');
  const [value, setValue] = useState('120');
  const [maxUses, setMaxUses] = useState('');
  const [expires, setExpires] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setList(await adminApi.promoList()); } catch (e) { setError(friendlyError((e as Error).message)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormMsg(null);
    try {
      const v = parseInt(value, 10);
      if (!(v > 0)) throw new Error('invalid_value');
      await adminApi.promoCreate({
        code: code.trim().toUpperCase(), kind, value: v,
        maxUses: maxUses ? parseInt(maxUses, 10) : null,
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        note,
      });
      setFormMsg({ ok: true, text: `Código ${code.toUpperCase()} criado.` });
      setCode(randomCode());
      setNote('');
      await load();
    } catch (err) {
      setFormMsg({ ok: false, text: friendlyError((err as Error).message) });
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn: () => Promise<void>) => {
    try { await fn(); await load(); } catch (e) { setError(friendlyError((e as Error).message)); }
  };

  const copy = (c: string) => {
    navigator.clipboard?.writeText(c).then(() => { setCopied(c); window.setTimeout(() => setCopied(null), 1500); }, () => {});
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Códigos promocionais</h2>
        <p className="text-xs text-logic-text-dim">Crie bônus para quem você quiser. A pessoa digita o código na tela de entrada do programa.</p>
      </div>

      <Panel title="Novo código">
        <form onSubmit={create} className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-2xs text-logic-text-muted">Código</span>
            <div className="flex gap-1.5">
              <input className={`${input} font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={32} required pattern="[A-Za-z0-9_\-]{3,32}" />
              <button type="button" className={btnGhost} onClick={() => setCode(randomCode())} aria-label="Gerar código"><Shuffle size={13} /></button>
            </div>
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-logic-text-muted">Tipo de bônus</span>
            <select className={input} value={kind} onChange={(e) => { const k = e.target.value as PromoCode['kind']; setKind(k); setValue(k === 'trial_hours' ? '120' : '30'); }}>
              <option value="trial_hours">{PROMO_KIND_LABEL.trial_hours}</option>
              <option value="free_days">{PROMO_KIND_LABEL.free_days}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-logic-text-muted">{kind === 'trial_hours' ? 'Horas extras de teste' : 'Dias de acesso'}</span>
            <input className={input} type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} required />
            <span className="text-2xs text-logic-text-dim">{parseInt(value, 10) > 0 ? promoValueText(kind, parseInt(value, 10)) : ' '}</span>
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-logic-text-muted">Limite de usos (vazio = sem limite)</span>
            <input className={input} type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Sem limite" />
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-logic-text-muted">Válido até (vazio = sem validade)</span>
            <input className={input} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-logic-text-muted">Anotação interna</span>
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: parceria banda X" maxLength={200} />
          </label>
          <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
            <button className={btnPrimary} disabled={saving}><Plus size={13} /> Criar código</button>
            {formMsg && <span className={`text-xs ${formMsg.ok ? 'text-logic-lcd-green' : 'text-logic-lcd-red'}`}>{formMsg.text}</span>}
          </div>
        </form>
      </Panel>

      {error && <ErrorBox text={error} />}

      <Panel
        title={`Códigos criados (${list.length})`}
        actions={<button type="button" className={btnGhost} onClick={load} aria-label="Atualizar"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>}
      >
        {loading && list.length === 0 ? <Loading /> : list.length === 0 ? <Empty text="Nenhum código criado ainda." /> : (
          <ul className="divide-y divide-logic-border">
            {list.map((p) => {
              const expired = !!p.expires_at && new Date(p.expires_at) <= new Date();
              const usedUp = p.max_uses !== null && p.uses >= p.max_uses;
              const live = p.active && !expired && !usedUp;
              return (
                <li key={p.code}>
                  <div className="px-4 py-3 flex flex-wrap items-center gap-3 text-xs">
                    <button type="button" onClick={() => copy(p.code)} className="font-mono font-bold text-sm hover:text-logic-lcd-green transition flex items-center gap-1.5" title="Copiar código">
                      {p.code} <Copy size={11} className="text-logic-text-muted" />
                    </button>
                    {copied === p.code && <span className="text-2xs text-logic-lcd-green">copiado</span>}
                    <span className={`px-1.5 h-5 rounded text-2xs font-bold inline-flex items-center ${live ? 'bg-logic-lcd-green/15 text-logic-lcd-green' : 'bg-logic-bg-elevated text-logic-text-muted'}`}>
                      {!p.active ? 'DESATIVADO' : expired ? 'EXPIRADO' : usedUp ? 'ESGOTADO' : 'ATIVO'}
                    </span>
                    <span className="text-logic-text">{promoValueText(p.kind, p.value)}</span>
                    <span className="text-logic-text-dim tabular-nums">{num(p.uses)}{p.max_uses ? ` / ${num(p.max_uses)}` : ''} usos</span>
                    {p.expires_at && <span className="text-logic-text-dim">até {dateTime(p.expires_at)}</span>}
                    {p.note && <span className="text-logic-text-muted italic truncate max-w-[220px]">{p.note}</span>}
                    <span className="ml-auto flex items-center gap-1.5">
                      <button type="button" className={btnGhost} onClick={() => setOpen(open === p.code ? null : p.code)}>
                        Quem usou <ChevronDown size={12} className={open === p.code ? 'rotate-180 transition' : 'transition'} />
                      </button>
                      <button type="button" className={btnGhost} onClick={() => act(() => adminApi.promoSetActive(p.code, !p.active))}>
                        {p.active ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        type="button" className={btnDanger} aria-label={`Apagar ${p.code}`}
                        onClick={() => { if (window.confirm(`Apagar o código ${p.code}? Os bônus já resgatados continuam valendo.`)) act(() => adminApi.promoDelete(p.code)); }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                  {open === p.code && (
                    <div className="px-4 pb-3">
                      {p.redemptions.length === 0 ? <p className="text-2xs text-logic-text-muted">Ninguém usou ainda.</p> : (
                        <ul className="rounded-md border border-logic-border divide-y divide-logic-border/60 text-2xs">
                          {p.redemptions.map((r) => (
                            <li key={r.email + r.redeemed_at} className="px-3 py-1.5 flex justify-between">
                              <span>{r.email}</span>
                              <span className="text-logic-text-muted">{dateTime(r.redeemed_at)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
