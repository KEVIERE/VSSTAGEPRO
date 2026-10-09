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

/** Baixa as partes em sequência, confere o arquivo inteiro e entrega pronto para salvar. */
export async function downloadMacBuild(build: MacBuild, onProgress: (received: number) => void, signal: AbortSignal): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (const part of build.parts) {
    const res = await fetch(BASE + part, { signal });
    if (!res.ok || !res.body) throw new Error('part_failed');
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress(received);
    }
  }
  if (received !== build.size) throw new Error('size_mismatch');
  const blob = new Blob(chunks, { type: 'application/x-apple-diskimage' });
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== build.sha256) throw new Error('hash_mismatch');
  return blob;
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
