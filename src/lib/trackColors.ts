// Cor das faixas: elas nascem neutras, todas no mesmo cinza. As cores de fábrica antigas (azul
// das guias, verde da banda) valem como "sem cor escolhida" em projetos antigos; a cor que o
// usuário escolher no menu da faixa continua valendo.

export const NEUTRAL_TRACK_COLOR = '#8e9097';
export const FACTORY_TRACK_COLORS = new Set(['#5b8db8', '#5bb87a', NEUTRAL_TRACK_COLOR]);

export function isFactoryTrackColor(color: string | undefined | null): boolean {
  return !color || FACTORY_TRACK_COLORS.has(color.trim().toLowerCase());
}

/** A cor de mostrar: as de fábrica viram o cinza neutro; a escolhida pelo usuário fica. */
export function shownTrackColor(color: string | undefined | null): string {
  return isFactoryTrackColor(color) ? NEUTRAL_TRACK_COLOR : (color as string);
}
