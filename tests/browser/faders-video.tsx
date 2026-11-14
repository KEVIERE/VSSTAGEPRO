// Mixer de verdade animado para gravar o vídeo do site (public/site/faders.mp4).
// Abrir com o servidor de desenvolvimento: /tests/browser/faders-video.html
// Para gravar o vídeo: scripts/gravar-video-faders.mjs (o passo a passo está lá).
// No console: window.vsVideo.seek(segundos) põe os faders e os medidores naquele instante
// (o tempo só pode andar para a frente) e window.vsVideo.area() devolve o retângulo dos canais.
// Os 12 canais da timeline sobem e descem em onda; Guia fica mudo; master e timecode ficam parados.
// O movimento se repete a cada LOOP segundos, para o vídeo emendar sem salto.
import '../../src/index.css';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import MixerPanel from '../../src/components/MixerPanel';
import { ROUTABLE_TRACKS, useStore } from '../../src/store';
import { publishMeters } from '../../src/lib/meterBus';
import { faderToGain } from '../../src/lib/faderScale';
import { TIMECODE_TRACK_ID } from '../../src/lib/timecode';

const LOOP = 24; // segundos (12 compassos a 120 BPM)
const MUTED = 'track-guia';

// O mostrador de nível segura o pico por 1,5 s usando performance.now(): aqui ele segue o
// relógio do vídeo, e não o tempo que cada quadro leva para ser gravado.
let clockMs = 0;
performance.now = () => clockMs;

useStore.setState((s) => ({
  mixerVisible: true,
  selectedTrackId: null,
  masterVolume: 0.8,
  tracks: s.tracks.map((t) =>
    t.id === TIMECODE_TRACK_ID ? { ...t, volume: 0.8 * Math.pow(10, -0.1 / 20), faderLocked: true }
    : t.id === MUTED ? { ...t, mute: true }
    : t,
  ),
}));

createRoot(document.getElementById('root')!).render(
  <div className="flex flex-col justify-end h-screen bg-logic-bg-deep text-logic-text">
    <MixerPanel />
  </div>,
);

