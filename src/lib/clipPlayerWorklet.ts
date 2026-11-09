// Carrega o AudioWorklet que roda o SoundTouch em tempo real.
// Combinamos o código da biblioteca com o do processor num único script
// clássico (sem imports), gerando um blob URL que o AudioContext aceita.
import soundtouchSource from './soundtouch.vendor.js?raw';
import processorSource from './clipPlayerProcessor.js?raw';

let cachedUrl: string | null = null;

export function getClipPlayerWorkletUrl(): string {
  if (cachedUrl) return cachedUrl;
  const stripped = soundtouchSource.replace(/export\s*\{[^}]*\}\s*;?/g, '');
  const combined = stripped + '\n' + processorSource;
  const blob = new Blob([combined], { type: 'application/javascript' });
  cachedUrl = URL.createObjectURL(blob);
  return cachedUrl;
}
