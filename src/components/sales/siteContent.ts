// Textos do site de vendas, separados do layout para ficar fácil de revisar e trocar.
// Preços: os mesmos de PricingPage.tsx (se mudar lá, mude aqui também).

export const PRICES = {
  monthly: 'R$ 55',
  yearly: 'R$ 349',
  yearlyPerMonth: 'R$ 29,08',
  yearlySavings: 'R$ 311',
};

import type { ToolViz } from './ToolVisuals';

export type Highlight = { title: string; text: string; img: string; alt: string; phone?: boolean; position?: string };

export const HIGHLIGHTS: Highlight[] = [
  {
    title: 'A IA monta o seu VS enquanto você toma um café.',
    text: 'Separa os instrumentos, acerta o BPM, cria o click e deixa tudo na grade, sincronizado.',
    img: '/site/timeline.jpg?v=3', alt: 'Linha do tempo com as faixas separadas e as partes da música marcadas', position: 'left top',
  },
  {
    title: 'Displays de LED que se leem do fundo do palco.',
    text: 'O tempo que falta, o que toca agora e o que vem depois, sem forçar a vista.',
    img: '/site/show-painel.jpg?v=3', alt: 'Display de LED verde mostrando o tempo que falta da música',
  },
  {
    title: 'A partitura de cada músico, no celular dele.',
    text: 'Troca sozinha a cada música. Ninguém mais folheia papel no meio da música.',
    img: '/site/iphone-palco.jpg?v=3', alt: 'Celular com a Área do Músico mostrando a partitura da música no ar', phone: true,
  },
  {
    title: 'A letra na TV, um instante antes de cantar.',
    text: 'Com os mesmos displays do programa, a playlist do show e avisos ao vivo.',
    img: '/site/tv.jpg?v=3', alt: 'Teleprompter na TV com a letra e a playlist do show',
  },
  {
    title: 'Uma mesa de som de verdade, dentro do seu Mac.',
    text: 'Medidores em dB, anti-clip em cada canal e a IA igualando o volume dos VS.',
    img: '/site/mixer.jpg?v=3', alt: 'Mixer com faders, medidores e o master', position: 'left center',
  },
  {
    title: 'Sem internet? O show continua.',
    text: 'Computador, celulares, tablets e TV conversam pelo Wi-Fi do palco, sem depender de sinal.',
    img: '/site/iphone-lista.jpg?v=3', alt: 'Celular com a playlist do show na Área do Músico', phone: true,
  },
];

export const MANIFESTO =
  'Todo diretor musical conhece o silêncio antes do primeiro acorde. O VS Stage Pro nasceu para esse instante: números que se leem de longe, botões que não traem e um motor de áudio que segura o show do primeiro click ao último aplauso, com a casa cheia e a banda inteira confiando em você.';

export type ShowStep = { title: string; text: string; focus: { x: number; y: number; scale: number } };

// focus: ponto da foto do Modo Show (0 a 1) que a câmera aproxima em cada passo
export const SHOW_STEPS: ShowStep[] = [
  {
    title: 'Todo o show em uma única tela.',
    text: 'Blocos coloridos, tom, BPM e a hora exata em que cada música entra. Precisa repetir o refrão ou pular a ponte? Um toque na parte da música, sem parar o som.',
    focus: { x: 0.5, y: 0.5, scale: 1 },
  },
  {
    title: 'Tocando e Próxima, sempre à vista.',
    text: 'Dois displays mostram a música no ar e a seguinte, com tom e BPM. A banda sabe o que vem antes mesmo de você avisar.',
    focus: { x: 0.863, y: 0.72, scale: 2.2 },
  },
  {
    title: 'Um relógio que se lê do fundo do palco.',
    text: 'O display de LED gigante conta quanto falta para a música acabar. Logo abaixo, a duração do show e o tempo que ainda resta: nada de estourar o horário.',
    focus: { x: 0.863, y: 0.552, scale: 2.3 },
  },
  {
    title: 'Três jeitos de conduzir. E uma trava.',
    text: 'Contínuo emenda uma música na outra. Por bloco para no fim de cada bloco. Uma a uma espera o seu comando. E a trava de segurança impede que um toque sem querer pare o show.',
    focus: { x: 0.863, y: 0.2, scale: 2.1 },
  },
];

export const NUMBERS = [
  { value: 48, label: 'horas de teste completo, sem cartão', color: 'amber' as const },
  { value: 1, label: 'timeline exclusiva para cada música do show', color: 'green' as const },
  { value: 3, label: 'jeitos de conduzir: contínuo, por bloco ou uma a uma', color: 'green' as const },
  { value: 0, label: 'internet necessária para o show acontecer', color: 'amber' as const },
];

