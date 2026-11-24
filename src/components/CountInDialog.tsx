import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ListOrdered, Trash2, X } from 'lucide-react';
import type { Song } from '@/types';
import {
  COUNT_PACE_DEFAULT, COUNT_PACE_MAX, COUNT_PACE_MIN, PITCH_PRESETS, beatStartAt, countWords, isCountPackWord,
} from '@/lib/narrations';
import {
  canGenerate, countGroupItems, countPackHas, countPackStatus, countPackVersion, createCountIn, ensureCountPack, generateMany, hasCountPack, isCloneVoice, isIaVoice, isOfferedVoice,
  lastCountVoice, lastPitch, rememberCountVoice, rememberPitch, iaBlockedText, iaStatusText, narrationState, removeCountGroup, stopPreview, subscribeCountPack, subscribeCountPackVersion, updateCountGroup,
  voiceEngineStatus, type CountPackStatus,
} from '@/lib/maestroVoice';
import { wordsMissingInVoice } from '@/lib/maestroCues';
import { useStore } from '@/store';
import MaestroVoicePicker, { subdialogOpen } from '@/components/MaestroVoicePicker';
import { speechStateOf } from '@/components/maestro/MyPhrasesPicker';
import { barBeatLabel, songGrid } from '@/lib/grid';
import { formatRegionTime } from '@/lib/regions';
import type { MaestroVoiceStatus } from '@/lib/localNetwork';
import { useFitOnScreen } from '@/lib/useFitOnScreen';

export type CountInTarget = { kind: 'new'; start: number } | { kind: 'edit'; group: string };

interface CountInDialogProps {
  song: Song;
  target: CountInTarget;
  onClose: () => void;
}

const TOTALS = [2, 3, 4, 5, 6, 7, 8, 12, 16];
const PACE_KEY = 'vs-maestro-ia-contagem-velocidade';
/** Voz clonada guarda a velocidade à parte e começa em 1,00×: o número sai como foi gravado. */
const CLONE_PACE_KEY = 'vs-maestro-ia-contagem-velocidade-clone';

