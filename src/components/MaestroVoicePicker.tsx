import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Mic, Play, Square, Trash2 } from 'lucide-react';
import {
  canGenerate, claimPreview, cloneBaseId, cloneMode, cloneVoiceId, forgetVoiceAudio, isCloneVoice, isOfferedVoice, isPreviewCurrent, playPreview, refreshVoicePacks, rememberCloneNames,
  stopPreview, subscribePreview, voiceDemo, voiceLabel, type CloneMode,
} from '@/lib/maestroVoice';
import { DEFAULT_READY_VOICE, READY_INTENSITIES, offeredReadyVoices, readyVoice, readyVoiceId, subscribeVoicePacks, voiceHasMode, voicePacksVersion } from '@/lib/maestroCues';
import { friendlyError } from '@/lib/friendlyError';
import MaestroCloneDialog from '@/components/MaestroCloneDialog';
import type { ClonedVoice } from '@/lib/localNetwork';
import type { VoicePitch } from '@/types';
import { useStore } from '@/store';

interface MaestroVoicePickerProps {
  voice: string;
  onChoose: (voice: string) => void;
  /** Tom escolhido: o exemplo (▶) toca nele, para ouvir também o grave e o agudo. */
  pitch?: VoicePitch;
  /** Largura do rótulo da esquerda, para alinhar com as outras linhas da janela. */
  labelClass?: string;
  /**
   * Fala selecionada na janela: quem abriu o seletor toca ESSA fala na voz nova (ou avisa que ela
   * não existe lá), e o exemplo fica só no botão de tocar.
   */
  cueText?: string;
}

/**
 * Atributo da janela de clonar (aberta por cima): a janela do "+" não fecha com clique ou Esc
 * enquanto ela estiver na tela.
 */
export const SUBDIALOG_ATTR = 'data-maestro-subjanela';

/** Há uma janela por cima (clonar voz) que cuida do próprio Esc e dos cliques? */
export function subdialogOpen(target?: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(`[${SUBDIALOG_ATTR}]`)) return true;
  return !!document.querySelector(`[${SUBDIALOG_ATTR}]`);
}

type CloneEntry = ClonedVoice & { modes?: CloneMode[] };

const MODE_LABELS: ReadonlyArray<{ id: CloneMode; label: string; hint: string }> = [
  { id: 'calma', label: 'Calma', hint: 'Voz baixa e tranquila, para momentos suaves' },
  { id: 'normal', label: 'Normal', hint: 'Firme e clara, voz de palco' },
  { id: 'forte', label: 'Forte', hint: 'Empolgada, chamando a banda por cima do som' },
];

function modesOf(v: CloneEntry | undefined): CloneMode[] {
  return v?.modes?.length ? v.modes : ['normal'];
}

const PLAYING_MSG = 'Com a música tocando o exemplo não sai, para não cair no PA.';

type DemoState = { id: string; state: 'loading' | 'playing' } | null;

interface VoiceChipProps {
  label: React.ReactNode;
  title: string;
  selected: boolean;
  onChoose: () => void;
  demo: 'loading' | 'playing' | null;
  onDemo: () => void;
  demoDisabled: string | null;
  /** Tecla de apagar à direita (vozes clonadas). */
  onRemove?: () => void;
  className?: string;
}

