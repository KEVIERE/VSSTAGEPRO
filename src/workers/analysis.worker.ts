/// <reference lib="webworker" />

// Análises pesadas de áudio fora da thread da tela: o loudness e o pico real do "volume igual"
// e a IA de tom. Na thread principal elas travavam a tela por música (medido numa música de
// 4 min, no M2: 732 ms o volume igual, 97 ms a IA de tom; no Intel, 2 a 3 vezes isso) e, no
// começo de uma música, atrasavam a entrega aos reprodutores do áudio lido do disco.
// O cálculo está em src/lib/analysisCore.ts; o cliente em src/lib/audioAnalysis.ts.
import { analyze, type AnalysisRequest } from '@/lib/analysisCore';

self.onmessage = (ev: MessageEvent<AnalysisRequest>) => {
  self.postMessage(analyze(ev.data));
};