export const AI_STEPS = [
  'Escolha o arquivo da música pronta, em MP3 ou WAV.',
  'A IA separa os instrumentos, mede o BPM e cria o click.',
  'O VS entra na playlist sincronizado, com cada faixa no fader certo.',
];

// Faixas do VS criado pela IA. O dono pediu esta ordem sempre que o site falar do VS com IA:
// voz, click, bateria, baixo, guitarra/violão, teclado e outros.
export const STEMS = [
  { name: 'Voz', color: '#e7e2d6', kind: 'voz' },
  { name: 'Click', color: '#3ee26e', kind: 'click' },
  { name: 'Bateria', color: '#ff7a59', kind: 'bateria' },
  { name: 'Baixo', color: '#ffab1f', kind: 'baixo' },
  { name: 'Guitarra/Violão', color: '#64d2ff', kind: 'guitarra' },
  { name: 'Teclado', color: '#b79cff', kind: 'teclado' },
  { name: 'Outros', color: '#a7a297', kind: 'outros' },
] as const;

export const TIMELINE_POINTS = [
  { title: 'Uma timeline por música', text: 'Chega de projetos imensos em que você não enxerga o fim. Cada música tem a sua, e a troca é instantânea.' },
  { title: 'Medley com marcadores', text: 'Separe o medley com um clique e escolha, marcador por marcador, quais músicas entram, com as passagens no tempo certo.' },
  { title: 'Andamento e tom na hora', text: 'Suba o BPM sem mudar o tom, ou mude o tom para o cantor sem mudar a velocidade. A IA já mostra o tom e o BPM de cada música.' },
];

export const MIXER_POINTS = [
  { title: 'Anti-clip em tempo real', text: 'Funciona como um limitador em cada canal: ligado, a faixa não passa de −0,1 dBFS, nem no pico mais forte. Adeus ao estalo no PA.' },
  { title: 'LR mágico', text: 'Um clique e o show vira LR: click, maestro e guia no L, o resto da banda no R. Outro clique desfaz.' },
  { title: 'Saídas da placa em pares estéreo', text: 'Click e guia só no fone da banda, a banda no PA: cada faixa vai para o par de saídas que você escolher.' },
  { title: 'Masterização com IA', text: 'Um botão trata o som da música e deixa tudo pronto para o PA.' },
  { title: 'VU e loudness no master', text: 'Dois VUs de ponteiro e a medida em LUFS mostram o volume que o público ouve, não só o pico.' },
  { title: 'Cara de equipamento', text: 'Escolha a skin do programa: Analógica, Grafite, Estúdio ou Oficina. O show inteiro muda de cara.' },
];

// Pads ao vivo no Modo Show (seção própria, com a foto public/site/pads.jpg).
export const PADS_POINTS = [
  { title: '90 pads prontos', text: '9 pads em 10 bancos, de A a J. Cada pad toca com o mouse ou pelas teclas 1 a 9.' },
  { title: 'Efeitos em cada pad', text: 'Reverb, delay, reverso, loop, roll no tempo da música, pitch e filtro, sem plugin nenhum.' },
  { title: 'Do jeito do show', text: 'Um por vez, segurar para tocar, fade e stop geral. Corta o silêncio do começo sozinho.' },
  { title: 'Saída própria', text: 'Mande os pads para o master ou para outra saída da placa, com volume e medidor só deles.' },
];

export const SPOTS = [
  {
    title: 'Uma faixa só para o timecode',
    text: 'O timecode LTC ganhou faixa, fader e saída próprios, com trava para ninguém mexer sem querer. A mesa de luz e os painéis de LED seguem cada música do começo ao fim, sem o sinal vazar no som principal.',
    img: '/site/fader-timecode.jpg?v=4', w: 240, h: 804, glow: 'rgba(255,171,31,0.35)',
    alt: 'Fader de timecode LTC do VS Stage, com a capa âmbar e a trava ligada',
  },
  {
    title: 'Master com IA que iguala os VS',
    text: 'Um toque no IGUALAR e a IA analisa todos os VS do projeto: as músicas mais baixas sobem, as mais altas descem, e o show inteiro soa por igual. Nada de correr para o fader a cada música.',
    img: '/site/fader-master.jpg?v=4', w: 216, h: 804, glow: 'rgba(255,65,54,0.3)',
    alt: 'Fader master do VS Stage, com a capa vermelha e o botão IGUALAR',
  },
];

