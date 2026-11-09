/**
 * Valor pequeno aceso num display, com o nome impresso ao lado (ex.: "Tom G", "BPM 128").
 * Some quando não há valor. Usado nos displays do Modo Show e da Área do Músico.
 */
export default function MetaReadout({ label, value, tone = 'text-logic-lcd-text' }: {
  label: string;
  value: string;
  tone?: string;
}) {
  if (!value) return null;
  return (
    <span className="flex items-baseline gap-1 min-w-0">
      <span className="console-legend !text-[10px]">{label}</span>
      <span className={`console-glow font-stage font-semibold text-[15px] leading-none tabular-nums truncate ${tone}`}>{value}</span>
    </span>
  );
}
