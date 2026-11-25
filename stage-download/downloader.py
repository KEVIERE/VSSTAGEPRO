"""Motor do Stage Download.

Plataformas de vídeo (YouTube, YouTube Music, Instagram, Facebook, TikTok...):
o yt-dlp baixa direto do link.

Plataformas de streaming com DRM (Spotify, Deezer, Amazon Music, Apple Music):
o áudio delas é criptografado, então o programa lê só o nome da música e do
artista no link e baixa a mesma faixa do YouTube, gravando as tags certas.
"""

import html
import json
import re
import unicodedata
from urllib.parse import urlparse

import requests
import yt_dlp

UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}

# ---------------------------------------------------------------- formatos

AUDIO_FORMATS = {
    "mp3": {"label": "MP3", "qualities": {"320": "320 kbps", "256": "256 kbps", "192": "192 kbps", "128": "128 kbps", "64": "64 kbps (leve)"}},
    "wav": {"label": "WAV", "qualities": {
        "16-44": "16-bit / 44,1 kHz (qualidade de CD)", "24-48": "24-bit / 48 kHz",
        "24-96": "24-bit / 96 kHz", "32-48": "32-bit float / 48 kHz", "64-48": "64-bit float / 48 kHz"}},
    "flac": {"label": "FLAC", "qualities": {"16-44": "16-bit / 44,1 kHz", "24-48": "24-bit / 48 kHz", "24-96": "24-bit / 96 kHz"}},
    "m4a": {"label": "M4A (AAC)", "qualities": {"256": "256 kbps", "192": "192 kbps", "128": "128 kbps", "64": "64 kbps (leve)"}},
}

VIDEO_QUALITIES = {"best": "Melhor disponível", "2160": "4K (2160p)", "1080": "1080p", "720": "720p", "480": "480p", "360": "360p"}

MUSIC_SERVICES = {"spotify", "deezer", "amazon", "apple"}


