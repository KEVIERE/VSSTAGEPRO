const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** Resolve um caminho da URL para um arquivo dentro de `root`, sem deixar sair da pasta. Sem arquivo, cai no index.html. */
function resolveStatic(root, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); } catch { rel = '/'; }
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  const inside = file === root || file.startsWith(root + path.sep);
  const target = inside && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  return { file: target, type: MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', isIndex: target.endsWith('index.html') };
}

module.exports = { resolveStatic };
