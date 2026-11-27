// Janela "Conferir faixas": no fim da importação, os áudios que nem o nome nem a IA decidiram
// bem; pelo menu (Editar ou botão direito do clipe), todos os áudios da música. Em cada linha:
// ouvir o trecho mais forte, os dois palpites da IA, a faixa, "É solo" e o nome do clipe.
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ListChecks, Play, Square, Trash2 } from 'lucide-react';
import { useStore } from '@/store';
import type { RoutingTarget } from '@/types';
import {
  canBeSolo, clearLearned, finalDestination, forgetLearned, initialChoice, loadLearned, percent,
  reviewTargets, subscribeLearned, type LearnedRoute, type ReviewChoice, type ReviewItem,
} from '@/lib/routeReview';
import {
  closeRouteReview, confirmRouteReview, currentPreviewClipId, currentRouteReview, playReviewPreview,
  skipRouteReview, stopReviewPreview, subscribeReviewPreview, subscribeRouteReview,
} from '@/lib/routeReviewActions';

function useLearned(): LearnedRoute[] {
  const [list, setList] = useState<LearnedRoute[]>(() => loadLearned());
  useEffect(() => subscribeLearned(() => setList(loadLearned())), []);
  return list;
}

const Row = memo(function Row({ item, choice, trackName, playing, onChange }: {
  item: ReviewItem;
  choice: ReviewChoice;
  trackName: (id: RoutingTarget) => string;
  playing: boolean;
  onChange: (c: ReviewChoice) => void;
}) {
  const dest = finalDestination(item, choice);
  const soloOk = canBeSolo(choice.target);
  const [g1, g2] = item.guesses;
  return (
    <div className="console-well px-2.5 py-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 items-center" role="group" aria-label={item.fileName}>
      <button
        type="button"
        className={`console-key w-8 h-8 flex items-center justify-center ${playing ? 'text-logic-lcd-amber' : 'text-white/80'}`}
        onClick={() => (playing ? stopReviewPreview() : void playReviewPreview(item))}
        title={playing ? 'Parar' : 'Ouvir 8 s do trecho mais forte'}
        aria-label={playing ? `Parar ${item.fileName}` : `Ouvir ${item.fileName}`}
      >
        {playing ? <Square size={12} aria-hidden /> : <Play size={12} aria-hidden />}
      </button>
      <div className="min-w-0 flex flex-col">
        <span className="text-xs font-semibold truncate" title={item.fileName}>{item.fileName}</span>
        <span className="text-2xs text-white/60 truncate">
          {g1 ? <>IA: <span className="text-white/85">{g1.childName}</span> {percent(g1.confidence)}</> : 'IA: não reconheceu'}
          {g2 ? <>  ·  2º palpite: <span className="text-white/85">{g2.childName}</span> {percent(g2.confidence)}</> : null}
          {item.songName ? <>  ·  {item.songName}</> : null}
        </span>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-1.5">
        <select
          className="console-key h-7 px-1.5 text-xs bg-black/40 text-white max-w-[11rem]"
          value={choice.target}
          aria-label="Faixa"
          onChange={(e) => onChange({ ...choice, target: e.target.value as RoutingTarget, solo: choice.solo && canBeSolo(e.target.value as RoutingTarget) })}
        >
          {reviewTargets().map((id) => <option key={id} value={id} className="bg-neutral-900 text-white">{trackName(id)}</option>)}
        </select>
        <button
          type="button"
          className={`console-key h-7 px-2 text-xs disabled:opacity-35 ${choice.solo ? 'text-logic-lcd-amber' : 'text-white/75'}`}
          aria-pressed={choice.solo}
          disabled={!soloOk}
          onClick={() => onChange({ ...choice, solo: !choice.solo })}
          title={soloOk ? `Mandar para Solos como ${dest.baseChild} Solo` : 'Guia, Click e Maestro não têm solo'}
        >
          É solo
        </button>
        <input
          type="text"
          className="h-7 flex-1 min-w-[8rem] px-2 rounded border border-black bg-black/45 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-logic-lcd-amber"
          placeholder={item.clipName}
          value={choice.rename ?? ''}
          aria-label="Nome do clipe"
          onChange={(e) => onChange({ ...choice, rename: e.target.value })}
        />
        <span className="text-2xs text-white/55 w-full">Vai para {trackName(dest.target)}, como {dest.childName}</span>
      </div>
    </div>
  );
});

