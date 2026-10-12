const fs = require('fs');
const path = require('path');

// 1. O electron-builder (dmg-builder) tem um bug antigo onde força o formato APFS
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

// 2. No macOS 14 (Sonoma) e 15 (Sequoia), o campo pBBk inserido pelo dmgbuild
// corrompe a estrutura do .DS_Store no Finder, fazendo o Finder ignorar o fundo
// e mostrar a janela cinza/preta vazia (bug oficial #9072 do electron-builder).
// Desativar a gravação de pBBk faz o Finder ler o backgroundImageAlias limpo e
// exibir o fundo com o logotipo e a arte perfeitamente!
try {
  const corePy = path.join(__dirname, '..', 'node_modules', 'dmg-builder', 'vendor', 'dmgbuild', 'core.py');
  if (fs.existsSync(corePy)) {
    let content = fs.readFileSync(corePy, 'utf8');
    if (content.includes('background_bmk = Bookmark.for_file(background_file)')) {
      content = content.replace(
        'background_bmk = Bookmark.for_file(background_file)',
        'background_bmk = None # corrigido para macOS Sonoma/Sequoia (#9072)'
      );
      fs.writeFileSync(corePy, content);
      console.log('✓ dmgbuild core.py ajustado: pBBk desativado para restaurar fundo personalizado no Finder');
    }
  }
} catch (e) {
  console.warn('Aviso ao ajustar core.py:', e.message);
}
