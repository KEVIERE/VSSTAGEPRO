import sys, time, platform, os
import torch, soundfile as sf
t0 = time.time()
from qwen_tts import Qwen3TTSModel
torch.set_num_threads(os.cpu_count())
model_dir, ref_wav, ref_txt, out = sys.argv[1:5]
dtype = torch.float32 if len(sys.argv) < 6 else getattr(torch, sys.argv[5])
m = Qwen3TTSModel.from_pretrained(model_dir, device_map="cpu", dtype=dtype)
print(f"[{platform.machine()}] modelo carregado em {time.time()-t0:.1f}s, dtype={dtype}", flush=True)
try:
    print("idiomas:", m.model.get_supported_languages(), flush=True)
except Exception as e:
    print("idiomas: ?", e)
t = time.time()
prompt = m.create_voice_clone_prompt(ref_audio=ref_wav, ref_text=open(ref_txt).read().strip())
print(f"voz clonada (prompt) em {time.time()-t:.1f}s", flush=True)
frases = ["Vamos pro refrão!", "Atenção, segura a ponte. Só bateria e voz.", "Um, dois, três, quatro."]
for i, f in enumerate(frases):
    t = time.time()
    wavs, sr = m.generate_voice_clone(text=f, language="Portuguese", voice_clone_prompt=prompt)
    dur = len(wavs[0]) / sr
    el = time.time() - t
    sf.write(f"{out}/fala{i}.wav", wavs[0], sr)
    print(f"'{f}': {dur:.1f}s de fala em {el:.1f}s (x{el/dur:.1f} do tempo real)", flush=True)
