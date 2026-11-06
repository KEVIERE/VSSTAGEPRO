// Pele dos e-mails: a mesma mesa de som do programa e do site, em HTML que cliente de
// e-mail entende.
//
// O que muda em relação ao que havia antes: a paleta neutra de app escuro (cinza puro,
// verde #30d158, canto de 16px) dá lugar à paleta da mesa — aço pintado em grafite
// azulado, serigrafia creme, âmbar e verde de LCD, cantos de equipamento. Quem recebe o
// e-mail reconhece o programa que já viu no site.
//
// Limite de cliente de e-mail: Gmail e Outlook ignoram folha de estilo no <head>, sombra em
// <div> e `background-image` em vários casos. Só o que está em style="" na própria tag (ou
// em tabela, para largura) sobrevive. Por isso tudo aqui é tabela + atributo.

/** Paleta, espelhando tailwind.config.js (logic.*). Um lugar só para mudar. */
export const SKIN = {
  chao: '#111316',        // logic-bg-deep: fundo de fora do painel
  painel: '#24282d',      // logic-bg-panel: aço pintado
  painelAlto: '#2d3238',  // logic-bg-panel-light
  borda: '#3b4148',       // logic-border
  bordaClara: '#4b525a',  // logic-border-light
  bordaEscura: '#0b0d0f', // logic-border-dark
  creme: '#e7e2d6',       // logic-text: serigrafia creme
  cremeFraco: '#a7a297',  // logic-text-dim
  cremeMudo: '#6f6c66',   // logic-text-muted
  ambar: '#ffab1f',       // logic-lcd-amber
  verde: '#3ee26e',       // logic-lcd-green
  vermelho: '#ff4136',    // logic-lcd-red
  vidro: '#0c0e0d',       // logic-lcd-bg
  vidroTexto: '#d8d3c6',  // logic-lcd-text
} as const;

/** Largura da coluna do e-mail. Estreita de propósito: é a largura de painel de equipamento. */
const LARGURA = 480;

/**
 * Barra de "trilho" no topo: a mesma ideia da canaleta que abre a tela do mixer, um
 * gradiente âmbar→verde. Vai como tabela com duas células porque gradiente em uma célula
 * não aparece no Outlook.
 */
function trilho(): string {
  return `<tr><td style="padding:0;height:3px;line-height:3px;font-size:0;background-color:${SKIN.ambar};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="52%" style="height:3px;line-height:3px;font-size:0;background-color:${SKIN.ambar};"></td>
      <td width="48%" style="height:3px;line-height:3px;font-size:0;background-color:${SKIN.verde};"></td>
    </tr></table>
  </td></tr>`;
}

/**
 * Cabeçalho: a plaquinha de identificação da mesa.
 *
 * A logo aparece num rebaixo (como o visor do programa): moldura escura, borda interna
 * clara, canto pequeno de equipamento. O nome vem em serigrafia creme com o espaçamento
 * aberto de rótulo impresso, e embaixo a lâmpada verde de "pronto", que é o que o operador
 * procura na mesa.
 */
export function cabecalho(opts: { rotulo?: string } = {}): string {
  const rotulo = opts.rotulo ?? 'VS STAGE PRO';
  return `<tr>
    <td style="padding:26px 28px 20px;background-color:${SKIN.painelAlto};border-bottom:1px solid ${SKIN.bordaEscura};" align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
        <tr>
          <td align="center" style="padding:5px;border-radius:7px;background-color:${SKIN.chao};border:1px solid ${SKIN.bordaEscura};">
            <img src="https://vsstagepro.com.br/email-logo.png" alt="VS Stage Pro" width="52" height="52"
                 style="display:block;border-radius:4px;border:1px solid ${SKIN.borda};" />
          </td>
        </tr>
      </table>
      <div style="margin:14px 0 0;font-family:'Barlow Semi Condensed',Inter,-apple-system,Segoe UI,Roboto,sans-serif;
                  font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${SKIN.creme};">
        ${rotulo}
      </div>
      <div style="margin:7px 0 0;">
        <span style="display:inline-block;width:7px;height:7px;border-radius:9999px;background-color:${SKIN.verde};"></span>
        <span style="font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;font-size:10px;letter-spacing:.1em;
                     text-transform:uppercase;color:${SKIN.cremeMudo};font-weight:600;">&nbsp;no ar</span>
      </div>
    </td>
  </tr>`;
}