export const BAND_POINTS = [
  { title: 'Caderno completo', text: 'Cifra, pincel, marca-texto e borracha. Cole a cifra de um site e ela já fica organizada, com qualquer acorde e baixo invertido.' },
  { title: 'Foto do caderno', text: 'Fotografe a partitura ou a cifra de papel e ela aparece em tela cheia na hora do show.' },
  { title: 'Medley organizado', text: 'Cada parte do medley tem o próprio caderno, que entra sozinho na hora certa.' },
  { title: 'Entrada fácil', text: 'O músico entra pelo QR code ou pelo link, com um código só dele.' },
  { title: 'Rola sozinha', text: 'No Modo show a cifra desce sozinha na velocidade que o músico escolher, com zoom e página inteira.' },
];

export const TV_POINTS = [
  { title: 'Avisos ao vivo', text: 'Mande "mais uma vez o refrão" ou "últimas 2 músicas" para a tela, em três níveis de urgência.' },
  { title: 'A cara da sua banda', text: 'Logo da banda ou do artista na tela e QR code para os músicos entrarem no show.' },
  { title: 'Pronto para teleprompter de vidro', text: 'Espelhe a imagem com um toque e use no vidro à frente do cantor.' },
  { title: 'Letra automática', text: 'A IA separa a voz, lê a letra palavra por palavra e marca cada trecho na onda. Você só confere.' },
  { title: 'Editor de letras', text: 'Página por página, com cor, tamanho e tipo (verso, refrão, ponte), e a prévia da TV sempre à vista.' },
  { title: 'Letra um pouco antes', text: 'Escolha quanto tempo antes cada trecho aparece, até 3 segundos, para a TV sem fio não atrasar.' },
];

export const NEWS = [
  { title: 'Cara de equipamento de verdade', text: 'Skins Analógica, Grafite, Estúdio e Oficina, com knobs de LED, VUs de ponteiro, loudness e a placa da marca.' },
  { title: 'Pads ao vivo no Modo Show', text: '9 pads em 10 bancos com reverb, delay, roll no tempo, loop e saída própria. Tecla P abre na hora.' },
  { title: 'Mais de mil falas prontas do Maestro', text: 'Botões por assunto, com intensidade Calma, Normal ou Forte, nas vozes Felipe e Bianca.' },
  { title: 'Letra automática na TV', text: 'A IA lê a letra da música e marca cada trecho na onda, no tempo certo de aparecer.' },
  { title: 'Cifra que rola sozinha', text: 'No Modo show do músico a cifra desce na velocidade escolhida, de bem devagar até rápido.' },
  { title: 'Gravar na faixa Maestro', text: 'REC e microfone direto na faixa, com a placa e o canal que você escolher.' },
  { title: 'Recriar o metrônomo', text: 'Troque o som do click por outro pronto ou pelo seu próprio som.' },
  { title: 'Separação de bateria em 5 peças', text: 'Motor novo de separação por IA, mais limpo, com a bateria aberta em peças.' },
  { title: 'Masterização com perfis', text: 'A IA masteriza qualquer clipe ou fala do Maestro, com perfis para show e streaming.' },
  { title: 'Faixas em grupo', text: 'Selecione várias faixas e mexa em todas juntas: volume, mute, solo e saída.' },
]

export const COMPARISON = [
  { topic: 'Trocar de música', studio: 'Abrir outro projeto ou rolar uma timeline enorme', vs: 'Cada música tem a sua timeline e a troca é instantânea' },
  { topic: 'Montar um VS', studio: 'Importar, nomear e rotear faixa por faixa', vs: 'Arraste a pasta e a IA roteia sozinha, ou deixe a IA separar a música pronta' },
  { topic: 'Tom e andamento', studio: 'Plugins pesados que deformam o timbre', vs: 'Tom e BPM com um clique, em tempo real, sem bagunçar o projeto' },
  { topic: 'Banda e cantores', studio: 'Papel impresso ou outro aplicativo, sem sincronia', vs: 'Partitura no celular de cada músico e letra na TV, no tempo da música' },
  { topic: 'Na hora do show', studio: 'Telas cheias de botões pequenos e risco de clique errado', vs: 'Modo Show com displays grandes e trava contra toques sem querer' },
  { topic: 'Iluminação', studio: 'Gerador de timecode configurado à parte', vs: 'Faixa de timecode LTC pronta, com fader, trava e saída própria' },
  { topic: 'Vinhetas e efeitos', studio: 'Sampler ou outro programa aberto junto', vs: 'Pads no Modo Show, com efeitos e saída própria, sem sair da tela do show' },
  { topic: 'Regência', studio: 'Gravar a voz do maestro à mão, música por música', vs: 'Maestro com IA: você digita, a IA fala no tempo certo' },
];

