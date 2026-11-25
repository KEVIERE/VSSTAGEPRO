"""Stage Download no servidor do site (vsstagepro.com.br/stagedownload).

Bônus da Área do Assinante: a página do site manda o link para cá, o servidor baixa e converte,
e a pessoa recebe o arquivo pronto. Só quem é assinante em dia ou parceiro usa: cada pedido
traz o login do Supabase e é conferido na função bonus_access do banco.

O motor é o mesmo do programa do Mac (downloader.py). O que muda aqui:
- trava de assinante em todo pedido;
- um download por vez (a VPS tem 1 processador) e fila curta;
- limites por pessoa, duração máxima e vídeo até 1080p;
- os arquivos somem 1 hora depois de prontos.

Roda atrás do nginx, em 127.0.0.1:8790 (ver deploy/stage-download.*).
"""

import base64
import json
import os
import shutil
import threading
import time
import uuid
import zipfile
from pathlib import Path

import requests
import yt_dlp
from flask import Flask, jsonify, request, send_file

import downloader as dl

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://eknjqqiamuztomdygalv.supabase.co").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
DATA = Path(os.environ.get("STAGE_DATA", "/var/lib/stage-download"))

KEEP_SECONDS = 60 * 60          # arquivo pronto fica 1 hora
MAX_QUEUE = 8                   # pedidos esperando no servidor inteiro
MAX_ACTIVE_PER_USER = 2         # pedidos na fila ou baixando, por pessoa
MAX_ITEMS_PER_DAY = 60          # faixas por pessoa a cada 24 horas
MAX_TRACKS = 25                 # playlist / álbum
MAX_DURATION = 20 * 60          # cada faixa ou vídeo
MAX_VIDEO_HEIGHT = 1080         # 4K pesa demais na VPS
# O YouTube às vezes pede "confirme que você não é um robô" ao servidor. O caminho que ele mesmo
# aceita é entrar numa conta: se houver um arquivo de cookies de uma conta (no formato Netscape),
# o motor usa. Uma cópia por pedido, porque o yt-dlp regrava o arquivo ao terminar.
COOKIES = Path(os.environ.get("STAGE_COOKIES", "/etc/stage-download/youtube-cookies.txt"))

app = Flask(__name__)
app.json.sort_keys = False

jobs: dict[str, dict] = {}
lock = threading.Lock()
work = threading.Semaphore(1)   # um download por vez
day_counts: dict[str, list[float]] = {}
auth_cache: dict[str, tuple[float, str, str]] = {}


# ------------------------------------------------------------------ login e assinatura


