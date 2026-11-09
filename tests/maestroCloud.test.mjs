// Vozes online do Maestro por IA e contato do suporte. As vozes pagas (Replicate: Gemini e
// ElevenLabs) foram tiradas: o dono do projeto não quer nada pago, e o Supabase tem limite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ONLINE_PACKS, isOnlineVoice, onlineVoiceById } from '../src/lib/onlineVoices.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('nenhuma voz paga: a função do servidor e a Replicate não fazem parte do app de voz', () => {
  assert.ok(!fs.existsSync(path.join(here, '..', 'supabase', 'functions', 'maestro-voice')), 'a função paga saiu do projeto');
  for (const f of ['src/lib/maestroCloud.ts', 'src/lib/onlineVoices.ts', 'src/lib/maestroVoice.ts']) {
    const s = fs.readFileSync(path.join(here, '..', f), 'utf8');
    assert.ok(!/replicate|elevenlabs|gemini-3|functions\/v1\/maestro-voice/i.test(s.replace(/\/\/.*$/gm, '')), `${f} ainda fala com serviço pago`);
  }
});

test('o catálogo online é coerente', () => {
  for (const pack of ONLINE_PACKS) for (const v of pack.voices) assert.ok(isOnlineVoice(v.id) && onlineVoiceById(v.id));
  assert.equal(onlineVoiceById('online:x:Inventada'), null);
});

test('a fala é gerada na taxa da placa de som (em 44,1 kHz numa saída de 48 kHz o Padrão saía mais agudo)', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'maestroVoice.ts'), 'utf8');
  assert.ok(!/OfflineAudioContext\(\s*1\s*,\s*1\s*,\s*44100\s*\)/.test(src), 'nada de decodificar fixo em 44,1 kHz');
  assert.match(src, /currentSampleRate\(\) \?\? deviceSampleRate\(\)/, 'usa a taxa do motor (ou a da saída)');
});

test('todo botão de suporte do site vai para o WhatsApp do suporte', () => {
  const files = ['src/components/sales/SalesPage.tsx', 'src/components/sales/PricingPage.tsx', 'src/components/SubscriptionReturn.tsx', 'src/components/sales/WhatsAppButton.tsx'];
  for (const f of files) {
    const s = fs.readFileSync(path.join(here, '..', f), 'utf8');
    assert.ok(!/wa\.me\/55\d+/.test(s), `${f} tem número fixo no lugar do número do suporte`);
    // o botão pode estar no próprio arquivo ou vir do "Fale conosco" (WhatsAppButton), que usa o mesmo link
    assert.ok(s.includes('supportWhatsAppUrl(') || s.includes('<WhatsAppButton'), `${f} sem o botão do WhatsApp do suporte`);
  }
});
