import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronRight, Loader2, Mic, Play, RotateCcw, Square, X } from 'lucide-react';
import { friendlyError } from '@/lib/friendlyError';
import { playPreview, rememberCloneNames, stopPreview } from '@/lib/maestroVoice';
import { useFitOnScreen } from '@/lib/useFitOnScreen';
import type { ClonedVoice, CloneReport } from '@/lib/localNetwork';

/** Os três modos de fala de uma voz clonada: gravados de uma vez só, em sequência. */
type Mode = 'normal' | 'calma' | 'forte';

const MODES: Array<{ id: Mode; label: string; how: string; text: string }> = [
  {
    id: 'normal',
    label: 'Normal',
    how: 'Firme e clara, voz de palco.',
    text: 'Boa noite, pessoal! Eu sou o diretor musical e vou guiar a banda hoje. Atenção nas entradas: vamos pro refrão e prepara o final.',
  },
  {
    id: 'calma',
    label: 'Calma',
    how: 'Voz baixa e tranquila, como num momento de oração.',
    text: 'Agora bem suave, só o teclado e a voz. Respira junto comigo, sem pressa, e vai diminuindo devagar.',
  },
  {
    id: 'forte',
    label: 'Forte',
    how: 'Empolgado, chamando a banda por cima do som alto, sem gritar estourado.',
    text: 'Vamos lá, banda! Sobe tudo agora, refrão com força! Mais uma vez! Um, dois, três, quatro!',
  },
];

const TIPS = [
  'Lugar quieto, sem ventilador nem conversa.',
  'Microfone a um palmo da boca.',
  'Voz de palco, no seu ritmo natural.',
  'Leia do jeito que está escrito, sem comentar.',
];

/** Etapas reais, na ordem: ruído só se precisar, corte das pontas, referência natural e prévia masterizada. */
const CHAIN = ['Ruído', 'Corte', 'Voz natural', 'Master'];

const INPUT_KEY = 'vsstage.maestro.cloneInput';
/** A gravação para sozinha aqui (o tratamento corta as pausas; a tomada ideal tem 6 a 10 s). */
const MAX_RECORD_S = 25;
/** Avisos do cronômetro: os mesmos limites que o tratamento aplica à fala (LONG_SECONDS e MAX_SECONDS). */
const LONG_TAKE_S = 10.5;
const TOO_LONG_TAKE_S = 13;
const MIN_RECORD_S = 2;
const METER_LEDS = 20;
/** Contagem antes de cada modo, para respirar e ler a instrução. */
const COUNT_S = 3;

/** Tomada tratada. Guarda a gravação para refazer o preparo se o token expirar antes de salvar. */
type ReadyTake = { kind: 'ready'; token: string; clean: AudioBuffer; report: CloneReport; wav: ArrayBuffer };

type Take =
  | { kind: 'empty' }
  | { kind: 'captured'; wav: ArrayBuffer; prev?: ReadyTake }
  | { kind: 'processing'; wav: ArrayBuffer; prev?: ReadyTake }
  | { kind: 'failed'; message: string }
  | ReadyTake;

/** Gravação em andamento: a fila de modos, qual está valendo e se é contagem ou gravação. */
interface Flow {
  queue: Mode[];
  index: number;
  phase: 'count' | 'rec';
  count: number;
}

/** Tratamento em sequência das tomadas gravadas, com um progresso só. */
interface Batch {
  done: number;
  total: number;
  mode: Mode;
  percent: number;
  message: string;
}

interface Props {
  onClose: () => void;
  onSaved: (voice: ClonedVoice) => void;
}

interface InputEngine {
  stream: MediaStream;
  ctx: AudioContext;
  proc: ScriptProcessorNode;
  sampleRate: number;
  /** blocos gravados (null = só medindo o nível) */
  chunks: Float32Array[] | null;
  samples: number;
  peak: number;
}

interface SavedInput { deviceId: string; label: string; channel: number }

function loadSavedInput(): SavedInput | null {
  try {
    const raw = localStorage.getItem(INPUT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedInput>;
    return typeof v.deviceId === 'string' ? { deviceId: v.deviceId, label: String(v.label ?? ''), channel: Number(v.channel) || 0 } : null;
  } catch {
    return null;
  }
}

function saveInput(v: SavedInput): void {
  try { localStorage.setItem(INPUT_KEY, JSON.stringify(v)); } catch { /* sem armazenamento: só não lembra */ }
}

/** WAV mono de 16 bits (PCM cru, sem compressão). */
function encodeMonoWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const ab = new ArrayBuffer(44 + length * 2);
  const v = new DataView(ab);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, length * 2, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i] || 0));
      v.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true);
      o += 2;
    }
  }
  return ab;
}

async function decodeBase64Wav(b64: string): Promise<AudioBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ctx = new OfflineAudioContext(1, 1, 48000);
  return ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
}

const num = (n: number, d = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Nível do medidor (pico em dBFS) e em que faixa está. */
/** Tira o "Error invoking remote method..." que o Electron põe na frente da mensagem do processo principal. */
function cleanIpcError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return new Error(msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, ''));
}

function meterOf(peak: number): { lit: number; zone: 'baixo' | 'bom' | 'estourando' | null } {
  if (peak <= 0.0005) return { lit: 0, zone: null };
  const db = 20 * Math.log10(peak);
  const lit = Math.max(0, Math.min(METER_LEDS, Math.round(((db + 60) / 60) * METER_LEDS)));
  return { lit, zone: db > -3 ? 'estourando' : db < -30 ? 'baixo' : 'bom' };
}

