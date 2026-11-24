// Minhas falas do Maestro por IA: o diretor cria as falas que ele mais usa e guarda em pastas (como
// os assuntos das falas prontas). O texto fica neste computador (localStorage, na chave antiga, para
// não perder o que já foi salvo); no app, cada fala é gravada para sempre na voz escolhida
// (maestroPinPhrase) e entra na timeline na hora, sem gerar.
import { cueKey } from './maestroCues.ts';

/** `voices`: vozes em que a frase foi gravada (para apagar a gravação junto com a frase). */
export interface MyPhrase { id: string; text: string; voices?: string[] }
export interface MyPhraseFolder { id: string; name: string; phrases: MyPhrase[] }
export interface MyPhrasesData { folders: MyPhraseFolder[] }

export const MY_PHRASES_KEY = 'vsstage.maestro.minhasFrases.v1';

/** Tamanho máximo do nome da pasta e da frase. */
export const FOLDER_NAME_MAX = 32;
export const PHRASE_MAX = 1200;

const listeners = new Set<() => void>();

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clean(data: unknown): MyPhrasesData {
  const folders = (data as MyPhrasesData | null)?.folders;
  if (!Array.isArray(folders)) return { folders: [] };
  return {
    folders: folders
      .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({
        id: f.id,
        name: f.name,
        phrases: Array.isArray(f.phrases)
          ? f.phrases
            .filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string' && p.text.trim())
            .map((p) => {
              const voices = Array.isArray(p.voices) ? p.voices.filter((v): v is string => typeof v === 'string' && !!v) : [];
              return voices.length ? { id: p.id, text: p.text, voices } : { id: p.id, text: p.text };
            })
          : [],
      })),
  };
}

/** As pastas guardadas (vazio quando não há nada ou o armazenamento está bloqueado). */
export function loadMyPhrases(): MyPhrasesData {
  try {
    const raw = localStorage.getItem(MY_PHRASES_KEY);
    return raw ? clean(JSON.parse(raw)) : { folders: [] };
  } catch {
    return { folders: [] };
  }
}

function save(data: MyPhrasesData): MyPhrasesData {
  try { localStorage.setItem(MY_PHRASES_KEY, JSON.stringify(data)); } catch { /* sem armazenamento: vale só nesta sessão */ }
  for (const fn of listeners) fn();
  return data;
}

/** Avisa quando as pastas mudam (outra janela aberta do mesmo seletor). */
export function subscribeMyPhrases(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Cria uma pasta (nome repetido devolve a que já existe). */
export function createFolder(data: MyPhrasesData, name: string): { data: MyPhrasesData; folder: MyPhraseFolder | null } {
  const n = name.trim().slice(0, FOLDER_NAME_MAX);
  if (!n) return { data, folder: null };
  const same = data.folders.find((f) => cueKey(f.name) === cueKey(n));
  if (same) return { data, folder: same };
  const folder: MyPhraseFolder = { id: newId('pasta'), name: n, phrases: [] };
  return { data: save({ folders: [...data.folders, folder] }), folder };
}

export function renameFolder(data: MyPhrasesData, folderId: string, name: string): MyPhrasesData {
  const n = name.trim().slice(0, FOLDER_NAME_MAX);
  if (!n) return data;
  return save({ folders: data.folders.map((f) => (f.id === folderId ? { ...f, name: n } : f)) });
}

export function deleteFolder(data: MyPhrasesData, folderId: string): MyPhrasesData {
  return releasePins(data, save({ folders: data.folders.filter((f) => f.id !== folderId) }));
}

/** A frase foi gravada nesta voz (guarda a voz na frase, para apagar a gravação depois). */
export function markPinned(data: MyPhrasesData, text: string, voice: string): MyPhrasesData {
  let changed = false;
  const folders = data.folders.map((f) => ({
    ...f,
    phrases: f.phrases.map((p) => {
      if (p.text !== text || p.voices?.includes(voice)) return p;
      changed = true;
      return { ...p, voices: [...(p.voices ?? []), voice] };
    }),
  }));
  return changed ? save({ folders }) : data;
}

/**
 * Gravações que ficaram sem frase: a frase saiu de todas as pastas (a mesma frase pode estar em
 * mais de uma pasta, e aí a gravação fica).
 */
export function orphanPins(before: MyPhrasesData, after: MyPhrasesData): Array<{ text: string; voice: string }> {
  const kept = new Set(after.folders.flatMap((f) => f.phrases.map((p) => p.text)));
  const out: Array<{ text: string; voice: string }> = [];
  const seen = new Set<string>();
  for (const f of before.folders) {
    for (const p of f.phrases) {
      if (kept.has(p.text)) continue;
      for (const voice of p.voices ?? []) {
        const k = `${voice}|${p.text}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ text: p.text, voice });
      }
    }
  }
  return out;
}

/** A frase ainda está em alguma pasta? (a gravação na fila confere antes e depois de gravar) */
export function isSavedText(data: MyPhrasesData, text: string): boolean {
  return data.folders.some((f) => f.phrases.some((p) => p.text === text));
}

/** Apaga no app as gravações das frases que saíram (no site não há gravação). */
function releasePins(before: MyPhrasesData, after: MyPhrasesData): MyPhrasesData {
  const unpin = typeof window !== 'undefined' ? window.vsDesktop?.maestroUnpinPhrase : undefined;
  if (unpin) for (const p of orphanPins(before, after)) void unpin(p).catch(() => {});
  return after;
}

/** A frase já está nesta pasta? (sem diferença de acento, pontuação e maiúscula) */
export function hasPhrase(folder: MyPhraseFolder | undefined, text: string): boolean {
  const k = cueKey(text);
  return !!folder && !!k && folder.phrases.some((p) => cueKey(p.text) === k);
}

/** Guarda a frase na pasta (frase igual na mesma pasta não duplica). */
export function savePhrase(data: MyPhrasesData, folderId: string, text: string): MyPhrasesData {
  const t = text.trim().slice(0, PHRASE_MAX);
  const folder = data.folders.find((f) => f.id === folderId);
  if (!t || !folder || hasPhrase(folder, t)) return data;
  return save({
    folders: data.folders.map((f) => (f.id === folderId ? { ...f, phrases: [...f.phrases, { id: newId('frase'), text: t }] } : f)),
  });
}

export function deletePhrase(data: MyPhrasesData, folderId: string, phraseId: string): MyPhrasesData {
  return releasePins(data, save({
    folders: data.folders.map((f) => (f.id === folderId ? { ...f, phrases: f.phrases.filter((p) => p.id !== phraseId) } : f)),
  }));
}
