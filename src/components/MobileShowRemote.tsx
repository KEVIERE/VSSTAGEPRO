import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Play, Pause, Square, SkipBack, SkipForward, Music, Radio,
  Sparkles, CheckCircle2, Wifi, Globe, Clock, Flame, AlertOctagon, Volume2, VolumeX, ListMusic, ChevronDown
} from 'lucide-react';
import { useStore } from '@/store';
import { startPlayback, stopPlayback } from '@/lib/transportControl';
import { isLocalClient } from '@/lib/localNetwork';
import { formatTime } from '@/components/ShowRundown';

export default function MobileShowRemote() {
  const store = useStore();
  const transport = store.transport;
  const songs = store.songs;
  const playlist = store.playlist;
  const activeSongId = transport.currentSongId ?? store.selectedSongId ?? playlist[0]?.songId;
  const currentSong = songs.find((s) => s.id === activeSongId);
  const isPlaying = transport.isPlaying;

  // Próxima música
  const currentIndex = playlist.findIndex((p) => p.songId === activeSongId);
  const nextItem = currentIndex >= 0 && currentIndex < playlist.length - 1 ? playlist[currentIndex + 1] : null;
  const nextSong = nextItem ? songs.find((s) => s.id === nextItem.songId) : null;

  // Estado local / remoto
  const [localState, setLocalState] = useState<{
    showName: string;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    currentSongName: string;
    currentBpm: number;
    nextSongName: string | null;
    songs: Array<{ id: string; name: string; duration: number; bpm: number }>;
  } | null>(null);

  const [connected, setConnected] = useState(true);
  const [showPlaylistDrawer, setShowPlaylistDrawer] = useState(true);

  // 1. Manter a tela do celular sempre acesa durante o show (Wake Lock API)
  useEffect(() => {
    let wakeLock: any = null;
    const requestWake = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        /* WakeLock ignorado ou não suportado */
      }
    };
    requestWake();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') requestWake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      try { wakeLock?.release(); } catch {}
    };
  }, []);

  // 2. Sincronização via Rede Local (caso esteja acessando pelo IP local do Mac)
  useEffect(() => {
    if (!isLocalClient()) return;

    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/local/state', {
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          if (alive && data?.show) {
            const live = data.show.live || {};
            const setlist = data.show.setlist?.songs || [];
            const playing = !!live.playing;
            const curTime = typeof live.time === 'number' ? live.time : 0;
            const curSong = setlist.find((s: any) => s && s.id === live.song_id);

            setLocalState({
              showName: data.show.name || 'Show ao Vivo',
              isPlaying: playing,
              currentTime: curTime,
              duration: curSong?.duration || 0,
              currentSongName: curSong?.name || live.song_name || 'Aguardando início...',
              currentBpm: curSong?.bpm || 120,
              nextSongName: live.next_song_name || null,
              songs: setlist.map((s: any) => ({
                id: s.id,
                name: s.name,
                duration: s.duration || 0,
                bpm: s.bpm || 120,
              })),
            });
            setConnected(true);
          }
        }
      } catch {
        if (alive) setConnected(false);
      }
    };

    poll();
    const interval = setInterval(poll, 600);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  // Vibração tátil no celular para feedback físico no palco
  const triggerHaptic = () => {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(25);
      }
    } catch {}
  };

  // Envio de comandos de transporte (Play, Pause, Stop, Próxima, Anterior)
  const sendCommand = async (action: 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'selectSong', songId?: string) => {
    triggerHaptic();

    if (isLocalClient()) {
      try {
        await fetch('/api/local/transport', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, songId }),
        });
      } catch (err) {
        console.warn('[Remote] falha ao enviar comando local:', err);
      }
    } else {
      // Controle direto no app
      const st = useStore.getState();
      if (action === 'play') {
        startPlayback();
      } else if (action === 'pause') {
        st.pause();
      } else if (action === 'stop') {
        stopPlayback();
      } else if (action === 'next') {
        const nextId = st.transport.nextSongId;
        if (nextId) {
          st.selectSong(nextId);
          startPlayback();
        }
      } else if (action === 'prev') {
        const pList = st.playlist;
        const curId = st.selectedSongId;
        const idx = pList.findIndex((p) => p.songId === curId);
        if (idx > 0) {
          st.selectSong(pList[idx - 1].songId);
          startPlayback();
        }
      } else if (action === 'selectSong' && songId) {
        st.selectSong(songId);
        startPlayback();
      }
    }
  };

  // Dados calculados para exibição
  const activePlaying = localState ? localState.isPlaying : isPlaying;
  const activeTime = localState ? localState.currentTime : transport.currentTime;
  const activeDuration = localState ? localState.duration : (currentSong?.duration || 0);
  const activeSongName = localState ? localState.currentSongName : (currentSong?.name || 'Nenhuma música selecionada');
  const activeBpm = localState ? localState.currentBpm : (currentSong?.bpm || 120);
  const activeNextSongName = localState ? localState.nextSongName : (nextSong?.name || null);
  const activeSongsList = localState ? localState.songs : playlist.map((p) => {
    const s = songs.find((sg) => sg.id === p.songId);
    return {
      id: p.songId,
      name: s?.name || p.title || 'Música',
      duration: s?.duration || p.duration || 0,
      bpm: s?.bpm || p.bpm || 120,
    };
  });

  const progressPct = activeDuration > 0 ? Math.min(100, Math.max(0, (activeTime / activeDuration) * 100)) : 0;
  const remainingTime = Math.max(0, activeDuration - activeTime);

  return (
    <div className="min-h-screen w-full bg-[#0a0a0c] text-white flex flex-col select-none overflow-x-hidden font-sans">
      {/* 1. Header do Palco com Status de Conexão */}
      <header className="px-5 py-3.5 border-b border-white/10 bg-[#121319]/90 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00ff87] to-[#60efff] p-0.5 shadow-[0_0_12px_rgba(0,255,135,0.4)] flex items-center justify-center">
            <Radio size={15} className="text-black" />
          </div>
          <div>
            <span className="text-xs font-black tracking-wider uppercase text-white block leading-tight">
              VS Stage <span className="text-[#00ff87]">Remote</span>
            </span>
            <span className="text-[10px] text-zinc-400 block leading-tight">
              Modo Show Celular
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-mono">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#00ff87] shadow-[0_0_6px_#00ff87]' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-zinc-300">{connected ? 'Ao Vivo' : 'Desconectado'}</span>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal do Palco */}
      <main className="flex-1 p-4 space-y-4 max-w-md mx-auto w-full flex flex-col justify-between">
        {/* 2. Card Principal: TOCANDO AGORA */}
        <div className="p-5 rounded-2xl bg-gradient-to-b from-white/[0.08] to-white/[0.02] border border-white/15 shadow-2xl relative overflow-hidden">
          {/* Luz de palco ambiente no fundo */}
          <div className={`absolute -top-12 -right-12 w-36 h-36 rounded-full blur-3xl pointer-events-none transition-opacity duration-700 ${activePlaying ? 'bg-[#00ff87]/25 opacity-100' : 'bg-amber-500/10 opacity-40'}`} />

          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-[#00ff87] flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full bg-[#00ff87] ${activePlaying ? 'animate-ping' : ''}`} />
              Tocando Agora
            </span>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-md bg-white/10 text-white font-mono font-bold text-xs">
                {activeBpm} BPM
              </span>
              <span className="px-1.5 py-0.5 rounded-md bg-white/5 text-zinc-400 font-mono text-[10px]">
                4/4
              </span>
            </div>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-white leading-snug line-clamp-2 my-2 tracking-tight">
            {activeSongName}
          </h1>

          {/* Barra de Progresso do Áudio */}
          <div className="w-full h-2.5 bg-black/60 rounded-full overflow-hidden p-0.5 border border-white/10 my-3">
            <div
              className="h-full bg-gradient-to-r from-[#00ff87] to-[#60efff] rounded-full transition-all duration-300 ease-linear shadow-[0_0_8px_rgba(0,255,135,0.8)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Relógio Digital de Alta Visibilidade */}
          <div className="flex items-center justify-between font-mono text-sm">
            <div className="flex items-center gap-1.5 text-white font-bold text-base">
              <Clock size={14} className="text-[#00ff87]" />
              <span>{formatTime(activeTime)}</span>
            </div>
            <div className="text-xs text-zinc-400">
              Total: {formatTime(activeDuration)}
            </div>
            <div className="text-xs font-bold text-amber-400">
              -{formatTime(remainingTime)}
            </div>
          </div>
        </div>

        {/* 3. Card PRÓXIMA MÚSICA */}
        {activeNextSongName && (
          <div className="px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
            <span className="text-2xs font-bold uppercase tracking-wider text-zinc-400">
              Próxima
            </span>
            <span className="text-xs font-semibold text-zinc-200 truncate ml-3 max-w-[220px]">
              {activeNextSongName}
            </span>
          </div>
        )}

        {/* 4. Painel Gigante de Controles de Transporte (Palco / Touch) */}
        <div className="py-2">
          <div className="flex items-center justify-center gap-4">
            {/* Botão Anterior */}
            <button
              onClick={() => sendCommand('prev')}
              className="w-14 h-14 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] active:scale-90 border border-white/10 flex items-center justify-center text-white transition-all shadow-lg"
              title="Música Anterior"
            >
              <SkipBack size={24} />
            </button>

            {/* Botão Play / Pause Gigante */}
            <button
              onClick={() => sendCommand(activePlaying ? 'pause' : 'play')}
              className={`w-24 h-24 rounded-3xl flex items-center justify-center transition-all active:scale-95 shadow-2xl ${
                activePlaying
                  ? 'bg-amber-400 hover:bg-amber-300 text-black shadow-[0_0_28px_rgba(251,191,36,0.6)]'
                  : 'bg-[#00ff87] hover:bg-[#10ff90] text-black shadow-[0_0_32px_rgba(0,255,135,0.7)]'
              }`}
              title={activePlaying ? 'Pausar' : 'Dar Play no VS'}
            >
              {activePlaying ? <Pause size={42} className="fill-current" /> : <Play size={44} className="fill-current ml-1" />}
            </button>

            {/* Botão Próxima */}
            <button
              onClick={() => sendCommand('next')}
              className="w-14 h-14 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] active:scale-90 border border-white/10 flex items-center justify-center text-white transition-all shadow-lg"
              title="Próxima Música"
            >
              <SkipForward size={24} />
            </button>
          </div>

          {/* Botão Parar / Stop */}
          <div className="flex justify-center mt-3">
            <button
              onClick={() => sendCommand('stop')}
              className="px-6 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 hover:text-red-300 active:scale-95 flex items-center gap-2 text-xs font-bold transition-all"
            >
              <Square size={13} className="fill-current" />
              <span>PARAR (STOP)</span>
            </button>
          </div>
        </div>

        {/* 5. Lista de Músicas do Show (Setlist Drawer) */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden flex flex-col flex-1 max-h-[340px]">
          <div
            onClick={() => setShowPlaylistDrawer(!showPlaylistDrawer)}
            className="px-4 py-3 border-b border-white/10 bg-white/[0.02] flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <ListMusic size={16} className="text-[#00ff87]" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                Setlist do Show ({activeSongsList.length})
              </span>
            </div>
            <ChevronDown size={16} className={`text-zinc-400 transition-transform ${showPlaylistDrawer ? 'rotate-180' : ''}`} />
          </div>

          {showPlaylistDrawer && (
            <div className="overflow-y-auto divide-y divide-white/5 flex-1 p-1">
              {activeSongsList.map((s, idx) => {
                const isThisCurrent = s.name === activeSongName || s.id === activeSongId;
                return (
                  <div
                    key={s.id || idx}
                    onClick={() => sendCommand('selectSong', s.id)}
                    className={`px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-all active:scale-[0.98] ${
                      isThisCurrent
                        ? 'bg-[#00ff87]/15 border border-[#00ff87]/40 shadow-sm'
                        : 'hover:bg-white/[0.05] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-5 text-center font-mono text-xs font-bold ${isThisCurrent ? 'text-[#00ff87]' : 'text-zinc-500'}`}>
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className={`text-xs font-bold truncate ${isThisCurrent ? 'text-white' : 'text-zinc-300'}`}>
                          {s.name}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                          <span>{s.bpm} BPM</span>
                          <span>•</span>
                          <span>{formatTime(s.duration)}</span>
                        </div>
                      </div>
                    </div>

                    {isThisCurrent && (
                      <div className="flex items-center gap-1 text-[#00ff87] text-2xs font-mono font-bold shrink-0">
                        {activePlaying ? (
                          <span className="flex items-center gap-0.5">
                            <span className="w-1 h-3 bg-[#00ff87] animate-pulse rounded-full" />
                            <span className="w-1 h-4 bg-[#00ff87] animate-pulse rounded-full delay-75" />
                            <span className="w-1 h-2 bg-[#00ff87] animate-pulse rounded-full delay-150" />
                          </span>
                        ) : (
                          <span>PAUSADO</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
