// Entrar com o Google no programa de computador.
//
// O login abre no navegador padrão do sistema (o Google não aceita login dentro de janela
// embutida) e volta por um endereço local: http://127.0.0.1:<porta>/auth/google. Escolhemos o
// retorno local em vez de um protocolo próprio (vsstage://) porque ele funciona igual no Mac
// Apple Silicon, no Intel, no Catalina, no Windows e no programa de teste sem instalador: o
// protocolo próprio só passa a abrir o programa depois de instalado e registrado no sistema, e o
// vsstage:// já é o endereço interno da tela. Só escuta em 127.0.0.1 (nada de fora do computador
// alcança), uma entrada por vez, e fecha assim que o retorno chega ou o tempo acaba.
//
// A troca do código pela sessão (PKCE) é feita na tela, que guarda o verificador; aqui só passa
// o código de volta.
const http = require('http');

// Fixas porque cada uma precisa estar liberada no Supabase (Redirect URLs). Se a primeira estiver
// ocupada por outro programa, tenta as seguintes.
const PORTS = [47821, 47822, 47823];
const CALLBACK_PATH = '/auth/google';
// Sem retorno nesse tempo (navegador fechado, pessoa desistiu): o botão volta ao normal.
const TIMEOUT_MS = 3 * 60 * 1000;
// Único endereço de login que o programa abre no navegador: o do projeto Supabase do VS Stage.
const SUPABASE_HOST = 'eknjqqiamuztomdygalv.supabase.co';

function redirectFor(port) {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

/** Endereço que pode ser aberto no navegador: só a autorização do Google no projeto Supabase. */
function isAllowedAuthUrl(raw, host = SUPABASE_HOST) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' && u.host === host && !u.username && !u.password
      && u.pathname === '/auth/v1/authorize' && u.searchParams.get('provider') === 'google';
  } catch {
    return false;
  }
}

/** Lê o retorno: { code } ou { error, description }, ou null se não for o endereço de retorno. */
function parseCallback(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl), 'http://127.0.0.1'); } catch { return null; }
  if (u.pathname !== CALLBACK_PATH) return null;
  // o Supabase pode mandar o erro na busca ou depois do # (o # não chega ao servidor)
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error') || u.searchParams.get('error_code');
  if (code) return { code };
  if (error) return { error, description: u.searchParams.get('error_description') || '' };
  // sem código e sem erro: não encerra a entrada (a página tenta ler o erro depois do #)
  return { empty: true };
}

/**
 * O retorno de verdade é o navegador indo para a página (veio do Supabase). Imagem, fetch ou
 * quadro embutido em outra página não contam: assim uma página qualquer aberta no navegador não
 * consegue interromper a entrada em andamento. Navegador sem esses cabeçalhos passa.
 */
