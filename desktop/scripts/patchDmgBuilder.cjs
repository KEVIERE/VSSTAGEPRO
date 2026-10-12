const fs = require('fs');
const path = require('path');

// O electron-builder (dmg-builder) tem um bug antigo onde força o formato APFS
// em máquinas Apple Silicon (arm64). O Finder do macOS NÃO desenha a imagem de
// fundo personalizada nem posiciona os ícones em volumes APFS — isso só funciona em HFS+.
// Como o hdiutil no macOS suporta perfeitamente HFS+, desativamos esse bloqueio.
try {
  const file = path.join(__dirname, '..', 'node_modules', 'dmg-builder', 'out', 'dmg.js');
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('if (process.arch === "arm64")')) {
      content = content.replace('if (process.arch === "arm64")', 'if (false /* forcar HFS+ para exibir fundo no Finder */)');
      fs.writeFileSync(file, content);
      console.log('✓ dmg-builder ajustado: HFS+ habilitado para exibir o fundo personalizado no Finder');
    }
  }
} catch (e) {
  console.warn('Aviso: Não foi possível aplicar patch em dmg-builder:', e.message);
}
