import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, Music, FolderOpen, Info, CheckCircle2, AlertTriangle, HardDrive, FolderSearch, RefreshCw } from 'lucide-react';
import { useStore } from '@/store';
import { runExport, type BounceMode, type DiskFullInfo, type ExportProgress, type ExportResult } from '@/lib/bounceEngine';
import { exportOpensFinder, formatBytes } from '@/lib/exportTarget';
import { friendlyError } from '@/lib/friendlyError';

type Step = 'scope' | 'song' | 'mode' | 'working' | 'done' | 'error';
type DiskChoice = 'continue' | 'stop';

export default function BounceDialog() {
  const open = useStore((s) => s.bounceDialogOpen);
  const close = useStore((s) => s.setBounceDialogOpen);
  const songs = useStore((s) => s.songs);
  const playlistOrder = useStore((s) => s.playlistOrder);

  const [step, setStep] = useState<Step>('scope');
  const [scope, setScope] = useState<'musica' | 'projeto' | null>(null);
  const [songId, setSongId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [diskFull, setDiskFull] = useState<DiskFullInfo | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState('');
  const cancelRef = useRef(false);
  const diskResolve = useRef<((c: DiskChoice) => void) | null>(null);

  const orderedSongs = useMemo(() => {
    const order = new Map(playlistOrder.map((id, i) => [id, i]));
    return [...songs].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }, [songs, playlistOrder]);

  if (!open) return null;

  const busy = step === 'working';
  const reset = () => {
    setStep('scope'); setScope(null); setSongId(null); setProgress(null); setDiskFull(null);
    setResult(null); setError(''); setCancelling(false); cancelRef.current = false;
  };
  const handleClose = () => { if (busy) return; reset(); close(false); };

  const answerDisk = (choice: DiskChoice) => {
    diskResolve.current?.(choice);
    diskResolve.current = null;
    setDiskFull(null);
  };

  const runBounce = async (mode: BounceMode) => {
    setStep('working'); setError(''); setProgress(null); setCancelling(false); cancelRef.current = false;
    try {
      const res = await runExport({ scope: scope ?? 'projeto', songId: songId ?? undefined, mode }, useStore.getState(), {
        onProgress: setProgress,
        onDiskFull: (info) => new Promise<DiskChoice>((resolve) => {
          diskResolve.current = resolve;
          setDiskFull(info);
        }),
        cancelled: () => cancelRef.current,
      });
      if (!res) { setStep('mode'); return; }
      setResult(res); setStep('done');
    } catch (e) {
      setError(friendlyError(e, 'Não foi possível exportar o áudio. Tente de novo.'));
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div
        className="bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl w-[520px] max-w-[92vw] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-wide">EXPORTAR ÁUDIO</h2>
          {!busy && (
            <button className="p-1 hover:bg-logic-bg-elevated rounded" onClick={handleClose} aria-label="Fechar">
              <X size={16} />
            </button>
          )}
        </div>

        {step === 'scope' && (
          <div className="space-y-2">
            <p className="text-xs text-logic-text-muted mb-3">O que você quer exportar?</p>
            <ChoiceButton icon={<Music size={18} className="text-logic-accent" />} title="Exportar música"
              text="Escolha uma música e o formato" onClick={() => { setScope('musica'); setStep('song'); }} />
            <ChoiceButton icon={<FolderOpen size={18} className="text-logic-accent" />} title="Exportar projeto inteiro"
              text="Uma pasta com todas as músicas" onClick={() => { setScope('projeto'); setStep('mode'); }} />
          </div>
        )}

        {step === 'song' && (
          <div>
            <p className="text-xs text-logic-text-muted mb-2">Escolha uma música</p>
            <div className="max-h-64 overflow-y-auto border border-logic-border-dark rounded">
              {orderedSongs.length === 0 && (
                <div className="p-3 text-xs text-logic-text-muted">Nenhuma música no projeto.</div>
              )}
              {orderedSongs.map((s) => (
                <button
                  key={s.id}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-logic-bg-elevated border-b border-logic-border-dark last:border-b-0 ${songId === s.id ? 'bg-logic-bg-elevated' : ''}`}
                  onClick={() => setSongId(s.id)}
                  onDoubleClick={() => { setSongId(s.id); setStep('mode'); }}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="logic-btn" onClick={() => setStep('scope')}>Voltar</button>
              <button className="logic-btn-accent" disabled={!songId} onClick={() => setStep('mode')}>Continuar</button>
            </div>
          </div>
        )}

        {step === 'mode' && (
          <div className="space-y-2">
            <p className="text-xs text-logic-text-muted mb-3">Em qual formato?</p>
            {exportOpensFinder() ? (
              <p className="text-2xs text-logic-text-muted mb-1">Ao escolher o formato, o Finder abre para você escolher onde salvar.</p>
            ) : (
              <div className="flex items-start gap-2 p-3 rounded border border-logic-border-dark bg-logic-bg-deep text-xs text-logic-text-muted">
                <Info size={14} className="mt-0.5 shrink-0 text-logic-lcd-amber" />
                <span>
                  Você está usando o app dentro da pré-visualização, então o Finder não pode ser aberto aqui.
                  Os arquivos serão salvos na pasta <strong className="text-logic-text">Downloads</strong> do navegador.
                  Para escolher a pasta, use o app do Mac ou abra em uma aba própria do Chrome ou Edge.
                </span>
              </div>
            )}
            <ChoiceButton title="LR Master" onClick={() => runBounce('lr')}
              text={scope === 'musica' ? 'Um único WAV estéreo com o mix final.' : 'Um WAV estéreo por música.'} />
            <ChoiceButton title="Multipista" onClick={() => runBounce('multipista')}
              text="Uma pasta por música com um WAV para cada faixa que tem áudio, com o nome da faixa." />
            <div className="flex justify-start mt-4">
              <button className="logic-btn" onClick={() => setStep(scope === 'musica' ? 'song' : 'scope')}>Voltar</button>
            </div>
          </div>
        )}

        {step === 'working' && !diskFull && (
          <WorkingView
            progress={progress}
            cancelling={cancelling}
            onCancel={() => { cancelRef.current = true; setCancelling(true); }}
          />
        )}

        {step === 'working' && diskFull && (
          <DiskFullView info={diskFull} onStop={() => answerDisk('stop')} onContinue={() => answerDisk('continue')} />
        )}

        {step === 'done' && result && <DoneView result={result} onClose={handleClose} />}

        {step === 'error' && (
          <div className="py-2">
            <div className="flex items-start gap-3 mb-5">
              <AlertTriangle size={20} className="shrink-0 text-red-400 mt-0.5" />
              <div className="text-sm text-logic-text leading-relaxed">{error}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="logic-btn" onClick={reset}>Tentar de novo</button>
              <button className="logic-btn-accent" onClick={handleClose}>Fechar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChoiceButton({ icon, title, text, onClick }: { icon?: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button
      className="w-full flex items-center gap-3 p-3 rounded border border-logic-border-light hover:bg-logic-bg-elevated hover:border-logic-accent/60 transition-colors text-left"
      onClick={onClick}
    >
      {icon}
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-logic-text-muted">{text}</div>
      </div>
    </button>
  );
}

function ProgressBar({ fraction, tone = 'accent' }: { fraction: number; tone?: 'accent' | 'amber' }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className="h-2.5 w-full rounded-full bg-logic-bg-deep border border-logic-border-dark overflow-hidden">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${tone === 'amber' ? 'bg-logic-lcd-amber' : 'bg-logic-accent'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function WorkingView({ progress, cancelling, onCancel }: { progress: ExportProgress | null; cancelling: boolean; onCancel: () => void }) {
  const pct = Math.round((progress?.fraction ?? 0) * 100);
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium">{progress ? 'Exportando...' : 'Escolha no Finder onde salvar...'}</span>
        <span className="text-sm tabular-nums text-logic-accent font-semibold">{pct}%</span>
      </div>
      <ProgressBar fraction={progress?.fraction ?? 0} />
      <div className="mt-3 min-h-[40px] text-xs text-logic-text-muted leading-relaxed">
        {progress && (
          <>
            <div className="truncate text-logic-text">{progress.label}</div>
            <div>
              {progress.saved} de {progress.total} {progress.total === 1 ? 'arquivo salvo' : 'arquivos salvos'} · {progress.location}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end mt-4">
        <button className="logic-btn" disabled={cancelling || !progress} onClick={onCancel}>
          {cancelling ? 'Cancelando ao fim da faixa atual...' : 'Cancelar'}
        </button>
      </div>
    </div>
  );
}

function DiskFullView({ info, onStop, onContinue }: { info: DiskFullInfo; onStop: () => void; onContinue: () => void }) {
  const [free, setFree] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      setChecking(true);
      const v = await info.checkFree().catch(() => null);
      if (alive) { setFree(v); setChecking(false); }
    };
    check();
    const t = window.setInterval(check, 3000);
    return () => { alive = false; window.clearInterval(t); };
  }, [info]);

  const enough = free !== null && free > info.needed * 1.05;
  return (
    <div className="py-1">
      <div className="flex items-start gap-3 mb-4">
        <div className="shrink-0 w-10 h-10 rounded-full bg-logic-lcd-amber/15 flex items-center justify-center">
          <HardDrive size={20} className="text-logic-lcd-amber" />
        </div>
        <div>
          <div className="text-sm font-semibold mb-1">O disco ficou sem espaço</div>
          <div className="text-xs text-logic-text-muted leading-relaxed">
            A exportação está pausada. Já foram salvos {info.saved} de {info.total} arquivos.
            O próximo, <span className="text-logic-text">{info.file}</span>, precisa de cerca de {formatBytes(info.needed)}.
          </div>
        </div>
      </div>

      <ProgressBar fraction={info.total ? info.saved / info.total : 0} tone="amber" />

      <div className="mt-4 p-3 rounded border border-logic-border-dark bg-logic-bg-deep text-xs leading-relaxed">
        <div className="flex items-center justify-between mb-1">
          <span className="text-logic-text-muted">Espaço livre agora</span>
          <span className="flex items-center gap-1.5 tabular-nums font-semibold">
            {checking && <RefreshCw size={11} className="animate-spin text-logic-text-muted" />}
            <span className={enough ? 'text-emerald-400' : 'text-logic-lcd-amber'}>
              {free === null ? 'não disponível' : formatBytes(free)}
            </span>
          </span>
        </div>
        <div className="text-logic-text-muted">
          {enough
            ? 'Já há espaço suficiente para o próximo arquivo. Clique em Continuar.'
            : 'Apague arquivos que não usa ou esvazie a Lixeira e clique em Continuar. A exportação segue de onde parou.'}
        </div>
      </div>

      <p className="mt-3 text-2xs text-logic-text-muted">
        Encerrar mantém os arquivos que já foram salvos. O arquivo que estava sendo gravado é apagado, para não ficar pela metade.
      </p>

      <div className="flex justify-end gap-2 mt-4">
        <button className="logic-btn" onClick={onStop}>Encerrar</button>
        <button className="logic-btn-accent" onClick={onContinue}>Continuar</button>
      </div>
    </div>
  );
}

function DoneView({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  const complete = result.status === 'done';
  const title = complete ? 'Exportação concluída' : result.status === 'stopped' ? 'Exportação encerrada' : 'Exportação cancelada';
  const files = `${result.saved} ${result.saved === 1 ? 'arquivo' : 'arquivos'}`;
  const songsText = result.songsTotal > 1 ? ` de ${result.songsSaved} ${result.songsSaved === 1 ? 'música' : 'músicas'}` : '';

  return (
    <div className="py-1">
      <div className="flex flex-col items-center text-center mb-5">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 animate-[fadeIn_.3s_ease-out] ${complete ? 'bg-emerald-500/15' : 'bg-logic-lcd-amber/15'}`}>
          {complete
            ? <CheckCircle2 size={30} className="text-emerald-400" />
            : <AlertTriangle size={28} className="text-logic-lcd-amber" />}
        </div>
        <div className="text-base font-semibold mb-1">{title}</div>
        <div className="text-xs text-logic-text-muted leading-relaxed max-w-[400px]">
          {complete
            ? `${files}${songsText} salvos em ${result.location}.`
            : `Foram salvos ${result.saved} de ${result.total} arquivos em ${result.location}.`}
        </div>
      </div>

      {!complete && result.incomplete.length > 0 && (
        <SongList title="Ficaram faltando (total ou em parte)" names={result.incomplete} />
      )}
      {result.empty.length > 0 && (
        <SongList title="Sem áudio para exportar" names={result.empty} />
      )}

      <div className="flex justify-end gap-2 mt-4">
        {result.reveal && (
          <button className="logic-btn flex items-center gap-1.5" onClick={() => { result.reveal?.().catch(() => {}); }}>
            <FolderSearch size={14} /> Mostrar no Finder
          </button>
        )}
        <button className="logic-btn-accent" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

function SongList({ title, names }: { title: string; names: string[] }) {
  return (
    <div className="mb-3">
      <div className="text-2xs uppercase tracking-wide text-logic-text-muted mb-1">{title}</div>
      <div className="max-h-28 overflow-y-auto rounded border border-logic-border-dark bg-logic-bg-deep">
        {names.map((n, i) => (
          <div key={`${n}-${i}`} className="px-3 py-1.5 text-xs border-b border-logic-border-dark last:border-b-0 truncate">{n}</div>
        ))}
      </div>
    </div>
  );
}
