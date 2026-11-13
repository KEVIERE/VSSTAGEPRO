import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore, ROUTABLE_TRACKS } from '@/store';
import type { RoutingTarget } from '@/types';
import { masterAudioClip, masterRoleForClip } from '@/lib/clipMastering';
import { MASTER_PROFILES, type MasterProfile } from '@/lib/mastering';
import { reclassifyClipWithAi } from '@/lib/aiRouter';
import { canSplitClipStems, isDrumClip, isSplittingStems, startClipStemSplit } from '@/lib/clipStemSplit';
import { glueSelectedClips } from '@/lib/clipGlue';
import { copyClips, duplicateClips, hasCopiedClips, pasteClips } from '@/lib/clipClipboard';
import NarrationDialog from '@/components/NarrationDialog';
import ClickMenuItems from '@/components/ClickMenuItems';
import { audioEngine } from '@/lib/audioEngine';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  clipId: string | null;
}


export default function ContextMenu() {
  const [state, setState] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, clipId: null,
  });
  const [menuKey, setMenuKey] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const clips = useStore((s) => s.clips);
  const songs = useStore((s) => s.songs);
  // Editor da fala: aberto a partir do próprio clipe gerado (também dá pelo clique duplo na régua)
  const [editingNarrationId, setEditingNarrationId] = useState<{ songId: string; narrationId: string } | null>(null);

  const openMenu = useCallback((e: MouseEvent, clipId: string) => {
    e.preventDefault();
    setState({ visible: true, x: e.clientX, y: e.clientY, clipId });
    // submenus e o campo do Normalizar começam fechados a cada abertura
    setMenuKey((k) => k + 1);
  }, []);

  const closeMenu = useCallback(() => {
    setState((s) => ({ ...s, visible: false, clipId: null }));
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    // Esc com o menu aberto só fecha o menu (o preventDefault avisa o atalho geral para não dar Stop)
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current) { e.preventDefault(); closeMenu(); }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [closeMenu]);

  useEffect(() => {
    (window as unknown as { __openClipContextMenu?: (e: MouseEvent, clipId: string) => void }).__openClipContextMenu = openMenu;
    return () => {
      delete (window as unknown as { __openClipContextMenu?: (e: MouseEvent, clipId: string) => void }).__openClipContextMenu;
    };
  }, [openMenu]);

  if (editingNarrationId) {
    const song = songs.find((sg) => sg.id === editingNarrationId.songId);
    const narration = song?.narrations?.find((n) => n.id === editingNarrationId.narrationId);
    if (song && narration) {
      return <NarrationDialog song={song} narration={narration} onClose={() => setEditingNarrationId(null)} />;
    }
  }

  if (!state.visible || !state.clipId) return null;

  const clip = clips.find((c) => c.id === state.clipId);
  // O clipe de uma fala do Maestro por IA é guardado na própria marcação: por aqui dá para
  // voltar ao texto e à voz que o geraram.
  const narrationOwner = clip
    ? songs.flatMap((sg) => (sg.narrations ?? []).filter((n) => n.clipId === clip.id).map((n) => ({ song: sg, narration: n })))[0] ?? null
    : null;

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-52 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded text-xs select-none"
      style={{ left: state.x, top: Math.min(state.y, window.innerHeight - 300) }}
    >
      {narrationOwner && (
        <>
          <button
            className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
            onClick={() => {
              const id = narrationOwner.narration.id;
              const songId = narrationOwner.song.id;
              closeMenu();
              setEditingNarrationId({ songId, narrationId: id });
            }}
            title="Voltar ao texto e à voz desta fala"
          >
            <span>Editar a Fala do Maestro…</span>
            <span className="text-[10px] opacity-75 truncate max-w-28">{narrationOwner.narration.text || 'sem texto'}</span>
          </button>
          <div className="h-px bg-logic-border-dark my-1" />
        </>
      )}
      <ClipMenuItems key={menuKey} clipId={state.clipId} onClose={closeMenu} />
    </div>
  );
}

