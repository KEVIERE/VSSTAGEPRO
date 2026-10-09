import { useEffect, useState } from 'react';
import { Volume2, X, Check, PlayCircle, RefreshCw, ShieldCheck, Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { getOutputDevices, playTestAllOutputs } from '@/lib/audioDeviceTest';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AudioDeviceDialog({ open, onClose }: Props) {
  const activeIface = useStore((s) => s.audioInterface);
  const setAudioInterface = useStore((s) => s.setAudioInterface);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const isPlaying = useStore((s) => s.transport.isPlaying);
  const [stableMode, setStableMode] = useState(() => audioEngine.isStableMode());
  const [switchingMode, setSwitchingMode] = useState(false);

  const toggleStableMode = async () => {
    setError(null);
    setSwitchingMode(true);
    const ok = await audioEngine.setStableMode(!stableMode);
    setSwitchingMode(false);
    if (ok) setStableMode(audioEngine.isStableMode());
    else setError('Pare o play para trocar o modo de áudio.');
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getOutputDevices();
      setDevices(list);
    } catch (err) {
      setError('Não foi possível acessar os dispositivos de áudio. Verifique a permissão do navegador.');
      console.warn(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleUse = async (dev: MediaDeviceInfo) => {
    try {
      await audioEngine.setOutputDevice(dev.deviceId);
      setAudioInterface(dev.label || dev.deviceId);
    } catch (err) {
      setError('Esta placa não pôde ser definida como saída pelo navegador.');
      console.warn(err);
    }
  };

  const handleTest = async (dev: MediaDeviceInfo) => {
    setTestingId(dev.deviceId);
    setError(null);
    try {
      await playTestAllOutputs(dev.deviceId);
    } catch (err) {
      setError('Falha ao tocar o teste nesta placa.');
      console.warn(err);
    } finally {
      setTestingId(null);
    }
  };

  const isActive = (dev: MediaDeviceInfo) =>
    (dev.label && dev.label === activeIface) || dev.deviceId === activeIface;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60">
      <div className="w-[520px] max-w-[92vw] bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
        <div className="flex items-center justify-between px-4 py-3 border-b border-logic-border-dark">
          <div className="flex items-center gap-2 text-logic-text">
            <Volume2 size={16} className="text-logic-accent" />
            <h2 className="text-sm font-medium">Dispositivo de Áudio</h2>
          </div>
          <button
            className="w-6 h-6 flex items-center justify-center text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light rounded transition-colors"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-logic-border-dark text-xs text-logic-text-dim leading-relaxed">
          Escolha a placa de som que o programa deve usar para tocar.
          O botão <span className="text-logic-text">Testar</span> toca um bipe curto em todas as saídas da placa ao mesmo tempo, para você confirmar onde o som sai.
        </div>

        <div className="max-h-[50vh] overflow-y-auto logic-scroll">
          {loading && (
            <div className="px-4 py-6 text-center text-xs text-logic-text-dim">Procurando placas de som...</div>
          )}
          {!loading && devices.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-logic-text-dim">Nenhuma placa de som encontrada.</div>
          )}
          {!loading && devices.map((dev) => {
            const active = isActive(dev);
            return (
              <div
                key={dev.deviceId}
                className={`flex items-center gap-2 px-4 py-2.5 border-b border-logic-border-dark last:border-b-0
                  ${active ? 'bg-logic-accent-dim/20' : ''}`}
              >
                <div className="w-5 flex-shrink-0 flex items-center justify-center">
                  {active && <Check size={14} className="text-logic-accent" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-logic-text truncate">
                    {dev.label || 'Dispositivo sem nome'}
                  </div>
                  <div className="text-[10px] text-logic-text-muted truncate">
                    {active ? 'Em uso' : 'Clique em Usar para ativar'}
                  </div>
                </div>
                <button
                  className="px-2.5 py-1 text-[11px] rounded border border-logic-border-light bg-logic-bg-elevated text-logic-text hover:bg-logic-bg-panel-light transition-colors disabled:opacity-50"
                  onClick={() => handleTest(dev)}
                  disabled={testingId !== null}
                  title="Toca um bipe curto em todas as saídas da placa ao mesmo tempo"
                >
                  <span className="inline-flex items-center gap-1">
                    <PlayCircle size={12} />
                    {testingId === dev.deviceId ? 'Testando...' : 'Testar'}
                  </span>
                </button>
                <button
                  className={`px-2.5 py-1 text-[11px] rounded border transition-colors
                    ${active
                      ? 'border-logic-accent-dim bg-logic-accent text-white cursor-default'
                      : 'border-logic-border-light bg-logic-bg-elevated text-logic-text hover:bg-logic-bg-panel-light'}`}
                  onClick={() => handleUse(dev)}
                  disabled={active}
                >
                  {active ? 'Em uso' : 'Usar'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-logic-border-dark">
          <ShieldCheck size={16} className={stableMode ? 'text-logic-lcd-green' : 'text-logic-text-muted'} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-logic-text">Áudio estável para show</div>
            <div className="text-[10px] text-logic-text-muted leading-relaxed">
              Mais folga contra estalos, com alguns milissegundos a mais de atraso. Recomendado ligado. Só pode ser trocado com o play parado.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={stableMode}
            onClick={toggleStableMode}
            disabled={switchingMode || isPlaying}
            title={isPlaying ? 'Pare o play para trocar' : stableMode ? 'Desligar' : 'Ligar'}
            className={`relative w-10 h-5 rounded-full border transition-colors duration-200 disabled:opacity-50 ${stableMode ? 'bg-logic-lcd-green/30 border-logic-lcd-green/70' : 'bg-logic-bg-deep border-logic-border-light'}`}
          >
            <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all duration-200 ${stableMode ? 'left-[22px] bg-logic-lcd-green' : 'left-0.5 bg-logic-text-muted'}`}>
              {switchingMode && <Loader2 size={10} className="animate-spin text-black" />}
            </span>
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 bg-logic-lcd-red/15 border-t border-logic-lcd-red/40 text-[11px] text-logic-lcd-red">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-logic-border-dark">
          <button
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded border border-logic-border-light bg-logic-bg-elevated text-logic-text hover:bg-logic-bg-panel-light transition-colors"
            onClick={refresh}
          >
            <RefreshCw size={12} />
            Atualizar lista
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-accent text-white hover:brightness-110 transition-all"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
