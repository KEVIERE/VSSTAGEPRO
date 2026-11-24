# Programa de voz do Maestro IA no processador: Mac Intel, Catalina (10.15) e Windows.
#
# É o mesmo modelo do Apple Silicon (Qwen3-TTS 0.6B Base, Apache-2.0), em PyTorch, rodando no
# motor de IA embutido (o mesmo Python da separação de faixas). Conversa com o app pelo mesmo
# protocolo do programa em Swift (vs-maestro-voz): uma linha JSON por pedido na entrada e uma
# resposta com o prefixo "@@VS " na saída. Assim o maestroQwen.js usa os dois do mesmo jeito.
#
#   entrada: {"id":"1","cmd":"speak","text":"...","ref":"voz.wav","refText":"...","language":"portuguese",
#             "seed":123,"maxTokens":80,"temperature":0.9,"topK":50,"out":"fala.f32"}
#   saída:   @@VS {"id":"1","ok":true,"sampleRate":24000,"elapsed":12.3}
#
# A fala sai em float32 cru (little-endian) no arquivo "out", igual ao programa em Swift.
# No processador é bem mais lento que no chip Apple (dezenas de segundos por fala curta): o app
# gera em segundo plano e guarda cada fala pronta.
import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

# o que a biblioteca escreve vai para a saída de erro; a saída padrão fica só com as respostas
_out = sys.stdout
sys.stdout = sys.stderr


def reply(msg):
    _out.write("@@VS " + json.dumps(msg, ensure_ascii=False) + "\n")
    _out.flush()


def main():
    args = sys.argv[1:]
    if "--model" not in args:
        reply({"id": "ready", "ok": False, "error": "Falta a pasta do modelo."})
        return
    model_dir = args[args.index("--model") + 1]
    try:
        import numpy as np
        import torch
        from qwen_tts import Qwen3TTSModel

        # um núcleo fica livre para a tela e o som do VS Stage (antes usava todos os lógicos)
        torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
        model = Qwen3TTSModel.from_pretrained(model_dir, device_map="cpu", dtype=torch.float32)
    except Exception as e:  # noqa: BLE001
        reply({"id": "ready", "ok": False, "error": f"A voz de IA não abriu ({e})."})
        return

    sample_rate = 24000
    reply({"id": "ready", "ok": True, "sampleRate": sample_rate})

    # a voz (trecho de referência + texto) é preparada uma vez e guardada: preparar leva de 15 a 30 s
    prompts = {}

    def prompt_for(ref, ref_text):
        st = os.stat(ref)
        key = (ref, st.st_size, st.st_mtime, ref_text)
        if key not in prompts:
            prompts.clear()  # uma voz por vez na memória
            prompts[key] = model.create_voice_clone_prompt(ref_audio=ref, ref_text=ref_text)
        return prompts[key]

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        rid = str(req.get("id", ""))
        if req.get("cmd") != "speak":
            reply({"id": rid, "ok": False, "error": "Pedido desconhecido."})
            continue
        try:
            t0 = time.time()
            seed = int(req.get("seed") or 0) % (2 ** 31)
            torch.manual_seed(seed)
            np.random.seed(seed)
            wavs, sr = model.generate_voice_clone(
                text=req["text"],
                language=req.get("language") or "portuguese",
                voice_clone_prompt=prompt_for(req["ref"], req.get("refText") or ""),
                do_sample=True,
                temperature=float(req.get("temperature") or 0.9),
                top_k=int(req.get("topK") or 50),
                max_new_tokens=int(req.get("maxTokens") or 1000),
            )
            samples = np.asarray(wavs[0], dtype="<f4").reshape(-1)
            with open(req["out"], "wb") as f:
                f.write(samples.tobytes())
            reply({"id": rid, "ok": True, "sampleRate": int(sr), "elapsed": round(time.time() - t0, 2)})
        except Exception as e:  # noqa: BLE001
            reply({"id": rid, "ok": False, "error": f"A voz de IA não gerou a fala ({e})."})


if __name__ == "__main__":
    main()