def detect_platform(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if "spotify." in host or host == "spotify.link":
        return "spotify"
    if "deezer." in host or "dzr.page.link" in host:
        return "deezer"
    if "music.amazon." in host or "amazon." in host and "/music" in url:
        return "amazon"
    if "music.apple.com" in host:
        return "apple"
    if "music.youtube.com" in host:
        return "youtube_music"
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube"
    if "instagram.com" in host:
        return "instagram"
    if "facebook.com" in host or "fb.watch" in host or "fb.com" in host:
        return "facebook"
    if "tiktok.com" in host:
        return "tiktok"
    return "outro"


PLATFORM_NAMES = {
    "spotify": "Spotify", "deezer": "Deezer", "amazon": "Amazon Music", "apple": "Apple Music",
    "youtube_music": "YouTube Music", "youtube": "YouTube", "instagram": "Instagram",
    "facebook": "Facebook", "tiktok": "TikTok", "outro": "Link",
}


# ---------------------------------------------------- leitura de metadados


class ResolveError(Exception):
    pass


def _track(title, artist, album=None, duration=None):
    title, artist = title.replace("\u00a0", " "), (artist or "").replace("\u00a0", " ")
    return {"title": title.strip(), "artist": (artist or "").strip(), "album": album, "duration": duration}


def resolve_spotify(url: str):
    if "spotify.link" in url:
        url = requests.get(url, headers=UA, timeout=20, allow_redirects=True).url
    m = re.search(r"(track|album|playlist|episode)[/:]([A-Za-z0-9]+)", url)
    if not m:
        raise ResolveError("Não reconheci esse link do Spotify. Use um link de música, álbum ou playlist.")
    kind, sid = m.groups()
    page = requests.get(f"https://open.spotify.com/embed/{kind}/{sid}", headers=UA, timeout=20).text
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
    if not m:
        raise ResolveError("O Spotify não respondeu com os dados da música. Tente de novo em instantes.")
    entity = json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
    if kind in ("track", "episode"):
        artists = ", ".join(a["name"] for a in entity.get("artists") or []) or entity.get("subtitle", "")
        dur = entity.get("duration")
        return entity.get("name") or entity.get("title"), [_track(entity.get("name") or entity.get("title"), artists, None, dur / 1000 if dur else None)]
    album = entity.get("name") or entity.get("title")
    tracks = [
        _track(t["title"], t.get("subtitle", ""), album if kind == "album" else None, (t.get("duration") or 0) / 1000 or None)
        for t in entity.get("trackList") or []
    ]
    if not tracks:
        raise ResolveError("Essa lista do Spotify está vazia ou é privada.")
    return album, tracks


def resolve_deezer(url: str):
    if "deezer.com" not in urlparse(url).netloc or "link.deezer" in url:
        url = requests.get(url, headers=UA, timeout=20, allow_redirects=True).url
    m = re.search(r"(track|album|playlist)/(\d+)", url)
    if not m:
        raise ResolveError("Não reconheci esse link do Deezer. Use um link de música, álbum ou playlist.")
    kind, did = m.groups()
    data = requests.get(f"https://api.deezer.com/{kind}/{did}", timeout=20).json()
    if "error" in data:
        raise ResolveError("O Deezer não encontrou esse conteúdo.")
    if kind == "track":
        return data["title"], [_track(data["title"], data["artist"]["name"], data.get("album", {}).get("title"), data.get("duration"))]
    name = data.get("title")
    items = data.get("tracks", {}).get("data", [])
    album = name if kind == "album" else None
    return name, [_track(t["title"], t["artist"]["name"], album or t.get("album", {}).get("title"), t.get("duration")) for t in items]


def _og(page: str, prop: str):
    m = re.search(rf'<meta[^>]+(?:property|name)="{prop}"[^>]+content="([^"]*)"', page) or re.search(
        rf'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="{prop}"', page
    )
    return html.unescape(m.group(1)) if m else None


def resolve_by_page(url: str, service: str):
    """Amazon Music / Apple Music: lê o título da página (só faixas)."""
    page = requests.get(url, headers=UA, timeout=20).text
    title = _og(page, "og:title") or _og(page, "twitter:title")
    if not title:
        m = re.search(r"<title>(.*?)</title>", page, re.S)
        title = html.unescape(m.group(1)) if m else None
    if not title:
        raise ResolveError(f"Não consegui ler o nome da música no link do {PLATFORM_NAMES[service]}.")
    title = re.sub(r"\s*(on|no|em)\s+(Apple Music|Amazon Music).*$", "", title, flags=re.I)
    title = re.sub(r"\s*[|-]\s*(Apple Music|Amazon Music).*$", "", title, flags=re.I).strip()
    desc = _og(page, "og:description") or ""
    artist = ""
    m = re.search(r"(?:by|de|por)\s+([^·•|\n]+?)(?:\s+on|\s+no|\s+em|\s*[·•|]|$)", desc, re.I)
    if m:
        artist = m.group(1).strip()
    if " - " in title and not artist:
        title, artist = [p.strip() for p in title.split(" - ", 1)]
    return title, [_track(title, artist)]


def resolve_music_link(url: str, platform: str):
    if platform == "spotify":
        return resolve_spotify(url)
    if platform == "deezer":
        return resolve_deezer(url)
    return resolve_by_page(url, platform)


# ------------------------------------------------- busca da faixa no YouTube


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", s)


BAD_WORDS = ("cover", "karaoke", "instrumental", "remix", "live", "ao vivo", "slowed", "sped up", "8d", "reaction", "nightcore")


def find_on_youtube(track, ydl_base_opts):
    query = f"{track['artist']} - {track['title']}".strip(" -")
    opts = {**ydl_base_opts, "extract_flat": True, "quiet": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        res = ydl.extract_info(f"ytsearch8:{query} audio", download=False)
    entries = [e for e in (res or {}).get("entries") or [] if e and e.get("id")]
    if not entries:
        return None
    want_title = _norm(track["title"])
    want_artist = _norm(track["artist"].split(",")[0])
    best, best_score = None, -1e9
    for i, e in enumerate(entries):
        name = _norm(f"{e.get('title', '')} {e.get('channel') or e.get('uploader') or ''}")
        score = -i * 2
        score += sum(8 for w in want_title.split() if w in name)
        score += 15 if want_artist and want_artist in name else 0
        score += 10 if "topic" in name or "official audio" in name else 0
        for w in BAD_WORDS:
            if w in name and w not in want_title:
                score -= 25
        if track.get("duration") and e.get("duration"):
            diff = abs(e["duration"] - track["duration"])
            score += 30 if diff <= 3 else 15 if diff <= 10 else -20 if diff > 30 else 0
        if score > best_score:
            best, best_score = e, score
    return f"https://www.youtube.com/watch?v={best['id']}"


# -------------------------------------------------------- opções do yt-dlp


def build_opts(mode, fmt, quality, out_dir, cookies_browser=None):
    opts = {
        "outtmpl": f"{out_dir}/%(title).180B.%(ext)s",
        "windowsfilenames": True,
        "noplaylist": False,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "retries": 5,
        "fragment_retries": 5,
        "overwrites": False,
    }
    if cookies_browser:
        opts["cookiesfrombrowser"] = (cookies_browser,)

    if mode == "video":
        h = "" if quality == "best" else f"[height<={quality}]"
        # H.264 primeiro (abre em qualquer player); 4K no YouTube só existe em VP9/AV1
        h264 = "" if quality in ("best", "2160") else f"bestvideo{h}[vcodec^=avc1]+bestaudio[ext=m4a]/"
        opts["format"] = f"{h264}bestvideo{h}[ext=mp4]+bestaudio[ext=m4a]/bestvideo{h}+bestaudio/best{h}/best"
        opts["merge_output_format"] = "mp4"
        opts["postprocessors"] = [{"key": "FFmpegMetadata", "add_metadata": True}]
        return opts

    opts["format"] = "bestaudio/best"
    pp_args = []
    if fmt in ("mp3", "m4a"):
        codec_q = quality
    else:
        codec_q = None
        bits, rate = quality.split("-") if "-" in quality else ("16", "44")
        sample_rate = {"44": "44100", "48": "48000", "96": "96000"}[rate]
        if fmt == "wav":
            codec = {"16": "pcm_s16le", "24": "pcm_s24le", "32": "pcm_f32le", "64": "pcm_f64le"}[bits]
            pp_args = ["-c:a", codec, "-ar", sample_rate]
        else:  # flac
            pp_args = ["-sample_fmt", "s32" if bits == "24" else "s16", "-ar", sample_rate]
            if bits == "24":
                pp_args += ["-bits_per_raw_sample", "24"]
    if fmt == "mp3":
        pp_args = ["-ar", "44100"]

    extract = {"key": "FFmpegExtractAudio", "preferredcodec": fmt}
    if codec_q:
        extract["preferredquality"] = codec_q
    opts["postprocessors"] = [extract, {"key": "FFmpegMetadata", "add_metadata": True}]
    if fmt in ("mp3", "m4a", "flac"):
        opts["writethumbnail"] = True
        opts["postprocessors"].append({"key": "EmbedThumbnail"})
    if pp_args:
        opts["postprocessor_args"] = {"extractaudio": pp_args}
    return opts


# ------------------------------------------- qualidade real do link enviado

# bitrates padrão de MP3/AAC, do maior para o menor
STD_BITRATES = (320, 256, 224, 192, 160, 128, 96, 64)
RATE_HZ = {"44": 44100, "48": 48000, "96": 96000}


def source_quality(info: dict):
    """Lê nos formatos do yt-dlp o melhor áudio e o maior vídeo que o link tem."""
    formats = (info or {}).get("formats") or []
    audio_only = [f for f in formats if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")]
    with_audio = audio_only or [f for f in formats if f.get("acodec") not in (None, "none")]
    best = None
    for f in with_audio:
        abr = f.get("abr") or (f.get("tbr") if f in audio_only else None)
        if abr and (best is None or abr > best[0]):
            best = (abr, f)
    rates = [f.get("asr") for f in with_audio if f.get("asr")]
    heights = [f.get("height") for f in formats if f.get("vcodec") not in (None, "none") and f.get("height")]
    if not formats and info:
        # link de arquivo único sem lista de formatos
        best = (info.get("abr"), info) if info.get("abr") else None
        rates = [info["asr"]] if info.get("asr") else []
        heights = [info["height"]] if info.get("height") else []
    codec = (best[1].get("acodec") or "").split(".")[0] if best else None
    return {
        "abr": round(best[0]) if best else None,
        "acodec": {"mp4a": "AAC", "opus": "Opus", "mp3": "MP3", "vorbis": "Vorbis", "flac": "FLAC"}.get(codec, codec.upper() if codec else None),
        "asr": max(rates) if rates else None,
        "height": max(heights) if heights else None,
    }


def limit_options(src: dict):
    """Só deixa as qualidades até o máximo que o link realmente tem."""
    abr, asr, height = (src or {}).get("abr"), (src or {}).get("asr"), (src or {}).get("height")
    audio = {}
    for fmt, spec in AUDIO_FORMATS.items():
        q = dict(spec["qualities"])
        if fmt in ("mp3", "m4a") and abr:
            # tolerância de 5%: o YouTube informa 129 kbps para um AAC de 128
            top = next((b for b in STD_BITRATES if b <= abr * 1.05), STD_BITRATES[-1])
            if fmt == "m4a":
                top = min(top, 320)
            lower = {k: v for k, v in q.items() if int(k) < top}
            q = {str(top): f"{top} kbps (máximo do link)", **lower}
        elif fmt in ("wav", "flac") and asr:
            kept = {k: v for k, v in q.items() if RATE_HZ[k.split("-")[1]] <= asr}
            q = kept or {next(iter(q)): q[next(iter(q))]}
        audio[fmt] = {"label": spec["label"], "qualities": q}
    video = dict(VIDEO_QUALITIES)
    if height:
        video = {k: v for k, v in video.items() if k == "best" or int(k) <= height}
        if len(video) == 1:  # vídeo menor que 360p
            video = {"best": f"Melhor disponível ({height}p)"}
    return audio, video


def valid_quality(mode: str, fmt: str, quality: str) -> bool:
    if mode == "video":
        return quality in VIDEO_QUALITIES
    if fmt not in AUDIO_FORMATS:
        return False
    if fmt in ("mp3", "m4a"):
        return quality.isdigit() and int(quality) in STD_BITRATES
    return quality in AUDIO_FORMATS[fmt]["qualities"]
