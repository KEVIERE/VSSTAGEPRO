import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Loader2, Play, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useStore } from '@/store';
import type { MaestroNarration, Song } from '@/types';
import {
  COUNT_PACE_MAX, COUNT_PACE_MIN, FAST_WPM, NARRATION_MIN_LENGTH, PITCH_PRESETS,
  isCountPackWord, isOnBeat, narrationBounds, spanForNatural, spanForWpm, syncedToCursor, wpmForSpan, wpmRange,
} from '@/lib/narrations';
import {
  canGenerate, cancelPreviewSpeech, claimPreview, countPackHas, countPackStatus, countPackVersion, cursorTime, draftGroup, draftReady, ensureCountPack, generateNarration, generatingSnapshot, hasCountPack,
  iaBlockedText, isCloneVoice, isGenerating, isIaVoice, isOfferedVoice, isPreviewCurrent, isSpeechCanceled, isSpeechPreparing, moveNarration, narrationBuffer, narrationOverflows, narrationState, playPreview, preloadReadyCues, previewSpeech,
  readyCueCached, readyCueListen, rememberPitch, rememberVoice, scheduleGeneration,
  iaStatusText, stopPreview, subscribeCountPack, subscribeCountPackVersion, subscribeGenerating, subscribePreview, voiceEngineStatus, warmPreview, warmVoice, type CountPackStatus, type SpeechDraft,
} from '@/lib/maestroVoice';
import MaestroVoicePicker, { subdialogOpen } from '@/components/MaestroVoicePicker';
import ReadyCuePicker, { ESC_CLEARS_ATTR } from '@/components/maestro/ReadyCuePicker';
import MyPhrasesPicker, { ESC_LOCAL_ATTR, createSpeech, speechStateOf, subscribeSpeechQueue, type PhraseState } from '@/components/maestro/MyPhrasesPicker';
import { DEFAULT_READY_VOICE, findReadyCue, hasRecording, readyVoice, voiceHasCue, voiceHasPack, type ReadyCue } from '@/lib/maestroCues';
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

type PhraseTab = 'maestro' | 'minhas';
const TAB_KEY = 'vsstage.maestro.abaFrases';

function savedTab(): PhraseTab {
  try { return localStorage.getItem(TAB_KEY) === 'minhas' ? 'minhas' : 'maestro'; } catch { return 'maestro'; }
}

/** Quanto a prévia espera a fala de IA preparada no processador antes de desistir. */
const PREVIEW_WAIT_MS = 180_000;

/**
 * Editor da fala do Maestro por IA. Primeiro se cria a fala, depois se adiciona onde quiser. Na voz
 * clonada, Criar fala guarda em Minhas falas e gera em segundo plano (a fila segue com a janela
 * fechada). Adicionar fala só aceita fala pronta e põe na timeline na hora, sem chamar o modelo.
 * Texto, voz, tom e tamanho ficam só na janela: fechar (X, Esc, clique fora) não altera a timeline,
 * e marcação nova sem áudio some. No Maestro IA, clicar numa fala toca na hora, do áudio gravado.
 */
