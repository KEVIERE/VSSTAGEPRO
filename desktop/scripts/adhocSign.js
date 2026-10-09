const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Sem certificado da Apple, o Electron chega com assinatura quebrada e o Mac M1+ diz "app danificado".
// Assinatura local (ad-hoc) resolve isso; fora de um Mac usa o rcodesign (caminho em VS_RCODESIGN).
exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.VS_ADHOC !== '1') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const rcodesign = process.env.VS_RCODESIGN;
  if (!rcodesign) {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    return;
  }
  execFileSync(rcodesign, ['sign', app], { stdio: 'ignore' });
  // "rcodesign verify" não entende assinatura ad-hoc, então conferimos cada binário Mach-O na mão.
  const unsigned = machOFiles(app).filter((file) => {
    const info = execFileSync(rcodesign, ['print-signature-info', file], { encoding: 'utf8' });
    return !info.includes('ADHOC');
  });
  if (unsigned.length) throw new Error(`Sem assinatura: ${unsigned.join(', ')}`);
  if (!fs.existsSync(path.join(app, 'Contents', '_CodeSignature', 'CodeResources'))) throw new Error('Selo de recursos ausente');
};

const MACHO = new Set(['feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca']);

function machOFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { out.push(...machOFiles(full)); continue; }
    const fd = fs.openSync(full, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (MACHO.has(head.toString('hex'))) out.push(full);
  }
  return out;
}
