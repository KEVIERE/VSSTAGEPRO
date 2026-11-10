// Formatação da tela do PIX (sem dependências, testada em tests/pix.test.mjs).
// A conferência dos dígitos do CPF/CNPJ é feita no servidor (pix-checkout).

/** 000.000.000-00 até 11 dígitos; 00.000.000/0000-00 com 12 a 14 dígitos. */
export function maskCpfCnpj(value: string): string {
  const d = value.replace(/\D+/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export const cpfCnpjDigits = (value: string) => value.replace(/\D+/g, '').length;

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const BRASILIA = 'America/Sao_Paulo';

/** "11/11, 00:20": dia e hora no horário de Brasília, seja qual for o fuso do computador. */
export function formatBrasiliaDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: BRASILIA,
  });
}

/** "11/12/2026" no horário de Brasília. */
export function formatBrasiliaDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: BRASILIA });
}

/** Tempo que falta, em "mm:ss" (ou "h:mm:ss" acima de 1 hora). Nunca negativo. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}
