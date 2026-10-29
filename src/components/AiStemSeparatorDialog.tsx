import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  AudioWaveform,
  CheckCircle2,
  Clock,
  FileAudio,
  Loader2,
  Music,
  Plus,
  Sparkles,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { decodeFile } from '@/lib/audioDecoder';
import {
  separateSongToVS,
  type StemSeparationProgress,
} from '@/lib/stemSeparator';

interface AiStemSeparatorDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AiStemSeparatorDialog({ open, onClose }: AiStemSeparatorDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [songName, setSongName] = useState('');
  const [includeClick, setIncludeClick] = useState(true);
  const [beatsPerBar, setBeatsPerBar] = useState<4 | 3 | 6>(4);


  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<StemSeparationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setSongName('');
      setBusy(false);
      setProgress(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    if (open) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, busy, onClose]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    const defaultName = selected.name.replace(/\.[^/.]+$/, '').trim();
    setSongName(defaultName);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (busy) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && /\.(mp3|wav|m4a|aac|ogg|flac|aif|aiff)$/i.test(dropped.name)) {
      setFile(dropped);
      const defaultName = dropped.name.replace(/\.[^/.]+$/, '').trim();
      setSongName(defaultName);
      setError(null);
    }
  };

  const handleStartSeparation = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);

    try {
      // 1. Decodifica áudio original
      setProgress({
        step: 'analyzing',
        message: 'Lendo e decodificando arquivo de áudio...',
        percent: 5,
      });

      const decoded = await decodeFile(file);

      // 2. Separa stems e cria o VS via Demucs v4
      await separateSongToVS(
        decoded.audioBuffer,
        file,
        {
          includeClick,
          beatsPerBar,
          songName: songName.trim() || undefined,
        },
        (p) => setProgress(p)
      );

      // Finaliza e fecha modal
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error('[AiStemSeparator] erro', err);
      setError(err instanceof Error ? err.message : 'Falha ao processar o áudio.');
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-[fadeIn_150ms_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-[#121319] border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Topo / Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-logic-lcd-green/20 text-logic-lcd-green flex items-center justify-center font-bold">
              <Sparkles size={14} />
            </div>
            <span className="font-bold text-sm text-white">Criar VS com IA a partir de Música</span>
          </div>

          {!busy && (
            <button
              onClick={onClose}
              className="text-logic-text-muted hover:text-white p-1 rounded-lg transition"
              title="Fechar"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Conteúdo */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-xs text-logic-lcd-red flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Área de Seleção de Arquivo */}
          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-white/20 hover:border-logic-lcd-green/60 bg-white/[0.02] hover:bg-white/[0.04] rounded-2xl p-8 text-center cursor-pointer transition group flex flex-col items-center justify-center gap-3"
            >
              <div className="w-14 h-14 rounded-2xl bg-logic-lcd-green/10 text-logic-lcd-green flex items-center justify-center group-hover:scale-110 transition">
                <Upload size={24} />
              </div>

              <div>
                <p className="text-sm font-bold text-white mb-1">
                  Clique para escolher ou arraste uma música aqui
                </p>
                <p className="text-2xs text-logic-text-dim">
                  Compatível com MP3, WAV, M4A, FLAC, AAC, AIFF e OGG
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-logic-lcd-green/20 text-logic-lcd-green flex items-center justify-center shrink-0">
                  <FileAudio size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{file.name}</p>
                  <p className="text-[10px] text-logic-text-dim mt-0.5">
                    {(file.size / (1024 * 1024)).toFixed(1)} MB · Pronto para separação
                  </p>
                </div>
              </div>

              {!busy && (
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-2xs text-logic-text-muted hover:text-white underline shrink-0 px-2 py-1"
                >
                  Trocar arquivo
                </button>
              )}
            </div>
          )}

          {/* Configurações da Música */}
          {file && !busy && (
            <div className="space-y-4 pt-1">
              <div>
                <label className="block text-2xs font-semibold text-logic-text-muted uppercase tracking-wider mb-1">
                  Nome da Música no Repertório
                </label>
                <input
                  type="text"
                  value={songName}
                  onChange={(e) => setSongName(e.target.value)}
                  placeholder="Nome da música..."
                  className="w-full bg-black/50 text-xs text-white px-3 h-9 rounded-xl border border-white/15 outline-none focus:border-logic-lcd-green transition"
                />
              </div>

              {/* Motor Oficial de IA */}
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-logic-lcd-green/15 to-emerald-500/5 border border-logic-lcd-green/30 text-xs flex items-center justify-between gap-3 shadow-md">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-logic-lcd-green" />
                    <span className="font-bold text-white text-xs">
                      Inteligência Artificial do VS Stage · Qualidade Máxima de Estúdio
                    </span>
                  </div>
                  <p className="text-[11px] text-logic-text-dim">
                    Separação avançada em alta fidelidade: Bateria, Contrabaixo, Guitarras, Violões, Teclados, Voz/Guia e Outros.
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-logic-lcd-green/20 text-logic-lcd-green border border-logic-lcd-green/40 shrink-0">
                  IA ATIVA
                </span>
              </div>

              {/* Opções de Click e Compasso */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.02] border border-white/10 cursor-pointer hover:bg-white/[0.04] transition">
                  <input
                    type="checkbox"
                    checked={includeClick}
                    onChange={(e) => setIncludeClick(e.target.checked)}
                    className="accent-logic-lcd-green w-4 h-4 rounded cursor-pointer"
                  />
                  <div className="text-xs min-w-0">
                    <span className="font-bold text-white block">Click Automático (Sincronizado)</span>
                    <span className="text-[10px] text-logic-text-dim block">1 compasso de metrônomo antes da música</span>
                  </div>
                </label>

                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-logic-text-muted uppercase tracking-wider">
                    Fórmula de Compasso
                  </span>
                  <div className="flex gap-1.5 mt-1">
                    {([4, 3, 6] as const).map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBeatsPerBar(b)}
                        className={`flex-1 py-1 rounded-lg text-xs font-bold transition border ${
                          beatsPerBar === b
                            ? 'bg-logic-lcd-green/20 border-logic-lcd-green/50 text-logic-lcd-green'
                            : 'bg-black/30 border-white/10 text-logic-text-dim hover:text-white'
                        }`}
                      >
                        {b}/4
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Explicação de Stems Separadas */}
              <div className="p-3 rounded-xl bg-logic-lcd-green/[0.07] border border-logic-lcd-green/20 text-2xs text-logic-text-dim space-y-1">
                <p className="font-bold text-white text-xs flex items-center gap-1.5">
                  <Sparkles size={13} className="text-logic-lcd-green" />
                  <span>Stems separadas automaticamente:</span>
                </p>
                <p className="leading-relaxed">
                  🥁 <strong>Bateria e percussão</strong> ➔ Pasta Bateria &nbsp;|&nbsp; 🎸 <strong>Baixo</strong> ➔ Pasta Contrabaixo &nbsp;|&nbsp; 🎸 <strong>Violões ou guitarras</strong> ➔ Pasta Violões ou Guitarras (a IA ouve e decide) &nbsp;|&nbsp; 🎹 <strong>Teclados</strong> ➔ Pasta Teclados &nbsp;|&nbsp; 🎤 <strong>Voz</strong> ➔ Pasta Guia &nbsp;|&nbsp; 🎻 <strong>Demais instrumentos</strong> ➔ Pasta Outros &nbsp;|&nbsp; ⏱️ <strong>Click</strong> ➔ Pasta Click.
                </p>
              </div>
            </div>
          )}

          {/* Barra de Progresso Durante Processamento */}
          {busy && progress && (
            <div className="py-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-logic-lcd-green" />
                  <span>{progress.message}</span>
                </span>
                <span className="font-mono text-logic-lcd-green font-bold tabular-nums">
                  {progress.percent}%
                </span>
              </div>

              <div className="w-full bg-black/60 h-2.5 rounded-full overflow-hidden border border-white/10">
                <div
                  className="h-full bg-logic-lcd-green rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Rodapé / Ações */}
        <div className="px-5 py-3.5 border-t border-white/10 bg-white/[0.02] flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-logic-text-dim hover:text-white transition disabled:opacity-40"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleStartSeparation}
            disabled={!file || busy}
            className="px-5 py-2.5 rounded-xl btn-neon-green text-black font-extrabold text-xs flex items-center gap-2 shadow-lg hover:scale-[1.02] transition disabled:opacity-40 disabled:pointer-events-none"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Processando Stems...</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>Criar VS Agora</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
