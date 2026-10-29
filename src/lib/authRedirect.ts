// Para onde os links dos e-mails de conta (confirmar cadastro, recuperar senha) levam.
// Dentro do app do Mac o endereço da página é vsstage://app, que um clique no e-mail não abre
// (o sistema não conhece esse endereço): os links vão para o site, onde as mesmas telas existem.
import { isPrivateOrigin } from '@/lib/publicUrl';

export const SITE_URL = 'https://vsstagepro.com.br';

export function authRedirect(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (isPrivateOrigin()) return `${SITE_URL}${p}`;
  return `${window.location.origin}${p}`;
}
