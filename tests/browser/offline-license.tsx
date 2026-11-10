// Programa abrindo SEM internet, como no Mac: sessão guardada com o acesso vencido, todo pedido
// ao Supabase falha como rede caída e a última conferência vem do "Mac" falso (window.vsDesktop).
// ?off=1 (Mac sem rede), ?c=trial (teste no prazo), ?c=trialEnded, ?c=active, ?c=never (nunca conferiu), ?c=clock (relógio voltado).
import '../../src/index.css';

const H = 3600 * 1000;
const D = 24 * H;
const now = Date.now();
const userId = '00000000-0000-4000-8000-00000000abcd';
const scenario = new URLSearchParams(location.search).get('c') ?? 'trial';
const iso = (ms: number) => new Date(ms).toISOString();

// ?off=1: o Mac sem Wi-Fi nem cabo (navigator.onLine falso); sem ele, rede que não responde
if (new URLSearchParams(location.search).has('off')) Object.defineProperty(navigator, 'onLine', { get: () => false });
(window as unknown as Record<string, unknown>).__t0 = performance.now();

// rede caída: qualquer pedido para fora falha como no Mac sem internet
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/supabase\.co/.test(url)) return Promise.reject(new TypeError('Failed to fetch'));
  return realFetch(input, init);
};

// sessão guardada no aparelho, com o acesso de 1 hora já vencido
localStorage.setItem('sb-eknjqqiamuztomdygalv-auth-token', JSON.stringify({
  access_token: 'vencido', refresh_token: 'guardado', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor((now - 5 * H) / 1000),
  user: { id: userId, email: 'teste@exemplo.com', user_metadata: { name: 'Teste Offline' }, aud: 'authenticated', app_metadata: {}, created_at: iso(now - 9 * D) },
}));
sessionStorage.clear();

const checkedAt = now - 2 * D;
const caches: Record<string, unknown> = {
  trial: { userId, license: { status: 'trial', ends_at: iso(now + 3 * D + 4 * H) }, checkedAt, maxSeen: checkedAt },
  trialEnded: { userId, license: { status: 'trial', ends_at: iso(now - H) }, checkedAt, maxSeen: checkedAt },
  active: { userId, license: { status: 'active', subscription: 'pix', plan: 'monthly', current_period_end: iso(now + 20 * D) }, checkedAt, maxSeen: checkedAt },
  never: null,
  clock: { userId, license: { status: 'trial', ends_at: iso(now + 3 * D) }, checkedAt, maxSeen: now + 2 * D },
};
const saved: unknown[] = [];
(window as unknown as Record<string, unknown>).vsDesktop = {
  appReady: () => {},
  notifySessionState: () => {},
  licenseCacheLoad: async () => caches[scenario] ?? null,
  licenseCacheSave: async (...args: unknown[]) => { saved.push(args); return true; },
  licenseCacheClear: async () => {},
};
(window as unknown as Record<string, unknown>).__saved = saved;

const { createRoot } = await import('react-dom/client');
const { default: DirectorAccess, TrialBadge } = await import('../../src/components/DirectorAccess');

createRoot(document.getElementById('root')!).render(
  <DirectorAccess>
    {(license) => (
      <div style={{ padding: 24, color: '#ddd', fontFamily: 'sans-serif' }}>
        <p id="editor">EDITOR ABERTO ({license.status})</p>
        <div style={{ marginTop: 12 }}><TrialBadge license={license} /></div>
      </div>
    )}
  </DirectorAccess>,
);
