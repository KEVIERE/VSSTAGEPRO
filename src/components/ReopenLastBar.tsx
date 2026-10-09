import { useEffect, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { useStore } from '@/store';
import { openRecentProject } from '@/lib/projectQuickSave';
import { autoOpenEnabled, canReopenSilently, listRecentProjects, type RecentProject } from '@/lib/recentProjects';

/** Ao iniciar, reabre o último projeto; se o Mac pedir permissão, oferece abrir com um clique. */
export default function ReopenLastBar() {
  const [pending, setPending] = useState<RecentProject | null>(null);

  useEffect(() => {
    if (!autoOpenEnabled()) return;
    let cancelled = false;
    void (async () => {
      const [last] = await listRecentProjects();
      if (!last || cancelled || useStore.getState().songs.length > 0) return;
      if (await canReopenSilently(last)) {
        if (!cancelled && useStore.getState().songs.length === 0) void openRecentProject(last);
      } else if (!cancelled) {
        setPending(last);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const songCount = useStore((s) => s.songs.length);
  useEffect(() => {
    if (songCount > 0) setPending(null);
  }, [songCount]);

  if (!pending) return null;

  return (
    <div className="flex items-center gap-3 px-3 h-8 bg-logic-lcd-green/10 border-b border-logic-lcd-green/30 text-xs text-logic-lcd-green animate-[fadeIn_200ms_ease-out]">
      <FolderOpen size={13} className="flex-shrink-0" />
      <span className="flex-1 truncate">
        Abrir o último projeto, <strong className="font-semibold">{pending.name}</strong>? O Mac pede sua permissão só desta vez.
      </span>
      <button
        className="px-2 h-6 rounded bg-logic-lcd-green text-black font-semibold hover:brightness-110 transition"
        onClick={() => { const entry = pending; setPending(null); void openRecentProject(entry); }}
      >
        Abrir projeto
      </button>
      <button className="p-1 rounded hover:bg-white/10 transition" onClick={() => setPending(null)} aria-label="Fechar aviso">
        <X size={12} />
      </button>
    </div>
  );
}
