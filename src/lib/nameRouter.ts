import type { RoutingTarget } from '@/types';

interface RouteResult {
  target: RoutingTarget;
  confidence: number;
  instrumentName: string;
}

interface Keyword {
  pattern: RegExp;
  target: RoutingTarget;
  childName: string;
  weight: number;
  requiresContext?: RoutingTarget;
}

const SOLO_PATTERN = /\bsolo\b/i;

// Pesos: 10 = palavra inteira muito específica, 5 = palavra comum, 2 = abreviação, 1 = modificador que só vale com contexto
const KEYWORDS: Keyword[] = [
  { pattern: /\bclick\b/i, target: 'track-click', childName: 'Click', weight: 10 },
  { pattern: /\bclicks?\w*/i, target: 'track-click', childName: 'Click', weight: 8 },
  { pattern: /\bcli[cq]\b/i, target: 'track-click', childName: 'Click', weight: 8 },
  { pattern: /\bklick\b/i, target: 'track-click', childName: 'Click', weight: 8 },
  { pattern: /\bmetro\b/i, target: 'track-click', childName: 'Click', weight: 7 },
  { pattern: /\bclique\b/i, target: 'track-click', childName: 'Click', weight: 10 },
  { pattern: /\bmetron[oô]mo\b/i, target: 'track-click', childName: 'Click', weight: 10 },
  { pattern: /\bmetron/i, target: 'track-click', childName: 'Click', weight: 8 },
  { pattern: /\bclk\b/i, target: 'track-click', childName: 'Click', weight: 6 },
  { pattern: /\btempo\b/i, target: 'track-click', childName: 'Click', weight: 3 },
  { pattern: /\bbeat\b/i, target: 'track-click', childName: 'Click', weight: 3 },

  { pattern: /\bmaestro\b/i, target: 'track-maestro', childName: 'Maestro', weight: 10 },
  { pattern: /\bregente\b/i, target: 'track-maestro', childName: 'Maestro', weight: 10 },
  { pattern: /\bcondutor\b/i, target: 'track-maestro', childName: 'Maestro', weight: 10 },
  { pattern: /\bdiretor\s*musical/i, target: 'track-maestro', childName: 'Maestro', weight: 10 },
  { pattern: /\bdiretor\b/i, target: 'track-maestro', childName: 'Maestro', weight: 7 },
  { pattern: /\bgps\b/i, target: 'track-maestro', childName: 'Maestro', weight: 6 },

  { pattern: /\bguia\b/i, target: 'track-guia', childName: 'Guia', weight: 10 },

  { pattern: /\bback(?:ing)?\s*vocal/i, target: 'track-outros', childName: 'Backvocal', weight: 11 },
  { pattern: /\bbackvocal/i, target: 'track-outros', childName: 'Backvocal', weight: 11 },
  { pattern: /\bback\b/i, target: 'track-outros', childName: 'Backvocal', weight: 9 },
  { pattern: /\bvoca\b/i, target: 'track-outros', childName: 'Backvocal', weight: 9 },
  { pattern: /\bbkvox\b/i, target: 'track-outros', childName: 'Backvocal', weight: 8 },
  { pattern: /\bbacks\b/i, target: 'track-outros', childName: 'Backvocal', weight: 7 },
  { pattern: /\bvocais\b/i, target: 'track-outros', childName: 'Backvocal', weight: 7 },
  { pattern: /\bvocal\b/i, target: 'track-outros', childName: 'Backvocal', weight: 6 },
  { pattern: /\bcoros?\b/i, target: 'track-outros', childName: 'Backvocal', weight: 6 },
  { pattern: /\bapoio\b/i, target: 'track-outros', childName: 'Backvocal', weight: 5 },
  { pattern: /\blocu[cç][aã]o/i, target: 'track-outros', childName: 'Backvocal', weight: 8 },
  { pattern: /\bfala\b/i, target: 'track-outros', childName: 'Backvocal', weight: 5 },
  { pattern: /\bbk\b/i, target: 'track-outros', childName: 'Backvocal', weight: 3 },
  { pattern: /\bvox\b/i, target: 'track-outros', childName: 'Backvocal', weight: 4 },

  { pattern: /\bcontrabaixo\s*(de\s*)?arco/i, target: 'track-outros', childName: 'Contrabaixo Arco', weight: 11 },

  { pattern: /\bfender\s*rhodes/i, target: 'track-teclados', childName: 'Rhodes', weight: 11 },
  { pattern: /\brhodes\b/i, target: 'track-teclados', childName: 'Rhodes', weight: 10 },
  { pattern: /\brhods?\b/i, target: 'track-teclados', childName: 'Rhodes', weight: 10 },
  { pattern: /\brhod\b/i, target: 'track-teclados', childName: 'Rhodes', weight: 9 },
  { pattern: /\bpiano/i, target: 'track-teclados', childName: 'Piano', weight: 10 },
  { pattern: /\bkey[_\s-]?\d+\b/i, target: 'track-teclados', childName: 'Piano', weight: 11 },
  { pattern: /\bwurlitzer/i, target: 'track-teclados', childName: 'Wurlitzer', weight: 10 },
  { pattern: /\b[oó]rg[aã]o\b/i, target: 'track-teclados', childName: 'Órgão', weight: 10 },
  { pattern: /\borgan\b/i, target: 'track-teclados', childName: 'Órgão', weight: 8 },
  { pattern: /\bmellotron/i, target: 'track-teclados', childName: 'Mellotron', weight: 10 },
  { pattern: /\bteclado/i, target: 'track-teclados', childName: 'Teclado', weight: 10 },
  { pattern: /\bsynth\b/i, target: 'track-teclados', childName: 'Synth', weight: 8 },
  { pattern: /\bsynthesizer/i, target: 'track-teclados', childName: 'Synth', weight: 10 },
  { pattern: /\bmainstage/i, target: 'track-teclados', childName: 'Synth', weight: 9 },
  { pattern: /\bkeys\b/i, target: 'track-teclados', childName: 'Keys', weight: 7 },
  { pattern: /\bstrings?\b/i, target: 'track-teclados', childName: 'Strings', weight: 8 },
  { pattern: /\bchoir\b/i, target: 'track-teclados', childName: 'Choir', weight: 8 },
  // modificadores: só valem se o nome já pontuou em teclados; caso contrário são ignorados
  { pattern: /\bpads?\b/i, target: 'track-teclados', childName: 'Pad', weight: 10 },
  { pattern: /\blead\b/i, target: 'track-teclados', childName: 'Lead', weight: 3, requiresContext: 'track-teclados' },
  { pattern: /\barp\b/i, target: 'track-teclados', childName: 'Arp', weight: 3, requiresContext: 'track-teclados' },
  { pattern: /\barpeggiator/i, target: 'track-teclados', childName: 'Arp', weight: 8 },
  { pattern: /\briser\b/i, target: 'track-teclados', childName: 'Riser', weight: 5, requiresContext: 'track-teclados' },
  { pattern: /\bdrop\b/i, target: 'track-teclados', childName: 'Drop', weight: 3, requiresContext: 'track-teclados' },
  { pattern: /\bsfx\b/i, target: 'track-teclados', childName: 'FX', weight: 10 },
  { pattern: /\bfx\b/i, target: 'track-teclados', childName: 'FX', weight: 10 },
  { pattern: /\befeitos?\b/i, target: 'track-teclados', childName: 'FX', weight: 8 },
  { pattern: /\bfantasy/i, target: 'track-teclados', childName: 'FX', weight: 6 },
  { pattern: /\bloops?\b/i, target: 'track-teclados', childName: 'Loop', weight: 10 },
  { pattern: /\bseq\b/i, target: 'track-teclados', childName: 'Seq', weight: 3, requiresContext: 'track-teclados' },

  { pattern: /\bmetais\b/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\bbrass\b/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\bnaipe\s*de\s*(metais|sopros)/i, target: 'track-outros', childName: 'Metais', weight: 11 },
  { pattern: /\btrompete/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\btrumpet/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\btrombone/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\btuba\b/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\btrompa\b/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\bfliscorne/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\bhorn\b/i, target: 'track-outros', childName: 'Metais', weight: 7 },
  { pattern: /\bsaxofone/i, target: 'track-outros', childName: 'Metais', weight: 10 },
  { pattern: /\bsax\b/i, target: 'track-outros', childName: 'Metais', weight: 8 },

  { pattern: /\bacorde[oô]n/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 12 },
  { pattern: /\bsf\b/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 9 },
  { pattern: /\baccordion/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 12 },
  { pattern: /\bsanfona/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 12 },
  { pattern: /\bsanf\b/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 10 },
  { pattern: /\bsanfon/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 10 },
  { pattern: /\bgaita\b/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 9 },
  { pattern: /\bmusette/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 10 },
  { pattern: /\bfole\b/i, target: 'track-sanfonas', childName: 'Sanfona', weight: 8 },

  { pattern: /\bviol[aã]o\b/i, target: 'track-violoes', childName: 'Violão', weight: 12 },
  { pattern: /\bviol[aã]o\s*[lr]\b/i, target: 'track-violoes', childName: 'Violão', weight: 12 },
  { pattern: /\bviolao/i, target: 'track-violoes', childName: 'Violão', weight: 12 },
  { pattern: /\bnylon\b/i, target: 'track-violoes', childName: 'Violão', weight: 9 },
  { pattern: /\ba[cç]o\b/i, target: 'track-violoes', childName: 'Violão', weight: 7 },
  { pattern: /\bac[uú]stico\b/i, target: 'track-violoes', childName: 'Violão', weight: 7 },
  { pattern: /\bac[uú]stica\b/i, target: 'track-violoes', childName: 'Violão', weight: 7 },
  { pattern: /\bacoustic\s*guitar/i, target: 'track-violoes', childName: 'Violão', weight: 10 },
  { pattern: /\bvl\b/i, target: 'track-violoes', childName: 'Violão', weight: 4 },
  { pattern: /\bvr\b/i, target: 'track-violoes', childName: 'Violão', weight: 3 },
  { pattern: /\bv\s*[lr]\b/i, target: 'track-violoes', childName: 'Violão', weight: 3 },
  { pattern: /\bv[1-4]\b/i, target: 'track-violoes', childName: 'Violão', weight: 3 },
  { pattern: /\bv\b/i, target: 'track-violoes', childName: 'Violão', weight: 2 },

  { pattern: /\bguitarra/i, target: 'track-guitarras', childName: 'Guitarra', weight: 12 },
  { pattern: /\bguitar\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 10 },
  { pattern: /\bguitta(r)?/i, target: 'track-guitarras', childName: 'Guitarra', weight: 10 },
  { pattern: /\bguita\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 8 },
  { pattern: /\belectric\s*guitar/i, target: 'track-guitarras', childName: 'Guitarra', weight: 12 },
  { pattern: /\bgtr\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 7 },
  { pattern: /\bgt\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 4 },
  { pattern: /\bg[1-9]\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 3 },
  { pattern: /\bg\s*[lr]\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 3 },
  { pattern: /\briff\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 5, requiresContext: 'track-guitarras' },
  { pattern: /\bdrive\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 4, requiresContext: 'track-guitarras' },
  { pattern: /\beg\b/i, target: 'track-guitarras', childName: 'Guitarra', weight: 3 },

  { pattern: /\bbateria/i, target: 'track-bateria', childName: 'Bateria', weight: 11 },
  { pattern: /\bdrums?\b/i, target: 'track-bateria', childName: 'Bateria', weight: 10 },
  { pattern: /\bkick\b/i, target: 'track-bateria', childName: 'Kick', weight: 10 },
  { pattern: /\bbumbo\b/i, target: 'track-bateria', childName: 'Bumbo', weight: 10 },
  { pattern: /\bsnare\b/i, target: 'track-bateria', childName: 'Snare', weight: 10 },
  { pattern: /\bcaixa\b/i, target: 'track-bateria', childName: 'Caixa', weight: 9 },
  { pattern: /\bcx\b/i, target: 'track-bateria', childName: 'Caixa', weight: 4 },
  { pattern: /\btoms?\b/i, target: 'track-bateria', childName: 'Tom', weight: 7 },
  { pattern: /\bsurdo\b/i, target: 'track-bateria', childName: 'Surdo', weight: 10 },
  { pattern: /\bchimbal/i, target: 'track-bateria', childName: 'Chimbal', weight: 10 },
  { pattern: /\bhi-?hat/i, target: 'track-bateria', childName: 'Chimbal', weight: 10 },
  { pattern: /\bhats?\b/i, target: 'track-bateria', childName: 'Chimbal', weight: 7 },
  { pattern: /\bride\b/i, target: 'track-bateria', childName: 'Prato', weight: 8 },
  { pattern: /\bcrash\b/i, target: 'track-bateria', childName: 'Prato', weight: 10 },
  { pattern: /\bprato\b/i, target: 'track-bateria', childName: 'Prato', weight: 9 },
  { pattern: /\boverhead/i, target: 'track-bateria', childName: 'Overhead', weight: 10 },
  { pattern: /\bover\b/i, target: 'track-bateria', childName: 'Overhead', weight: 5, requiresContext: 'track-bateria' },
  { pattern: /\broom\b/i, target: 'track-bateria', childName: 'Room', weight: 5, requiresContext: 'track-bateria' },
  { pattern: /\bkit\b/i, target: 'track-bateria', childName: 'Bateria', weight: 5, requiresContext: 'track-bateria' },

  { pattern: /\bcontrabaixo/i, target: 'track-contrabaixo', childName: 'Contrabaixo', weight: 11 },
  { pattern: /\bbaixo\b/i, target: 'track-contrabaixo', childName: 'Contrabaixo', weight: 10 },
  { pattern: /\bbass\b/i, target: 'track-contrabaixo', childName: 'Contrabaixo', weight: 10 },
  { pattern: /\bbx\b/i, target: 'track-contrabaixo', childName: 'Contrabaixo', weight: 5 },
  { pattern: /\bsub\b/i, target: 'track-contrabaixo', childName: 'Contrabaixo', weight: 4, requiresContext: 'track-contrabaixo' },

  { pattern: /\bbong[oô]s?\b/i, target: 'track-percussoes', childName: 'Bongô', weight: 11 },
  { pattern: /\bbogos?\b/i, target: 'track-percussoes', childName: 'Bongô', weight: 10 },
  { pattern: /\bbogo\b/i, target: 'track-percussoes', childName: 'Bongô', weight: 8 },
  { pattern: /\bconga/i, target: 'track-percussoes', childName: 'Conga', weight: 10 },
  { pattern: /\bc[oô]ngas?\b/i, target: 'track-percussoes', childName: 'Conga', weight: 10 },
  { pattern: /\bshaker/i, target: 'track-percussoes', childName: 'Shaker', weight: 10 },
  { pattern: /\bshake\b/i, target: 'track-percussoes', childName: 'Shaker', weight: 7 },
  { pattern: /\bpandeirola/i, target: 'track-percussoes', childName: 'Pandeirola', weight: 11 },
  { pattern: /\bpandeiro/i, target: 'track-percussoes', childName: 'Pandeiro', weight: 11 },
  { pattern: /\btamborim/i, target: 'track-percussoes', childName: 'Tamborim', weight: 11 },
  { pattern: /\btambor\b/i, target: 'track-percussoes', childName: 'Tambor', weight: 10 },
  { pattern: /\bcu[ií]ca/i, target: 'track-percussoes', childName: 'Cuíca', weight: 11 },
  { pattern: /\bagog[oô]/i, target: 'track-percussoes', childName: 'Agogô', weight: 11 },
  { pattern: /\bcaj[oó]n/i, target: 'track-percussoes', childName: 'Cajón', weight: 11 },
  { pattern: /\bclaves?\b/i, target: 'track-percussoes', childName: 'Claves', weight: 9 },
  { pattern: /\bg[uü][ií]ro/i, target: 'track-percussoes', childName: 'Güiro', weight: 11 },
  { pattern: /\bguiro\b/i, target: 'track-percussoes', childName: 'Güiro', weight: 11 },
  { pattern: /\bguira\b/i, target: 'track-percussoes', childName: 'Güiro', weight: 11 },
  { pattern: /\bg[uü]ira\b/i, target: 'track-percussoes', childName: 'Güiro', weight: 11 },
  { pattern: /\bmaraca/i, target: 'track-percussoes', childName: 'Maracas', weight: 10 },
  { pattern: /\bcastanhola/i, target: 'track-percussoes', childName: 'Castanholas', weight: 11 },
  { pattern: /\bdjembe/i, target: 'track-percussoes', childName: 'Djembê', weight: 11 },
  { pattern: /\brepinique/i, target: 'track-percussoes', childName: 'Repinique', weight: 11 },
  { pattern: /\brepique/i, target: 'track-percussoes', childName: 'Repique', weight: 10 },
  { pattern: /\btantan/i, target: 'track-percussoes', childName: 'Tantã', weight: 10 },
  { pattern: /\btant[ãa]\b/i, target: 'track-percussoes', childName: 'Tantã', weight: 10 },
  { pattern: /\brebolo/i, target: 'track-percussoes', childName: 'Rebolo', weight: 10 },
  { pattern: /\btri[aâ]ngulo/i, target: 'track-percussoes', childName: 'Triângulo', weight: 11 },
  { pattern: /\balfaia/i, target: 'track-percussoes', childName: 'Alfaia', weight: 11 },
  { pattern: /\batabaque/i, target: 'track-percussoes', childName: 'Atabaque', weight: 11 },
  { pattern: /\bafox[eé]/i, target: 'track-percussoes', childName: 'Afoxé', weight: 11 },
  { pattern: /\bcaba[cç]a/i, target: 'track-percussoes', childName: 'Cabaça', weight: 10 },
  { pattern: /\bb[uú]zio/i, target: 'track-percussoes', childName: 'Búzios', weight: 10 },
  { pattern: /\bapito\b/i, target: 'track-percussoes', childName: 'Apito', weight: 10 },
  { pattern: /\bmatraca/i, target: 'track-percussoes', childName: 'Matraca', weight: 10 },
  { pattern: /\btimbales/i, target: 'track-percussoes', childName: 'Timbales', weight: 11 },
  { pattern: /\btimbau/i, target: 'track-percussoes', childName: 'Timbau', weight: 11 },
  { pattern: /\btimbal/i, target: 'track-percussoes', childName: 'Timbal', weight: 10 },
  { pattern: /\bzabumba/i, target: 'track-percussoes', childName: 'Zabumba', weight: 11 },
  { pattern: /\bcowbell/i, target: 'track-percussoes', childName: 'Cowbell', weight: 10 },
  { pattern: /\breco.?reco/i, target: 'track-percussoes', childName: 'Reco-Reco', weight: 11 },
  { pattern: /\bganz[aá]/i, target: 'track-percussoes', childName: 'Ganzá', weight: 11 },
  { pattern: /\bgongu[eê]/i, target: 'track-percussoes', childName: 'Gonguê', weight: 11 },
  { pattern: /\bxequer[eê]/i, target: 'track-percussoes', childName: 'Xequerê', weight: 11 },
  { pattern: /\bquexere/i, target: 'track-percussoes', childName: 'Xequerê', weight: 10 },
  { pattern: /\bbacurinha/i, target: 'track-percussoes', childName: 'Bacurinha', weight: 11 },
  { pattern: /\bmeia\s*lua/i, target: 'track-percussoes', childName: 'Meia Lua', weight: 10 },
  { pattern: /\bbloco\s*de\s*madeira/i, target: 'track-percussoes', childName: 'Bloco', weight: 11 },
  { pattern: /\bcax(e|i)ta/i, target: 'track-percussoes', childName: 'Caxeta', weight: 10 },
  { pattern: /\bcolher/i, target: 'track-percussoes', childName: 'Colheres', weight: 8 },
  { pattern: /\bbigorna/i, target: 'track-percussoes', childName: 'Bigorna', weight: 10 },
  { pattern: /\bsnaps?\b/i, target: 'track-percussoes', childName: 'Snaps', weight: 11 },
  { pattern: /\btorpedo/i, target: 'track-percussoes', childName: 'Torpedo', weight: 11 },
  { pattern: /\bclaps?\b/i, target: 'track-percussoes', childName: 'Claps', weight: 9 },
  { pattern: /\budu\b/i, target: 'track-percussoes', childName: 'Udu', weight: 10 },
  { pattern: /\bbalafon/i, target: 'track-percussoes', childName: 'Balafon', weight: 10 },
  { pattern: /\bt[íi]mpano/i, target: 'track-percussoes', childName: 'Tímpanos', weight: 10 },
  { pattern: /\bmarimba/i, target: 'track-percussoes', childName: 'Marimba', weight: 11 },
  { pattern: /\bxilofone/i, target: 'track-percussoes', childName: 'Xilofone', weight: 11 },
  { pattern: /\bvibrafone/i, target: 'track-percussoes', childName: 'Vibrafone', weight: 11 },
  { pattern: /\bcarrilh[aã]o/i, target: 'track-percussoes', childName: 'Carrilhão', weight: 11 },
  { pattern: /\bspd.?sx/i, target: 'track-percussoes', childName: 'SPD', weight: 10 },
  { pattern: /\bspd\b/i, target: 'track-percussoes', childName: 'SPD', weight: 7 },
  { pattern: /\bpercuss/i, target: 'track-percussoes', childName: 'Percussão', weight: 10 },

  { pattern: /\bflauta/i, target: 'track-outros', childName: 'Flauta', weight: 10 },
  { pattern: /\bflute/i, target: 'track-outros', childName: 'Flauta', weight: 10 },
  { pattern: /\bclarinet/i, target: 'track-outros', childName: 'Clarinete', weight: 10 },
  { pattern: /\bob[oó][eé]/i, target: 'track-outros', childName: 'Oboé', weight: 10 },
  { pattern: /\bpife\b/i, target: 'track-outros', childName: 'Pife', weight: 10 },
  { pattern: /\bfife\b/i, target: 'track-outros', childName: 'Pife', weight: 10 },
  { pattern: /\bviolino/i, target: 'track-outros', childName: 'Violino', weight: 11 },
  { pattern: /\bviolin\b/i, target: 'track-outros', childName: 'Violino', weight: 10 },
  { pattern: /\bviolonc?elo/i, target: 'track-outros', childName: 'Violoncelo', weight: 11 },
  { pattern: /\bcello\b/i, target: 'track-outros', childName: 'Violoncelo', weight: 10 },
  { pattern: /\bviola\s*de\s*arco/i, target: 'track-outros', childName: 'Viola de Arco', weight: 11 },
  { pattern: /\bharpa\b/i, target: 'track-outros', childName: 'Harpa', weight: 11 },
  { pattern: /\bharp\b/i, target: 'track-outros', childName: 'Harpa', weight: 8 },
  { pattern: /\bcavaquinho/i, target: 'track-outros', childName: 'Cavaquinho', weight: 11 },
  { pattern: /\bcavaco\b/i, target: 'track-outros', childName: 'Cavaquinho', weight: 10 },
  { pattern: /\bukulele/i, target: 'track-outros', childName: 'Ukulele', weight: 11 },
  { pattern: /\buke\b/i, target: 'track-outros', childName: 'Ukulele', weight: 7 },
  { pattern: /\bbanjo\b/i, target: 'track-outros', childName: 'Banjo', weight: 11 },
  { pattern: /\bbandolim/i, target: 'track-outros', childName: 'Bandolim', weight: 11 },
  { pattern: /\bmandolin/i, target: 'track-outros', childName: 'Bandolim', weight: 11 },
  { pattern: /\bsitar\b/i, target: 'track-outros', childName: 'Sitar', weight: 11 },
];

