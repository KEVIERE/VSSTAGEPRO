import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Globe, Loader2, Play, Square } from 'lucide-react';
import { VOICE_PRESETS } from '@/lib/narrations';
import { IA_VOICE_NAMES, canGenerate, isPresetVoice, playPreview, stopPreview, voiceDemo, voiceLabel } from '@/lib/maestroVoice';
import { ONLINE_PACKS, isOnlineVoice, onlineVoiceById } from '@/lib/onlineVoices';
import { onlineStatus, type OnlineStatus } from '@/lib/maestroCloud';
import { READY_INTENSITIES, READY_VOICES, readyVoice, readyVoiceId } from '@/lib/maestroCues';
import { friendlyError } from '@/lib/friendlyError';
import type { VoicePitch } from '@/types';

interface MaestroVoicePickerProps {
  voice: string;
  onChoose: (voice: string) => void;
  /** A voz de IA do Mac está pronta (mostra "· IA" nos botões padrão). */
  iaReady: boolean;
  /** Tom escolhido: o exemplo (▶) toca nele, para ouvir também o grave e o agudo. */
  pitch?: VoicePitch;
  /** Largura do rótulo da esquerda, para alinhar com as outras linhas da janela. */
  labelClass?: string;
}

const OPEN_KEY = 'vs-maestro-ia-vozes-online-abertas';

function savedOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
}

type DemoState = { id: string; state: 'loading' | 'playing' } | null;

interface VoiceChipProps {
  label: React.ReactNode;
  title: string;
  selected: boolean;
  onChoose: () => void;
  demo: 'loading' | 'playing' | null;
  onDemo: () => void;
  demoDisabled: string | null;
  className?: string;
}

/** Uma voz: o ▶ toca o exemplo (sem escolher); o nome escolhe a voz. */
function VoiceChip({ label, title, selected, onChoose, demo, onDemo, demoDisabled, className = '' }: VoiceChipProps) {
  const tone = selected
    ? 'border-sky-400 bg-sky-500/25 text-sky-100'
    : 'border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-logic-text';
  return (
    <div className={`flex items-stretch rounded border transition-colors min-w-0 ${tone} ${className}`}>
      <button
        className="shrink-0 px-1 flex items-center justify-center border-r border-white/10 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none rounded-l"
        onClick={onDemo}
        disabled={!!demoDisabled}
        title={demoDisabled ?? (demo === 'playing' ? 'Parar o exemplo' : 'Ouvir um exemplo desta voz (antes de gerar)')}
        aria-label={demo === 'playing' ? 'Parar o exemplo' : 'Ouvir um exemplo desta voz'}
      >
        {demo === 'loading' ? <Loader2 size={10} className="animate-spin" /> : demo === 'playing' ? <Square size={9} /> : <Play size={10} />}
      </button>
      <button
        className="flex-1 min-w-0 px-1 py-1.5 text-2xs font-semibold truncate"
        onClick={onChoose}
        aria-pressed={selected}
        title={title}
      >
        {label}
      </button>
    </div>
  );
}

/**
 * Escolha da voz do Maestro por IA: as vozes do próprio Mac (Feminina, Masculina e Henrique) e,
 * logo abaixo, os pacotes de vozes online (Google Gemini e ElevenLabs). Cada voz tem um ▶ para ouvir
 * um exemplo antes de gerar.
 */
