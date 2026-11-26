// Stage Download (vsstagepro.com.br/stagedownload): bônus da Área do Assinante. A pessoa cola
// um link, escolhe formato e qualidade (só até o máximo que o link tem) e o servidor do site
// baixa e converte (stage-download/server.py, atrás do nginx em /stagedownload/api). Só
// assinante em dia ou parceiro usa: a página confere em bonus_access e o servidor confere de novo.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowLeft, ClipboardPaste, Download, Loader2, Lock } from 'lucide-react';
import DownloadAccess from '@/components/DownloadAccess';
import VsLogo from '@/components/VsLogo';
import { supabase } from '@/lib/supabaseClient';
import { accessOf, canUseBonus, lockedNotice, type BonusAccess } from '@/lib/bonus';
import {
  STAGE_DOWNLOAD_API, downloadError, fileUrl, firstLink, orderedQualities, qualityLabel, topQuality,
  type AudioFormats, type SdInfo, type SdJob,
} from '@/lib/stageDownload';
import '@/components/sales/sales.css';

const GATE_TEXT = {
  heading: 'Stage Download',
  signin: 'Entre com a mesma conta do VS Stage Pro. O Stage Download é um bônus para assinantes.',
  signup: 'Crie sua conta. O Stage Download fica liberado para quem é assinante.',
  button: 'Entrar',
};

const BASE = import.meta.env.BASE_URL;

export default function StageDownloadPage() {
  return (
    <DownloadAccess hash="stagedownload" text={GATE_TEXT}>
      {(session, signOut) => <Gate session={session} onSignOut={signOut} />}
    </DownloadAccess>
  );
}

function Shell({ session, onSignOut, children }: { session: Session; onSignOut: () => void; children: React.ReactNode }) {
  return (
    <div className="vs-site min-h-screen">
      <header className="vs-nav">
        <div className="h-12 px-5 xl:px-8 flex items-center gap-4">
          <a href={BASE} className="flex items-center gap-2 shrink-0">
            <VsLogo size={22} />
            <span className="vs-wordmark">VS Stage Pro</span>
          </a>
          <a href={`${BASE}area-do-assinante`} className="vs-nav-link hidden sm:inline-flex items-center gap-1 ml-4">
            <ArrowLeft size={12} /> Área do Assinante
          </a>
          <div className="ml-auto flex items-center gap-3 min-w-0">
            <span className="hidden sm:block truncate text-xs text-[color:var(--cream-dim)]">{session.user.email}</span>
            <button type="button" onClick={onSignOut} className="vs-key vs-key-nav vs-key-steel">Sair</button>
          </div>
        </div>
      </header>
      <main className="vs-wrap max-w-[860px] py-10 sm:py-14">{children}</main>
    </div>
  );
}

