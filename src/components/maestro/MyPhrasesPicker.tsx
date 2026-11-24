import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Circle, FolderPlus, Pencil, Trash2, X } from 'lucide-react';
import {
  FOLDER_NAME_MAX, createFolder, deleteFolder, deletePhrase, isSavedText, loadMyPhrases, markPinned, renameFolder, savePhrase,
  subscribeMyPhrases, type MyPhraseFolder, type MyPhrasesData,
} from '@/lib/myPhrases';
import { cueKey } from '@/lib/maestroCues';
import { isCloneVoice, isOfferedVoice } from '@/lib/maestroVoice';
import { useStore } from '@/store';

/** Campo que cuida do próprio Esc: a janela do "+" não fecha com ele, mesmo vazio. */
export const ESC_LOCAL_ATTR = 'data-esc-local';

interface MyPhrasesPickerProps {
  /** Texto atual da fala: a fala igual a ele fica acesa. */
  text: string;
  /** Voz escolhida: as falas são criadas nela. */
  voice: string;
  /** A voz de IA está pronta neste computador (modelo baixado): sem ela não dá para gravar. */
  iaReady: boolean;
  /** `recorded`: a fala já está pronta nesta voz e pode tocar na hora. */
  onPick: (text: string, recorded: boolean) => void;
}

/** gravada = pronta nesta voz (sai na hora); gravando = sendo criada; falhou = deu erro há pouco. */
export type PhraseState = 'gravada' | 'gravando' | 'falhou' | 'nao';

const OPEN_KEY = 'vsstage.maestro.minhasFrases.aberta';

// Uma gravação de cada vez, em todas as janelas (não empilha a pasta inteira na frente da fala do show).
let chain: Promise<void> = Promise.resolve();
const queuedPins = new Set<string>();
const pinListeners = new Set<() => void>();
const notifyPins = () => { for (const fn of pinListeners) fn(); };

/** Espera a música parar: preparar frases durante o show pode falhar o áudio (processador a 100%). */
function waitIdle(): Promise<void> {
  if (!useStore.getState().transport.isPlaying) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useStore.subscribe((s) => {
      if (!s.transport.isPlaying) { unsub(); resolve(); }
    });
  });
}

/**
 * Grava a frase na voz para sempre (no app). Espera a música parar antes de começar; a geração
 * pode levar de 15 s a minutos. Ao terminar, a frase guarda a voz (para apagar a gravação junto).
 */
function queuePin(text: string, voice: string): void {
  const pin = window.vsDesktop?.maestroPinPhrase;
  const k = `${voice}|${text}`;
  if (!pin || queuedPins.has(k)) return;
  queuedPins.add(k);
  notifyPins();
  chain = chain.then(async () => {
    try {
      // a frase pode ter sido apagada enquanto esperava a vez: aí não grava nada
      if (!isSavedText(loadMyPhrases(), text)) return;
      await waitIdle();
      if (!isSavedText(loadMyPhrases(), text)) return;
      const got = await pin({ text, voice });
      if (got !== 'gravada') return;
      // apagada durante a gravação: o arquivo novo ficaria órfão, então sai agora
      if (isSavedText(loadMyPhrases(), text)) markPinned(loadMyPhrases(), text, voice);
      else await window.vsDesktop?.maestroUnpinPhrase?.({ text, voice });
    } catch { /* o LED mostra a falha ao conferir */ } finally {
      queuedPins.delete(k);
      notifyPins();
    }
  }).catch(() => {});
}

/** Avisa quando uma fala entra ou sai da fila de criação. */
export function subscribeSpeechQueue(fn: () => void): () => void {
  pinListeners.add(fn);
  return () => { pinListeners.delete(fn); };
}

/** Situação da fala nesta voz, sem gerar nada. */
export async function speechStateOf(text: string, voice: string): Promise<PhraseState> {
  const t = text.trim();
  const list = window.vsDesktop?.maestroPinnedStates;
  if (!t || !list) return 'nao';
  let got: PhraseState = 'nao';
  try { got = (await list({ texts: [t], voice }))[t] ?? 'nao'; } catch { got = 'nao'; }
  return got !== 'gravada' && queuedPins.has(`${voice}|${t}`) ? 'gravando' : got;
}

