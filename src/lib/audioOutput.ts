// Mantém a placa de som escolhida em uso: ela é guardada no projeto e neste computador, e
// volta a ser a saída sozinha ao abrir o programa, ao abrir um projeto e ao ser reconectada.
// Sem isso o roteamento salvo (canais nas saídas 3, 4, 5...) caía no Master sem aviso.
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';

const LS_KEY = 'vs_audio_interface';
let applied: string | null = null;
let busy = false;

export function rememberAudioInterface(label: string) {
  try { localStorage.setItem(LS_KEY, label); } catch { /* sem armazenamento: vale só o projeto */ }
}

function wanted(): string | null {
  const fromProject = useStore.getState().audioInterface;
  if (fromProject && fromProject !== 'default') return fromProject;
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}

/** Procura a placa pelo nome (ou id) e a coloca como saída; avisa se ela não estiver conectada. */
export async function restoreAudioInterface(reason: 'inicio' | 'projeto' | 'conexao'): Promise<void> {
  const name = wanted();
  if (!name || name === 'default' || busy) return;
  busy = true;
  try {
    const devices = await audioEngine.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const dev = devices.find((d) => d.label === name) ?? devices.find((d) => d.deviceId === name);
    if (!dev) {
      applied = null;
      if (reason !== 'inicio') {
        useStore.getState().setPlaybackError(`A placa de som "${name}" não está conectada. Os canais roteados para saídas que ela tinha estão tocando pelo Master (saídas 1-2) até ela voltar.`);
      }
      return;
    }
    if (applied === dev.deviceId) return;
    await audioEngine.setOutputDevice(dev.deviceId);
    applied = dev.deviceId;
    if (useStore.getState().audioInterface !== name) useStore.getState().setAudioInterface(name);
  } catch (err) {
    console.warn('[audioOutput] não consegui voltar para a placa escolhida', err);
  } finally {
    busy = false;
  }
}

export function markAudioInterfaceApplied(deviceId: string) {
  applied = deviceId;
}

// Depois de voltar para a placa escolhida, relê quantas saídas a placa em uso tem.
// Sem placa escolhida, segue a padrão do Mac (ex.: uma interface que acabou de ser conectada).
async function syncOutputs(reason: 'inicio' | 'conexao') {
  await restoreAudioInterface(reason);
  try {
    await audioEngine.refreshOutputs();
  } catch (err) {
    console.warn('[audioOutput] não consegui ler as saídas da placa', err);
  }
}

export function startAudioOutputWatcher(): () => void {
  void syncOutputs('inicio');
  const onChange = () => { applied = null; void syncOutputs('conexao'); };
  navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
  const unsub = useStore.subscribe((s, prev) => {
    if (s.audioInterface !== prev.audioInterface && s.audioInterface !== 'default') void restoreAudioInterface('projeto');
  });
  return () => {
    navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    unsub();
  };
}
