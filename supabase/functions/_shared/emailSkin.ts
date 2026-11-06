// Pele dos e-mails do VS Stage Pro.
//
// O que este arquivo garante:
//  - a marca aparece uma vez, sozinha, sem moldura (a arte já é um squircle);
//  - a cor do acento diz o tipo de mensagem, e nunca é decoração: âmbar para o que exige
//    uma ação sensível (redefinir senha), verde para confirmação, azul para link de acesso;
//  - hierarquia tipográfica de verdade: 18 para o título, 14 para o corpo, 12 para apoio,
//    num ritmo de 8px — nada de tudo no mesmo corpo mudando só a cor;
//  - monoespaçada só no endereço para copiar, que é código e precisa alinhar caractere.
//
// O que foi tirado em revisões anteriores: barra colorida no topo (decoração imitando
// gradiente), nome escrito sob a logo (repetia a arte), lâmpada "no ar" (não informava) e a
// linha divisória entre topo e corpo (separava o que não precisava).
//
// Limite real de cliente de e-mail: Gmail e Outlook descartam folha de estilo no <head>,
// webfont e sombra em <div>. Sobrevive o que está em style="" na tag, e largura exige
// tabela. Por isso a fonte é Inter com queda para a do sistema — uma webfont não chegaria
// ao Gmail.

export type Tipo = 'acao' | 'confirmacao' | 'acesso';

/** Paleta, espelhando tailwind.config.js (logic.*). Um lugar só para mudar. */
export const SKIN = {
  fundo: '#111316',        // logic-bg-deep
  painel: '#1b1e22',       // logic-bg: aço pintado, o corpo do e-mail
  topo: '#20242a',         // faixa da marca, um degrau acima do painel
  gravado: '#0b0d0f',      // logic-border-dark
  creme: '#e7e2d6',        // logic-text: serigrafia
  cremeFraco: '#a7a297',   // logic-text-dim
  cremeMudo: '#6f6c66',    // logic-text-muted
  vidro: '#0c0e0d',        // logic-lcd-bg
  vidroTexto: '#d8d3c6',   // logic-lcd-text
  /** Acento por natureza da mensagem: a cor carrega informação. */
  acento: {
    acao: '#ffab1f',         // âmbar: exige ação
    confirmacao: '#3ee26e',  // verde: confirma algo
    acesso: '#5b8db8',       // azul: acesso direto
  },
  acentoEscuro: {
    acao: '#c8850f',
    confirmacao: '#27a851',
    acesso: '#3f6d93',
  },
  /** Texto sobre a tecla: escuro, porque o fundo dela é claro. */
  sobreAcento: {
    acao: '#1a1204',
    confirmacao: '#04180a',
    acesso: '#f2f6fa',
  },
} as const;

const LARGURA = 480;
const SANS = 'Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

/**
 * Faixa vertical na borda esquerda, na cor do tipo de mensagem: a pessoa reconhece o assunto
 * antes de ler. É célula de tabela, não border-left, porque borda colorida com largura fixa
 * não é confiável em vários clientes.
 */
function faixa(tipo: Tipo): string {
  return `<td width="3" style="width:3px;background-color:${SKIN.acento[tipo]};font-size:0;line-height:0;">&nbsp;</td>`;
}

/**
 * O topo: uma imagem só, com o console do programa e a marca fundida nela.
 *
 * Antes eram duas coisas: logo em HTML e nome em HTML. Virou uma imagem porque é assim que
 * o e-mail fica profissional no tamanho real — a captura do mixer dá contexto ao produto em
 * vez de só identificar o remetente, e a marca fica sobre ela, sem ocupar altura extra.
 *
 * A imagem é gerada por script a partir de `public/site/mixer.jpg` e `public/email-logo.png`
 * (ver `scripts/gerar-topo-email.mjs`), servida pelo site e hospedada em 960px de largura.
 */
function topo(): string {
  return `<tr>
    <td colspan="2" style="padding:0;background-color:${SKIN.painel};font-size:0;line-height:0;" align="center">
      <img src="https://vsstagepro.com.br/email-topo.jpg" alt="VS Stage Pro — console com as faixas do show"
           width="960" height="360"
           style="display:block;width:100%;max-width:960px;height:auto;border:0;" />
    </td>
  </tr>`;
}