export type Tool = { title: string; text: string; viz: ToolViz; wide?: boolean };

// As 20 ferramentas que o dono pediu para aparecer no site (na ordem dele).
export const TOOLS: Tool[] = [
  { title: 'Roteamento com IA', text: 'Arraste a pasta das multitracks: a IA reconhece bateria, baixo, guias e teclados e manda cada faixa para o fader certo. O trabalho braçal vira um arrastar e soltar.', viz: 'routing', wide: true },
  { title: 'Faixa só para o timecode', text: 'O timecode LTC tem faixa, fader, trava e saída próprios. A mesa de luz e os painéis de LED seguem cada música sem vazar no PA.', viz: 'timecode', wide: true },
  { title: 'Master com IA', text: 'Um toque no IGUALAR e a IA nivela todos os VS do projeto: as músicas baixas sobem, as altas descem, e o show soa por igual do começo ao fim.', viz: 'equal', wide: true },
  { title: 'Anti-clip em tempo real', text: 'Funciona como um limitador em tempo real: ligado, a faixa não clipa nem no pico mais forte. Adeus ao estalo no PA.', viz: 'anticlip' },
  { title: 'Maestro com IA', text: 'Escreva a regência e a IA fala por você, no tempo certo: contagem, "prepara o refrão", "último refrão". A banda ouve no fone, o público não.', viz: 'maestro', wide: true },
  { title: 'BPM com IA', text: 'A IA ouve a música e descobre o andamento exato, sem ninguém precisar bater o pé.', viz: 'bpm' },
  { title: 'Tom e BPM com um clique', text: 'Subiu o tom para o cantor? Acelerou a música? Um clique, em tempo real, sem bagunçar o projeto do show.', viz: 'tune' },
  { title: 'Uma timeline por música', text: 'Chega de projetos imensos em que você não enxerga o fim. Cada música tem a sua timeline: visual limpo e troca instantânea.', viz: 'i-timeline' },
  { title: 'Área do Músico', text: 'No celular ou tablet de cada músico: ferramentas modernas para escrever cifras e partituras ou subir fotos do caderno, tudo seguindo o diretor em tempo real.', viz: 'i-musico' },
  { title: 'Feito só para o palco', text: 'Uma DAW pensada exclusivamente para o show: robusta para não falhar, leve para rodar liso do começo ao fim.', viz: 'i-palco' },
  { title: 'Teleprompter', text: 'O produtor técnico sobe as letras, as informações e a playlist do show para os artistas, conectado direto ao computador do diretor.', viz: 'i-tv' },
  { title: 'Tudo em rede, sem internet', text: 'Wi-Fi ou rede local: computador, celulares, tablets e TV conectados, mesmo sem um único sinal de internet.', viz: 'i-rede' },
  { title: 'Crie VS com IA', text: 'Suba uma música pronta: a IA separa os stems, detecta o andamento, cria a faixa de click e entrega o VS na grade do programa, sincronizado e pronto para ensaiar.', viz: 'stems', wide: true },
  { title: 'Medley com marcadores', text: 'Separe o medley com marcadores em um clique e escolha, um por um, quais trechos entram e quais ficam de fora.', viz: 'medley' },
  { title: 'Regiões para improviso', text: 'Crie loops de refrão, solo ou intro e estique o momento quando o público pede mais. O que a sua criatividade mandar.', viz: 'loops' },
  { title: 'LR mágico', text: 'Um clique e o show vira LR: click, maestro e guia no L, todo o resto dos instrumentos no R. Outro clique e tudo volta como estava.', viz: 'lr', wide: true },
  { title: 'Exportar com um clique', text: 'Exporte a música em LR, em multipista ou o show inteiro com um clique, pronto para ensaio, backup ou outro sistema.', viz: 'export', wide: true },
  { title: 'Arraste e solte', text: 'Arraste as músicas para qualquer posição e monte uma nova playlist em poucos cliques. Mudou o roteiro em cima da hora? Leva segundos.', viz: 'drag', wide: true },
  { title: 'Masterização com IA', text: 'Um botão trata o som da música com inteligência artificial e entrega presença e volume prontos para o PA.', viz: 'i-master' },
  { title: 'Pads ao vivo', text: 'Vinhetas, efeitos e loops em 9 pads por banco, com efeitos próprios e saída separada, direto no Modo Show.', viz: 'i-pads' },
  { title: 'Letra automática', text: 'A IA lê a letra da música e marca cada trecho na onda para a TV do palco.', viz: 'i-letra' },
  { title: 'Controle pelo celular', text: 'O Modo Show na palma da mão, pela rede local ou pela internet, com os medidores do show.', viz: 'i-remote' },
  { title: 'Gravar e recriar o click', text: 'Grave a voz na faixa Maestro e troque o som do metrônomo pelo que você quiser.', viz: 'i-rec' },
  { title: 'Skins de equipamento', text: 'Analógica, Grafite, Estúdio ou Oficina: escolha a cara do programa para o seu palco.', viz: 'i-skins' },
  { title: 'E muito mais', text: 'Uma infinidade de detalhes criados pensando no show: facilidade para quem opera, agilidade para quem dirige e tranquilidade para a banda.', viz: 'i-mais' },
];

