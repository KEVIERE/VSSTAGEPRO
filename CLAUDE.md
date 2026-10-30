# VS Stage — instruções para o Claude

## Idioma

Responda sempre em português do Brasil. O dono do projeto só entende pt-BR.

## Repositório

- GitHub: `KEVIERE/VSSTAGEPRO`. **O repositório é público**: nunca coloque chaves, senhas ou tokens em arquivos do projeto. Os segredos de publicação ficam em GitHub → Settings → Secrets and variables → Actions.
- A `main` está atrasada (versão 1.2.0). O trabalho atual fica numa branch de funcionalidade (em 30/10/2026: `feat/saidas-estereo`). Os upgrades de produção são feitos a partir dessa branch.

## Upgrade de produção

"Upgrade de produção" é rodar o workflow `.github/workflows/promote-production.yml` a partir da branch de trabalho atual, não da `main`. Ele publica:

- o site oficial `vsstagepro.com.br`, na VPS;
- o staging `vsstagepro.com.br/staging`;
- os instaladores do Mac (Apple Silicon e Intel) em `download.vsstagepro.com.br`. O número da versão sobe sozinho: `desktop/scripts/bumpVersion.cjs` pega a maior entre `desktop/package.json` e a versão publicada e soma 1.

Ele avisa no Telegram no início e no fim. Leva cerca de 15 minutos.

### Passo a passo

1. Confira a branch e se há algo sem enviar: `git status -sb` e `git fetch origin`.
2. Cheque antes de publicar: `npm test` e `npm run build` precisam passar. Hoje `npm run typecheck` acusa 12 erros antigos que não impedem o build; só se preocupe com erro novo em arquivo que mudou.
3. Envie a branch: `git push origin <branch>`.
4. Dispare: `gh workflow run promote-production.yml --ref <branch>`. O comando mostra o link da execução.
5. Acompanhe em segundo plano: `gh run watch <id> --interval 30 --exit-status`.
6. Confira o resultado:
   - `gh run view <id>` mostra cada etapa. Se algo falhar, as anotações dizem o motivo.
   - `curl -s https://download.vsstagepro.com.br/mac/manifest.json` precisa mostrar a versão nova.

Se só a parte do Mac falhar, dá para rodar só ela: `gh workflow run mac-installer.yml --ref <branch>`. Esse caminho não manda aviso no Telegram.

### Cuidados

- **Não use o botão "Upgrade de produção" do admin** (aba Teste interno) enquanto a `main` estiver atrasada. Ele sempre publica a `main` (veja `supabase/functions/admin-promote`), o que voltaria o site para uma versão antiga.
- O instalador do Mac precisa rodar em `macos-15`, porque o GitHub retira o macOS 14 em 02/11/2026. A correção está na `feat/saidas-estereo` (commit `787684f`). Branches mais antigas ainda usam `macos-14` e falham na parte do Mac.

### Requisitos para rodar o upgrade

- `gh auth status` precisa mostrar a conta `KEVIERE` (ou um colaborador com permissão Write no repositório) com as autorizações `repo` e `workflow`.
  - Sem login: `gh auth login`.
  - Sem `workflow`: `gh auth refresh -s workflow`.
- Os comandos acima já estão liberados na lista `permissions.allow` de `.claude/settings.json`, então o Claude não pede confirmação a cada passo.
- O upgrade precisa rodar numa sessão local no Mac, não na nuvem: é lá que estão o `gh` e o login do GitHub.