// "_" e números colados ("01_Click2") impediriam o reconhecimento de palavra inteira.
function stripExt(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2');
}

export function hasSoloInName(fileName: string): boolean {
  return SOLO_PATTERN.test(stripExt(fileName));
}

export function extractInstrumentName(fileName: string): string {
  const r = routeByName(fileName);
  return r?.instrumentName ?? '';
}

export function routeByName(fileName: string): RouteResult | null {
  const baseName = stripExt(fileName);
  const isSolo = hasSoloInName(fileName);

  // 1) primeiro passe: ignora as regras marcadas como "só com contexto"
  // soma pesos por target e lembra do melhor match por target
  type Hit = { weight: number; childName: string; firstIndex: number };
  const scores = new Map<RoutingTarget, Hit>();
  const matchedTargets = new Set<RoutingTarget>();

  const consider = (kw: Keyword) => {
    const m = baseName.match(kw.pattern);
    if (!m) return;
    matchedTargets.add(kw.target);
    const existing = scores.get(kw.target);
    const idx = m.index ?? 0;
    if (!existing || kw.weight > existing.weight) {
      scores.set(kw.target, { weight: (existing?.weight ?? 0) + kw.weight, childName: kw.childName, firstIndex: idx });
    } else {
      scores.set(kw.target, { ...existing, weight: existing.weight + kw.weight });
    }
  };

  for (const kw of KEYWORDS) {
    if (kw.requiresContext) continue;
    consider(kw);
  }
  // 2) segundo passe: aplica modificadores que exigem contexto
  for (const kw of KEYWORDS) {
    if (!kw.requiresContext) continue;
    if (!matchedTargets.has(kw.requiresContext)) continue;
    consider(kw);
  }

  if (scores.size === 0) return null;

  // vence o maior peso; empate: o que apareceu mais cedo no nome
  let bestTarget: RoutingTarget | null = null;
  let best: Hit | null = null;
  for (const [target, hit] of scores) {
    if (!best || hit.weight > best.weight || (hit.weight === best.weight && hit.firstIndex < best.firstIndex)) {
      best = hit;
      bestTarget = target;
    }
  }
  if (!bestTarget || !best) return null;

  if (isSolo && bestTarget !== 'track-guia' && bestTarget !== 'track-click' && bestTarget !== 'track-maestro') {
    return { target: 'track-solos', confidence: 1, instrumentName: `${best.childName} Solo` };
  }

  return { target: bestTarget, confidence: Math.min(1, best.weight / 10), instrumentName: best.childName };
}

export function isUnreadableName(fileName: string): boolean {
  const baseName = stripExt(fileName).replace(/[-_\s\d]/g, '');
  if (baseName.length < 2) return true;
  const vowels = baseName.match(/[aeiouáéíóúãõ]/gi);
  if (!vowels || vowels.length / baseName.length < 0.15) return true;
  return false;
}
