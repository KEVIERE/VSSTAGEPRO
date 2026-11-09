import type { ClipAudio } from '@/lib/audioLibrary';

/**
 * Altura da forma de onda (0 a 1) em cada pixel de um bloco do desenho, do pixel `offset` até
 * `offset + width`. `total` é a largura em pixels do arquivo inteiro, que dura `duration` segundos.
 *
 * Com zoom aproximado e o áudio na memória, cada pixel mostra o pico real das amostras daquele
 * trecho, como numa DAW: um click cai sempre no pixel certo e tem sempre o mesmo desenho.
 * Sem o áudio, usa o resumo `peaks` (cada ponto resume um trecho igual do arquivo).
 */
export function waveColumns(
  peaks: number[] | undefined,
  audio: ClipAudio | null | undefined,
  duration: number,
  total: number,
  offset: number,
  width: number,
): Float32Array {
  const out = new Float32Array(width + 1);
  const n = peaks?.length ?? 0;
  const full = Math.max(1, total);

  // resumo mais grosso que os pixels (zoom aproximado): lê as amostras
  if (audio && audio.length > 0 && audio.channels.length > 0 && duration > 0 && full >= n) {
    const chs = audio.channels.slice(0, 2);
    const perPx = (duration / full) * audio.sampleRate;
    for (let x = 0; x <= width; x++) {
      if (offset + x < 0) continue;
      const s0 = Math.floor((offset + x) * perPx);
      if (s0 >= audio.length) break;
      const s1 = Math.min(audio.length, Math.max(s0 + 1, Math.floor((offset + x + 1) * perPx)));
      let m = 0;
      for (const ch of chs) {
        for (let s = s0; s < s1; s++) {
          const v = ch[s] < 0 ? -ch[s] : ch[s];
          if (v > m) m = v;
        }
      }
      out[x] = m / 32768;
    }
    return out;
  }

  if (!peaks || n === 0) return out;
  if (n <= full) {
    // cada ponto do resumo fica no centro do trecho que ele resume
    for (let x = 0; x <= width; x++) {
      if (offset + x < 0) continue;
      const pos = Math.max(0, Math.min(n - 1, ((offset + x + 0.5) / full) * n - 0.5));
      const i = Math.floor(pos);
      const a = peaks[i] ?? 0;
      const b = peaks[Math.min(i + 1, n - 1)] ?? 0;
      const t = pos - i;
      out[x] = a + (b - a) * t * t * (3 - 2 * t);
    }
    return out;
  }
  // zoom afastado: o maior pico entre os pontos que caem no pixel
  for (let x = 0; x <= width; x++) {
    if (offset + x < 0) continue;
    const s = Math.floor(((offset + x) / full) * n);
    const e = Math.max(s + 1, Math.floor(((offset + x + 1) / full) * n));
    let m = 0;
    for (let i = s; i < e && i < n; i++) if (peaks[i] > m) m = peaks[i];
    out[x] = m;
  }
  return out;
}
