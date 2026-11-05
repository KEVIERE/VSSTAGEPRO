// As capturas REAIS do programa, usadas dentro do vídeo com movimento de câmera.
// Nada aqui redesenha a interface: o vídeo mostra a tela de verdade, enquadrada e com pan.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';

export const RAIZ = '/Users/jonatha/Documents/VS STAGE PROJECT';
export const NOVAS = RAIZ + '/capturas-site-novo/atualizadas-03-11/';
export const SITE = RAIZ + '/capturas-site-novo/';
export const PROG = RAIZ + '/capturas-programa-entrada/';

// Apelidos legíveis para as capturas que o vídeo usa.
export const CAPTURAS = {
  abertura: NOVAS + '1-primeira-tela-computador.png',
  aparelhos: NOVAS + '2-aparelhos.png',
  modoShow: NOVAS + '3-modo-show.png',
  celular: NOVAS + '4-celular.png',
  teleprompter: NOVAS + '5-teleprompter.png',
  blocos: NOVAS + '6-nomes-dos-blocos.png',
  ferramentas: SITE + 'depois-20-ferramentas.png',
  ia: SITE + 'depois-ia.png',
  maestro: SITE + 'depois-maestro-ia.png',
  mixer: SITE + 'depois-mixer-timecode-master.png',
  tv: SITE + 'depois-tv.png',
  entrada: PROG + '1-entrar-e-criar-conta.png',
  boasVindas: PROG + '2-boas-vindas.png',
};

const fontes = new Map();

/**
 * A captura, já carregada e guardada em memória. Devolve { buf, w, h } com as dimensões reais.
 */
export async function captura(nome) {
  const arq = CAPTURAS[nome] || nome;
  if (fontes.has(arq)) return fontes.get(arq);
  const buf = await sharp(arq).png().toBuffer();
  const meta = await sharp(buf).metadata();
  const item = { buf, w: meta.width, h: meta.height };
  fontes.set(arq, item);
  return item;
}

/**
 * Enquadra um pedaço da captura e devolve no tamanho pedido.
 *
 * `janela` é o retângulo em fração da imagem (0 a 1): { fx, fy, fw, fh }.
 * Serve para o movimento de câmera (pan e zoom), que é só variar a janela por quadro.
 * O recorte nunca sai da imagem: é ajustado para caber.
 */
export async function enquadrar(nome, { fx = 0, fy = 0, fw = 1, fh = 1 }, largura, altura) {
  const { buf, w, h } = await captura(nome);

  const fw2 = Math.min(1, Math.max(0.05, fw));
  const fh2 = Math.min(1, Math.max(0.05, fh));
  // respeita a proporção do destino: a janela tem que ter a mesma razão de aspecto
  const razaoDestino = largura / altura;
  let jw = fw2 * w;
  let jh = fh2 * h;
  if (jw / jh > razaoDestino) jw = jh * razaoDestino;
  else jh = jw / razaoDestino;

  // O recorte precisa caber inteiro na imagem: se a janela for maior que ela, diminui.
  if (jw > w) {
    jw = w;
    jh = jw / razaoDestino;
  }
  if (jh > h) {
    jh = h;
    jw = jh * razaoDestino;
  }
  // e nunca pode ser menor que 1 pixel
  jw = Math.max(1, Math.min(w, jw));
  jh = Math.max(1, Math.min(h, jh));

  const maxX = Math.max(0, w - jw);
  const maxY = Math.max(0, h - jh);
  let x = fx * w;
  let y = fy * h;
  // centraliza a janela em torno do ponto pedido, sem sair da imagem
  x = Math.min(maxX, Math.max(0, x - jw / 2));
  y = Math.min(maxY, Math.max(0, y - jh / 2));

  const left = Math.min(w - 1, Math.max(0, Math.round(x)));
  const top = Math.min(h - 1, Math.max(0, Math.round(y)));
  const larg = Math.min(w - left, Math.max(1, Math.round(jw)));
  const alt = Math.min(h - top, Math.max(1, Math.round(jh)));

  return sharp(buf)
    .extract({ left, top, width: larg, height: alt })
    .resize(Math.round(largura), Math.round(altura), { fit: 'fill' })
    .png()
    .toBuffer();
}

/** A captura inteira, ajustada no tamanho pedido (sem cortar). */
export async function inteira(nome, largura, altura) {
  const { buf } = await captura(nome);
  return sharp(buf).resize(Math.round(largura), Math.round(altura), { fit: 'inside' }).png().toBuffer();
}
