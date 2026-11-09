#!/usr/bin/env node
// Limpa do Storage do Supabase os instaladores antigos, que são o que enche o plano gratuito
// e faz o projeto pausar.
//
// O bucket app-downloads guarda o manifest.json da versão atual e, de versões anteriores, as
// partes dos .dmg. As partes NÃO são mais copiadas para cá (ver o comentário em
// mac-installer.yml): o que sobrou de versão antiga é peso morto. O manifest.json fica sempre.
//
// Não toca em prompter-audio nem em show-logos: são do show em andamento e agora se limpam
// sozinhos quando o produtor salva as letras.
//
// Uso (dentro do GitHub Actions, onde estão os secrets):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node limpar-storage-supabase.mjs
// Só mostra o que faria, sem apagar:
//   ... node limpar-storage-supabase.mjs --dry-run

const DRY = process.argv.includes('--dry-run');
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'app-downloads';

if (!URL_BASE || !KEY) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${KEY}`, apikey: KEY };

function fmt(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function listar(prefix) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`listar "${prefix || '/'}": HTTP ${res.status} ${await res.text().catch(() => '')}`);
  const items = await res.json();
  return Array.isArray(items) ? items.filter((i) => i && i.name) : [];
}

async function apagar(paths) {
  if (paths.length === 0) return 0;
  if (DRY) return paths.length;
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`apagar: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return paths.length;
}

const tamanho = (i) => (i.metadata && typeof i.metadata.size === 'number' ? i.metadata.size : 0);
const ehPasta = (i) => i.id === null || i.name.endsWith('/');

try {
  console.log(DRY ? '--- SIMULAÇÃO: nada será apagado ---' : '--- LIMPEZA ---');
  console.log(`projeto: ${URL_BASE}`);

  let removidos = 0;
  let bytes = 0;
  const aApagar = [];

  // 1. Arquivos soltos na raiz e em mac/. O manifest.json nunca sai: é o que a página de
  //    download lê.
  for (const prefix of ['', 'mac']) {
    const items = await listar(prefix);
    for (const item of items) {
      if (ehPasta(item)) continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      const basename = item.name;
      if (basename === 'manifest.json') {
        console.log(`mantendo: ${path}`);
        continue;
      }
      aApagar.push(path);
      bytes += tamanho(item);
      console.log(`apagar:   ${path} (${fmt(tamanho(item))})`);
    }
  }

  // 2. Subpastas de versões antigas (mac/<versao>/<arch>/parte.bin).
  for (const item of await listar('mac')) {
    if (!ehPasta(item)) continue;
    const sub = await listar(`mac/${item.name.replace(/\/$/, '')}`);
    for (const f of sub) {
      if (ehPasta(f)) continue;
      const path = `mac/${item.name}${f.name}`;
      aApagar.push(path);
      bytes += tamanho(f);
      console.log(`apagar:   ${path} (${fmt(tamanho(f))})`);
    }
  }

  if (aApagar.length === 0) {
    console.log('Nada para apagar: o bucket já está limpo.');
  } else {
    removidos = await apagar(aApagar);
    console.log('');
    console.log(`${removidos} arquivo(s) ${DRY ? 'seriam apagados' : 'apagados'}, ${fmt(bytes)} ${DRY ? 'seriam liberados' : 'liberados'}`);
  }

  // 3. Confere o que sobrou.
  const restantes = (await listar('mac')).filter((i) => !ehPasta(i));
  const totalRestante = restantes.reduce((s, i) => s + tamanho(i), 0);
  console.log(`agora em mac/: ${restantes.length} arquivo(s), ${fmt(totalRestante)}`);
  for (const r of restantes) console.log(`  - ${r.name}`);

  if (DRY) console.log('\nRode sem --dry-run para apagar de verdade.');
} catch (err) {
  console.error('FALHOU:', err instanceof Error ? err.message : err);
  process.exit(1);
}
