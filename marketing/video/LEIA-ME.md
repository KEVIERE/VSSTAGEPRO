# Vídeo de divulgação — VS Stage Pro (9:16, 60 s)

Vídeo vertical para Reels, Stories, TikTok e anúncio pago.

**O vídeo mostra as telas reais do programa**, não um desenho. As capturas ficam em
`~/Documents/VS STAGE PROJECT/capturas-site-novo/` e `capturas-programa-entrada/`, e cada
cena enquadra um pedaço delas com movimento de câmera (pan e zoom). Se o programa mudar,
basta trocar as capturas — o vídeo acompanha.

```
marketing/video/
  cenas/                as 7 cenas (uma função desenhar(t) por cena)
  lib/capturas.mjs      carrega as capturas e recorta a janela da câmera
  lib/cena3.mjs         moldura: fundo, títulos, rodapé, transições
  render.mjs            desenha os quadros
  montar.mjs            junta os quadros e o áudio no MP4
  roteiro.md            o roteiro, por cena
  narracao-texto.json   o texto da locução
  gerar-narracao.*      locução na ElevenLabs (a boa)
  narrar-local.mjs      locução de reserva com a voz do macOS (sem rede)
```

## Como gerar

```
cd "marketing/video" && node render.mjs --todos --out quadros --paralelo 6
```

```
cd "marketing/video" && ./gerar-narracao.command --listar-vozes
cd "marketing/video" && ./gerar-narracao.command
```

```
cd "marketing/video" && node montar.mjs
```

Sai `vs-stage-pro-9x16.mp4` (H.264, yuv420p, loudness de web) e `capa.jpg`.

Sem a ElevenLabs, a narração de reserva sai do próprio Mac:

```
cd "marketing/video" && node narrar-local.mjs
```

## As capturas usadas

| Cena | Captura |
|---|---|
| Abertura | `3-modo-show.png` |
| O problema | `depois-20-ferramentas.png` |
| A IA | `depois-ia.png` |
| Modo Show | `3-modo-show.png` (4 enquadramentos) |
| A banda | `4-celular.png` e `5-teleprompter.png` |
| A mesa | `depois-mixer-timecode-master.png` |
| Fechamento | `2-aparelhos.png` |

## Regras do motor

- **Nada de `<text>` em SVG.** O librsvg gasta ~1 s por rasterização com fonte nomeada.
  Todo texto é Pango (`texto()` de `lib/core.mjs`) e entra como camada própria.
- **Nenhuma camada de tela inteira muda por quadro.** Cada peça é desenhada só no retângulo
  que ocupa.
- O recorte da captura nunca sai da imagem (`extract_area` do sharp recusa área fora dela).

Com isso o render inteiro (1.800 quadros) sai em ~70 s.

## Trocar o texto

- O que a locução fala: `narracao-texto.json`.
- O que aparece na tela: dentro de cada arquivo de `cenas/`.
- A ordem e o tempo das cenas: `inicio` e `fim` no topo de cada cena.

## Fonte

O programa usa Inter; ela não está instalada nesta máquina e o renderizador cairia num
fallback estranho. O texto do vídeo usa **SF Pro Text** e os números **SF Mono**, as mais
próximas disponíveis. Para ficar idêntico, instale a Inter e troque `FONTE` em `lib/cena3.mjs`.
