// Lote 1 do plano de velocidade (timeline e edição): arrastes, retângulo de seleção, régua de BPM,
// rolagem e recorte vertical sem redesenhar a timeline inteira, e fade/ganho de vários clipes numa
// ação só do store com o mesmo estado final. Os componentes (TSX) não abrem no node: as contas
// ficam em src/lib/timelineView.ts (testadas de verdade) e o resto é conferido no código-fonte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import {
  createViewValue, dragOf, draggedGrid, rowInRows, rowTops, rowsWindow, ROWS_QUANTUM, sameIdList,
  setTimelineRows, timelineRowsView, tempoDragView, moveDragView, trimDragView,
} from '../src/lib/timelineView.ts';
import { moveTempoChange, songGrid, tempoChangeIndex } from '../src/lib/grid.ts';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const panelSrc = read('../src/components/TimelinePanel.tsx');
const panelBody = panelSrc.slice(panelSrc.indexOf('function TimelinePanel()'));
const storeSrc = read('../src/store.ts');
const gridSrc = read('../src/components/TimelineGrid.tsx');
const regionSrc = read('../src/components/RegionLane.tsx');
const medleySrc = read('../src/components/MedleyLane.tsx');
const narrationSrc = read('../src/components/NarrationLane.tsx');

/** Imita o useSyncExternalStore: quem assina só redesenha quando o resultado do seletor muda. */
function subscriber(view, select) {
  const me = { renders: 0, last: select(view.get()) };
  me.off = view.subscribe(() => {
    const next = select(view.get());
    if (!Object.is(next, me.last)) { me.last = next; me.renders += 1; }
  });
  return me;
}

test('valor da vista: avisa só quando muda e para de avisar ao sair', () => {
  const v = createViewValue(null);
  let calls = 0;
  const off = v.subscribe(() => { calls += 1; });
  const a = { x: 1 };
  v.set(a);
  v.set(a);
  assert.equal(calls, 1, 'o mesmo objeto não avisa');
  assert.equal(v.get(), a);
  v.set(null);
  assert.equal(calls, 2);
  off();
  v.set({ x: 2 });
  assert.equal(calls, 2);
});

test('arrastar 1 clipe numa música de 200: só ele redesenha a cada movimento (antes, todos)', () => {
  const clips = Array.from({ length: 200 }, (_, i) => `c${i}`);
  const blocks = clips.map((id) => subscriber(moveDragView, (d) => dragOf(d, id)));
  const ids = new Set(['c7']);
  for (let step = 1; step <= 30; step++) {
    // cada movimento do mouse grava um objeto novo (delta e rótulo novos), com o mesmo conjunto
    moveDragView.set({ ids, delta: step * 0.01, anchorId: 'c7', start: step, label: `${step}` });
  }
  moveDragView.set(null);
  const renders = blocks.map((b) => b.renders);
  assert.equal(renders[7], 31, '30 movimentos e a soltura');
  assert.equal(renders.reduce((n, r) => n + r, 0), 31, 'nenhum outro clipe redesenhou');
  // Antes: o painel passava o mesmo moveDrag para todos os ClipBlock e o memo comparava por
  // identidade (a.move === b.move): os 200 redesenhavam a cada movimento (200 x 31 = 6200 renders).
  for (const b of blocks) b.off();
});

test('o painel lê só o conjunto do arraste: redesenha ao começar e ao soltar, não a cada movimento', () => {
  const panel = subscriber(trimDragView, (d) => d?.ids ?? null);
  const ids = new Set(['a', 'b']);
  for (let step = 0; step < 50; step++) trimDragView.set({ ids, delta: step, anchorId: 'a', end: step, label: '', side: 'end' });
  trimDragView.set(null);
  assert.equal(panel.renders, 2);
  panel.off();
});

test('dragOf: o arraste só para os clipes que ele leva', () => {
  const d = { ids: new Set(['x']), delta: 1 };
  assert.equal(dragOf(d, 'x'), d);
  assert.equal(dragOf(d, 'y'), null);
  assert.equal(dragOf(null, 'x'), null);
});

