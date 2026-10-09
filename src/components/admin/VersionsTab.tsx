import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Loader2, RefreshCw, RotateCcw, UploadCloud } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { adminApi, dateTime } from '@/components/admin/adminApi';
import type { AppRelease, AppReleaseBuild } from '@/components/admin/adminApi';
import { btnGhost, btnPrimary, Empty, ErrorBox, input, Loading, Panel } from '@/components/admin/ui';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;
const PART_SIZE = 45 * 1024 * 1024; // 45 MB — mesmo tamanho usado pelo workflow do GitHub Actions.

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type ArchPick = { arch: 'arm64' | 'x64'; label: string; file: File };

/** Envia um .dmg em partes de 45 MB direto para o Storage, via URLs assinadas pela edge function. */
async function uploadDmg(
  version: string,
  build: number,
  pick: ArchPick,
  onProgress: (pct: number) => void,
): Promise<AppReleaseBuild> {
  const size = pick.file.size;
  const partCount = Math.max(1, Math.ceil(size / PART_SIZE));
  const sha256 = await sha256Hex(pick.file);
  const { urls } = await adminApi.signUpload(version, build, pick.arch, partCount);

  let sent = 0;
  for (let i = 0; i < urls.length; i++) {
    const start = i * PART_SIZE;
    const chunk = pick.file.slice(start, Math.min(size, start + PART_SIZE));
    const res = await fetch(urls[i].signedUrl, { method: 'PUT', body: chunk });
    if (!res.ok) throw new Error('upload_failed');
    sent += chunk.size;
    onProgress(sent / size);
  }

  return {
    arch: pick.arch,
    label: pick.label,
    file: pick.file.name,
    size,
    sha256,
    parts: urls.map((u) => u.path),
  };
}