class Denied(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


def _jwt_sub(token: str) -> str:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("sub") or ""
    except Exception:
        return ""


def require_subscriber() -> str:
    """Devolve o id da conta. Só passa assinante em dia ou parceiro (bonus_access)."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise Denied(401, "login")
    token = auth[7:]
    now = time.time()
    hit = auth_cache.get(token)
    if hit and hit[0] > now:
        status, sub = hit[1], hit[2]
    else:
        try:
            r = requests.post(
                f"{SUPABASE_URL}/rest/v1/rpc/bonus_access",
                headers={"apikey": SUPABASE_ANON_KEY, "Authorization": auth, "Content-Type": "application/json"},
                json={}, timeout=10,
            )
        except requests.RequestException:
            raise Denied(503, "check_failed")
        if r.status_code == 401:
            raise Denied(401, "login")
        if not r.ok:
            raise Denied(503, "check_failed")
        status = (r.json() or {}).get("status", "none")
        # o banco aceitou o login: o "sub" do token é a conta de verdade
        sub = _jwt_sub(token) if status != "anonymous" else ""
        auth_cache[token] = (now + 60, status, sub)
        if len(auth_cache) > 2000:
            for k in [k for k, v in auth_cache.items() if v[0] < now]:
                auth_cache.pop(k, None)
    if status == "anonymous" or not sub:
        raise Denied(401, "login")
    if status != "subscriber":
        raise Denied(403, "not_subscriber")
    return sub


@app.errorhandler(Denied)
def _denied(e: Denied):
    return jsonify({"error": e.code}), e.status


def friendly_error(e: Exception) -> str:
    msg = str(e).replace("ERROR: ", "")
    low = msg.lower()
    if "sign in to confirm" in low or "not a bot" in low:
        return ("O YouTube recusou o nosso servidor agora (pediu confirmação de robô). "
                "Tente de novo em alguns minutos ou use outro link.")
    if "login" in low or "cookies" in low or "private" in low:
        return "Esse conteúdo é privado ou pede login, e o servidor não consegue abrir."
    if "unsupported url" in low:
        return "Esse site ou tipo de link não é suportado."
    if "video unavailable" in low or "not available" in low:
        return "Esse conteúdo não está disponível (removido, privado ou bloqueado)."
    if "max_duration" in low:
        return f"Cada faixa ou vídeo pode ter no máximo {MAX_DURATION // 60} minutos."
    return msg[:300]


def _cookie_copy(folder: Path):
    """Cópia dos cookies para este pedido (ou None, sem conta)."""
    try:
        if COOKIES.is_file():
            folder.mkdir(parents=True, exist_ok=True)
            dst = folder / "cookies.txt"
            shutil.copyfile(COOKIES, dst)
            return str(dst)
    except OSError:
        pass
    return None


def first_link(text: str) -> str:
    """O primeiro link do texto (colar duas vezes juntava dois links num só)."""
    t = (text or "").strip()
    i = t.lower().find("http")
    if i < 0:
        return t
    rest = t[i:]
    j = rest.lower().find("http", 4)
    return (rest[:j] if j > 0 else rest).split()[0]


def _base_opts():
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    c = _cookie_copy(DATA / "_info")
    if c:
        opts["cookiefile"] = c
    return opts


def _probe(url):
    try:
        with yt_dlp.YoutubeDL({**_base_opts(), "noplaylist": True}) as ydl:
            return dl.source_quality(ydl.extract_info(url, download=False))
    except Exception:
        return None


def _cap_video(video: dict) -> dict:
    return {k: v for k, v in video.items() if k == "best" or int(k) <= MAX_VIDEO_HEIGHT}


# ------------------------------------------------------------------ rotas


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/info")
def info():
    require_subscriber()
    url = first_link((request.get_json(silent=True) or {}).get("url") or "")
    if not url.startswith("http"):
        return jsonify({"error": "Cole um link que comece com http."}), 400
    platform = dl.detect_platform(url)
    base = {"platform": platform, "platform_name": dl.PLATFORM_NAMES[platform],
            "can_video": platform not in dl.MUSIC_SERVICES}
    try:
        if platform in dl.MUSIC_SERVICES:
            name, tracks = dl.resolve_music_link(url, platform)
            src = None
            yt = dl.find_on_youtube(tracks[0], {k: v for k, v in _base_opts().items() if k == "cookiefile"})
            if yt:
                src = _probe(yt)
            data = {**base, "title": name, "count": len(tracks),
                    "tracks": [f"{t['artist']} - {t['title']}".strip(" -") for t in tracks[:50]]}
        else:
            with yt_dlp.YoutubeDL({**_base_opts(), "extract_flat": "in_playlist"}) as ydl:
                d = ydl.extract_info(url, download=False)
            entries = [e for e in d.get("entries") or [] if e] if d.get("_type") == "playlist" else []
            if entries:
                first = entries[0].get("url") or entries[0].get("webpage_url")
                src = _probe(first) if first else None
            else:
                src = dl.source_quality(d)
            thumb = d.get("thumbnail") or (d.get("thumbnails") or [{}])[-1].get("url")
            if not thumb and entries:
                thumb = (entries[0].get("thumbnails") or [{}])[-1].get("url")
            data = {**base, "title": d.get("title") or "Sem título", "thumbnail": thumb,
                    "uploader": d.get("uploader") or d.get("channel"), "duration": d.get("duration"),
                    "count": len(entries) or 1, "tracks": [e.get("title") or e.get("id") for e in entries[:50]]}
        audio, video = dl.limit_options(src)
        data.update({"source": src, "audio": audio, "video": _cap_video(video),
                     "limits": {"tracks": MAX_TRACKS, "minutes": MAX_DURATION // 60, "video": MAX_VIDEO_HEIGHT}})
        return jsonify(data)
    except dl.ResolveError as e:
        return jsonify({**base, "error": str(e)}), 400
    except Exception as e:
        return jsonify({**base, "error": friendly_error(e)}), 400


def _public(job):
    out = {k: job[k] for k in ("id", "title", "label", "mode", "format", "quality", "state", "error", "zip", "created")}
    # o caminho no disco do servidor não vai para a página
    out["items"] = [{k: v for k, v in it.items() if k != "path"} for it in job["items"]]
    return out


@app.post("/download")
def start_download():
    user = require_subscriber()
    body = request.get_json(silent=True) or {}
    url = first_link(body.get("url") or "")
    mode = body.get("mode", "audio")
    fmt = body.get("format", "mp3")
    quality = str(body.get("quality", "320"))
    if not url.startswith("http"):
        return jsonify({"error": "Cole um link que comece com http."}), 400
    if not dl.valid_quality(mode, fmt, quality) or (mode == "video" and quality != "best" and int(quality) > MAX_VIDEO_HEIGHT):
        return jsonify({"error": "Formato ou qualidade inválida."}), 400
    now = time.time()
    with lock:
        mine = [j for j in jobs.values() if j["user"] == user and j["state"] in ("waiting", "running")]
        if len(mine) >= MAX_ACTIVE_PER_USER:
            return jsonify({"error": f"Você já tem {MAX_ACTIVE_PER_USER} downloads em andamento. Espere um terminar."}), 429
        waiting = [j for j in jobs.values() if j["state"] == "waiting"]
        if len(waiting) >= MAX_QUEUE:
            return jsonify({"error": "O servidor está cheio agora. Tente de novo em alguns minutos."}), 429
        recent = [t for t in day_counts.get(user, []) if now - t < 86400]
        day_counts[user] = recent
        if len(recent) >= MAX_ITEMS_PER_DAY:
            return jsonify({"error": f"Você chegou ao limite de {MAX_ITEMS_PER_DAY} faixas por dia. Volte amanhã."}), 429
        job_id = uuid.uuid4().hex
        job = {"id": job_id, "user": user, "url": url, "mode": mode, "format": fmt, "quality": quality,
               "label": str(body.get("label") or "")[:80], "title": str(body.get("title") or url)[:200],
               "state": "waiting", "error": None, "items": [], "zip": None, "created": now, "done_at": None}
        jobs[job_id] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return jsonify({"id": job_id})


@app.get("/jobs")
def list_jobs():
    user = require_subscriber()
    with lock:
        mine = [_public(j) for j in jobs.values() if j["user"] == user]
    return jsonify(sorted(mine, key=lambda j: j["created"], reverse=True))


@app.post("/jobs/clear")
def clear_jobs():
    user = require_subscriber()
    with lock:
        for k in [k for k, j in jobs.items() if j["user"] == user and j["state"] in ("done", "error")]:
            _forget(k)
    return jsonify({"ok": True})


@app.get("/file/<job_id>/<int:index>")
def get_file(job_id, index):
    # o link do arquivo vai num <a href>, sem cabeçalho de login: o id do pedido (128 bits
    # aleatórios) é a chave, e ele só é entregue para a conta dona do pedido em /jobs
    job = jobs.get(job_id)
    if not job or job["state"] not in ("done", "error"):
        return jsonify({"error": "not_found"}), 404
    if index == -1:
        path = job.get("zip_path")
    else:
        items = job["items"]
        path = items[index].get("path") if 0 <= index < len(items) else None
    if not path or not Path(path).exists():
        return jsonify({"error": "not_found"}), 404
    return send_file(path, as_attachment=True, download_name=Path(path).name)


# ------------------------------------------------------------------ download


def _forget(job_id):
    job = jobs.pop(job_id, None)
    if job:
        shutil.rmtree(DATA / job_id, ignore_errors=True)


def _too_long(info, *, incomplete):
    d = info.get("duration")
    if d and d > MAX_DURATION:
        return "max_duration"
    return None


def run_job(job):
    folder = DATA / job["id"]
    folder.mkdir(parents=True, exist_ok=True)
    platform = dl.detect_platform(job["url"])
    opts = dl.build_opts(job["mode"], job["format"], job["quality"], str(folder))
    opts["match_filter"] = _too_long
    opts["playlistend"] = MAX_TRACKS
    opts["max_filesize"] = 1_500_000_000
    cookies = _cookie_copy(folder / "_auth")
    if cookies:
        opts["cookiefile"] = cookies
    by_key = {}

    def item_for(info, label=None):
        key = label or info.get("id") or "x"
        if key not in by_key:
            it = {"name": label or info.get("title") or key, "progress": 0, "state": "baixando", "file": None, "error": None}
            by_key[key] = it
            job["items"].append(it)
        return by_key[key]

    current = {"name": None}

    def progress_hook(d):
        info = d.get("info_dict") or {}
        it = item_for(info, current["name"])
        if job["title"] == job["url"] and info.get("title"):
            job["title"] = info.get("playlist_title") or info["title"]
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                it["progress"] = round(d.get("downloaded_bytes", 0) / total * 90, 1)
            it["state"] = "baixando"
        elif d["status"] == "finished":
            it["progress"], it["state"] = 90, "convertendo"

    def pp_hook(d):
        info = d.get("info_dict") or {}
        it = item_for(info, current["name"])
        if d["status"] == "started":
            it["state"] = "convertendo"
        elif d["status"] == "finished" and info.get("filepath"):
            it["path"] = info["filepath"]
            it["file"] = Path(info["filepath"]).name

    opts["progress_hooks"] = [progress_hook]
    opts["postprocessor_hooks"] = [pp_hook]

    with work:
        job["state"] = "running"
        try:
            if platform in dl.MUSIC_SERVICES:
                name, tracks = dl.resolve_music_link(job["url"], platform)
                job["title"] = name
                for t in tracks[:MAX_TRACKS]:
                    label = f"{t['artist']} - {t['title']}".strip(" -")
                    current["name"] = label
                    it = item_for({}, label)
                    it["state"] = "procurando"
                    try:
                        yt = dl.find_on_youtube(t, {"cookiefile": cookies} if cookies else {})
                        if not yt:
                            raise RuntimeError("Não encontrei essa música.")
                        with yt_dlp.YoutubeDL({**opts, "noplaylist": True}) as ydl:
                            info = ydl.extract_info(yt, download=False)
                            if (info.get("duration") or 0) > MAX_DURATION:
                                raise RuntimeError("max_duration")
                            info["title"], info["track"] = label, t["title"]
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
                        if it.get("path"):
                            it["progress"], it["state"] = 100, "pronto"
                        else:
                            it["state"], it["error"] = "erro", "O arquivo não foi gerado (longo demais ou indisponível)."
            ok = [i for i in job["items"] if i["state"] == "pronto" and i.get("path")]
            with lock:
                day_counts.setdefault(job["user"], []).extend([time.time()] * len(ok))
            if len(ok) > 1:
                zpath = folder / f"{dl_safe(job['title'])}.zip"
                with zipfile.ZipFile(zpath, "w", zipfile.ZIP_STORED) as z:
                    for i in ok:
                        z.write(i["path"], Path(i["path"]).name)
                job["zip_path"] = str(zpath)
                job["zip"] = zpath.name
            if job["items"] and not ok:
                job["state"], job["error"] = "error", job["items"][0]["error"] or "Não foi possível baixar."
            elif not job["items"]:
                job["state"], job["error"] = "error", "Nada foi baixado desse link."
            else:
                job["state"] = "done"
        except Exception as e:
            job["state"], job["error"] = "error", friendly_error(e)
            for it in job["items"]:
                if it["state"] not in ("pronto", "erro"):
                    it["state"] = "erro"
        finally:
            job["done_at"] = time.time()
            for it in job["items"]:
                it.pop("path", None) if it["state"] != "pronto" else None


def dl_safe(name: str) -> str:
    return "".join(c for c in name if c not in '\\/:*?"<>|').strip()[:100] or "Stage Download"


def janitor():
    """Apaga os arquivos 1 hora depois de prontos, e o que sobrou de antes de reiniciar."""
    while True:
        time.sleep(300)
        now = time.time()
        with lock:
            for k in [k for k, j in jobs.items() if j["done_at"] and now - j["done_at"] > KEEP_SECONDS]:
                _forget(k)
            live = set(jobs)
        for d in DATA.glob("*"):
            if d.is_dir() and d.name not in live and now - d.stat().st_mtime > KEEP_SECONDS:
                shutil.rmtree(d, ignore_errors=True)


DATA.mkdir(parents=True, exist_ok=True)
threading.Thread(target=janitor, daemon=True).start()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8790, threaded=True)
