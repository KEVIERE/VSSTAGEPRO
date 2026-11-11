// Código de afiliado vindo do link (?ref=CODIGO). Guardado por 60 dias no localStorage e num
// cookie do próprio site (sem cookie de terceiros). Quando a pessoa entra na conta, o App.tsx
// chama affiliate_claim uma vez e apaga o código. Testado em tests/affiliate.test.mjs.

export const REF_TTL_MS = 60 * 24 * 3600_000;
const KEY = 'vs_ref';
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

/** Código no formato aceito (letras, números, - e _; 3 a 32), em maiúsculas, ou null. */
export function normalizeRefCode(raw: unknown): string | null {
  const code = String(raw ?? '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** ?ref=CODIGO no endereço (vale em qualquer página: /?ref=X, /planos?ref=X). */
export function refFromSearch(search: string): string | null {
  try {
    return normalizeRefCode(new URLSearchParams(search).get('ref'));
  } catch {
    return null;
  }
}

type Saved = { code: string; at: number };

export type RefEnv = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  getCookie: () => string;
  setCookie: (c: string) => void;
  now: () => number;
  secure: boolean;
};

function browserEnv(): RefEnv {
  return {
    getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
    removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* modo privado */ } },
    getCookie: () => { try { return document.cookie; } catch { return ''; } },
    setCookie: (c) => { try { document.cookie = c; } catch { /* sem cookie */ } },
    now: () => Date.now(),
    secure: typeof location !== 'undefined' && location.protocol === 'https:',
  };
}

function parseSaved(raw: string | null): Saved | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Saved>;
    const code = normalizeRefCode(v.code);
    return code && typeof v.at === 'number' ? { code, at: v.at } : null;
  } catch {
    return null;
  }
}

function cookieValue(cookies: string): string | null {
  for (const part of cookies.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === KEY) {
      try { return decodeURIComponent(rest.join('=')); } catch { return null; }
    }
  }
  return null;
}

export function makeRefStore(env: RefEnv) {
  const write = (s: Saved) => {
    const raw = JSON.stringify(s);
    env.setItem(KEY, raw);
    const maxAge = Math.max(0, Math.floor((s.at + REF_TTL_MS - env.now()) / 1000));
    env.setCookie(`${KEY}=${encodeURIComponent(raw)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${env.secure ? '; Secure' : ''}`);
  };

  /** Código guardado e ainda no prazo, ou null. */
  const read = (): string | null => {
    const saved = parseSaved(env.getItem(KEY)) ?? parseSaved(cookieValue(env.getCookie()));
    if (!saved) return null;
    if (env.now() - saved.at > REF_TTL_MS) { clear(); return null; }
    return saved.code;
  };

  /** Guarda o código do endereço. Primeiro que chega fica: um código guardado no prazo não é trocado. */
  const capture = (search: string): string | null => {
    const code = refFromSearch(search);
    if (!code) return read();
    const current = read();
    if (current) return current;
    write({ code, at: env.now() });
    return code;
  };

  const clear = () => {
    env.removeItem(KEY);
    env.setCookie(`${KEY}=; Max-Age=0; Path=/; SameSite=Lax${env.secure ? '; Secure' : ''}`);
  };

  return { read, capture, clear };
}

let store: ReturnType<typeof makeRefStore> | null = null;
const browserStore = () => (store ??= makeRefStore(browserEnv()));

export const captureAffiliateRef = (search = typeof location !== 'undefined' ? location.search : '') => browserStore().capture(search);
export const readAffiliateRef = () => browserStore().read();
export const clearAffiliateRef = () => browserStore().clear();
