// Os instaladores são servidos pela VPS; o Supabase continua apenas com autenticação/histórico.
const BASE = 'https://download.vsstagepro.com.br/';

export interface MacBuild {
  arch: 'arm64' | 'x64';
  label: string;
  file: string;
  size: number;
  sha256: string;
  parts: string[];
}

export interface MacManifest {
  version: string;
  build?: number;
  published?: string;
  builds: MacBuild[];
}

function isBuild(b: unknown): b is MacBuild {
  const x = b as MacBuild;
  return !!x && (x.arch === 'arm64' || x.arch === 'x64') && typeof x.file === 'string'
    && typeof x.size === 'number' && typeof x.sha256 === 'string'
    && Array.isArray(x.parts) && x.parts.length > 0 && x.parts.every((p) => typeof p === 'string');
}

export async function fetchMacManifest(): Promise<MacManifest> {
  const res = await fetch(`${BASE}mac/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('manifest_unavailable');
  const data = await res.json();
  if (typeof data?.version !== 'string' || !Array.isArray(data?.builds) || !data.builds.every(isBuild)) {
    throw new Error('manifest_invalid');
  }
  return data as MacManifest;
}

/** Motivo legível de uma falha de download (mostrado na página). */
export class DownloadError extends Error {
  constructor(public reason: string) { super(reason); this.name = 'DownloadError'; }
}

const PART_ATTEMPTS = 4;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('cancelado', 'AbortError')); }, { once: true });
});

/**
 * Baixa as partes em sequência para dentro de um único bloco do tamanho do instalador, confere
 * o SHA-256 e entrega pronto para salvar. Uma parte que cai no meio (Wi-Fi oscilando, conexão
 * fechada) tenta de novo até 4 vezes continuando de onde parou, sem recomeçar o download.
 * Uma cópia só na memória (antes eram três, ~1,2 GB, e o navegador podia recusar no fim).
 */
export async function downloadMacBuild(build: MacBuild, onProgress: (received: number) => void, signal: AbortSignal): Promise<Blob> {
  let data: Uint8Array<ArrayBuffer>;
  try {
    data = new Uint8Array(build.size);
  } catch {
    throw new DownloadError('memória do navegador insuficiente: feche outras abas e tente de novo');
  }
  let received = 0;
  for (let i = 0; i < build.parts.length; i++) {
    const part = build.parts[i];
    const partStart = received;
    let attempt = 0;
    for (;;) {
      const resumeAt = received - partStart;
      try {
        const res = await fetch(BASE + part, { signal, cache: 'no-store', headers: resumeAt > 0 ? { Range: `bytes=${resumeAt}-` } : undefined });
        if (!res.ok || !res.body) throw new DownloadError(`o servidor não entregou a parte ${i + 1} de ${build.parts.length} (código ${res.status})`);
        // pediu para continuar mas o servidor mandou a parte inteira: recomeça só esta parte
        if (resumeAt > 0 && res.status === 200) received = partStart;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (received + value.byteLength > build.size) throw new DownloadError('o arquivo recebido é maior que o esperado');
          data.set(value, received);
          received += value.byteLength;
          onProgress(received);
        }
        break;
      } catch (err) {
        if (signal.aborted || (err as DOMException)?.name === 'AbortError') throw err;
        if (++attempt >= PART_ATTEMPTS) {
          throw err instanceof DownloadError ? err : new DownloadError(`a conexão caiu na parte ${i + 1} de ${build.parts.length} e não voltou`);
        }
        await sleep(1000 * attempt, signal);
      }
    }
  }
  if (received !== build.size) throw new DownloadError(`chegaram ${Math.round(received / 1048576)} de ${Math.round(build.size / 1048576)} MB`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== build.sha256) throw new DownloadError('o arquivo chegou corrompido (assinatura não confere)');
  return new Blob([data], { type: 'application/x-apple-diskimage' });
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Palpite do chip pelo nome da placa de vídeo; Intel aparece como Intel/AMD. */
export function guessMacArch(): 'arm64' | 'x64' | null {
  if (!/Mac/i.test(navigator.platform || navigator.userAgent)) return null;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Apple M\d|Apple GPU/i.test(renderer)) return 'arm64';
    if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) return 'x64';
  } catch { /* sem WebGL */ }
  return null;
}