test('placa de BPM arrastada: a grade mostrada é a mesma conta de antes (shownGrid do painel)', () => {
  const song = { bpm: 120, beatsPerBar: 4, tempoSegments: [{ startTime: 0, endTime: 8, bpm: 120 }, { startTime: 8, endTime: 24, bpm: 90 }, { startTime: 24, endTime: 60, bpm: 140 }] };
  const grid = songGrid(song);
  // o código que estava no TimelinePanel
  const old = (g, drag) => {
    if (!g?.tempoSegments || !drag) return g;
    const index = tempoChangeIndex(g.tempoSegments, drag.from);
    return index < 1 ? g : { ...g, tempoSegments: moveTempoChange(g.tempoSegments, index, drag.to, { keepPhase: !drag.exact, beatsPerBar: g.beatsPerBar }) };
  };
  assert.equal(draggedGrid(grid, null), grid, 'sem arraste, a própria grade (nada redesenha)');
  assert.equal(draggedGrid(null, { from: 8, to: 10 }), null);
  for (const drag of [{ from: 8, to: 10 }, { from: 8, to: 6.5, exact: true }, { from: 24, to: 26 }, { from: 0.2, to: 3 }]) {
    assert.deepEqual(draggedGrid(grid, drag), old(grid, drag), JSON.stringify(drag));
  }
  // música de um andamento só: nada muda
  const plain = songGrid({ bpm: 100, beatsPerBar: 4 });
  assert.equal(draggedGrid(plain, { from: 4, to: 6 }), plain);
});

test('régua de BPM: as placas, a régua e as linhas assinam o arraste; o painel não guarda mais o arraste', () => {
  assert.match(gridSrc, /tempoDragView\.set\(\{ from: time, to, exact \}\)/);
  assert.match(gridSrc, /tempoDragView\.set\(null\);\n\s*if \(moved && Math\.abs\(to - time\) > 1e-4\) moveTempoAt\(song\.id, time, to, exact\);/, 'grava só ao soltar, como antes');
  assert.equal((gridSrc.match(/const grid = useShownGrid\(baseGrid\);/g) ?? []).length, 3, 'régua, placas e linhas');
  assert.doesNotMatch(panelBody, /\btempoDrag\b|setTempoDrag|shownGrid|onTempoDrag/);
  // grudada no mesmo compasso, o arraste não grava de novo (nada redesenha)
  assert.match(gridSrc, /if \(!shown \|\| shown\.from !== time \|\| shown\.to !== to \|\| !!shown\.exact !== exact\) tempoDragView\.set/);
  const ruler = subscriber(tempoDragView, (d) => d);
  tempoDragView.set({ from: 8, to: 10, exact: false });
  tempoDragView.set(null);
  assert.equal(ruler.renders, 2);
  ruler.off();
});

test('faixa vertical: a tela e mais uma tela de folga, em blocos', () => {
  assert.deepEqual(rowsWindow(0, 600), { top: 0, bottom: 1280 });
  const w = rowsWindow(2000, 600);
  assert.equal(w.top % ROWS_QUANTUM, 0);
  assert.equal(w.bottom % ROWS_QUANTUM, 0);
  assert.ok(w.top <= 2000 - 600 && w.bottom >= 2000 + 600 + 600, 'uma tela acima e uma abaixo');
  // rolar menos que um bloco não muda a faixa (as linhas não redesenham)
  assert.deepEqual(rowsWindow(2010, 600), rowsWindow(2000, 600));
  // tela baixinha: folga mínima de 200 px
  assert.ok(rowsWindow(1000, 50).top <= 800);
  assert.ok(rowsWindow(1000, 50).bottom >= 1250);
});

