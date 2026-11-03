import { useEffect, useRef, useState } from 'react';
import { ListOrdered, Trash2, X } from 'lucide-react';
import type { Song } from '@/types';
import {
  COUNT_PACE_DEFAULT, COUNT_PACE_MAX, COUNT_PACE_MIN, PITCH_PRESETS, beatStartAt, countWords,
} from '@/lib/narrations';
import {
  canGenerate, countGroupItems, createCountIn, generateMany, isPresetVoice, lastPitch, lastVoice, rememberPitch, rememberVoice,
  iaStatusText, removeCountGroup, stopPreview, updateCountGroup, voiceEngineStatus,
} from '@/lib/maestroVoice';
import MaestroVoicePicker from '@/components/MaestroVoicePicker';
import { barBeatLabel, songGrid } from '@/lib/grid';
import { formatRegionTime } from '@/lib/regions';
import type { MaestroVoiceStatus } from '@/lib/localNetwork';

export type CountInTarget = { kind: 'new'; start: number } | { kind: 'edit'; group: string };

interface CountInDialogProps {
  song: Song;
  target: CountInTarget;
  onClose: () => void;
}

const TOTALS = [2, 3, 4, 5, 6, 7, 8, 12, 16];
const PACE_KEY = 'vs-maestro-ia-contagem-velocidade';

function savedPace(): number {
  try {
    const v = Number(localStorage.getItem(PACE_KEY));
    return v >= COUNT_PACE_MIN && v <= COUNT_PACE_MAX ? v : COUNT_PACE_DEFAULT;
  } catch {
    return COUNT_PACE_DEFAULT;
  }
}

/**
 * Contagem do Maestro IA: o usuário põe o cursor no primeiro click e a contagem entra pronta,
 * um número por tempo da grade ("Um!" no primeiro click, "Dois!" no próximo...), cada um
 * começando exatamente na linha da grade para tocar junto com o click. A velocidade da voz é
 * do usuário: mais calma ou mais rápida, sem esticar a fala.
 */