function isNavigation(headers = {}) {
  const dest = headers['sec-fetch-dest'];
  const mode = headers['sec-fetch-mode'];
  if (dest && dest !== 'document') return false;
  if (mode && mode !== 'navigate') return false;
  return true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Quando o Supabase manda o erro depois do #, o servidor não vê: a página repassa na busca.
const HASH_ERROR_SCRIPT = `<script>(function(){var h=location.hash.slice(1);`
  + `if(/(^|&)error(_code)?=/.test(h))location.replace(location.pathname+'?'+h);})();</script>`;

/** Página simples que o navegador mostra depois do Google. ok: true (entrou), false (erro) ou 'pending'. */
function resultPage(ok) {
  const pending = ok === 'pending';
  const title = pending ? 'Voltando ao VS Stage' : ok ? 'Pronto, você entrou' : 'Não deu para entrar';
  const text = pending
    ? 'Aguarde um instante e volte ao VS Stage.'
    : ok
    ? 'Pode fechar esta aba e voltar ao VS Stage.'
    : 'Volte ao VS Stage e tente de novo. Se o problema continuar, entre com e-mail e senha.';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>VS Stage</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0b0d;color:#e6e6e6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.box{max-width:420px;margin:16px;padding:28px 26px;border:1px solid #2a2d33;border-radius:10px;background:linear-gradient(#17191d,#111317);box-shadow:0 10px 30px rgba(0,0,0,.5);text-align:center}
.lcd{display:inline-block;margin-bottom:14px;padding:4px 10px;border-radius:4px;background:#1b1508;color:${ok ? '#f5b041' : '#ff6b5a'};font:600 12px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.12em}
h1{margin:0 0 10px;font-size:20px}p{margin:0;color:#a9adb5;font-size:15px;line-height:1.5}
</style></head><body><div class="box"><div class="lcd">VS STAGE</div>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></div>${pending ? HASH_ERROR_SCRIPT : ''}</body></html>`;
}

class GoogleAuthFlow {
  constructor({ openExternal, focusWindow, ports = PORTS, timeoutMs = TIMEOUT_MS } = {}) {
    this.openExternal = openExternal;
    this.focusWindow = focusWindow || (() => {});
    this.ports = ports;
    this.timeoutMs = timeoutMs;
    this.pending = null;
    // último fim de entrada: se a pessoa cancelou antes do wait, o wait responde 'cancelled'
    this.last = null;
  }

  /** Abre o endereço de retorno e diz qual é. Uma entrada nova cancela a anterior. */
  async prepare() {
    this.cancel();
    for (const port of this.ports) {
      const server = await listen(port).catch(() => null);
      if (!server) continue;
      const p = { server, port, done: null, timer: null, result: null, waiters: [] };
      this.pending = p;
      server.on('request', (req, res) => this.onRequest(p, req, res));
      return { redirectTo: redirectFor(port) };
    }
    return { error: 'google_port_busy' };
  }

  /** Abre o Google no navegador e espera o retorno: { status: 'ok', code } | 'error' | 'cancelled' | 'timeout'. */
  async wait(authUrl) {
    const p = this.pending;
    if (!p) {
      if (this.last?.status === 'cancelled') return { status: 'cancelled' };
      return { status: 'error', error: 'google_not_prepared' };
    }
    if (!isAllowedAuthUrl(authUrl)) { this.finish(p, { status: 'error', error: 'google_bad_url' }); return p.result; }
    if (p.result) return p.result;
    const out = new Promise((resolve) => p.waiters.push(resolve));
    if (!p.timer) {
      p.timer = setTimeout(() => this.finish(p, { status: 'timeout' }), this.timeoutMs);
      try {
        await this.openExternal(authUrl);
      } catch {
        this.finish(p, { status: 'error', error: 'google_open_failed' });
      }
    }
    return out;
  }

  /** A pessoa desistiu no programa. */
  cancel() {
    if (this.pending) this.finish(this.pending, { status: 'cancelled' });
  }

  onRequest(p, req, res) {
    const parsed = req.method === 'GET' && isNavigation(req.headers) ? parseCallback(req.url) : null;
    if (!parsed) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('');
      return;
    }
    const ok = parsed.empty ? 'pending' : Boolean(parsed.code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(resultPage(ok));
    if (p.result || parsed.empty) return;
    this.focusWindow();
    this.finish(p, ok ? { status: 'ok', code: parsed.code } : { status: 'error', error: parsed.error, description: parsed.description });
  }

  finish(p, result) {
    if (p.result) return;
    p.result = result;
    this.last = result;
    clearTimeout(p.timer);
    if (this.pending === p) this.pending = null;
    // deixa a página de resposta terminar de sair antes de fechar as conexões
    setTimeout(() => {
      try { p.server.close(); } catch { /* já fechado */ }
      try { p.server.closeAllConnections?.(); } catch { /* sem conexões */ }
    }, 300);
    for (const w of p.waiters.splice(0)) w(result);
  }

  stop() { this.cancel(); }
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server); });
  });
}

module.exports = { GoogleAuthFlow, PORTS, CALLBACK_PATH, TIMEOUT_MS, SUPABASE_HOST, redirectFor, parseCallback, isAllowedAuthUrl, isNavigation, resultPage };
