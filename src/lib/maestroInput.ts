// Entrada da gravação da voz do Maestro (botão do microfone da faixa Maestro): a placa de áudio e
// o canal dela. Numa placa de duas ou mais entradas, o microfone fica num canal só (entrada 1 ou
// 2); gravar a placa inteira deixaria a voz de um lado. Por isso a gravação pega só o canal
// escolhido e fica mono. A escolha fica guardada no computador. Sem áudio, para dar para testar.

export interface MaestroInput {
  /** Placa de áudio ('' = a padrão do sistema). */
  deviceId: string;
  /** Canal da placa, a partir de 0 (0 = entrada 1). */
  channel: number;
}

export interface InputAudioDevice {
  deviceId: string;
  label: string;
  /** O sistema deu o nome da placa (sem a permissão do microfone, vem sem nome). */
  named: boolean;
}

const KEY = 'vsstage.maestroInput';

export function savedMaestroInput(): MaestroInput {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as MaestroInput | null;
    if (v && typeof v.deviceId === 'string' && Number.isInteger(v.channel) && v.channel >= 0) return v;
  } catch { /* sem nada guardado */ }
  return { deviceId: '', channel: 0 };
}

export function saveMaestroInput(v: MaestroInput): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(v)); } catch { /* só não lembra */ }
}

/**
 * Pedido da entrada para gravar voz: sem cancelamento de eco, redutor de ruído e ganho automático
 * (eles mudam a voz e juntam os canais) e com todos os canais que a placa tiver.
 */
export function inputConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 32 },
    },
  };
}

/** Canal que dá para usar: o escolhido, ou o 1 se a placa não tiver tantos. */
export function usableChannel(channel: number, available: number): number {
  return channel >= 0 && channel < Math.max(1, available) ? channel : 0;
}

/** Nome da placa para a lista: "Default - X" vira "Padrão do sistema: X"; sem nome, "Entrada N". */
export function inputLabel(label: string, index: number): { label: string; named: boolean } {
  const clean = label.trim();
  if (!clean) return { label: `Entrada ${index + 1}`, named: false };
  const def = clean.match(/^(Default|Padrão)\s*-\s*(.+)$/i);
  return { label: def ? `Padrão do sistema: ${def[2]}` : clean, named: true };
}

/** A placa guardada ainda existe? Se não, volta para a primeira da lista. */
export function pickDevice(saved: string, devices: InputAudioDevice[]): string {
  if (devices.some((d) => d.deviceId === saved)) return saved;
  return devices[0]?.deviceId ?? '';
}

/**
 * Medidor da entrada no mesmo padrão dos medidores do mixer (audioEngine.getMeterLevel): sobe na
 * hora até o pico e desce devagar, 24 dB por segundo. Sem isso o medidor pulava a cada quadro
 * para o pico do instante e ficava tremendo.
 */
export function meterBallistics(prev: number, peak: number, elapsedSec: number): number {
  const released = prev * Math.pow(10, (-24 * Math.min(0.1, Math.max(0, elapsedSec))) / 20);
  return Math.max(peak, released);
}

/** Maior valor absoluto do trecho. */
export function peakOf(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
  }
  return peak;
}