test('recorte vertical: as linhas longe da tela ficam sem clipes; topo de cada linha pela altura', () => {
  const heights = [40, 40, 70, 40, 40];
  assert.deepEqual(rowTops(heights), [0, 40, 80, 150, 190]);
  const rows = { top: 256, bottom: 768 };
  assert.equal(rowInRows(0, 40, rows), false);
  assert.equal(rowInRows(230, 40, rows), true, 'cruza a borda de cima');
  assert.equal(rowInRows(760, 40, rows), true, 'cruza a borda de baixo');
  assert.equal(rowInRows(768, 40, rows), false);
  // a linha só redesenha quando entra ou sai (o seletor devolve sim/não)
  const lane = subscriber(timelineRowsView, (r) => rowInRows(1000, 40, r ?? { top: 0, bottom: 1280 }));
  setTimelineRows({ top: 0, bottom: 1280 });
  setTimelineRows({ top: 0, bottom: 1280 });
  setTimelineRows({ top: 256, bottom: 1536 });
  assert.equal(lane.renders, 0, 'continua dentro');
  setTimelineRows({ top: 1280, bottom: 2560 });
  assert.equal(lane.renders, 1, 'saiu');
  setTimelineRows(null);
  lane.off();
});

test('recorte vertical no código: linha vazia com a mesma altura, arrastados sempre montados', () => {
  const lane = panelSrc.slice(panelSrc.indexOf('const TrackLane = memo(function TrackLane('), panelSrc.indexOf('/** Retângulo de seleção'));
  assert.match(lane, /const inRows = useViewValue\(timelineRowsView, \(rows\) => rowInRows\(top, span, rows \?\? firstRows\(\)\)\);/);
  assert.match(lane, /!!trimIds\?\.has\(c\.id\) \|\| !!moveIds\?\.has\(c\.id\) \|\| \(inRows && spanInView\(c\.startTime, c\.duration, zoomH, visible\)\)/);
  assert.match(lane, /style=\{\{ height: `\$\{rowHeight\}px` \}\}/, 'a linha fica com a altura, com ou sem clipes');
  assert.match(lane, /data-lane-track-id=\{track\.id\}/, 'retângulo e arraste para outra trilha continuam achando a linha');
  // a altura que o painel soma para o topo é a mesma que a linha usa
  assert.match(panelBody, /const rowHeight = track\.id === TIMECODE_TRACK_ID \? trackHeight : Math\.round\(\(track\.height \?\? 40\) \* zoomV\);\n\s*return rowHeight \+ \(track\.id === 'track-maestro' \? maestroLaneHeight : 0\);/);
  assert.match(panelBody, /const rowHeight = isTc \? trackHeight : Math\.round\(\(track\.height \?\? 40\) \* zoomV\);/);
  assert.match(panelBody, /setTimelineRows\(rowsWindow\(el\.scrollTop, el\.clientHeight\)\);/);
});

test('mesma lista de ids', () => {
  assert.equal(sameIdList(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameIdList(['a', 'b'], ['b', 'a']), false);
  assert.equal(sameIdList(['a'], ['a', 'b']), false);
  const x = ['q'];
  assert.equal(sameIdList(x, x), true);
});

// Funções do store tiradas do código (o store importa '@/...', que o node não resolve)
function loadStoreHelpers() {
  const start = storeSrc.indexOf('export type ClipFadePatch');
  const end = storeSrc.indexOf('const DEFAULT_TRACKS');
  assert.ok(start > 0 && end > start, 'ajudantes do fade, do ganho e da seleção no store');
  const js = stripTypeScriptTypes(storeSrc.slice(start, end));
  return new Function(`${js}\nreturn { withClipFade, clipGainIn, sameSelection };`)();
}

test('fade de vários clipes numa ação só: o mesmo estado final de um ajuste por clipe', () => {
  const { withClipFade } = loadStoreHelpers();
  const clips = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, startTime: i, duration: 10, fadeIn: i % 3, fadeOut: 0, fadeCurveIn: 'linear' }));
  const targets = ['c2', 'c5', 'c9', 'c11'];
  for (const patch of [{ fadeIn: 1.25 }, { fadeOut: -3 }, { fadeCurveIn: 's-curve' }, { fadeIn: 0.5, fadeCurveOut: 'exponential' }]) {
    // antes: um setClipFade por clipe
    let one = clips;
    for (const id of targets) one = one.map((c) => (c.id === id ? withClipFade(c, patch) : c));
    // agora: setClipsFade com a lista
    const ids = new Set(targets);
    const batch = clips.map((c) => (ids.has(c.id) ? withClipFade(c, patch) : c));
    assert.deepEqual(batch, one, JSON.stringify(patch));
    // os clipes fora da lista são os mesmos objetos (quem compara por referência vê igual)
    batch.forEach((c, i) => { if (!ids.has(c.id)) assert.equal(c, clips[i]); });
  }
});