export default function NarrationDialog({ song, narration, onClose }: NarrationDialogProps) {
  const updateNarration = useStore((s) => s.updateNarration);
  const removeNarration = useStore((s) => s.removeNarration);
  // com a música no ar nada abre a placa nem pré-carrega; ao parar, os dois voltam sozinhos
  const playing = useStore((s) => s.transport.isPlaying);
  useSyncExternalStore(subscribeGenerating, generatingSnapshot);
  // voz regravada: os números prontos são conferidos de novo
  const packVersion = useSyncExternalStore(subscribeCountPackVersion, countPackVersion);

  const [text, setText] = useState(narration.text);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // prévia do rascunho: 'preparing' só aparece quando o motor de IA precisa trabalhar
  const [preview, setPreview] = useState<'idle' | 'preparing' | 'playing'>('idle');
  const previewToken = useRef(0);
  const mounted = useRef(true);
  const [visibleCues, setVisibleCues] = useState<string[]>([]);
  // voz brasileira de IA do app do Mac: programa, vozes e download (null no navegador)
  const [ia, setIa] = useState<MaestroVoiceStatus | null>(null);
  // tamanho e velocidade também são rascunho: só entram na marcação no Adicionar fala
  const [spanDraft, setSpanDraft] = useState(narration.end - narration.start);
  const [paceDraft, setPaceDraft] = useState(narration.pace ?? 1);
  // marcação nova (sem texto): o cursor abre na busca das falas prontas; com texto, no texto
  const [searchFirst] = useState(() => !narration.text.trim());
  const [tab, setTab] = useState<PhraseTab>(savedTab);
  // a fala escrita já foi criada nesta voz? (só consulta, nunca gera)
  const [speech, setSpeech] = useState<PhraseState>('nao');
  // número de contagem em voz clonada: vem do pacote da voz, não de Minhas falas
  const [packInfo, setPackInfo] = useState<CountPackStatus | null>(null);
  const [packTick, setPackTick] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fit = useFitOnScreen(panelRef);
  const textNow = useRef(text);
  textNow.current = text;

  // Voz e tom escolhidos ficam só na janela: entram na marcação no Adicionar fala.
  const [voice, setVoice] = useState(narration.voice || DEFAULT_READY_VOICE);
  const [pitch, setPitchDraft] = useState<'grave' | 'padrao' | 'agudo'>(narration.pitch ?? 'padrao');
  const pitchValue = pitch === 'padrao' ? undefined : pitch;
  const span = spanDraft;
  const paceValue = narration.pace === undefined ? undefined : paceDraft;
  const isDirty = (value: string) => value.trim() !== narration.text.trim()
    || voice !== narration.voice
    || pitchValue !== narration.pitch
    || Math.abs(span - (narration.end - narration.start)) > 1e-3
    || (paceValue !== undefined && Math.abs(paceValue - (narration.pace ?? paceValue)) > 1e-3);
  const draftDirty = isDirty(text);
  // Maestro IA (falas gravadas): só fala as frases da lista, texto livre não se aplica
  const ready = !!readyVoice(voice) && isOfferedVoice(voice);
  const readyOnlyText = `A voz ${readyVoice(voice)?.label ?? 'Maestro 1'} fala só as falas prontas da lista.`;
  // voz que saiu das telas: a marcação antiga mantém o áudio e o rótulo, mas não gera de novo
  const legacyVoice = !isOfferedVoice(voice);
  // o Adicionar fala do Maestro IA só aceita fala da lista com áudio gravado (ou a marcação como já estava)
  const recordedCue = (value: string, inVoice: string = voice) => {
    const cue = findReadyCue(value);
    if (!cue) return false;
    const target = readyVoice(inVoice);
    return target ? voiceHasCue(target, cue, target.intensity) : hasRecording(cue);
  };
  const canConfirm = !!text.trim() && (recordedCue(text) || !draftDirty);
  // vozes de IA: só no app do computador
  const engine = canGenerate(voice);
  const busy = isGenerating(narration.id);
  const wpm = wpmForSpan(text, span);
  // a barra vai só até onde a marcação pode ir (mínimo de tamanho e a próxima marcação)
  const pace = wpmRange(text, narrationBounds(song, narration.id).max - narration.start);
  const state = narrationState(narration);
  const onBeat = isOnBeat(song, narration.start);
  const over = narrationOverflows(narration);
  const clone = isCloneVoice(voice) && !legacyVoice;
  const created = clone && speech === 'gravada';
  const creating = clone && speech === 'gravando';
  const packWord = clone && !!narration.countGroup && hasCountPack() && isCountPackWord(text);
  // a marcação já tem na faixa exatamente esta fala
  const onTrack = !draftDirty && state === 'fresh';
  const canAdd = !busy && !!text.trim() && (onTrack || (engine && created));
  // voz de IA do próprio Mac pronta (as vozes padrão)
  const iaAvailable = !!ia?.ready;

  useEffect(() => { if (!searchFirst) { textRef.current?.focus(); textRef.current?.select(); } }, [searchFirst]);
  // acompanha o download da voz enquanto a janela está aberta
  useEffect(() => {
    let alive = true;
    const load = () => { void voiceEngineStatus().then((st) => { if (alive) setIa(st); }); };
    load();
    const timer = window.setInterval(load, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; previewToken.current = 0; stopPreview(); cancelPreviewSpeech(); };
  }, []);
  // outro toque assumiu a prévia (o exemplo de uma voz, por exemplo): esta desiste
  useEffect(() => subscribePreview(() => {
    if (!previewToken.current || isPreviewCurrent(previewToken.current)) return;
    previewToken.current = 0;
    cancelPreviewSpeech();
    setPreview('idle');
  }), []);
  // Maestro IA: a saída de áudio e as falas à vista ficam prontas antes do clique
  useEffect(() => { if (ready && !playing) warmPreview(); }, [ready, playing]);
  useEffect(() => {
    if (!ready || playing) return;
    return preloadReadyCues(voice, [textNow.current, ...visibleCues], pitchValue);
  }, [ready, playing, voice, pitchValue, visibleCues]);
  // voz clonada: motor quente ao escolher e a cada minuto enquanto a janela está aberta
  useEffect(() => {
    if (!isCloneVoice(voice) || !isOfferedVoice(voice)) return;
    warmVoice(voice);
    const timer = window.setInterval(() => warmVoice(voice), 60_000);
    return () => window.clearInterval(timer);
  }, [voice]);

  // número da contagem: pede o pacote da voz (vozes antigas começam aqui) e acompanha
  useEffect(() => {
    setPackInfo(null);
    if (!packWord) return;
    let alive = true;
    const refresh = () => { void countPackStatus(voice).then((st) => { if (alive) setPackInfo(st); }); };
    if (iaAvailable) void ensureCountPack(voice).then(refresh);
    else refresh();
    const unsub = subscribeCountPack((p) => {
      if (p.voice !== voice) return;
      refresh();
      setPackTick((n) => n + 1);
    });
    return () => { alive = false; unsub(); };
  }, [packWord, voice, iaAvailable, packVersion]);

  // situação da fala escrita: confere ao mudar o texto ou a voz e quando a fila de criação anda
  useEffect(() => {
    const value = text.trim();
    if (!clone || !value) { setSpeech('nao'); return; }
    let alive = true;
    const check = () => { void speechReadyState(value).then((st) => { if (alive) setSpeech(st); }); };
    const timer = window.setTimeout(check, 120);
    const unsub = subscribeSpeechQueue(check);
    return () => { alive = false; window.clearTimeout(timer); unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, voice, clone, packTick, packVersion]);

  /** Número de contagem vem do pacote da voz; as outras falas, de Minhas falas. */
  const speechReadyState = async (value: string): Promise<PhraseState> => {
    if (narration.countGroup && await countPackHas(voice, [value])) return 'gravada';
    return speechStateOf(value, voice);
  };

  const currentNarration = () => useStore.getState().songs.find((s) => s.id === song.id)?.narrations?.find((x) => x.id === narration.id);

  /** Grava o rascunho na marcação, num passo só do desfazer. Só o Adicionar fala chama. */
  const applyDraft = (spanOverride?: number) => {
    const n = currentNarration();
    const trimmed = textNow.current.trim();
    if (!n) return trimmed;
    const patch: Partial<MaestroNarration> = {};
    if (trimmed !== n.text) patch.text = trimmed;
    if (voice !== n.voice) { patch.voice = voice; rememberVoice(voice); }
    if (pitchValue !== n.pitch) { patch.pitch = pitchValue; rememberPitch(pitchValue); }
    const fresh = useStore.getState().songs.find((s) => s.id === song.id) ?? song;
    const end = Math.max(n.start + NARRATION_MIN_LENGTH, Math.min(narrationBounds(fresh, n.id).max, n.start + (spanOverride ?? spanDraft)));
    if (Math.abs(end - n.end) > 1e-3) patch.end = end;
    if (n.pace !== undefined && Math.abs(paceDraft - n.pace) > 1e-3) patch.pace = paceDraft;
    if (Object.keys(patch).length) updateNarration(song.id, narration.id, patch);
    return trimmed;
  };

  const cancelPreview = () => {
    previewToken.current = 0;
    stopPreview();
    cancelPreviewSpeech();
    setPreview('idle');
  };

  const startPreview = () => {
    const owner = claimPreview();
    previewToken.current = owner;
    return owner;
  };

  /** Fecha sem gravar nem gerar nada. Marcação nova, ainda sem fala, some. */
  const close = () => {
    cancelPreview();
    const n = currentNarration();
    if (n && !n.text.trim() && !n.clipId) removeNarration(song.id, narration.id);
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // a janela de clonar está por cima: o Esc é dela
      if (subdialogOpen()) return;
      // Esc na busca das falas prontas com algo escrito: só limpa a busca (a própria busca cuida)
      const t = e.target as HTMLInputElement | null;
      if (t?.hasAttribute?.(ESC_CLEARS_ATTR) && t.value) return;
      // campo com Esc próprio (nome da pasta): cancela só o campo, mesmo vazio
      if (t?.hasAttribute?.(ESC_LOCAL_ATTR)) return;
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

  /**
   * Trocou a voz: fica na janela; a marcação só muda no Adicionar fala. Com fala selecionada e a
   * música parada, a mesma fala toca na voz nova, na hora. Com a música no ar não sai som.
   */
  const chooseVoice = (v: string) => {
    const value = textNow.current.trim();
    const target = readyVoice(v);
    const has = !!target && !!value && recordedCue(value, v);
    const canHear = has && !useStore.getState().transport.isPlaying;
    if (v === voice) { if (canHear) playCue(value, v); return; }
    cancelPreview();
    setVoice(v);
    setDone(null);
    if (target && value && !has) {
      setError(readyVoice(voice)
        ? `Esta fala não está gravada na voz ${target.label}. Escolha outra fala da lista.`
        : 'O texto livre só vale na voz clonada. Nas vozes prontas, escolha uma fala da lista.');
    } else setError(null);
    if (canHear) playCue(value, v);
  };

  /** Tom da voz: grave, padrão ou agudo (vale para esta fala ao adicionar e vira o padrão das próximas). */
  const choosePitch = (p: 'grave' | 'padrao' | 'agudo') => {
    if (p === pitch) return;
    cancelPreview();
    setPitchDraft(p);
    setDone(null);
  };

  /** Tamanho novo no rascunho, sem invadir a próxima marcação. */
  const setLength = (seconds: number) => {
    const { max } = narrationBounds(song, narration.id);
    setSpanDraft(Math.max(NARRATION_MIN_LENGTH, Math.min(max - narration.start, seconds)));
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

  const putText = (value: string) => {
    setText(value);
    textNow.current = value;
    setDone(null);
    setError(null);
  };

  const playBuffer = (buffer: AudioBuffer, token: number) => {
    if (token !== previewToken.current) return;
    if (useStore.getState().transport.isPlaying) {
      setPreview('idle');
      setDone('Pronto. Com a música tocando a prévia não sai, para não cair no PA.');
      return;
    }
    setPreview('playing');
    playPreview(buffer, () => { if (token === previewToken.current) setPreview('idle'); }, token);
  };

  /**
   * Toca a fala do Maestro IA por um caminho direto: do buffer em memória, no mesmo clique, sem fila
   * de geração e sem motor. Com a música no ar não toca, para a prévia não cair no PA.
   */
  const playCue = (value: string, inVoice: string = voice) => {
    const token = startPreview();
    if (useStore.getState().transport.isPlaying) {
      setPreview('idle');
      setDone('Fala escolhida. Com a música tocando ela não sai aqui, para não cair no PA.');
      return;
    }
    const hit = readyCueCached(inVoice, value, pitchValue);
    if (hit) { playBuffer(hit, token); return; }
    setPreview('playing');
    void readyCueListen(inVoice, value, pitchValue).then((buffer) => {
      if (buffer) { playBuffer(buffer, token); return; }
      if (token === previewToken.current) { setPreview('idle'); setError('Esta fala ainda não tem áudio gravado.'); }
    }, () => {
      if (token !== previewToken.current) return;
      setPreview('idle');
      const target = readyVoice(inVoice);
      setError(target && voiceHasPack(target.dir)
        ? 'Não encontrei o áudio desta fala nesta voz. O pacote será conferido de novo.'
        : 'Não encontrei o áudio desta fala. Reinstale o VS Stage.');
    });
  };

  /** Ponteiro sobre a fala: ela passa na frente da pré-carga, para o clique já achar pronta. */
  const primeCue = (value: string) => {
    if (useStore.getState().transport.isPlaying) return;
    void readyCueListen(voice, value, pitchValue).catch(() => null);
  };

  /** Fala da biblioteca: no Maestro IA toca na hora; nas vozes clonadas só vai para o texto. */
  const pickCue = (cue: ReadyCue) => {
    if (!ready) cancelPreview();
    putText(cue.text);
    if (ready) playCue(cue.text);
  };

  /** Minha fala: vai para o texto; se já está pronta nesta voz, toca na hora. */
  const pickPhrase = (value: string, recorded: boolean) => {
    cancelPreview();
    putText(value);
    if (recorded && !useStore.getState().transport.isPlaying) void previewText(value);
  };

  const chooseTab = (t: PhraseTab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* só nesta sessão */ }
  };

  /** Busca sem fala pronta, na voz clonada: o que foi digitado vira o texto. */
  const takeTypedText = (typed: string) => {
    if (!typed || ready) return;
    setText(typed);
    textNow.current = typed;
    setDone(null);
    textRef.current?.focus();
  };

  const draftOf = (value: string): SpeechDraft => ({
    text: value, voice, span, pace: paceValue, pitch: pitchValue, group: draftGroup(song.id, narration.countGroup, narration.id, value),
  });

  /** Toca o texto na voz escolhida sem mexer na marcação nem na timeline. */
  const previewText = async (value: string) => {
    const token = startPreview();
    setError(null);
    // o áudio da faixa só vale se for mesmo deste texto; voz que saiu do programa só tem esse áudio
    if (!isDirty(value) && narration.clipId && (legacyVoice || narrationState(narration) === 'fresh')) {
      const onTrack = await narrationBuffer(narration);
      if (token !== previewToken.current) return;
      if (onTrack) { playBuffer(onTrack, token); return; }
    }
    if (ready) { playCue(value); return; }
    if (legacyVoice) { setError('Essa voz saiu do programa. Escolha um Maestro ou uma voz sua para ouvir este texto.'); return; }
    if (!engine) { setError('As vozes de IA só são geradas no app do computador.'); return; }
    const draft = draftOf(value);
    setPreview('preparing');
    const giveUpAt = Date.now() + PREVIEW_WAIT_MS;
    try {
      for (;;) {
        try {
          const out = await previewSpeech(draft);
          if (token !== previewToken.current) return;
          // a prévia nunca toca a voz do sistema como se fosse a clonada
          if (out.engine === 'mac') {
            setPreview('idle');
            setError('A voz de IA não está disponível agora. Nada entrou na faixa.');
            return;
          }
          if (out.note) setDone(out.note);
          playBuffer(out.buffer, token);
          return;
        } catch (err) {
          if (token !== previewToken.current) return;
          if (!isSpeechPreparing(err)) throw err;
        }
        // no processador a fala de IA sai em segundo plano: espera ela ficar pronta
        do {
          if (Date.now() >= giveUpAt) {
            setPreview('idle');
            setError('A voz ainda está sendo preparada. Toque em Play de novo daqui a pouco.');
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          if (token !== previewToken.current) return;
        } while (!(await draftReady(draft)));
        if (token !== previewToken.current) return;
      }
    } catch (err) {
      if (token !== previewToken.current) return;
      setPreview('idle');
      if (isSpeechCanceled(err)) return;
      setError(friendlyError(err, 'Não foi possível preparar a prévia.'));
    }
  };

  /** Play: toca a fala pronta; tocando ou preparando, cancela. Nunca gera fala nova. */
  const playDraft = () => {
    if (preview !== 'idle') { cancelPreview(); return; }
    const value = textNow.current.trim();
    if (!value) { setError(ready ? 'Escolha uma fala da lista.' : 'Escreva o texto que o maestro deve falar.'); return; }
    if (!ready && !created && !onTrack) { setError('Crie a fala para poder ouvir.'); return; }
    void previewText(value);
  };

  /** Criar fala: entra na fila em segundo plano e o campo fica livre para escrever a próxima. */
  const createDraft = () => {
    const value = textNow.current.trim();
    // número da contagem não vira fala solta: ele sai do pacote da voz
    if (!value || !clone || !iaAvailable || packWord) return;
    const made = createSpeech(value, voice);
    if (!made) return;
    chooseTab('minhas');
    if (made.existed) {
      putText(made.text);
      setDone('Essa fala já existe nesta pasta.');
      return;
    }
    putText('');
    setDone('Criando em segundo plano. Pode escrever a próxima ou fechar a janela.');
    textRef.current?.focus();
  };

  /**
   * Adicionar fala (voz clonada): só fala pronta. Confere o arquivo na hora do clique, põe na
   * timeline sem chamar o modelo e fecha. Marcação nova ganha o tamanho natural da fala, para ela
   * não sair acelerada.
   */
  const addSpeech = async () => {
    const value = textNow.current.trim();
    if (onTrack) { cancelPreview(); onClose(); return; }
    if (!value || !canAdd) { setError('Crie a fala antes de adicionar.'); return; }
    const st = await speechReadyState(value);
    if (!mounted.current) return;
    if (st !== 'gravada') { setSpeech(st); setError('Esta fala ainda não está pronta nesta voz.'); return; }
    cancelPreview();
    setError(null);
    let natural: number | undefined;
    if (narration.pace === undefined && !narration.clipId) {
      try {
        const out = await previewSpeech({ text: value, voice, span: 0, pitch: pitchValue });
        if (!mounted.current) return;
        if (out.buffer.duration > span) natural = out.buffer.duration;
      } catch (err) {
        if (mounted.current) setError(friendlyError(err, 'Não foi possível abrir a fala.'));
        return;
      }
    }
    applyDraft(natural);
    // só a fala pronta entra: nunca troca o áudio da marcação pela voz do sistema
    void generateNarration(song.id, narration.id, { fallback: false }).catch(() => { /* o erro fica na marcação */ });
    onClose();
  };

  /** ⌘↩: adiciona a fala pronta; se ainda não existe, cria. */
  const primaryAction = () => {
    if (canAdd) void addSpeech();
    else if (!creating) createDraft();
  };

  /** Adicionar fala do Maestro IA: a fala escolhida entra na faixa e a janela fecha na hora. */
  const confirmReady = () => {
    if (!canConfirm) { setError('Escolha uma fala da lista.'); return; }
    cancelPreview();
    applyDraft();
    scheduleGeneration(song.id, narration.id, 0);
    onClose();
  };

  // o aviso do download da voz de IA só interessa a quem usa uma voz clonada
  const iaNotice = engine && isIaVoice(voice) && !legacyVoice ? (clone ? iaBlockedText(ia) : iaStatusText(ia)) : null;
  // Maestro IA: a aba Minhas falas (texto livre) não se aplica
  const tabNow: PhraseTab = ready ? 'maestro' : tab;
  const btn = 'console-key h-6 px-2 text-[10px]';
  const notice = 'px-2 py-1 rounded text-[10px] leading-snug';

  return (
    <div
      ref={panelRef}
      className="console-face fixed z-[200] w-[860px] max-w-[calc(100vw-24px)] rounded-lg border border-black shadow-2xl p-3 flex flex-col gap-2 text-xs font-stage animate-[fadeIn_120ms_ease-out]"
      style={{ top: fit.top, left: '50%', transform: `translateX(-50%) scale(${fit.scale})`, transformOrigin: 'top center' }}
      role="dialog"
      aria-label="Maestro por IA"
    >
      {/* Cabeçalho numa linha só: nome, lugar da marcação, tamanho e ritmo */}
      <div className="flex items-center gap-3">
        <span className="console-legend flex items-center gap-1.5 uppercase text-logic-lcd-amber">
          <Sparkles size={11} /> Maestro por IA
        </span>
        <span className="console-display flex-1 flex items-center gap-3 px-2 h-6 font-mono text-[11px]">
          <span className="flex-1">{formatRegionTime(narration.start)} a {formatRegionTime(narration.end)}</span>
          <span>{span.toFixed(2)}s</span>
          <span className={wpm > FAST_WPM ? 'text-logic-lcd-amber' : ''}>{wpm} palavras/min</span>
        </span>
        <button className="console-key h-6 w-6 flex items-center justify-center" onClick={close} title="Fechar (Esc)" aria-label="Fechar">
          <X size={12} />
        </button>
      </div>

      <div className="grid gap-3 items-start min-[760px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2 min-w-0">
      {ready ? (
        // Maestro IA: fala só as falas gravadas da lista; o campo de digitar não se aplica
        <div className="flex flex-col gap-1">
          <div className="console-display w-full min-h-[28px] px-2 py-1.5 text-[12px] text-logic-text-dim truncate" title={text || undefined}>
            {text || 'Escolha uma fala da lista abaixo.'}
          </div>
          <div className={`px-2 py-1 rounded text-[10px] leading-snug bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber`}>
            {readyOnlyText} Para texto livre, escolha uma voz clonada.
          </div>
        </div>
      ) : (
      <textarea
        ref={textRef}
        value={text}
        onChange={(e) => { setText(e.target.value); setDone(null); if (preview !== 'idle') cancelPreview(); }}
        rows={3}
        maxLength={1200}
        placeholder="O que o maestro deve falar. Ex.: Atenção, dois compassos e entra o refrão!"
        className="console-display w-full resize-none px-2 py-1.5 text-[12px] focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); primaryAction(); }
        }}
      />
      )}

      {/* Falas: a biblioteca do Maestro (por assunto, com busca) ou as minhas, em pastas */}
      <div className="flex items-center gap-1" role="tablist" aria-label="Falas">
        {([['maestro', 'Falas do Maestro'], ['minhas', 'Minhas falas']] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tabNow === id}
            className={`console-key h-6 px-2 text-[10px] ${tabNow === id ? 'is-lit-blue' : ''}`}
            onClick={() => chooseTab(id)}
            disabled={ready && id === 'minhas'}
            title={ready && id === 'minhas' ? `${readyOnlyText} Para as suas falas, escolha uma voz clonada.` : undefined}
          >
            {label}
          </button>
        ))}
      </div>
      {tabNow === 'maestro' ? (
        <ReadyCuePicker text={text} onPick={pickCue} onPrime={ready ? primeCue : undefined} onFreeText={ready ? undefined : takeTypedText} onVisible={setVisibleCues} autoFocus={searchFirst || ready} voice={voice} playsOnPick={ready} />
      ) : (
        <MyPhrasesPicker text={text} voice={voice} iaReady={iaAvailable} onPick={pickPhrase} />
      )}
      </div>

      <div className="flex flex-col gap-2 min-w-0">
      {/* Voz: o Maestro IA (falas gravadas) e as vozes clonadas */}
      <MaestroVoicePicker voice={voice} onChoose={chooseVoice} pitch={pitchValue} cueText={text} />

      {/* Tom da voz: grave, padrão ou agudo (sem mudar a velocidade) */}
      <div className="flex items-center gap-2">
        <span className="console-legend w-12 shrink-0">Tom</span>
        <div className="flex-1 grid grid-cols-3 gap-1" role="group" aria-label="Tom da voz">
          {PITCH_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`${btn} ${pitch === p.id ? 'is-lit-green' : ''}`}
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
          <span className="console-legend w-12 shrink-0">Veloc.</span>
          <input
            type="range"
            min={COUNT_PACE_MIN}
            max={COUNT_PACE_MAX}
            step={0.05}
            value={paceDraft}
            onChange={(e) => { setPaceDraft(Number(e.target.value)); setDone(null); }}
            className="flex-1 accent-logic-lcd-amber"
            title="Velocidade da voz desta marcação da contagem (a fala não estica; se não couber no tempo, acelera sozinha)"
          />
          <span className="console-readout text-logic-lcd-text w-12">{paceDraft.toFixed(2)}×</span>
        </div>
      )}

      {/* Ritmo: o controle anda o fim da marcação, porque é o tamanho que define a velocidade */}
      {narration.pace === undefined && (
      <div className="flex items-center gap-2">
        <span className="console-legend w-12 shrink-0">Ritmo</span>
        <input
          type="range"
          min={pace.min}
          max={pace.max}
          step={1}
          value={Math.max(pace.min, Math.min(pace.max, wpm))}
          disabled={pace.max <= pace.min}
          onChange={(e) => setLength(spanForWpm(text, Number(e.target.value)))}
          className="flex-1 min-w-0 accent-logic-lcd-amber disabled:opacity-40"
          title="Mais rápido = marcação menor; mais devagar = marcação maior. Na régua: arraste as bordas da marcação."
        />
        <span className="console-readout text-logic-lcd-text w-14 shrink-0" title="Palavras por minuto">{wpm} p/min</span>
        <button className={btn} onClick={() => setLength(spanForNatural(text))} title="Tamanho para o ritmo de conversa normal">
          Natural
        </button>
      </div>
      )}

      <div className="grid grid-cols-2 gap-1">
        <button
          className={`${btn} ${onBeat ? 'is-lit-green' : ''}`}
          onClick={syncToCursor}
          title="Leva o início da marcação para o começo do beat em que o cursor está (o tamanho não muda). Na régua: arraste o meio da marcação para mudar de lugar."
        >
          Sincar no beat do cursor{onBeat ? ' ✓' : ''}
        </button>
        <button className={btn} onClick={() => seekToPosition(song.id, narration.start)} title="Leva o cursor ao início da marcação">
          Ir para a marcação
        </button>
      </div>

      {wpm > FAST_WPM && (
        <div className={`${notice} bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber`}>
          Rápido demais ({wpm} palavras/min): aumente a marcação ou encurte o texto.
        </div>
      )}
      {over > 0 && !busy && state === 'fresh' && (
        <div className={`${notice} bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber`}>
          A fala passa {over.toFixed(1)}s do fim da marcação, mesmo no ritmo máximo.
        </div>
      )}
      {!engine && (
        <div className={`${notice} bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber`}>
          As vozes de IA só são geradas no app do computador. As marcações ficam salvas no projeto.
        </div>
      )}
      {preview === 'preparing' && (
        <div className={`${notice} bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber`} role="status">
          Preparando a prévia nesta voz. Nada entra na faixa. Toque no botão de prévia para cancelar.
        </div>
      )}
      {packWord && !created && !onTrack && iaAvailable && (
        <div className="console-well flex items-center gap-2 px-2 h-7 text-[10px]" role="status">
          <span className={`console-led shrink-0 ${packInfo?.state === 'falhou' ? '' : 'is-on-amber animate-pulse'}`} />
          <span className={`flex-1 min-w-0 truncate ${packInfo?.state === 'falhou' ? 'text-logic-lcd-red' : 'text-logic-lcd-amber'}`} title={packInfo?.error ?? undefined}>
            {packInfo?.state === 'falhou'
              ? 'Não deu para preparar a contagem desta voz'
              : `Preparando contagem ${packInfo?.done ?? 0} de ${packInfo?.total ?? 16}${playing ? ' (pausada com a música tocando)' : ''}`}
          </span>
          {packInfo?.state === 'falhou' && (
            <button className="console-key h-5 px-1.5 text-[10px] shrink-0" onClick={() => { void ensureCountPack(voice); }}>
              Tentar de novo
            </button>
          )}
        </div>
      )}
      {iaNotice && (
        <div className={`${notice} bg-sky-500/10 border border-sky-400/30 text-sky-200`}>{iaNotice}</div>
      )}
      {error && (
        <div className={`${notice} bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-logic-lcd-red`}>{error}</div>
      )}
      {!error && narration.status === 'error' && narration.error && !busy && (
        <div className={`${notice} bg-logic-lcd-red/15 border border-logic-lcd-red/40 text-logic-lcd-red`}>{narration.error}</div>
      )}
      {done && !error && (
        <div className={`${notice} bg-logic-lcd-green/15 border border-logic-lcd-green/40 text-logic-lcd-green`}>{done}</div>
      )}

      </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-black/50 gap-1">
        <button
          className="console-key h-7 px-2 text-[11px] flex items-center gap-1 text-logic-lcd-red shrink-0"
          onClick={() => { stopPreview(); removeNarration(song.id, narration.id); onClose(); }}
          title="Apagar a marcação e a fala dela"
        >
          <Trash2 size={11} /> Apagar
        </button>
        <div className="flex items-center gap-1.5">
          <button
            className={`console-key h-7 w-7 flex items-center justify-center ${preview !== 'idle' ? 'is-lit-amber' : ''}`}
            onClick={playDraft}
            disabled={preview === 'idle' && (!text.trim() || (!ready && !created && !onTrack))}
            title={preview === 'preparing' ? 'Cancelar a prévia' : preview === 'playing' ? 'Parar' : !ready && !created && !onTrack ? 'Crie a fala para poder ouvir' : 'Ouvir a fala pronta (não entra na faixa)'}
            aria-label={preview === 'preparing' ? 'Cancelar a prévia' : preview === 'playing' ? 'Parar' : 'Ouvir a fala pronta'}
          >
            {preview === 'preparing' ? <Loader2 size={11} className="animate-spin" /> : preview === 'playing' ? <Square size={11} /> : <Play size={11} />}
          </button>
          {ready ? (
            // Maestro IA: a fala já está gravada, não há o que criar. Põe na faixa e fecha.
            <button
              className="console-key is-lit-amber h-7 px-3 text-[11px] flex items-center gap-1.5 shrink-0"
              onClick={confirmReady}
              disabled={!canConfirm}
              title={canConfirm ? 'Coloca esta fala na faixa Maestro IA e fecha' : 'Escolha uma fala da lista'}
            >
              <Check size={11} />
              Adicionar fala
            </button>
          ) : (
            <>
              {clone && !created && !onTrack && !packWord && (
                <button
                  className={`console-key h-7 px-3 text-[11px] flex items-center gap-1.5 shrink-0 ${text.trim() && !creating ? 'is-lit-amber' : ''}`}
                  onClick={createDraft}
                  disabled={!text.trim() || creating || !iaAvailable}
                  title={!iaAvailable ? 'A voz de IA ainda não está pronta neste computador' : 'Cria a fala em segundo plano e guarda em Minhas falas (⌘↩). Não mexe na timeline.'}
                >
                  <span className={`console-led shrink-0 ${creating ? 'is-on-amber animate-pulse' : ''}`} />
                  {creating ? 'Criando...' : 'Criar fala'}
                </button>
              )}
              <button
                className={`console-key h-7 px-3 text-[11px] flex items-center gap-1.5 shrink-0 ${canAdd ? 'is-lit-amber' : ''} ${busy ? 'cursor-wait' : ''}`}
                onClick={() => { void addSpeech(); }}
                disabled={!canAdd}
                title={legacyVoice && !onTrack ? 'Escolha um Maestro ou uma voz sua' : canAdd ? 'Coloca a fala pronta na faixa Maestro IA, na hora (⌘↩)' : packWord ? 'A contagem desta voz ainda está sendo preparada' : 'Crie a fala primeiro: só fala pronta entra na timeline'}
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Adicionar fala
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
