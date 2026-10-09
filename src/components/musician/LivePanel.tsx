import { PenLine, Radio, WifiOff, UserPlus } from 'lucide-react';
import type { LiveView, SetlistSong, SheetInfo, ShowLive, SignalStatus } from '@/lib/musicianTypes';
import { bpmAdjustToAlpha } from '@/lib/timeStretch';

export function formatTime(s: number): string {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function bpmText(song: SetlistSong | null | undefined): string {
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

export default function LivePanel({
  lv, live, currentSong, nextSong, orderedSongs, sheets, selectedSongId,
  onSelectSong, onCreateAccount,
}: {
  lv: LiveView;
  live: ShowLive | null;
  currentSong: SetlistSong | null | undefined;
  nextSong: SetlistSong | null | undefined;
  orderedSongs: SetlistSong[];
  sheets: SheetInfo[];
  selectedSongId: string | null;
  onSelectSong: (id: string) => void;
  onCreateAccount: (() => void) | null;
}) {
  const isPlaying = lv.isPlaying;
  const hasNext = isPlaying && !!live?.nextSongId && !!nextSong;
  const secondsLeft = currentSong
    ? (currentSong.duration - lv.currentTime) * bpmAdjustToAlpha(currentSong.bpmAdjust ?? 0)
    : Infinity;
  const finalCountdown = isPlaying && !!currentSong && secondsLeft <= 10 ? Math.max(0, Math.ceil(secondsLeft)) : null;
  const progress = Math.max(0, Math.min(1, lv.songProgress));

  const starts: number[] = [];
  orderedSongs.reduce((acc, s) => { starts.push(acc); return acc + s.duration; }, 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex flex-col gap-2 p-3 border-b border-logic-border-dark bg-logic-bg">
        <SignalBanner status={lv.status} isPlaying={lv.isPlaying} paused={!!live?.isPaused} />

        {onCreateAccount && (
          <button
            onClick={onCreateAccount}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-logic-accent/10 border border-logic-accent/40 text-left hover:bg-logic-accent/20 transition-colors"
          >
            <UserPlus size={16} className="text-logic-accent flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-logic-text">Criar conta e manter minhas cifras</p>
              <p className="text-2xs text-logic-text-muted truncate">Entre em qualquer aparelho, sem código.</p>
            </div>
          </button>
        )}

        <div className={`logic-lcd px-3 py-2 flex flex-col gap-2.5 transition-shadow duration-300 ${finalCountdown !== null ? 'shadow-[0_0_0_1px_rgba(255,69,58,0.5),0_0_18px_rgba(255,69,58,0.18)]' : ''}`}>
          <div>
            <NowNextBlock
              label="Tocando"
              badge={finalCountdown !== null ? `Restam ${finalCountdown}s` : undefined}
              name={currentSong && live?.sliceName ? live.sliceName : currentSong?.name}
              medley={currentSong && live?.sliceName ? currentSong.name : undefined}
              active={isPlaying && !!currentSong}
              color="#30d158"
              meta={isPlaying ? bpmText(currentSong) : ''}
            />
            <div className="mt-1.5 h-1 rounded-full bg-black/40 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${finalCountdown !== null ? 'bg-logic-lcd-red' : 'bg-logic-lcd-green'}`}
                style={{ width: `${isPlaying ? progress * 100 : 0}%` }}
              />
            </div>
          </div>
          <NowNextBlock
            label="Próxima"
            name={isPlaying && currentSong && live?.nextSliceName ? live.nextSliceName : hasNext ? nextSong?.name : undefined}
            medley={isPlaying && currentSong && live?.nextSliceName ? currentSong.name : undefined}
            active={hasNext || (isPlaying && !!live?.nextSliceName)}
            color="#ff9f0a"
            meta={hasNext ? bpmText(nextSong) : ''}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto logic-scroll">
        <div className="sticky top-0 z-10 grid grid-cols-[28px_1fr_56px_64px] sm:grid-cols-[28px_1fr_56px_48px_56px_64px] gap-2 px-3 h-7 items-center bg-logic-bg-deep border-b border-logic-border-dark text-2xs uppercase tracking-wider text-logic-text-muted">
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
          const hasSheet = sheets.some((s) => s.song_id === song.id);
          return (
            <button
              key={song.id}
              className={`relative w-full grid grid-cols-[28px_1fr_56px_64px] sm:grid-cols-[28px_1fr_56px_48px_56px_64px] gap-2 px-3 h-11 items-center text-left border-b border-logic-border-dark transition-colors duration-100
                ${isCurrent ? 'bg-logic-lcd-green/10' : isNext ? 'bg-logic-lcd-amber/10' : 'hover:bg-logic-bg-panel-light'}
                ${isSelected ? 'shadow-[inset_3px_0_0_#0a84ff]' : ''}`}
              onClick={() => onSelectSong(song.id)}
            >
              <span className="text-2xs font-mono text-logic-text-muted">{i + 1}</span>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`text-sm font-semibold truncate ${isCurrent ? 'text-logic-lcd-green' : isNext ? 'text-logic-lcd-amber' : 'text-logic-text'}`}>
                  {song.name}
                </span>
                {hasSheet && <PenLine size={12} className="text-logic-accent flex-shrink-0" />}
              </span>
              <span className="text-xs font-mono text-right text-logic-text-dim tabular-nums">{bpmText(song) || '-'}</span>
              <span className={`text-xs font-mono text-right hidden sm:block ${song.tuner ? 'text-logic-lcd-amber' : 'text-logic-text-dim'}`}>{toneText(song.tuner)}</span>
              <span className="text-xs font-mono text-right text-logic-text hidden sm:block tabular-nums">{formatTime(song.duration)}</span>
              <span className="text-xs font-mono text-right text-logic-text-muted tabular-nums">
                {isNext && live ? formatTime(lv.nextSongCountdown) : formatTime(starts[i])}
              </span>
            </button>
          );
        })}
        {orderedSongs.length === 0 && (
          <p className="text-sm text-logic-text-muted text-center py-8">Nenhuma música no show ainda.</p>
        )}
      </div>
    </div>
  );
}

