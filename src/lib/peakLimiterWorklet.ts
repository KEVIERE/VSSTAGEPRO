// Carrega o AudioWorklet do anti-clip: junta a classe do limitador (peakLimiter.js, sem o
// export do fim) com o processor num único script e gera um blob URL que o AudioContext aceita.
// Fica num módulo separado do reprodutor de clipes: um erro aqui nunca deixa a música muda.
import limiterSource from './peakLimiter.js?raw';
import processorSource from './peakLimiterProcessor.js?raw';

let cachedUrl: string | null = null;

export function peakLimiterWorkletSource(limiter: string, processor: string): string {
  return limiter.replace(/export\s*\{[^}]*\}\s*;?/g, '') + '\n' + processor;
}

export function getPeakLimiterWorkletUrl(): string {
  if (cachedUrl) return cachedUrl;
  const blob = new Blob([peakLimiterWorkletSource(limiterSource, processorSource)], { type: 'application/javascript' });
  cachedUrl = URL.createObjectURL(blob);
  return cachedUrl;
}