test('ganho de vários clipes numa ação só: mesmo limite (0 a 4x) e mesmo estado final', () => {
  const { clipGainIn } = loadStoreHelpers();
  assert.equal(clipGainIn(-1), 0);
  assert.equal(clipGainIn(9), 4);
  assert.equal(clipGainIn(1.5), 1.5);
  const clips = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, gain: 1 }));
  const targets = ['c1', 'c3', 'c4'];
  let one = clips;
  for (const id of targets) one = one.map((c) => (c.id === id ? { ...c, gain: clipGainIn(2.5) } : c));
  const ids = new Set(targets);
  assert.deepEqual(clips.map((c) => (ids.has(c.id) ? { ...c, gain: clipGainIn(2.5) } : c)), one);
});

test('store: as ações em lote usam a mesma conta das ações de um clipe', () => {
  assert.match(storeSrc, /setClipFade: \(clipId, patch\) => set\(\(s\) => \(\{\n\s*clips: s\.clips\.map\(\(c\) => \(c\.id === clipId \? withClipFade\(c, patch\) : c\)\),/);
  assert.match(storeSrc, /setClipsFade: \(clipIds, patch\) => set\(\(s\) => \{\n\s*const ids = new Set\(clipIds\);\n\s*return \{ clips: s\.clips\.map\(\(c\) => \(ids\.has\(c\.id\) \? withClipFade\(c, patch\) : c\)\) \};/);
  assert.match(storeSrc, /setClipGain: \(clipId, gain\) => set\(\(s\) => \(\{\n\s*clips: s\.clips\.map\(\(c\) => c\.id === clipId \? \{ \.\.\.c, gain: clipGainIn\(gain\) \} : c\),/);
  assert.match(storeSrc, /setClipsGain: \(clipIds, gain\) => set\(\(s\) => \{\n\s*const ids = new Set\(clipIds\);\n\s*return \{ clips: s\.clips\.map\(\(c\) => ids\.has\(c\.id\) \? \{ \.\.\.c, gain: clipGainIn\(gain\) \} : c\) \};/);
  // a timeline chama uma ação por movimento, com a lista lida no começo do gesto
  assert.match(panelSrc, /setClipsFade\(targets, patch\);/);
  assert.match(panelSrc, /setClipsGain\(targets, g\);/);
  assert.doesNotMatch(panelSrc, /targets\.forEach\(\(id\) => setClip(Fade|Gain)\(id/);
});

test('seleção igual à de agora: o store devolve o estado como está (nada redesenha)', () => {
  const { sameSelection } = loadStoreHelpers();
  assert.equal(sameSelection(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameSelection(['a', 'b'], ['b', 'a']), false);
  assert.equal(sameSelection([], []), true);
  assert.equal((storeSrc.match(/return sameSelection\(next, s\.selectedClipIds\) \? s : \{ selectedClipIds: next \};/g) ?? []).length, 2, 'selectClip e selectClips');
  // o caminho do clique na grade vazia continua o mesmo
  assert.match(storeSrc, /if \(!id\) return s\.selectedClipIds\.length === 0 \? \{\} : \{ selectedClipIds: \[\] \};/);
});

test('retângulo de seleção: linhas medidas uma vez, seleção só quando muda, retângulo fora do painel', () => {
  const fn = panelSrc.slice(panelSrc.indexOf('const startMarquee'), panelSrc.indexOf('const handleMoveStart'));
  const move = fn.slice(fn.indexOf('const move = (ev: PointerEvent) => {'));
  assert.doesNotMatch(move, /getBoundingClientRect|querySelectorAll/, 'nada lido da tela a cada movimento');
  assert.match(fn, /if \(picked && sameIdList\(picked, next\)\) return;\n\s*picked = next;\n\s*selectClips\(next\);/);
  assert.match(fn, /marqueeView\.set\(\{ left, top, width, height \}\);/);
  assert.match(fn, /scroller\?\.removeEventListener\('scroll', onScroll\);/);
  assert.doesNotMatch(panelBody, /setMarquee|useState<\{ left: number; top: number; width: number; height: number \}/);
});

test('arraste de clipe: linhas medidas uma vez; o painel não guarda o arraste em estado', () => {
  const fn = panelSrc.slice(panelSrc.indexOf('const handleMoveStart'), panelSrc.indexOf('// Versões estáveis dos handlers'));
  const laneUnder = fn.slice(fn.indexOf('const laneUnder'), fn.indexOf('const describe'));
  assert.doesNotMatch(laneUnder, /getBoundingClientRect|querySelectorAll/);
  assert.match(fn, /root\?\.removeEventListener\('scroll', onLaneScroll\);/);
  // o som ao vivo recebe a mesma posição de antes, e o store só é gravado ao soltar
  assert.match(fn, /audioEngine\.updateLiveClipPosition\(c\.id, Math\.max\(0, c\.startTime \+ delta\)\);/);
  assert.match(fn, /patch: \{ startTime: Math\.max\(0, c\.startTime \+ delta\) \},/);
  assert.doesNotMatch(panelBody, /useState<(TrimDrag|MoveDrag)>/);
  assert.match(panelBody, /const trimIds = useViewValue\(trimDragView, \(d\) => d\?\.ids \?\? null\);/);
  assert.match(panelBody, /const moveIds = useViewValue\(moveDragView, \(d\) => d\?\.ids \?\? null\);/);
  // o ClipBlock assina só o arraste dele e não recebe mais o arraste pelas props
  const block = panelSrc.slice(panelSrc.indexOf('const ClipBlock = memo(function ClipBlock('), panelSrc.indexOf('}, sameClipBlockProps);'));
  assert.match(block, /const trim = useViewValue\(trimDragView, \(d\) => dragOf\(d, clip\.id\)\);/);
  assert.match(block, /const move = useViewValue\(moveDragView, \(d\) => dragOf\(d, clip\.id\)\);/);
  const same = panelSrc.slice(panelSrc.indexOf('function sameClipBlockProps('), panelSrc.indexOf('// Cor de cada faixa'));
  assert.doesNotMatch(same, /\.trim|\.move/);
  assert.doesNotMatch(panelSrc, /trim=\{trimDrag\}|move=\{moveDrag\}/);
});

test('pastas: memo com abrir e fechar estável; trilhas de dentro com o mesmo toggle', () => {
  assert.match(panelSrc, /const NOOP = \(\) => \{\};/);
  assert.match(panelSrc, /onToggle=\{NOOP\}/);
  assert.doesNotMatch(panelSrc, /onToggle=\{\(\) => \{\}\}/);
  assert.match(panelSrc, /const FolderGroup = memo\(function FolderGroup\(/);
  assert.match(panelSrc, /const ChildTrackRow = memo\(function ChildTrackRow\(/);
  assert.match(panelSrc, /onToggleFolder=\{toggleFolder\}/);
  assert.doesNotMatch(panelSrc, /onToggle=\{\(\) => toggleFolder\(track\.id\)\}/);
});

test('Play, Stop e progresso não redesenham o painel; FooterProgress assina sozinho', () => {
  assert.doesNotMatch(panelBody, /useStore\(\(s\) => s\.transport\.isPlaying\)/);
  assert.doesNotMatch(panelBody, /useStore\(\(s\) => s\.importProgress\)|useStore\(\(s\) => s\.exportProgress\)/);
  assert.match(panelBody, /<FooterProgress \/>/);
  const footer = panelSrc.slice(panelSrc.indexOf('const FooterProgress = memo(function FooterProgress()'));
  assert.match(footer, /useStore\(\(s\) => s\.importProgress\)/);
  assert.match(footer, /useStore\(\(s\) => s\.exportProgress\)/);
  assert.equal((panelBody.match(/useStore\.getState\(\)\.transport\.isPlaying && song/g) ?? []).length, 2, 'régua e clique na grade leem na hora');
});

test('seleção: alças de fade e botão de ganho não assinam a seleção inteira', () => {
  const fade = panelSrc.slice(panelSrc.indexOf('function FadeHandle('), panelSrc.indexOf('type ClipBlockProps'));
  const knob = panelSrc.slice(panelSrc.indexOf('function ClipGainKnob('), panelSrc.indexOf('function ClipMuteSolo('));
  for (const src of [fade, knob]) assert.doesNotMatch(src, /useStore\(\(s\) => s\.selectedClipIds\)/);
  assert.match(panelSrc, /function clipTargets\(clipId: string\): string\[\] \{\n\s*const sel = useStore\.getState\(\)\.selectedClipIds;\n\s*return sel\.includes\(clipId\) && sel\.length > 1 \? sel : \[clipId\];/, 'a mesma regra de antes');
  // o menu da curva do fade vai para o <body> (o filtro e o overflow do clipe não mexem nele)
  assert.match(fade, /\{menuPos && createPortal\(/);
  assert.match(fade, /document\.body,\n\s*\)\}/);
});

test('rolagem: um ouvinte só, painel sem assinar a janela visível, barra de baixo sem setState', () => {
  assert.doesNotMatch(panelSrc, /onScroll=\{handleScroll\}|const handleScroll/);
  assert.doesNotMatch(panelBody, /const visible = useTimelineVisible\(\);/);
  assert.match(panelBody, /\}, \[syncHeaders, updateVisible, hasSong\]\);/, 'ligado de novo quando a música aparece');
  assert.match(panelBody, /<AfterVisibleCommit onCommit=\{followAfterVisible\} \/>/);
  const bar = panelSrc.slice(panelSrc.indexOf('const TimelineHorizontalScrollbar = memo('), panelSrc.indexOf('function firstRows()'));
  assert.doesNotMatch(bar, /useState\(/);
  assert.match(bar, /th\.style\.left = `\$\{t\.left\}%`;/);
  // régua, placas e linhas assinam a janela sozinhas
  assert.match(panelBody, /<RulerCanvas grid=\{song \? grid : null\} hasGrid=\{!!grid\} zoomH=\{zoomH\} contentEnd=\{contentEnd\} hub=\{canvasHub\} \/>/);
  assert.match(panelBody, /<GridLinesCanvas grid=\{grid\} zoomH=\{zoomH\} timelineWidth=\{timelineWidth\} hub=\{canvasHub\} \/>/);
  assert.equal((gridSrc.match(/const visible = useShownVisible\(visibleProp\);/g) ?? []).length, 3);
  // a régua das falas assina a janela e o arraste sozinha
  assert.match(narrationSrc, /const visible = visibleProp \?\? liveVisible;/);
  assert.match(narrationSrc, /const move = useViewValue\(moveDragView, /);
  assert.match(narrationSrc, /const clipLayer = typeof clipLayerProp === 'function' \? clipLayerProp\(visible\) : clipLayerProp;/);
});

test('regiões e medley: memo, e o arraste da região fora do painel', () => {
  assert.match(read('../src/lib/timelineView.ts'), /export const regionDragView = createViewValue<RegionDrag>\(null\);/);
  assert.match(regionSrc, /const drag = useViewValue\(regionDragView\);/);
  assert.match(regionSrc, /export const RegionLane = memo\(function RegionLane\(\{ song, zoomH, editingId, onEdit \}: RegionLaneProps\)/);
  assert.match(regionSrc, /export const RegionGuides = memo\(function RegionGuides\(\{ song \}: \{ song: Song \}\)/);
  assert.doesNotMatch(panelBody, /regionDrag\b|setRegionDrag|onDragChange/);
  assert.match(panelBody, /regionDragView\.set\(null\);/, 'trocar de música solta o arraste, como antes');
  assert.match(medleySrc, /export const MedleyLane = memo\(function MedleyLane\(/);
  assert.match(gridSrc, /export const GridToolbar = memo\(function GridToolbar\(/);
});
