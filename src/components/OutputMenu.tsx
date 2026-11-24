import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store';
import { useHoverDismiss } from '@/lib/useHoverDismiss';
import { interfaceMissing, masterReservedOutputs, resolveMasterOutput } from '@/lib/outputRoute';
import {
  isCurrentOutput, isTimecodeTrackId, lastOutput, masterOutputOptions, masterSilenced, NO_OUTPUT, OFF_LABEL, outputLabel, outputOptions,
  type OutputOption,
} from '@/lib/timecode';
import type { Track } from '@/types';

const MENU_W = 128;
const MARGIN = 8;

type Place = { left: number; top?: number; bottom?: number; maxHeight: number };

// A lista fica sempre dentro da janela: abre para baixo se couber, senão para cima
// (o mixer fica no rodapé do programa), e rola por dentro quando há muitas saídas.
function placeMenu(btn: DOMRect): Place {
  const below = window.innerHeight - btn.bottom - MARGIN;
  const above = btn.top - MARGIN;
  const wanted = Math.max(260, Math.round(window.innerHeight * 0.6));
  const left = Math.max(MARGIN, Math.min(btn.left, window.innerWidth - MENU_W - MARGIN));
  if (below >= 260 || below >= above) return { left, top: btn.bottom + 2, maxHeight: Math.min(wanted, below) };
  return { left, bottom: window.innerHeight - btn.top + 2, maxHeight: Math.min(wanted, above) };
}

interface PickerProps {
  label: string;
  title: string;
  tone: string;
  /** Texto em fonte normal (o "Desligado") em vez da fonte de número. */
  plainText?: boolean;
  /** Mostra as abas Mono e Estéreo (o timecode é sempre mono). */
  modes: boolean;
  startStereo: boolean;
  count: number;
  options: (stereo: boolean) => OutputOption[];
  isCurrent: (opt: OutputOption) => boolean;
  onPick: (opt: OutputOption) => void;
  /** Peça já existente que abre a lista ao clicar (o display do Master), no lugar do botão. */
  children?: ReactNode;
}