export default function CountInDialog({ song, target, onClose }: CountInDialogProps) {
  const editing = target.kind === 'edit' ? countGroupItems(song, target.group) : [];
  const first = editing[0];
  const grid = songGrid(song);
  const beatsPerBar = song.beatsPerBar ?? 4;
  const start = target.kind === 'new' ? beatStartAt(song, target.start) : first?.start ?? 0;

  const [total, setTotal] = useState(target.kind === 'edit' ? editing.length : beatsPerBar);
  const [restart, setRestart] = useState(false);
  // a última voz escolhida (padrão ou online) vale para a contagem nova
  const [voice, setVoice] = useState(first?.voice ?? lastVoice());
  const [pace, setPace] = useState(first?.pace ?? savedPace());
  // tom da voz da contagem inteira (grave, padrão, agudo)
  const [pitch, setPitch] = useState<'grave' | 'padrao' | 'agudo'>(first ? (first.pitch ?? 'padrao') : (lastPitch() ?? 'padrao'));
  const pitchValue = pitch === 'padrao' ? undefined : pitch;
  const [error, setError] = useState<string | null>(null);
  const [ia, setIa] = useState<MaestroVoiceStatus | null>(null);
  const iaReady = !!ia?.ready;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // acompanha o download da voz enquanto a janela está aberta
  useEffect(() => {
    let alive = true;
    const load = () => { void voiceEngineStatus().then((st) => { if (alive) setIa(st); }); };
    load();
    const timer = window.setInterval(load, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); } };
    const onDown = (e: PointerEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) closeRef.current(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  const words = target.kind === 'edit' ? editing.map((n) => n.text) : countWords(total, beatsPerBar, restart);
  const preview = words.map((w) => w.replace(/!$/, '')).join(', ');

  const save = () => {
    setError(null);
    stopPreview();
    rememberVoice(voice);
    try { localStorage.setItem(PACE_KEY, String(pace)); } catch { /* fica a padrão */ }
    if (target.kind === 'new') {
      rememberPitch(pitchValue);
      const made = createCountIn(song, { start, total, restartEachBar: restart, voice, pace, pitch: pitchValue });
      if ('error' in made) { setError(made.error); return; }
      if (canGenerate(voice)) void generateMany(song.id, made.ids);
    } else {
      rememberPitch(pitchValue);
      const ids = updateCountGroup(song.id, target.group, { voice, pace, pitch: pitchValue });
      if (canGenerate(voice)) void generateMany(song.id, ids);
    }
    onClose();
  };

  const btn = 'px-2 py-1.5 rounded border text-2xs font-semibold transition-colors';

  return (
    <div
      ref={panelRef}
      className="fixed z-[200] w-[450px] max-w-[calc(100vw-32px)] rounded-lg border border-logic-border-light bg-logic-bg-panel shadow-2xl p-3 flex flex-col gap-2.5 text-xs animate-[fadeIn_120ms_ease-out]"
      style={{ top: '16%', left: '50%', transform: 'translateX(-50%)' }}
      role="dialog"
      aria-label="Contagem do Maestro IA"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-sky-300 font-semibold">
          <ListOrdered size={12} /> {target.kind === 'new' ? 'Contagem no click' : 'Editar contagem'}
        </span>
        <button className="text-logic-text-muted hover:text-white p-0.5 rounded" onClick={onClose} title="Fechar (Esc)">
          <X size={14} />
        </button>
      </div>

      {!grid ? (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber text-2xs">
          Esta música ainda não tem BPM (a grade). A contagem precisa da grade para cair junto com o click.
        </div>
      ) : (
        <div className="text-2xs text-logic-text-dim">
          Começa no tempo <span className="font-mono text-sky-200">{barBeatLabel(start, grid)}</span> ({formatRegionTime(start)}),
          {' '}um número em cada click da grade.
        </div>
      )}

      {target.kind === 'new' && (
        <div className="flex items-center gap-2">
          <span className="text-logic-text-muted w-16 shrink-0">Tempos</span>
          <select
            value={total}
            onChange={(e) => setTotal(Number(e.target.value))}
            className="px-1.5 py-1 rounded bg-logic-bg-deep border border-logic-border-light text-logic-text focus:outline-none focus:border-sky-400"
          >
            {TOTALS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-2xs text-logic-text-dim cursor-pointer select-none" title={`1 a ${beatsPerBar} em cada compasso`}>
            <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} className="accent-sky-400" />
            Recomeçar a cada compasso
          </label>
        </div>
      )}

      <div className="px-2 py-1.5 rounded bg-logic-bg-deep border border-logic-border-dark text-logic-text font-medium truncate" title={preview}>
        {preview}
      </div>

      <MaestroVoicePicker voice={voice} onChoose={setVoice} iaReady={iaReady} pitch={pitchValue} labelClass="w-16" />

      <div className="flex items-center gap-2">
        <span className="text-logic-text-muted w-16 shrink-0">Tom</span>
        <div className="flex-1 grid grid-cols-3 gap-1" role="group" aria-label="Tom da voz">
          {PITCH_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`${btn} ${pitch === p.id ? 'border-sky-400 bg-sky-500/25 text-sky-100' : 'border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-logic-text'}`}
              onClick={() => setPitch(p.id)}
              aria-pressed={pitch === p.id}
              title={p.id === 'padrao' ? 'Tom natural da voz' : p.id === 'grave' ? 'Voz mais grave (sem mudar a velocidade)' : 'Voz mais aguda (sem mudar a velocidade)'}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-logic-text-muted w-16 shrink-0">Velocidade</span>
        <span className="text-[10px] text-logic-text-muted">calma</span>
        <input
          type="range"
          min={COUNT_PACE_MIN}
          max={COUNT_PACE_MAX}
          step={0.05}
          value={pace}
          onChange={(e) => setPace(Number(e.target.value))}
          className="flex-1 accent-sky-400"
          title="Velocidade da voz na contagem. A fala não estica: se o número não couber no tempo, ela acelera sozinha."
        />
        <span className="text-[10px] text-logic-text-muted">rápida</span>
        <span className="font-mono text-logic-text-dim w-10 text-right">{pace.toFixed(2)}×</span>
      </div>

      {isPresetVoice(voice) && iaStatusText(ia) && (
        <div className="px-2 py-1.5 rounded bg-sky-500/10 border border-sky-400/30 text-sky-200 text-2xs">{iaStatusText(ia)}</div>
      )}

      <div className="text-[10px] text-logic-text-muted leading-snug">
        Cada número começa justo na linha da grade. Para mudar a velocidade depois: botão direito numa marcação da contagem → Editar contagem.
      </div>

      {error && (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-logic-lcd-red text-2xs">{error}</div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-logic-border-dark gap-1">
        {target.kind === 'edit' ? (
          <button
            className="flex items-center gap-1 px-2 py-1.5 rounded text-logic-lcd-red hover:bg-logic-lcd-red/15 transition-colors"
            onClick={() => { removeCountGroup(song.id, target.group); onClose(); }}
            title="Apagar a contagem inteira"
          >
            <Trash2 size={12} /> Apagar contagem
          </button>
        ) : <span />}
        <div className="flex items-center gap-1.5">
          <button className={`${btn} border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-logic-text`} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="px-3 py-1.5 rounded font-semibold bg-sky-500 hover:bg-sky-400 text-white transition-colors disabled:opacity-40"
            onClick={save}
            disabled={!grid}
          >
            {target.kind === 'new' ? 'Criar contagem' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