/**
 * As opções de um áudio na timeline (Enviar Para, Copiar, Colar, Duplicar, Dividir, Emendar,
 * Masterizar, Separar stems, Remover...). O menu dos clipes e o menu das falas do Maestro IA usam
 * as mesmas, para a voz gerada ter tudo o que os outros áudios têm.
 * `audioTools={false}`: quem chama já mostra Masterizar e Normalizar do seu jeito.
 * `removeItem={false}`: quem chama já tem o seu Apagar.
 */
export function ClipMenuItems({ clipId, onClose, audioTools = true, removeItem = true, routingTools = true }: {
  clipId: string;
  onClose: () => void;
  audioTools?: boolean;
  /** false nas falas do Maestro IA: a IA mandaria a voz do maestro para o canal das vozes (o PA). */
  routingTools?: boolean;
  removeItem?: boolean;
}) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [masterOpen, setMasterOpen] = useState(false);
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const [normalizeDb, setNormalizeDb] = useState('-2');
  const routeClip = useStore((s) => s.routeClip);
  const resetClipRouting = useStore((s) => s.resetClipRouting);
  const removeClip = useStore((s) => s.removeClip);
  const normalizeClip = useStore((s) => s.normalizeClip);
  const dawMode = useStore((s) => s.dawMode);
  const clip = useStore((s) => s.clips.find((c) => c.id === clipId));
  const tracks = useStore((s) => s.tracks);
  // música no ar e trava da timeline: o Dividir fica apagado (mesma regra da tecla S na timeline)
  const playingSongId = useStore((s) => (s.transport.isPlaying ? s.transport.currentSongId : null));
  const timelineLocked = useStore((s) => s.timelineLocked);

  const allTargets: { id: string; name: string; color: string; isChild: boolean }[] = [];
  for (const routeId of ROUTABLE_TRACKS) {
    const parent = tracks.find((t) => t.id === routeId);
    if (!parent) continue;
    allTargets.push({ id: parent.id, name: parent.name, color: parent.color, isChild: false });
    for (const childId of parent.children) {
      const child = tracks.find((t) => t.id === childId);
      if (child) allTargets.push({ id: child.id, name: child.name, color: child.color, isChild: true });
    }
  }

  return (
    <>
      {/* Enviar Para submenu */}
      <div
        className="relative"
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <button className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75">
          <span>Enviar Para</span>
          <span className="text-logic-text-muted">&rarr;</span>
        </button>
        {submenuOpen && (
          <div className="absolute left-full top-0 min-w-48 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded max-h-80 overflow-y-auto logic-scroll">
            {allTargets.map((target) => (
              <button
                key={target.id}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75
                  ${clip?.trackId === target.id ? 'text-logic-accent' : 'text-logic-text'}
                  ${target.isChild ? 'pl-6' : ''}`}
                onClick={() => {
                  routeClip(clipId, target.id);
                  onClose();
                }}
              >
                <div className="w-1.5 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: target.color }} />
                <span className="truncate">{target.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-px bg-logic-border-dark my-1" />

      {routingTools && (
        <>
      <button
        className="w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
        onClick={() => {
          if (clipId) resetClipRouting(clipId);
          onClose();
        }}
      >
        Voltar ao Roteamento Automático
      </button>

      <button
        className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
        onClick={() => {
          if (clipId) reclassifyClipWithAi(clipId);
          onClose();
        }}
      >
        <span>Reclassificar com IA</span>
        <span className="text-[10px] opacity-75 font-normal">Ouvir o áudio</span>
      </button>
        </>
      )}

      {audioTools && dawMode && (
        <>
          <div className="h-px bg-logic-border-dark my-1" />
          {normalizeOpen ? (
            <form
              className="px-3 py-2 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const db = parseFloat(normalizeDb.replace(',', '.'));
                if (clipId && Number.isFinite(db)) normalizeClip(clipId, Math.min(0, db));
                onClose();
              }}
            >
              <span className="text-logic-text-dim whitespace-nowrap">Pico em</span>
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={normalizeDb}
                onChange={(e) => setNormalizeDb(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-14 bg-logic-bg-deep border border-logic-border-light rounded px-1.5 py-0.5 text-right outline-none focus:border-logic-accent"
              />
              <span className="text-logic-text-dim">dB</span>
              <button type="submit" className="ml-1 px-2 py-0.5 rounded bg-logic-accent text-white hover:brightness-110 transition">OK</button>
            </form>
          ) : (
            <button
              className="w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
              onClick={(e) => { e.stopPropagation(); setNormalizeOpen(true); }}
            >
              Normalizar...
            </button>
          )}
        </>
      )}

      <div className="h-px bg-logic-border-dark my-1" />

      <button
        className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
        onClick={() => {
          if (clipId) copyClips([clipId]);
          onClose();
        }}
      >
        <span>Copiar</span>
        <span className="text-[10px] opacity-75 font-mono">⌘C</span>
      </button>

      {hasCopiedClips() && (
        <button
          className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
          onClick={() => {
            pasteClips(clip?.trackId);
            onClose();
          }}
        >
          <span>Colar no Cursor</span>
          <span className="text-[10px] opacity-75 font-mono">⌘V</span>
        </button>
      )}

      <button
        className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
        onClick={() => {
          if (clipId) duplicateClips([clipId]);
          onClose();
        }}
      >
        <span>Duplicar</span>
        <span className="text-[10px] opacity-75 font-mono">⌘D</span>
      </button>

      <div className="h-px bg-logic-border-dark my-1" />

      <button
        className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-inherit disabled:cursor-default"
        disabled={timelineLocked || (!!clip && clip.songId === playingSongId)}
        onClick={() => {
          // Com a música deste clipe tocando, a parte 1 acabava num ponto que já passou e a parte 2
          // (clipe novo) não entra no meio do play: a faixa ficava muda até o fim. Só divide parada.
          const st = useStore.getState();
          const target = st.clips.find((c) => c.id === clipId);
          const playing = !!target && st.transport.isPlaying && st.transport.currentSongId === target.songId;
          if (target && !st.timelineLocked && !playing && st.splitClipAt(target.id, st.transport.currentTime)) {
            audioEngine.invalidatePrepared(target.songId);
          }
          onClose();
        }}
      >
        <span>Dividir no Cursor (Split)</span>
        {!!clip && clip.songId === playingSongId && (
          <span className="text-[10px] opacity-75">Pare para dividir</span>
        )}
      </button>

      <button
        className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
        onClick={() => {
          void glueSelectedClips([clipId, ...useStore.getState().selectedClipIds]);
          onClose();
        }}
      >
        <span>Emendar Clipes (Unir)</span>
        <span className="text-[10px] opacity-75 font-mono">⇧⌘G</span>
      </button>

      <button
        className="w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
        onClick={() => {
          if (clip) {
            useStore.getState().setImportProgress({
              clipId: clip.id,
              status: 'done',
              message: `${clip.name} | Rota: ${clip.routingMethod} | Conf: ${(clip.routingConfidence * 100).toFixed(0)}% | ${clip.duration.toFixed(1)}s`,
            });
            setTimeout(() => useStore.getState().setImportProgress(null), 3000);
          }
          onClose();
        }}
      >
        Ver Info
      </button>

      {clip && (
        <>
          <div className="h-px bg-logic-border-dark my-1" />
          {audioTools && (() => {
            // Masteriza qualquer áudio. A IA reconhece o clipe: na música inteira (ou playback
            // LR) o padrão é o perfil Equilibrado; em voz e stem que tocam com outros, o padrão
            // é manter o volume (o equilíbrio do VS), mas dá para levar ao volume de um perfil.
            const who = masterRoleForClip(clip.id);
            const stem = !!who && who.role !== 'mix';
            const options: Array<{ id: MasterProfile | 'manter'; label: string; hint: string }> = [
              ...(stem ? [{ id: 'manter' as const, label: 'Manter o volume', hint: who.role === 'voice' ? 'voz do VS · recomendado' : 'stem do VS · recomendado' }] : []),
              { id: 'equilibrado', label: MASTER_PROFILES.equilibrado.label, hint: stem ? '-10 LUFS' : '-10 LUFS · recomendado' },
              { id: 'show', label: MASTER_PROFILES.show.label, hint: '-8 LUFS · mais alto' },
              { id: 'streaming', label: MASTER_PROFILES.streaming.label, hint: '-14 LUFS · plataformas' },
            ];
            return (
              <div className="relative" onMouseEnter={() => setMasterOpen(true)} onMouseLeave={() => setMasterOpen(false)}>
                <button
                  className="w-full flex items-center justify-between px-3 py-1.5 text-left text-amber-400 hover:bg-amber-500 hover:text-black font-semibold transition-colors duration-75"
                  title="A IA ouve o áudio e escolhe EQ, compressão, estéreo e limitador"
                  onClick={() => {
                    masterAudioClip(clip.id);
                    onClose();
                  }}
                >
                  <span>✨ Masterizar com IA</span>
                  <span className="text-[10px] opacity-75 font-normal">&rarr;</span>
                </button>
                {masterOpen && (
                  <div className="absolute left-full top-0 min-w-56 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
                    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-logic-text-muted">Volume da master</div>
                    {options.map((o) => (
                      <button
                        key={o.id}
                        className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-amber-500 hover:text-black transition-colors duration-75"
                        onClick={() => {
                          masterAudioClip(clip.id, o.id);
                          onClose();
                        }}
                      >
                        <span className="font-semibold">{o.label}</span>
                        <span className="text-[10px] opacity-75 tabular-nums">{o.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {(() => {
            // Separar stems: bateria vira bumbo, caixa, pratos, tons e sala; os outros áudios viram
            // voz, baixo, bateria, guitarra/violão, teclado e outros, cada um na sua faixa.
            const available = canSplitClipStems();
            const busy = isSplittingStems();
            const drum = isDrumClip(clip);
            return (
              <button
                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-inherit"
                disabled={!available || busy}
                title={!available
                  ? 'Só no app do VS Stage para Mac (a IA roda no próprio Mac)'
                  : busy ? 'Já há uma separação em andamento'
                    : drum ? 'Separa a bateria em Bumbo, Caixa, Pratos, Tons e Sala, cada um na sua faixa'
                      : 'Separa os instrumentos deste áudio e põe cada um na sua faixa'}
                onClick={() => {
                  void startClipStemSplit(clip.id);
                  onClose();
                }}
              >
                <span>✂︎ Separar stems</span>
                <span className="text-[10px] opacity-75 font-normal">{!available ? 'Só no Mac' : drum ? 'Peças da bateria' : 'IA'}</span>
              </button>
            );
          })()}
          {clip.trackId === 'track-click' && (
            <>
              <div className="h-px bg-logic-border-dark my-1" />
              <ClickMenuItems
                songId={clip.songId}
                onClose={onClose}
                itemClass="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-inherit"
              />
            </>
          )}
        </>
      )}

      {removeItem && (
        <>
          <div className="h-px bg-logic-border-dark my-1" />
          <button
            className="w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-lcd-red hover:text-white transition-colors duration-75"
            onClick={() => {
              // áudio de uma fala do Maestro IA: a fala sai junto (a store cuida disso)
              audioEngine.stopClipsLive([clipId]);
              removeClip(clipId);
              audioEngine.invalidatePrepared(clip?.songId);
              onClose();
            }}
          >
            Remover Clip
          </button>
        </>
      )}
    </>
  );
}