/**
 * Criar fala: guarda o texto na pasta aberta (sem pasta, numa chamada Minhas falas) e põe na fila
 * de criação em segundo plano. A fila continua mesmo com a janela fechada.
 */
export function createSpeech(text: string, voice: string): { text: string; existed: boolean } | null {
  const t = text.trim();
  if (!t) return null;
  let data = loadMyPhrases();
  let folder: MyPhraseFolder | null = data.folders.find((f) => f.id === savedOpen()) ?? data.folders[0] ?? null;
  // a mesma fala (igual em qualquer pasta, ou sem diferença de acento e pontuação na pasta aberta)
  const key = cueKey(t);
  const home = data.folders.find((f) => f.phrases.some((p) => p.text === t)) ?? folder;
  const existing = home?.phrases.find((p) => p.text === t) ?? (key ? home?.phrases.find((p) => cueKey(p.text) === key) : undefined);
  if (home && existing) {
    rememberOpen(home.id);
    queuePin(existing.text, voice);
    notifyPins();
    return { text: existing.text, existed: true };
  }
  if (!folder) {
    const made = createFolder(data, 'Minhas falas');
    data = made.data;
    folder = made.folder;
  }
  if (!folder) return null;
  savePhrase(data, folder.id, t);
  rememberOpen(folder.id);
  queuePin(t, voice);
  return { text: t, existed: false };
}

// O seletor relê as pastas quando outra parte do app grava (mesmo formato do localStorage).
let snapshot: MyPhrasesData = loadMyPhrases();
subscribeMyPhrases(() => { snapshot = loadMyPhrases(); });
const getSnapshot = () => snapshot;

function savedOpen(): string | null {
  try { return localStorage.getItem(OPEN_KEY); } catch { return null; }
}
function rememberOpen(id: string | null): void {
  try { if (id) localStorage.setItem(OPEN_KEY, id); else localStorage.removeItem(OPEN_KEY); } catch { /* só nesta sessão */ }
}

/**
 * Minhas falas: as falas do diretor guardadas em pastas. Uma tecla por pasta; as falas da pasta
 * aberta são botões com um LED (verde = pronta na voz escolhida, âmbar piscando = criando). O
 * Criar fala fica no rodapé da janela; o clique numa fala pronta toca na hora. Trocar de voz não
 * cria nada sozinho: a fala sem gravação nessa voz mostra a tecla de criar.
 */
