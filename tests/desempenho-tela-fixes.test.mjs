// Desempenho da tela no show: medidores sem redesenho do React, mixer e timeline que não redesenham
// tudo a cada movimento de fader, divisão de clipes recusada com a música tocando e aviso de
// atualização que espera a música parar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { meterMaskCover, publishMeters, resetMeters, subscribeMeters, meterLevel } from '../src/lib/meterBus.ts';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('medidor: parte apagada vai de 1 (silêncio, -48 dBFS ou menos) a 0 (0 dBFS ou mais)', () => {
  assert.equal(meterMaskCover(0), 1);
  assert.equal(meterMaskCover(Number.NaN), 1);
  assert.equal(meterMaskCover(-0.5), 1);
  assert.equal(meterMaskCover(10 ** (-60 / 20)), 1);
  assert.equal(meterMaskCover(10 ** (-48 / 20)), 1);
  assert.equal(meterMaskCover(10 ** (-24 / 20)), 0.5);
  assert.equal(meterMaskCover(10 ** (-12 / 20)), 0.25);
  assert.equal(meterMaskCover(1), 0);
  assert.equal(meterMaskCover(2), 0, 'acima de 0 dBFS a coluna fica cheia, sem passar');
  // igual à conta antiga da altura: 100 - (db + 48) / 48 * 100, em fração
  for (const db of [-47, -33.3, -18, -6, -0.5]) {
    const old = (100 - ((db + 48) / 48) * 100) / 100;
    assert.ok(Math.abs(meterMaskCover(10 ** (db / 20)) - old) <= 0.0005, `${db} dB`);
  }
});

test('medidor: avisa fora do React a cada publicação e para de avisar ao sair', () => {
  let calls = 0;
  const off = subscribeMeters(() => { calls += 1; });
  publishMeters(new Map([['faixa-teste', 0.5]]));
  assert.equal(calls, 1);
  assert.equal(meterLevel('faixa-teste'), 0.5);
  publishMeters(new Map([['faixa-teste', 0.5005]]));
  assert.equal(calls, 1, 'mudança mínima não avisa');
  resetMeters();
  assert.equal(calls, 2, 'zerar os medidores avisa (as colunas apagam)');
  off();
  publishMeters(new Map([['faixa-teste', 0.9]]));
  assert.equal(calls, 2);
  resetMeters();
});

test('medidor de LED muda só o transform, sem redesenhar pelo React', () => {
  const src = read('../src/components/MeterMask.tsx');
  assert.doesNotMatch(src, /useMeterLevel/);
  assert.match(src, /subscribeMeters\(apply\)/);
  assert.match(src, /el\.style\.transform = horizontal \? `scaleX\(\$\{cover\}\)` : `scaleY\(\$\{cover\}\)`/);
  assert.match(src, /will-change-transform/);
});

// sameTrackLayout de verdade, tirado do TimelinePanel.tsx (TSX não importa direto no node)
function loadSameTrackLayout() {
  const src = read('../src/components/TimelinePanel.tsx');
  const start = src.indexOf('const VOLATILE_TRACK_KEYS');
  const end = src.indexOf('\n}\n', src.indexOf('function sameTrackLayout')) + 2;
  assert.ok(start > 0 && end > start, 'sameTrackLayout no TimelinePanel');
  const js = stripTypeScriptTypes(src.slice(start, end));
  return new Function(`${js}\nreturn sameTrackLayout;`)();
}

test('timeline: fader, pan e LED de clip não contam como mudança de estrutura', () => {
  const same = loadSameTrackLayout();
  const children = ['b'];
  const a = [{ id: 'a', name: 'Banda', color: '#f00', volume: 0.8, pan: 0, mute: false, solo: false, height: 40, children, clipIndicator: false, clipPeak: 0, meterLevel: 0 }];
  assert.equal(same(a, a), true);
  assert.equal(same(a, [{ ...a[0], volume: 0.3 }]), true, 'volume');
  assert.equal(same(a, [{ ...a[0], pan: -1 }]), true, 'pan');
  assert.equal(same(a, [{ ...a[0], clipIndicator: true, clipPeak: 1.2 }]), true, 'LED de clip');
  assert.equal(same(a, [{ ...a[0], mute: true }]), false, 'mudo redesenha');
  assert.equal(same(a, [{ ...a[0], color: '#0f0' }]), false, 'cor redesenha (clipes pintados na cor da faixa)');
  assert.equal(same(a, [{ ...a[0], height: 60 }]), false, 'altura redesenha');
  assert.equal(same(a, [{ ...a[0], children: ['b', 'c'] }]), false, 'pasta redesenha');
  assert.equal(same(a, [{ ...a[0], outputStereo: true }]), false, 'campo novo redesenha');
  assert.equal(same(a, []), false);
});

