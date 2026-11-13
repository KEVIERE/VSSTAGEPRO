import { useMemo } from 'react';
import { PenLine, WifiOff, UserPlus } from 'lucide-react';
import type { LiveView, SetlistSong, SheetInfo, ShowLive, SignalStatus } from '@/lib/musicianTypes';
import { bpmAdjustToAlpha } from '@/lib/timeStretch';
import { songKeyLabel } from '@/lib/musicKey';
import { isMedleySong, partKey } from '@/lib/medleySheets';
import { isLocalClient } from '@/lib/localNetwork';
import SegmentDisplay from '@/components/SegmentDisplay';
import MetaReadout from '@/components/MetaReadout';

export function formatTime(s: number): string {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function bpmText(song: SetlistSong | null | undefined): string {
  if (!song) return '';
  if (song.baseBpm) {
    const adj = song.bpmAdjust ?? 0;
    return adj ? `${song.baseBpm} ${adj > 0 ? '+' : ''}${adj}` : `${song.baseBpm}`;
  }
  return song.bpm ? `${song.bpm}` : '';
}

function toneText(tuner: number | undefined): string {
  if (tuner === undefined) return '-';
  return tuner === 0 ? 'Orig.' : `${tuner > 0 ? '+' : ''}${tuner}`;
}

/** Tom e BPM que estão valendo agora: na música tocando, os da parte no ar (o diretor manda). */
function liveMeta(song: SetlistSong | null | undefined, live: ShowLive | null, playing: boolean) {
  if (!song) return { key: '', bpm: '' };
  const tuner = playing && typeof live?.tuner === 'number' ? live.tuner : song.tuner;
  const bpm = playing && live?.bpm ? live.bpm : song.bpm;
  return { key: songKeyLabel({ musicKey: song.musicKey, tuner }), bpm: bpm ? String(bpm) : '' };
}

/**
 * Os dois displays da Área do Músico, iguais aos do programa: Tocando (verde) e Próxima (âmbar),
 * com tom e BPM, o tempo que falta em 7 segmentos e a barra de LEDs.
 */
export function NowNextDisplays({ lv, live, currentSong, nextSong, big = false, compact = false }: {
  lv: LiveView;
  live: ShowLive | null;
  currentSong: SetlistSong | null | undefined;
  nextSong: SetlistSong | null | undefined;
  /** Modo show: letras maiores e os dois displays lado a lado (na coluna da playlist, um embaixo do outro) */
  big?: boolean;
  /** Modo show com a tela baixa (celular deitado): os mesmos displays lado a lado, mais baixos */
  compact?: boolean;
}) {
  const isPlaying = lv.isPlaying && !!currentSong;
  const nextName = isPlaying && live?.nextSliceName ? live.nextSliceName : nextSong?.name;
  const hasNext = !!nextName;
  const secondsLeft = currentSong
    ? (currentSong.duration - lv.currentTime) * bpmAdjustToAlpha(currentSong.bpmAdjust ?? 0)
    : Infinity;
  const finalCountdown = isPlaying && secondsLeft <= 10 ? Math.max(0, Math.ceil(secondsLeft)) : null;
  const progress = isPlaying ? Math.max(0, Math.min(1, lv.songProgress)) : 0;
  const now = liveMeta(currentSong, live, isPlaying);
  const next = liveMeta(nextSong, null, false);
  const name = big ? (compact ? 'text-xl' : 'text-2xl sm:text-3xl') : 'text-lg';
  const seg = big ? (compact ? 'h-6' : 'h-7 sm:h-8') : 'h-5';
  const pad = compact ? 'py-1.5' : 'py-2.5';

  return (
    <div className={`grid grid-cols-1 gap-2 ${big ? 'sm:grid-cols-2' : ''}`}>
      <div className={`console-display px-3 ${pad} flex flex-col gap-1.5 min-w-0 ${finalCountdown !== null ? '!border-logic-lcd-red/70' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`console-legend flex items-center gap-2 ${isPlaying ? '!text-logic-lcd-green' : ''}`}>
            <span className={`console-led ${isPlaying ? 'is-on-green' : ''}`} />
            Tocando
            {currentSong && live?.sliceName && <span className="px-1 rounded-[2px] border border-current text-[9px] leading-[12px] tracking-[0.14em]">MEDLEY</span>}
          </span>
          <span className="flex items-center gap-3">
            <MetaReadout label="Tom" value={isPlaying ? now.key : ''} tone="text-logic-lcd-amber" />
            <MetaReadout label="BPM" value={isPlaying ? now.bpm : ''} tone="text-logic-lcd-text" />
          </span>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            <span
              key={currentSong?.id ?? ''}
              className={`console-glow block font-semibold tracking-tight truncate animate-[fadeIn_250ms_ease-out] ${name} ${isPlaying ? 'text-logic-lcd-green' : 'text-logic-text-muted'}`}
            >
              {(currentSong && live?.sliceName ? live.sliceName : currentSong?.name) ?? '---'}
            </span>
            {currentSong && live?.sliceName && <p className="text-xs text-logic-text-dim truncate">{currentSong.name}</p>}
          </div>
          {isPlaying && Number.isFinite(secondsLeft) && (
            <SegmentDisplay
              text={`-${formatTime(secondsLeft)}`}
              label={`Faltam ${formatTime(secondsLeft)}`}
              className={`shrink-0 ${seg} ${finalCountdown !== null ? 'text-logic-lcd-red animate-pulse' : 'text-logic-lcd-green'}`}
            />
          )}
        </div>
        <div className={`led-bar h-1.5 rounded-[1px] ${finalCountdown !== null ? 'text-logic-lcd-red' : 'text-logic-lcd-green'}`}>
          <div className="led-bar-fill transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
        {finalCountdown !== null && <span className="sr-only" role="timer" aria-live="polite">Restam {finalCountdown}s</span>}
      </div>

      <div className={`console-display px-3 ${pad} flex flex-col gap-1.5 min-w-0`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`console-legend flex items-center gap-2 ${hasNext ? '!text-logic-lcd-amber' : ''}`}>
            <span className={`console-led ${hasNext ? 'is-on-amber' : ''}`} />
            Próxima
            {isPlaying && live?.nextSliceName && <span className="px-1 rounded-[2px] border border-current text-[9px] leading-[12px] tracking-[0.14em]">MEDLEY</span>}
          </span>
          <span className="flex items-center gap-3">
            <MetaReadout label="Tom" value={hasNext && !live?.nextSliceName ? next.key : ''} tone="text-logic-lcd-amber" />
            <MetaReadout label="BPM" value={hasNext && !live?.nextSliceName ? next.bpm : ''} tone="text-logic-lcd-text" />
          </span>
        </div>
        <span
          key={nextName ?? ''}
          className={`console-glow block font-semibold tracking-tight truncate animate-[fadeIn_250ms_ease-out] ${name} ${hasNext ? 'text-logic-lcd-amber' : 'text-logic-text-muted'}`}
        >
          {nextName ?? '---'}
        </span>
        {/* enche junto com a música tocando: quando completa, a próxima entra */}
        <div className="led-bar h-1.5 rounded-[1px] text-logic-lcd-amber flex justify-end">
          <div className="led-bar-fill transition-[width] duration-200 ease-linear" style={{ width: `${hasNext ? progress * 100 : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function LivePanel({
  lv, live, currentSong, nextSong, orderedSongs, sheets, selectedSongId, livePartId,
  onSelectSong, onCreateAccount, signalHint,
}: {
  lv: LiveView;
  live: ShowLive | null;
  currentSong: SetlistSong | null | undefined;
  nextSong: SetlistSong | null | undefined;
  orderedSongs: SetlistSong[];
  sheets: SheetInfo[];
  selectedSongId: string | null;
  /** Parte do medley tocando agora */
  livePartId?: string | null;
  onSelectSong: (id: string) => void;
  onCreateAccount: (() => void) | null;
  /** Motivo do "Sem sinal do diretor", quando se sabe (ex.: o diretor fechou o repertório) */
  signalHint?: string;
}) {
  const isPlaying = lv.isPlaying;
  // músicas com caderno: um conjunto só por lista, em vez de procurar na lista a cada linha
  const sheetKeys = useMemo(() => new Set(sheets.map((s) => s.song_id)), [sheets]);
  const hasNext = isPlaying && !!live?.nextSongId && !!nextSong;

  const starts: number[] = [];
  orderedSongs.reduce((acc, s) => { starts.push(acc); return acc + s.duration; }, 0);
  const cols = 'grid-cols-[34px_1fr_48px_60px] sm:grid-cols-[34px_1fr_48px_48px_56px_60px]';

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="console-face flex flex-col gap-2 p-3 border-b border-black">
        <SignalBanner status={lv.status} isPlaying={lv.isPlaying} paused={!!live?.isPaused} hint={signalHint} />

        {onCreateAccount && (
          <button
            onClick={onCreateAccount}
            className="console-key flex items-center gap-3 px-3 py-2 text-left !font-sans"
          >
            <UserPlus size={16} className="text-logic-accent flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-logic-text">Criar conta e manter minhas cifras</p>
              <p className="text-2xs font-normal text-logic-text-muted truncate">Entre em qualquer aparelho, sem código.</p>
            </div>
          </button>
        )}

        <NowNextDisplays lv={lv} live={live} currentSong={currentSong} nextSong={hasNext ? nextSong : null} />
      </div>

      <div className="flex-1 overflow-y-auto logic-scroll bg-logic-bg-panel">
        <div className={`console-rail console-legend sticky top-0 z-10 grid ${cols} gap-2 px-3 h-7 items-center`}>
          <span>#</span>
          <span>Música</span>
          <span className="text-right">BPM</span>
          <span className="text-right hidden sm:block">Tom</span>
          <span className="text-right hidden sm:block">Duração</span>
          <span className="text-right">Entra em</span>
        </div>
        {orderedSongs.map((song, i) => {
          const isCurrent = isPlaying && live?.currentSongId === song.id;
          const isNext = isPlaying && live?.nextSongId === song.id;
          const isSelected = selectedSongId === song.id;
          const hasSheet = sheetKeys.has(song.id);
          const medley = isMedleySong(song);
          return (
            <div key={song.id}>
            <button
              className={`cue-row relative w-full grid ${cols} gap-2 px-3 h-11 items-center text-left border-b border-black/60
                ${isCurrent ? 'is-current' : isNext ? 'is-next' : isSelected ? 'is-selected' : ''}`}
              onClick={() => onSelectSong(song.id)}
            >
              <span className="flex items-center gap-1.5">
                <span className={`console-led flex-shrink-0 ${isCurrent ? 'is-on-green' : isNext ? 'is-on-amber' : ''}`} />
                <span className="font-stage text-[12px] tabular-nums text-logic-text-muted">{i + 1}</span>
              </span>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`text-sm font-semibold truncate ${isCurrent ? 'text-logic-lcd-green console-glow' : isNext ? 'text-logic-lcd-amber console-glow' : 'text-logic-text'}`}>
                  {song.name}
                </span>
                {hasSheet && <PenLine size={12} className="text-logic-accent flex-shrink-0" />}
              </span>
              <span className="font-stage text-[13px] text-right text-logic-text-dim tabular-nums">{bpmText(song) || '-'}</span>
              <span className={`font-stage text-[13px] text-right hidden sm:block ${song.tuner ? 'text-logic-lcd-amber' : 'text-logic-text-dim'}`} title={song.tuner ? `Tuner ${song.tuner > 0 ? '+' : ''}${song.tuner}` : undefined}>{songKeyLabel(song) || toneText(song.tuner)}</span>
              <span className="font-stage text-[13px] font-semibold text-right text-logic-text hidden sm:block tabular-nums">{formatTime(song.duration)}</span>
              <span className="font-stage text-[13px] text-right text-logic-text-muted tabular-nums">
                {isNext && live ? formatTime(lv.nextSongCountdown) : formatTime(starts[i])}
              </span>
            </button>
            {medley && song.parts!.map((part, j) => {
              const key = partKey(song.id, part.id);
              const partNow = isCurrent && livePartId === part.id;
              const skipped = part.enabled === false;
              return (
                <button
                  key={key}
                  onClick={() => onSelectSong(key)}
                  title={`Caderno de "${part.name}": cole a cifra, escreva, faça a partitura ou importe a foto desta parte`}
                  className={`cue-row relative w-full grid ${cols} gap-2 px-3 h-9 items-center text-left border-b border-black/40 bg-black/20
                    ${partNow ? 'is-current' : selectedSongId === key ? 'is-selected' : ''} ${skipped ? 'opacity-50' : ''}`}
                >
                  <span className="font-stage text-[11px] tabular-nums text-logic-text-muted text-right pr-1">{i + 1}.{j + 1}</span>
                  <span className="col-span-1 sm:col-span-3 flex items-center gap-1.5 min-w-0 pl-2 border-l border-logic-border-light">
                    {partNow && <span className="console-led is-on-green flex-shrink-0" />}
                    <span className={`text-xs truncate ${partNow ? 'text-logic-lcd-green font-semibold console-glow' : 'text-logic-text-dim'}`}>{part.name}</span>
                    {skipped && <span className="text-[10px] text-logic-text-muted flex-shrink-0">pulada</span>}
                    {sheetKeys.has(key) && <PenLine size={11} className="text-logic-accent flex-shrink-0" />}
                  </span>
                  <span className="font-stage text-[12px] text-right text-logic-text-muted tabular-nums">{formatTime(part.end - part.start)}</span>
                  <span className="font-stage text-[12px] text-right text-logic-text-muted tabular-nums">{formatTime(starts[i] + part.start)}</span>
                </button>
              );
            })}
            </div>
          );
        })}
        {orderedSongs.length === 0 && (
          <p className="text-sm text-logic-text-muted text-center py-8">Nenhuma música no show ainda.</p>
        )}
      </div>
    </div>
  );
}

/** O que fazer quando cai o sinal: na Rede Local não há internet no caminho, é o Wi-Fi do palco. */
export const defaultSignalHint = (): string => (isLocalClient()
  ? 'Tentando reconectar... Confira se este aparelho está no Wi-Fi do palco.'
  : 'Tentando reconectar... Verifique a internet.');

export function SignalBanner({ status, isPlaying, paused, hint }: {
  status: SignalStatus; isPlaying: boolean; paused: boolean;
  /** Motivo do "Sem sinal", quando se sabe; sem ele vai a orientação de cada modo */
  hint?: string;
}) {
  if (status === 'ended') {
    return (
      <div className="console-display flex items-center gap-3 px-3 py-2">
        <WifiOff size={16} className="text-logic-text-muted flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-logic-text">O diretor encerrou o envio</p>
          <p className="text-2xs text-logic-text-muted">Quando ele voltar a enviar, esta tela se atualiza sozinha.</p>
        </div>
      </div>
    );
  }
  // queda de conexão em âmbar, como no Remote (o vermelho da lâmpada quer dizer "no ar")
  if (status === 'nosignal') {
    return (
      <div role="alert" className="console-display flex items-center gap-3 px-3 py-2 !border-logic-lcd-amber/60">
        <span className="console-led is-lg is-on-amber animate-pulse flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-logic-lcd-amber">Sem sinal do diretor</p>
          <p className="text-xs text-logic-text-dim">{hint ?? defaultSignalHint()}</p>
        </div>
      </div>
    );
  }
  // lâmpada "no ar" como a do programa: acesa (vermelha) enquanto o diretor toca
  return (
    <div className="flex items-center gap-2 px-1">
      <span className={`console-lamp flex-shrink-0 ${isPlaying ? 'is-on' : ''}`} />
      <p className={`font-stage text-[13px] font-semibold tracking-wide ${isPlaying ? 'text-logic-text' : 'text-logic-text-dim'}`}>
        {isPlaying ? 'Ao vivo' : paused ? 'Música pausada pelo diretor' : 'Ao vivo, aguardando o diretor dar o play'}
      </p>
    </div>
  );
}
