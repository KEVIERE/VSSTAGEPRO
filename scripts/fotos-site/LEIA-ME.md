# Fotos do site (public/site)

As telas do site saem do programa de verdade, com um show de exemplo (Música 01 a 08, Show Prefeitura).

1. Ligar o servidor de desenvolvimento na porta 5190 (`npm run dev -- --port 5190`).
2. Servir um projeto .vss qualquer, só para as ondas: `node scripts/fotos-site/servir-show.mjs "/caminho/do/show.vss" 5199`
   (a página espera o arquivo em `http://127.0.0.1:5199/TESTE%20STEAMS.vss`: troque no passos.json se o nome for outro).
3. Tirar as fotos (Chrome sem janela e sem som, relógio às 21h): `node scripts/fotos-site/tirar-fotos.mjs /tmp/fotos scripts/fotos-site/passos.json`
4. Converter para o site: `ffmpeg -i /tmp/fotos/imac.png -q:v 3 -pix_fmt yuvj420p public/site/imac.jpg` (e assim por diante).
   O Maestro sai de `maestro-full.png`: `ffmpeg -i maestro-full.png -vf crop=2560:576:640:200 maestro.jpg`.
5. Subir o `?v=` das imagens trocadas em SalesPage.tsx e siteContent.ts (o nginx guarda imagens por 30 dias).

Páginas usadas: `tests/browser/site-shots.html` (programa), `site-musico.html` (celular), `site-produtor.html` (tablet e `?tv`).
O vídeo dos faders sai de `scripts/gravar-video-faders.mjs`.
