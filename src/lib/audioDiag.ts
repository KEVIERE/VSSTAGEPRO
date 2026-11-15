// Diário do motor de áudio para quando o som engasgar no show: guarda os últimos eventos
// (faixa sem dado no reprodutor, faixa que voltou, travadas longas da tela) só na memória.
// Nada aparece na tela; o dono copia o texto pelo console (window.__vsAudioDiag.copiar()) e
// cola no chat. Sem dependências: os testes rodam direto no Node.

// 'largada': quanto o Play esperou pelo trecho extra (duracaoMs; 0 = pulou) e quanto levou a
// primeira leitura (leituraMs); faixa = quantas faixas o extra cobriu ("3/8").
export type AudioDiagTipo = 'underrun' | 'recovered' | 'longtask' | 'largada';

export interface AudioDiagEvento {
  /** performance.now() do momento do evento. */
  t: number;
  tipo: AudioDiagTipo;
  faixa?: string;
  folgaQuadros?: number;
  duracaoMs?: number;
  leituraMs?: number;
}

export const AUDIO_DIAG_MAX = 200;

function agora(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Buffer circular: o mais antigo sai quando passa do limite (memória fixa no show inteiro). */
export class AudioDiagLog {
  private itens: AudioDiagEvento[] = [];
  private inicio = 0;
  private readonly max: number;

  constructor(max = AUDIO_DIAG_MAX) {
    this.max = Math.max(1, max | 0);
  }

  registrar(ev: Omit<AudioDiagEvento, 't'> & { t?: number }): void {
    const item: AudioDiagEvento = { t: ev.t ?? agora(), tipo: ev.tipo };
    if (ev.faixa !== undefined) item.faixa = ev.faixa;
    if (typeof ev.folgaQuadros === 'number') item.folgaQuadros = ev.folgaQuadros;
    if (typeof ev.duracaoMs === 'number') item.duracaoMs = ev.duracaoMs;
    if (typeof ev.leituraMs === 'number') item.leituraMs = ev.leituraMs;
    if (this.itens.length < this.max) {
      this.itens.push(item);
    } else {
      this.itens[this.inicio] = item;
      this.inicio = (this.inicio + 1) % this.max;
    }
  }

  /** Do mais antigo para o mais novo (cópia: quem lê não mexe no diário). */
  ler(): AudioDiagEvento[] {
    return [...this.itens.slice(this.inicio), ...this.itens.slice(0, this.inicio)].map((e) => ({ ...e }));
  }

  limpar(): void {
    this.itens = [];
    this.inicio = 0;
  }

  /** Uma linha por evento, tempo relativo ao primeiro, para colar no chat. */
  comoTexto(): string {
    const evs = this.ler();
    if (evs.length === 0) return 'diag audio: nenhum evento';
    const t0 = evs[0].t;
    const linhas = evs.map((e) => {
      const partes = [`+${((e.t - t0) / 1000).toFixed(3)}s`, e.tipo];
      if (e.faixa !== undefined) partes.push(`faixa=${e.faixa}`);
      if (e.folgaQuadros !== undefined) partes.push(`folga=${e.folgaQuadros}`);
      if (e.duracaoMs !== undefined) partes.push(`dur=${Math.round(e.duracaoMs)}ms`);
      if (e.leituraMs !== undefined) partes.push(`leitura=${Math.round(e.leituraMs)}ms`);
      return partes.join(' ');
    });
    return [`diag audio: ${evs.length} eventos`, ...linhas].join('\n');
  }
}

export const audioDiag = new AudioDiagLog();

export function registrarDiag(ev: Omit<AudioDiagEvento, 't'> & { t?: number }): void {
  audioDiag.registrar(ev);
}

export function lerDiag(): AudioDiagEvento[] {
  return audioDiag.ler();
}

export function limparDiag(): void {
  audioDiag.limpar();
}

export function diagComoTexto(): string {
  return audioDiag.comoTexto();
}

/** Copia o texto para a área de transferência (quando dá) e devolve o mesmo texto. */
export function copiarDiag(): string {
  const texto = diagComoTexto();
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (s: string) => Promise<void> } } }).navigator;
    void nav?.clipboard?.writeText?.(texto)?.catch(() => { /* sem foco/permissão: o texto volta no console */ });
  } catch { /* sem área de transferência */ }
  return texto;
}

let iniciado = false;

/**
 * Liga uma vez: observador de travadas longas da tela (> 50 ms, onde o Chromium avisa) e o
 * acesso pelo console. Fora do navegador (testes) não faz nada.
 */
export function iniciarAudioDiag(): void {
  if (iniciado) return;
  iniciado = true;
  const g = globalThis as { PerformanceObserver?: typeof PerformanceObserver; window?: unknown };
  try {
    if (g.PerformanceObserver) {
      const obs = new g.PerformanceObserver((lista) => {
        for (const e of lista.getEntries()) registrarDiag({ t: e.startTime, tipo: 'longtask', duracaoMs: e.duration });
      });
      obs.observe({ type: 'longtask', buffered: false });
    }
  } catch { /* tipo não suportado: segue sem as travadas da tela */ }
  try {
    if (g.window) {
      (g.window as Record<string, unknown>).__vsAudioDiag = {
        ler: lerDiag,
        limpar: limparDiag,
        texto: diagComoTexto,
        copiar: copiarDiag,
      };
    }
  } catch { /* ignore */ }
}
