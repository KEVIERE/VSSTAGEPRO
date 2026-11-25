// Área do Assinante (vsstagepro.com.br/area-do-assinante): bônus só para quem paga em dia.
// A tela esconde o botão de quem não pode, mas quem manda é o servidor: o arquivo de cada
// bônus fica num bucket privado e a função bonus-download só entrega o link ao assinante.
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Download, Loader2, Lock } from 'lucide-react';
import DownloadAccess from '@/components/DownloadAccess';
import VsLogo from '@/components/VsLogo';
import { supabase } from '@/lib/supabaseClient';
import { supportWhatsAppUrl } from '@/lib/support';
import {
  BONUSES, accessOf, bonusDownloadError, canUseBonus, lockedNotice, untilLabel,
  type BonusAccess, type BonusItem,
} from '@/lib/bonus';
import '@/components/sales/sales.css';

export const SUBSCRIBER_AREA_HASH = 'area-do-assinante';

const GATE_TEXT = {
  heading: 'Área do Assinante',
  signin: 'Entre com a mesma conta do VS Stage Pro para ver os seus bônus.',
  signup: 'Crie sua conta. Os bônus ficam liberados para quem é assinante.',
  button: 'Entrar',
};

export default function SubscriberArea() {
  return (
    <DownloadAccess hash={SUBSCRIBER_AREA_HASH} text={GATE_TEXT}>
      {(session, signOut) => <SubscriberAreaContent session={session} onSignOut={signOut} />}
    </DownloadAccess>
  );
}

type Loaded = { access: BonusAccess; until: string | null };

function SubscriberAreaContent({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [state, setState] = useState<Loaded | 'loading' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    // bonus_access só lê a conta: não começa o teste grátis (license_status começa)
    const { data, error } = await supabase.rpc('bonus_access');
    if (error) { setState('error'); return; }
    setState({ access: accessOf(data), until: untilLabel((data as { until?: unknown } | null)?.until) });
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="vs-site min-h-screen">
      <header className="vs-nav">
        <div className="vs-wrap h-14 flex items-center gap-4">
          <a href={import.meta.env.BASE_URL} className="flex items-center gap-2.5 shrink-0">
            <VsLogo size={26} />
            <span className="vs-wordmark">VS Stage Pro</span>
          </a>
          <div className="ml-auto flex items-center gap-3 min-w-0">
            <span className="hidden sm:block truncate text-sm text-[color:var(--cream-dim)]">{session.user.email}</span>
            <button type="button" onClick={onSignOut} className="vs-key vs-key-sm vs-key-steel">Sair</button>
          </div>
        </div>
      </header>

      <main className="vs-wrap py-12 sm:py-16">
        <p className="vs-hero-pill"><span className="vs-led is-amber" />Área do Assinante</p>
        <h1 className="vs-display vs-h2 mt-5 text-[color:var(--cream)]">Seus bônus</h1>
        <p className="vs-lead mt-4">Ferramentas extras para quem é assinante do VS Stage Pro.</p>

        {state === 'loading' && (
          <p className="mt-10 flex items-center gap-2 text-[color:var(--cream-dim)]" role="status">
            <Loader2 size={16} className="animate-spin" /> Conferindo sua assinatura...
          </p>
        )}

        {state === 'error' && (
          <div className="vs-panel vs-card mt-10 p-6" role="alert">
            <p className="flex items-center gap-2 text-[color:var(--cream)]">
              <span className="vs-led is-red" /> Não foi possível conferir sua assinatura agora.
            </p>
            <button type="button" onClick={() => void load()} className="vs-key vs-key-sm vs-key-steel mt-4">Tentar de novo</button>
          </div>
        )}

        {typeof state === 'object' && <Bonuses access={state.access} until={state.until} />}
      </main>
    </div>
  );
}

function Bonuses({ access, until }: { access: BonusAccess; until: string | null }) {
  const allowed = canUseBonus(access);
  const notice = lockedNotice(access);
  const goNotice = () => {
    if (access === 'blocked') window.open(supportWhatsAppUrl('Olá! Minha conta do VS Stage Pro está bloqueada.'), '_blank', 'noopener');
    else window.location.href = `${import.meta.env.BASE_URL}#planos`;
  };

  return (
    <>
      {allowed ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-[color:var(--cream-dim)]" role="status">
          <span className="vs-led is-green" />
          Assinatura ativa{until ? ` até ${until}` : ''}. Todos os bônus estão liberados.
        </p>
      ) : notice && (
        <div className="vs-panel vs-card mt-8 p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center gap-5" role="status">
          <div className="flex-1">
            <p className="flex items-center gap-2 font-semibold text-[color:var(--cream)]">
              <span className={`vs-led ${access === 'blocked' ? 'is-red' : 'is-amber'}`} />{notice.title}
            </p>
            <p className="mt-2 text-sm text-[color:var(--cream-dim)]">{notice.text}</p>
          </div>
          <button type="button" onClick={goNotice} className="vs-key vs-key-amber shrink-0">{notice.cta}</button>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BONUSES.map((b) => <BonusCard key={b.id} bonus={b} allowed={allowed} />)}
      </div>
    </>
  );
}

function BonusCard({ bonus, allowed }: { bonus: BonusItem; allowed: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soon = bonus.kind === 'soon';

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('bonus-download', { body: { id: bonus.id } });
      if (err) {
        const res = await (err as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(res?.error ?? 'failed');
      }
      if (typeof data?.url !== 'string') throw new Error('failed');
      window.location.href = data.url;
    } catch (e) {
      setError(bonusDownloadError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`vs-panel vs-card p-6 flex flex-col ${!allowed ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="vs-display text-2xl text-[color:var(--cream)]">{bonus.title}</h2>
        {bonus.tag && <span className="vs-chip">{bonus.tag}</span>}
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-[color:var(--cream-dim)]">{bonus.description}</p>
      <div className="mt-5">
        {!allowed ? (
          <span className="inline-flex items-center gap-2 text-sm text-[color:var(--muted)]">
            <Lock size={14} /> Só para assinantes
          </span>
        ) : soon ? (
          <span className="inline-flex items-center gap-2 text-sm text-[color:var(--cream-dim)]">
            <span className="vs-led is-amber" /> Em breve
          </span>
        ) : (
          <button type="button" onClick={() => void download()} disabled={busy} className="vs-key vs-key-sm vs-key-amber disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            <span className="ml-1.5">{busy ? 'Liberando...' : 'Baixar'}</span>
          </button>
        )}
        {error && <p className="mt-3 text-sm text-[color:var(--red)]" role="alert">{error}</p>}
      </div>
    </article>
  );
}
