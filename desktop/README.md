# VS Stage para Mac

Versão de Mac do VS Stage com a **Rede Local do palco**: músicos, produtor e tela do palco entram pelo Wi-Fi de um roteador, sem precisar de internet.

## Gerar o instalador sem ter um Mac (GitHub)

O projeto já vem com uma automação do GitHub que gera os dois `.dmg` em um Mac na nuvem do GitHub, de graça.

1. No Bolt, conecte o projeto ao GitHub.
2. No repositório, vá em **Settings > Secrets and variables > Actions** e crie dois segredos, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, com os mesmos valores do arquivo `.env` do projeto.
3. Vá em **Actions > Instalador para Mac > Run workflow** (ele também roda sozinho a cada atualização).
4. Quando terminar (bolinha verde), abra a execução e baixe **VS-Stage-Mac** no fim da página. Dentro estão os dois `.dmg`.

## Gerar o instalador (.dmg) em um Mac

Precisa de um Mac (Intel ou Apple Silicon) com Node.js 20 ou mais novo. Copie a pasta inteira do projeto, incluindo o arquivo `.env` da raiz: ele traz a conexão com a nuvem (Show Online, área do músico, teleprompter).

```bash
cd desktop
npm install
npm run dist
```

Saem dois instaladores em `desktop/dist/`:

- `VS-Stage-1.0.0-arm64.dmg` para Macs M1, M2, M3, M4
- `VS-Stage-1.0.0-x64.dmg` para Macs Intel

O comando já gera a versão web (`npm run build` na pasta principal) e coloca dentro do app, com ícone e assinatura local (ad-hoc), para o app abrir em Apple Silicon sem o aviso de "app danificado".

Para testar sem gerar instalador: `npm start`.

### Primeira abertura (sem certificado da Apple)

1. Abra o `.dmg` e arraste o VS Stage para Aplicativos.
2. Abra o app. O macOS avisa que não pode verificar o desenvolvedor.
3. Vá em **Ajustes do Sistema > Privacidade e Segurança**, role até o aviso do VS Stage e clique em **Abrir Mesmo Assim**.
4. Permita **Rede Local** e **Microfone** quando o macOS pedir. O microfone serve só para mostrar os nomes das interfaces de áudio; nada é gravado.

Em outros Macs, se aparecer "danificado" depois de baixar pela internet, rode `xattr -cr "/Applications/VS Stage.app" && codesign --force --deep --sign - "/Applications/VS Stage.app"` no Terminal.

### Gerar sem Mac (Linux)

O `codesign` só existe no Mac. Fora dele, baixe o [rcodesign](https://github.com/indygreg/apple-platform-rs/releases) e aponte `VS_RCODESIGN` para ele; a assinatura ad-hoc é feita e conferida em cada binário depois do empacotamento:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false VS_ADHOC=1 VS_RCODESIGN=/caminho/rcodesign npx electron-builder --mac dir --arm64 --x64
```

Instalador `.dmg` (janela com o app, seta e atalho para Aplicativos), também sem Mac:

- `mkfs.hfsplus`: pacote Ubuntu `hfsprogs_540.1.linux3-6build1_amd64.deb` (`dpkg-deb -x`).
- [libdmg-hfsplus](https://github.com/mozilla/libdmg-hfsplus) compilado com cmake (desligue o bloco `IF(OPENSSL_FOUND)` em `dmg/CMakeLists.txt` se usar OpenSSL 3).
- `scripts/hfsFill.c` (preserva links e permissões, que o `hfsplus addall` perde):
  `gcc -O2 -I$L/includes -o hfsFill scripts/hfsFill.c $L/build/hfs/libhfs.a $L/build/common/libcommon.a -lz`
- `pip install ds_store mac_alias`

```bash
npm run background
VS_MKFS_HFSPLUS=/caminho/mkfs.hfsplus VS_HFSFILL=/caminho/hfsFill VS_DMG=$L/build/dmg/dmg \
  python3 scripts/makeDmg.py "dist/mac-arm64/VS Stage.app" build/dmg-background.png dist/VS-Stage-<versão>-arm64.dmg "VS Stage <versão>"
```

`npm run background` desenha o fundo da janela (logo, VS STAGE, LIVE PERFORMANCE ENGINE e a versão do `package.json`) em tamanho normal e `@2x`; o `makeDmg.py` junta os dois num `.tiff` para telas Retina (precisa do ImageMagick) e usa o ícone do app como ícone do disco. As posições dos ícones ficam em `build/dmg-layout.json` (repita os números no bloco `dmg` do `package.json`).

A versão mostrada na abertura do app e do site e no instalador vem só do campo `version` deste `package.json`: basta subir esse número a cada atualização.

O script confere os links de todo o app antes de gerar o arquivo e para com erro se algo não bater.

### Assinatura oficial (opcional, para distribuir)

Com uma conta Apple Developer, instale o certificado **Developer ID Application** no Keychain (ou defina `CSC_LINK` e `CSC_KEY_PASSWORD`), defina `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` e `APPLE_TEAM_ID` e rode `npm run dist:signed`. O app abre direto em qualquer Mac, sem passos extras.

## Como funciona

- O app abre o VS Stage normalmente (Show Online continua igual).
- Ao escolher **Rede Local** (seta ao lado de Show Online, ou menu Arquivo), o app liga um servidor na porta 8080 (ou a próxima livre) e registra o nome `vsstage.local` no Bonjour do Mac.
- Músicos e produtor entram com PINs diferentes, fixos, que podem ser trocados em **Gerar novo**. A tela do palco entra sem PIN e só exibe.
- **Desconectar** um aparelho bloqueia ele até gerar um PIN novo ou religar a Rede Local.
- Os PINs e a configuração do teleprompter ficam salvos em `~/Library/Application Support/VS Stage/rede-local.json`.
- Na primeira vez, o macOS pergunta se o VS Stage pode acessar a rede local e receber conexões: clique em **Permitir**.

## Pela rede local não estão disponíveis

- Áudio de referência do produtor (fica na nuvem).
- Logo do show na tela do palco.

As cifras e partituras dos músicos funcionam na rede local: ficam salvas no Mac em `rede-local-cadernos.json`, separadas pelo nome que cada músico usa para entrar.
