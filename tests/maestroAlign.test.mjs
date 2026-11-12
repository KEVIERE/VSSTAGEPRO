// Alinhamento vertical entre a coluna dos nomes das faixas e a timeline.
// Regra simples, que era violada em três pontos e por isso tudo abaixo ficava deslocado:
// toda altura da coluna esquerda tem de ser a MESMA expressão da altura da linha na timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src', 'components', 'TimelinePanel.tsx'), 'utf8');

test('o cabeçalho do Maestro IA acompanha o zoom, igual à régua da timeline', () => {
  const header = src.slice(src.indexOf('function MaestroIaHeader'), src.indexOf('function ', src.indexOf('function MaestroIaHeader') + 10));
  assert.match(header, /zoomV/, 'o cabeçalho lê o zoom vertical');
  assert.match(header, /Math\.round\(NARRATION_LANE_HEIGHT \* zoomV\)/, 'mesma conta da régua');
  assert.ok(!/height: `\$\{NARRATION_LANE_HEIGHT\}px`/.test(header), 'nada de altura fixa de 30px');
});

test('a régua do Maestro na timeline usa a mesma conta do cabeçalho', () => {
  assert.match(src, /const maestroLaneHeight = Math\.round\(NARRATION_LANE_HEIGHT \* zoomV\)/);
  assert.match(src, /height=\{maestroLaneHeight\}/);
});

test('pasta recolhida é uma linha só, na coluna dos nomes e na timeline', () => {
  // Antes a timeline somava a altura das filhas escondidas enquanto a coluna mostrava uma
  // linha só: tudo abaixo de uma pasta recolhida ficava desalinhado.
  assert.doesNotMatch(src, /mergedHeight/, 'a timeline não soma a altura das filhas escondidas');
  assert.match(src, /style=\{\{ height: `\$\{rowHeight\}px` \}\}/, 'a linha da timeline usa a mesma altura da coluna');
  assert.match(src, /\{expanded && track\.children\.map\(/, 'a coluna esconde as filhas da pasta recolhida');
  assert.match(src, /if \(track\.isSubgroup && !collapsedFolders\.has\(track\.id\)\)/, 'a timeline esconde as mesmas filhas');
});

test('a coluna dos nomes rola junto com a timeline, no mesmo quadro (sem atraso)', () => {
  // a coluna e a régua seguem a rolagem pelo próprio navegador (animação ligada à rolagem)
  const css = fs.readFileSync(path.join(here, '..', 'src', 'index.css'), 'utf8');
  assert.match(css, /scroll-timeline: --vs-tl-y block, --vs-tl-x inline/, 'a timeline é a fonte da rolagem');
  assert.match(css, /animation-timeline: --vs-tl-y/, 'a coluna dos nomes segue a vertical');
  assert.match(css, /animation-timeline: --vs-tl-x/, 'a régua segue a horizontal');
  assert.match(src, /timeline-follow-y/, 'a coluna usa o seguir da vertical');
  assert.match(src, /--vs-follow-max-y/, 'o tamanho do caminho vem da timeline');
  // navegador sem o recurso: a cópia por código continua (a coluna rola sozinha nesse caso)
  assert.match(src, /const syncHeaders = useCallback/, 'a sincronização de reserva fica numa função só');
  assert.match(src, /trackHeadersRef\.current\.scrollTop = el\.scrollTop/, 'reserva acompanha a vertical');
  assert.match(src, /FOLLOW_SCROLL_CSS \? 'overflow-y-hidden' : 'overflow-y-auto'/, 'sem o recurso, a coluna pode rolar');
});