/** Uma voz: o ▶ toca o exemplo (sem escolher); o nome escolhe a voz (o Maestro IA também toca o exemplo). */
function VoiceChip({ label, title, selected, onChoose, demo, onDemo, demoDisabled, onRemove, className = '' }: VoiceChipProps) {
  return (
    <div className={`console-key flex items-stretch h-7 min-w-0 ${selected ? 'is-lit-green' : ''} ${className}`}>
      <button
        className="shrink-0 w-6 flex items-center justify-center border-r border-black/30 disabled:opacity-40 disabled:pointer-events-none"
        onClick={onDemo}
        disabled={!!demoDisabled}
        title={demoDisabled ?? (demo === 'playing' ? 'Parar o exemplo' : 'Ouvir um exemplo desta voz (antes de gerar)')}
        aria-label={demo === 'playing' ? 'Parar o exemplo' : 'Ouvir um exemplo desta voz'}
      >
        {demo === 'loading' ? <Loader2 size={10} className="animate-spin" /> : demo === 'playing' ? <Square size={9} /> : <Play size={10} />}
      </button>
      <button
        className="flex-1 min-w-0 px-1.5 text-[11px] truncate text-left"
        onClick={onChoose}
        aria-pressed={selected}
        title={title}
      >
        {label}
      </button>
      {onRemove && (
        <button
          className="shrink-0 w-6 flex items-center justify-center border-l border-black/30 opacity-60 hover:opacity-100"
          onClick={onRemove}
          title="Apagar esta voz clonada"
          aria-label="Apagar esta voz clonada"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}

/**
 * Escolha da voz, igual no "+" e na contagem: Maestro 1 (que não pode ser apagado), Maestro 2 e
 * Maestro 3 (cada um só com áudio disponível), em Calma, Normal ou Forte, e as vozes que o diretor
 * clonou (Minhas). Cada voz tem um ▶ para ouvir um exemplo. Escolher só escolhe: nada é gerado.
 * Nas vozes prontas, sem fala selecionada, escolher já toca o exemplo.
 */
export default function MaestroVoicePicker({ voice, onChoose, pitch, labelClass = 'w-12', cueText }: MaestroVoicePickerProps) {
  const [demo, setDemo] = useState<DemoState>(null);
  const [demoMsg, setDemoMsg] = useState<{ error: boolean; text: string } | null>(null);
  // número de dono da prévia enquanto o exemplo carrega ou toca (0 = nenhum)
  const demoOwner = useRef(0);
  const [clones, setClones] = useState<CloneEntry[]>([]);
  const [cloning, setCloning] = useState(false);
  const [removing, setRemoving] = useState<CloneEntry | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const canClone = !!window.vsDesktop?.maestroCloneList;

  const loadClones = useCallback(async (): Promise<CloneEntry[]> => {
    const list = window.vsDesktop?.maestroCloneList;
    if (!list) return [];
    try {
      const got = (await list()) as CloneEntry[];
      rememberCloneNames(got);
      setClones(got);
      return got;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => { void loadClones(); }, [loadClones]);
  // pacote instalado com a janela aberta: a voz aparece sem reabrir
  useSyncExternalStore(subscribeVoicePacks, voicePacksVersion);
  useEffect(() => { void refreshVoicePacks(); }, []);
  // fechou a janela: o exemplo para
  useEffect(() => () => { stopPreview(); }, []);
  // outro toque assumiu a prévia, ou ela foi parada: o exemplo pendente não entra mais
  useEffect(() => subscribePreview(() => {
    if (!demoOwner.current || isPreviewCurrent(demoOwner.current)) return;
    demoOwner.current = 0;
    setDemo(null);
  }), []);
  // mudou o tom: o exemplo que estava tocando para (o próximo ▶ já sai no tom novo)
  useEffect(() => { stopPreview(); setDemo(null); }, [pitch]);

  const playDemo = async (id: string) => {
    // ▶ de novo na voz que está tocando (ou carregando): para
    if (demo?.id === id) { stopPreview(); setDemo(null); return; }
    // com a música no ar nem abre os arquivos: o processamento não disputa com o áudio
    if (useStore.getState().transport.isPlaying) {
      setDemoMsg({ error: false, text: PLAYING_MSG });
      return;
    }
    const owner = claimPreview();
    demoOwner.current = owner;
    setDemo({ id, state: 'loading' });
    setDemoMsg(null);
    try {
      const out = await voiceDemo(id, pitch);
      if (!isPreviewCurrent(owner)) return;
      if (useStore.getState().transport.isPlaying) {
        demoOwner.current = 0;
        setDemo(null);
        setDemoMsg({ error: false, text: PLAYING_MSG });
        return;
      }
      setDemo({ id, state: 'playing' });
      if (out.note) setDemoMsg({ error: false, text: out.note });
      playPreview(out.buffer, () => { if (demoOwner.current === owner) { demoOwner.current = 0; setDemo(null); } }, owner);
    } catch (err) {
      if (!isPreviewCurrent(owner)) return;
      demoOwner.current = 0;
      setDemo(null);
      if (useStore.getState().transport.isPlaying) setDemoMsg({ error: false, text: PLAYING_MSG });
      else setDemoMsg({ error: true, text: friendlyError(err, 'Não foi possível tocar o exemplo desta voz.') });
    }
  };

  const confirmRemove = async () => {
    const v = removing;
    const remove = window.vsDesktop?.maestroCloneRemove;
    if (!v || !remove) return;
    setRemoveBusy(true);
    try {
      await remove(v.id);
      forgetVoiceAudio(v.id);
      await loadClones();
      // a voz apagada era a escolhida: volta para o Maestro IA
      if (isCloneVoice(voice) && cloneBaseId(voice) === cloneBaseId(v.id)) onChoose(DEFAULT_READY_VOICE);
      setRemoving(null);
    } catch (err) {
      setDemoMsg({ error: true, text: friendlyError(err, 'Não foi possível apagar a voz.') });
    } finally {
      setRemoveBusy(false);
    }
  };

  /**
   * Escolheu uma voz: só escolhe (não gera nada na marcação). Com fala selecionada, quem toca é a
   * janela da fala. Sem fala, a voz pronta toca o exemplo, só com a música parada: a prévia sai na
   * mesma placa da música e não pode cair no PA. Nas vozes de IA o exemplo fica no ▶.
   */
  const choose = (id: string) => {
    onChoose(id);
    if (!cueText?.trim() && readyVoice(id) && demo?.id !== id && !useStore.getState().transport.isPlaying) void playDemo(id);
  };

  const demoOf = (id: string) => (demo?.id === id ? demo.state : null);
  const demoBlocked = (id: string) => (canGenerate(id) ? null : 'O exemplo das vozes de IA só toca no app do Mac.');
  const keyTone = (on: boolean) => `console-key h-6 text-[10px] ${on ? 'is-lit-green' : ''}`;

  // vozes clonadas (nas duas janelas) e, na contagem, a voz pronta Maestro
  const ready = readyVoice(voice);
  const readyChoices = offeredReadyVoices();
  const offered = !!ready && readyChoices.some((v) => v.dir === ready.dir);
  // os modos valem para a voz pronta escolhida; vindo de uma voz clonada, para o Maestro IA
  const modeVoice = (offered && readyChoices.find((v) => v.dir === ready.dir)) || readyChoices[0];
  const intensity = offered ? ready.intensity : 'normal';
  const selectedClone = isCloneVoice(voice) ? clones.find((c) => cloneBaseId(c.id) === cloneBaseId(voice)) : undefined;
  const cloneSelectedId = isCloneVoice(voice) ? cloneBaseId(voice) : null;
  // clone que não está mais na lista (apagado em outro lugar) ainda conta como escolhido até a lista chegar
  const cloneOk = isCloneVoice(voice) && isOfferedVoice(voice) && (!!selectedClone || clones.length === 0);
  const legacy = !!voice && !offered && !cloneOk;
  const modeNow = isCloneVoice(voice) ? cloneMode(voice) : 'normal';
  const recorded = modesOf(selectedClone);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className={`console-legend ${labelClass} shrink-0`} title="Vozes prontas: falas gravadas, tocam na hora">Voz</span>
        <div className={`flex-1 grid gap-1 min-w-0 ${readyChoices.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}>
          {readyChoices.map((v) => {
            const id = readyVoiceId(v, voiceHasMode(v, intensity) ? intensity : 'normal');
            return (
              <VoiceChip
                key={v.id}
                label={<>{v.label}<span className="opacity-60"> {v.fallback === 'feminina' ? '♀' : '♂'}</span></>}
                title={`${v.label}: falas gravadas, tocam sem internet.`}
                selected={offered && ready?.dir === v.dir}
                onChoose={() => choose(id)}
                demo={demoOf(id)}
                onDemo={() => { void playDemo(id); }}
                demoDisabled={null}
              />
            );
          })}
        </div>
      </div>
      {!cloneSelectedId && (
        <div className="flex items-center gap-2">
          <span className={`console-legend ${labelClass} shrink-0`} title="Intensidade da voz">Intens.</span>
          <div className="flex-1 grid grid-cols-3 gap-1" role="group" aria-label="Intensidade da voz">
            {READY_INTENSITIES.map((l) => (
              <button
                key={l.id}
                className={keyTone(offered && intensity === l.id)}
                onClick={() => choose(readyVoiceId(modeVoice, l.id))}
                disabled={!voiceHasMode(modeVoice, l.id)}
                aria-pressed={offered && intensity === l.id}
                title={voiceHasMode(modeVoice, l.id) ? l.hint : `A voz ${modeVoice.label} ainda não tem este modo`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {canClone && (
        <div className="flex items-start gap-2">
          <span className={`console-legend ${labelClass} shrink-0 pt-2`} title="Vozes que você clonou com a sua gravação">Minhas</span>
          <div className="flex-1 grid grid-cols-2 gap-1 min-w-0">
            {clones.map((c) => (
              <VoiceChip
                key={c.id}
                label={<>{c.name}<span className="opacity-60"> {c.gender === 'feminina' ? '♀' : '♂'}</span></>}
                title={`${c.name}: voz clonada (${modesOf(c).length} ${modesOf(c).length === 1 ? 'modo gravado' : 'modos gravados'})`}
                selected={cloneSelectedId === cloneBaseId(c.id)}
                onChoose={() => onChoose(cloneVoiceId(c.id, modesOf(c).includes(modeNow) ? modeNow : 'normal'))}
                demo={demoOf(c.id)}
                onDemo={() => { void playDemo(c.id); }}
                demoDisabled={demoBlocked(c.id)}
                onRemove={() => setRemoving(c)}
              />
            ))}
            <button
              className="console-key is-lit-amber h-7 px-2 text-[11px] flex items-center justify-center gap-1.5"
              onClick={() => setCloning(true)}
              title="Grave a sua voz em três modos de fala e use como voz do Maestro"
            >
              <Mic size={11} /> Clonar minha voz
            </button>
          </div>
        </div>
      )}

      {removing && (
        <div className="flex items-center gap-2 -mt-1">
          <span className={`${labelClass} shrink-0`} />
          <div className="flex-1 flex items-center gap-1.5 text-[10px] text-logic-text-dim min-w-0">
            <span className="flex-1 min-w-0 truncate">Apagar a voz {removing.name}? Não dá para desfazer.</span>
            <button className="console-key is-lit-red h-6 px-2 text-[10px]" onClick={() => { void confirmRemove(); }} disabled={removeBusy}>
              {removeBusy ? 'Apagando...' : 'Apagar'}
            </button>
            <button className="console-key h-6 px-2 text-[10px]" onClick={() => setRemoving(null)} disabled={removeBusy}>Manter</button>
          </div>
        </div>
      )}

      {/* Modo de fala da voz clonada: cada um é uma gravação à parte; o que não foi gravado fica apagado */}
      {cloneSelectedId && (
        <div className="flex items-center gap-2">
          <span className={`console-legend ${labelClass} shrink-0`} title="Modo de fala da voz clonada">Intens.</span>
          <div className="flex-1 grid grid-cols-3 gap-1" role="group" aria-label="Modo de fala da voz clonada">
            {MODE_LABELS.map((m) => {
              const has = recorded.includes(m.id);
              return (
                <button
                  key={m.id}
                  className={keyTone(modeNow === m.id)}
                  onClick={() => { if (m.id !== modeNow) onChoose(cloneVoiceId(cloneSelectedId, m.id)); }}
                  disabled={!has && m.id !== modeNow}
                  aria-pressed={modeNow === m.id}
                  title={has ? m.hint : 'Este modo não foi gravado nesta voz'}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {legacy && (
        <div className="flex gap-2 -mt-1">
          <span className={`${labelClass} shrink-0`} />
          <span className="text-[10px] text-logic-text-muted">
            {ready && !ready.embedded ? `A voz ${ready.label} não está neste computador` : `Voz antiga: ${voiceLabel(voice)}`}. O áudio continua na faixa. Para refazer, escolha o Maestro IA ou uma voz sua.
          </span>
        </div>
      )}

      {demoMsg && (
        <div className="flex gap-2 -mt-1">
          <span className={`${labelClass} shrink-0`} />
          <div className={`flex-1 text-[10px] leading-snug ${demoMsg.error ? 'text-logic-lcd-red' : 'text-logic-lcd-amber'}`}>{demoMsg.text}</div>
        </div>
      )}

      {cloning && createPortal(
        <div {...{ [SUBDIALOG_ATTR]: '' }}>
          <MaestroCloneDialog
            onClose={() => setCloning(false)}
            onSaved={(saved) => {
              setCloning(false);
              // mesmo nome regrava a voz: números, prévias e exemplo antigos saem da memória
              forgetVoiceAudio(saved.id);
              void loadClones().then(() => onChoose(cloneBaseId(saved.id)));
            }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