export default function MyPhrasesPicker({ text, voice, iaReady, onPick }: MyPhrasesPickerProps) {
  const data = useSyncExternalStore(subscribeMyPhrases, getSnapshot);
  const [openId, setOpenId] = useState<string | null>(() => {
    const saved = savedOpen();
    return data.folders.find((f) => f.id === saved)?.id ?? data.folders[0]?.id ?? null;
  });
  // campo curto do nome: pasta nova ou renomear a aberta
  const [naming, setNaming] = useState<null | 'nova' | 'renomear'>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [states, setStates] = useState<Record<string, PhraseState>>({});
  const nameRef = useRef<HTMLInputElement>(null);

  const folder = data.folders.find((f) => f.id === openId);
  const trimmed = text.trim();
  const desk = typeof window !== 'undefined' ? window.vsDesktop : undefined;
  // só voz clonada que ainda existe grava: nas outras, salvar guarda apenas o texto
  const pins = isCloneVoice(voice) && isOfferedVoice(voice) && !!desk?.maestroPinPhrase && !!desk?.maestroPinnedStates;
  const canRecord = pins && iaReady;
  const phrasesKey = folder ? folder.phrases.map((p) => p.text).join('\n') : '';
  const [pinTick, setPinTick] = useState(0);
  useEffect(() => {
    const fn = () => setPinTick((n) => n + 1);
    pinListeners.add(fn);
    return () => { pinListeners.delete(fn); };
  }, []);

  // o Criar fala do rodapé guardou numa pasta: ela abre aqui, para o LED aparecer
  useEffect(() => {
    const saved = savedOpen();
    if (saved && saved !== openId && data.folders.some((f) => f.id === saved)) setOpenId(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinTick]);

  useEffect(() => { if (naming) nameRef.current?.focus(); }, [naming]);
  useEffect(() => { setConfirmDelete(false); }, [openId]);

  const open = (id: string | null) => { setOpenId(id); rememberOpen(id); setNaming(null); };

  // Situação das frases da pasta aberta na voz escolhida (só consulta, não gera nada). Enquanto
  // alguma está gravando, confere de novo de tempos em tempos.
  useEffect(() => {
    const list = desk?.maestroPinnedStates;
    if (!folder || !pins || !list) { setStates({}); return; }
    const texts = folder.phrases.map((p) => p.text);
    let alive = true;
    let timer = 0;
    const load = async () => {
      let got: Record<string, PhraseState> = {};
      try { got = await list({ texts, voice }); } catch { got = {}; }
      if (!alive) return;
      const next: Record<string, PhraseState> = {};
      for (const t of texts) next[t] = queuedPins.has(`${voice}|${t}`) && got[t] !== 'gravada' ? 'gravando' : (got[t] ?? 'nao');
      setStates(next);
      // gravada por outra pasta com o mesmo texto: esta frase também guarda a voz
      for (const p of folder.phrases) if (next[p.text] === 'gravada' && !p.voices?.includes(voice)) markPinned(loadMyPhrases(), p.text, voice);
      if (Object.values(next).includes('gravando')) timer = window.setTimeout(() => { void load(); }, 3000);
    };
    void load();
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.id, phrasesKey, voice, pins, pinTick]);

  const record = (texts: string[]) => {
    if (!canRecord) return;
    for (const t of texts) queuePin(t, voice);
  };
  const missing = folder && canRecord ? folder.phrases.filter((p) => states[p.text] === 'nao' || states[p.text] === 'falhou') : [];

  const startNaming = (kind: 'nova' | 'renomear') => {
    setConfirmDelete(false);
    setNameDraft(kind === 'renomear' ? folder?.name ?? '' : '');
    setNaming(kind);
  };

  const confirmName = () => {
    const name = nameDraft.trim();
    if (!name) { setNaming(null); return; }
    if (naming === 'renomear' && folder) {
      renameFolder(data, folder.id, name);
    } else {
      const made = createFolder(data, name);
      if (made.folder) open(made.folder.id);
    }
    setNaming(null);
  };

  const removeFolder = () => {
    if (!folder) return;
    if (folder.phrases.length > 0 && !confirmDelete) { setConfirmDelete(true); return; }
    deleteFolder(data, folder.id);
    const rest = data.folders.filter((f) => f.id !== folder.id);
    open(rest[0]?.id ?? null);
    setConfirmDelete(false);
  };

  const current = cueKey(trimmed);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Pastas: uma tecla por pasta, como os assuntos das falas prontas */}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Pastas das minhas falas">
        {data.folders.map((f) => (
          <button
            key={f.id}
            className={`console-key h-5 px-1.5 text-[10px] ${openId === f.id ? 'is-lit-green' : ''}`}
            onClick={() => open(openId === f.id ? null : f.id)}
            aria-expanded={openId === f.id}
            title={`${f.phrases.length} ${f.phrases.length === 1 ? 'fala' : 'falas'}`}
          >
            {f.name}
          </button>
        ))}
        <button
          className="console-key h-5 px-1.5 text-[10px] flex items-center gap-1"
          onClick={() => startNaming('nova')}
          title="Criar uma pasta para guardar falas"
        >
          <FolderPlus size={10} /> Pasta
        </button>
      </div>

      {naming && (
        <div className="flex items-center gap-1">
          <input
            ref={nameRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={FOLDER_NAME_MAX}
            {...{ [ESC_LOCAL_ATTR]: '' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); confirmName(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNaming(null); }
            }}
            placeholder={naming === 'renomear' ? 'Novo nome da pasta' : 'Nome da pasta (ex.: Abertura, Culto)'}
            className="console-display flex-1 min-w-0 h-6 px-2 text-[11px] focus:outline-none"
            spellCheck={false}
          />
          <button className="console-key is-lit-amber h-6 px-2 text-[10px] flex items-center gap-1" onClick={confirmName} disabled={!nameDraft.trim()}>
            <Check size={10} /> {naming === 'renomear' ? 'Renomear' : 'Criar'}
          </button>
          <button className="console-key h-6 w-6 flex items-center justify-center" onClick={() => setNaming(null)} title="Cancelar (Esc)" aria-label="Cancelar">
            <X size={10} />
          </button>
        </div>
      )}

      {folder ? (
        <div className="console-well flex flex-wrap gap-1 p-1.5 max-h-32 overflow-y-auto animate-[fadeIn_120ms_ease-out]">
          {folder.phrases.length === 0 && (
            <div className="px-1.5 py-1 text-[10px] text-logic-text-muted">Pasta vazia: escreva a fala e toque em Criar fala.</div>
          )}
          {folder.phrases.map((p) => {
            const st = pins ? states[p.text] : undefined;
            const on = cueKey(p.text) === current;
            const tip = st === 'gravada' ? 'Pronta nesta voz: clique para ouvir e use Adicionar fala para pôr na timeline'
              : st === 'gravando' ? 'Criando nesta voz (espera a música parar)...'
                : st === 'falhou' ? 'Não deu para criar: toque no círculo para tentar de novo'
                  : 'Pôr esta fala no texto';
            return (
              <span key={p.id} className="group inline-flex items-center rounded">
                <button
                  className={`flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-l text-[11px] transition-colors ${
                    on ? 'bg-logic-lcd-green/20 text-logic-lcd-green' : 'text-logic-text-dim hover:text-logic-text hover:bg-white/5'
                  }`}
                  onClick={() => onPick(p.text, st === 'gravada')}
                  title={tip}
                >
                  <span
                    className={`console-led shrink-0 ${st === 'gravada' ? 'is-on-green' : st === 'gravando' ? 'is-on-amber animate-pulse' : ''}`}
                    aria-label={st === 'gravada' ? 'pronta' : st === 'gravando' ? 'criando' : undefined}
                  />
                  {p.text}
                </button>
                {canRecord && (st === 'nao' || st === 'falhou') && (
                  <button
                    className={`px-0.5 py-1 ${st === 'falhou' ? 'text-logic-lcd-red' : 'text-logic-text-muted'} hover:text-logic-lcd-amber`}
                    onClick={() => record([p.text])}
                    title="Criar esta fala nesta voz (fica guardada)"
                    aria-label="Criar esta fala nesta voz"
                  >
                    <Circle size={9} />
                  </button>
                )}
                <button
                  className="px-0.5 py-1 rounded-r text-logic-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-logic-lcd-red transition-opacity"
                  onClick={() => deletePhrase(data, folder.id, p.id)}
                  title="Tirar esta fala da pasta (apaga a gravação)"
                  aria-label="Tirar esta fala da pasta"
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        !naming && (
          <div className="console-well px-2 py-1.5 text-[10px] text-logic-text-muted leading-snug">
            {data.folders.length ? 'Abra uma pasta para ver as falas.' : 'Escreva a fala e toque em Criar fala. Ela fica pronta na voz escolhida para adicionar onde quiser.'}
          </div>
        )
      )}

      <div className="flex items-center gap-1">
        {missing.length > 0 && (
          <button
            className="console-key h-6 px-1.5 text-[10px] flex items-center gap-1"
            onClick={() => record(missing.map((p) => p.text))}
            title="Criar nesta voz as falas da pasta que ainda faltam (uma de cada vez, com a música parada)"
          >
            <Circle size={9} /> Criar {missing.length}
          </button>
        )}
        {folder && (
          <>
            <button className="console-key h-6 w-6 flex items-center justify-center ml-auto" onClick={() => startNaming('renomear')} title="Renomear a pasta" aria-label="Renomear a pasta">
              <Pencil size={10} />
            </button>
            <button
              className={`console-key h-6 px-1.5 text-[10px] flex items-center gap-1 ${confirmDelete ? 'is-lit-red' : ''}`}
              onClick={removeFolder}
              onBlur={() => setConfirmDelete(false)}
              title="Apagar a pasta e as falas dela"
            >
              <Trash2 size={10} /> {confirmDelete ? `Apagar ${folder.phrases.length} ${folder.phrases.length === 1 ? 'fala' : 'falas'}?` : 'Pasta'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
