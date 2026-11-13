// Fila dos cadernos que ainda não chegaram ao servidor (ou ao Mac do diretor, na Rede Local).
// Código puro (sem React e só com import de tipo), para rodar nos testes.
//
// Duas cópias:
// - o localStorage deste aparelho, que sobrevive a recarregar a página, mas tem cota (uns 5 MB
//   por site) e um caderno com fotos pode ter até 1,4 MB;
// - a memória da página, que vale enquanto ela estiver aberta. Fica no módulo e não num useRef:
//   no celular, tocar em "Ao vivo" ou ligar o Modo show desmonta o caderno, e a edição que não
//   coube no aparelho não pode morrer junto.

export interface Pending { songId: string; sheetId: string | null; title: string; content: string; at: number }
export type Queue = Record<string, Pending>;

export function codeHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function readQueue(key: string): Queue {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Queue) : {};
  } catch { return {}; }
}

/** Grava a fila. Devolve false quando o aparelho não guardou (armazenamento cheio ou bloqueado). */
export function writeQueue(key: string, q: Queue): boolean {
  try {
    if (Object.keys(q).length) localStorage.setItem(key, JSON.stringify(q));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** A versão mais nova das duas (no empate, a primeira). */
export function newer(a: Pending | undefined, b: Pending | undefined): Pending | undefined {
  if (!a) return b;
  if (!b) return a;
  return (b.at ?? 0) > (a.at ?? 0) ? b : a;
}

const unsentByQueue = new Map<string, Map<string, Pending>>();
// músicas cuja versão que falta enviar não coube no aparelho: só existe na memória da página
const notKept = new Set<string>();
const nkKey = (queueKey: string, songId: string) => `${queueKey}\n${songId}`;

/** Versões que falharam ao enviar, na memória da página (por fila). */
export function memFor(queueKey: string): Map<string, Pending> {
  let m = unsentByQueue.get(queueKey);
  if (!m) { m = new Map(); unsentByQueue.set(queueKey, m); }
  return m;
}

/** A versão mais nova desta música que ainda falta enviar (aparelho ou memória). */
export function newestOf(queueKey: string, songId: string, q: Queue = readQueue(queueKey)): Pending | undefined {
  return newer(q[songId], memFor(queueKey).get(songId));
}

/**
 * A gravação falhou: guarda a versão mais nova na memória e, se couber, no aparelho. Não regrava a
 * fila inteira (que pode ter vários MB) quando o aparelho já tem essa versão.
 * Devolve true quando ficou guardada no aparelho.
 */
export function keepUnsent(queueKey: string, p: Pending): boolean {
  const mem = memFor(queueKey);
  const best = newer(mem.get(p.songId), p)!;
  mem.set(p.songId, best);
  const q = readQueue(queueKey);
  let kept = !!q[p.songId] && (q[p.songId].at ?? 0) >= best.at;
  if (!kept) {
    q[p.songId] = best;
    kept = writeQueue(queueKey, q);
  }
  if (kept) notKept.delete(nkKey(queueKey, p.songId));
  else notKept.add(nkKey(queueKey, p.songId));
  return kept;
}

/**
 * A versão `p` chegou: sai da fila do aparelho (se não houver uma mais nova lá) e da memória.
 * Devolve a versão mais nova desta música que ainda falta enviar, se houver.
 */
export function markSent(queueKey: string, p: Pending): Pending | undefined {
  const q = readQueue(queueKey);
  if (q[p.songId] && (q[p.songId].at ?? 0) <= p.at) {
    delete q[p.songId];
    writeQueue(queueKey, q);
  }
  const later = newestOf(queueKey, p.songId, q);
  if (later && later.at > p.at) return later;
  memFor(queueKey).delete(p.songId);
  notKept.delete(nkKey(queueKey, p.songId));
  return undefined;
}

/**
 * O que falta enviar: UMA versão por música, a mais nova entre o aparelho e a memória. Mandar as
 * duas faria a velha chegar por último e ficar valendo no servidor ("a última vence").
 */
export function unsentVersions(queueKey: string): Pending[] {
  const q = readQueue(queueKey);
  const mem = memFor(queueKey);
  const ids = new Set([...Object.keys(q), ...mem.keys()]);
  const out: Pending[] = [];
  ids.forEach((id) => {
    const p = newer(q[id], mem.get(id));
    if (p && typeof p.songId === 'string') out.push(p);
  });
  return out;
}

/** A versão que falta enviar desta música não coube no aparelho. */
export function isNotKept(queueKey: string, songId: string): boolean {
  return notKept.has(nkKey(queueKey, songId));
}

/** Alguma música desta fila só está na memória da página. */
export function anyNotKept(queueKey: string): boolean {
  const prefix = `${queueKey}\n`;
  for (const k of notKept) if (k.startsWith(prefix)) return true;
  return false;
}

/** Caderno excluído: esquece a versão que faltava enviar (senão o envio recriaria o caderno). */
export function forgetUnsent(queueKey: string, songId: string): void {
  const q = readQueue(queueKey);
  if (q[songId]) {
    delete q[songId];
    writeQueue(queueKey, q);
  }
  memFor(queueKey).delete(songId);
  notKept.delete(nkKey(queueKey, songId));
}
