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
