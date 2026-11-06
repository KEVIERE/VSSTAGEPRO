// Comunicação com os usuários: descadastro, assinatura da Twilio, lote do Resend e o texto
// que sai. Roda sem rede e sem banco. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, buildUnsubToken, chunkArray, escapeHtml, fillVars, friendlyOutreachError,
  isStopMessage, normalizeAddress, normalizePhone, renderEmailHtml, verifyUnsubToken,
} from '../supabase/functions/_shared/outreach.ts';
import {
  batchIdempotencyKey, errorMessage, readBatchResponse, shouldSplit, toResendItem,
  unsubscribeHeaders,
} from '../supabase/functions/_shared/resendBatch.ts';

const SECRET = 'segredo-de-teste';

// ─── Token de descadastro ────────────────────────────────────────────────────

test('descadastro: token gerado confere e devolve o endereço normalizado', async () => {
  const token = await buildUnsubToken(SECRET, 'email', 'Fulano@Exemplo.COM');
  const check = await verify(token);
  assert.equal(check.ok, true);
  assert.equal(check.channel, 'email');
  assert.equal(check.address, 'fulano@exemplo.com');
});

test('descadastro: trocar o endereço no token invalida a assinatura', async () => {
  // Este é o ataque que o HMAC existe para barrar: montar um link que descadastra outra
  // pessoa trocando o endereço dentro dele.
  const token = await buildUnsubToken(SECRET, 'email', 'fulano@exemplo.com');
  const [v, channel, , mac] = token.split('.');
  const trocado = [v, channel, b64url('vitima@exemplo.com'), mac].join('.');
  const check = await verify(trocado);
  assert.equal(check.ok, false);
  assert.equal(check.error, 'bad_signature');
});

test('descadastro: segredo diferente não valida', async () => {
  const token = await buildUnsubToken(SECRET, 'email', 'fulano@exemplo.com');
  const check = await verify(token, 'outro-segredo');
  assert.equal(check.ok, false);
  assert.equal(check.error, 'bad_signature');
});

test('descadastro: token sem formato, canal desconhecido e telefone são recusados', async () => {
  assert.equal((await verify('abc')).error, 'bad_format');
  assert.equal((await verify('v1.sms.abc.def')).error, 'bad_channel');
  assert.equal(await buildUnsubToken(SECRET, 'email', 'nao-e-email'), null);
  assert.equal(await buildUnsubToken('', 'email', 'fulano@exemplo.com'), null);
});

test('descadastro: telefone do WhatsApp também gera token válido', async () => {
  const token = await buildUnsubToken(SECRET, 'whatsapp', '(11) 91234-5678');
  const check = await verify(token);
  assert.equal(check.ok, true);
  assert.equal(check.channel, 'whatsapp');
  assert.equal(check.address, '+5511912345678');
});

test('descadastro: sem expiração, o mesmo token vale sempre', async () => {
  // Link em e-mail antigo precisa continuar funcionando. Se expirasse, o usuário não teria
  // como sair e a saída dele viraria denúncia de spam.
  const token = await buildUnsubToken(SECRET, 'email', 'fulano@exemplo.com');
  assert.equal((await verify(token)).ok, true);
  assert.equal((await verify(token)).ok, true);
});

// ─── Telefone ────────────────────────────────────────────────────────────────

