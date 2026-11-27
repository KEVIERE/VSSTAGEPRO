import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

// O store importa módulos com '@/...', que o node não resolve: os testes conferem o código-fonte.

test('selectClip(null) sem seleção não troca a referência (não redesenha a timeline)', () => {
  const store = read('src', 'store.ts');
  assert.match(store, /if \(!id\) return s\.selectedClipIds\.length === 0 \? \{\} : \{ selectedClipIds: \[\] \};/);
});

test('arrasto na régua grava a posição no máximo uma vez por quadro e a final no pointerup', () => {
  const tl = read('src', 'components', 'TimelinePanel.tsx');
  const start = tl.indexOf('const handleRulerPointerDown');
  const body = tl.slice(start, tl.indexOf('}, [zoomH, setCurrentTime', start));
  assert.match(body, /rafId = requestAnimationFrame\(/);
  assert.match(body, /if \(rafId\) return;/);
  assert.match(body, /if \(rafId\) \{ cancelAnimationFrame\(rafId\); rafId = 0; \}/);
  assert.match(body, /setCurrentTime\(finalT\)/);
});

test('TransportBar não assina o transporte inteiro', () => {
  const tb = read('src', 'components', 'TransportBar.tsx');
  assert.doesNotMatch(tb, /useStore\(\(s\) => s\.transport\)/);
  for (const sel of ['selCurSliceId', 'selNextSliceId', 'selBpmHere', 'selSliceBpmAdjust', 'selTunerHere', 'selFinalCountdown']) {
    assert.match(tb, new RegExp(`useStore\\(${sel}\\)`), sel);
  }
  assert.match(tb, /<KeyBadge songId=\{currentSong\.id\} tuner=\{tunerHere\} \/>/);
});

test('assinatura do Remote só é recalculada quando alguma entrada muda', () => {
  for (const f of ['useLocalBroadcast.ts', 'useOnlineRemote.ts']) {
    const src = read('src', 'lib', f);
    assert.match(src, /function remoteInputsChanged\(a: RemoteSigInputs, b: RemoteSigInputs\): boolean/, f);
    assert.match(src, /if \((remoteInputs|sigInputs)\) \{/, f);
  }
});

test('Home e End levam o cursor ao início e ao fim da música', () => {
  // as teclas passaram para o tratador único de atalhos (src/lib/shortcuts)
  const cmds = read('src', 'lib', 'shortcuts', 'appCommands.ts');
  assert.match(cmds, /on\('transport\.goToStart'[\s\S]*?if \(!song\) return false;[\s\S]*?seekToPosition\(song\.id, 0\)/);
  assert.match(cmds, /on\('transport\.goToEnd'[\s\S]*?if \(!song\) return false;[\s\S]*?seekToPosition\(song\.id, Math\.max\(0, song\.duration\)\)/);
  // campo de texto e lista de escolha (SELECT) não disparam
  const core = read('src', 'lib', 'shortcuts', 'dispatchCore.ts');
  assert.match(core, /if \(inText && !def\.inText\) continue;/);
  assert.match(core, /if \(inSelect && !def\.inSelect\) continue;/);
});

test('ClipBlock em memo com handlers estáveis', () => {
  const tl = read('src', 'components', 'TimelinePanel.tsx');
  assert.match(tl, /const ClipBlock = memo\(function ClipBlock\(/);
  assert.match(tl, /\}, sameClipBlockProps\);/);
  assert.doesNotMatch(tl, /onTrimStart=\{handleTrimStart\}/);
  assert.doesNotMatch(tl, /onMoveStart=\{handleMoveStart\}/);
  assert.match(tl, /const stableTrimStart = useCallback\(/);
  assert.match(tl, /const stableMoveStart = useCallback\(/);
});
