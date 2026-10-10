import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/store';
import { useHoverDismiss } from '@/lib/useHoverDismiss';
import ImportVSDialog from '@/components/ImportVSDialog';
import AudioDeviceDialog from '@/components/AudioDeviceDialog';
import ProjectDialogs from '@/components/ProjectDialogs';
import ShowsMenu from '@/components/ShowsMenu';
import { DEFAULT_SHOW_NAME } from '@/lib/shows';
import { Loader2, Check, AlertTriangle, ChevronRight, FolderOpen, Package } from 'lucide-react';
import { openRecentProject, saveCurrentProject } from '@/lib/projectQuickSave';
import { autoOpenEnabled, clearRecentProjects, listRecentProjects, setAutoOpenEnabled, type RecentProject } from '@/lib/recentProjects';
import NetworkModeButton, { useModeSwitch } from '@/components/network/NetworkModeButton';
import type { LiveBroadcast } from '@/lib/useLiveBroadcast';
import type { LocalBroadcast } from '@/lib/useLocalBroadcast';

// O programa é Mac-only: atalhos sempre no padrão do teclado Mac (⌘), nunca Ctrl.
const SAVE_SHORTCUT = '⌘S';

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  recent?: boolean;
  checked?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

export default function MenuBar({ onOpenShowManager, onOpenPrompter, onOpenLocal, broadcast, local, pendingRequests, trialBadge }: {
  onOpenShowManager: () => void; onOpenPrompter: () => void; onOpenLocal: () => void;
  broadcast: LiveBroadcast; local: LocalBroadcast; pendingRequests: number;
  trialBadge?: React.ReactNode;
}) {
  const modeSwitch = useModeSwitch(broadcast, local, onOpenLocal);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const newProject = useStore((s) => s.newProject);
  const toggleMixer = useStore((s) => s.toggleMixer);
  const togglePlaylist = useStore((s) => s.togglePlaylist);
  const togglePlaylistMaximized = useStore((s) => s.togglePlaylistMaximized);
  const removeSong = useStore((s) => s.removeSong);
  const duplicatePlaylistEntry = useStore((s) => s.duplicatePlaylistEntry);
  const selectedSongId = useStore((s) => s.selectedSongId);
  const saveDialogOpen = useStore((s) => s.saveDialogOpen);
  const openDialogOpen = useStore((s) => s.openDialogOpen);
  const audioDeviceDialogOpen = useStore((s) => s.audioDeviceDialogOpen);
  const setSaveDialogOpen = useStore((s) => s.setSaveDialogOpen);
  const setOpenDialogOpen = useStore((s) => s.setOpenDialogOpen);
  const setAudioDeviceDialogOpen = useStore((s) => s.setAudioDeviceDialogOpen);
  const setBounceDialogOpen = useStore((s) => s.setBounceDialogOpen);
  const projectName = useStore((s) => s.projectName);
  const saveStatus = useStore((s) => s.saveStatus);
  const activeShowId = useStore((s) => s.activeShowId);
  const activeShowName = useStore((s) => s.shows.find((sh) => sh.id === s.activeShowId)?.name ?? DEFAULT_SHOW_NAME);

  const [confirmNew, setConfirmNew] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(autoOpenEnabled);
  const hover = useHoverDismiss(openMenu !== null, () => setOpenMenu(null));
  const hoverProps = (label: string) => ({
    onMouseEnter: () => {
      hover.cancel();
      if (openMenu !== null && openMenu !== label) setOpenMenu(label);
    },
    onMouseLeave: () => { if (openMenu !== null) hover.schedule(); },
  });

  useEffect(() => {
    setRecentOpen(false);
    if (openMenu === 'Arquivo') listRecentProjects().then(setRecent);
  }, [openMenu]);

  const handleImportVS = () => {
    setImportOpen(true);
    setOpenMenu(null);
  };

  const handleNewProject = () => {
    setConfirmNew(true);
    setOpenMenu(null);
  };

  const undo = () => { useStore.temporal.getState().undo(); setOpenMenu(null); };
  const redo = () => { useStore.temporal.getState().redo(); setOpenMenu(null); };

  const openSave = () => { setSaveDialogOpen(true); setOpenMenu(null); };
  const openOpen = () => { setOpenDialogOpen(true); setOpenMenu(null); };
  const openAudio = () => { setAudioDeviceDialogOpen(true); setOpenMenu(null); };

  const menus: MenuDef[] = [
    {
      label: 'Arquivo',
      items: [
        { label: 'Importar VS...', action: handleImportVS },
        { separator: true },
        { label: 'Novo Projeto', action: handleNewProject },
        { label: 'Salvar Projeto...', action: openSave },
        { label: 'Abrir Projeto...', action: openOpen },
        { label: 'Aberto Recentemente', recent: true },
        { label: 'Salvar', shortcut: SAVE_SHORTCUT, action: () => { setOpenMenu(null); saveCurrentProject(); } },
        {
          label: 'Abrir o Último Projeto ao Iniciar', checked: autoOpen,
          action: () => { setAutoOpenEnabled(!autoOpen); setAutoOpen(!autoOpen); setOpenMenu(null); },
        },
        { separator: true },
        { label: 'Dispositivo de Áudio...', action: openAudio },
        { separator: true },
        { label: 'Teleprompter...', action: () => { onOpenPrompter(); setOpenMenu(null); } },
        { label: 'Rede Local...', checked: local.mode === 'local', action: () => { setOpenMenu(null); modeSwitch.choose('local'); } },
        {
          label: 'Show Online...', checked: local.mode === 'online',
          action: () => { setOpenMenu(null); if (local.mode === 'online') onOpenShowManager(); else modeSwitch.choose('online'); },
        },
      ],
    },
    {
      label: 'Editar',
      items: [
        { label: 'Desfazer', shortcut: '⌘Z', action: undo },
        { label: 'Refazer', shortcut: '⌘⇧Z', action: redo },
        { separator: true },
        { label: 'Duplicar Música', shortcut: '⌘D', action: () => { if (selectedSongId) duplicatePlaylistEntry(selectedSongId); setOpenMenu(null); } },
        { label: 'Excluir Música', shortcut: 'Delete', action: () => { if (selectedSongId) removeSong(selectedSongId); setOpenMenu(null); } },
      ],
    },
    {
      label: 'Visualizar',
      items: [
        { label: 'Mostrar/Ocultar Mixer', shortcut: 'M', action: () => { toggleMixer(); setOpenMenu(null); } },
        { label: 'Mostrar/Ocultar Playlist', action: () => { togglePlaylist(); setOpenMenu(null); } },
        { label: 'Maximizar Playlist', action: () => { togglePlaylistMaximized(); setOpenMenu(null); } },
      ],
    },
  ];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div ref={menuRef} className="flex items-center h-7 bg-logic-bg-deep border-b border-logic-border-dark text-xs select-none">
      {menus.map((menu) => (
        <div key={menu.label} className="relative" {...hoverProps(menu.label)}>
          <button
            className={`px-3 h-7 flex items-center hover:bg-logic-bg-panel-light transition-colors duration-100
              ${openMenu === menu.label ? 'bg-logic-bg-panel-light' : ''}`}
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
          >
            {menu.label}
          </button>
          {openMenu === menu.label && (
            <div className="absolute left-0 top-7 z-50 min-w-56 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded-b">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={i} className="h-px bg-logic-border-dark my-1" />
                ) : item.recent ? (
                  <div
                    key={i}
                    className="relative"
                    onMouseEnter={() => setRecentOpen(true)}
                    onMouseLeave={() => setRecentOpen(false)}
                  >
                    <button
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors duration-75
                        ${recentOpen ? 'bg-logic-accent text-white' : 'hover:bg-logic-accent hover:text-white'}`}
                      onClick={() => setRecentOpen((v) => !v)}
                    >
                      <span>{item.label}</span>
                      <ChevronRight size={12} className="opacity-70" />
                    </button>
                    {recentOpen && (
                      <RecentMenu
                        items={recent}
                        onPick={(r) => { setOpenMenu(null); void openRecentProject(r); }}
                        onClear={() => { void clearRecentProjects(); setRecent([]); }}
                      />
                    )}
                  </div>
                ) : (
                  <button
                    key={i}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-left
                      hover:bg-logic-accent hover:text-white transition-colors duration-75"
                    onClick={() => item.action?.()}
                  >
                    <span className="flex items-center gap-1.5">
                      {item.checked !== undefined && (
                        <Check size={11} className={item.checked ? 'opacity-100' : 'opacity-0'} />
                      )}
                      {item.label}
                    </span>
                    {item.shortcut && (
                      <span className="text-logic-text-muted ml-4 text-2xs">{item.shortcut}</span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}

      <button
        className="px-3 h-7 flex items-center hover:bg-logic-bg-panel-light transition-colors duration-100 font-medium"
        style={{ color: '#e8e8e8' }}
        onClick={() => { setBounceDialogOpen(true); setOpenMenu(null); }}
        title="Exportar áudio"
      >
        Bounce
      </button>

      <div {...hoverProps('Shows')}>
        <ShowsMenu
          open={openMenu === 'Shows'}
          onToggle={() => setOpenMenu(openMenu === 'Shows' ? null : 'Shows')}
          onClose={() => setOpenMenu(null)}
        />
      </div>

      <div className="flex-1 min-w-0 flex justify-center px-3">
        {saveStatus?.kind === 'error' ? (
          <span className="flex items-center gap-1.5 truncate text-2xs text-logic-lcd-red" role="alert">
            <AlertTriangle size={11} className="shrink-0" />{saveStatus.message}
          </span>
        ) : saveStatus?.kind === 'saving' ? (
          <span className="flex items-center gap-1.5 truncate text-2xs text-logic-text-dim" role="status">
            <Loader2 size={11} className="animate-spin shrink-0" />Salvando...
          </span>
        ) : saveStatus?.kind === 'saved' ? (
          <span className="flex items-center gap-1.5 truncate text-2xs text-logic-lcd-green" role="status">
            <Check size={11} className="shrink-0" />Salvo
          </span>
        ) : (
          <span className="flex items-center gap-4 min-w-0 text-2xs text-logic-text-muted" title={saveStatus?.message ?? projectName}>
            <span className="truncate">Projeto: <span className="text-logic-text-dim">{projectName}</span></span>
            <span className="truncate">
              Show: <span key={activeShowName} className={`inline-block animate-[fadeIn_200ms_ease-out] ${activeShowId ? 'text-logic-accent' : 'text-logic-text-dim'}`}>{activeShowName}</span>
            </span>
          </span>
        )}
      </div>

      {trialBadge}

      <NetworkModeButton
        broadcast={broadcast} local={local} pendingRequests={pendingRequests}
        onOpenShowManager={() => { onOpenShowManager(); setOpenMenu(null); }}
        onOpenLocal={() => { onOpenLocal(); setOpenMenu(null); }}
        onChoose={(m) => { setOpenMenu(null); modeSwitch.choose(m); }}
      />
      {modeSwitch.dialog}

      <ImportVSDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ProjectDialogs
        mode={saveDialogOpen ? 'save' : openDialogOpen ? 'open' : null}
        onClose={() => { setSaveDialogOpen(false); setOpenDialogOpen(false); }}
      />

      <AudioDeviceDialog
        open={audioDeviceDialogOpen}
        onClose={() => setAudioDeviceDialogOpen(false)}
      />

      {confirmNew && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
          <div className="w-80 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
            <div className="px-4 pt-3 pb-2">
              <div className="text-sm font-medium text-logic-text mb-1">Novo Projeto</div>
              <p className="text-xs text-logic-text-dim leading-relaxed">
                Isso vai reiniciar o programa ao padrão inicial. Se ainda não salvou, salve antes.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-4 pb-3">
              <button
                className="px-3 py-1.5 text-xs rounded bg-logic-accent text-white hover:brightness-110 transition-all"
                onClick={() => { setConfirmNew(false); setSaveDialogOpen(true); }}
              >
                Salvar antes...
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text border border-logic-border-dark hover:bg-logic-bg-panel-light transition-colors"
                onClick={() => { newProject(); setConfirmNew(false); }}
              >
                Descartar e criar novo
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text-muted border border-logic-border-dark hover:bg-logic-bg-panel-light hover:text-logic-text transition-colors"
                onClick={() => setConfirmNew(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function formatOpenedAt(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `Hoje, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function RecentMenu({ items, onPick, onClear }: {
  items: RecentProject[]; onPick: (r: RecentProject) => void; onClear: () => void;
}) {
  return (
    <div className="absolute left-full top-0 -mt-1 ml-px z-50 w-72 py-1 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded animate-[fadeIn_120ms_ease-out]">
      {items.length === 0 ? (
        <p className="px-3 py-2 text-logic-text-muted">Nenhum projeto aberto recentemente.</p>
      ) : (
        <>
          {items.map((r) => (
            <button
              key={r.id}
              className="group w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75"
              onClick={() => onPick(r)}
              title={r.label}
            >
              {r.target.kind === 'folder'
                ? <FolderOpen size={12} className="shrink-0 text-logic-accent group-hover:text-white" />
                : <Package size={12} className="shrink-0 text-logic-accent group-hover:text-white" />}
              <span className="flex-1 min-w-0 truncate">{r.name}</span>
              <span className="shrink-0 text-2xs text-logic-text-muted group-hover:text-white/80">{formatOpenedAt(r.openedAt)}</span>
            </button>
          ))}
          <div className="h-px bg-logic-border-dark my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-logic-text-dim hover:bg-logic-accent hover:text-white transition-colors duration-75"
            onClick={onClear}
          >
            Limpar lista
          </button>
        </>
      )}
    </div>
  );
}