function savedPace(voice: string): number {
  const clone = isCloneVoice(voice);
  const fallback = clone ? 1 : COUNT_PACE_DEFAULT;
  try {
    const raw = localStorage.getItem(clone ? CLONE_PACE_KEY : PACE_KEY);
    const v = Number(raw);
    return raw !== null && v >= COUNT_PACE_MIN && v <= COUNT_PACE_MAX ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Contagem do Maestro IA: o usuário põe o cursor no primeiro click e a contagem entra pronta,
 * um número por tempo da grade ("Um!" no primeiro click, "Dois!" no próximo...), cada um
 * começando exatamente na linha da grade para tocar junto com o click. A velocidade da voz é
 * do usuário: mais calma ou mais rápida, sem esticar a fala. A voz é o Maestro IA (números
 * gravados), em Calma, Normal ou Forte, ou uma voz clonada pelo diretor. Na voz clonada os números
 * vêm do pacote preparado em segundo plano: a contagem entra na hora, sem chamar o modelo. Trocar a
 * voz aqui só toca o exemplo: a contagem só é criada (ou regravada) no Criar contagem / Salvar.
 */
export default function CountInDialog({ song, target, onClose }: CountInDialogProps) {
  const editing = target.kind === 'edit' ? countGroupItems(song, target.group) : [];
  const first = editing[0];
  const grid = songGrid(song);
  const beatsPerBar = song.beatsPerBar ?? 4;
  const start = target.kind === 'new' ? beatStartAt(song, target.start) : first?.start ?? 0;

  const [total, setTotal] = useState(target.kind === 'edit' ? editing.length : beatsPerBar);
  const [restart, setRestart] = useState(false);
  // contagem nova: a última voz usada na contagem (senão, o Maestro IA)
  const [voice, setVoice] = useState(first?.voice ?? lastCountVoice());
  const [pace, setPace] = useState(() => first?.pace ?? savedPace(first?.voice ?? lastCountVoice()));
  const [pack, setPack] = useState<CountPackStatus | null>(null);
  // os números desta contagem já estão gravados nesta voz
  const [wordsReady, setWordsReady] = useState(false);
  // o motor recusou o pedido do pacote
  const [ensureFailed, setEnsureFailed] = useState(false);
  // palavras próprias da contagem ("Vai!") sem gravação nesta voz
  const [missingWords, setMissingWords] = useState<string[]>([]);
  // voz regravada com o mesmo nome: o id não muda, mas os números precisam ser conferidos de novo
  const packVersion = useSyncExternalStore(subscribeCountPackVersion, countPackVersion);
  const playing = useStore((s) => s.transport.isPlaying);
  // tom da voz da contagem inteira (grave, padrão, agudo)
  const [pitch, setPitch] = useState<'grave' | 'padrao' | 'agudo'>(first ? (first.pitch ?? 'padrao') : (lastPitch() ?? 'padrao'));
  const pitchValue = pitch === 'padrao' ? undefined : pitch;
  const [error, setError] = useState<string | null>(null);
  const [ia, setIa] = useState<MaestroVoiceStatus | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fit = useFitOnScreen(panelRef);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // a janela de clonar está por cima: o Esc é dela
      if (subdialogOpen()) return;
      e.preventDefault(); e.stopPropagation(); closeRef.current();
    };
    const onDown = (e: PointerEvent) => {
      if (subdialogOpen(e.target)) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  const words = target.kind === 'edit' ? editing.map((n) => n.text) : countWords(total, beatsPerBar, restart);
  const preview = words.map((w) => w.replace(/!$/, '')).join(', ');
  const wordsKey = words.join('|');
  const usesPack = isCloneVoice(voice) && isOfferedVoice(voice) && hasCountPack();
  // edição sem mudar voz, velocidade nem tom não precisa do pacote
  const unchanged = target.kind === 'edit' && voice === first?.voice
    && Math.abs(pace - (first?.pace ?? pace)) <= 1e-3 && pitchValue === first?.pitch;
  // número que o motor reprovou de vez não prende a contagem: ela sai falada de uma vez
  const packGaveUp = pack?.state === 'falhou' && missingWords.length === 0;
  const waitingPack = usesPack && !wordsReady && !unchanged && !packGaveUp;
  const iaReady = ia?.ready ?? null;
  // voz pronta: só cria a contagem com todos os números gravados nela (nada mudo nem voz do sistema)
  const lackingWords = !unchanged && isOfferedVoice(voice) ? wordsMissingInVoice(voice, words) : [];
  const lackingText = lackingWords.length
    ? `Esta voz ainda não tem: ${lackingWords.join(', ')}. ${target.kind === 'new' ? 'Use menos tempos ou ligue Recomeçar a cada compasso.' : 'Escolha outra voz.'}`
    : null;
  const totalLacks = (n: number) => wordsMissingInVoice(voice, countWords(n, beatsPerBar, restart)).length > 0;

  // voz clonada: pede o pacote (vozes antigas começam aqui) e acompanha até os números ficarem prontos
  useEffect(() => {
    setWordsReady(false);
    setPack(null);
    setEnsureFailed(false);
    setMissingWords([]);
    if (!usesPack) return;
    let alive = true;
    const list = wordsKey.split('|').filter(Boolean);
    const numbers = list.filter(isCountPackWord);
    const own = [...new Set(list.filter((w) => !isCountPackWord(w)))];
    const checkWords = async () => {
      const [numbersOk, states] = await Promise.all([
        numbers.length ? countPackHas(voice, numbers) : Promise.resolve(true),
        Promise.all(own.map((w) => speechStateOf(w, voice))),
      ]);
      if (!alive) return;
      const lacking = own.filter((_, i) => states[i] !== 'gravada');
      setMissingWords(lacking);
      setWordsReady(numbersOk && lacking.length === 0);
    };
    const readStatus = () => { void countPackStatus(voice).then((st) => { if (alive) setPack(st); }); };
    // só pede com o motor pronto; quando ele ficar pronto, este efeito roda de novo
    if (iaReady && numbers.length) {
      void ensureCountPack(voice).then((ok) => {
        if (!alive) return;
        setEnsureFailed(!ok);
        readStatus();
      });
    }
    readStatus();
    void checkWords();
    const unsub = subscribeCountPack((p) => {
      if (p.voice !== voice) return;
      setPack((old) => ({ state: p.state as CountPackStatus['state'], done: p.done, total: p.total, error: old?.error ?? null }));
      void checkWords();
      if (p.state === 'falhou') readStatus();
    });
    return () => { alive = false; unsub(); };
  }, [voice, wordsKey, usesPack, iaReady, packVersion]);

  const retryPack = () => {
    setEnsureFailed(false);
    void ensureCountPack(voice).then((ok) => {
      setEnsureFailed(!ok);
      void countPackStatus(voice).then(setPack);
    });
  };

  // o que a linha de situação mostra quando os números ainda não estão prontos
  const packFailed = ensureFailed || pack?.state === 'falhou';
  const packBlocked = missingWords.length > 0
    ? `Falta criar em Minhas falas: ${missingWords.join(', ')}`
    : iaReady === false
      ? 'Contagem aguardando a voz de IA'
      : iaReady === null
        ? 'Conferindo a voz de IA...'
        : null;
  const waitingText = packBlocked ?? 'A contagem desta voz ainda está sendo preparada';

  /** Trocou a voz numa contagem nova: a velocidade acompanha (clonada começa na natural). */
  const chooseVoice = (v: string) => {
    if (target.kind === 'new' && isCloneVoice(v) !== isCloneVoice(voice)) setPace(savedPace(v));
    setVoice(v);
  };

  const save = () => {
    setError(null);
    if (waitingPack) { setError(`${waitingText}.`); return; }
    if (lackingText) { setError(lackingText); return; }
    stopPreview();
    // contagem antiga em voz que saiu do programa: mantém o áudio; mudar algo exigiria gerar nela
    if (target.kind === 'edit' && !isOfferedVoice(voice)) {
      const changed = Math.abs(pace - (first?.pace ?? pace)) > 1e-3 || pitchValue !== first?.pitch;
      if (changed) { setError('Essa voz saiu do programa. Escolha um Maestro ou uma voz sua.'); return; }
      onClose();
      return;
    }
    // a voz escolhida (Maestro IA na intensidade, ou clonada) vira a inicial da próxima contagem
    if (isOfferedVoice(voice)) rememberCountVoice(voice);
    try { localStorage.setItem(isCloneVoice(voice) ? CLONE_PACE_KEY : PACE_KEY, String(pace)); } catch { /* fica a padrão */ }
    if (target.kind === 'new') {
      rememberPitch(pitchValue);
      const made = createCountIn(song, { start, total, restartEachBar: restart, voice, pace, pitch: pitchValue });
      if ('error' in made) { setError(made.error); return; }
      if (canGenerate(voice)) void generateMany(song.id, made.ids);
    } else {
      rememberPitch(pitchValue);
      const ids = updateCountGroup(song.id, target.group, { voice, pace, pitch: pitchValue });
      // só regrava o que mudou (Salvar sem mexer em nada não gera de novo)
      const narrations = useStore.getState().songs.find((sg) => sg.id === song.id)?.narrations ?? [];
      const stale = ids.filter((id) => { const n = narrations.find((x) => x.id === id); return !!n && narrationState(n) !== 'fresh'; });
      if (canGenerate(voice) && stale.length) void generateMany(song.id, stale);
    }
    onClose();
  };

  const btn = 'console-key h-6 px-2 text-[10px]';

  return (
    <div
      ref={panelRef}
      className="console-face fixed z-[200] w-[450px] max-w-[calc(100vw-24px)] rounded-lg border border-black shadow-2xl p-3 flex flex-col gap-2 text-xs font-stage animate-[fadeIn_120ms_ease-out]"
      style={{ top: fit.top, left: '50%', transform: `translateX(-50%) scale(${fit.scale})`, transformOrigin: 'top center' }}
      role="dialog"
      aria-label="Contagem do Maestro"
    >
      <div className="flex items-center justify-between">
        <span className="console-legend flex items-center gap-1.5 uppercase text-logic-lcd-amber">
          <ListOrdered size={11} /> {target.kind === 'new' ? 'Contagem no click' : 'Editar contagem'}
        </span>
        <button className="console-key h-6 w-6 flex items-center justify-center" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar">
          <X size={12} />
        </button>
      </div>

      {!grid ? (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber text-2xs">
          Esta música ainda não tem BPM (a grade). A contagem precisa da grade para cair junto com o click.
        </div>
      ) : (
        <div className="text-2xs text-logic-text-dim">
          Começa no tempo <span className="font-mono text-logic-lcd-amber">{barBeatLabel(start, grid)}</span> ({formatRegionTime(start)}),
          {' '}um número em cada click da grade.
        </div>
      )}

      {target.kind === 'new' && (
        <div className="flex items-center gap-2">
          <span className="console-legend w-16 shrink-0">Tempos</span>
          <select
            value={total}
            onChange={(e) => setTotal(Number(e.target.value))}
            className="console-display h-6 px-1.5 text-[11px] focus:outline-none"
          >
            {TOTALS.map((n) => <option key={n} value={n} disabled={n !== total && isOfferedVoice(voice) && totalLacks(n)}>{n}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-2xs text-logic-text-dim cursor-pointer select-none" title={`1 a ${beatsPerBar} em cada compasso`}>
            <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} className="accent-logic-lcd-amber" />
            Recomeçar a cada compasso
          </label>
        </div>
      )}

      <div className="console-display px-2 py-1 text-[12px] font-medium truncate" title={preview}>
        {preview}
      </div>

      <MaestroVoicePicker voice={voice} onChoose={chooseVoice} pitch={pitchValue} labelClass="w-16" />

      <div className="flex items-center gap-2">
        <span className="console-legend w-16 shrink-0">Tom</span>
        <div className="flex-1 grid grid-cols-3 gap-1" role="group" aria-label="Tom da voz">
          {PITCH_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`${btn} ${pitch === p.id ? 'is-lit-green' : ''}`}
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
        <span className="console-legend w-16 shrink-0">Velocidade</span>
        <span className="text-[10px] text-logic-text-muted">calma</span>
        <input
          type="range"
          min={COUNT_PACE_MIN}
          max={COUNT_PACE_MAX}
          step={0.05}
          value={pace}
          onChange={(e) => setPace(Number(e.target.value))}
          className="flex-1 accent-logic-lcd-amber"
          title="Velocidade da voz na contagem. A fala não estica: se o número não couber no tempo, ela acelera sozinha."
        />
        <span className="text-[10px] text-logic-text-muted">rápida</span>
        <span className="console-readout text-logic-lcd-text w-10">{pace.toFixed(2)}×</span>
      </div>

      {isIaVoice(voice) && iaStatusText(ia) && (
        <div className="px-2 py-1 rounded bg-sky-500/10 border border-sky-400/30 text-sky-200 text-[10px] leading-snug">{usesPack ? iaBlockedText(ia) : iaStatusText(ia)}</div>
      )}

      {usesPack && (
        <div className="console-well flex items-center gap-2 px-2 h-7 text-[10px]" role="status">
          <span className={`console-led shrink-0 ${wordsReady ? 'is-on-green' : packBlocked || packFailed ? '' : 'is-on-amber animate-pulse'}`} />
          <span className={`flex-1 min-w-0 truncate ${wordsReady ? 'text-logic-lcd-green' : !packBlocked && packFailed ? 'text-logic-lcd-red' : 'text-logic-lcd-amber'}`} title={packBlocked ?? pack?.error ?? undefined}>
            {wordsReady
              ? 'Contagem pronta nesta voz'
              : packBlocked
                ?? (packFailed
                  ? 'Não deu para preparar a contagem'
                  : `Preparando contagem ${pack?.done ?? 0} de ${pack?.total ?? 16}${playing ? ' (pausada com a música tocando)' : ''}`)}
          </span>
          {!wordsReady && !packBlocked && packFailed && (
            <button className="console-key h-5 px-1.5 text-[10px] shrink-0" onClick={retryPack}>
              Tentar de novo
            </button>
          )}
        </div>
      )}

      {lackingText && (
        <div className="px-2 py-1 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber text-[10px] leading-snug" role="status">{lackingText}</div>
      )}

      <div className="text-[10px] text-logic-text-muted leading-snug">
        Para mudar depois: botão direito numa marcação da contagem, Editar contagem.
      </div>

      {error && (
        <div className="px-2 py-1.5 rounded bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-logic-lcd-red text-2xs">{error}</div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-logic-border-dark gap-1">
        {target.kind === 'edit' ? (
          <button
            className="console-key h-7 px-2 text-[11px] flex items-center gap-1 text-logic-lcd-red"
            onClick={() => { removeCountGroup(song.id, target.group); onClose(); }}
            title="Apagar a contagem inteira"
          >
            <Trash2 size={12} /> Apagar contagem
          </button>
        ) : <span />}
        <div className="flex items-center gap-1.5">
          <button className="console-key h-7 px-2 text-[11px]" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="console-key is-lit-amber h-7 px-3 text-[11px]"
            onClick={save}
            disabled={!grid || waitingPack || !!lackingText}
            title={waitingPack ? waitingText : lackingText ?? undefined}
          >
            {target.kind === 'new' ? 'Criar contagem' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
