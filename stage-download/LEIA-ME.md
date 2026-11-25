# Stage Download

Cole um link e baixe o áudio ou o vídeo.

## Como abrir
Duplo clique em `iniciar.command`. Na primeira vez ele instala tudo sozinho (precisa de Python 3 e `ffmpeg`: `brew install ffmpeg`). O programa abre no navegador em http://127.0.0.1:8765. Para fechar, feche a janela do Terminal.

## O que baixa
- **YouTube, YouTube Music, Instagram, Facebook, TikTok, X, SoundCloud, Vimeo** e centenas de outros sites: vídeo + áudio (MP4) ou só o áudio.
- **Spotify, Deezer, Amazon Music, Apple Music**: só áudio. Esses serviços criptografam o áudio, então o programa lê o nome da música e do artista no link e baixa a mesma faixa do YouTube, com título, artista e capa gravados no arquivo. Spotify e Deezer aceitam música, álbum e playlist; Amazon e Apple Music, uma música por vez.

## Formatos
| Formato | Qualidades |
|---|---|
| MP3 | 320, 256, 192, 128, 64 kbps |
| WAV | 16-bit/44,1 kHz, 24-bit/48 kHz, 24-bit/96 kHz, 32-bit float, 64-bit float |
| FLAC | 16-bit/44,1 kHz, 24-bit/48 kHz, 24-bit/96 kHz |
| M4A (AAC) | 256, 192, 128, 64 kbps |
| Vídeo MP4 | melhor, 4K, 1080p, 720p, 480p, 360p |

O áudio de origem do YouTube vem em ~128–160 kbps. Converter para 320 kbps ou WAV 24-bit não recupera qualidade que a fonte não tem: serve para compatibilidade com o programa ou equipamento que exige esse formato.

## Posts privados
Instagram e Facebook às vezes pedem login. Em "usar o login do navegador", escolha o navegador em que você já está logado.

## Arquivos
- `app.py`: servidor local e fila de downloads
- `downloader.py`: detecção de plataforma, leitura do Spotify/Deezer, busca no YouTube e formatos
- `static/index.html`: a interface