function Gate({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [access, setAccess] = useState<BonusAccess | 'loading' | 'error'>('loading');
  const load = useCallback(async () => {
    setAccess('loading');
    const { data, error } = await supabase.rpc('bonus_access');
    setAccess(error ? 'error' : accessOf(data));
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Shell session={session} onSignOut={onSignOut}>
      <p className="vs-hero-pill"><span className="vs-led is-amber" />Bônus do assinante</p>
      <h1 className="vs-display vs-h2 mt-5 text-[color:var(--cream)]">Stage Download</h1>
      <p className="vs-lead mt-4">
        Cole o link de uma música ou vídeo do YouTube, Instagram, Facebook, TikTok, Spotify ou Deezer e baixe na qualidade
        original, em MP3, WAV, FLAC ou M4A.
      </p>
      {access === 'loading' && (
        <p className="mt-10 flex items-center gap-2 text-[color:var(--cream-dim)]" role="status">
          <Loader2 size={16} className="animate-spin" /> Conferindo sua assinatura...
        </p>
      )}
      {access === 'error' && (
        <div className="vs-panel vs-card mt-10 p-6" role="alert">
          <p className="text-[color:var(--cream)]">Não foi possível conferir sua assinatura agora.</p>
          <button type="button" onClick={() => void load()} className="vs-key vs-key-sm vs-key-steel mt-4">Tentar de novo</button>
        </div>
      )}
      {access !== 'loading' && access !== 'error' && (canUseBonus(access)
        ? <Downloader session={session} />
        : <Locked access={access} />)}
    </Shell>
  );
}

function Locked({ access }: { access: BonusAccess }) {
  const n = lockedNotice(access);
  if (!n) return null;
  return (
    <div className="vs-panel vs-card mt-10 p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center gap-5" role="status">
      <div className="flex-1">
        <p className="flex items-center gap-2 font-semibold text-[color:var(--cream)]"><Lock size={15} />{n.title}</p>
        <p className="mt-2 text-sm text-[color:var(--cream-dim)]">{n.text}</p>
      </div>
      <a href={`${BASE}#planos`} className="vs-key vs-key-amber shrink-0">{n.cta}</a>
    </div>
  );
}

/** Teclas de escolha (formato, qualidade) no visual das teclas do site. */
function Seg({ items, value, onPick, disabled }: {
  items: Array<[string, string]>; value: string; onPick: (v: string) => void; disabled?: (v: string) => boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([v, label]) => (
        <button
          key={v}
          type="button"
          disabled={disabled?.(v)}
          onClick={() => onPick(v)}
          className={`vs-key vs-key-nav ${v === value ? 'vs-key-amber' : 'vs-key-steel'} disabled:opacity-40`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const STATE_TEXT: Record<string, string> = {
  procurando: 'procurando...', baixando: 'baixando', convertendo: 'convertendo...', pronto: 'pronto', erro: 'erro',
};

function Downloader({ session }: { session: Session }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<(SdInfo & { url: string }) | null>(null);
  const [mode, setMode] = useState<'audio' | 'video'>('audio');
  const [fmt, setFmt] = useState('mp3');
  const [aq, setAq] = useState('');
  const [vq, setVq] = useState('best');
  const [jobs, setJobs] = useState<SdJob[]>([]);
  const timer = useRef<number | null>(null);

  const api = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? session.access_token;
    const res = await fetch(`${STAGE_DOWNLOAD_API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(downloadError(json?.error));
    return json as T;
  }, [session.access_token]);

  const poll = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    const list = await api<SdJob[]>('/jobs').catch(() => null);
    if (list) setJobs(list);
    if (list?.some((j) => j.state === 'waiting' || j.state === 'running')) timer.current = window.setTimeout(() => void poll(), 1200);
  }, [api]);

  useEffect(() => { void poll(); return () => { if (timer.current) window.clearTimeout(timer.current); }; }, [poll]);

  const analyze = async (link = url) => {
    const u = firstLink(link);
    if (!u) return;
    if (u !== link) setUrl(u);
    setBusy(true); setError(null);
    try {
      const data = await api<SdInfo>('/info', { url: u });
      setInfo({ ...data, url: u });
      if (!data.can_video) setMode('audio');
      setAq(topQuality(data.audio, fmt));
      setVq(Object.keys(data.video).includes('best') ? 'best' : Object.keys(data.video)[0]);
    } catch (e) {
      setInfo(null); setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const paste = async () => {
    try { const t = firstLink(await navigator.clipboard.readText()); setUrl(t); void analyze(t); } catch { /* sem permissão */ }
  };

  const pickFormat = (f: string) => { setFmt(f); if (info) setAq(topQuality(info.audio, f)); };

  const start = async () => {
    if (!info) return;
    const audio: AudioFormats = info.audio;
    const label = mode === 'audio' ? `${audio[fmt].label} ${audio[fmt].qualities[aq]}` : `MP4 ${info.video[vq]}`;
    setError(null);
    try {
      await api('/download', { url: info.url, title: info.title, mode, format: fmt, quality: mode === 'audio' ? aq : vq, label });
      void poll();
    } catch (e) { setError((e as Error).message); }
  };

  const clear = async () => { await api('/jobs/clear', {}).catch(() => null); void poll(); };

  const src = info?.source;
  const srcText = src && [src.acodec, src.abr && `${src.abr} kbps`, src.asr && `${(src.asr / 1000).toLocaleString('pt-BR')} kHz`].filter(Boolean).join(' · ');

  return (
    <div className="mt-10 space-y-6">
      <div className="vs-panel vs-card p-5 sm:p-6">
        <form onSubmit={(e) => { e.preventDefault(); void analyze(); }} className="flex flex-col sm:flex-row gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => {
              // colar troca o link inteiro (antes juntava com o que já estava no campo)
              const t = firstLink(e.clipboardData.getData('text'));
              if (!t) return;
              e.preventDefault();
              setUrl(t);
              window.setTimeout(() => void analyze(t), 30);
            }}
            placeholder="Cole aqui o link da música ou do vídeo"
            className="flex-1 h-11 rounded-lg bg-[#0e1012] px-4 text-[0.95rem] text-[color:var(--cream)] placeholder:text-[color:var(--muted)] outline-none ring-1 ring-[#2d3238] focus:ring-[color:var(--amber)]"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void paste()} className="vs-key vs-key-sm vs-key-steel"><ClipboardPaste size={15} /> Colar</button>
            <button type="submit" disabled={busy} className="vs-key vs-key-sm vs-key-amber disabled:opacity-60">
              {busy ? <><Loader2 size={15} className="animate-spin" /> Analisando</> : 'Analisar'}
            </button>
          </div>
        </form>
        {error && <p className="mt-3 text-sm text-[color:var(--red)]" role="alert">{error}</p>}

        {info && (
          <div className="mt-6 space-y-5">
            <div className="flex gap-4 items-center">
              <div
                className="w-20 h-20 rounded-lg bg-[#15181b] bg-cover bg-center shrink-0 grid place-items-center text-2xl text-[color:var(--muted)]"
                style={info.thumbnail ? { backgroundImage: `url("${info.thumbnail}")` } : undefined}
              >{info.thumbnail ? null : '♪'}</div>
              <div className="min-w-0">
                <span className="vs-chip">{info.platform_name}</span>
                <p className="mt-1.5 font-semibold text-[color:var(--cream)] truncate">{info.title}</p>
                <p className="text-sm text-[color:var(--cream-dim)] truncate">
                  {[info.uploader, info.count > 1 ? `${info.count} faixas` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>

            <Seg
              items={[['audio', 'Áudio'], ['video', 'Vídeo (MP4)']]}
              value={mode}
              onPick={(v) => setMode(v as 'audio' | 'video')}
              disabled={(v) => v === 'video' && !info.can_video}
            />

            {mode === 'audio' ? (
              <div className="space-y-3">
                <Seg items={Object.entries(info.audio).map(([k, v]) => [k, v.label])} value={fmt} onPick={pickFormat} />
                <Seg items={orderedQualities(info.audio, fmt)} value={aq} onPick={setAq} />
              </div>
            ) : (
              <Seg items={orderedQualities({ v: { label: '', qualities: info.video } }, 'v')} value={vq} onPick={setVq} />
            )}

            <p className="text-sm text-[color:var(--cream-dim)]">
              {srcText ? `Original do link: ${srcText}. As opções vão só até o máximo que o link tem.` : 'As opções vão só até o máximo que o link tem.'}
              {info.limits ? ` Vídeo até ${info.limits.video}p, faixas de até ${info.limits.minutes} minutos.` : ''}
            </p>

            <button type="button" onClick={() => void start()} className="vs-key vs-key-amber">
              <Download size={18} /> {info.count > 1 ? `Baixar ${Math.min(info.count, info.limits?.tracks ?? info.count)} faixas` : 'Baixar'}
            </button>
          </div>
        )}
      </div>

      <div className="vs-panel vs-card p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-[color:var(--cream)]">Seus downloads</p>
          {jobs.some((j) => j.state === 'done' || j.state === 'error') && (
            <button type="button" onClick={() => void clear()} className="vs-key vs-key-nav vs-key-steel">Limpar concluídos</button>
          )}
        </div>
        {jobs.length === 0 && <p className="mt-3 text-sm text-[color:var(--muted)]">Nada por aqui ainda.</p>}
        <div className="mt-3 space-y-4">
          {jobs.map((j) => (
            <div key={j.id} className="border-t border-[color:var(--line)] pt-4 first:border-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[color:var(--cream)]">{j.title}</p>
                <span className="text-xs text-[color:var(--cream-dim)] shrink-0">
                  {qualityLabel(j)}{j.state === 'waiting' ? ' · na fila' : ''}
                </span>
              </div>
              {j.items.map((it, i) => (
                <div key={i} className="mt-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-[color:var(--cream-dim)]">{it.file || it.name}</span>
                    {it.state === 'pronto' && j.state === 'done'
                      ? <a href={fileUrl(j.id, i)} className="vs-key vs-key-nav vs-key-amber shrink-0"><Download size={13} /> Baixar</a>
                      : <span className={`shrink-0 text-xs ${it.state === 'erro' ? 'text-[color:var(--red)]' : 'text-[color:var(--cream-dim)]'}`}>
                          {STATE_TEXT[it.state] ?? it.state}{it.state === 'baixando' ? ` ${Math.round(it.progress / 0.9)}%` : ''}
                        </span>}
                  </div>
                  {it.state !== 'pronto' && it.state !== 'erro' && (
                    <div className="mt-1.5 h-1 rounded-full bg-[#2d3238] overflow-hidden">
                      <div className="h-full bg-[color:var(--amber)] transition-all" style={{ width: `${it.progress}%` }} />
                    </div>
                  )}
                  {it.error && <p className="mt-1 text-xs text-[color:var(--red)]">{it.error}</p>}
                </div>
              ))}
              {j.state === 'waiting' && j.items.length === 0 && <p className="mt-2 text-sm text-[color:var(--muted)]">Esperando a vez no servidor...</p>}
              {j.zip && j.state === 'done' && (
                <a href={fileUrl(j.id, -1)} className="vs-key vs-key-nav vs-key-steel mt-3"><Download size={13} /> Baixar tudo (.zip)</a>
              )}
              {j.error && !j.items.some((it) => it.error) && <p className="mt-2 text-sm text-[color:var(--red)]">{j.error}</p>}
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs text-[color:var(--muted)]">
          Os arquivos ficam disponíveis por 1 hora. Baixe só o que você tem direito de usar.
        </p>
      </div>
    </div>
  );
}