/** Botão e lista de saídas: o mesmo nos canais e no Master. */
function OutputPicker({ label, title, tone, plainText = false, modes, startStereo, count, options, isCurrent, onPick, children }: PickerProps) {
  const [open, setOpen] = useState(false);
  // Lista mostrada no menu: saídas mono ou pares estéreo
  const [stereoView, setStereoView] = useState(false);
  const buttonRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  // Altura travada enquanto a lista está aberta: trocar Mono ↔ Estéreo não encolhe a lista.
  // Encolher tirava o mouse de cima dela (a lista abre para cima) e ela fechava sozinha.
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const hover = useHoverDismiss(open, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    setPlace(placeMenu(buttonRef.current.getBoundingClientRect()));
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !place) { setLockedHeight(null); return; }
    if (listRef.current) setLockedHeight(listRef.current.offsetHeight);
  }, [open, place]);

  // abre já mostrando a saída atual, mesmo lá embaixo da lista
  useEffect(() => {
    if (!open || !place) return;
    listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, place, stereoView]);

  // a lista fica presa na tela: rolar o mixer ou mudar o tamanho da janela fecha ela
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onScroll = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) close(); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hoverProps = {
    onMouseEnter: hover.cancel,
    onMouseLeave: () => { if (open) hover.schedule(); },
  };

  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!open) setStereoView(startStereo);
    setOpen(!open);
  };

  return (
    <>
      {children ? (
        // "contents": o display continua sendo peça direta do canal, com a mesma altura de antes
        <div
          ref={(el) => { buttonRef.current = (el?.firstElementChild as HTMLElement | null) ?? null; }}
          {...hoverProps}
          role="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={title}
          title={title}
          className="contents [&>*]:cursor-pointer [&>*]:transition [&>*:hover]:brightness-125"
          onClick={toggle}
        >
          {children}
        </div>
      ) : (
        <button
          ref={(el) => { buttonRef.current = el; }}
          {...hoverProps}
          className={`w-full text-2xs ${plainText ? 'font-sans font-semibold' : 'font-mono'} bg-logic-lcd-bg border rounded-sm px-1 py-0.5 truncate text-center hover:border-logic-accent transition-colors ${tone}`}
          onClick={toggle}
          title={title}
        >
          {label}
        </button>
      )}
      {open && place && createPortal(
          <div
            ref={listRef}
            {...hoverProps}
            className="fixed z-[400] w-32 overflow-y-auto overscroll-contain logic-scroll bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded text-2xs animate-[fadeIn_120ms_ease-out]"
            style={{ left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight, height: lockedHeight ?? undefined }}
            onWheel={(e) => e.stopPropagation()}
          >
            {modes && (
              <div className="sticky top-0 z-10 flex gap-0.5 p-1 bg-logic-bg-panel border-b border-logic-border-dark">
                {[false, true].map((st) => (
                  <button
                    key={st ? 'stereo' : 'mono'}
                    className={`flex-1 rounded-sm py-0.5 text-[9px] font-bold uppercase tracking-wide transition-colors
                      ${stereoView === st ? 'bg-logic-accent text-white' : 'text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light'}`}
                    onClick={(e) => { e.stopPropagation(); setStereoView(st); }}
                    title={st ? 'Pares de saída: L na primeira, R na segunda' : 'Uma saída só, com L e R somados'}
                  >
                    {st ? 'Estéreo' : 'Mono'}
                  </button>
                ))}
              </div>
            )}
            {count <= 2 && (
              <p className="px-2 py-1.5 text-logic-text-muted leading-snug border-b border-logic-border-dark">
                Esta saída tem só 2 canais. Escolha uma interface com mais saídas em Dispositivo de Áudio.
              </p>
            )}
            {options(stereoView).map((opt) => (
              <button
                key={`${opt.value}-${opt.stereo}`}
                data-current={isCurrent(opt)}
                disabled={opt.disabled}
                className={`w-full flex items-center justify-between gap-2 text-left px-2 py-1 transition-colors
                  ${opt.disabled ? 'text-logic-text-muted/50 cursor-not-allowed' : 'hover:bg-logic-accent hover:text-white'}
                  ${isCurrent(opt) ? 'text-logic-accent' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (opt.disabled) return;
                  onPick(opt);
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {opt.hint && <span className="text-[9px] uppercase tracking-wide opacity-70">{opt.hint}</span>}
              </button>
            ))}
          </div>,
          document.body,
      )}
    </>
  );
}

export default function OutputMenu({ track }: { track: Track }) {
  const tracks = useStore((s) => s.tracks);
  const count = useStore((s) => s.outputChannelCount);
  const setOutputChannel = useStore((s) => s.setOutputChannelLinked);
  const masterChannel = useStore((s) => s.masterOutputChannel);
  const masterStereo = useStore((s) => s.masterOutputStereo);
  const magic = useStore((s) => s.magicRoutingActive);
  const missing = useStore((s) => interfaceMissing(s.audioInterface, s.audioInterfaceConnected));
  const masterInput = { channel: masterChannel, stereo: masterStereo, magic, outputCount: count, interfaceMissing: missing };
  const realMaster = resolveMasterOutput(masterInput);

  const isTc = isTimecodeTrackId(track.id);
  // placa menor: o Master voltou para 1/2 em cima da saída do timecode, e o LTC cala
  const tcCut = isTc && track.outputChannel > 0
    && (track.outputChannel === realMaster.channel || (realMaster.stereo && track.outputChannel === realMaster.channel + 1));
  // faixa de música sem saída = desligada (não toca em lugar nenhum)
  const off = !isTc && track.outputChannel === NO_OUTPUT;
  const current = off ? OFF_LABEL : outputLabel(track.outputChannel, track.outputStereo);
  const pair = track.outputStereo && track.outputChannel > 0;
  // a faixa do mixer é estreita: o par estéreo aparece curto para não cortar o "/6"
  const short = pair ? `Est ${track.outputChannel}/${track.outputChannel + 1}` : current;
  const unavailable = lastOutput(track) > count;
  const unassigned = isTc && track.outputChannel === NO_OUTPUT;
  const label = unavailable || tcCut ? `${short} ?` : short;
  const tone = off
    ? 'text-logic-lcd-red border-logic-lcd-red/50'
    : unassigned || unavailable || tcCut
      ? 'text-logic-lcd-amber border-logic-lcd-amber/60'
      : isTc ? 'text-logic-lcd-green border-logic-border-dark' : 'text-logic-lcd-text border-logic-border-dark';
  const title = off
    ? 'Faixa desligada: não sai em nenhuma saída. Escolha o Master ou uma saída para voltar a tocar.'
    : tcCut
    ? `O timecode está mudo: o Master está saindo na ${current}. Escolha outra saída para o timecode.`
    : unavailable
    ? `A interface atual não tem a ${current}. ${isTc ? 'O timecode fica mudo' : 'O som vai para o Master'} até você escolher outra saída.`
    : unassigned ? 'Escolha a saída física da interface que recebe o timecode'
    : pair ? `Saída estéreo ${track.outputChannel}/${track.outputChannel + 1}: L na ${track.outputChannel}, R na ${track.outputChannel + 1}`
    : `Saída física deste canal: ${current}`;

  return (
    <OutputPicker
      label={label}
      title={title}
      tone={tone}
      plainText={off}
      modes={!isTc}
      startStereo={!isTc && !!track.outputStereo}
      count={count}
      options={(stereo) => outputOptions(track, tracks, count, stereo, masterReservedOutputs(masterInput))}
      isCurrent={(opt) => isCurrentOutput(track, opt)}
      onPick={(opt) => setOutputChannel(track.id, opt.value, opt.stereo)}
    />
  );
}

/**
 * O display do Master vira o seletor de saída: Desligado, mono ou par estéreo, igual aos canais.
 * `route` é null na saída padrão 1/2 (o display segue escrito MASTER).
 */
export function MasterOutputMenu({ children }: { children: (route: string | null) => ReactNode }) {
  const channel = useStore((s) => s.masterOutputChannel);
  const stereo = useStore((s) => s.masterOutputStereo);
  const count = useStore((s) => s.outputChannelCount);
  const missing = useStore((s) => interfaceMissing(s.audioInterface, s.audioInterfaceConnected));
  const magic = useStore((s) => s.magicRoutingActive);
  const setMasterOutput = useStore((s) => s.setMasterOutput);
  const setMasterOutputOff = useStore((s) => s.setMasterOutputOff);
  const off = useStore((s) => !!s.masterOutputOff);
  const silenced = useStore((s) => masterSilenced({
    off: !!s.masterOutputOff, magic: s.magicRoutingActive, outputCount: s.outputChannelCount,
    interfaceMissing: interfaceMissing(s.audioInterface, s.audioInterfaceConnected),
  }, s.tracks));

  const chosen = outputLabel(channel, stereo);
  const short = stereo ? `M ${channel}/${channel + 1}` : `M ${channel}`;
  const unavailable = channel + (stereo ? 1 : 0) > count;
  const real = resolveMasterOutput({ channel, stereo, magic, outputCount: count, interfaceMissing: missing });
  // "?" = a placa não deixa sair na escolhida e o som foi para 1/2
  const fellBack = (unavailable || missing) && (real.channel !== channel || real.stereo !== stereo);
  const route = silenced ? OFF_LABEL : off ? `${OFF_LABEL} ?` : channel === 1 && stereo ? null : fellBack ? `${short} ?` : short;
  const realLabel = outputLabel(real.channel, real.stereo);
  const title = silenced
    ? 'Master desligado: só os canais com saída própria tocam, e o fader do Master vira o volume geral deles (até 0 dB). Canais no Master ficam mudos. Clique para escolher uma saída e religar.'
    : off
    ? `O Master foi desligado, mas voltou na ${realLabel} para o show não ficar mudo: há som sem saída própria disponível (placa, LR mágico ou saída inexistente).`
    : unavailable
    ? `A interface atual não tem a ${chosen}. O Master sai na ${realLabel} até você escolher outra saída.`
    : missing
    ? `A interface do projeto está desconectada. O Master sai na ${realLabel} até ela voltar.`
    : magic && !stereo
    ? `Roteamento mágico ligado: precisa de L e R, então o Master sai na ${realLabel}.`
    : stereo
    ? `Saída do Master: L na ${channel}, R na ${channel + 1}. Clique para escolher outra.`
    : `Saída do Master: ${chosen}, com L e R somados. Clique para escolher outra.`;

  return (
    <OutputPicker
      label={short}
      title={title}
      tone=""
      modes
      startStereo={stereo}
      count={count}
      options={(st) => [
        { value: NO_OUTPUT, stereo: false, label: OFF_LABEL, disabled: false },
        ...masterOutputOptions(useStore.getState().tracks, count, st),
      ]}
      isCurrent={(opt) => (off ? opt.value === NO_OUTPUT : opt.value === channel && opt.stereo === stereo)}
      onPick={(opt) => (opt.value === NO_OUTPUT ? setMasterOutputOff() : setMasterOutput(opt.value, opt.stereo))}
    >
      {children(route)}
    </OutputPicker>
  );
}
