"""Stage Download: servidor local com a interface no navegador.

Rode com:  ./iniciar.command   (ou  .venv/bin/python app.py)
"""

import json
import os
import subprocess
import sys
import threading
import uuid
import webbrowser
from pathlib import Path

import yt_dlp
from flask import Flask, jsonify, request, send_from_directory

import downloader as dl

BASE = Path(__file__).resolve().parent
CONFIG_FILE = BASE / "config.json"
PORT = int(os.environ.get("STAGE_PORT", "8765"))

app = Flask(__name__, static_folder=str(BASE / "static"))
app.json.sort_keys = False  # mantém a ordem dos formatos/qualidades
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
# faixa do YouTube achada na análise, para o download usar a mesma
yt_cache: dict[str, str] = {}


# ----------------------------------------------------------------- config


def load_config():
    cfg = {"folder": str(Path.home() / "Downloads" / "Stage Download"), "cookies": ""}
    if CONFIG_FILE.exists():
        try:
            cfg.update(json.loads(CONFIG_FILE.read_text()))
        except Exception:
            pass
    return cfg


def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))


def friendly_error(e: Exception) -> str:
    msg = str(e)
    msg = msg.replace("ERROR: ", "")
    low = msg.lower()
    if "login" in low or "cookies" in low or "private" in low or "rate-limit" in low:
        return ("Esse conteúdo pede login. Em Configurações, escolha o navegador em que você "
                "já está logado (Chrome, Safari...) e tente de novo.")
    if "unsupported url" in low:
        return "Esse site ou tipo de link não é suportado."
    if "video unavailable" in low or "not available" in low:
        return "Esse vídeo não está disponível (removido, privado ou bloqueado na sua região)."
    return msg[:300]


# ----------------------------------------------------------------- rotas


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/options")
def options():
    return jsonify({"audio": dl.AUDIO_FORMATS, "video": dl.VIDEO_QUALITIES, "config": load_config()})


@app.post("/api/config")
def set_config():
    cfg = load_config()
    body = request.get_json(force=True)
    for k in ("folder", "cookies"):
        if k in body:
            cfg[k] = body[k]
    save_config(cfg)
    return jsonify(cfg)


@app.post("/api/choose-folder")
def choose_folder():
    if sys.platform != "darwin":
        return jsonify({"error": "Seletor de pasta só no macOS. Digite o caminho."}), 400
    try:
        out = subprocess.run(
            ["osascript", "-e", 'POSIX path of (choose folder with prompt "Onde salvar os downloads?")'],
            capture_output=True, text=True, timeout=300,
        )
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Tempo esgotado"}), 400
    path = out.stdout.strip()
    if not path:
        return jsonify({"cancelled": True})
    cfg = load_config()
    cfg["folder"] = path.rstrip("/")
    save_config(cfg)
    return jsonify(cfg)


@app.post("/api/open-folder")
def open_folder():
    folder = Path(load_config()["folder"])
    folder.mkdir(parents=True, exist_ok=True)
    opener = "open" if sys.platform == "darwin" else "explorer" if os.name == "nt" else "xdg-open"
    subprocess.Popen([opener, str(folder)])
    return jsonify({"ok": True})


def _ydl_base(cfg):
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    if cfg.get("cookies"):
        opts["cookiesfrombrowser"] = (cfg["cookies"],)
    return opts


def _probe(url, cfg):
    """Extração completa de um único item, só para ler os formatos."""
    try:
        with yt_dlp.YoutubeDL({**_ydl_base(cfg), "noplaylist": True}) as ydl:
            return dl.source_quality(ydl.extract_info(url, download=False))
    except Exception:
        return None


def _track_key(t):
    return f"{t['artist']} - {t['title']}".strip(" -")


def _with_limits(payload, src):
    audio, video = dl.limit_options(src)
    return {**payload, "source": src, "audio": audio, "video": video}


@app.post("/api/info")
def info():
    url = (request.get_json(force=True).get("url") or "").strip()
    if not url.startswith("http"):
        return jsonify({"error": "Cole um link que comece com http."}), 400
    platform = dl.detect_platform(url)
    base = {"platform": platform, "platform_name": dl.PLATFORM_NAMES[platform],
            "can_video": platform not in dl.MUSIC_SERVICES}
    cfg = load_config()
    try:
        if platform in dl.MUSIC_SERVICES:
            name, tracks = dl.resolve_music_link(url, platform)
            # o áudio vem da mesma faixa no YouTube: mede a qualidade dela
            src = None
            yt_url = dl.find_on_youtube(tracks[0], {k: v for k, v in _ydl_base(cfg).items() if k == "cookiesfrombrowser"})
            if yt_url:
                yt_cache[_track_key(tracks[0])] = yt_url
                src = _probe(yt_url, cfg)
            return jsonify(_with_limits({**base, "title": name, "count": len(tracks),
                            "tracks": [_track_key(t) for t in tracks[:50]]}, src))
        with yt_dlp.YoutubeDL({**_ydl_base(cfg), "extract_flat": "in_playlist"}) as ydl:
            data = ydl.extract_info(url, download=False)
        entries = [e for e in data.get("entries") or [] if e] if data.get("_type") == "playlist" else []
        if entries:
            first = entries[0].get("url") or entries[0].get("webpage_url")
            src = _probe(first, cfg) if first else None
        else:
            src = dl.source_quality(data)
        thumb = data.get("thumbnail") or (data.get("thumbnails") or [{}])[-1].get("url")
        if not thumb and entries:
            thumb = (entries[0].get("thumbnails") or [{}])[-1].get("url")
        return jsonify(_with_limits({**base, "title": data.get("title") or "Sem título", "thumbnail": thumb,
                        "uploader": data.get("uploader") or data.get("channel"),
                        "duration": data.get("duration"), "count": len(entries) or 1,
                        "tracks": [e.get("title") or e.get("id") for e in entries[:50]]}, src))
    except dl.ResolveError as e:
        return jsonify({**base, "error": str(e)}), 400
    except Exception as e:
        return jsonify({**base, "error": friendly_error(e)}), 400