const TAU = Math.PI * 2;
const amp = (db: number) => Math.pow(10, db / 20);
// batida que cai a cada "period" segundos e some em "decay" segundos
const hit = (t: number, period: number, offset: number, decay: number) => {
  const x = (((t - offset) % period) + period) % period;
  return Math.exp(-x / decay);
};
// variação fixa por nota (sempre a mesma no mesmo ponto do loop)
const vary = (seed: number, n: number) => {
  const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// Fader de cada canal: onda que atravessa a mesa da esquerda para a direita
function faderAt(i: number, p: number) {
  return 0.76 + 0.26 * Math.sin(TAU * 4 * (p / LOOP) - i * 0.55) + 0.12 * Math.sin(TAU * (p / LOOP) + i * 0.9)
    + 0.07 * Math.sin(TAU * 7 * (p / LOOP) + i * 2.1);
}

// Sinal de cada instrumento antes do fader (amplitude linear), num show a 120 BPM.
// Folga de 5 dB: com o fader acima de 0 dB os picos ficam no amarelo, sem acender o vermelho.
const HEADROOM = amp(-5);
function sourceAt(id: string, p: number): number {
  return HEADROOM * rawSourceAt(id, p);
}
function rawSourceAt(id: string, p: number): number {
  const beat = 0.5;
  switch (id) {
    case 'track-click': {
      const accent = (p % 2) < beat ? -3 : -7;
      return amp(accent) * hit(p, beat, 0, 0.05);
    }
    case 'track-maestro': {
      // contagem "um, dois, três, quatro" no fim do 1º e do 3º compasso
      const inWindow = (p % 8 >= 1 && p % 8 < 2) || (p % 8 >= 5 && p % 8 < 6);
      return inWindow ? amp(-8 - 3 * vary(2, Math.floor(p * 4))) * hit(p, 0.25, 0, 0.12) : 0;
    }
    case 'track-bateria':
      return Math.max(amp(-3) * hit(p, 1, 0, 0.15), amp(-4) * hit(p, 1, 0.5, 0.12), amp(-15) * hit(p, 0.25, 0, 0.04));
    case 'track-contrabaixo':
      return amp(-6 - 3 * vary(4, Math.floor(p / beat))) * (0.35 + 0.65 * hit(p, beat, 0, 0.4));
    case 'track-percussoes':
      return amp(-9 - 6 * vary(5, Math.floor(p / 0.125))) * hit(p, 0.125, 0, 0.05);
    case 'track-guitarras':
      return Math.max(amp(-11), amp(-5) * hit(p, beat, 0.25, 0.2));
    case 'track-violoes':
      return amp(-8 - 4 * vary(7, Math.floor(p / 0.25))) * (0.3 + 0.7 * hit(p, 0.25, 0, 0.15));
    case 'track-sanfonas':
      return amp(-12 + 4 * Math.sin(TAU * (p / 2)));
    case 'track-teclados':
      return Math.max(amp(-18), amp(-5) * hit(p, 2, 0, 1.2));
    case 'track-solos':
      return amp(-6 - 8 * vary(10, Math.floor(p / 0.25))) * (0.4 + 0.6 * hit(p, 0.25, 0, 0.2));
    case 'track-outros':
      return amp(-16 + 2 * Math.sin(TAU * (p / 4) + 1));
    default:
      return 0;
  }
}

// Medidor com a mesma queda do motor de áudio: o pico sobe na hora e desce 24 dB por segundo
const shown = new Map<string, number>();
let lastT = 0;
function ballistic(id: string, raw: number, dt: number) {
  const released = (shown.get(id) ?? 0) * Math.pow(10, (-24 * dt) / 20);
  const v = Math.max(raw, released);
  shown.set(id, v);
  return v;
}

function seek(t: number) {
  const dt = Math.max(0, t - lastT);
  lastT = t;
  clockMs = t * 1000;
  const p = ((t % LOOP) + LOOP) % LOOP;

  const volumes = new Map<string, number>();
  ROUTABLE_TRACKS.forEach((id, i) => volumes.set(id, Math.round(faderAt(i, p) * 1000) / 1000));

  const levels = new Map<string, number>();
  let power = 0;
  for (const id of ROUTABLE_TRACKS) {
    const post = id === MUTED ? 0 : Math.min(0.98, sourceAt(id, p) * faderToGain(volumes.get(id)!));
    power += post * post;
    levels.set(id, ballistic(id, post, dt));
  }
  levels.set('master', ballistic('master', Math.min(0.95, Math.sqrt(power) * 0.6), dt));
  levels.set(TIMECODE_TRACK_ID, 0);
  // O mixer novo tem medidor estéreo (colunas "ID:L" e "ID:R"): o lado direito fica um pouco
  // diferente do esquerdo, como num sinal de verdade.
  for (const [id, v] of [...levels]) {
    const r = 0.86 + 0.14 * Math.sin(TAU * (p / 3) + id.length);
    levels.set(`${id}:L`, v);
    levels.set(`${id}:R`, v * r);
  }

  flushSync(() => {
    useStore.setState((s) => ({
      tracks: s.tracks.map((tr) => (volumes.has(tr.id) ? { ...tr, volume: volumes.get(tr.id)! } : tr)),
    }));
    publishMeters(levels);
  });
  // espera a tela pintar o quadro novo
  return new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
}

// Retângulo dos canais (do seletor de saída até as teclas M/S), sem o trilho "Mixer".
// 'timecode' ou 'master' devolve só aquele canal, com a mesma altura (fotos do site).
function area(which?: 'timecode' | 'master') {
  const strips = [...document.querySelectorAll('.console-strip')] as HTMLElement[];
  const row = strips[0].parentElement!;
  const box = (which === 'timecode' ? strips[0] : which === 'master' ? strips[strips.length - 1] : row).getBoundingClientRect();
  let bottom = 0;
  row.querySelectorAll('.console-strip > :last-child').forEach((el) => {
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  });
  return { x: box.left, y: box.top, width: box.width, height: Math.ceil(bottom + 6 - box.top) };
}

(window as unknown as { vsVideo: unknown }).vsVideo = { seek, area, LOOP };
