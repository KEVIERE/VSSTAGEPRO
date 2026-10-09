import { useEffect, useRef, useState } from 'react';
import {
  Bold, Check, CloudOff, Eraser, Highlighter, Loader2, Lock, Minus, MoreVertical, PenTool, Plus,
  Redo2, Share2, Sparkles, Trash2, Type, Undo2, Unlock, Brush,
} from 'lucide-react';
import { FONTS, INK_COLORS, MARKER_COLORS, SIZE_MAX, SIZE_MIN, TEXT_COLORS, type NotebookDoc } from '@/lib/notebook';
import type { DrawTool } from './DrawingLayer';
import type { SaveStatus } from './useNotebook';

export type Tool = 'type' | DrawTool;

const WIDTHS = [2, 4, 7];

const iconBtn = 'p-1.5 rounded-md text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors disabled:opacity-30 disabled:pointer-events-none';

function StatusBadge({ status }: { status: SaveStatus }) {
  if (status === 'saved') return <span className="text-2xs text-logic-text-muted hidden sm:flex items-center gap-1"><Check size={12} className="text-logic-lcd-green" /> Salvo</span>;
  if (status === 'offline') return <span title="Sem conexão. Fica guardado neste aparelho e é enviado sozinho quando a internet voltar." className="text-2xs text-logic-lcd-amber flex items-center gap-1"><CloudOff size={12} /> Guardado aqui</span>;
  if (status === 'too_big') return <span title="Apague alguns desenhos para poder salvar." className="text-2xs text-logic-lcd-red flex items-center gap-1"><CloudOff size={12} /> Muito cheio</span>;
  return <span className="text-2xs text-logic-text-dim flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Salvando</span>;
}

