# Vídeo de divulgação — VS Stage Pro (9:16, 60 s)

Vídeo vertical para Reels, Stories, TikTok e anúncio pago. Tudo é gerado a partir do código
desta pasta: os quadros são desenhados no visual atual do programa (mesa analógica: painel de aço,
fita crepe, faders, displays de 7 segmentos) e o ffmpeg junta tudo.

```
marketing/video/
  cenas/            as 7 cenas (uma função desenhar(t) por cena)
  lib/              o motor: cores, tipos, peças da mesa, camadas, cromo
  render.mjs        desenha os quadros
  montar.mjs        junta os quadros e o áudio no MP4
  roteiro.md        o roteiro, com tempo de cada cena
  narracao-texto.json   o texto que a locução fala
  gerar-narracao.*      gera a locução na ElevenLabs
```

## Como gerar

1. Desenhar os 1.800 quadros (60 s a 30 fps):

```
cd "marketing/video" && node render.mjs --todos --out quadros --paralelo 6
```

2. Gerar a locução (uma vez), com a chave da ElevenLabs:

```
cd "marketing/video" && ./gerar-narracao.command --listar-vozes
cd "marketing/video" && ./gerar-narracao.command
```

3. Montar o vídeo final:

```
cd "marketing/video" && node montar.mjs
```

Sai `vs-stage-pro-9x16.mp4` (H.264, yuv420p, loudness de web) e `capa.jpg`.

## Sobre o visual

O vídeo usa os componentes reais do programa, copiados de `src/index.css` e de
`src/components/SegmentDisplay.tsx`:

| Peça do vídeo | Origem |
|---|---|
| Painel de aço, grão da tinta | `.console-face` |
| Trilho escuro do topo | `.console-rail` |
| Fita crepe com o nome do canal | `.console-tape` |
| Rebaixo dos medidores | `.console-well` |
| Fenda e capa do fader (banda/clique/master) | `.console-slot`, `.console-cap` |
| Teclas e LEDs | `.console-key`, `.console-led` |
| Vidro do display e aro de metal | `.console-display`, `.console-bezel` |
| Números de 7 segmentos | `SegmentDisplay.tsx` (mesma geometria, mesma inclinação) |

As cores, os tamanhos e os espaçamentos são os mesmos do app, para o vídeo e o programa parecerem
a mesma coisa.

## Regras do motor (importantes para não travar)

- **Nada de `<text>` em SVG.** O librsvg gasta ~1 s por rasterização com fonte nomeada. Todo texto
  é Pango (`texto()` de `lib/core.mjs`, ~4 ms) e entra como camada própria.
- **Nada de camada de tela inteira que muda por quadro.** O custo é por pixel: cada peça é desenhada
  só no retângulo que ocupa.
- Só o fundo (halo + grade), a vinheta e a cartela final são de tela inteira, e ficam em cache.

## Trocar o texto

- O que a locução fala: `narracao-texto.json`.
- O que aparece na tela: dentro de cada arquivo de `cenas/`.
- A ordem e o tempo das cenas: `inicio` e `fim` no topo de cada arquivo de cena.
