"""Leitor de letra do VS Stage: ouve a música no próprio Mac e devolve a letra com o tempo de
cada palavra. Roda no Python embutido no instalador (desktop/ai-engine), sem internet e sem custo.

Etapas:
  1. Separa a voz da banda com o Demucs (htdemucs_6s, os mesmos pesos da separação de faixas).
  2. Acha os trechos em que a voz canta (energia da voz isolada). Fora deles o Whisper não ouve
     nada: é o que evita ele inventar frase em solo e introdução.
  3. Lê a letra com o Whisper large-v3-turbo (faster-whisper / CTranslate2, int8 na CPU), em
     português, com o tempo de cada palavra.

Uso: python3 -I lyricsTranscriber.py --in musica.wav --model <pasta do modelo> --out letra.json
A última linha impressa é um JSON: {"ok": true, ...} ou {"ok": false, "error": "..."}.
"""
import argparse
import json
import os
import sys
import time
import types


def say(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def progress(step, pct=None):
    """Andamento para a tela: etapa e quanto (0 a 1) da música já foi ouvido."""
    msg = {"progress": step}
    if pct is not None:
        msg["pct"] = round(max(0.0, min(1.0, pct)), 3)
    say(msg)


def load_audio(path):
    import numpy as np
    import soundfile as sf
    import torch

    data, rate = sf.read(path, dtype="float32", always_2d=True)  # (frames, canais)
    wav = torch.from_numpy(np.ascontiguousarray(data.T))
    return wav, rate


def separate_vocals(wav, rate, threads):
    """Voz isolada, em mono, na taxa do modelo. Devolve (tensor 1D, taxa)."""
    import torch
    from demucs.apply import apply_model
    from demucs.audio import convert_audio
    from demucs.pretrained import get_model

    torch.set_num_threads(threads)
    model = get_model("htdemucs_6s")
    model.eval()
    mix = convert_audio(wav, rate, model.samplerate, model.audio_channels)
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(model, ((mix - mean) / std)[None], shifts=0, split=True, overlap=0.25, device="cpu")[0]
    vocals = out[model.sources.index("vocals")] * std + mean
    return vocals.mean(0), model.samplerate


def to_16k(mono, rate):
    import torchaudio.functional as F

    if rate != 16000:
        mono = F.resample(mono[None], rate, 16000)[0]
    return mono.contiguous().numpy().astype("float32")


def voiced_regions(audio, rate=16000, frame_s=0.03, floor_db=-50.0, below_peak_db=32.0, join_gap=0.8, pad=0.25, min_len=0.3):
    """Trechos (início, fim) em segundos em que a voz isolada tem som de verdade."""
    import numpy as np

    n = int(rate * frame_s)
    frames = len(audio) // n
    if frames == 0:
        return []
    rms = np.sqrt(np.mean(audio[: frames * n].reshape(frames, n) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    peak = float(np.percentile(db, 99))
    gate = max(floor_db, peak - below_peak_db)
    on = db > gate

    regions = []
    start = None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            regions.append([start * frame_s, i * frame_s])
            start = None
    if start is not None:
        regions.append([start * frame_s, frames * frame_s])

    merged = []
    for s, e in regions:
        if merged and s - merged[-1][1] <= join_gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    total = len(audio) / rate
    out = []
    for s, e in merged:
        if e - s < min_len:
            continue
        s, e = max(0.0, s - pad), min(total, e + pad)
        if out and s <= out[-1][1]:
            out[-1][1] = e
        else:
            out.append([s, e])
    return out


def transcribe(audio, model_dir, regions, threads):
    # O faster-whisper importa o PyAV só para abrir arquivo de áudio. Aqui o áudio já chega
    # decodificado, então o PyAV (60 MB, sem pacote para Mac antigo) fica de fora do instalador.
    try:
        import av  # noqa: F401
    except Exception:
        sys.modules["av"] = types.ModuleType("av")
    from faster_whisper import WhisperModel

    model = WhisperModel(model_dir, device="cpu", compute_type="int8", cpu_threads=threads)
    progress("transcribe", 0.05)
    # até onde tem voz: é o fim da barra de progresso
    total = regions[-1][1] if regions else 1.0
    clips = [round(x, 2) for r in regions for x in r]
    segments, info = model.transcribe(
        audio,
        language="pt",
        task="transcribe",
        beam_size=5,
        word_timestamps=True,
        # Música repete refrão: sem isso o Whisper tende a entrar em laço repetindo a frase anterior.
        condition_on_previous_text=False,
        vad_filter=False,
        clip_timestamps=clips if clips else "0",
        hallucination_silence_threshold=2.0,
    )
    out = []
    for seg in segments:
        progress("transcribe", 0.05 + 0.95 * (seg.end / total if total else 1))
        words = [
            {"word": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2), "probability": round(w.probability, 3)}
            for w in (seg.words or [])
            if w.word.strip()
        ]
        out.append({
            "start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip(), "words": words,
            # confiança do Whisper: a tela descarta frase que ele inventou em trecho sem voz
            "avg_logprob": round(seg.avg_logprob, 3), "no_speech_prob": round(seg.no_speech_prob, 3),
        })
    return out, info.language


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--no-separate", action="store_true")
    args = ap.parse_args()

    # Roda com prioridade baixa: o programa (e o show) sempre vêm primeiro.
    try:
        os.nice(10)
    except Exception:
        pass
    threads = args.threads or max(1, (os.cpu_count() or 2) // 2)
    started = time.time()
    try:
        progress("load")
        wav, rate = load_audio(args.inp)
        if args.no_separate:
            mono, mrate = wav.mean(0), rate
        else:
            progress("separate")
            mono, mrate = separate_vocals(wav, rate, threads)
        audio = to_16k(mono, mrate)
        regions = voiced_regions(audio)
        segments, lang = [], "pt"
        if regions:
            progress("transcribe", 0.0)
            segments, lang = transcribe(audio, args.model, regions, threads)
        result = {"segments": segments, "language": lang, "regions": regions}
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
        say({"ok": True, "seconds": round(time.time() - started, 1), "segments": len(segments)})
    except Exception as e:  # a tela mostra o motivo
        say({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
