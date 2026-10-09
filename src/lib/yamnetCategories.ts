import type { RoutingTarget } from '@/types';

// YAMNet category index → track group mapping
// Based on AudioSet ontology categories
const CATEGORY_MAP: Record<string, RoutingTarget> = {
  // Bateria / Drums
  'Drum kit': 'track-bateria',
  'Drum machine': 'track-bateria',
  'Snare drum': 'track-bateria',
  'Bass drum': 'track-bateria',
  'Drum': 'track-bateria',
  'Drums': 'track-bateria',
  // Percussões
  'Marimba, xylophone': 'track-percussoes',
  'Tambourine': 'track-percussoes',
  'Cymbal': 'track-percussoes',
  'Hi-hat': 'track-percussoes',
  'Gong': 'track-percussoes',
  'Percussion': 'track-percussoes',
  // Contrabaixo / Bass
  'Bass guitar': 'track-contrabaixo',
  'Bass': 'track-contrabaixo',
  'Double bass': 'track-contrabaixo',
  // Guitarras
  'Electric guitar': 'track-guitarras',
  'Guitar': 'track-guitarras',
  'Distortion': 'track-guitarras',
  // Violões
  'Acoustic guitar': 'track-violoes',
  'Steel guitar, slide guitar': 'track-violoes',
  // Sanfonas
  'Accordion': 'track-sanfonas',
  // Teclados
  'Piano': 'track-teclados',
  'Keyboard': 'track-teclados',
  'Synthesizer': 'track-teclados',
  'Organ': 'track-teclados',
  'Electronic music': 'track-teclados',
  // Outros
  'Brass instrument': 'track-outros',
  'Trumpet': 'track-outros',
  'Trombone': 'track-outros',
  'Saxophone': 'track-outros',
  'Strings': 'track-outros',
  'Violin': 'track-outros',
  'Cello': 'track-outros',
  'Orchestral music': 'track-outros',
};

export function routeByYamnetCategory(categoryName: string): { target: RoutingTarget; confidence: number } | null {
  if (CATEGORY_MAP[categoryName]) {
    return { target: CATEGORY_MAP[categoryName], confidence: 0.8 };
  }
  // Partial match
  for (const [key, target] of Object.entries(CATEGORY_MAP)) {
    if (categoryName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(categoryName.toLowerCase())) {
      return { target, confidence: 0.6 };
    }
  }
  return null;
}

// YAMNet model URL from TF Hub
export const YAMNET_MODEL_URL =
  'https://tfhub.dev/google/yamnet/1?tfjs-format=true';

// YAMNet expects 0.96s segments at 16kHz
export const YAMNET_SAMPLE_RATE = 16000;
export const YAMNET_SEGMENT_DURATION = 0.96;
