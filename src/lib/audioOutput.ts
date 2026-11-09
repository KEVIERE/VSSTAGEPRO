// Mantém a placa de som escolhida em uso: ela é guardada no projeto e neste computador, e
// volta a ser a saída sozinha ao abrir o programa, ao abrir um projeto e ao ser reconectada.
// Sem isso o roteamento salvo (canais nas saídas 3, 4, 5...) caía no Master sem aviso.
//
// Regra do show:
// - placa salva no projeto conectada → volta para ela e o roteamento salvo vale de novo;
// - placa desconectada → tudo volta para o LR (saídas 1-2) e a tela mostra "Saída padrão";
// - placa conectada de novo → volta sozinha para ela com o roteamento salvo.
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';

const LS_KEY = 'vs_audio_interface';
let applied: string | null = null;
let busy = false;
// Placa que estava fora do ar: só ela interessa quando voltar a aparecer.
let missing: string | null = null;

export function rememberAudioInterface(label: string) {
  try { localStorage.setItem(LS_KEY, label); } catch { /* sem armazenamento: vale só o projeto */ }
  missing = null;
}

/** Nome da placa que o projeto (ou este computador) quer usar. */
export function wantedAudioInterface(): string | null {
  const fromProject = useStore.getState().audioInterface;
  if (fromProject && fromProject !== 'default') return fromProject;
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}

function wanted(): string | null {
  return wantedAudioInterface();
}

// Placa externa de verdade (interface de áudio, mesa digital): tem mais de 2 saídas e não é a
// saída do próprio Mac. É ela que deve entrar sozinha quando o programa abre.
function isExternalInterface(dev: MediaDeviceInfo): boolean {
  if (dev.deviceId === 'default' || dev.deviceId === 'communications') return false;
  if (/^(Default|Comunicações|Communications)\b/i.test(dev.label || '')) return false;
  return true;
}

/** Sem placa salva (ou com a salva desconectada): põe a interface externa conectada como saída. */
async function adoptConnectedInterface(): Promise<string | null> {
  const devices = await audioEngine.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const external = devices.filter((d) => isExternalInterface(d) && d.label);
  if (external.length === 0) return null;
  // Grupos do mesmo dispositivo podem expor vários endpoints. Escolhe o que tem mais canais.
  const counts = await Promise.all(external.map(async (dev) => {
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const sinkable = ctx as unknown as { setSinkId?: (id: string) => Promise<void> };
      if (!sinkable.setSinkId) { await ctx.close(); return 2; }
      await sinkable.setSinkId(dev.deviceId);
      const count = ctx.destination.maxChannelCount || 2;
      await ctx.close();
      return count;
    } catch { return 2; }
  }));
  const dev = external[counts.indexOf(Math.max(...counts))];
  await audioEngine.setOutputDevice(dev.deviceId);
  applied = dev.deviceId;
  missing = null;
  useStore.getState().setAudioInterface(dev.label || dev.deviceId);
  rememberAudioInterface(dev.label || dev.deviceId);
  await audioEngine.refreshOutputs();
  return dev.label || dev.deviceId;
}

/** Devolve a saída do programa para o LR (saídas 1-2 da placa padrão) sem perder o roteamento salvo. */
async function fallBackToLR(name: string, reason: 'inicio' | 'projeto' | 'conexao') {
  applied = null;
  missing = name;
  // Mantém o nome desejado no projeto para ele voltar quando a placa reaparecer;
  // apenas marca que, neste instante, o áudio está no LR padrão.
  useStore.getState().setAudioInterfaceConnected(false);
  try {
    await audioEngine.setOutputDevice('default');
    await audioEngine.refreshOutputs();
  } catch (err) {
    console.warn('[audioOutput] não consegui voltar para a saída padrão', err);
  }
  if (reason !== 'inicio') {
    useStore.getState().setPlaybackError(`A placa de som "${name}" não está conectada. O som está saindo pelo LR (saídas 1-2) até ela voltar; aí o roteamento salvo entra sozinho.`);
  }
}

/** Procura a placa pelo nome (ou id) e a coloca como saída; avisa se ela não estiver conectada. */
export async function restoreAudioInterface(reason: 'inicio' | 'projeto' | 'conexao'): Promise<void> {
  const name = wanted();
  if (busy) return;
  busy = true;
  try {
    // Nenhuma placa salva: a interface externa que estiver conectada vira a saída padrão.
    if (!name || name === 'default') {
      if (!applied) await adoptConnectedInterface();
      return;
    }
    const devices = await audioEngine.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const dev = devices.find((d) => d.label === name) ?? devices.find((d) => d.deviceId === name);
    if (!dev) {
      // Placa salva desconectada: a interface externa que estiver ligada assume; sem nenhuma, LR.
      // Guarda o nome salvo no computador para voltar a ela quando ela reaparecer.
      const adopted = await adoptConnectedInterface();
      if (adopted) {
        try { localStorage.setItem(LS_KEY, name); } catch { /* só nesta sessão */ }
        return;
      }
      if (missing !== name) await fallBackToLR(name, reason);
      return;
    }
    missing = null;
    if (applied === dev.deviceId) {
      useStore.getState().setAudioInterfaceConnected(true);
      return;
    }
    await audioEngine.setOutputDevice(dev.deviceId);
    applied = dev.deviceId;
    useStore.getState().setAudioInterfaceConnected(true);
    if (useStore.getState().audioInterface !== name) useStore.getState().setAudioInterface(name);
    // A placa voltou: relê as saídas dela e reaplica o roteamento salvo nas faixas.
    await audioEngine.refreshOutputs();
  } catch (err) {
    console.warn('[audioOutput] não consegui voltar para a placa escolhida', err);
  } finally {
    busy = false;
  }
}

export function markAudioInterfaceApplied(deviceId: string) {
  applied = deviceId;
  missing = null;
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
  // A placa já plugada nem sempre aparece na primeira leitura (o macOS atualiza a lista um instante
  // depois da janela abrir): confere de novo ao voltar o foco e alguns segundos após o início.
  const retry = () => { applied = null; void syncOutputs('conexao'); };
  window.addEventListener('focus', retry);
  const retryTimers = [1500, 4000].map((ms) => window.setTimeout(retry, ms));
  // Conectou/desconectou placa: refaz a saída e o roteamento salvo.
  const onChange = () => { applied = null; void syncOutputs('conexao'); };
  navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
  const unsub = useStore.subscribe((s, prev) => {
    // Projeto aberto: reaplica a placa dele mesmo que o nome seja o mesmo de antes.
    if (s.saveTarget !== prev.saveTarget || s.projectName !== prev.projectName) {
      applied = null;
      void syncOutputs('conexao');
      return;
    }
    // Escolheu outra placa na janela de áudio (ou voltou para "Saída padrão").
    if (s.audioInterface !== prev.audioInterface) {
      if (s.audioInterface === 'default') { applied = null; void syncOutputs('conexao'); return; }
      applied = null;
      void restoreAudioInterface('projeto');
    }
  });
  return () => {
    window.removeEventListener('focus', retry);
    retryTimers.forEach((id) => window.clearTimeout(id));
    navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    unsub();
  };
}