@app.post("/api/download")
def start_download():
    body = request.get_json(force=True)
    url = (body.get("url") or "").strip()
    mode = body.get("mode", "audio")
    fmt = body.get("format", "mp3")
    quality = body.get("quality", "320")
    if not dl.valid_quality(mode, fmt, quality):
        return jsonify({"error": "Formato ou qualidade inválida"}), 400
    job_id = uuid.uuid4().hex[:10]
    job = {"id": job_id, "url": url, "mode": mode, "format": fmt, "quality": quality,
           "label": str(body.get("label") or "")[:80],
           "state": "starting", "title": body.get("title") or url, "items": [], "error": None}
    with jobs_lock:
        jobs[job_id] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return jsonify({"id": job_id})


@app.get("/api/jobs")
def list_jobs():
    with jobs_lock:
        return jsonify(list(jobs.values())[::-1])


@app.post("/api/jobs/clear")
def clear_jobs():
    with jobs_lock:
        for k in [k for k, j in jobs.items() if j["state"] in ("done", "error")]:
            del jobs[k]
    return jsonify({"ok": True})


# ---------------------------------------------------------------- download


def run_job(job):
    cfg = load_config()
    folder = Path(cfg["folder"]).expanduser()
    folder.mkdir(parents=True, exist_ok=True)
    platform = dl.detect_platform(job["url"])
    opts = dl.build_opts(job["mode"], job["format"], job["quality"], str(folder), cfg.get("cookies") or None)
    items_by_key = {}

    def item_for(info, fallback_title=None):
        key = fallback_title or info.get("id")
        if key not in items_by_key:
            it = {"name": fallback_title or info.get("title") or key, "progress": 0, "state": "baixando", "file": None, "error": None}
            items_by_key[key] = it
            job["items"].append(it)
        return items_by_key[key]

    current = {"name": None}

    def progress_hook(d):
        it = item_for(d.get("info_dict") or {}, current["name"])
        if job["title"] == job["url"] and (d.get("info_dict") or {}).get("title"):
            job["title"] = d["info_dict"].get("playlist_title") or d["info_dict"]["title"]
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                # vídeo + áudio vêm separados; mostra o progresso do pedaço atual
                it["progress"] = round(d.get("downloaded_bytes", 0) / total * 90, 1)
            it["state"] = "baixando"
        elif d["status"] == "finished":
            it["progress"] = 90
            it["state"] = "convertendo"

    def pp_hook(d):
        info = d.get("info_dict") or {}
        it = item_for(info, current["name"])
        if d["status"] == "started":
            it["state"] = "convertendo"
        elif d["status"] == "finished" and info.get("filepath"):
            it["file"] = Path(info["filepath"]).name

    opts["progress_hooks"] = [progress_hook]
    opts["postprocessor_hooks"] = [pp_hook]
    job["state"] = "running"

    try:
        if platform in dl.MUSIC_SERVICES:
            name, tracks = dl.resolve_music_link(job["url"], platform)
            job["title"] = name
            if len(tracks) > 1:
                sub = folder / sanitize(name)
                sub.mkdir(parents=True, exist_ok=True)
                opts["outtmpl"] = f"{sub}/%(title).180B.%(ext)s"
            for t in tracks:
                label = f"{t['artist']} - {t['title']}".strip(" -")
                current["name"] = label
                it = item_for({}, label)
                it["state"] = "procurando"
                try:
                    yt_url = yt_cache.get(label) or dl.find_on_youtube(t, {k: opts[k] for k in ("cookiesfrombrowser",) if k in opts})
                    if not yt_url:
                        raise RuntimeError("Não encontrei essa música no YouTube.")
                    with yt_dlp.YoutubeDL({**opts, "noplaylist": True}) as ydl:
                        info = ydl.extract_info(yt_url, download=False)
                        info["title"] = label
                        info["track"] = t["title"]
                        if t["artist"]:
                            info["artist"] = t["artist"]
                            info["artists"] = [a.strip() for a in t["artist"].split(",")]
                        if t.get("album"):
                            info["album"] = t["album"]
                        ydl.process_ie_result(info, download=True)
                    it["progress"], it["state"] = 100, "pronto"
                except Exception as e:
                    it["state"], it["error"] = "erro", friendly_error(e)
        else:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([job["url"]])
            for it in job["items"]:
                if it["state"] != "erro":
                    it["progress"], it["state"] = 100, "pronto"
        failed = [i for i in job["items"] if i["state"] == "erro"]
        if job["items"] and len(failed) == len(job["items"]):
            job["state"], job["error"] = "error", failed[0]["error"]
        else:
            job["state"] = "done"
    except Exception as e:
        job["state"], job["error"] = "error", friendly_error(e)
        for it in job["items"]:
            if it["state"] not in ("pronto", "erro"):
                it["state"] = "erro"


def sanitize(name: str) -> str:
    return "".join(c for c in name if c not in '\\/:*?"<>|').strip()[:120] or "Download"


if __name__ == "__main__":
    url = f"http://127.0.0.1:{PORT}"
    print(f"\n  Stage Download rodando em {url}\n  (feche esta janela para encerrar)\n")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