function ledColor(i: number): string {
  const db = (i / METER_LEDS) * 60 - 60;
  if (db > -4) return 'bg-logic-lcd-red shadow-[0_0_5px_rgba(255,65,54,0.8)]';
  if (db > -13) return 'bg-logic-lcd-amber shadow-[0_0_5px_rgba(255,171,31,0.7)]';
  return 'bg-logic-lcd-green shadow-[0_0_5px_rgba(62,226,110,0.7)]';
}

/**
 * Clonar voz do Maestro: o diretor grava a própria voz (sem importar áudio, para ninguém clonar a
 * voz de outra pessoa). Um único Gravar conduz Normal, Calma e Forte em sequência; no fim o programa
 * trata as três como num estúdio e mostra os detalhes. Depois, cada modo pode ser ouvido e regravado sozinho.
 */
export default function MaestroCloneDialog({ onClose, onSaved }: Props) {
  const bridge = window.vsDesktop;
  const available = !!bridge?.maestroClonePrepare && !!bridge?.maestroCloneSave;

  const [mode, setMode] = useState<Mode>('normal');
  const [takes, setTakes] = useState<Record<Mode, Take>>({ normal: { kind: 'empty' }, calma: { kind: 'empty' }, forte: { kind: 'empty' } });
  const takesRef = useRef(takes);
  const updateTakes = useCallback((fn: (t: Record<Mode, Take>) => Record<Mode, Take>) => {
    takesRef.current = fn(takesRef.current);
    setTakes(takesRef.current);
  }, []);
  const [flow, setFlowState] = useState<Flow | null>(null);
  const flowRef = useRef<Flow | null>(null);
  const setFlow = useCallback((next: Flow | null) => {
    flowRef.current = next;
    setFlowState(next);
  }, []);
  const [batch, setBatch] = useState<Batch | null>(null);
  // o microfone só fica aberto enquanto serve: ao cancelar ou terminar, ele e o AudioContext são liberados
  const [micOn, setMicOn] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [clipHold, setClipHold] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Mode | null>(null);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'feminina' | 'masculina'>('masculina');
  const [consent, setConsent] = useState(false);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [channel, setChannel] = useState(() => loadSavedInput()?.channel ?? 0);
  const [channels, setChannels] = useState(1);
  const [inputError, setInputError] = useState<string | null>(null);
  const [inputReady, setInputReady] = useState(false);
  // fechar com tomadas gravadas pede confirmação no próprio painel
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;
  const engineRef = useRef<InputEngine | null>(null);
  const processingRef = useRef<Mode | null>(null);
  const clipAtRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const fit = useFitOnScreen(panelRef);

  const mountedRef = useRef(true);
  const recording: Mode | null = flow?.phase === 'rec' ? flow.queue[flow.index] : null;
  const busy = !!flow || !!batch || saving;
  // voz salva: os controles travam e a janela só espera o Concluir
  const [savedVoice, setSavedVoice] = useState<ClonedVoice | null>(null);
  const current = MODES.find((m) => m.id === mode)!;
  const take = takes[mode];

  // ---------- placas de som ----------

  // a entrada caiu: descarta só a tomada em andamento e avisa
  const lostInput = useCallback((eng: InputEngine | null) => {
    if (eng) {
      eng.chunks = null;
      eng.samples = 0;
    }
    if (flowRef.current) {
      setFlow(null);
      setElapsed(0);
      setError('A entrada foi desligada no meio da gravação. As tomadas já gravadas continuam guardadas.');
    }
  }, [setFlow]);

  const listDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter((d) => d.kind === 'audioinput');
    setDevices(inputs);
    // a placa sumiu no meio da sequência: para aqui, para não seguir gravando em outro microfone
    const cur = deviceIdRef.current;
    if (flowRef.current && cur && !inputs.some((d) => d.deviceId === cur)) {
      lostInput(engineRef.current);
      setMicOn(false);
    }
    setDeviceId((prev) => {
      if (prev && inputs.some((d) => d.deviceId === prev)) return prev;
      const saved = loadSavedInput();
      const match = saved && (inputs.find((d) => d.deviceId === saved.deviceId) ?? inputs.find((d) => d.label && d.label === saved.label));
      return match?.deviceId ?? inputs[0]?.deviceId ?? null;
    });
    return inputs;
  }, [lostInput]);

  // pede o microfone uma vez (sem isso o sistema não diz o nome das placas) e lista as entradas
  useEffect(() => {
    if (!available || !navigator.mediaDevices?.getUserMedia) return;
    let alive = true;
    void (async () => {
      try {
        const first = await navigator.mediaDevices.enumerateDevices();
        if (!first.some((d) => d.kind === 'audioinput' && d.label)) {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
        }
        if (alive) await listDevices();
      } catch (err) {
        if (!alive) return;
        const nameErr = err instanceof DOMException ? err.name : '';
        setInputError(nameErr === 'NotFoundError' || nameErr === 'OverconstrainedError'
          ? 'Nenhuma entrada de áudio encontrada. Ligue a placa de som.'
          : 'Permita o acesso do VS Stage ao microfone em Ajustes do Sistema > Privacidade e Segurança > Microfone e abra o VS Stage de novo.');
      }
    })();
    const onChange = () => { void listDevices(); };
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => { alive = false; navigator.mediaDevices.removeEventListener('devicechange', onChange); };
  }, [available, listDevices]);

  // abre a entrada escolhida: mede o nível o tempo todo e grava só o canal escolhido, em PCM cru
  useEffect(() => {
    if (!available || !deviceId || !micOn) return;
    let alive = true;
    let engine: InputEngine | null = null;
    let raf = 0;
    let openStream: MediaStream | null = null;
    let openCtx: AudioContext | null = null;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            channelCount: { ideal: 8 },
            // sem os filtros do sistema: o tratamento é do VS Stage (eles deixam a voz "aquática")
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        openStream = stream;
        const track = stream.getAudioTracks()[0];
        // a placa sumiu sem aviso de troca de aparelho: não deixa a tela presa em "gravando"
        if (track) track.onended = () => { if (alive) { lostInput(engine); setMicOn(false); } };
        const n = Math.max(1, Math.min(32, track?.getSettings().channelCount ?? 1));
        setChannels(n);
        const ch = Math.min(channel, n - 1);
        if (ch !== channel) setChannel(ch);
        const ctx = new AudioContext();
        openCtx = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const splitter = ctx.createChannelSplitter(n);
        src.connect(splitter);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        splitter.connect(proc, ch, 0);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        proc.connect(mute).connect(ctx.destination);
        const eng: InputEngine = { stream, ctx, proc, sampleRate: ctx.sampleRate, chunks: null, samples: 0, peak: 0 };
        proc.onaudioprocess = (e) => {
          const d = e.inputBuffer.getChannelData(0);
          let p = 0;
          for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
          eng.peak = Math.max(p, eng.peak * 0.85);
          // o limite vale aqui também: com a janela em segundo plano o desenho (e o cronômetro) atrasa
          if (eng.chunks && eng.samples < MAX_RECORD_S * eng.sampleRate) { eng.chunks.push(new Float32Array(d)); eng.samples += d.length; }
        };
        void ctx.resume();
        engine = eng;
        engineRef.current = eng;
        setInputError(null);
        setInputReady(true);
        const device = devices.find((d) => d.deviceId === deviceId);
        saveInput({ deviceId, label: device?.label ?? '', channel: ch });
        const tick = () => {
          setLevel(eng.peak);
          if (eng.peak >= 0.98) clipAtRef.current = performance.now();
          setClipHold(performance.now() - clipAtRef.current < 1200);
          if (eng.chunks) setElapsed(eng.samples / eng.sampleRate);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        openStream?.getTracks().forEach((t) => t.stop());
        void openCtx?.close().catch(() => { /* já fechou */ });
        if (alive) {
          setInputError('Não deu para abrir essa entrada. Confira se a placa está ligada e se o VS Stage tem acesso ao microfone.');
          // fecha a entrada que falhou: o próximo Gravar tenta abrir de novo
          setMicOn(false);
          if (flowRef.current) { setFlow(null); setElapsed(0); }
        }
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (engine) {
        if (engine.chunks) lostInput(engine);
        engine.proc.onaudioprocess = null;
        engine.stream.getTracks().forEach((t) => t.stop());
        void engine.ctx.close().catch(() => { /* já fechou */ });
        if (engineRef.current === engine) engineRef.current = null;
      }
      setLevel(0);
      setInputReady(false);
    };
    // devices fica fora: só serve para lembrar o nome da placa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, deviceId, channel, micOn]);

  // ---------- tratamento ----------

  useEffect(() => bridge?.onMaestroCloneProgress?.((p) => {
    const m = processingRef.current;
    if (!m) return;
    setBatch((b) => (b && b.mode === m ? { ...b, percent: p.percent, message: p.message } : b));
  }), [bridge]);

  /** Trata, uma de cada vez, as tomadas gravadas. Falha em um modo não mexe nos outros. */
  const treatCaptured = useCallback(async () => {
    const queue = MODES.filter((m) => takesRef.current[m.id].kind === 'captured');
    if (queue.length === 0) return;
    const failed: Mode[] = [];
    const messages: string[] = [];
    setError(null);
    for (let i = 0; i < queue.length; i++) {
      const { id: m, label, text } = queue[i];
      const cur = takesRef.current[m];
      if (cur.kind !== 'captured' || !mountedRef.current) continue;
      processingRef.current = m;
      setMode(m);
      setBatch({ done: i, total: queue.length, mode: m, percent: 3, message: 'Preparando a gravação...' });
      updateTakes((t) => ({ ...t, [m]: { kind: 'processing', wav: cur.wav, prev: cur.prev } }));
      try {
        const out = await bridge!.maestroClonePrepare!({ wav: cur.wav, mode: m, text });
        const clean = await decodeBase64Wav(out.wavBase64);
        updateTakes((t) => ({ ...t, [m]: { kind: 'ready', token: out.token, clean, report: out.report, wav: cur.wav } }));
      } catch (err) {
        const message = friendlyError(cleanIpcError(err), 'Não foi possível tratar a gravação. Grave de novo.');
        failed.push(m);
        messages.push(`${label}: ${message}`);
        // se a regravação falhar, a tomada boa de antes continua valendo
        updateTakes((t) => ({ ...t, [m]: cur.prev ?? { kind: 'failed', message } }));
      }
    }
    processingRef.current = null;
    if (!mountedRef.current) return;
    setBatch(null);
    setMode(failed[0] ?? queue[0].id);
    setError(messages.length > 0 ? messages.join(' ') : null);
  }, [bridge, updateTakes]);

  // ---------- gravação ----------

  const startFlow = (queue: Mode[]) => {
    if (busy || queue.length === 0) return;
    stopPreview();
    setPlaying(null);
    setError(null);
    setConfirmDiscard(false);
    setElapsed(0);
    setMode(queue[0]);
    setMicOn(true);
    setFlow({ queue, index: 0, phase: 'count', count: COUNT_S });
  };

  /** Encerra o modo atual e passa para o próximo; no último, libera a entrada e trata tudo. */
  const nextTake = useCallback(() => {
    const f = flowRef.current;
    const eng = engineRef.current;
    if (!f || f.phase !== 'rec' || !eng?.chunks) return;
    const m = f.queue[f.index];
    const chunks = eng.chunks;
    const seconds = eng.samples / eng.sampleRate;
    eng.chunks = null;
    eng.samples = 0;
    setElapsed(0);
    if (seconds < MIN_RECORD_S) {
      setError('A gravação ficou curta demais. Leia o texto inteiro.');
      setFlow({ ...f, phase: 'count', count: COUNT_S });
      return;
    }
    setError(null);
    const wav = encodeMonoWav(chunks, eng.sampleRate);
    updateTakes((t) => {
      const cur = t[m];
      const prev = cur.kind === 'ready' ? cur : cur.kind === 'captured' ? cur.prev : undefined;
      return { ...t, [m]: { kind: 'captured', wav, prev } };
    });
    if (f.index + 1 < f.queue.length) {
      setMode(f.queue[f.index + 1]);
      setFlow({ ...f, index: f.index + 1, phase: 'count', count: COUNT_S });
      return;
    }
    setFlow(null);
    setMicOn(false);
    void treatCaptured();
  }, [setFlow, treatCaptured, updateTakes]);

  /** Descarta só a tomada em andamento e libera o microfone e o AudioContext. */
  const cancelFlow = useCallback(() => {
    const eng = engineRef.current;
    if (eng) {
      eng.chunks = null;
      eng.samples = 0;
    }
    setFlow(null);
    setElapsed(0);
    setError(null);
    setMicOn(false);
  }, [setFlow]);

  // contagem entre os modos (espera a entrada abrir, se ela estava fechada)
  useEffect(() => {
    if (!flow || flow.phase !== 'count' || !inputReady) return;
    const id = window.setTimeout(() => {
      const f = flowRef.current;
      if (!f || f.phase !== 'count') return;
      if (f.count > 1) { setFlow({ ...f, count: f.count - 1 }); return; }
      const eng = engineRef.current;
      if (!eng) {
        setFlow(null);
        setError('A entrada não abriu. Confira a placa de som e tente de novo.');
        return;
      }
      eng.chunks = [];
      eng.samples = 0;
      setElapsed(0);
      setFlow({ ...f, phase: 'rec', count: 0 });
    }, 1000);
    return () => window.clearTimeout(id);
  }, [flow, inputReady, setFlow]);

  // a placa sumiu antes de a entrada abrir: não deixa a contagem presa
  useEffect(() => {
    if (flow && !deviceId) {
      setFlow(null);
      setError('Nenhuma entrada de áudio encontrada. Ligue a placa de som.');
    }
  }, [flow, deviceId, setFlow]);

  // passa sozinha no limite de duração da tomada
  useEffect(() => {
    if (recording && elapsed >= MAX_RECORD_S) nextTake();
  }, [recording, elapsed, nextTake]);

  // ---------- ouvir, regravar, salvar ----------

  const play = (m: Mode) => {
    const t = takes[m];
    if (t.kind !== 'ready') return;
    if (playing === m) { stopPreview(); setPlaying(null); return; }
    setPlaying(m);
    playPreview(t.clean, () => setPlaying((p) => (p === m ? null : p)));
  };

  const missing = MODES.filter((m) => takes[m.id].kind === 'empty' || takes[m.id].kind === 'failed');
  const started = missing.length < MODES.length;
  const readyCount = MODES.filter((m) => takes[m.id].kind === 'ready').length;
  const allReady = readyCount === MODES.length;
  const canRecord = available && !!deviceId && !busy && (!micOn || inputReady);
  const canSave = available && allReady && !busy && name.trim().length > 0 && consent;

  const save = async () => {
    if (!canSave) return;
    setError(null);
    stopPreview();
    setPlaying(null);
    setSaving(true);
    try {
      const list = MODES.flatMap((m) => {
        const t = takes[m.id];
        return t.kind === 'ready' ? [{ mode: m.id, token: t.token, text: m.text }] : [];
      });
      const payload = { name: name.trim(), gender, takes: list };
      let voice: ClonedVoice;
      try {
        voice = await bridge!.maestroCloneSave!(payload);
      } catch (err) {
        // muitas regravações tiram as tomadas mais antigas da fila do programa: prepara de novo e salva
        if (!/expirou/i.test(cleanIpcError(err).message)) throw err;
        const fresh = [];
        for (const m of MODES) {
          const t = takes[m.id];
          if (t.kind !== 'ready') continue;
          const out = await bridge!.maestroClonePrepare!({ wav: t.wav, mode: m.id, text: m.text });
          fresh.push({ mode: m.id, token: out.token, text: m.text });
        }
        voice = await bridge!.maestroCloneSave!({ ...payload, takes: fresh });
      }
      rememberCloneNames([voice]);
      // deixa o motor e a referência carregados: a primeira fala com a voz nova sai rápido
      void bridge?.maestroWarm?.(voice.id)?.catch(() => false);
      // o pacote de contagem já começou no motor: a janela avisa e fica até o Concluir
      setSavedVoice(voice);
    } catch (err) {
      setError(friendlyError(cleanIpcError(err), 'Não foi possível salvar a voz.'));
      setSaving(false);
    }
  };

  // ---------- teclado e saída ----------

  const busyRef = useRef(busy);
  busyRef.current = busy && !savedVoice;
  const hasAudio = MODES.some((m) => !['empty', 'failed'].includes(takes[m.id].kind));
  const finish = () => {
    if (savedVoice) onSaved(savedVoice);
    else if (hasAudio) setConfirmDiscard(true);
    else onClose();
  };
  // Esc na confirmação volta para a janela, nunca descarta
  const escape = () => { if (confirmDiscard) setConfirmDiscard(false); else finish(); };
  const closeRef = useRef(escape);
  closeRef.current = escape;
  const cancelRef = useRef(cancelFlow);
  cancelRef.current = cancelFlow;

  // com a janela aberta, os atalhos do programa (espaço toca, Delete apaga...) não valem
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (flowRef.current) cancelRef.current();
        else if (!busyRef.current) closeRef.current();
        return;
      }
      const t = e.target;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
      if (!typing) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; stopPreview(); };
  }, []);

  const meter = meterOf(level);
  const zone = clipHold ? 'estourando' : meter.zone;
  const flowCount = flow?.phase === 'count' ? flow.count : null;
  const lastInFlow = !!flow && flow.index === flow.queue.length - 1;
  const batchPercent = batch ? Math.round(((batch.done + Math.min(100, batch.percent) / 100) / batch.total) * 100) : 0;
  const batchLabel = batch ? MODES.find((m) => m.id === batch.mode)!.label : '';
  const pickInput = () => { if (!flowRef.current) setMicOn(true); };
  const longTake = !!recording && elapsed >= LONG_TAKE_S;
  const tooLong = !!recording && elapsed >= TOO_LONG_TAKE_S;
  const select = 'h-8 min-w-0 bg-logic-bg-deep border border-black rounded px-2 text-xs text-logic-text font-stage focus:outline-none focus:border-logic-lcd-amber disabled:opacity-50';

  return createPortal(
    <div className="fixed inset-0 z-[270] bg-black/70" data-vs-clone-dialog="" role="presentation">
      <div
        ref={panelRef}
        className="fixed w-[800px] max-w-[calc(100vw-24px)] console-face border-2 border-black rounded-lg shadow-2xl animate-[fadeIn_160ms_ease-out]"
        style={{ top: fit.top, left: '50%', transform: `translateX(-50%) scale(${fit.scale})`, transformOrigin: 'top center' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vs-clone-title"
      >
        {/* Cabeçalho */}
        <div className="flex items-center gap-2 px-4 h-11 border-b border-black/60">
          <Mic size={14} className="text-logic-lcd-amber" />
          <h2 id="vs-clone-title" className="font-stage text-[15px] font-bold tracking-wide text-logic-text">CLONAR VOZ DO MAESTRO</h2>
          <span className="console-legend ml-2">3 MODOS NUMA GRAVAÇÃO · SÓ A SUA VOZ</span>
          <button className="console-key ml-auto w-7 h-7 flex items-center justify-center" onClick={finish} disabled={busy && !savedVoice} title="Fechar (Esc)" aria-label="Fechar">
            <X size={13} />
          </button>
        </div>

        {!available && (
          <div className="mx-4 mt-3 flex items-center gap-2 text-xs text-logic-lcd-amber">
            <AlertTriangle size={13} /> Clonar a voz só funciona no programa VS Stage instalado no computador.
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4 px-4 py-3">
          {/* ---------- Esquerda: entrada, tomadas, texto, gravar ---------- */}
          <div className="flex flex-col gap-3 min-w-0">
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
              <label className="flex flex-col gap-1 min-w-0">
                <span className="console-legend">PLACA DE SOM (ENTRADA)</span>
                <select
                  className={select}
                  value={deviceId ?? ''}
                  onChange={(e) => { setDeviceId(e.target.value); pickInput(); }}
                  disabled={!available || busy || devices.length === 0}
                >
                  {devices.length === 0 && <option value="">Nenhuma entrada</option>}
                  {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Entrada ${i + 1}`}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="console-legend">CANAL</span>
                <select
                  className={select}
                  value={Math.min(channel, channels - 1)}
                  onChange={(e) => { setChannel(Number(e.target.value)); pickInput(); }}
                  disabled={!available || busy || channels < 2}
                >
                  {Array.from({ length: channels }, (_, i) => <option key={i} value={i}>Canal {i + 1}</option>)}
                </select>
              </label>
            </div>
            {inputError && <p className="text-[11px] text-logic-lcd-red leading-snug -mt-1.5">{inputError}</p>}

            {/* Modos */}
            <div>
              <div className="console-legend mb-1.5">MODOS</div>
              <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Modos da voz">
                {MODES.map((m) => {
                  const t = takes[m.id];
                  const live = flow?.queue[flow.index] === m.id;
                  const status = live ? (flow?.phase === 'rec' ? 'gravando' : 'prepara')
                    : t.kind === 'ready' ? 'pronta' : t.kind === 'processing' ? 'tratando' : t.kind === 'captured' ? 'gravada' : t.kind === 'failed' ? 'falhou' : 'falta';
                  const led = t.kind === 'ready' && !live ? 'is-on-green' : live || t.kind === 'processing' || t.kind === 'captured' ? 'is-on-amber' : '';
                  return (
                    <button
                      key={m.id}
                      role="tab"
                      aria-selected={mode === m.id}
                      className={`console-key h-10 px-2 flex items-center gap-2 text-left ${mode === m.id ? 'is-lit-amber' : ''}`}
                      onClick={() => setMode(m.id)}
                      disabled={!!flow || !!batch}
                    >
                      <span className={`console-led is-lg shrink-0 ${led}`} />
                      <span className="flex flex-col leading-none min-w-0">
                        <span className="text-[13px]">{m.label}</span>
                        <span className={`text-[9px] uppercase tracking-wider mt-0.5 ${mode === m.id ? 'text-black/60' : t.kind === 'failed' ? 'text-logic-lcd-red' : 'text-logic-text-muted'}`}>{status}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Como falar e o texto */}
            <div>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="console-legend shrink-0">LEIA ASSIM</span>
                <span className="text-[11px] text-logic-lcd-amber leading-tight">{current.how}</span>
              </div>
              <div className="console-display relative px-3.5 py-3 min-h-[118px] flex items-center">
                <p className={`font-stage text-[19px] leading-snug text-logic-lcd-text ${flowCount !== null ? 'pr-14 opacity-70' : ''}`}>{current.text}</p>
                {flowCount !== null && (
                  <span className="absolute top-2 right-3 flex flex-col items-center" role="status" aria-label={inputReady ? `Começa em ${flowCount}` : 'Abrindo a entrada'}>
                    <span className="console-legend">{inputReady ? 'PREPARA' : 'ABRINDO'}</span>
                    <span className="console-readout text-logic-lcd-amber text-[34px] leading-none mt-1">{inputReady ? flowCount : '-'}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Gravar, cronômetro e medidor */}
            <div className="flex items-center gap-3">
              {flow ? (
                <button
                  className={`console-key h-11 w-[132px] shrink-0 flex items-center justify-center gap-1.5 text-sm ${recording ? 'is-lit-red' : ''}`}
                  onClick={nextTake}
                  disabled={!recording || elapsed < MIN_RECORD_S}
                >
                  {lastInFlow ? <><Square size={13} /> Terminar</> : <>Próximo modo <ChevronRight size={14} /></>}
                </button>
              ) : (
                <button
                  className="console-key is-lit-amber h-11 w-[132px] shrink-0 flex items-center justify-center gap-2 text-sm"
                  onClick={() => startFlow(missing.length > 0 ? missing.map((m) => m.id) : [mode])}
                  disabled={!canRecord}
                >
                  <Mic size={14} /> {missing.length === 0 ? 'Regravar' : started ? 'Continuar' : 'Gravar'}
                </button>
              )}
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`console-lamp shrink-0 ${recording ? 'is-on' : ''}`} />
                  <span className={`console-readout text-[11px] whitespace-nowrap ${tooLong ? 'text-logic-lcd-red' : longTake ? 'text-logic-lcd-amber' : 'text-logic-lcd-text'}`}>{num(elapsed)} s</span>
                  <span className="ml-auto" />
                  {(['baixo', 'bom', 'estourando'] as const).map((z) => (
                    <span
                      key={z}
                      className={`font-stage text-[10px] font-bold uppercase tracking-wider ${
                        zone === z ? (z === 'bom' ? 'text-logic-lcd-green' : z === 'baixo' ? 'text-logic-lcd-amber' : 'text-logic-lcd-red') : 'text-white/15'
                      }`}
                    >
                      {z}
                    </span>
                  ))}
                </div>
                <div className="flex gap-[3px] px-1.5 py-1.5 rounded-[3px] bg-black/60 border border-black" aria-label="Nível da entrada">
                  {Array.from({ length: METER_LEDS }, (_, i) => (
                    <span key={i} className={`h-2 flex-1 rounded-[1px] ${i < meter.lit ? ledColor(i) : 'bg-white/[0.06]'}`} />
                  ))}
                </div>
              </div>
            </div>

            {/* Dicas; durante a gravação, a posição na sequência e o Cancelar */}
            {flow ? (
              <div className="flex items-center gap-3 border-t border-black/50 pt-2 min-h-[50px]">
                <span className={`text-[11px] leading-snug flex-1 ${tooLong ? 'text-logic-lcd-red font-bold' : 'text-logic-text-dim'}`} role={tooLong ? 'alert' : undefined}>
                  {flow.queue.length > 1 ? `Modo ${flow.index + 1} de ${flow.queue.length}. ` : 'Regravando só este modo. '}
                  {tooLong ? 'Longa demais, termine a frase.' : 'O ideal é de 6 a 10 s de fala.'}
                </span>
                <button className="console-key h-8 px-3 flex items-center gap-1.5 text-xs shrink-0" onClick={cancelFlow} title="Descarta só a tomada em andamento (Esc)">
                  <X size={12} /> Cancelar
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-black/50 pt-2 min-h-[50px]">
                {TIPS.map((t) => (
                  <span key={t} className="flex items-start gap-1.5 text-[11px] text-logic-text-dim leading-snug">
                    <span className="console-led is-on-green mt-[5px] shrink-0" /> {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ---------- Direita: resultado, detalhes e salvar ---------- */}
          <div className="flex flex-col gap-3 min-w-0">
            <div className="flex flex-col gap-1.5 flex-1">
              <div className="flex items-center gap-2">
                <span className="console-legend">MODO {current.label.toUpperCase()}</span>
                <span className="console-legend ml-auto">TRATAMENTO</span>
              </div>
              <div className="flex items-center gap-2 justify-end">
                {CHAIN.map((c, i) => {
                  const on = take.kind === 'ready' || (!!batch && batch.mode === mode && batch.percent >= ((i + 1) / (CHAIN.length + 1)) * 100);
                  return (
                    <span key={c} className="flex items-center gap-1 font-stage text-[10px] text-logic-text-muted">
                      <span className={`console-led ${on ? 'is-on-green' : ''}`} /> {c}
                    </span>
                  );
                })}
              </div>

              <div className="console-display px-3 py-2.5 min-h-[214px] flex flex-col">
                {batch ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2.5">
                    <Loader2 size={22} className="animate-spin text-logic-lcd-amber" />
                    <p className="text-xs text-logic-lcd-text">Tratando {batchLabel} ({batch.done + 1} de {batch.total})</p>
                    <div className="w-full h-1.5 rounded-full bg-black/60 overflow-hidden" role="progressbar" aria-valuenow={batchPercent} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-logic-lcd-amber transition-all duration-300" style={{ width: `${Math.max(3, batchPercent)}%` }} />
                    </div>
                    <p className="text-[11px] text-logic-lcd-text/60 text-center leading-snug">{batch.message}</p>
                  </div>
                ) : take.kind === 'failed' ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
                    <AlertTriangle size={22} className="text-logic-lcd-red" />
                    <p className="text-xs text-logic-lcd-text leading-snug max-w-[260px]">{take.message}</p>
                    <p className="text-[11px] text-logic-lcd-text/60 leading-snug">Os outros modos não foram perdidos.</p>
                  </div>
                ) : take.kind === 'captured' && !flow ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
                    <Check size={22} className="text-logic-lcd-green" />
                    <p className="text-xs text-logic-lcd-text/70 leading-snug max-w-[240px]">Tomada guardada. O tratamento roda quando os modos que faltam forem gravados.</p>
                  </div>
                ) : take.kind !== 'ready' || flow ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
                    <Mic size={22} className={recording ? 'text-logic-lcd-red' : 'text-white/20'} />
                    <p className="text-xs text-logic-lcd-text/70 leading-snug max-w-[240px]">
                      {recording
                        ? (lastInFlow ? 'Gravando. Leia o texto inteiro e aperte Terminar.' : 'Gravando. Leia o texto inteiro e aperte Próximo modo.')
                        : flow
                          ? 'Prepare a voz do jeito indicado. A gravação começa no fim da contagem.'
                          : 'Aperte Gravar uma vez: a janela conduz Normal, Calma e Forte. Cada tomada ideal tem de 6 a 10 segundos.'}
                    </p>
                  </div>
                ) : null}

                {take.kind === 'ready' && !batch && !flow && <VoiceDetails report={take.report} />}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  className={`console-key h-8 px-3 flex items-center gap-1.5 text-xs ${playing === mode ? 'is-lit-green' : ''}`}
                  onClick={() => play(mode)}
                  disabled={take.kind !== 'ready' || busy}
                >
                  {playing === mode ? <Square size={11} /> : <Play size={12} />} Ouvir tratada
                </button>
                <button
                  className="console-key h-8 px-3 flex items-center gap-1.5 text-xs"
                  onClick={() => startFlow([mode])}
                  disabled={take.kind === 'empty' || !canRecord}
                  title="Grava de novo só este modo"
                >
                  <RotateCcw size={12} /> Regravar {current.label}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-black/50 pt-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
                <label className="flex flex-col gap-1 min-w-0">
                  <span className="console-legend">NOME DA VOZ</span>
                  <input
                    className="h-8 bg-logic-bg-deep border border-black rounded px-2 text-sm text-logic-text focus:outline-none focus:border-logic-lcd-amber"
                    value={name}
                    maxLength={40}
                    placeholder="Ex.: Pastor João"
                    onChange={(e) => setName(e.target.value)}
                    disabled={saving}
                  />
                </label>
                <div className="flex gap-1" role="group" aria-label="Tipo de voz">
                  {(['masculina', 'feminina'] as const).map((g) => (
                    <button key={g} className={`console-key h-8 px-2.5 text-xs ${gender === g ? 'is-lit-amber' : ''}`} onClick={() => setGender(g)} disabled={saving} aria-pressed={gender === g}>
                      {g === 'masculina' ? 'Masculina' : 'Feminina'}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                role="checkbox"
                aria-checked={consent}
                className={`console-key w-full min-h-8 px-2.5 py-1.5 flex items-center gap-2 text-left text-[11px] leading-snug ${consent ? 'is-lit-amber' : ''}`}
                onClick={() => setConsent((c) => !c)}
                disabled={saving}
              >
                <span className={`console-led shrink-0 ${consent ? 'is-on-green' : ''}`} />
                <span>Esta é a minha voz, gravada agora por mim.</span>
              </button>

              {savedVoice ? (
                <div className="flex items-center gap-2">
                  <span className="console-led is-on-amber animate-pulse shrink-0" />
                  <span className="text-[11px] text-logic-lcd-amber leading-snug flex-1" role="status">
                    Voz salva. A contagem está sendo preparada em segundo plano.
                  </span>
                  <button className="console-key is-lit-amber h-10 px-5 flex items-center gap-2 text-sm" onClick={finish}>
                    <Check size={14} /> Concluir
                  </button>
                </div>
              ) : confirmDiscard ? (
                <div className="flex items-center gap-2" role="alertdialog" aria-label="Descartar as tomadas gravadas?">
                  <span className="text-[11px] text-logic-lcd-amber leading-snug flex-1">Descartar as tomadas gravadas?</span>
                  <button className="console-key is-lit-amber h-10 px-3 text-xs" onClick={() => setConfirmDiscard(false)} autoFocus>Voltar</button>
                  <button className="console-key h-10 px-3 text-xs" onClick={onClose}>Descartar</button>
                </div>
              ) : (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-logic-text-muted leading-snug flex-1">
                  {allReady
                    ? 'Os 3 modos estão prontos.'
                    : `${readyCount} de 3 modos prontos. Salvar exige os três.`}
                </span>
                <button className="console-key is-lit-amber h-10 px-5 flex items-center gap-2 text-sm" onClick={() => { void save(); }} disabled={!canSave}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar voz
                </button>
              </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 pb-3 flex flex-col gap-1">
          {error && <p className="text-xs text-logic-lcd-red leading-snug">{error}</p>}
          <p className="text-[10px] text-logic-text-muted leading-snug border-t border-black/50 pt-2">
            A voz fica guardada só neste computador e fala sem internet. Não dá para importar áudio: a voz é gravada aqui, para ninguém clonar a voz de outra pessoa.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Painel de detalhes da voz depois do tratamento. */
function VoiceDetails({ report }: { report: CloneReport }) {
  const a = report.analysis;
  const durOk = report.seconds >= 6 && report.seconds <= 10.5;
  const noiseTone = report.noiseDb <= -45 ? 'ok' : report.noiseDb <= -35 ? 'mid' : 'bad';
  const tone = (t: 'ok' | 'mid' | 'bad') => (t === 'ok' ? 'text-logic-lcd-green' : t === 'mid' ? 'text-logic-lcd-text' : 'text-logic-lcd-amber');
  const rows: Array<{ k: string; v: string; t: 'ok' | 'mid' | 'bad' }> = [
    { k: 'Duração', v: `${num(report.seconds)} s${durOk ? '' : ' (ideal 6 a 10 s)'}`, t: durOk ? 'ok' : 'bad' },
    { k: 'Tom', v: a?.pitchHz ? `${Math.round(a.pitchHz)} Hz${a.range ? ` · ${a.range}` : ''}` : 'não medido', t: 'mid' },
    { k: 'Volume', v: a ? `${num(a.loudnessDb)} dB` : '-', t: 'mid' },
    { k: 'Pico', v: a ? `${num(a.peakDb)} dB${report.clipped ? ' · estourou' : ''}` : '-', t: report.clipped ? 'bad' : 'mid' },
    { k: 'Brilho', v: a?.brightness ?? '-', t: 'mid' },
    { k: 'Ritmo', v: a?.wordsPerMinute ? `${Math.round(a.wordsPerMinute)} palavras/min` : 'não medido', t: 'mid' },
    { k: 'Ruído de fundo', v: `${num(report.noiseDb, 0)} dB${report.denoised ? ' · removido' : ''}`, t: noiseTone },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="console-legend">DETALHES DA VOZ</span>
        {a?.range && (
          <div className="ml-auto flex gap-[2px]" aria-label={`Região ${a.range}`}>
            {(['grave', 'média', 'aguda'] as const).map((r) => (
              <span key={r} className={`font-stage text-[9px] uppercase px-1.5 py-[1px] rounded-[2px] ${a.range === r ? 'bg-logic-lcd-amber text-black' : 'bg-white/[0.06] text-white/30'}`}>{r}</span>
            ))}
          </div>
        )}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-[3px] text-[11.5px]">
        {rows.map((r) => (
          <div key={r.k} className="contents">
            <dt className="text-logic-lcd-text/55">{r.k}</dt>
            <dd className={`text-right tabular-nums truncate ${tone(r.t)}`}>{r.v}</dd>
          </div>
        ))}
      </dl>
      {report.warnings.length > 0 ? (
        <ul className="text-[11px] text-logic-lcd-amber leading-snug flex flex-col gap-0.5">
          {report.warnings.slice(0, 3).map((w) => (
            <li key={w} className="flex items-start gap-1.5"><AlertTriangle size={11} className="mt-[2px] shrink-0" /> {w}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-logic-lcd-green flex items-center gap-1.5"><Check size={12} /> Tomada boa para clonar.</p>
      )}
    </div>
  );
}
