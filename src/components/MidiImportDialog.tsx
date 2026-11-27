import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileMusic } from 'lucide-react';
import { midiImportPrompt, type MidiImportPrompt } from '@/lib/appPrompt';
import type { MidiSummary } from '@/lib/midiSong';

const fmtBpm = (b: number) => Number(b.toFixed(2)).toLocaleString('pt-BR');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function shiftLabel(shift: number): string {
  const s = Math.abs(shift);
  const text = s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace('.', ',')}` : `${s.toFixed(2).replace('.', ',')} s`;
  return shift > 0 ? `o MIDI começa ${text} depois do começo do áudio` : `o MIDI começa ${text} antes do começo do áudio`;
}

function SummaryLines({ s }: { s: MidiSummary }) {
  const lines: Array<[string, string]> = [];
  lines.push(['Andamento', s.hasTempo ? `${fmtBpm(s.bpmStart)} BPM no início${s.tempoChanges ? `, ${plural(s.tempoChanges, 'troca', 'trocas')}` : ', sem trocas'}` : 'o arquivo não traz andamento (fica o do click)']);
  lines.push(['Compasso', `${s.meterStart}${s.meterChanges ? `, ${plural(s.meterChanges, 'troca', 'trocas')}` : ''}`]);
  const shown = s.markers.slice(0, 5).join(', ') + (s.markers.length > 5 ? ` e mais ${s.markers.length - 5}` : '');
  lines.push(['Marcações', s.markers.length ? `${s.markers.length}: ${shown}` : 'nenhuma']);
  if (s.key) lines.push(['Tom', s.key]);
  if (s.smpte) lines.push(['SMPTE offset', s.smpte]);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs leading-relaxed">
      {lines.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-white/55 uppercase tracking-wide">{k}</dt>
          <dd className="text-white/90 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "O VS veio com arquivo MIDI": ler o andamento, o compasso e as marcações dele, ou ignorar. */
export default function MidiImportDialog() {
  const [prompt, setPrompt] = useState<MidiImportPrompt | null>(null);
  const [index, setIndex] = useState(0);
  const [applySmpte, setApplySmpte] = useState(false);

  useEffect(() => midiImportPrompt.register(setPrompt), []);

  useEffect(() => {
    if (!prompt) return;
    setIndex(Math.max(0, prompt.options.findIndex((o) => !!o.summary)));
    setApplySmpte(false);
    // com a pergunta na tela, os atalhos do app (espaço toca, Delete apaga música...) não valem
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        prompt.answer(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [prompt]);

  if (!prompt) return null;
  const chosen = prompt.options[index];
  const summary = chosen?.summary ?? null;
  const many = prompt.options.length > 1;

  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="vs-midi-title">
      <div className="console-face w-[28rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-black shadow-2xl font-stage text-white">
        <div className="flex items-center gap-2 px-3 h-11 border-b border-black">
          <FileMusic size={14} className="text-logic-lcd-amber" aria-hidden />
          <span id="vs-midi-title" className="console-legend uppercase text-logic-lcd-amber">Arquivo MIDI no VS</span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <p className="text-xs text-white/85 leading-relaxed">
            O VS “{prompt.songName}” veio com {many ? `${prompt.options.length} arquivos MIDI` : 'um arquivo MIDI'}. Ler o MIDI traz para a música
            o andamento com todas as trocas, o compasso e as marcações da DAW de onde ele saiu, e o click não troca essa grade.
            {prompt.songCount > 1 ? ` A resposta vale para as ${prompt.songCount} músicas do projeto.` : ''}
          </p>

          {many && (
            <div className="flex flex-col gap-1" role="radiogroup" aria-label="Arquivo MIDI">
              {prompt.options.map((o, i) => (
                <label
                  key={`${i}-${o.fileName}`}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs ${o.summary ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'} ${i === index ? 'border-logic-lcd-amber bg-black/50' : 'border-black bg-black/30 hover:bg-black/45'}`}
                >
                  <input type="radio" name="vs-midi-file" className="accent-amber-400" checked={i === index} disabled={!o.summary} onChange={() => setIndex(i)} />
                  <span className="flex-1 truncate">{o.fileName}</span>
                  {!o.summary && <span className="text-2xs text-white/60">não abriu</span>}
                </label>
              ))}
            </div>
          )}

          <div className="console-well px-3 py-2.5 flex flex-col gap-2">
            {!many && <span className="text-xs font-semibold truncate">{chosen?.fileName}</span>}
            {summary ? <SummaryLines s={summary} /> : <span className="text-2xs text-white/75">Não consegui ler este arquivo{chosen?.error ? ` (${chosen.error})` : ''}.</span>}
            {summary && summary.warnings.length > 0 && (
              <span className="text-2xs text-white/60 leading-relaxed">Arquivo com defeito em parte: li o que deu.</span>
            )}
          </div>

          {summary && summary.smpteShift !== 0 && (
            <label className="flex items-start gap-2 text-2xs text-white/85 leading-relaxed cursor-pointer">
              <input type="checkbox" className="mt-0.5 accent-amber-400" checked={applySmpte} onChange={(e) => setApplySmpte(e.target.checked)} />
              <span>Deslocar pelo SMPTE offset ({shiftLabel(summary.smpteShift)}). Deixe desmarcado se o áudio foi exportado do mesmo ponto que o MIDI.</span>
            </label>
          )}
          {summary && !summary.hasTempo && (
            <p className="text-2xs text-white/65 leading-relaxed">Sem andamento no MIDI: vêm só o compasso e as marcações, e o BPM continua sendo medido no click.</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button className="console-key px-3 h-7 text-xs text-white/80" onClick={() => prompt.answer(null)}>
            Ignorar
          </button>
          <button
            className="console-key px-3 h-7 text-xs text-logic-lcd-amber disabled:opacity-40"
            disabled={!summary}
            onClick={() => prompt.answer({ index, applySmpte })}
            autoFocus
          >
            Ler o MIDI
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