function Swatch({ color, on, onClick, title }: { color: string; on: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-6 h-6 rounded-full transition-transform active:scale-90 ${on ? 'ring-2 ring-white ring-offset-2 ring-offset-logic-bg-panel scale-110' : 'hover:scale-110'}`}
      style={{ background: color }}
    />
  );
}

export default function NotebookToolbar({
  follow, onToggleFollow, title, onTitle, placeholder, sharedFrom, status,
  canUndo, canRedo, onUndo, onRedo, canShare, onShare, onImport, importing, onClearDrawings, onDelete, hasDrawings, hasSheet,
  tool, onTool, doc, onDoc, inkColor, onInkColor, markerColor, onMarkerColor, inkWidth, onInkWidth,
}: {
  follow: boolean; onToggleFollow: () => void;
  title: string; onTitle: (t: string) => void; placeholder: string; sharedFrom: string | null; status: SaveStatus;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  canShare: boolean; onShare: () => void; onImport: () => void; importing: boolean;
  onClearDrawings: () => void; onDelete: () => void; hasDrawings: boolean; hasSheet: boolean;
  tool: Tool; onTool: (t: Tool) => void;
  doc: NotebookDoc; onDoc: (patch: Partial<Pick<NotebookDoc, 'font' | 'size' | 'bold' | 'color'>>) => void;
  inkColor: string; onInkColor: (c: string) => void;
  markerColor: string; onMarkerColor: (c: string) => void;
  inkWidth: number; onInkWidth: (w: number) => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const tools: { id: Tool; label: string; icon: typeof Type }[] = [
    { id: 'type', label: 'Escrever', icon: Type },
    { id: 'pen', label: 'Pincel', icon: PenTool },
    { id: 'marker', label: 'Marca-texto', icon: Highlighter },
    { id: 'eraser', label: 'Borracha', icon: Eraser },
  ];

  return (
    <div className="border-b border-logic-border-dark bg-logic-bg-panel">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggleFollow}
          title={follow ? 'Seguindo o diretor: o caderno troca junto com a música do show.' : 'Livre: você escolhe a música. Toque para voltar a seguir o diretor.'}
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md text-2xs font-semibold transition-colors flex-shrink-0 ${
            follow ? 'bg-logic-lcd-green/15 text-logic-lcd-green hover:bg-logic-lcd-green/25' : 'bg-logic-lcd-amber/15 text-logic-lcd-amber hover:bg-logic-lcd-amber/25'
          }`}
        >
          {follow ? <Unlock size={12} /> : <Lock size={12} />}
          {follow ? 'Seguir o diretor' : 'Livre'}
        </button>
        <div className="flex-1 min-w-0">
          <input
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder={placeholder || 'Título'}
            className="w-full bg-transparent text-sm font-semibold text-logic-text outline-none border-b border-transparent focus:border-logic-accent truncate"
          />
          {sharedFrom && <span className="text-2xs text-logic-text-muted">Recebido de {sharedFrom}</span>}
        </div>
        <StatusBadge status={status} />
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={onUndo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" className={iconBtn}><Undo2 size={15} /></button>
          <button onClick={onRedo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" className={iconBtn}><Redo2 size={15} /></button>
          <button onClick={onShare} disabled={!canShare} title={canShare ? 'Compartilhar com colegas' : 'Escreva algo para poder compartilhar'} className={`${iconBtn} hover:!text-logic-lcd-green`}><Share2 size={15} /></button>
          <div ref={menuRef} className="relative">
            <button onClick={() => setMenu((m) => !m)} title="Mais opções" className={iconBtn}><MoreVertical size={15} /></button>
            {menu && (
              <div className="absolute right-0 top-full mt-1 z-40 w-60 py-1 rounded-lg bg-logic-bg-elevated border border-logic-border-light shadow-2xl animate-[fadeIn_120ms_ease-out]">
                <button onClick={() => { setMenu(false); onImport(); }} disabled={importing} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-logic-text hover:bg-white/5 disabled:opacity-40">
                  <Sparkles size={14} className="text-logic-accent" /> Trazer letra do Teleprompter
                </button>
                <button onClick={() => { setMenu(false); onClearDrawings(); }} disabled={!hasDrawings} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-logic-text hover:bg-white/5 disabled:opacity-40">
                  <Brush size={14} /> Limpar todos os desenhos
                </button>
                <div className="my-1 h-px bg-logic-border-dark" />
                <button onClick={() => { setMenu(false); onDelete(); }} disabled={!hasSheet} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-logic-lcd-red hover:bg-logic-lcd-red/10 disabled:opacity-40">
                  <Trash2 size={14} /> Excluir o caderno desta música
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2 overflow-x-auto logic-scroll">
        <div className="flex items-center p-0.5 rounded-lg bg-logic-bg-deep border border-logic-border-dark flex-shrink-0">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => onTool(t.id)}
              title={t.label}
              className={`flex items-center gap-1.5 h-7 px-2 rounded-md text-2xs font-semibold transition-all ${
                tool === t.id ? 'bg-logic-accent text-white shadow' : 'text-logic-text-muted hover:text-logic-text'
              }`}
            >
              <t.icon size={13} /> <span className="hidden md:inline">{t.label}</span>
            </button>
          ))}
        </div>
        <span className="w-px h-6 bg-logic-border-dark flex-shrink-0" />

        {tool === 'type' && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <select
              value={doc.font}
              onChange={(e) => onDoc({ font: e.target.value as NotebookDoc['font'] })}
              className="h-7 px-2 rounded-md bg-logic-bg-deep border border-logic-border-dark text-2xs text-logic-text outline-none focus:border-logic-accent"
            >
              {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <div className="flex items-center rounded-md bg-logic-bg-deep border border-logic-border-dark">
              <button onClick={() => onDoc({ size: Math.max(SIZE_MIN, doc.size - 1) })} title="Letra menor" className="p-1.5 text-logic-text-muted hover:text-logic-text"><Minus size={12} /></button>
              <span className="w-6 text-center text-2xs font-mono text-logic-text">{doc.size}</span>
              <button onClick={() => onDoc({ size: Math.min(SIZE_MAX, doc.size + 1) })} title="Letra maior" className="p-1.5 text-logic-text-muted hover:text-logic-text"><Plus size={12} /></button>
            </div>
            <button
              onClick={() => onDoc({ bold: !doc.bold })}
              title="Negrito"
              className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${doc.bold ? 'bg-logic-accent/20 border-logic-accent text-logic-text' : 'bg-logic-bg-deep border-logic-border-dark text-logic-text-muted hover:text-logic-text'}`}
            >
              <Bold size={13} />
            </button>
            <div className="flex items-center gap-1.5 pl-1">
              {TEXT_COLORS.map((c) => <Swatch key={c} color={c} on={doc.color === c} onClick={() => onDoc({ color: c })} title="Cor da letra" />)}
            </div>
          </div>
        )}
        {tool === 'pen' && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {INK_COLORS.map((c) => <Swatch key={c} color={c} on={inkColor === c} onClick={() => onInkColor(c)} />)}
            <span className="w-px h-6 bg-logic-border-dark mx-1" />
            {WIDTHS.map((w) => (
              <button key={w} onClick={() => onInkWidth(w)} title={`Espessura ${w}`} className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${inkWidth === w ? 'bg-logic-bg-elevated ring-1 ring-logic-accent' : 'hover:bg-logic-bg-elevated'}`}>
                <span className="rounded-full" style={{ width: w + 3, height: w + 3, background: inkColor }} />
              </button>
            ))}
          </div>
        )}
        {tool === 'marker' && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {MARKER_COLORS.map((c) => <Swatch key={c} color={c} on={markerColor === c} onClick={() => onMarkerColor(c)} />)}
          </div>
        )}
        {tool === 'eraser' && <span className="text-2xs text-logic-text-muted flex-shrink-0">Passe por cima do desenho para apagar. O texto não é apagado.</span>}
        {tool !== 'type' && tool !== 'eraser' && (
          <span className="text-2xs text-logic-text-muted hidden lg:flex items-center gap-1 flex-shrink-0">Dedo, caneta ou mouse. Para rolar, volte para Escrever.</span>
        )}
      </div>
    </div>
  );
}
