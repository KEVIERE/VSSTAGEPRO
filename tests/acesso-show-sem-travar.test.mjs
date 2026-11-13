// Assinante sem internet não trava com o programa aberto, tem 3 dias de folga com aviso e é
// avisado antes de vencer. A tela de bloqueio espera a música parar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src', 'components', 'DirectorAccess.tsx'), 'utf8');

test('conferência sem internet não trava o assinante com o programa aberto', () => {
  assert.match(src, /if \(\(d\.kind === 'need_internet' \|\| d\.kind === 'expired'\) && sameAccount && usableLicenseRef\.current\?\.status === 'active'\) \{\s*setHeldOpen\(true\);\s*return;/);
  // outra conta nunca herda a licença da sessão anterior
  assert.match(src, /d\.reason === 'other_account'/);
  assert.match(src, /\} else \{\s*\/\/ saiu da conta por fora[^\n]*\n\s*usableLicenseRef\.current = null;\s*setHeldOpen\(false\);/);
});

test('a resposta do servidor solta o aviso de "segue aberto"', () => {
  assert.match(src, /const applyServer = \(lic: License\) => \{\s*if \(!storedSession\(\)\) return;[^\n]*\n\s*setHeldOpen\(false\);/);
});

test('a folga vai para a licença e vira aviso na tela', () => {
  assert.match(src, /offline_grace_from: d\.graceFrom/);
  assert.match(src, /function renewalWarning\(/);
  assert.match(src, /Renove e abra o programa com internet antes do show/);
  assert.match(src, /O programa segue aberto até você fechar/);
});

test('com música tocando a tela de bloqueio espera a música parar', () => {
  assert.match(src, /const holdForShow = locked && isPlaying/);
});
