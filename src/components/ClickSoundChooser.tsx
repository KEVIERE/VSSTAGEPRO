import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Loader2, Timer, Upload, X } from 'lucide-react';
import { importClickFile, playClickPreview, stopClickPreview } from '@/lib/clickGenerator';
import { CLICK_SOUNDS, rememberedClickSound, savedCustomClick, type ClickSoundId } from '@/lib/clickSounds';
import { clickAddBlocker, closeClickChooser, getClickChooser, isClickToolRunning, startClickTool, subscribeClickChooser } from '@/lib/clickTools';
import { useStore } from '@/store';

/**
 * Janela do Recriar metrônomo: escolhe o som do click. Apertar um som já toca 1 compasso dele
 * no andamento da música; Recriar troca o click da faixa por esse som, batida por batida.
 * O último botão importa o som do próprio usuário, já ajustado (ver clickImport).
 */
export default function ClickSoundChooser() {
  const songId = useSyncExternalStore(subscribeClickChooser, getClickChooser);
  if (!songId) return null;
  return <Chooser songId={songId} />;
}

const BUILT_IN = CLICK_SOUNDS.filter((s) => !s.custom);
const MINE = CLICK_SOUNDS.find((s) => s.custom)!;
const AUDIO_TYPES = 'audio/*,.wav,.mp3,.aif,.aiff,.m4a,.flac,.ogg';