function NowNextBlock({ label, name, active, color, meta, badge, medley }: {
  label: string; name: string | undefined; active: boolean; color: string; meta: string; badge?: string; medley?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: active ? color : '#666' }}>
          {label}
          {medley && <span className="px-1 rounded-[3px] border border-current text-[9px] leading-[12px] tracking-[0.14em] opacity-80">MEDLEY</span>}
        </span>
        {meta && <span className="text-xs font-mono tabular-nums text-logic-text-dim">{meta} <span className="text-logic-text-muted">BPM</span></span>}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span key={name ?? ''} className="flex-1 min-w-0 block text-lg font-semibold tracking-tight truncate animate-[fadeIn_250ms_ease-out]" style={{ color: active ? color : '#555' }}>{name ?? '---'}</span>
        {badge && (
          <span className="shrink-0 px-2 py-0.5 rounded-md bg-logic-lcd-red/15 border border-logic-lcd-red/50 text-xs font-semibold uppercase tracking-wider text-logic-lcd-red tabular-nums animate-pulse" role="timer" aria-live="polite">
            {badge}
          </span>
        )}
      </div>
      {medley && <p className="text-xs text-logic-text-dim truncate">{medley}</p>}
    </div>
  );
}

function SignalBanner({ status, isPlaying, paused }: { status: SignalStatus; isPlaying: boolean; paused: boolean }) {
  if (status === 'ended') {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-logic-bg-panel border border-logic-border-light">
        <WifiOff size={16} className="text-logic-text-muted flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-logic-text">O diretor encerrou o envio</p>
          <p className="text-2xs text-logic-text-muted">Quando ele voltar a enviar, esta tela se atualiza sozinha.</p>
        </div>
      </div>
    );
  }
  if (status === 'nosignal') {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-logic-lcd-red/10 border border-logic-lcd-red/40">
        <WifiOff size={16} className="text-logic-lcd-red flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-logic-lcd-red">Sem sinal do diretor</p>
          <p className="text-2xs text-logic-text-muted">Tentando reconectar... Verifique a internet.</p>
        </div>
      </div>
    );
  }
  if (!isPlaying) {
    return (
      <div className="flex items-center gap-2 px-1">
        <Radio size={14} className="text-logic-lcd-green flex-shrink-0" />
        <p className="text-xs text-logic-text-dim">
          {paused ? 'Música pausada pelo diretor' : 'Ao vivo — aguardando o diretor dar o play'}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-logic-lcd-green opacity-60 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-logic-lcd-green" />
      </span>
      <span className="text-2xs uppercase tracking-wider text-logic-lcd-green">Ao vivo</span>
    </div>
  );
}
