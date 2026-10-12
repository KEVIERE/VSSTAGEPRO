const fs = require('fs');
const path = require('path');
const https = require('https');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

function parseVersion(v) {
  const parts = String(v || '1.0.0').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareVersions(v1, v2) {
  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return 1;
    if (p1[i] < p2[i]) return -1;
  }
  return 0;
}

function fetchServerVersion() {
  return new Promise((resolve) => {
    const req = https.get('https://download.vsstagepro.com.br/mac/manifest.json', { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.version || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  const currentLocal = pkg.version || '1.0.0';
  const serverVersion = await fetchServerVersion();

  // Usa a maior versão conhecida como base
  let baseVersion = currentLocal;
  if (serverVersion && compareVersions(serverVersion, baseVersion) >= 0) {
    baseVersion = serverVersion;
  }

  const parts = parseVersion(baseVersion);
  parts[2] += 1; // Sobe sempre o patch para a nova compilação nunca ter número repetido
  const nextVersion = parts.join('.');

  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✓ Versão atualizada automaticamente: ${currentLocal} → ${nextVersion}`);
}

main().catch((err) => {
  console.error('Erro ao atualizar versão:', err);
});
