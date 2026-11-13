// Botão "Salvar" da Área do Músico: o que aparece para o músico depois de apertar.
// Código puro (sem React), para rodar nos testes.

import type { ProjectSaveStatus } from './musicianTypes';

/**
 * Como ficou o caderno da música aberta (useNotebook.saveNow).
 * not_kept: sem conexão e sem espaço neste aparelho; o caderno só está na memória da página.
 */
export type SheetSaveResult = 'saved' | 'offline' | 'too_big' | 'empty' | 'not_kept';

/** ok: tudo gravado. warn: o caderno está a salvo, mas falta algo do lado do diretor. fail: não salvou. */
export type SaveTone = 'ok' | 'warn' | 'fail';

export interface SaveOutcome {
  tone: SaveTone;
  text: string;
}

/**
 * @param sheet   como ficou o caderno
 * @param project Rede Local: como ficou o arquivo do projeto no Mac. null: conta online (não tem projeto).
 */
export function saveOutcome(sheet: SheetSaveResult, project: ProjectSaveStatus | null): SaveOutcome {
  const local = project !== null;
  if (sheet === 'empty') return { tone: 'warn', text: 'Escolha uma música para salvar o caderno dela.' };
  if (sheet === 'too_big') {
    return { tone: 'fail', text: 'O caderno desta música está cheio demais para salvar. Apague alguns desenhos ou fotos e aperte Salvar de novo.' };
  }
  if (sheet === 'not_kept') {
    return {
      tone: 'fail',
      text: local
        ? 'Sem conexão com o Mac do diretor e sem espaço neste aparelho para guardar o caderno. Não feche esta página: ele vai sozinho quando a conexão voltar.'
        : 'Sem internet e sem espaço neste aparelho para guardar o caderno. Não feche esta página: ele vai sozinho quando a internet voltar.',
    };
  }
  if (sheet === 'offline') {
    return {
      tone: 'fail',
      text: local
        ? 'Sem conexão com o Mac do diretor. O caderno ficou guardado neste aparelho e vai sozinho quando a conexão voltar.'
        : 'Sem internet agora. O caderno ficou guardado neste aparelho e vai sozinho quando a internet voltar.',
    };
  }
  switch (project) {
    case null: return { tone: 'ok', text: 'Salvo na sua conta.' };
    case 'saved': return { tone: 'ok', text: 'Salvo. O projeto foi gravado no Mac do diretor.' };
    case 'later': return { tone: 'ok', text: 'Salvo no Mac do diretor. O arquivo do projeto é gravado assim que a música parar.' };
    case 'no_file':
      return { tone: 'warn', text: 'Seu caderno está guardado no Mac do diretor, mas o projeto ainda não tem arquivo. Peça ao diretor para salvar o projeto uma vez.' };
    case 'unavailable':
      return { tone: 'warn', text: 'Seu caderno está guardado no Mac do diretor. Para ir para o arquivo do projeto, o diretor precisa salvar.' };
    default:
      return { tone: 'warn', text: 'Seu caderno chegou ao Mac do diretor, mas o arquivo do projeto não foi gravado. Aperte Salvar de novo ou peça ao diretor para salvar.' };
  }
}
