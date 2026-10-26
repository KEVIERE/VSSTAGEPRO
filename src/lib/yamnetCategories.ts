import type { RoutingTarget } from '@/types';

// Mapa oficial de índice → nome de classe do YAMNet (modelo do Google, 521 classes do
// AudioSet). Índices conferidos contra o yamnet_class_map.csv oficial do repositório
// tensorflow/models — não editar sem checar contra essa fonte, pois um índice errado
// faz a faixa certa virar som errado silenciosamente.
export const YAMNET_CLASS_NAMES: Record<number, string> = {
  132: 'Music',
  133: 'Musical instrument',
  134: 'Plucked string instrument',
  135: 'Guitar',
  136: 'Electric guitar',
  137: 'Bass guitar',
  138: 'Acoustic guitar',
  139: 'Steel guitar, slide guitar',
  140: 'Tapping (guitar technique)',
  141: 'Strum',
  142: 'Banjo',
  143: 'Sitar',
  144: 'Mandolin',
  145: 'Zither',
  146: 'Ukulele',
  147: 'Keyboard (musical)',
  148: 'Piano',
  149: 'Electric piano',
  150: 'Organ',
  151: 'Electronic organ',
  152: 'Hammond organ',
  153: 'Synthesizer',
  154: 'Sampler',
  155: 'Harpsichord',
  156: 'Percussion',
  157: 'Drum kit',
  158: 'Drum machine',
  159: 'Drum',
  160: 'Snare drum',
  161: 'Rimshot',
  162: 'Drum roll',
  163: 'Bass drum',
  164: 'Timpani',
  165: 'Tabla',
  166: 'Cymbal',
  167: 'Hi-hat',
  168: 'Wood block',
  169: 'Tambourine',
  170: 'Rattle (instrument)',
  171: 'Maraca',
  172: 'Gong',
  173: 'Tubular bells',
  174: 'Mallet percussion',
  175: 'Marimba, xylophone',
  176: 'Glockenspiel',
  177: 'Vibraphone',
  178: 'Steelpan',
  179: 'Orchestra',
  180: 'Brass instrument',
  181: 'French horn',
  182: 'Trumpet',
  183: 'Trombone',
  184: 'Bowed string instrument',
  185: 'String section',
  186: 'Violin, fiddle',
  187: 'Pizzicato',
  188: 'Cello',
  189: 'Double bass',
  190: 'Wind instrument, woodwind instrument',
  191: 'Flute',
  192: 'Saxophone',
  193: 'Clarinet',
  194: 'Harp',
  203: 'Harmonica',
  204: 'Accordion',
  205: 'Bagpipes',
  206: 'Didgeridoo',
  208: 'Theremin',
};