export default function MaestroVoicePicker({ voice, onChoose, iaReady, pitch, labelClass = 'w-12' }: MaestroVoicePickerProps) {
  const [open, setOpen] = useState(() => savedOpen() || isOnlineVoice(voice));
  const [online, setOnline] = useState<OnlineStatus | null>(null);
  const [demo, setDemo] = useState<DemoState>(null);
  const [demoMsg, setDemoMsg] = useState<{ error: boolean; text: string } | null>(null);
  const demoToken = useRef(0);

  useEffect(() => {
    let alive = true;
    void onlineStatus().then((st) => { if (alive) setOnline(st); });
    return () => { alive = false; };
  }, []);
  // fechou a janela: o exemplo para
  useEffect(() => () => { demoToken.current++; stopPreview(); }, []);
  // mudou o tom: o exemplo que estava tocando para (o próximo ▶ já sai no tom novo)
  useEffect(() => { demoToken.current++; stopPreview(); setDemo(null); }, [pitch]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* fica aberto */ }
  };

  const playDemo = async (id: string) => {
    // ▶ de novo na voz que está tocando (ou carregando): para
    if (demo?.id === id) { demoToken.current++; stopPreview(); setDemo(null); return; }
    const token = ++demoToken.current;
    stopPreview();
    setDemo({ id, state: 'loading' });
    setDemoMsg(null);
    try {
      const out = await voiceDemo(id, pitch);
      if (token !== demoToken.current) return;
      setDemo({ id, state: 'playing' });
      if (out.note) setDemoMsg({ error: false, text: out.note });
      playPreview(out.buffer, () => { if (token === demoToken.current) setDemo(null); });
    } catch (err) {
      if (token !== demoToken.current) return;
      setDemo(null);
      setDemoMsg({ error: true, text: friendlyError(err, 'Não foi possível tocar o exemplo desta voz.') });
    }
  };

  const demoOf = (id: string) => (demo?.id === id ? demo.state : null);
  const demoBlocked = (id: string) => (canGenerate(id) ? null : 'O exemplo das vozes Feminina e Masculina só toca no app do Mac.');
  // Cubas e Keven foram apagadas: marcação antiga nelas fala com a Masculina (e aparece nela)
  const selected = (id: string) => voice === id || voice === `qwen:${id}` || (id === 'masculina' && /^(qwen:)?(cubas|keven)$/.test(voice));
  // voz que não é mais oferecida (voz do Mac pelo nome, voz online que saiu da lista...)
  const ready = readyVoice(voice);
  const intensity = ready?.intensity ?? 'normal';
  const legacy = !!voice && !isPresetVoice(voice) && !ready && !/^qwen:(feminina|masculina|henrique|cubas|keven)$/.test(voice) && !onlineVoiceById(voice);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className={`text-logic-text-muted ${labelClass} shrink-0`}>Voz</span>
        <div className="flex-1 grid grid-cols-2 gap-1">
          {VOICE_PRESETS.map((p) => (
            <VoiceChip
              key={p.id}
              label={<>{p.label}{iaReady && <span className="font-normal opacity-75"> · {IA_VOICE_NAMES[p.id]}</span>}</>}
              title={p.id === 'henrique'
                ? `Voz ${p.label}: voz gravada de uma pessoa real, copiada por IA no próprio Mac (sem internet)`
                : `Voz ${p.label.toLowerCase()} de IA, gerada no próprio Mac (sem internet)`}
              selected={selected(p.id)}
              onChoose={() => onChoose(p.id)}
              demo={demoOf(p.id)}
              onDemo={() => { void playDemo(p.id); }}
              demoDisabled={demoBlocked(p.id)}
            />
          ))}
        </div>
      </div>

      {/* Falas prontas: frases comuns de palco gravadas em estúdio (escolha nos botões por assunto) */}
      <div className="flex items-center gap-2">
        <span className={`text-logic-text-muted ${labelClass} shrink-0`}>Prontas</span>
        <div className="flex-1 grid grid-cols-2 gap-1">
          {READY_VOICES.map((v) => {
            // trocar entre Felipe e Moça mantém a intensidade escolhida
            const id = readyVoiceId(v, intensity);
            return (
              <VoiceChip
                key={v.id}
                label={v.label}
                title={`Voz ${v.label}: fala as falas prontas, sem internet. Texto fora da lista sai na voz ${v.fallback === 'masculina' ? 'Masculina' : 'Feminina'} do Mac.`}
                selected={ready?.dir === v.dir}
                onChoose={() => onChoose(id)}
                demo={demoOf(id)}
                onDemo={() => { void playDemo(id); }}
                demoDisabled={null}
              />
            );
          })}
        </div>
      </div>

      {/* Intensidade da voz pronta: calma, normal ou forte (cada uma gravada à parte) */}
      {ready && (
        <div className="flex items-center gap-2">
          <span className={`text-logic-text-muted ${labelClass} shrink-0`} title="Intensidade da voz">Intens.</span>
          <div className="flex-1 grid grid-cols-3 gap-1" role="group" aria-label="Intensidade da voz">
            {READY_INTENSITIES.map((l) => (
              <button
                key={l.id}
                className={`px-2 py-1.5 rounded border text-2xs font-semibold transition-colors ${
                  intensity === l.id
                    ? 'border-sky-400 bg-sky-500/25 text-sky-100'
                    : 'border-logic-border-light bg-logic-bg-deep text-logic-text-dim hover:text-logic-text'
                }`}
                onClick={() => { if (l.id !== intensity) onChoose(readyVoiceId(ready, l.id)); }}
                aria-pressed={intensity === l.id}
                title={l.hint}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {legacy && (
        <div className="flex items-center gap-2 -mt-1">
          <span className={`${labelClass} shrink-0`} />
          <span className="text-[10px] text-logic-text-muted">
            Voz atual: {voiceLabel(voice)} (não é mais oferecida). Escolha uma das vozes acima ou abaixo.
          </span>
        </div>
      )}

      {ONLINE_PACKS.length > 0 && (
      <div className="flex gap-2 -mt-0.5">
        <span className={`${labelClass} shrink-0`} />
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <button
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-logic-text-muted hover:text-logic-text self-start"
            onClick={toggle}
            aria-expanded={open}
            title="Vozes das melhores IAs de fala da internet (precisa de internet e da sua conta)"
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Globe size={10} /> Mais vozes online
          </button>
          {open && (
            <>
              {ONLINE_PACKS.map((pack) => (
                <div key={pack.id} className="flex flex-col gap-1">
                  <div className="text-[10px] text-logic-text-dim">
                    <span className="font-semibold text-logic-text">{pack.label}</span>
                    <span className="text-logic-text-muted"> · {pack.description}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {pack.voices.map((v) => (
                      <VoiceChip
                        key={v.id}
                        label={<>{v.name}<span className="font-normal opacity-60"> {v.gender === 'feminina' ? '♀' : '♂'}</span></>}
                        title={`${v.name}: voz ${v.gender}, ${v.hint} (${pack.label}). Precisa de internet.`}
                        selected={voice === v.id}
                        onChoose={() => onChoose(v.id)}
                        demo={demoOf(v.id)}
                        onDemo={() => { void playDemo(v.id); }}
                        demoDisabled={null}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {online && !online.ready && (
                <div className="text-[10px] text-logic-lcd-amber leading-snug">{online.reason}</div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      <div className="flex gap-2 -mt-1">
        <span className={`${labelClass} shrink-0`} />
        <div className={`flex-1 text-[10px] leading-snug ${demoMsg?.error ? 'text-logic-lcd-red' : demoMsg ? 'text-logic-lcd-amber' : 'text-logic-text-muted'}`}>
          {demoMsg ? demoMsg.text : '▶ toca um exemplo da voz antes de gerar ("Atenção, banda! Um, dois, três, quatro.").'}
        </div>
      </div>
    </>
  );
}
