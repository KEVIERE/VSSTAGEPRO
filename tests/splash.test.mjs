// Abertura do app do Mac (desktop/splash.html): o logo com a onda desenhada a laser, o nome em
// Outfit e a barra em verde-limão. Precisa caber no tempo do app e ser leve até nos Macs Intel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const splash = fs.readFileSync(new URL('../desktop/splash.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'));

test('a contagem cabe no tempo do app: "Pronto" antes da saída', () => {
  const pronto = Number(/\{ at: (\d+), progress: 1, text: 'Pronto' \}/.exec(splash)?.[1]);
  const min = Number(/const SPLASH_MIN_MS = (\d+);/.exec(main)?.[1]);
  assert.ok(pronto > 0 && min > 0);
  assert.ok(pronto < min, `"Pronto" (${pronto} ms) cai antes da saída (${min} ms)`);
  assert.match(splash, /e\.data === 'vs:go'/);
  assert.match(splash, /e\.data === 'vs:leave'/, 'o app avisa a saída e a abertura some em fade');
});

test('leve até no Intel: nenhuma animação mexe em filtro e sem desfoque do fundo', () => {
  const keyframes = [...splash.matchAll(/@keyframes [\w-]+ \{([^@]*?)\}\s*\}/g)].map((m) => m[1]).join('\n');
  assert.doesNotMatch(keyframes, /filter/, 'animar filtro redesenha o desfoque a cada quadro');
  assert.doesNotMatch(splash, /backdrop-filter/, 'janela transparente: o desfoque do fundo não faz nada e só gasta');
  assert.doesNotMatch(splash, /class="wave-draw"[^>]*filter=/, 'o traço que anda não leva filtro');
});

test('as fontes usadas viajam no instalador', () => {
  const fonts = [...splash.matchAll(/url\('(build\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.ok(fonts.length > 0);
  for (const f of fonts) assert.ok(pkg.build.files.includes(f), `${f} está no package.json`);
  assert.match(splash, /class="title"[^>]*>VS Stage Pro</, 'o nome da marca, em Outfit');
});

test('sem luz azul em volta do logo: o ícone tem luz neutra e a aura é branca', () => {
  for (const blue of ['#00d9ff', '#1c56ff', '#2a6cff', '#8cfaff', '#00d5ff']) {
    assert.ok(!splash.includes(blue), `luz azul ${blue} não aparece`);
  }
  assert.doesNotMatch(splash, /neon-glow-(wide|mid)/, 'sem halo colorido desfocado em volta da onda');
});