// Traduz a classe reconhecida pelo YAMNet para a faixa/instrumento do VS Stage Pro.
// Ordem dos campos não importa — a busca em routeByYamnetCategory varre tudo.
const CATEGORY_MAP: Record<string, { target: RoutingTarget; childName: string }> = {
  // Bateria
  'Drum kit': { target: 'track-bateria', childName: 'Bateria' },
  'Drum machine': { target: 'track-bateria', childName: 'Bateria' },
  'Drum': { target: 'track-bateria', childName: 'Bateria' },
  'Snare drum': { target: 'track-bateria', childName: 'Caixa' },
  'Rimshot': { target: 'track-bateria', childName: 'Caixa' },
  'Drum roll': { target: 'track-bateria', childName: 'Bateria' },
  'Bass drum': { target: 'track-bateria', childName: 'Bumbo' },
  'Hi-hat': { target: 'track-bateria', childName: 'Chimbal' },
  'Cymbal': { target: 'track-bateria', childName: 'Prato' },

  // Percussões (a classe genérica "Percussion" fica de fora do mapa — ela é tratada como
  // GENERIC_CLASSES acima, porque dispara mais forte que "Drum" até pra bateria comum)
  'Timpani': { target: 'track-percussoes', childName: 'Tímpanos' },
  'Tabla': { target: 'track-percussoes', childName: 'Tabla' },
  'Wood block': { target: 'track-percussoes', childName: 'Bloco' },
  'Tambourine': { target: 'track-percussoes', childName: 'Pandeiro' },
  'Rattle (instrument)': { target: 'track-percussoes', childName: 'Chocalho' },
  'Maraca': { target: 'track-percussoes', childName: 'Maracas' },
  'Gong': { target: 'track-percussoes', childName: 'Gongo' },
  'Tubular bells': { target: 'track-percussoes', childName: 'Sinos' },
  'Mallet percussion': { target: 'track-percussoes', childName: 'Percussão' },
  'Marimba, xylophone': { target: 'track-percussoes', childName: 'Marimba' },
  'Glockenspiel': { target: 'track-percussoes', childName: 'Glockenspiel' },
  'Vibraphone': { target: 'track-percussoes', childName: 'Vibrafone' },
  'Steelpan': { target: 'track-percussoes', childName: 'Steelpan' },

  // Contrabaixo
  'Bass guitar': { target: 'track-contrabaixo', childName: 'Contrabaixo' },
  'Double bass': { target: 'track-contrabaixo', childName: 'Contrabaixo' },

  // Guitarras (elétrica)
  'Electric guitar': { target: 'track-guitarras', childName: 'Guitarra' },
  'Tapping (guitar technique)': { target: 'track-guitarras', childName: 'Guitarra' },

  // Violões (acústico / dedilhado) — "Guitar" e "Strum" ficam aqui por padrão:
  // o YAMNet não garante elétrica x acústica na classe genérica, mas o som "limpo"
  // de violão é o caso mais comum quando o modelo não especifica.
  'Guitar': { target: 'track-violoes', childName: 'Violão' },
  'Acoustic guitar': { target: 'track-violoes', childName: 'Violão' },
  'Steel guitar, slide guitar': { target: 'track-violoes', childName: 'Violão' },
  'Strum': { target: 'track-violoes', childName: 'Violão' },
  'Plucked string instrument': { target: 'track-violoes', childName: 'Violão' },

  // Sanfonas
  'Accordion': { target: 'track-sanfonas', childName: 'Sanfona' },
  'Bagpipes': { target: 'track-sanfonas', childName: 'Sanfona' },
  'Harmonica': { target: 'track-sanfonas', childName: 'Sanfona' },

  // Teclados
  'Keyboard (musical)': { target: 'track-teclados', childName: 'Teclado' },
  'Piano': { target: 'track-teclados', childName: 'Piano' },
  'Electric piano': { target: 'track-teclados', childName: 'Piano' },
  'Organ': { target: 'track-teclados', childName: 'Órgão' },
  'Electronic organ': { target: 'track-teclados', childName: 'Órgão' },
  'Hammond organ': { target: 'track-teclados', childName: 'Órgão' },
  'Synthesizer': { target: 'track-teclados', childName: 'Synth' },
  'Sampler': { target: 'track-teclados', childName: 'Synth' },
  'Harpsichord': { target: 'track-teclados', childName: 'Piano' },
  'Theremin': { target: 'track-teclados', childName: 'Synth' },

  // Outros (sopros, cordas de arco, orquestra)
  'Orchestra': { target: 'track-outros', childName: 'Orquestra' },
  'Brass instrument': { target: 'track-outros', childName: 'Metais' },
  'French horn': { target: 'track-outros', childName: 'Trompa' },
  'Trumpet': { target: 'track-outros', childName: 'Trompete' },
  'Trombone': { target: 'track-outros', childName: 'Trombone' },
  'Bowed string instrument': { target: 'track-outros', childName: 'Violino' },
  'String section': { target: 'track-outros', childName: 'Cordas' },
  'Violin, fiddle': { target: 'track-outros', childName: 'Violino' },
  'Pizzicato': { target: 'track-outros', childName: 'Violino' },
  'Cello': { target: 'track-outros', childName: 'Violoncelo' },
  'Wind instrument, woodwind instrument': { target: 'track-outros', childName: 'Sopro' },
  'Flute': { target: 'track-outros', childName: 'Flauta' },
  'Saxophone': { target: 'track-outros', childName: 'Saxofone' },
  'Clarinet': { target: 'track-outros', childName: 'Clarinete' },
  'Harp': { target: 'track-outros', childName: 'Harpa' },
  'Didgeridoo': { target: 'track-outros', childName: 'Didgeridoo' },
  'Banjo': { target: 'track-outros', childName: 'Banjo' },
  'Sitar': { target: 'track-outros', childName: 'Sitar' },
  'Mandolin': { target: 'track-outros', childName: 'Bandolim' },
  'Zither': { target: 'track-outros', childName: 'Zither' },
  'Ukulele': { target: 'track-outros', childName: 'Ukulele' },
};

export interface YamnetRoute {
  target: RoutingTarget;
  childName: string;
  confidence: number;
  yamnetClass: string;
}

/** Classes genéricas demais pra rotear sozinhas (não dizem qual instrumento é).
 * "Percussion" entra aqui apesar de ter rota própria no mapa: testada com áudio real
 * (caixa, bumbo, chimbal), ela dispara mais forte que "Drum"/"Snare drum"/"Hi-hat" para
 * bateria comum de kit — e sem essa exclusão, bateria inteira era roteada pra Percussões
 * em vez de Bateria. Só os instrumentos de percussão de mão têm classe própria específica
 * (Tambourine, Maraca, Bongô etc.) e continuam roteando certo sem precisar de "Percussion". */
const GENERIC_CLASSES = new Set(['Music', 'Musical instrument', 'Percussion']);

/**
 * Converte o resultado bruto do YAMNet (lista de classes com probabilidade, já
 * ordenada da maior pra menor) na faixa/instrumento do VS Stage Pro. Pula classes
 * genéricas demais ("Music") e usa a primeira classe específica reconhecida.
 */
export function routeByYamnetScores(
  scores: { className: string; probability: number }[]
): YamnetRoute | null {
  for (const { className, probability } of scores) {
    if (GENERIC_CLASSES.has(className)) continue;
    const route = CATEGORY_MAP[className];
    if (route) {
      return { ...route, confidence: probability, yamnetClass: className };
    }
  }
  return null;
}

// URL oficial do modelo YAMNet já convertido para TensorFlow.js (hospedado no TF Hub).
export const YAMNET_MODEL_URL = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';

// YAMNet espera áudio mono a 16kHz; o próprio modelo cuida do enquadramento interno
// em janelas de 0.96s, então basta entregar o trecho inteiro de uma vez.
export const YAMNET_SAMPLE_RATE = 16000;
