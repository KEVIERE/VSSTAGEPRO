import { clipAudioToBuffer, getClipAudio, getClipSource, putClipAudio, registerClipSource, toClipAudioAsync } from '@/lib/audioLibrary';
import { encodePcm24, wavHeaderPcm24 } from '@/lib/wavEncoder';
import { decodeBlob } from '@/lib/audioDecoder';
import { MASTER_PROFILES, masterChannels, type MasterProfile, type MasterReport } from '@/lib/mastering';
import { masterRoleFor } from '@/lib/masterRole';
import { masterInWorker } from '@/lib/masteringClient';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';

/** Masteriza um AudioBuffer com a cadeia de mastering.ts (voz ou mixagem). */
export async function masterProfessionalAudioBuffer(inputBuffer: AudioBuffer, isVocalTrack = false): Promise<AudioBuffer> {
  const channels = Array.from({ length: inputBuffer.numberOfChannels }, (_, c) => inputBuffer.getChannelData(c));
  const { channels: out } = masterChannels(channels, inputBuffer.sampleRate, { role: isVocalTrack ? 'voice' : 'mix' });
  const buf = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: inputBuffer.sampleRate });
  out.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}

/** Os canais vistos como AudioBuffer (só leitura), sem copiar o áudio de novo. */
function asAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const length = channels[0].length;
  return {
    numberOfChannels: channels.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (c: number) => channels[c],
  } as unknown as AudioBuffer;
}

/** Tipo de clipe para a masterização (mixagem inteira, voz ou stem de instrumento). */
export function masterRoleForClip(clipId: string) {
  const { clips, tracks } = useStore.getState();
  const clip = clips.find((c) => c.id === clipId);
  return clip ? masterRoleFor(clip, tracks, clips) : null;
}

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '-∞');

/** Frase curta do que foi feito, para o aviso na tela. */
export function masterSummary(r: MasterReport): string {
  const profile = MASTER_PROFILES[r.profile];
  const kept = r.role !== 'mix' && Math.abs(r.targetLufs - r.lufsBefore) < 0.05;
  const what = r.role === 'mix' ? 'Masterizado' : r.role === 'voice' ? 'Voz masterizada' : 'Stem masterizado';
  const head = kept
    ? `${what}: volume mantido em ${f1(r.lufsAfter)} LUFS (equilíbrio do VS), pico ${f1(r.peakAfterDbtp)} dBTP`
    : `${what} (${profile.label}): ${f1(r.lufsBefore)} → ${f1(r.lufsAfter)} LUFS, pico ${f1(r.peakAfterDbtp)} dBTP`;
  return [head, ...r.notes].join('. ') + '.';
}

/**
 * Masteriza um clipe da timeline (mixagem completa, voz, bateria, guitarras, baixo...).
 * A IA reconhece o tipo de clipe: a mixagem inteira vai ao loudness do perfil; voz e stems
 * mantêm o próprio volume. Lê o arquivo original em resolução total (float), processa fora da
 * thread da tela e grava em WAV de 24 bits como nova fonte do clipe. Funciona também quando o
 * áudio não está aberto na memória (a música toca lida do disco).
 */
/**
 * `choice`: perfil de volume da master; 'manter' (padrão para voz e stem) polir sem mudar o
 * volume. Sem escolha: a mixagem inteira vai em Equilibrado e voz/stem mantêm o volume.
 */
export async function masterAudioClip(clipId: string, choice?: MasterProfile | 'manter'): Promise<boolean> {
  const store = useStore.getState();
  const clip = store.clips.find((c) => c.id === clipId);
  if (!clip) return false;

  const done = (status: 'done' | 'error', message: string) => {
    store.setImportProgress({ clipId: 'mastering', status, message });
    setTimeout(() => { if (useStore.getState().importProgress?.clipId === 'mastering') useStore.getState().setImportProgress(null); }, status === 'done' ? 9000 : 5000);
  };

  store.setImportProgress({ clipId: 'mastering', status: 'working' as never, message: `Masterizando "${clip.name}": a IA está ouvindo a música...` });

  try {
    const source = getClipSource(clipId);
    let input: AudioBuffer | null = null;
    if (source) {
      input = await decodeBlob(source);
    } else {
      const raw = getClipAudio(clipId);
      if (raw) input = clipAudioToBuffer(raw);
    }
    if (!input) throw new Error('o áudio deste clipe não foi encontrado');

    // cópia própria dos canais (vai transferida ao worker); o AudioBuffer decodificado é solto
    const sampleRate = input.sampleRate;
    const channels = Array.from({ length: Math.min(2, input.numberOfChannels) }, (_, c) => {
      const out = new Float32Array(input!.length);
      input!.copyFromChannel(out, c);
      return out;
    });
    input = null;

    const who = masterRoleFor(clip, store.tracks, store.clips);
    const profile: MasterProfile = choice && choice !== 'manter' ? choice : 'equilibrado';
    // voz/stem com perfil escolhido: masteriza até o volume do perfil
    const forceProfile = who.role !== 'mix' && !!choice && choice !== 'manter';
    const { channels: out, report } = await masterInWorker(channels, sampleRate, { role: who.role, instrument: who.instrument, profile, forceProfile });
    const mastered = asAudioBuffer(out, sampleRate);

    const clipAudio = await toClipAudioAsync(mastered);
    const wavBlob = new Blob([wavHeaderPcm24(mastered.length, mastered.numberOfChannels, sampleRate), encodePcm24(mastered)], { type: 'audio/wav' });
    const peaks = audioEngine.generateWaveformPeaks(mastered, Math.min(24000, Math.max(8000, Math.round(clip.duration * 100))));

    // o clipe pode ter sido apagado enquanto a IA trabalhava
    const current = useStore.getState().clips.find((c) => c.id === clip.id);
    if (!current) throw new Error('o clipe foi removido durante a masterização');

    putClipAudio(clip.id, clip.songId, clipAudio);
    registerClipSource(clip.id, clip.songId, wavBlob);

    const cleanBaseName = current.name.replace(/^✨\s*/, '').replace(/\s*\(Master(?:izado| Moises)?\)/g, '');
    // com volume de master, o volume final é o dela; mantendo o volume, o ganho do clipe é
    // parte do equilíbrio do VS e fica
    const ownLevel = who.role === 'mix' || forceProfile;
    useStore.getState().updateClip(clip.id, { name: `✨ ${cleanBaseName} (Masterizado)`, waveformPeaks: peaks, ...(ownLevel ? { gain: 1.0 } : {}) });
    audioEngine.invalidatePrepared(clip.songId);

    done('done', masterSummary(report));
    return true;
  } catch (err) {
    console.error('[masterAudioClip] Erro:', err);
    done('error', `Não consegui masterizar "${clip.name}": ${err instanceof Error ? err.message : String(err)}.`);
    return false;
  }
}

// Mantém compatibilidade com chamadas legadas
export const masterMaestroClip = masterAudioClip;
export const masterMaestroAudioBuffer = (buf: AudioBuffer) => masterProfessionalAudioBuffer(buf, true);
