import { useEffect, useRef, useState } from 'react';
import { LogOut, Camera, Music, Trash2 } from 'lucide-react';
import { fileToAvatar } from '@/lib/avatarImage';
import type { SheetBackend } from '@/lib/musicianTypes';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** Foto do músico em círculo; sem foto, mostra as iniciais do nome. */
export function Avatar({ src, name, size = 28, className = '' }: {
  src: string | null | undefined; name: string; size?: number; className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={style}
        className={`shrink-0 rounded-full object-cover border border-black/60 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] ${className}`}
      />
    );
  }
  return (
    <span
      style={style}
      className={`shrink-0 inline-flex items-center justify-center rounded-full bg-logic-bg-elevated border border-black/60 font-stage font-semibold text-logic-text-dim ${className}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/**
 * Foto de perfil na barra de cima da Área do Músico. Tocar abre "Escolher foto" / "Remover foto".
 * Na Rede Local (sem conta no servidor) não há foto: mostra só o ícone.
 */
export function ProfilePhotoButton({ backend, name, onMessage, onLogout }: {
  backend: SheetBackend; name: string; onMessage?: (text: string) => void;
  /** Sair da conta: fica no menu do próprio perfil, junto da foto. */
  onLogout?: () => void;
}) {
  const supported = !!backend.avatar && !!backend.setAvatar;
  const [photo, setPhoto] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!backend.avatar) return;
    let alive = true;
    backend.avatar().then((a) => { if (alive) setPhoto(a); }).catch(() => { /* sem foto */ });
    return () => { alive = false; };
  }, [backend]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  // Sem foto disponível ainda pode haver o que fazer aqui (sair da conta).
  if (!supported && !onLogout) return <Music size={16} className="text-logic-lcd-green flex-shrink-0" />;

  const save = async (next: string | null) => {
    setBusy(true);
    try {
      await backend.setAvatar!(next);
      setPhoto(next);
      onMessage?.(next ? 'Foto salva. O diretor musical vê a sua foto no programa.' : 'Foto removida.');
    } catch {
      onMessage?.('Não deu para salvar a foto. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      await save(await fileToAvatar(file));
    } catch {
      onMessage?.('Não deu para abrir essa imagem. Escolha uma foto JPG ou PNG.');
    }
  };

  return (
    <div ref={box} className="relative shrink-0">
      <button
        className={`relative block rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-logic-lcd-green ${busy ? 'opacity-60' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={photo ? 'Trocar ou remover sua foto' : 'Colocar sua foto de perfil'}
        aria-label="Foto de perfil"
        aria-expanded={open}
        disabled={busy}
      >
        <Avatar src={photo} name={name} size={30} />
        {!photo && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-logic-lcd-green text-black flex items-center justify-center border border-black">
            <Camera size={8} strokeWidth={2.5} />
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-48 console-face rounded-lg border border-black p-1.5 shadow-xl animate-[fadeIn_120ms_ease-out]">
          <button
            className="console-key w-full flex items-center gap-2 h-9 px-2.5 text-[13px]"
            onClick={() => { setOpen(false); input.current?.click(); }}
          >
            <Camera size={14} /> {photo ? 'Trocar foto' : 'Escolher foto'}
          </button>
          {photo && (
            <button
              className="console-key w-full flex items-center gap-2 h-9 px-2.5 mt-1 text-[13px] hover:!text-logic-lcd-red"
              onClick={() => { setOpen(false); void save(null); }}
            >
              <Trash2 size={14} /> Remover foto
            </button>
          )}
          {onLogout && (
            <>
              <div className="my-1 h-px bg-logic-border" />
              <button
                className="console-key w-full flex items-center gap-2 h-9 px-2.5 text-[13px] hover:!text-logic-lcd-red"
                onClick={() => { setOpen(false); onLogout(); }}
              >
                <LogOut size={14} /> Sair
              </button>
            </>
          )}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
