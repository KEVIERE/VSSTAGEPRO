// Lote 8: o orçamento do áudio aberto passa a sair da RAM real do computador (vsDesktop.totalMemory),
// com músicas, pads e click na mesma conta. Sem a RAM, a conta é a de antes, número por número.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

// a janela do programa com a RAM do computador: 4 GB (orçamento pequeno, para o teste do corte)
globalThis.window = globalThis;
globalThis.vsDesktop = { totalMemory: 4 * GIB };

const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
const stubs = {
  '@/store': 'export const useStore = { getState: () => ({ setSongLoading() {}, setSongIncomplete() {} }) };',
  '@/lib/audioDecoder': 'export const decodeBlob = async () => { throw new Error("sem decodificar no teste"); }; export const deviceSampleRate = () => 48000;',
};
export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  if (spec.startsWith('@/')) return next(SRC + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}
`));

const lib = await import('../src/lib/audioLibrary.ts');
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('sem a RAM: a mesma conta de antes (deviceMemory, 200 MB dos pads, 320 MB do click)', () => {
  const legacy = (gb, desktop) => Math.max(0.6, Math.min(3, gb * (desktop ? 0.35 : 0.2))) * GIB;
  for (const deviceMemory of [undefined, 0.5, 2, 4, 8]) {
    for (const desktop of [true, false]) {
      for (const totalMemory of [undefined, 0, -1, NaN]) {
        const b = lib.memoryBudgetFor({ totalMemory, deviceMemory, desktop });
        assert.equal(b.fromRam, false);
        assert.equal(b.songs, legacy(deviceMemory ?? 8, desktop));
        assert.equal(b.pads, 200 * MIB);
        assert.equal(b.click, 320 * MIB);
      }
    }
  }
  // o Mac de 8 GB e o de 16 GB recebem hoje os mesmos 2,8 GB (o deviceMemory para em 8)
  assert.equal(lib.memoryBudgetFor({ deviceMemory: 8, desktop: true }).songs, 2.8 * GIB);
});

test('com a RAM: 15% até 8 GB, 3 GB de músicas de 16 GB para cima, na proporção entre os dois', () => {
  const at = (gb) => lib.memoryBudgetFor({ totalMemory: gb * GIB, deviceMemory: 8, desktop: true });
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1, `${a} perto de ${b}`);
  close(at(8).total, 0.15 * 8 * GIB);
  close(at(4).total, 0.6 * GIB);
  close(at(2).total, 0.6 * GIB); // piso de 0,6 GB, o mesmo de antes
  const top = 3 * GIB + 200 * MIB + 320 * MIB;
  close(at(16).total, top);
  close(at(64).total, top);
  close(at(12).total, (0.15 * 8 * GIB + top) / 2);
  // de 16 GB para cima, nunca menos música aberta que hoje (2,8 GB pelo deviceMemory)
  for (const gb of [16, 24, 32, 64, 128]) {
    close(at(gb).songs, 3 * GIB);
    assert.ok(at(gb).songs >= lib.memoryBudgetFor({ deviceMemory: 8, desktop: true }).songs, `${gb} GB não perde orçamento`);
  }
  // conta do Mac de 8 GB (não é medida): 2,8 GB de músicas + 200 MB + 320 MB passam a 1,2 GB no total
  const mac8 = at(8);
  close(mac8.pads, 153.6 * MIB);
  close(mac8.click, 204.8 * MIB);
  close(mac8.songs, 1228.8 * MIB - 153.6 * MIB - 204.8 * MIB);
  close(at(16).pads, 200 * MIB);
  close(at(16).click, 320 * MIB);
  let prev = 0;
  for (let gb = 1; gb <= 64; gb += 0.5) {
    const b = at(gb);
    assert.equal(b.fromRam, true);
    close(b.songs + b.pads + b.click, b.total);
    assert.ok(b.songs > 0 && b.pads <= 200 * MIB && b.click <= 320 * MIB, `partes válidas com ${gb} GB`);
    assert.ok(b.total >= prev, 'mais RAM nunca dá orçamento menor');
    prev = b.total;
  }
});

test('a janela lê vsDesktop.totalMemory uma vez', () => {
  const b = lib.audioMemoryBudget();
  assert.equal(b.fromRam, true);
  assert.ok(Math.abs(b.total - 0.6 * GIB) < 1);
  globalThis.vsDesktop.totalMemory = 64 * GIB;
  assert.equal(lib.audioMemoryBudget(), b, 'calculado uma vez só');
});

test('o orçamento das músicas decide quais antigas saem; a protegida nunca sai', () => {
  // com 4 GB de RAM sobram cerca de 435 MB para músicas; cada música de mentira "ocupa" 200 MB
  const songs = lib.audioMemoryBudget().songs;
  assert.ok(songs > 400 * MIB && songs < 600 * MIB);
  const fake = (mb) => ({ channels: [{ byteLength: mb * MIB }], sampleRate: 48000, length: 1 });
  lib.putClipAudio('a1', 'A', fake(200));
  lib.putClipAudio('b1', 'B', fake(200));
  lib.putClipAudio('c1', 'C', fake(200));
  lib.retainSongs(['A']);
  assert.ok(lib.getClipAudio('a1'), 'A está protegida');
  assert.equal(lib.getClipAudio('b1'), null, 'B saiu (a usada há mais tempo)');
  assert.ok(lib.getClipAudio('c1'), 'C coube no orçamento');
  lib.retainSongs(['C']);
  assert.ok(lib.getClipAudio('a1'), 'A e C cabem juntas');
  lib.putClipAudio('d1', 'D', fake(200));
  lib.retainSongs(['D']);
  assert.equal(lib.getClipAudio('a1'), null, 'A saiu: usada antes de C');
  assert.ok(lib.getClipAudio('c1'));
  assert.ok(lib.getClipAudio('d1'));
  // uma música sozinha maior que o orçamento continua inteira enquanto protegida
  lib.putClipAudio('e1', 'E', fake(900));
  lib.retainSongs(['E']);
  assert.ok(lib.getClipAudio('e1'));
  lib.clearAudioLibrary();
});

test('pads: o teto vem da mesma conta e nunca passa dos 200 MB de antes', () => {
  const player = read('../src/lib/padPlayer.ts');
  assert.match(player, /import \{ audioMemoryBudget \} from '@\/lib\/audioLibrary';/);
  assert.match(player, /const BUFFER_BUDGET_BYTES = 200 \* 1024 \* 1024;/);
  assert.match(player, /return Math\.min\(BUFFER_BUDGET_BYTES, audioMemoryBudget\(\)\.pads\);/);
  assert.match(player, /const budget = bufferBudget\(\);\s*if \(total <= budget\) return;/);
  assert.doesNotMatch(player, /total <= BUFFER_BUDGET_BYTES/);
  assert.match(player, /if \(slotBank\(slot\) === bank \|\| voices\.has\(slot\)\) continue;/, 'o banco aberto e o que toca continuam fora do corte');
});
