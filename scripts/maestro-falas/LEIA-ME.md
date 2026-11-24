# Gravação das falas do Maestro

Grava as falas que faltam nas vozes Maestro IA (`felipe`), Hailton (`hailton`) e Bianca (`moca`),
nos modos Calma, Normal e Forte. Os áudios ficam fora do repositório, em
`~/Documents/vs-stage-maestro-gravacao` (troque com `--saida=pasta`).

A chave é lida de `~/.vsstage-elevenlabs-key` e nunca é impressa nem gravada em arquivo.

**Antes de gravar Hailton ou Bianca, confirme com o dono se essas vozes continuam valendo.** Até lá,
grave só com `--voz=felipe`.

## Ordem de trabalho

1. **Ver o custo** (não usa rede nem chave):

   ```
   node scripts/maestro-falas/gravar.mjs
   ```

2. **Gravar a amostra** de cada voz (45 áudios, 1.869 caracteres) e ouvir em `_amostra/`:

   ```
   node scripts/maestro-falas/gravar.mjs --amostra --gravar --teto=2000
   ```

3. **Aprovar** cada voz depois de ouvir:

   ```
   node scripts/maestro-falas/gravar.mjs --aprovar=felipe
   node scripts/maestro-falas/gravar.mjs --aprovar=hailton
   node scripts/maestro-falas/gravar.mjs --aprovar=moca
   ```

4. **Gravar**, sempre com teto. A ordem é Maestro IA, Hailton, Bianca, e para na primeira voz sem
   aprovação. Se parar, o mesmo comando continua de onde parou:

   ```
   node scripts/maestro-falas/gravar.mjs --gravar --teto=100000
   ```

5. **Conferir** e mandar os reprovados de volta para a fila:

   ```
   node scripts/maestro-falas/conferir.mjs --voz=hailton --mover
   node scripts/maestro-falas/gravar.mjs --voz=hailton --gravar --teto=5000
   ```

6. **Empacotar** Hailton e Bianca. Nada é enviado:

   ```
   node scripts/maestro-falas/empacotar.mjs --voz=hailton --versao=v1
   node scripts/maestro-falas/empacotar.mjs --voz=moca --versao=v1
   ```

   O pacote sai em `pacotes/<voz>/<versão>/`, no desenho que `desktop/maestroPacks.js` baixa. O
   arquivo `pacotes/<voz>-<versão>.trava.json` traz o trecho de `desktop/maestro-packs.json`. A voz
   só aparece no programa depois que os arquivos forem publicados e essa trava entrar numa versão.

7. **Maestro IA** vai embutido. Primeiro veja o aumento do instalador; só com `--confirmar` copia,
   e só áudio aprovado com o mesmo SHA-256:

   ```
   node scripts/maestro-falas/empacotar.mjs --voz=felipe --embutir=public/maestro-falas
   node scripts/maestro-falas/empacotar.mjs --voz=felipe --embutir=public/maestro-falas --confirmar
   ```

   Copiar não basta para a fala aparecer: a lista de gravadas de `src/lib/maestroCues.ts` vale para
   Maestro IA e Bianca juntas. Separe essa lista antes, ou a Bianca mostraria fala sem áudio.

## Opções

| Script | Opção | Para quê |
| --- | --- | --- |
| todos | `--saida=pasta` | Pasta das gravações |
| todos | `--voz=felipe,hailton,moca` | Limita as vozes (no empacotar, uma só) |
| gravar, conferir | `--modo=normal,calma,forte` | Limita os modos |
| gravar | `--teto=N` | Máximo de caracteres na rodada (obrigatório com `--gravar`) |
| gravar | `--id-felipe=ID`, `--id-moca=ID` | Id da voz, se o nome não for achado na conta |
| conferir | `--sem-whisper` | Só mede a duração |
| conferir | `--lote=10` | Falas por lote do Whisper |
| conferir | `--modelo=arquivo` | Outro modelo do Whisper |
| conferir | `--mover` | Move os reprovados para `_reprovados/` |
| gravar | `--dry-run` | Ensaio explícito (recusado junto com `--gravar`) |
| todos | `--falas=arquivo` | Outra lista de falas novas (padrão: `falas-novas.json` desta pasta) |
| empacotar | `--versao=v1` | Versão do pacote |
| empacotar | `--embutir=pasta`, `--confirmar` | Copia o Maestro IA aprovado para o programa |

## Cuidados

- O teto conta a tag de intensidade como caractere, o caso mais caro. Se a conta cobrar menos, a
  rodada para antes do necessário; é só rodar de novo. Cada rodada guarda o custo real em
  `custo-medido.json`, e o plano passa a mostrar a estimativa por esse fator. O teto não muda.
- Opção desconhecida, `--gravar=valor` ou `--dry-run` junto com `--gravar` param com erro.
- Redirecionamento da API para na hora e não é seguido, para a chave não sair para outro endereço.
- Sem `ffmpeg` nada é enviado. A resposta paga fica em `_bruto/` até ser tratada e a retomada a
  reaproveita sem nova cobrança. Se falhar de novo, vai para `_bruto-recusado/`.
- Rodada com fala não gravada termina com código 2.
- O saldo é consultado no início e a cada 10 pedidos. Erro 401 ou 402 para na hora.
- A pronúncia dos termos em inglês das falas atuais está em `comum.mjs`. Confira na amostra.
- `conferir.mjs` usa o `whisper-cli` no processador, porque a GPU aborta neste Mac com este modelo.
- `conferir.mjs` reprova número, letra de parte ou sentido trocado (sobe/desce, entra/sai,
  acima/abaixo, volta/vai, mais/menos), mesmo com o resto parecido.