/**
 * Monta o e-mail. `conteudo` é o miolo já em HTML; `tipo` escolhe o acento; `rodape` é a
 * linha de apoio embaixo, separada por uma linha gravada.
 */
export function moldura(
  conteudo: string,
  opts: { tipo?: Tipo; rodape?: string } = {},
): string {
  const tipo = opts.tipo ?? 'acao';
  const rodape = opts.rodape
    ? `<tr>
        <td colspan="2" style="padding:0;background-color:${SKIN.painel};" height="1">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="height:1px;line-height:1px;font-size:0;background-color:${SKIN.gravado};"></td>
          </tr></table>
        </td>
      </tr>
      <tr>
        ${faixa(tipo)}
        <td style="padding:18px 26px 22px;background-color:${SKIN.painel};" align="left">
          <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${SKIN.cremeMudo};">${opts.rodape}</p>
        </td>
      </tr>`
    : '';

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<meta name="format-detection" content="telephone=no" />
</head>
<body style="margin:0;padding:0;background-color:${SKIN.fundo};">
<div style="background-color:${SKIN.fundo};padding:26px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${LARGURA}"
             style="width:100%;max-width:${LARGURA}px;background-color:${SKIN.painel};border:1px solid ${SKIN.gravado};border-radius:5px;overflow:hidden;">
        ${topo()}
        <tr>
          ${faixa(tipo)}
          <td style="padding:26px 26px 4px;background-color:${SKIN.painel};" align="left">
            ${conteudo}
          </td>
        </tr>
        ${rodape}
      </table>
    </td></tr>
  </table>
</div>
</body></html>`;
}

/** Título: o maior corpo do e-mail, creme cheio, sem caixa alta. */
export function titulo(texto: string): string {
  return `<h1 style="margin:0 0 10px;font-family:${SANS};font-size:18px;line-height:1.35;
                     color:${SKIN.creme};font-weight:600;">${texto}</h1>`;
}

/** Texto corrido, com linha curta — a largura que o painel permite. */
export function paragrafo(html: string, opts: { espaco?: number } = {}): string {
  return `<p style="margin:0 0 ${opts.espaco ?? 18}px;font-family:${SANS};font-size:14px;
                      line-height:1.62;color:${SKIN.cremeFraco};">${html}</p>`;
}

/**
 * A tecla: única ação do e-mail. Altura de 44px (alvo de toque confortável), canto de 4px e
 * borda inferior mais escura, que dá relevo sem depender de gradiente.
 * O rótulo diz o que acontece ao clicar, no mesmo verbo do título.
 */
export function botao(texto: string, url: string, tipo: Tipo = 'acao'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 20px;">
    <tr><td align="center" style="border-radius:4px;background-color:${SKIN.acento[tipo]};border:1px solid ${SKIN.acentoEscuro[tipo]};border-bottom-width:2px;">
      <a href="${url}" style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:14px;
                              font-weight:600;color:${SKIN.sobreAcento[tipo]};text-decoration:none;">${texto}</a>
    </td></tr>
  </table>`;
}

/**
 * O endereço para copiar, para quem preferir não clicar. Monoespaçada porque é código, não
 * texto: dentro do visor os caracteres precisam ter a mesma largura para dar para conferir
 * o que se copiou.
 */
export function linkParaCopiar(url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
    <tr><td style="padding:10px 12px;background-color:${SKIN.vidro};border:1px solid #000;border-radius:3px;
                   font-family:${MONO};font-size:11px;line-height:1.6;
                   color:${SKIN.vidroTexto};word-break:break-all;">
      <span style="color:${SKIN.cremeMudo};font-family:${SANS};font-size:11px;">Se o botão não abrir, copie este endereço:</span><br />${url}
    </td></tr>
  </table>`;
}

/** Linha de apoio embaixo da ação, com o mesmo peso em todo e-mail. */
export function apoio(html: string): string {
  return `<p style="margin:0 0 18px;font-family:${SANS};font-size:12px;line-height:1.6;
                    color:${SKIN.cremeMudo};">${html}</p>`;
}