export default function VersionsTab() {
  const [list, setList] = useState<AppRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Confirmação em duas etapas antes de reverter: clicar de novo no mesmo botão confirma.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmRequired, setConfirmRequired] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setList(await adminApi.releases()); } catch (e) { setError(friendlyError((e as Error).message)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const activeVersion = list?.[0]; // A mais recente publicada é sempre a "ativa" (1º lugar, ordenado por data).
  const key = (r: AppRelease) => `${r.version}-${r.build}`;

  const startConfirm = (r: AppRelease) => { setConfirming(key(r)); setConfirmRequired(false); };
  const cancelConfirm = () => { setConfirming(null); setConfirmRequired(false); };

  const rollback = async (r: AppRelease) => {
    setConfirming(null);
    setRollingBack(key(r));
    setNotice(null);
    try {
      await adminApi.rollbackRelease(r.version, r.build, confirmRequired);
      setNotice({
        ok: true,
        text: confirmRequired
          ? `Revertido para a versão ${r.version} (build ${r.build}). Atualização obrigatória: todo app vai bloquear o uso até atualizar.`
          : `Revertido para a versão ${r.version} (build ${r.build}). Todo app aberto com internet vai se ajustar sozinho.`,
      });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: friendlyError((e as Error).message) });
    } finally {
      setRollingBack(null);
      setConfirmRequired(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Versões do VS Stage (Mac)</h2>
          <p className="text-xs text-logic-text-dim">
            Histórico do que já foi publicado. Reverter faz todo programa já instalado — mais novo ou mais antigo — se atualizar sozinho para a versão escolhida, na próxima vez que abrir com internet.
          </p>
        </div>
        <button type="button" className={btnGhost} onClick={() => load()} aria-label="Atualizar">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <ErrorBox text={error} />}
      {notice && (
        <div className={`px-3 py-2 rounded-lg border text-xs ${notice.ok ? 'bg-logic-lcd-green/15 border-logic-lcd-green/40 text-logic-lcd-green' : 'bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red'}`}>
          {notice.text}
        </div>
      )}
      {!list && loading && <Loading />}

      <PublishForm list={list} onPublished={load} />

      {list && (
        <Panel title={<span className="flex items-center gap-1.5"><History size={12} /> Histórico de publicações</span>}>
          {list.length === 0 ? (
            <Empty text="Nenhuma versão publicada ainda." />
          ) : (
            <ul className="divide-y divide-logic-border">
              {list.map((r) => {
                const isActive = activeVersion && key(r) === key(activeVersion);
                const k = key(r);
                const isConfirming = confirming === k;
                return (
                  <li key={k} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">v{r.version}</span>
                          <span className="text-2xs text-logic-text-muted">build {r.build}</span>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 px-1.5 h-4 rounded bg-logic-lcd-green/15 text-logic-lcd-green text-2xs font-bold">
                              <CheckCircle2 size={10} /> ATIVA
                            </span>
                          )}
                          {r.manifest.required && (
                            <span className="inline-flex items-center gap-1 px-1.5 h-4 rounded bg-logic-lcd-amber/15 text-logic-lcd-amber text-2xs font-bold">
                              <AlertTriangle size={10} /> OBRIGATÓRIA
                            </span>
                          )}
                        </div>
                        <p className="text-2xs text-logic-text-dim mt-0.5">
                          Publicada em {dateTime(r.published_at)}
                          {r.published_by_email ? ` por ${r.published_by_email}` : ''}
                          {' · '}
                          {r.manifest.builds.map((b) => `${b.label} (${mb(b.size)})`).join(' · ')}
                        </p>
                      </div>
                      {!isActive && !isConfirming && (
                        <button type="button" onClick={() => startConfirm(r)} className={`${btnPrimary} shrink-0`}>
                          <RotateCcw size={13} /> Reverter para esta
                        </button>
                      )}
                    </div>
                    {!isActive && isConfirming && (
                      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap bg-logic-bg-deep border border-logic-border-light rounded-md px-3 py-2">
                        <label className="flex items-center gap-2 text-xs text-logic-text-dim cursor-pointer">
                          <input
                            type="checkbox"
                            checked={confirmRequired}
                            onChange={(e) => setConfirmRequired(e.target.checked)}
                            className="accent-logic-lcd-amber"
                          />
                          Tornar obrigatória (bloqueia o uso até o cliente atualizar)
                        </label>
                        <div className="flex items-center gap-2 shrink-0">
                          <button type="button" className={btnGhost} onClick={cancelConfirm}>Cancelar</button>
                          <button
                            type="button"
                            disabled={rollingBack === k}
                            onClick={() => rollback(r)}
                            className="inline-flex items-center justify-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold transition disabled:opacity-50 disabled:pointer-events-none bg-logic-lcd-red/15 text-logic-lcd-red hover:bg-logic-lcd-red/25"
                          >
                            {rollingBack === k ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                            {rollingBack === k ? 'Revertendo...' : 'Confirmar reversão'}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

function nextBuildNumber(list: AppRelease[] | null): number {
  if (!list || list.length === 0) return 1;
  return Math.max(...list.map((r) => r.build)) + 1;
}

const ARCH_OPTIONS: Array<{ arch: 'arm64' | 'x64'; label: string; title: string }> = [
  { arch: 'arm64', label: 'Apple Silicon (M1, M2, M3, M4)', title: 'Apple Silicon (.dmg arm64)' },
  { arch: 'x64', label: 'Intel', title: 'Intel (.dmg x64)' },
];

function PublishForm({ list, onPublished }: { list: AppRelease[] | null; onPublished: () => void }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [build, setBuild] = useState<number | ''>('');
  const [required, setRequired] = useState(false);
  const [files, setFiles] = useState<Partial<Record<'arm64' | 'x64', File>>>({});
  const [progress, setProgress] = useState<Partial<Record<'arm64' | 'x64', number>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const openForm = () => {
    setOpen(true);
    setBuild(nextBuildNumber(list));
    setVersion('');
    setRequired(false);
    setFiles({});
    setProgress({});
    setNotice(null);
  };

  const pickedCount = Object.keys(files).length;
  const canSubmit = !busy && version.trim().length > 0 && build !== '' && pickedCount > 0;

  const submit = async () => {
    if (!canSubmit || build === '') return;
    setBusy(true);
    setNotice(null);
    try {
      const builds: AppReleaseBuild[] = [];
      for (const opt of ARCH_OPTIONS) {
        const file = files[opt.arch];
        if (!file) continue;
        const b = await uploadDmg(version.trim(), build, { arch: opt.arch, label: opt.label, file }, (pct) => {
          setProgress((p) => ({ ...p, [opt.arch]: pct }));
        });
        builds.push(b);
      }
      await adminApi.publishRelease(version.trim(), build, required, builds);
      setNotice({
        ok: true,
        text: required
          ? `Versão ${version.trim()} publicada como obrigatória. Todo app vai bloquear o uso até atualizar.`
          : `Versão ${version.trim()} publicada. Todo app aberto com internet vai receber o aviso de atualização.`,
      });
      setOpen(false);
      onPublished();
    } catch (e) {
      setNotice({ ok: false, text: friendlyError((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 bg-logic-bg-panel border border-logic-border rounded-lg px-4 py-3">
        <p className="text-xs text-logic-text-dim">Publique um novo instalador .dmg direto por aqui, sem precisar do GitHub Actions.</p>
        <button type="button" className={btnPrimary} onClick={openForm}>
          <UploadCloud size={13} /> Publicar nova versão
        </button>
      </div>
    );
  }

  return (
    <Panel title={<span className="flex items-center gap-1.5"><UploadCloud size={12} /> Publicar nova versão</span>}>
      <div className="p-4 space-y-4">
        {notice && !notice.ok && <ErrorBox text={notice.text} />}
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <label className="text-2xs text-logic-text-muted">Versão</label>
            <input className={input} placeholder="1.3.0" value={version} onChange={(e) => setVersion(e.target.value)} disabled={busy} />
          </div>
          <div className="w-28">
            <label className="text-2xs text-logic-text-muted">Build</label>
            <input
              type="number"
              className={input}
              value={build}
              onChange={(e) => setBuild(e.target.value === '' ? '' : Number(e.target.value))}
              disabled={busy}
            />
          </div>
        </div>

        <div className="space-y-2">
          {ARCH_OPTIONS.map((opt) => {
            const file = files[opt.arch];
            const pct = progress[opt.arch] ?? 0;
            return (
              <div key={opt.arch} className="flex items-center gap-3 bg-logic-bg-deep border border-logic-border-light rounded-md px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold">{opt.title}</p>
                  {file ? (
                    <p className="text-2xs text-logic-text-dim truncate">{file.name} · {mb(file.size)}</p>
                  ) : (
                    <p className="text-2xs text-logic-text-muted">Nenhum arquivo selecionado (opcional — mantém o build atual)</p>
                  )}
                  {busy && file && (
                    <div className="mt-1 h-1 rounded bg-logic-border overflow-hidden">
                      <div className="h-full bg-logic-lcd-green transition-all" style={{ width: `${Math.round(pct * 100)}%` }} />
                    </div>
                  )}
                </div>
                <label className={`${btnGhost} shrink-0 cursor-pointer`}>
                  Escolher .dmg
                  <input
                    type="file"
                    accept=".dmg"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setFiles((p) => ({ ...p, [opt.arch]: f }));
                    }}
                  />
                </label>
              </div>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs text-logic-text-dim cursor-pointer">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} disabled={busy} className="accent-logic-lcd-amber" />
          Tornar esta atualização obrigatória (bloqueia o uso até o cliente atualizar)
        </label>

        {notice && notice.ok && (
          <div className="px-3 py-2 rounded-lg border bg-logic-lcd-green/15 border-logic-lcd-green/40 text-logic-lcd-green text-xs">
            {notice.text}
          </div>
        )}

        <div className="flex items-center gap-2 justify-end">
          <button type="button" className={btnGhost} onClick={() => setOpen(false)} disabled={busy}>Cancelar</button>
          <button type="button" className={btnPrimary} onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
            {busy ? 'Publicando...' : 'Publicar'}
          </button>
        </div>
      </div>
    </Panel>
  );
}