function Chooser({ songId }: { songId: string }) {
  const bpm = useStore((s) => s.songs.find((x) => x.id === songId)?.bpm ?? 120);
  const beatsPerBar = useStore((s) => s.songs.find((x) => x.id === songId)?.beatsPerBar ?? 4);
  const [sound, setSound] = useState<ClickSoundId>(rememberedClickSound);
  const [playing, setPlaying] = useState<ClickSoundId | null>(null);
  const [custom, setCustom] = useState(savedCustomClick);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blocker = isClickToolRunning() ? 'Já há um comando do click em andamento'
    : sound === 'meu' && !custom ? 'Importe o seu som primeiro'
      : clickAddBlocker(songId, 'remake');
  const label = sound === 'meu' ? 'o seu som' : (CLICK_SOUNDS.find((s) => s.id === sound)?.label ?? '');

  const close = () => {
    stopClickPreview();
    closeClickChooser();
  };
  const confirm = () => {
    if (blocker || importing) return;
    close();
    void startClickTool(songId, 'remake', sound);
  };
  const listen = (id: ClickSoundId) => {
    setSound(id);
    setPlaying(id);
    void playClickPreview(id, bpm, beatsPerBar, () => setPlaying((p) => (p === id ? null : p)));
  };
  const pickFile = () => fileRef.current?.click();
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setNote(null);
    try {
      const r = await importClickFile(file);
      setCustom(savedCustomClick());
      setNote({
        ok: true,
        text: `Pronto: ${r.hits === 1 ? '1 toque' : `${r.hits} toques`} no arquivo, `
          + (r.twoSounds ? 'com dois sons (o do 1 do compasso e o dos outros tempos). ' : 'um som só. ')
          + 'O começo foi cortado no ataque e o volume ficou igual ao dos outros.',
      });
      listen('meu');
    } catch (err) {
      setNote({ ok: false, text: `Não deu: ${(err as Error)?.message ?? String(err)}.` });
    } finally {
      setImporting(false);
    }
  };

  // Esc fecha e Enter recria, antes dos atalhos da timeline
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else confirm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => () => stopClickPreview(), []);

  const led = (id: ClickSoundId) => (playing === id ? 'is-on-green animate-pulse' : sound === id ? 'is-on-amber' : '');
  const name = (id: ClickSoundId, text: string) => (
    <span className={`font-stage font-bold text-[13px] leading-none truncate ${sound === id ? 'text-[#ffd48a]' : 'text-logic-text'}`}>{text}</span>
  );
  const tipClass = (id: ClickSoundId) => `text-[10.5px] leading-snug ${sound === id ? 'text-[#cdbf9c]' : 'text-logic-text-muted'}`;
  const tag = (text: string) => <span className="console-legend ml-auto shrink-0 text-[9px]">{text}</span>;
  const padClass = (id: ClickSoundId) => `console-pad w-full h-full text-left px-2.5 py-2 flex flex-col gap-1 min-w-0 ${sound === id ? 'is-active' : ''}`;
  const amber = { ['--pad-color' as string]: '#ffab1f' };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-3 animate-[fadeIn_120ms_ease-out]"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recriar metrônomo"
        className="w-[440px] max-w-full console-face rounded-lg border border-black shadow-2xl overflow-hidden"
      >
        <div className="console-rail flex items-center gap-2 px-3 py-2">
          <span className="console-led is-on-amber" />
          <Timer size={13} className="shrink-0 text-logic-text-dim" />
          <span className="console-legend flex-1 uppercase">Recriar metrônomo</span>
          <button className="p-1 rounded text-logic-text-muted hover:text-logic-text" onClick={close} title="Fechar (Esc)" aria-label="Fechar">
            <X size={13} />
          </button>
        </div>

        <div className="p-3 flex flex-col gap-3">
          <p className="text-[12px] leading-snug text-logic-text-dim">
            Escolha o som do click. Cada batida fica no mesmo lugar do click que está na faixa.
            Aperte um som para ouvir.
          </p>

          <div className="grid grid-cols-2 auto-rows-fr gap-2" role="radiogroup" aria-label="Som do metrônomo">
            {BUILT_IN.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={sound === s.id}
                title={s.tip}
                onClick={() => listen(s.id)}
                className={padClass(s.id)}
                style={amber}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`console-led shrink-0 ${led(s.id)}`} />
                  {name(s.id, s.label)}
                  {s.id === 'vs' && tag('PADRÃO')}
                  {s.twoSounds && tag('2 SONS')}
                </span>
                <span className={tipClass(s.id)}>{s.tip}</span>
              </button>
            ))}

            {/* Seu som: importa o arquivo do usuário; depois de importado, toca e escolhe como os outros */}
            {custom && !importing ? (
              <div className="relative min-w-0">
                <button
                  type="button"
                  role="radio"
                  aria-checked={sound === 'meu'}
                  title={`${MINE.label}: ${custom.name}`}
                  onClick={() => listen('meu')}
                  className={padClass('meu')}
                  style={amber}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`console-led shrink-0 ${led('meu')}`} />
                    {name('meu', MINE.label)}
                    {custom.accent && tag('2 SONS')}
                  </span>
                  <span className={`${tipClass('meu')} truncate pr-12`}>{custom.name}</span>
                </button>
                <button
                  type="button"
                  className="console-key absolute right-1.5 bottom-1.5 h-5 px-1.5 text-[10px]"
                  onClick={pickFile}
                  title="Importar outro arquivo no lugar deste"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={pickFile}
                disabled={importing}
                title={MINE.tip}
                className="console-pad text-left px-2.5 py-2 flex flex-col gap-1 min-w-0 border-dashed !border-[#ffab1f]/45"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {importing
                    ? <Loader2 size={12} className="shrink-0 animate-spin text-logic-lcd-amber" />
                    : <Upload size={12} className="shrink-0 text-logic-lcd-amber" />}
                  <span className="font-stage font-bold text-[13px] leading-none truncate text-logic-text">
                    {importing ? 'Ajustando o som...' : 'Importar seu som'}
                  </span>
                </span>
                <span className="text-[10.5px] leading-snug text-logic-text-muted">
                  WAV, MP3, AIFF ou M4A. O ajuste é automático.
                </span>
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={AUDIO_TYPES}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void onFile(file);
            }}
          />

          {note && (
            <div className={`px-2 py-1.5 rounded text-[11px] leading-snug border ${note.ok
              ? 'bg-logic-lcd-green/10 border-logic-lcd-green/35 text-logic-lcd-green'
              : 'bg-logic-lcd-amber/15 border-logic-lcd-amber/40 text-logic-lcd-amber'}`}
            >
              {note.text}
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-logic-text-muted">
            <span className="console-legend">OUVIR EM</span>
            <span className="console-readout text-logic-lcd-amber">{Math.round(bpm)} BPM</span>
            <span className="flex-1 truncate">o andamento da música</span>
          </div>

          {blocker && (
            <div className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber text-[11px]">{blocker}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/60">
            <button type="button" className="console-key h-8 px-3 text-[12px]" onClick={close}>Cancelar</button>
            <button
              type="button"
              className="console-key is-lit-amber h-8 px-4 text-[12px]"
              disabled={!!blocker || importing}
              onClick={confirm}
              title="Troca o click da faixa por este som (Enter)"
            >
              Recriar com {label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
