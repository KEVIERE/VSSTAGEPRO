import { useEffect, useState } from 'react';
import { Activity, BarChart3, History, Loader2, Lock, LogOut, Mail, ShieldAlert, Tag, Users, GitBranch } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { friendlyError } from '@/lib/friendlyError';
import VsLogo from '@/components/VsLogo';
import { adminApi } from '@/components/admin/adminApi';
import OverviewTab from '@/components/admin/OverviewTab';
import UsersTab from '@/components/admin/UsersTab';
import PromoTab from '@/components/admin/PromoTab';
import UsageTab from '@/components/admin/UsageTab';
import AuditTab from '@/components/admin/AuditTab';
import VersionsTab from '@/components/admin/VersionsTab';
import { input } from '@/components/admin/ui';

const TABS = [
  { id: 'overview', label: 'Visão geral', icon: BarChart3 },
  { id: 'users', label: 'Usuários', icon: Users },
  { id: 'promo', label: 'Códigos promocionais', icon: Tag },
  { id: 'usage', label: 'Funções mais usadas', icon: Activity },
  { id: 'versions', label: 'Versões', icon: GitBranch },
  { id: 'audit', label: 'Histórico', icon: History },
] as const;
type TabId = typeof TABS[number]['id'];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-logic-bg-deep text-logic-text flex items-center justify-center p-6 overflow-y-auto">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-logic-accent/10 blur-3xl" />
      </div>
      <div className="relative w-[380px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
          <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">ADMINISTRAÇÃO</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>(() => {
    const t = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('aba');
    return (TABS.find((x) => x.id === t)?.id ?? 'overview') as TabId;
  });

  useEffect(() => {
    document.title = 'VS Stage Pro — Administração';
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setAllowed(null); return; }
    adminApi.isAdmin().then(setAllowed, () => setAllowed(false));
  }, [session]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError(friendlyError(err.message));
    setBusy(false);
  };

  if (!ready || (session && allowed === null)) {
    return <div className="fixed inset-0 flex items-center justify-center bg-logic-bg-deep"><Loader2 className="animate-spin text-logic-text-muted" /></div>;
  }

  if (!session) {
    return (
      <Shell>
        <form onSubmit={signIn} className="px-6 pt-6 pb-6 space-y-3">
          <div className="text-center mb-4">
            <div className="mx-auto w-16 h-16 mb-3 flex items-center justify-center"><VsLogo size={64} /></div>
            <h1 className="text-lg font-semibold">Painel do VS Stage Pro</h1>
            <p className="text-xs text-logic-text-dim mt-1">Entre com uma conta de administrador</p>
          </div>
          {error && <div className="px-3 py-2 rounded-lg border bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red text-xs text-center">{error}</div>}
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted pointer-events-none" />
            <input className={`${input} pl-9`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" autoComplete="email" required autoFocus />
          </div>
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted pointer-events-none" />
            <input className={`${input} pl-9`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" autoComplete="current-password" required />
          </div>
          <button type="submit" disabled={busy} className="w-full py-2.5 rounded-lg bg-logic-lcd-green text-black text-sm font-bold hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Loader2 size={15} className="animate-spin" />} Entrar
          </button>
        </form>
      </Shell>
    );
  }

  if (!allowed) {
    return (
      <Shell>
        <div className="px-6 py-7 text-center">
          <ShieldAlert size={28} className="mx-auto text-logic-lcd-red mb-3" />
          <h1 className="text-lg font-semibold">Acesso restrito</h1>
          <p className="text-xs text-logic-text-dim mt-2">
            A conta <span className="text-logic-text">{session.user.email}</span> não é administradora.
          </p>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="w-full h-10 border-t border-logic-border text-xs text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated transition flex items-center justify-center gap-1.5">
          <LogOut size={13} /> Sair e entrar com outra conta
        </button>
      </Shell>
    );
  }

  const go = (t: TabId) => { setTab(t); window.history.replaceState(null, '', `#admin?aba=${t}`); };

  return (
    <div className="fixed inset-0 bg-logic-bg-deep text-logic-text flex">
      <nav className="w-56 shrink-0 bg-logic-bg-panel border-r border-logic-border flex flex-col">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-logic-border">
          <VsLogo size={30} />
          <div className="leading-tight">
            <p className="text-sm font-semibold">VS Stage Pro</p>
            <p className="text-2xs text-logic-text-muted tracking-wider">ADMINISTRAÇÃO</p>
          </div>
        </div>
        <ul className="p-2 space-y-0.5 flex-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button" onClick={() => go(id)}
                className={`w-full flex items-center gap-2.5 px-3 h-9 rounded-md text-xs font-medium transition ${tab === id ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated/50'}`}
              >
                <Icon size={14} className={tab === id ? 'text-logic-lcd-green' : ''} /> {label}
              </button>
            </li>
          ))}
        </ul>
        <div className="p-3 border-t border-logic-border">
          <p className="text-2xs text-logic-text-muted truncate mb-2">{session.user.email}</p>
          <button onClick={() => supabase.auth.signOut()} className="w-full h-8 rounded-md bg-logic-bg-elevated text-xs text-logic-text-dim hover:text-logic-text transition flex items-center justify-center gap-1.5">
            <LogOut size={13} /> Sair
          </button>
        </div>
      </nav>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          {tab === 'overview' && <OverviewTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'promo' && <PromoTab />}
          {tab === 'usage' && <UsageTab />}
          {tab === 'versions' && <VersionsTab />}
          {tab === 'audit' && <AuditTab />}
        </div>
      </main>
    </div>
  );
}
