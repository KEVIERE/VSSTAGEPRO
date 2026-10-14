import { decodeBlob } from '@/lib/audioDecoder';
import { supabase } from '@/lib/supabaseClient';

export interface ReplicateProgress {
  message: string;
  percent: number;
}

/**
 * Conector oficial com o modelo Demucs v4 (Meta HTDemucs Fine-Tuned) via Replicate GPU.
 * Separação com 100% de qualidade de estúdio (padrão Logic Pro 11 e Moises).
 */
export async function separateWithReplicateDemucs(
  file: File,
  onProgress?: (p: ReplicateProgress) => void
): Promise<{ vocals: AudioBuffer; bass: AudioBuffer; drums: AudioBuffer; other: AudioBuffer }> {
  onProgress?.({ message: 'Enviando áudio para o servidor de IA (NVIDIA GPU)...', percent: 15 });

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('Você precisa estar conectado para usar o motor de separação por IA.');
  }

  const formData = new FormData();
  formData.append('file', file);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const functionUrl = `${supabaseUrl}/functions/v1/ai-stem-separator`;

  onProgress?.({ message: 'Processando com Demucs v4 (Meta AI)... Aguarde cerca de 20s.', percent: 35 });

  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 402 || body?.error === 'insufficient_credit') {
      throw new Error(
        'Saldo insuficiente na Replicate. Adicione créditos em https://replicate.com/account/billing para liberar o uso das GPUs.'
      );
    }
    throw new Error(body?.message || body?.error || 'Erro na separação de stems pela IA.');
  }

  const stems = body?.stems;
  if (!stems || !stems.vocals || !stems.drums || !stems.bass || !stems.other) {
    throw new Error('A IA não retornou todas as faixas esperadas.');
  }

  onProgress?.({ message: 'Baixando faixas isoladas em alta fidelidade...', percent: 80 });

  const [vocalsBlob, bassBlob, drumsBlob, otherBlob] = await Promise.all([
    fetch(stems.vocals).then((r) => r.blob()),
    fetch(stems.bass).then((r) => r.blob()),
    fetch(stems.drums).then((r) => r.blob()),
    fetch(stems.other).then((r) => r.blob()),
  ]);

  onProgress?.({ message: 'Decodificando áudio de estúdio para a timeline...', percent: 92 });

  const [vocals, bass, drums, other] = await Promise.all([
    decodeBlob(vocalsBlob),
    decodeBlob(bassBlob),
    decodeBlob(drumsBlob),
    decodeBlob(otherBlob),
  ]);

  return { vocals, bass, drums, other };
}
