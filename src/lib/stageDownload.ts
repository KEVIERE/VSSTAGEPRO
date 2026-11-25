// Stage Download (página /stagedownload): tipos e contas da página. Sem imports, para os testes.
// O motor roda no servidor do site (stage-download/server.py), atrás do nginx neste endereço.

/** Mesmo domínio do site; no staging (/staging/) também usa o motor de produção. */
export const STAGE_DOWNLOAD_API = '/stagedownload/api';

export type AudioFormats = Record<string, { label: string; qualities: Record<string, string> }>;

export interface SdInfo {
  platform: string;
  platform_name: string;
  can_video: boolean;
  title: string;
  thumbnail?: string | null;
  uploader?: string | null;
  count: number;
  tracks?: string[];
  source?: { abr?: number | null; acodec?: string | null; asr?: number | null; height?: number | null } | null;
  audio: AudioFormats;
  video: Record<string, string>;
  limits?: { tracks: number; minutes: number; video: number };
}

export interface SdItem { name: string; progress: number; state: string; file: string | null; error: string | null }

export interface SdJob {
  id: string;
  title: string;
  label: string;
  mode: 'audio' | 'video';
  format: string;
  quality: string;
  state: 'waiting' | 'running' | 'done' | 'error';
  error: string | null;
  zip: string | null;
  created: number;
  items: SdItem[];
}

const numeric = (k: string) => /^\d+$/.test(k);

/** Qualidades do maior para o menor ("best" primeiro); WAV/FLAC na ordem que vieram. */
export function orderedQualities(formats: AudioFormats, fmt: string): Array<[string, string]> {
  const entries = Object.entries(formats[fmt]?.qualities ?? {});
  if (!entries.every(([k]) => numeric(k) || k === 'best')) return entries;
  const rank = (k: string) => (k === 'best' ? Number.MAX_SAFE_INTEGER : Number(k));
  return entries.sort((a, b) => rank(b[0]) - rank(a[0]));
}

/** Qualidade que já vem marcada: a maior que o link tem. */
export function topQuality(formats: AudioFormats, fmt: string): string {
  return orderedQualities(formats, fmt)[0]?.[0] ?? '';
}

export function qualityLabel(job: Pick<SdJob, 'label' | 'mode' | 'format' | 'quality'>): string {
  if (job.label) return job.label;
  return job.mode === 'video' ? `MP4 ${job.quality === 'best' ? 'melhor' : `${job.quality}p`}` : `${job.format.toUpperCase()} ${job.quality}`;
}

export function fileUrl(jobId: string, index: number): string {
  return `${STAGE_DOWNLOAD_API}/file/${jobId}/${index}`;
}

/** Mensagem para o erro que o servidor devolve (código ou texto já pronto). */
export function downloadError(code: unknown): string {
  switch (code) {
    case 'login': return 'Sua sessão terminou. Entre de novo na sua conta.';
    case 'not_subscriber': return 'O Stage Download é só para assinantes em dia. Confira sua assinatura.';
    case 'check_failed': return 'Não foi possível conferir sua assinatura agora. Tente de novo.';
    case undefined: case null: case '': return 'O servidor não respondeu. Tente de novo em instantes.';
    default: return typeof code === 'string' ? code : 'Algo deu errado. Tente de novo.';
  }
}
