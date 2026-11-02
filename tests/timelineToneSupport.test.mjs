// Rolagem da timeline sem atraso, tom da fala do Maestro na taxa da placa e WhatsApp do suporte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

test('a coluna dos nomes e a régua seguem a rolagem da timeline no mesmo quadro', () => {
  const css = read('src/index.css');
  const tl = read('src/components/TimelinePanel.tsx');
  assert.match(css, /scroll-timeline: --vs-tl-y block, --vs-tl-x inline/, 'a timeline é a fonte da rolagem');
  assert.match(css, /animation-timeline: --vs-tl-y/, 'a coluna dos nomes segue a vertical');
  assert.match(css, /animation-timeline: --vs-tl-x/, 'a régua segue a horizontal');
  assert.match(tl, /timeline-follow-y/, 'a coluna usa o seguir da vertical');
  assert.match(tl, /--vs-follow-max-y/, 'o tamanho do caminho vem da timeline');
  // navegador sem o recurso: a cópia por código continua (a coluna rola sozinha nesse caso)
  assert.match(tl, /trackHeadersRef\.current\.scrollTop = el\.scrollTop/, 'reserva acompanha a vertical');
  assert.match(tl, /FOLLOW_SCROLL_CSS \? 'overflow-y-hidden' : 'overflow-y-auto'/, 'sem o recurso, a coluna pode rolar');
});

test('a fala do Maestro é gerada na taxa da placa de som (em 44,1 kHz numa saída de 48 kHz saía mais aguda)', () => {
  const src = read('src/lib/maestroVoice.ts');
  assert.ok(!/OfflineAudioContext\(\s*1\s*,\s*1\s*,\s*44100\s*\)/.test(src), 'nada de decodificar fixo em 44,1 kHz');
  assert.match(src, /currentSampleRate\(\) \?\? deviceSampleRate\(\)/, 'usa a taxa do motor (ou a da saída)');
  assert.match(read('src/lib/audioEngine.ts'), /currentSampleRate\(\): number \| null/);
});

test('todo botão de suporte do site vai para o WhatsApp do suporte', () => {
  for (const f of ['src/components/sales/SalesPage.tsx', 'src/components/sales/PricingPage.tsx', 'src/components/SubscriptionReturn.tsx']) {
    const s = read(f);
    assert.ok(!/wa\.me\/55\d+/.test(s), `${f} tem número fixo no lugar do número do suporte`);
    assert.ok(s.includes('supportWhatsAppUrl('), `${f} sem o botão do WhatsApp do suporte`);
  }
  assert.match(read('src/lib/support.ts'), /SUPPORT_WHATSAPP_NUMBER = '5511985393676'/);
});