export const FAQS = [
  {
    q: 'O que é o VS Stage Pro?',
    a: 'É uma DAW (estação de trabalho de áudio) feita exclusivamente para o palco, para shows e igrejas. Ele toca as multitracks (VS), o click, a guia e o timecode da iluminação, tem mixer e Modo Show, cria VS com inteligência artificial e ainda leva a partitura para o celular de cada músico e a letra para a TV do palco, tudo sincronizado.',
  },
  {
    q: 'Roda no Windows ou só no Mac?',
    a: 'O programa roda no Mac, com Apple Silicon (M1 a M4) ou Intel. A Área do Músico e o teleprompter abrem em qualquer celular, tablet ou TV com navegador.',
  },
  {
    q: 'Como funciona o teste grátis de 48 horas?',
    a: 'Você baixa o programa, cria sua conta em poucos segundos e usa tudo por 48 horas, sem cadastrar cartão. Dá tempo de montar o repertório, ensaiar e testar com a banda.',
  },
  {
    q: 'Preciso de internet no palco?',
    a: 'Não. O VS Stage Pro funciona sem internet. Para a banda ver a partitura e a TV mostrar a letra, basta ligar o computador, os celulares e a TV no mesmo roteador Wi-Fi, mesmo sem sinal de internet.',
  },
  {
    q: 'Como a IA cria um VS a partir de uma música pronta?',
    a: 'Você escolhe o arquivo da música mixada (MP3 ou WAV). A IA separa a música e entrega o VS com voz, click, bateria, baixo, guitarra/violão, teclado e outros. Ela também divide a bateria em peças, mede o BPM e monta tudo numa timeline própria, com cada faixa no fader certo. A separação roda no próprio Mac.',
  },
  {
    q: 'A separação por IA tem qualidade para tocar no show?',
    a: 'Para a grande maioria das músicas, sim: o resultado já sai pronto para tocar ao vivo. Em trechos com muitos instrumentos na mesma região, pode valer um ajuste antes do show, e qualquer faixa pode ser trocada de fader quando você quiser.',
  },
  {
    q: 'Como funciona o Maestro com IA?',
    a: 'Você marca na faixa Maestro o ponto da música e digita o que o maestro tem que falar: a contagem, "prepara o refrão", "último refrão" e qualquer aviso. A IA transforma o texto em voz e encaixa no tempo da música, saindo pelo canal do Maestro, com a mesma saída e o mesmo volume. Também há mais de mil falas prontas em botões por assunto, nas vozes Felipe e Bianca.',
  },
  {
    q: 'Como funciona o timecode para a iluminação?',
    a: 'O canal de timecode LTC já vem pronto na timeline e no mixer. Ele gera o sinal que as mesas de luz e os painéis de LED usam para seguir a música, com saída própria para não vazar no som principal.',
  },
  {
    q: 'O que são os pads do Modo Show?',
    a: 'São 9 botões por banco, em 10 bancos, para tocar vinhetas, efeitos, aplausos e loops durante o show. Cada pad tem reverb, delay, roll no tempo da música, loop e pitch, e os pads podem sair por uma saída própria da placa de som.',
  },
  {
    q: 'Dá para mudar a aparência do programa?',
    a: 'Sim. Em Visualizar > Skins você escolhe entre Analógica (a padrão, com cara de mesa de som), Grafite, Estúdio e Oficina. O programa inteiro muda de cara, e nada muda no seu show.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim. O plano mensal não tem fidelidade, multa nem cobrança automática: cada pagamento libera 1 mês e, se não renovar, o acesso vai até o fim do mês já pago.',
  },
];
