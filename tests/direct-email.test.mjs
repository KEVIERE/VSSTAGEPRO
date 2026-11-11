// E-mail avulso da Comunicação: leitura dos endereços, limites e o HTML que sai.
// Roda sem rede e sem banco. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECT_EMAIL_LIMIT, DIRECT_SUBJECT_MAX, friendlyDirectError, parseRecipients,
  renderDirectEmailHtml, renderDirectEmailText, summarizeDirect, validateDirectEmail,
} from '../supabase/functions/_shared/directEmail.ts';

test('avulso: aceita vírgula, ponto e vírgula, espaço e quebra de linha', () => {
  const p = parseRecipients('ana@exemplo.com, joao@exemplo.com;maria@exemplo.com\npedro@exemplo.com  lu@exemplo.com');
  assert.deepEqual(p.valid, ['ana@exemplo.com', 'joao@exemplo.com', 'maria@exemplo.com', 'pedro@exemplo.com', 'lu@exemplo.com']);
  assert.deepEqual(p.invalid, []);
});

test('avulso: lê "Nome <email>" e mailto:, normaliza maiúsculas', () => {
  const p = parseRecipients('Ana Souza <Ana@Exemplo.COM>, mailto:joao@exemplo.com');
  assert.deepEqual(p.valid, ['ana@exemplo.com', 'joao@exemplo.com']);
});

test('avulso: repetido conta uma vez e é apontado', () => {
  const p = parseRecipients('ana@exemplo.com, ANA@exemplo.com, ana@exemplo.com');
  assert.deepEqual(p.valid, ['ana@exemplo.com']);
  assert.deepEqual(p.duplicates, ['ana@exemplo.com']);
});

test('avulso: endereço inválido barra o envio inteiro e é devolvido', () => {
  const r = validateDirectEmail({ to: 'ana@exemplo.com, nao-e-email, b@x', subject: 'Oi', body: 'Texto' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_addresses');
  assert.deepEqual(r.invalid, ['nao-e-email', 'b@x']);
});

test('avulso: sem destinatário, sem assunto e sem texto são recusados', () => {
  assert.equal(validateDirectEmail({ to: '  ', subject: 'Oi', body: 'x' }).error, 'no_recipients');
  assert.equal(validateDirectEmail({ to: 'a@exemplo.com', subject: '  ', body: 'x' }).error, 'subject_required');
  assert.equal(validateDirectEmail({ to: 'a@exemplo.com', subject: 'Oi', body: '\n\n' }).error, 'body_required');
  assert.equal(validateDirectEmail({ to: 'a@exemplo.com', subject: 'x'.repeat(DIRECT_SUBJECT_MAX + 1), body: 'x' }).error, 'subject_too_long');
  assert.equal(validateDirectEmail({ to: 'a@exemplo.com', subject: 'Oi', body: 'x', replyTo: 'ruim' }).error, 'invalid_reply_to');
});

test('avulso: passa do teto de destinatários', () => {
  const lista = Array.from({ length: DIRECT_EMAIL_LIMIT + 1 }, (_, i) => `p${i}@exemplo.com`);
  assert.equal(validateDirectEmail({ to: lista, subject: 'Oi', body: 'x' }).error, 'too_many_recipients');
  const noLimite = validateDirectEmail({ to: lista.slice(0, DIRECT_EMAIL_LIMIT), subject: 'Oi', body: 'x' });
  assert.equal(noLimite.ok, true);
  assert.equal(noLimite.to.length, DIRECT_EMAIL_LIMIT);
});

test('avulso: quebra de linha no assunto vira espaço (não injeta cabeçalho)', () => {
  const r = validateDirectEmail({ to: 'a@exemplo.com', subject: 'Oi\r\nBcc: x@y.com', body: 'x', replyTo: ' Contato@VSStagePro.com.br ' });
  assert.equal(r.ok, true);
  assert.equal(r.subject, 'Oi Bcc: x@y.com');
  assert.equal(r.replyTo, 'contato@vsstagepro.com.br');
});

test('avulso: HTML sai com a pele do VS Stage, escapado, sem link de descadastro', () => {
  const html = renderDirectEmailHtml('Olá **Ana**\n\n<script>alert(1)</script> [site](https://vsstagepro.com.br)');
  assert.match(html, /email-topo\.jpg/);
  assert.match(html, /<strong[^>]*>Ana<\/strong>/);
  assert.match(html, /<a href="https:\/\/vsstagepro\.com\.br"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /responder este e-mail/);
  assert.doesNotMatch(html, /outreach-unsubscribe/);
  assert.match(renderDirectEmailText('Oi'), /^Oi\n\n--\nVS Stage Pro/);
});

test('avulso: resumo e mensagens de erro em português', () => {
  const s = summarizeDirect([
    { address: 'a@x.com', status: 'sent' },
    { address: 'b@x.com', status: 'failed', error: 'optout' },
  ]);
  assert.deepEqual(s, { total: 2, sent: 1, failed: 1 });
  assert.match(friendlyDirectError('optout'), /não receber/);
  assert.equal(friendlyDirectError('erro desconhecido'), 'erro desconhecido');
});

test('avulso: remetente fica no domínio verificado', async () => {
  const { buildDirectFrom } = await import('../supabase/functions/_shared/directEmail.ts');
  assert.equal(buildDirectFrom().from, 'VS Stage Pro <avisos@vsstagepro.com.br>');
  assert.equal(buildDirectFrom('Equipe VS Stage', 'Contato').from, 'Equipe VS Stage <contato@vsstagepro.com.br>');
  assert.equal(buildDirectFrom('', 'suporte@vsstagepro.com.br').address, 'suporte@vsstagepro.com.br');
  // Gmail como remetente cairia no spam (DMARC): vai como "Responder para".
  assert.equal(buildDirectFrom('X', 'vsstagepro@gmail.com').error, 'invalid_from_address');
  assert.equal(buildDirectFrom('X', 'a b').error, 'invalid_from_address');
  assert.equal(buildDirectFrom('X', '.avisos').error, 'invalid_from_address');
  assert.equal(buildDirectFrom('Nome <falso@x.com>', 'avisos').error, 'invalid_from_name');
  const r = validateDirectEmail({ to: 'a@exemplo.com', subject: 'Oi', body: 'x', fromName: 'VS', fromLocal: 'vsstagepro@gmail.com' });
  assert.equal(r.error, 'invalid_from_address');
  const ok = validateDirectEmail({ to: 'a@exemplo.com', subject: 'Oi', body: 'x', replyTo: 'vsstagepro@gmail.com' });
  assert.equal(ok.from, 'VS Stage Pro <avisos@vsstagepro.com.br>');
  assert.equal(ok.replyTo, 'vsstagepro@gmail.com');
});