test('telefone: mesma regra do cadastro e do banco', () => {
  // Sem "+", 10 ou 11 dígitos são DDD + número e ganham o +55. Celular tem 11, fixo tem 10,
  // e os dois valem: o cadastro aceita os dois.
  assert.equal(normalizePhone('(11) 91234-5678'), '+5511912345678');
  assert.equal(normalizePhone('11 91234-5678'), '+5511912345678');
  assert.equal(normalizePhone('1133334444'), '+551133334444');
  assert.equal(normalizePhone('+5511912345678'), '+5511912345678');
  assert.equal(normalizePhone('5511912345678'), '+5511912345678');
  // Curto demais, longo demais ou sem número: não dá para mandar mensagem.
  assert.equal(normalizePhone('119123456'), null);
  assert.equal(normalizePhone('+15551234567890123'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('abc'), null);
});

test('endereço: e-mail vira minúsculo e inválido é recusado', () => {
  assert.equal(normalizeAddress('email', ' A@B.CO '), 'a@b.co');
  assert.equal(normalizeAddress('email', 'sem-arroba'), null);
  assert.equal(normalizeAddress('whatsapp', '(11) 91234-5678'), '+5511912345678');
});

// ─── Saída (SAIR) no WhatsApp ────────────────────────────────────────────────

test('WhatsApp: SAIR, PARAR e STOP descadastram, e conversa comum não', () => {
  for (const word of ['SAIR', 'sair', ' Parar. ', 'PÁRAR', 'stop', 'Cancelar', 'descadastrar']) {
    assert.equal(isStopMessage(word), true, `deveria descadastrar: ${word}`);
  }
  for (const word of ['oi', 'quero sair do show', 'não entendi', '']) {
    assert.equal(isStopMessage(word), false, `não deveria descadastrar: ${word}`);
  }
});

// ─── Variáveis e texto ───────────────────────────────────────────────────────

test('variáveis: troca pelo valor e mantém o desconhecido no lugar', () => {
  const missing = [];
  const out = fillVars('Oi, {{nome}}, sua versão é {{versao}} e {{outra}}.', { nome: 'Ana', versao: '1.2.6' }, missing);
  // O desconhecido fica visível para aparecer no teste, em vez de sair "Oi, Ana, e ." sem
  // ninguém entender por quê.
  assert.equal(out, 'Oi, Ana, sua versão é 1.2.6 e {{outra}}.');
  assert.deepEqual(missing, ['outra']);
});

test('variáveis: valor vazio é tratado como variável faltando', () => {
  // Nome em branco não some da frase por acidente: o texto mantém {{nome}} e o motor troca
  // por "você" antes de enviar. Saudação vazia ("Oi, !") é pior que um tratamento neutro.
  const missing = [];
  assert.equal(fillVars('Oi, {{nome}}!', { nome: '' }, missing), 'Oi, {{nome}}!');
  assert.deepEqual(missing, ['nome']);
});

test('HTML do e-mail: marcação leve vira tag e o resto é escapado', () => {
  const html = renderEmailHtml('Oi **Ana**,\n\nVeja [aqui](https://vsstagepro.com.br).\n\n<script>alert(1)</script>', {});
  assert.match(html, /<strong[^>]*>Ana<\/strong>/);
  assert.match(html, /<a href="https:\/\/vsstagepro\.com\.br"/);
  // O script colado no texto não pode virar tag de verdade.
  assert.ok(!html.includes('<script>'), 'script não pode passar cru para o HTML');
  assert.match(html, /&lt;script&gt;/);
});

test('HTML do e-mail: aspas e acentos no nome não quebram o layout', () => {
  const html = renderEmailHtml('Oi {{nome}}', { nome: 'Ana "Música" & Cia <b>' });
  assert.ok(html.includes('&quot;') || html.includes('&amp;'));
  assert.ok(!html.includes('<b>Cia'));
});

test('escapeHtml: cobre os cinco caracteres perigosos', () => {
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

// ─── Resend: lote e resposta ────────────────────────────────────────────────

test('Resend: a resposta é ligada ao destinatário pelo índice', () => {
  const results = readBatchResponse(200, { data: [{ id: 'id-a' }, { id: 'id-b' }, { id: 'id-c' }] }, 3);
  assert.deepEqual(results.map((r) => r.kind), ['sent', 'sent', 'sent']);
  assert.deepEqual(results.map((r) => r.index), [0, 1, 2]);
  assert.equal(results[1].providerId, 'id-b');
});

test('Resend: item sem id não conta como enviado', () => {
  // Se o serviço responder 200 sem id para um item, tratá-lo como enviado esconderia uma
  // mensagem que nunca saiu.
  const results = readBatchResponse(200, { data: [{ id: 'a' }, {}] }, 2);
  assert.equal(results[0].kind, 'sent');
  assert.equal(results[1].kind, 'retry');
});

test('Resend: rejeição do lote inteiro pede divisão, até sobrar um', () => {
  const r = readBatchResponse(422, { message: 'invalid' }, 4);
  assert.deepEqual(r.map((x) => x.kind), ['rejected', 'rejected', 'rejected', 'rejected']);
  assert.equal(shouldSplit(r, 4), true);
  // Com um só item não há o que dividir: é falha de verdade.
  assert.equal(shouldSplit(readBatchResponse(422, {}, 1), 1), false);
});

test('Resend: 500 e 429 voltam para a fila em vez de falhar', () => {
  for (const status of [500, 502, 503, 429]) {
    const r = readBatchResponse(status, null, 2);
    assert.deepEqual(r.map((x) => x.kind), ['retry', 'retry'], `status ${status}`);
  }
});

test('Resend: mensagem de erro é lida nos dois formatos do serviço', () => {
  assert.equal(errorMessage({ message: 'assunto inválido' }), 'assunto inválido');
  assert.equal(errorMessage({ error: 'invalid_from' }), 'invalid_from');
  assert.equal(errorMessage({ error: { message: 'domínio não verificado' } }), 'domínio não verificado');
  assert.equal(errorMessage(null), 'resend_error');
});

test('Resend: cabeçalho de descadastro de um clique nos dois formatos', () => {
  const h = unsubscribeHeaders('https://x/functions/v1/outreach-unsubscribe?t=abc');
  assert.equal(h['List-Unsubscribe'], '<https://x/functions/v1/outreach-unsubscribe?t=abc>');
  assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('Resend: item enviado não leva campo interno da fila', () => {
  const item = toResendItem({
    to: 'a@b.co', subject: 'Oi', html: '<p>Oi</p>', replyTo: 'contato@vsstagepro.com.br',
    unsubUrl: 'https://x/u?t=1',
  });
  assert.deepEqual(item.to, ['a@b.co']);
  assert.equal(item.reply_to, 'contato@vsstagepro.com.br');
  assert.ok(item.headers['List-Unsubscribe']);
  assert.equal('id' in item, false);
  assert.equal('campaign_id' in item, false);
});

test('Resend: chave de idempotência é estável para o mesmo lote', async () => {
  const a = await batchIdempotencyKey('campanha-1', 10, 20);
  const b = await batchIdempotencyKey('campanha-1', 10, 20);
  const c = await batchIdempotencyKey('campanha-1', 10, 21);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// ─── Lotes e tempo ──────────────────────────────────────────────────────────

test('lotes: nenhum lote passa do teto do provedor', () => {
  const parts = chunkArray(Array.from({ length: 250 }, (_, i) => i), LIMITS.resendBatch);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.length <= 100));
  assert.equal(parts.flat().length, 250);
  assert.deepEqual(chunkArray([], 10), []);
  assert.deepEqual(chunkArray([1, 2], 0), [[1], [2]]);
});

test('WhatsApp: o lote é pequeno de propósito', () => {
  // Lote grande com uma função que morre no meio deixa muita linha presa até o lease vencer.
  assert.equal(LIMITS.whatsappBatch, 5);
  assert.equal(LIMITS.whatsappGapMs, 3000);
});

// ─── Erros em português ────────────────────────────────────────────────────

test('erros: código conhecido vira frase, desconhecido passa como veio', () => {
  assert.match(friendlyOutreachError('subject_required'), /assunto/);
  assert.match(friendlyOutreachError('run_superseded'), /outra aba/);
  assert.match(friendlyOutreachError('whatsapp_sender_offline'), /Twilio/);
  assert.equal(friendlyOutreachError('twilio_999'), 'twilio_999');
});

// ─── Apoio ──────────────────────────────────────────────────────────────────

function b64url(text) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verify(token, secret = SECRET) {
  return verifyUnsubToken(secret, token);
}
