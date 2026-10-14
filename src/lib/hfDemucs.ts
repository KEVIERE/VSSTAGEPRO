import { decodeBlob } from '@/lib/audioDecoder';

const DEFAULT_HF_SPACE_HOST = 'https://nakas-demucs-playground.hf.space';

export interface HfProgress {
  message: string;
  percent: number;
}

/**
 * Conector oficial com o modelo Demucs v4 (Meta) hospedado no Hugging Face Spaces.
 * Separação de alta fidelidade de estúdio com isolamento neural de 4 canais.
 */
export async function separateWithHfDemucs(
  file: File,
  hfToken?: string,
  onProgress?: (p: HfProgress) => void
): Promise<{ vocals: AudioBuffer; bass: AudioBuffer; drums: AudioBuffer; other: AudioBuffer }> {
  const host = DEFAULT_HF_SPACE_HOST;
  const headers: Record<string, string> = {};
  if (hfToken) {
    headers['Authorization'] = `Bearer ${hfToken.trim()}`;
  }

  // 1. UPLOAD DO ARQUIVO PARA O ESPAÇO
  onProgress?.({ message: 'Enviando áudio para o motor Demucs v4 no Hugging Face...', percent: 15 });

  const formData = new FormData();
  formData.append('files', file);

  const uploadRes = await fetch(`${host}/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!uploadRes.ok) {
    throw new Error('Não foi possível enviar o áudio para o servidor do Hugging Face. Verifique sua conexão.');
  }

  const uploadData = await uploadRes.json();
  const remotePath = Array.isArray(uploadData) ? uploadData[0] : null;
  if (!remotePath) {
    throw new Error('Falha no upload do arquivo para o servidor de IA.');
  }

  // 2. FILA E PROCESSAMENTO VIA WEBSOCKET (GRADIO QUEUE)
  onProgress?.({ message: 'Conectando ao motor de IA Demucs v4...', percent: 25 });

  const sessionHash = Math.random().toString(36).substring(2, 13);
  const wsUrl = host.replace(/^http/, 'ws') + '/queue/join';

  const outputFiles = await new Promise<string[]>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(new Error('Não foi possível conectar ao WebSocket do Hugging Face.'));
      return;
    }

    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('Tempo limite excedido na fila do Hugging Face.'));
    }, 12 * 60 * 1000); // 12 minutos max na fila compartilhada

    ws.onopen = () => {
      ws.send(JSON.stringify({ session_hash: sessionHash, fn_index: 0 }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.msg === 'send_hash') {
          // handshake inicial
        } else if (msg.msg === 'estimation') {
          const rank = msg.rank !== undefined ? msg.rank + 1 : 1;
          const totalQueue = msg.queue_size ?? rank;
          onProgress?.({
            message: `Na fila do Hugging Face (posição ${rank} de ${totalQueue}). Aguarde...`,
            percent: 30,
          });
        } else if (msg.msg === 'send_data') {
          onProgress?.({ message: 'Enviando parâmetros para a IA...', percent: 40 });
          ws.send(JSON.stringify({
            data: [remotePath],
            session_hash: sessionHash,
            fn_index: 0,
          }));
        } else if (msg.msg === 'process_starts') {
          onProgress?.({
            message: 'A IA Demucs v4 está separando as 4 faixas (Bateria, Baixo, Voz e Playback)...',
            percent: 50,
          });
        } else if (msg.msg === 'process_generating' || msg.msg === 'process_progress') {
          onProgress?.({
            message: 'Processando separação de stems com qualidade de estúdio...',
            percent: 75,
          });
        } else if (msg.msg === 'process_completed') {
          clearTimeout(timeout);
          ws.close();
          const data = msg.output?.data;
          if (Array.isArray(data) && data.length >= 4) {
            resolve(data.map((item) => (typeof item === 'string' ? item : item?.name || item?.data || '')));
          } else {
            reject(new Error('A IA não retornou as 4 faixas esperadas.'));
          }
        }
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err);
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Erro de conexão com o servidor de IA.'));
    };

    ws.onclose = (ev) => {
      if (!ev.wasClean) {
        clearTimeout(timeout);
      }
    };
  });

  // 3. BAIXAR E DECODIFICAR OS 4 STEMS
  // Ordem de saída do Demucs v4: [0] = Vocals, [1] = Bass, [2] = Drums, [3] = Other
  onProgress?.({ message: 'Baixando faixas separadas de alta qualidade...', percent: 85 });

  const toUrl = (p: string) => (p.startsWith('http') ? p : `${host}/file=${p}`);

  const [vocalsBlob, bassBlob, drumsBlob, otherBlob] = await Promise.all([
    fetch(toUrl(outputFiles[0])).then((r) => r.blob()),
    fetch(toUrl(outputFiles[1])).then((r) => r.blob()),
    fetch(toUrl(outputFiles[2])).then((r) => r.blob()),
    fetch(toUrl(outputFiles[3])).then((r) => r.blob()),
  ]);

  onProgress?.({ message: 'Decodificando áudios de estúdio no programa...', percent: 92 });

  const [vocals, bass, drums, other] = await Promise.all([
    decodeBlob(vocalsBlob),
    decodeBlob(bassBlob),
    decodeBlob(drumsBlob),
    decodeBlob(otherBlob),
  ]);

  return { vocals, bass, drums, other };
}
