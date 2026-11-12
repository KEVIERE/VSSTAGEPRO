import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Loader2, Mic, Play, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useStore } from '@/store';
import type { MaestroNarration, Song } from '@/types';
import {
  COUNT_PACE_MAX, COUNT_PACE_MIN, FAST_WPM, MAX_WPM, MIN_WPM, NARRATION_MIN_LENGTH, PITCH_PRESETS,
  isOnBeat, narrationBounds, spanForNatural, spanForWpm, syncedToCursor, wpmForSpan,
} from '@/lib/narrations';
import {
  canGenerate, cursorTime, generateNarration, generatingSnapshot, isGenerating, isPresetVoice,
  moveNarration, narrationBuffer, narrationOverflows, narrationState, playPreview, rememberPitch, rememberVoice, scheduleGeneration,
  iaStatusText, shortVoiceName, stopPreview, subscribeGenerating, voiceEngineStatus,
} from '@/lib/maestroVoice';
import MaestroVoicePicker from '@/components/MaestroVoicePicker';
import { READY_CUE_GROUPS, findReadyCue, readyVoice, type ReadyCue } from '@/lib/maestroCues';
import type { MaestroVoiceStatus } from '@/lib/localNetwork';
import { formatRegionTime } from '@/lib/regions';
import { friendlyError } from '@/lib/friendlyError';
import { seekToPosition } from '@/lib/transportControl';
import { useFitOnScreen } from '@/lib/useFitOnScreen';

interface NarrationDialogProps {
  song: Song;
  narration: MaestroNarration;
  onClose: () => void;
}

/**
 * Editor da fala do Maestro por IA: o texto, a voz (Feminina ou Masculina, de IA no próprio Mac, ou
 * uma das vozes online) e o tamanho da marcação definem a fala. "Gerar e ouvir" cria o áudio na faixa Maestro IA e toca
 * para conferir. Fechou com texto novo? A voz é gerada sozinha.
 */
