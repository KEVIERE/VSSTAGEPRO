# drumsep (embutido no VS Stage)

Separação da BATERIA em peças por processamento de sinal — sem rede neural e sem
modelo para baixar. É o segundo passo do "Separar stems": o Demucs (htdemucs_6s)
tira a bateria da música, e este código quebra a bateria em bumbo, caixa, chimbal,
pratos e tons.

## Origem

Cópia fiel de https://github.com/cukas/drumsep (MIT, © 2026 Nicolas Cukas),
do commit clonado em 06/11/2026. O arquivo `LICENSE` é o original.

Não editar estes arquivos: para atualizar, copie de novo do repositório e refaça os
testes. Quem chama é `desktop/drumPieceSeparator.py`, acionado por
`desktop/drumPieces.js`.

## Por que substituiu o modelo ONNX

O modelo anterior (`drumsep_v2.onnx`, 335 MB) pedia 2,8 GB de RAM por janela de 40 s.
Num Mac de 8 GB isso entrava em swapping e travava o computador durante a separação —
relatado pelo usuário em 06/11/2026 ("ficou 10 min nos 20% e travou"). Este aqui
trabalha no arquivo inteiro com poucas centenas de MB.

## Dependências

`numpy`, `librosa`, `soundfile` — instaladas no Python do motor de IA na primeira vez
que a separação da bateria roda.
