// Pele dos e-mails: o painel frontal de um equipamento da linha VS Stage.
//
// O que este arquivo desenha não é "um cartão escuro com um botão". É a frente de um
// aparelho: marca centralizada no topo, linha gravada separando as seções, texto alinhado
// à esquerda como legenda serigrafada, e uma única tecla âmbar, a ação.
//
// Regras que valem aqui (e que já custaram desenhos anteriores):
//  - a logo aparece sozinha; um rebaixo em volta dela fazia parecer ícone dentro de ícone,
//    porque a própria arte já é um squircle;
//  - nada de barra colorida no topo: não existe na frente de nenhum equipamento;
//  - nada de nome escrito embaixo da logo nem de frase de efeito: a arte já identifica;
//  - o miolo fica à esquerda (legenda de painel); só a marca fica centralizada;
//  - verde só diz estado, nunca decora.
//
// Limite de cliente de e-mail: Gmail e Outlook ignoram folha de estilo no <head>, sombra em
// <div> e parte dos gradientes. Só sobrevive o que está em style="" na própria tag, e a
// largura precisa de tabela. Por isso tudo aqui é tabela e atributo.

/** Paleta, espelhando tailwind.config.js (logic.*). Um lugar só para mudar. */
export const SKIN = {
  fundo: '#111316',        // logic-bg-deep: fora do painel
  painel: '#1b1e22',       // logic-bg: aço pintado, o corpo do e-mail
  painelAlto: '#24282d',   // logic-bg-panel: faixa da plaquinha e rodapé
  gravado: '#0b0d0f',      // logic-border-dark: linha gravada entre seções
  borda: '#3b4148',        // logic-border
  creme: '#e7e2d6',        // logic-text: serigrafia
  cremeFraco: '#a7a297',   // logic-text-dim: texto corrido
  cremeMudo: '#6f6c66',    // logic-text-muted: nota de rodapé
  ambar: '#ffab1f',        // logic-lcd-amber: a tecla e o destaque
  ambarEscuro: '#c8850f',  // sombra da tecla
  verde: '#3ee26e',        // logic-lcd-green: só estado
  vidro: '#0c0e0d',        // logic-lcd-bg: o visor
  vidroTexto: '#d8d3c6',   // logic-lcd-text
} as const;

const LARGURA = 480;
const SANS = 'Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

/** Linha gravada: separa seções como o sulco entre blocos de um painel. */
export function regua(): string {
  return `<tr><td style="padding:0;background-color:${SKIN.painel};" height="1">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="height:1px;line-height:1px;font-size:0;background-color:${SKIN.gravado};"></td>
    </tr></table>
  </td></tr>`;
}

/**
 * Plaquinha: a marca centralizada, so a logo.
 *
 * Sem nome escrito e sem a linha de modelo: a arte ja identifica o programa, e repetir o
 * nome embaixo dela so ocupava espaco. Centralizada porque e o unico elemento do topo.
 */
export function plaquinha(): string {
  return `<tr>
    <td style="padding:30px 28px 22px;background-color:${SKIN.painelAlto};" align="center">
      <img src="https://vsstagepro.com.br/email-logo.png" alt="VS Stage Pro" width="60" height="60"
           style="display:block;margin:0 auto;" />
    </td>
  </tr>`;
}

/**
 * Envolve o conteúdo na frente do aparelho: plaquinha, linha gravada, miolo, rodapé.
 */
export function moldura(conteudo: string, opts: { rodape?: string } = {}): string {
  const rodape = opts.rodape
    ? `${regua()}
        <tr><td style="padding:16px 28px 20px;background-color:${SKIN.painelAlto};" align="left">${opts.rodape}</td></tr>`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" />
</head>
<body style="margin:0;padding:0;background-color:${SKIN.fundo};">
<div style="background-color:${SKIN.fundo};padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${LARGURA}"
             style="width:100%;max-width:${LARGURA}px;background-color:${SKIN.painel};
                    border:1px solid ${SKIN.gravado};border-radius:4px;overflow:hidden;">
        ${plaquinha()}
        ${regua()}
        <tr><td style="padding:24px 28px 6px;background-color:${SKIN.painel};" align="left">
          ${conteudo}
        </td></tr>
        ${rodape}
      </table>
    </td></tr>
  </table>
</div>
</body></html>`;
}

/** Título do miolo: creme cheio, sem caixa alta e sem espaçamento de enfeite. */
export function titulo(texto: string): string {
  return `<h1 style="margin:0 0 12px;font-family:${SANS};font-size:19px;line-height:1.35;
                     color:${SKIN.creme};font-weight:600;">${texto}</h1>`;
}

/** Parágrafo de texto corrido, alinhado à esquerda. */
export function paragrafo(html: string, opts: { espaco?: number } = {}): string {
  return `<p style="margin:0 0 ${opts.espaco ?? 16}px;font-family:${SANS};font-size:14px;
                      line-height:1.65;color:${SKIN.cremeFraco};">${html}</p>`;
}

/**
 * A tecla: a única ação do e-mail, em âmbar, alinhada à esquerda como o resto do painel.
 * Fundo chapado e borda inferior mais escura dão a impressão de tecla pressionável sem
 * depender de gradiente, que o Outlook descarta.
 */
export function botao(texto: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;">
    <tr><td align="center" style="border-radius:4px;background-color:${SKIN.ambar};border:1px solid ${SKIN.ambarEscuro};border-bottom-width:2px;">
      <a href="${url}" style="display:inline-block;padding:11px 26px;font-family:${SANS};font-size:14px;
                              font-weight:700;color:#1a1204;text-decoration:none;">${texto}</a>
    </td></tr>
  </table>`;
}

/**
 * Visor: o rebaixo do LCD onde fica um dado que a pessoa precisa ler e copiar (o link, um
 * código). Fonte monoespaçada porque dentro de um visor de verdade o que aparece é número e
 * caractere de largura fixa.
 */
export function visor(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
    <tr><td style="padding:11px 12px;background-color:${SKIN.vidro};border:1px solid #000;border-radius:3px;
                   font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;
                   color:${SKIN.vidroTexto};word-break:break-all;">${html}</td></tr>
  </table>`;
}

/** Legenda de campo: a etiqueta pequena impressa acima de um dado do painel. */
export function legenda(texto: string): string {
  return `<p style="margin:0 0 6px;font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:.06em;
                    color:${SKIN.cremeMudo};">${texto}</p>`;
}

/** Nota secundária do miolo, sem competir com o texto principal. */
export function nota(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:12px;line-height:1.6;
                    color:${SKIN.cremeMudo};">${html}</p>`;
}
