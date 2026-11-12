import { useSyncExternalStore } from 'react';
import { currentSkin, subscribeSkin, type SkinId } from './skins';

/** A skin vestida agora; a tela redesenha quando o usuário troca em Visualizar > Skins. */
export function useSkin(): SkinId {
  return useSyncExternalStore(subscribeSkin, currentSkin);
}