/** Lista do que foi aprendido, com apagar um a um ou tudo. */
function LearnedList({ name }: { name: (id: RoutingTarget) => string }) {
  const list = useLearned();
  if (list.length === 0) {
    return <p className="text-2xs text-white/60 leading-relaxed">Nenhum nome aprendido ainda. Cada escolha confirmada aqui fica guardada neste computador.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="max-h-40 overflow-y-auto logic-scroll flex flex-col gap-1">
        {[...list].sort((a, b) => a.key.localeCompare(b.key)).map((e) => (
          <div key={e.key} className="flex items-center gap-2 px-2 py-1 rounded bg-black/35 text-2xs">
            <span className="font-semibold text-white/90 truncate">{e.key}</span>
            <span className="flex-1 text-white/60 truncate">{e.solo ? `Solos, ${e.childName} Solo` : `${name(e.target)}, ${e.childName}`}</span>
            <button type="button" className="console-key h-6 w-6 flex items-center justify-center text-white/70" aria-label={`Esquecer ${e.key}`} title="Esquecer" onClick={() => forgetLearned(e.key)}>
              <Trash2 size={11} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="console-key self-end h-6 px-2 text-2xs text-white/75" onClick={() => clearLearned()}>
        Esquecer tudo
      </button>
    </div>
  );
}

export default function RouteReviewDialog() {
  const review = useSyncExternalStore(subscribeRouteReview, currentRouteReview);
  const playingId = useSyncExternalStore(subscribeReviewPreview, currentPreviewClipId);
  const tracks = useStore((s) => s.tracks);
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>({});
  const [showLearned, setShowLearned] = useState(false);

  useEffect(() => {
    setChoices(Object.fromEntries((review?.items ?? []).map((i) => [i.clipId, initialChoice(i)])));
    setShowLearned(false);
  }, [review]);

  useEffect(() => {
    if (!review) return;
    // com a janela na tela, os atalhos do app (espaço toca, Delete apaga...) não valem
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); skipRouteReview(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [review]);

  // o clipe pode sumir (apagado, Desfazer da importação): a janela fecha sem ele
  const clipIds = useStore((s) => s.clips.map((c) => c.id).join('|'));
  const live = useMemo(() => {
    const ids = new Set(clipIds.split('|'));
    return (review?.items ?? []).filter((i) => ids.has(i.clipId));
  }, [review, clipIds]);
  useEffect(() => () => stopReviewPreview(), []);

  const trackName = useMemo(() => {
    const names = new Map(tracks.map((t) => [t.id, t.name]));
    return (id: RoutingTarget) => names.get(id) ?? id;
  }, [tracks]);

  if (!review) return null;
  const many = live.length !== 1;

  return createPortal(
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="vs-route-review-title">
      <div className="console-face w-[44rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg border border-black shadow-2xl font-stage text-white">
        <div className="flex items-center gap-2 px-3 h-11 border-b border-black shrink-0">
          <ListChecks size={14} className="text-logic-lcd-amber" aria-hidden />
          <span id="vs-route-review-title" className="console-legend uppercase text-logic-lcd-amber">Conferir faixas</span>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto logic-scroll min-h-0">
          <p className="text-xs text-white/85 leading-relaxed">
            {review.fromImport
              ? `${many ? `Estes ${live.length} áudios não dizem` : 'Este áudio não diz'} o instrumento no nome e a IA ficou em dúvida. Ouça, escolha a faixa e confirme.`
              : 'Todos os áudios desta música. Ouça, escolha a faixa e confirme.'}
            {' '}O programa guarda cada escolha confirmada e, nas próximas importações, o mesmo nome vai direto para a faixa.
          </p>
          {live.length === 0 ? (
            <p className="text-xs text-white/65">Nenhum áudio para conferir nesta música.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {live.map((item) => (
                <Row
                  key={item.clipId}
                  item={item}
                  choice={choices[item.clipId] ?? initialChoice(item)}
                  trackName={trackName}
                  playing={playingId === item.clipId}
                  onChange={(c) => setChoices((prev) => ({ ...prev, [item.clipId]: c }))}
                />
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <button type="button" className="self-start text-2xs text-white/70 underline underline-offset-2 hover:text-white" aria-expanded={showLearned} onClick={() => setShowLearned((v) => !v)}>
              {showLearned ? 'Esconder os nomes aprendidos' : 'Nomes aprendidos neste computador'}
            </button>
            {showLearned && <LearnedList name={trackName} />}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-black shrink-0">
          <button className="console-key px-3 h-7 text-xs text-white/80" onClick={() => (live.length ? skipRouteReview() : closeRouteReview())} title="Cada áudio fica com o palpite da IA">
            {live.length ? 'Pular' : 'Fechar'}
          </button>
          <button
            className="console-key px-3 h-7 text-xs text-logic-lcd-amber disabled:opacity-40"
            disabled={live.length === 0}
            onClick={() => confirmRouteReview(live.map((i) => choices[i.clipId] ?? initialChoice(i)))}
            autoFocus
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