export default function NarrationDialog({ song, narration, onClose }: NarrationDialogProps) {
  const updateNarration = useStore((s) => s.updateNarration);
  const removeNarration = useStore((s) => s.removeNarration);
  // o cursor só é lido ao clicar; aqui basta saber se há música tocando (para o rótulo do botão)
  useStore((s) => s.transport.isPlaying);
  useSyncExternalStore(subscribeGenerating, generatingSnapshot);

  const [text, setText] = useState(narration.text);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // voz brasileira de IA do app do Mac: programa, vozes e download (null no navegador)
  const [ia, setIa] = useState<MaestroVoiceStatus | null>(null);
  // velocidade fixa (contagem): o controle mexe aqui e grava ao soltar (um passo do desfazer)
  const [paceDraft, setPaceDraft] = useState(narration.pace ?? 1);
  // falas prontas: o assunto aberto (Tom, Andamento...); abre no assunto da fala atual
  const [cueGroup, setCueGroup] = useState<string | null>(
    () => READY_CUE_GROUPS.find((g) => g.cues.some((c) => c.id === findReadyCue(narration.text)?.id))?.id ?? null,
  );
  const textRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fit = useFitOnScreen(panelRef);
  const textNow = useRef(text);
  textNow.current = text;

  const voice = narration.voice || 'feminina';
  // vozes padrão: só no app do Mac; vozes online: em qualquer lugar com internet e conta
  const engine = canGenerate(voice);
  const busy = isGenerating(narration.id);
  const span = narration.end - narration.start;
  const wpm = wpmForSpan(text, span);
  const state = narrationState(narration);
  const onBeat = isOnBeat(song, narration.start);
  const over = narrationOverflows(narration);
  // voz de IA do próprio Mac pronta (as vozes padrão)
  const iaAvailable = !!ia?.ready;

  useEffect(() => { textRef.current?.focus(); textRef.current?.select(); }, []);
  // acompanha o download da voz enquanto a janela está aberta
  useEffect(() => {
    let alive = true;
    const load = () => { void voiceEngineStatus().then((st) => { if (alive) setIa(st); }); };
    load();
    const timer = window.setInterval(load, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => () => { stopPreview(); }, []);

  /** Grava o texto digitado na marcação (um passo do desfazer, não um por letra). */
  const commitText = () => {
    const trimmed = textNow.current.trim();
    const n = useStore.getState().songs.find((s) => s.id === song.id)?.narrations?.find((x) => x.id === narration.id);
    if (n && trimmed !== n.text) updateNarration(song.id, narration.id, { text: trimmed });
    return trimmed;
  };

  /** Fecha: marcação vazia que nunca falou some; texto novo gera a voz sozinho. */
  const close = () => {
    stopPreview();
    const trimmed = commitText();
    const n = useStore.getState().songs.find((s) => s.id === song.id)?.narrations?.find((x) => x.id === narration.id);
    if (n && !trimmed && !n.clipId) removeNarration(song.id, narration.id);
    else if (n && trimmed) scheduleGeneration(song.id, narration.id, 0);
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
    };
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  const chooseVoice = (v: string) => {
    if (v === voice) return;
    rememberVoice(v);
    updateNarration(song.id, narration.id, { voice: v });
    setDone(null);
  };

  /** Tom da voz: grave, padrão ou agudo (vale para esta fala e vira o padrão das próximas). */
  const pitch = narration.pitch ?? 'padrao';
  const choosePitch = (p: 'grave' | 'padrao' | 'agudo') => {
    if (p === pitch) return;
    const value = p === 'padrao' ? undefined : p;
    rememberPitch(value);
    updateNarration(song.id, narration.id, { pitch: value });
    setDone(null);
  };

  /** Fim novo para um tamanho, sem invadir a próxima marcação. */
  const setLength = (seconds: number) => {
    const { max } = narrationBounds(song, narration.id);
    const end = Math.max(narration.start + NARRATION_MIN_LENGTH, Math.min(max, narration.start + seconds));
    if (Math.abs(end - narration.end) > 1e-3) updateNarration(song.id, narration.id, { end });
    setDone(null);
  };

  const syncToCursor = () => {
    const cursor = cursorTime(song.id);
    if (cursor == null) { setError('Outra música está tocando: pare ou toque esta música para usar o cursor.'); return; }
    const placed = syncedToCursor(song, narration.id, cursor);
    if (!placed) { setError('Não há espaço livre perto do cursor para esta marcação.'); return; }
    setError(null);
    moveNarration(song.id, narration.id, placed);
  };

  const commitPace = () => {
    if (narration.pace !== undefined && Math.abs(paceDraft - narration.pace) > 1e-3) {
      updateNarration(song.id, narration.id, { pace: paceDraft });
      setDone(null);
    }
  };

  /** Escolheu uma fala pronta: entra no texto, na voz pronta do mesmo gênero, e já gera. */
  const pickCue = (cue: ReadyCue) => {
    const nextVoice = readyVoice(voice) ? voice : voice === 'feminina' ? 'pronta:moca' : 'pronta:felipe';
    setText(cue.text);
    textNow.current = cue.text;
    updateNarration(song.id, narration.id, { text: cue.text, voice: nextVoice });
    if (nextVoice !== voice) rememberVoice(nextVoice);
    void generate();
  };

  const generate = async () => {
    const trimmed = commitText();
    if (!trimmed) { setError('Escreva o texto que o maestro deve falar.'); return; }
    const voiceNow = useStore.getState().songs.find((s) => s.id === song.id)?.narrations?.find((x) => x.id === narration.id)?.voice ?? voice;
    if (!canGenerate(voiceNow)) { setError('As vozes Feminina e Masculina só são geradas no app do Mac.'); return; }
    setError(null);
    setDone(null);
    stopPreview();
    setPlaying(false);
    try {
      const out = await generateNarration(song.id, narration.id);
      if (!out) return;
      const fits = out.overflow
        ? ` Passou da marcação (${out.buffer.duration.toFixed(1)}s): encurte o texto ou aumente a marcação.`
        : '';
      setDone(`Pronto: ${out.buffer.duration.toFixed(1)}s com a voz ${shortVoiceName(out.voiceName)}.${fits}${out.note ? ` ${out.note}` : ''}`);
      // com a música tocando (show), não toca sozinho: a pré-escuta sai na saída padrão do Mac
      if (!useStore.getState().transport.isPlaying) {
        setPlaying(true);
        playPreview(out.buffer, () => setPlaying(false));
      }
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível gerar a voz.'));
    }
  };

  const listen = async () => {
    if (playing) { stopPreview(); setPlaying(false); return; }
    const buffer = await narrationBuffer(narration);
    if (!buffer) return;
    setPlaying(true);
    playPreview(buffer, () => setPlaying(false));
  };

  // o aviso do download da voz de IA do Mac só interessa a quem usa as vozes padrão
  const iaNotice = engine && isPresetVoice(voice) ? iaStatusText(ia) : null;
  const btn = 'px-2 py-1.5 rounded border text-2xs font-semibold transition-colors border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-logic-text disabled:opacity-40 disabled:pointer-events-none';

  return (
    <div
      ref={panelRef}
      className="fixed z-[200] w-[450px] max-w-[calc(100vw-32px)] overflow-y-auto logic-scroll rounded-lg border border-logic-border-light bg-logic-bg-panel shadow-2xl p-3 flex flex-col gap-2.5 [&>*]:shrink-0 text-xs animate-[fadeIn_120ms_ease-out]"
      style={{ top: fit.top, maxHeight: fit.maxHeight, left: '50%', transform: 'translateX(-50%)' }}
      role="dialog"
      aria-label="Maestro por IA"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-sky-300 font-semibold">
          <Sparkles size={12} /> Maestro por IA
        </span>
        <button className="text-logic-text-muted hover:text-white p-0.5 rounded" onClick={close} title="Fechar (Esc)">
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2 text-2xs font-mono text-logic-text-dim">
        <span className="flex-1">{formatRegionTime(narration.start)} – {formatRegionTime(narration.end)}</span>
        <span className="text-sky-300">{span.toFixed(2)}s</span>
        <span className={wpm > FAST_WPM ? 'text-logic-lcd-amber' : 'text-white/70'}>{wpm} palavras/min</span>
      </div>

      <textarea
        ref={textRef}
        value={text}
        onChange={(e) => { setText(e.target.value); setDone(null); }}
        onBlur={commitText}
        rows={3}
        maxLength={1200}
        placeholder="O que o maestro deve falar. Ex.: Atenção, dois compassos e entra o refrão!"
        className="w-full resize-none px-2 py-1.5 rounded bg-logic-bg-deep border border-logic-border-light text-logic-text focus:outline-none focus:border-sky-400 transition-colors"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (readyVoice(voice)) close(); else void generate(); }
        }}
      />

      {/* Falas prontas: um botão por assunto; o assunto aberto mostra as falas dele */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Falas prontas por assunto">
          {READY_CUE_GROUPS.map((g) => (
            <button
              key={g.id}
              className={`px-1.5 py-1 rounded border text-[10px] font-semibold transition-colors ${
                cueGroup === g.id
                  ? 'border-sky-400 bg-sky-500/25 text-sky-100'
                  : 'border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-logic-text'
              }`}
              onClick={() => setCueGroup(cueGroup === g.id ? null : g.id)}
              aria-expanded={cueGroup === g.id}
            >
              {g.label}
            </button>
          ))}
        </div>
        {cueGroup && (
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto logic-scroll p-1.5 rounded border border-logic-border bg-logic-bg-deep animate-[fadeIn_120ms_ease-out]">
            {READY_CUE_GROUPS.find((g) => g.id === cueGroup)?.cues.map((c) => {
              const on = findReadyCue(text)?.id === c.id;
              return (
                <button
                  key={c.id}
                  className={`px-1.5 py-1 rounded text-[11px] transition-colors ${on ? 'bg-sky-500/30 text-sky-100' : 'text-logic-text-dim hover:text-logic-text hover:bg-white/5'}`}
                  onClick={() => pickCue(c)}
                  disabled={busy}
                  title="Usar esta fala pronta (voz Felipe ou Bianca, já no tempo)"
                >
                  {c.text}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Voz: as padrão (Feminina e Masculina, de IA no próprio Mac) e, logo abaixo, as vozes online */}
      <MaestroVoicePicker voice={voice} onChoose={chooseVoice} iaReady={iaAvailable} pitch={narration.pitch} />

      {/* Tom da voz: grave, padrão ou agudo (sem mudar a velocidade) */}
      <div className="flex items-center gap-2">
        <span className="text-logic-text-muted w-12 shrink-0">Tom</span>
        <div className="flex-1 grid grid-cols-3 gap-1" role="group" aria-label="Tom da voz">
          {PITCH_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`px-2 py-1.5 rounded border text-2xs font-semibold transition-colors ${
                pitch === p.id
                  ? 'border-sky-400 bg-sky-500/25 text-sky-100'
                  : 'border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-logic-text'
              }`}
              onClick={() => choosePitch(p.id)}
              aria-pressed={pitch === p.id}
              title={p.id === 'padrao' ? 'Tom natural da voz' : p.id === 'grave' ? 'Voz mais grave (sem mudar a velocidade)' : 'Voz mais aguda (sem mudar a velocidade)'}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contagem: velocidade fixa da voz (não estica para preencher a marcação) */}
      {narration.pace !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-logic-text-muted w-12 shrink-0">Veloc.</span>
          <input
            type="range"
            min={COUNT_PACE_MIN}
            max={COUNT_PACE_MAX}
            step={0.05}
            value={paceDraft}
            onChange={(e) => setPaceDraft(Number(e.target.value))}
            onPointerUp={commitPace}
            onKeyUp={commitPace}
            onBlur={commitPace}
            className="flex-1 accent-sky-400"
            title="Velocidade da voz desta marcação da contagem (a fala não estica; se não couber no tempo, acelera sozinha)"
          />
          <span className="font-mono text-logic-text-dim w-12 text-right">{paceDraft.toFixed(2)}×</span>
        </div>
      )}

      {/* Ritmo: o controle anda o fim da marcação, porque é o tamanho que define a velocidade */}
      {narration.pace === undefined && (
      <div className="flex items-center gap-2">
        <span className="text-logic-text-muted w-12 shrink-0">Ritmo</span>
        <input
          type="range"
          min={MIN_WPM}
          max={MAX_WPM}
          step={5}
          value={wpm}
          onChange={(e) => setLength(spanForWpm(text, Number(e.target.value)))}
          className="flex-1 accent-sky-400"
          title="Mais rápido = marcação menor; mais devagar = marcação maior."
        />
        <button className={btn} onClick={() => setLength(spanForNatural(text))} title="Tamanho para o ritmo de conversa normal">
          Natural
        </button>
      </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <button
          className={`${btn} ${onBeat ? '!border-sky-400/70 !text-sky-200' : ''}`}
          onClick={syncToCursor}
          title="Leva o início da marcação para o começo do beat em que o cursor está (o tamanho não muda)"
        >
          Sincar no beat do cursor{onBeat ? ' ✓' : ''}
        </button>
        <button className={btn} onClick={() => seekToPosition(song.id, narration.start)} title="Leva o cursor ao início da marcação">
          Ir para a marcação
        </button>
      </div>

      <div className="text-[10px] text-logic-text-muted leading-snug -mt-0.5">
        Na régua: arraste o meio para mudar de lugar e as bordas para mudar a velocidade (a voz é refeita sozinha).
      </div>

      {wpm > FAST_WPM && (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber text-2xs">
          Rápido demais: com {wpm} palavras/min a fala pode ficar difícil de entender. Aumente a marcação ou encurte o texto.
        </div>
      )}
      {over > 0 && !busy && state === 'fresh' && (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber text-2xs">
          A fala passa {over.toFixed(1)}s do fim da marcação, mesmo no ritmo máximo.
        </div>
      )}
      {!engine && (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber text-2xs">
          As vozes Feminina e Masculina só são geradas no app do Mac. As marcações ficam salvas no projeto.
        </div>
      )}
      {iaNotice && (
        <div className="px-2 py-1.5 rounded bg-sky-500/10 border border-sky-400/30 text-sky-200 text-2xs">{iaNotice}</div>
      )}
      {error && (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-logic-lcd-red text-2xs">{error}</div>
      )}
      {!error && narration.status === 'error' && narration.error && !busy && (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-logic-lcd-red text-2xs">{narration.error}</div>
      )}
      {done && !error && (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-green/15 border border-logic-lcd-green/40 text-logic-lcd-green text-2xs">{done}</div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-logic-border-dark gap-1">
        <button
          className="flex items-center gap-1 px-2 py-1.5 rounded text-logic-lcd-red hover:bg-logic-lcd-red/15 transition-colors shrink-0"
          onClick={() => { stopPreview(); removeNarration(song.id, narration.id); onClose(); }}
          title="Apagar a marcação e a fala dela"
        >
          <Trash2 size={12} /> Apagar
        </button>
        <div className="flex items-center gap-1.5">
          <button
            className="p-1.5 rounded border border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-white transition-colors disabled:opacity-40"
            onClick={() => { void listen(); }}
            disabled={!playing && state !== 'fresh'}
            title={playing ? 'Parar' : 'Ouvir a fala que está na faixa'}
          >
            {playing ? <Square size={12} /> : <Play size={12} />}
          </button>
          {readyVoice(voice) ? (
            // Voz pronta (Felipe ou Bianca): a fala escolhida já entra gravada, não há o que gerar.
            // OK só fecha; texto digitado fora da lista sai na voz do Mac ao fechar.
            <button
              className="flex items-center gap-1.5 px-4 py-1.5 rounded font-semibold transition-colors shrink-0 bg-sky-500 hover:bg-sky-400 text-white"
              onClick={close}
              title="Fechar (⌘↩)"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              OK
            </button>
          ) : (
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold transition-colors shrink-0 ${
                busy ? 'bg-sky-500/40 text-white/70 cursor-wait' : 'bg-sky-500 hover:bg-sky-400 text-white disabled:opacity-40 disabled:hover:bg-sky-500'
              }`}
              onClick={() => { void generate(); }}
              disabled={busy || !engine || !text.trim()}
              title="Gera a voz, coloca na faixa Maestro IA e toca para você ouvir (⌘↩)"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
              {busy ? 'Gerando...' : state === 'fresh' ? 'Gerar de novo' : 'Gerar e ouvir'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