test('timeline: lê só a estrutura das faixas; cada linha lê a própria faixa e é memo', () => {
  const src = read('../src/components/TimelinePanel.tsx');
  const panel = src.slice(src.indexOf('function TimelinePanel()'));
  assert.match(panel, /const tracks = useLayoutTracks\(\);/);
  assert.doesNotMatch(panel, /useStore\(\(s\) => s\.tracks\)/);
  assert.doesNotMatch(panel, /useStore\(\(s\) => s\.loadingSongIds\)/);
  assert.match(src, /const TrackRow = memo\(function TrackRow\(\{ track: trackProp,/);
  assert.match(src, /const track = useStore\(\(s\) => s\.tracks\.find\(\(t\) => t\.id === trackProp\.id\)\) \?\? trackProp;/);
  assert.match(src, /export default memo\(TimelinePanel\);/);
});

test('timeline: dividir com a música tocando é recusado (antes deixava as faixas mudas até o fim)', () => {
  const src = read('../src/components/TimelinePanel.tsx');
  const fn = src.slice(src.indexOf('const handleSplitAtCursor'), src.indexOf('const handleDeleteSelectedClips'));
  assert.match(fn, /if \(st\.transport\.isPlaying && st\.transport\.currentSongId === song\.id\) \{\s*setSplitHint\(true\);\s*return;\s*\}/);
  assert.ok(fn.indexOf('setSplitHint(true)') < fn.indexOf('splitClipsAt('), 'recusa antes de dividir');
  assert.match(src, /Pare para dividir/);
});

test('mixer: lista de canais por id (useShallow), canal memo com menu estável, clip do master como sim/não', () => {
  const src = read('../src/components/MixerPanel.tsx');
  const panel = src.slice(src.indexOf('function MixerPanel('));
  assert.match(src, /import \{ useShallow \} from 'zustand\/react\/shallow';/);
  assert.match(panel, /const allChannels = useStore\(useShallow\(/);
  assert.doesNotMatch(panel, /useStore\(\(s\) => s\.tracks\)/);
  assert.match(panel, /useStore\(\(s\) => s\.masterClipPeak >= 1\)/);
  assert.match(src, /const MixerChannel = memo\(function MixerChannel\(/);
  assert.match(panel, /onMenu=\{openTrackMenu\}/);
  assert.match(src, /export default memo\(MixerPanel\);/);
});

test('repertório: a raiz não assina mais faixas, clipes e músicas a cada mudança', () => {
  const src = read('../src/lib/useReferenceAutoSync.ts');
  for (const key of ['songs', 'clips', 'tracks', 'playlistOrder', 'lrMasterActive', 'lyricMaps']) {
    assert.doesNotMatch(src, new RegExp(`useStore\\(\\(s\\) => s\\.${key}\\)`), key);
  }
  assert.match(src, /useStore\.subscribe\(\(s, p\) => \{ if \(!sameProject\(s, p\)\) bump\(\); \}\)/);
  assert.match(src, /setTimeout\(\(\) => setRev\(\(n\) => n \+ 1\), REV_SETTLE_MS\)/);
  // o envio e a leitura continuam esperando a pessoa parar de mexer
  assert.match(src, /if \(Date\.now\(\) - lastChangeAt\.current < IDLE_MS\) return;/);
  assert.match(src, /if \(Date\.now\(\) - lastChangeAt\.current < READ_DELAY_MS\) return;/);
  assert.match(src, /const lists = useMemo\(\(\) => \{/);
});

test('atualização: tela cheia e barra esperam a música parar (tocando, em pausa ou no Modo Show)', () => {
  const src = read('../src/components/UpdateBanner.tsx');
  assert.match(src, /const showBusy = useStore\(\(s\) => !s\.transport\.isStopped \|\| s\.playlistMaximized\);/);
  assert.match(src, /const fullScreen = !!info\?\.required && \(!showBusy \|\| installing\);/);
  assert.match(src, /else if \(!info\.required && !showBusy\) setBarShown\(true\);/);
  assert.match(src, /if \(fullScreen\) \{/);
  assert.doesNotMatch(src, /if \(info\.required\) \{/);
});