/**
 * Envolve o conteúdo na moldura do e-mail: chão escuro, painel de aço, trilho no topo e
 * cabeçalho. `conteudo` é o miolo (título, texto, botão), já em HTML.
 */
export function moldura(conteudo: string, opts: { rodape?: string; rotulo?: string } = {}): string {
  const rodape = opts.rodape
    ? `<tr><td style="padding:16px 28px 22px;background-color:${SKIN.painel};border-top:1px solid ${SKIN.bordaEscura};"
             align="center">${opts.rodape}</td></tr>`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" />
</head>
<body style="margin:0;padding:0;background-color:${SKIN.chao};">
<div style="background-color:${SKIN.chao};padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${LARGURA}"
             style="width:100%;max-width:${LARGURA}px;background-color:${SKIN.painel};border:1px solid ${SKIN.bordaEscura};
                    border-top:1px solid ${SKIN.bordaClara};border-radius:6px;overflow:hidden;">
        ${trilho()}
        ${cabecalho({ rotulo: opts.rotulo })}
        <tr><td style="padding:26px 28px 8px;background-color:${SKIN.painel};" align="center">
          ${conteudo}
        </td></tr>
        ${rodape}
      </table>
      <div style="max-width:${LARGURA}px;margin:0 auto;padding:14px 8px 0;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;
                  font-size:10px;line-height:1.6;color:${SKIN.cremeMudo};text-align:center;">
        VS Stage Pro · o primeiro motor de áudio construído específico para teatro
      </div>
    </td></tr>
  </table>
</div>
</body></html>`;
}

/** Título do miolo: creme, com o peso de serigrafia. */
export function titulo(texto: string): string {
  return `<h1 style="margin:0 0 10px;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;font-size:20px;
                     line-height:1.3;color:${SKIN.creme};font-weight:600;letter-spacing:-.01em;">${texto}</h1>`;
}

/** Parágrafo de texto corrido. */
export function paragrafo(html: string, opts: { espaco?: number } = {}): string {
  return `<p style="margin:0 0 ${opts.espaco ?? 16}px;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;
                      font-size:14px;line-height:1.65;color:${SKIN.cremeFraco};">${html}</p>`;
}

/**
 * Botão principal: tecla de aço com o rótulo em creme, não um retângulo verde chapado.
 * Usa borda âmbar para dar o mesmo destaque que o accent tem na tela.
 */
export function botao(texto: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:4px auto 22px;">
    <tr><td align="center" style="border-radius:5px;background-color:${SKIN.ambar};border:1px solid #c8850f;">
      <a href="${url}" style="display:inline-block;padding:12px 30px;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;
                              font-size:14px;font-weight:700;color:#1a1204;text-decoration:none;letter-spacing:.01em;">${texto}</a>
    </td></tr>
  </table>`;
}

/**
 * Visor: caixa preta funda onde vai o código, o link ou um dado que a pessoa precisa ler
 * e copiar. É o mesmo rebaixo do LCD do programa.
 */
export function visor(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
    <tr><td style="padding:12px 14px;background-color:${SKIN.vidro};border:1px solid #000;border-radius:4px;
                   font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;
                   color:${SKIN.vidroTexto};word-break:break-all;text-align:center;">${html}</td></tr>
  </table>`;
}

/** Aviso secundário: nota de rodapé do miolo, sem competir com o texto principal. */
export function nota(html: string): string {
  return `<p style="margin:0 0 16px;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;
                    line-height:1.6;color:${SKIN.cremeMudo};">${html}</p>`;
}
