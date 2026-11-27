/**
 * Lista única dos comandos do programa (como os Key Commands do Logic e as Actions do REAPER):
 * nome, grupo, atalho padrão e as regras de quando a tecla vale. A ação de cada comando é
 * registrada em tempo de execução por quem sabe fazê-la (ver dispatcher.ts). Sem React, para
 * testar no node.
 *
 * O atalho padrão de cada comando é exatamente o de antes desta lista existir.
 */
import {
  comboLabel, comboToAccelerator, eventToCombo, normalizeCombo, parseCombo, reservedReason, swapMod,
  withoutMod, type KeyLike, type Platform,
} from './combo.ts';

export const GROUPS = [
  'Transporte', 'Playlist', 'Arquivo', 'Edição', 'Timeline', 'Regiões', 'Visualizar',
  'Mixer', 'Faixa', 'Click', 'Maestro', 'Modo Show', 'Pads', 'Janela',
] as const;
export type GroupName = typeof GROUPS[number];

export interface CommandDef {
  id: string;
  name: string;
  group: GroupName;
  /** Atalhos padrão (os de hoje). Vazio: sem atalho, o usuário pode dar um. */
  defaults: string[];
  /**
   * Onde a tecla vale (aparece na janela de atalhos). Combinações entre chaves, como {Mod+X},
   * viram o texto do sistema (⌘X no Mac, Ctrl+X no Windows); {Mod} sozinho vira ⌘ ou Ctrl.
   * Também pode ser um texto diferente em cada sistema.
   */
  hint?: string | { mac: string; win: string };
  /**
   * Folga do atalho PADRÃO, para não mudar o que já funcionava (só quando nenhum comando tem
   * a combinação exata: o atalho que o usuário gravou sempre ganha da folga):
   * 'shift' = com Shift junto também vale (P e ⇧P abrem os pads);
   * 'alt' = com Option/Alt junto também vale (⌥⌘Z desfaz);
   * 'shiftAlt' = com Shift e/ou Option/Alt junto também vale (⇧⌘C copia, Alt+M abre o mixer);
   * 'all' = com qualquer modificador junto também vale (Espaço, Delete, Esc).
   */
  loose?: 'shift' | 'alt' | 'shiftAlt' | 'all';
  /** Só existe nestes sistemas (Ocultar é só do Mac). Sem isto, vale nos dois. */
  platforms?: Platform[];
  /** Vale também dentro de campo de texto (só o Salvar). */
  inText?: boolean;
  /** Vale com o foco numa lista de escolha (SELECT). */
  inSelect?: boolean;
  /** Tecla segurada (repetição) não repete o comando, mas a tecla continua tomada. */
  noRepeat?: boolean;
  /** Tira o foco do botão/lista antes (Espaço não "clica" o botão focado). */
  blur?: boolean;
  /** Se uma janela ou menu por cima já tratou a tecla, não faz nada. */
  yieldIfHandled?: boolean;
  /** Escuta antes de todos (fase de captura) e não deixa a tecla seguir. */
  capture?: boolean;
  /** Entre comandos na mesma tecla, o maior vai primeiro. */
  priority?: number;
  /** Executado pelo menu do Mac/Windows (role do Electron), não pela tela. */
  native?: boolean;
  /** Atalho do sistema: aparece na lista, mas não muda. */
  locked?: boolean;
  /** Tem item no menu nativo: o atalho do usuário vai para o accelerator. */
  menu?: boolean;
}

const C = (def: CommandDef) => def;

const PAD_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const COMMANDS: CommandDef[] = [
  // Transporte
  C({ id: 'transport.playPause', name: 'Tocar / Pausar', group: 'Transporte', defaults: ['Space'], loose: 'all', inSelect: true, noRepeat: true, blur: true, priority: 100, hint: 'Em todo o programa, menos ao digitar. No Modo Show só toca.' }),
  C({ id: 'transport.stop', name: 'Parar (volta ao último marcador ou ao início)', group: 'Transporte', defaults: ['Escape'], loose: 'all', yieldIfHandled: true, hint: 'Fora do Modo Show. Uma janela aberta fecha antes.' }),
  C({ id: 'transport.goToStart', name: 'Ir para o início da música', group: 'Transporte', defaults: ['Home'], noRepeat: true, hint: 'Com uma música aberta.' }),
  C({ id: 'transport.goToEnd', name: 'Ir para o fim da música', group: 'Transporte', defaults: ['End'], noRepeat: true, hint: 'Só com a música parada.' }),
  C({ id: 'transport.cyclePlayFlow', name: 'Alternar fluxo de reprodução', group: 'Transporte', defaults: [], noRepeat: true }),

  // Playlist
  C({ id: 'playlist.setNext', name: 'Definir / remover Próxima música', group: 'Playlist', defaults: [], noRepeat: true, hint: 'Com uma música selecionada. Não vale no fluxo Uma a Uma.' }),
  C({ id: 'playlist.createBlock', name: 'Criar bloco a partir da música selecionada', group: 'Playlist', defaults: [], noRepeat: true }),
  C({ id: 'playlist.duplicateSong', name: 'Duplicar música', group: 'Playlist', defaults: [], noRepeat: true }),
  C({ id: 'playlist.removeSong', name: 'Excluir música', group: 'Playlist', defaults: [], noRepeat: true, hint: 'Tira a música selecionada (o Desfazer traz de volta).' }),
  C({ id: 'playlist.search', name: 'Pesquisar música', group: 'Playlist', defaults: [], noRepeat: true }),

  // Arquivo
  C({ id: 'file.save', name: 'Salvar', group: 'Arquivo', defaults: ['Mod+S'], loose: 'shiftAlt', inText: true, inSelect: true, noRepeat: true, hint: 'Vale até enquanto digita.' }),
  C({ id: 'file.saveAs', name: 'Salvar Projeto...', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'file.open', name: 'Abrir Projeto...', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'file.new', name: 'Novo Projeto', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'file.importVS', name: 'Importar VS...', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'file.aiCreateVS', name: 'Criar VS a partir de Música (IA)...', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'file.backups', name: 'Histórico de Backups...', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'file.autoOpenLast', name: 'Abrir o Último Projeto ao Iniciar (liga / desliga)', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'file.export', name: 'Exportar áudio', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'settings.audioDevice', name: 'Dispositivo de Áudio...', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'tools.teleprompter', name: 'Teleprompter...', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'tools.localNetwork', name: 'Rede Local...', group: 'Arquivo', defaults: [], noRepeat: true }),
  C({ id: 'tools.showOnline', name: 'Show Online...', group: 'Arquivo', defaults: [], noRepeat: true }),

  // Edição
  C({ id: 'edit.undo', name: 'Desfazer', group: 'Edição', defaults: ['Mod+Z'], loose: 'alt' }),
  C({ id: 'edit.redo', name: 'Refazer', group: 'Edição', defaults: ['Mod+Shift+Z', 'Mod+Y'], loose: 'shiftAlt' }),
  C({ id: 'edit.copyClips', name: 'Copiar clipes', group: 'Edição', defaults: ['Mod+C'], loose: 'shiftAlt', hint: 'Com clipe selecionado.' }),
  C({ id: 'edit.pasteClips', name: 'Colar clipes no cursor', group: 'Edição', defaults: ['Mod+V'], loose: 'shiftAlt', hint: 'Com clipes copiados.' }),
  C({ id: 'edit.duplicateClips', name: 'Duplicar clipes', group: 'Edição', defaults: ['Mod+D'], loose: 'shiftAlt', hint: 'Com clipe selecionado.' }),
  C({ id: 'edit.deleteClips', name: 'Excluir clipes selecionados', group: 'Edição', defaults: ['Delete', 'Backspace'], loose: 'all', yieldIfHandled: true, hint: 'Timeline destravada, fora do Modo Show.' }),
  C({ id: 'edit.selectAllClips', name: 'Selecionar todos os clipes da música', group: 'Edição', defaults: ['Mod+A'], loose: 'shiftAlt', hint: 'Fora do Modo Show.' }),
  C({ id: 'edit.split', name: 'Dividir clipes no cursor (Split)', group: 'Edição', defaults: ['S', 'Mod+T'], loose: 'shiftAlt', hint: 'Fora do Modo Show, com a música parada ou em pausa.' }),
  C({ id: 'edit.group', name: 'Agrupar clipes', group: 'Edição', defaults: ['Mod+G'], loose: 'alt', hint: 'Com 2 ou mais clipes selecionados.' }),
  C({ id: 'edit.glue', name: 'Emendar clipes (Unir)', group: 'Edição', defaults: ['Mod+Shift+G'], loose: 'alt' }),
  C({ id: 'edit.ungroup', name: 'Desagrupar clipes', group: 'Edição', defaults: ['Mod+U'], loose: 'shiftAlt' }),
  C({ id: 'edit.nativeText', name: 'Recortar / Copiar / Colar / Selecionar tudo (texto)', group: 'Edição', defaults: ['Mod+X'], native: true, locked: true, hint: 'Atalhos do sistema para texto ({Mod+X} {Mod+C} {Mod+V} {Mod+A}).' }),
  C({ id: 'app.keyCommands', name: 'Atalhos de teclado...', group: 'Edição', defaults: ['Alt+K'], noRepeat: true, menu: true, hint: 'Abre esta janela.' }),

  // Clipes (Timeline)
  C({ id: 'clip.mute', name: 'Mudo dos clipes selecionados', group: 'Timeline', defaults: [], noRepeat: true }),
  C({ id: 'clip.solo', name: 'Solo dos clipes selecionados', group: 'Timeline', defaults: [], noRepeat: true }),
  C({ id: 'clip.resetRouting', name: 'Voltar ao roteamento automático (clipes selecionados)', group: 'Timeline', defaults: [], noRepeat: true }),
  C({ id: 'clip.reclassifyAi', name: 'Reclassificar com IA (clipe selecionado)', group: 'Timeline', defaults: [], noRepeat: true }),
  C({ id: 'clip.export', name: 'Exportar este áudio (clipe selecionado)...', group: 'Timeline', defaults: [], noRepeat: true }),
  C({ id: 'clip.stemSplit', name: 'Separar stems (clipe selecionado)', group: 'Timeline', defaults: [], noRepeat: true }),
  C({ id: 'timeline.cutMedley', name: 'Fatiar medley no cursor', group: 'Timeline', defaults: [], noRepeat: true }),
  C({ id: 'timeline.lock', name: 'Travar / destravar timeline (cadeado)', group: 'Timeline', defaults: [], noRepeat: true }),

  // Regiões
  C({ id: 'timeline.addRegion', name: 'Nova região no cursor', group: 'Regiões', defaults: [], noRepeat: true }),
  C({ id: 'show.regionLoop', name: 'Loop da parte atual', group: 'Regiões', defaults: ['L'], loose: 'shift', inSelect: true, hint: 'Modo Show, com os atalhos das partes ligados.' }),
  C({ id: 'show.regionSkip', name: 'Pular para a próxima parte', group: 'Regiões', defaults: ['N'], loose: 'shift', inSelect: true, hint: 'Modo Show, com os atalhos das partes ligados.' }),
  C({ id: 'show.sectionKeys', name: 'Ligar / desligar atalhos das partes', group: 'Regiões', defaults: [], noRepeat: true }),

  // Visualizar
  C({ id: 'view.mixer', name: 'Mostrar / ocultar Mixer', group: 'Visualizar', defaults: ['M'], loose: 'shiftAlt' }),
  C({ id: 'view.playlist', name: 'Mostrar / ocultar Playlist', group: 'Visualizar', defaults: [], noRepeat: true }),
  C({ id: 'view.clipControls', name: 'Mostrar / ocultar controles de clipe', group: 'Visualizar', defaults: [], noRepeat: true }),
  C({ id: 'view.bpmTower', name: 'Coluna de BPM', group: 'Visualizar', defaults: [], noRepeat: true }),
  C({ id: 'view.tunerTower', name: 'Coluna do Afinador (tom)', group: 'Visualizar', defaults: [], noRepeat: true }),
  C({ id: 'timeline.zoomInH', name: 'Aproximar (zoom horizontal)', group: 'Visualizar', defaults: [], hint: 'Também {Mod} + rolar sobre a timeline.' }),
  C({ id: 'timeline.zoomOutH', name: 'Afastar (zoom horizontal)', group: 'Visualizar', defaults: [] }),
  C({ id: 'timeline.zoomFit', name: 'Caber a música inteira na tela', group: 'Visualizar', defaults: [], noRepeat: true }),
  C({ id: 'timeline.trackHeightUp', name: 'Aumentar altura das faixas', group: 'Visualizar', defaults: [] }),
  C({ id: 'timeline.trackHeightDown', name: 'Diminuir altura das faixas', group: 'Visualizar', defaults: [] }),
  C({ id: 'view.zoomReset', name: 'Tamanho real da interface', group: 'Visualizar', defaults: ['Mod+0'], native: true, menu: true }),
  C({ id: 'view.zoomIn', name: 'Ampliar a interface', group: 'Visualizar', defaults: ['Mod+='], native: true, menu: true }),
  C({ id: 'view.zoomOut', name: 'Reduzir a interface', group: 'Visualizar', defaults: ['Mod+-'], native: true, menu: true }),
  C({ id: 'view.fullscreen', name: 'Tela cheia', group: 'Visualizar', defaults: [], native: true, menu: true, hint: { mac: 'Padrão do sistema: {Mod+Ctrl+F}.', win: 'Padrão do sistema: F11.' } }),

  // Mixer
  C({ id: 'transport.clearSolos', name: 'Tirar todos os solos', group: 'Mixer', defaults: [], noRepeat: true }),
  C({ id: 'mixer.levelMatch', name: 'Igualar volume entre os VS (liga / desliga)', group: 'Mixer', defaults: [], noRepeat: true }),
  C({ id: 'mixer.magicRouting', name: 'Roteamento mágico (liga / desliga)', group: 'Mixer', defaults: [], noRepeat: true }),
  C({ id: 'mixer.masterAntiClip', name: 'Anti-clip do Master (liga / desliga)', group: 'Mixer', defaults: [], noRepeat: true }),

  // Faixa selecionada
  C({ id: 'track.mute', name: 'Mudo da faixa selecionada', group: 'Faixa', defaults: [], noRepeat: true }),
  C({ id: 'track.solo', name: 'Solo da faixa selecionada', group: 'Faixa', defaults: [], noRepeat: true }),
  C({ id: 'track.duplicate', name: 'Duplicar a faixa selecionada', group: 'Faixa', defaults: [], noRepeat: true }),

  // Click
  C({ id: 'click.generate', name: 'Gerar click a partir da música', group: 'Click', defaults: [], noRepeat: true, hint: 'Na música aberta.' }),
  C({ id: 'click.addBar', name: 'Adicionar um compasso antes do início', group: 'Click', defaults: [], noRepeat: true, hint: 'Na música aberta.' }),
  C({ id: 'click.remake', name: 'Trocar som do click', group: 'Click', defaults: [], noRepeat: true, hint: 'Na música aberta.' }),

  // Maestro
  C({ id: 'maestro.newCue', name: 'Nova fala do Maestro no cursor', group: 'Maestro', defaults: [], noRepeat: true, hint: 'Fora do Modo Show.' }),
  C({ id: 'maestro.countIn', name: 'Contagem no click (1, 2, 3, 4)', group: 'Maestro', defaults: [], noRepeat: true, hint: 'Fora do Modo Show.' }),
  C({ id: 'maestro.consolidate', name: 'Consolidar falas na faixa Maestro', group: 'Maestro', defaults: [], noRepeat: true, hint: 'Na música aberta.' }),
  C({ id: 'maestro.deleteCue', name: 'Apagar a fala do Maestro selecionada', group: 'Maestro', defaults: ['Delete', 'Backspace'], loose: 'all', capture: true, priority: 10, hint: 'Com uma fala selecionada na régua das falas.' }),

  // Modo Show
  C({ id: 'view.showMode', name: 'Abrir / fechar Modo Show', group: 'Modo Show', defaults: ['Mod+M'], noRepeat: true, menu: true }),
  C({ id: 'show.exit', name: 'Sair do Modo Show', group: 'Modo Show', defaults: ['Escape'], loose: 'all', yieldIfHandled: true, priority: 5, hint: 'Só no Modo Show. Uma janela aberta fecha antes.' }),

  // Pads
  C({ id: 'show.padsPanel', name: 'Abrir / fechar os Pads', group: 'Pads', defaults: ['P'], loose: 'shift', noRepeat: true, hint: 'Só no Modo Show.' }),
  ...PAD_KEYS.map((n) => C({ id: `show.pad${n}`, name: `Tocar o pad ${n} do banco`, group: 'Pads', defaults: [String(n)], hint: 'Modo Show, com os pads à vista.' })),
  ...PAD_KEYS.map((n) => C({ id: `show.padRoll${n}`, name: `ROLL do pad ${n} do banco`, group: 'Pads', defaults: [`Shift+${n}`], noRepeat: true, hint: 'Modo Show, com os pads à vista.' })),
  C({ id: 'show.padRollSelected', name: 'ROLL do pad escolhido', group: 'Pads', defaults: ['R'], loose: 'shift', hint: 'Modo Show, com os pads à vista.' }),
  C({ id: 'show.padsFade', name: 'Fade dos pads (2 s)', group: 'Pads', defaults: [], noRepeat: true, hint: 'Modo Show.' }),
  C({ id: 'show.padsStop', name: 'Parar todos os pads', group: 'Pads', defaults: [], noRepeat: true, hint: 'Modo Show.' }),

  // Janela (menu do programa)
  C({ id: 'window.minimize', name: 'Minimizar', group: 'Janela', defaults: ['Mod+Alt+M'], native: true, menu: true }),
  C({ id: 'app.checkUpdates', name: 'Verificar Atualizações...', group: 'Janela', defaults: [], native: true, menu: true }),
  C({ id: 'window.close', name: 'Fechar janela', group: 'Janela', defaults: ['Mod+W'], native: true, locked: true }),
  C({ id: 'app.quit', name: 'Encerrar VS Stage Pro', group: 'Janela', defaults: ['Mod+Q'], native: true, locked: true }),
  C({ id: 'app.hide', name: 'Ocultar VS Stage Pro (Mac)', group: 'Janela', defaults: ['Mod+H'], native: true, locked: true, platforms: ['mac'] }),
];

export const COMMAND_BY_ID: ReadonlyMap<string, CommandDef> = new Map(COMMANDS.map((c) => [c.id, c]));

/** O comando existe neste sistema? (Ocultar é só do Mac) */
export function availableOn(def: CommandDef, platform: Platform): boolean {
  return !def.platforms || def.platforms.includes(platform);
}

/** Dica do comando com os símbolos do sistema: {Mod+X} vira ⌘X no Mac e Ctrl+X no Windows. */
export function commandHint(def: CommandDef, platform: Platform): string {
  const raw = typeof def.hint === 'string' ? def.hint : def.hint ? def.hint[platform] : '';
  return raw.replace(/\{([^{}]+)\}/g, (all, combo: string) => {
    if (combo === 'Mod') return platform === 'mac' ? '⌘' : 'Ctrl';
    return comboLabel(combo, platform) || all;
  });
}

export type Bindings = Record<string, string[]>;
/** O que o usuário mudou: só os comandos diferentes do padrão. */
export type Overrides = Record<string, string[]>;

export function defaultBindings(): Bindings {
  const out: Bindings = {};
  for (const c of COMMANDS) out[c.id] = [...c.defaults];
  return out;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Atalhos valendo: o padrão com as mudanças do usuário por cima (inválidos e repetidos saem). */
export function resolveBindings(overrides: Overrides | null | undefined): Bindings {
  const out = defaultBindings();
  if (!overrides || typeof overrides !== 'object') return out;
  for (const [id, list] of Object.entries(overrides)) {
    const def = COMMAND_BY_ID.get(id);
    if (!def || def.locked || !Array.isArray(list)) continue;
    const clean: string[] = [];
    for (const raw of list) {
      const c = typeof raw === 'string' ? normalizeCombo(raw) : null;
      if (c && !clean.includes(c)) clean.push(c);
    }
    out[id] = clean;
  }
  return out;
}

export function computeOverrides(bindings: Bindings): Overrides {
  const out: Overrides = {};
  for (const c of COMMANDS) {
    const cur = bindings[c.id] ?? [];
    if (!c.locked && !sameList(cur, c.defaults)) out[c.id] = [...cur];
  }
  return out;
}

export function isModified(bindings: Bindings, id: string): boolean {
  const def = COMMAND_BY_ID.get(id);
  return !!def && !sameList(bindings[id] ?? [], def.defaults);
}

/** Dois comandos que já dividiam a tecla no padrão (Esc, Delete) podem continuar dividindo. */
function canShare(a: CommandDef, b: CommandDef, combo: string): boolean {
  return a.defaults.includes(combo) && b.defaults.includes(combo);
}

/**
 * Outro comando que já usa esta combinação (null se ninguém). Os do sistema (travados) não
 * entram: não dá para tirar a tecla deles, então o validateCombo já recusa a combinação.
 */
export function findConflict(bindings: Bindings, id: string, combo: string): string | null {
  const c = normalizeCombo(combo);
  const me = COMMAND_BY_ID.get(id);
  if (!c || !me) return null;
  for (const other of COMMANDS) {
    if (other.id === id || other.locked) continue;
    if (!(bindings[other.id] ?? []).includes(c)) continue;
    if (canShare(me, other, c)) continue;
    return other.id;
  }
  return null;
}

/** Pode gravar esta combinação neste comando? Devolve o motivo em português, ou null. */
export function validateCombo(id: string, combo: string, platform: Platform): string | null {
  const def = COMMAND_BY_ID.get(id);
  if (!def) return 'Comando desconhecido';
  if (def.locked) return 'Atalho do sistema: não dá para trocar';
  const c = normalizeCombo(combo);
  if (!c) return 'Combinação inválida';
  if (!def.defaults.includes(c)) {
    const r = reservedReason(c, platform);
    if (r) return `Reservada: ${r}`;
    // a tecla de um comando do sistema (Recortar, Ocultar) não pode ir para outro comando:
    // o menu do Mac/Windows continuaria disparando junto
    const sys = COMMANDS.find((o) => o.locked && o.id !== id && availableOn(o, platform) && o.defaults.includes(c));
    if (sys) return `Reservada: ${sys.name}`;
  }
  // os itens do menu do sistema só aceitam combinação com ⌘/Ctrl, Option/Alt ou tecla F
  if (def.native && !comboToAccelerator(c)) {
    return platform === 'mac'
      ? 'Este comando é do menu do sistema: use ⌘, ⌥ (Option), ⌃ (Control) ou uma tecla F junto'
      : 'Este comando é do menu do sistema: use Ctrl, Alt ou uma tecla F junto';
  }
  return null;
}

/**
 * Grava a combinação no comando. Com `steal`, tira do outro comando que a usava.
 * `replace` troca um atalho já existente do comando (clicou nele para regravar).
 */
export function assignCombo(bindings: Bindings, id: string, combo: string, opts: { steal?: boolean; replace?: string } = {}): Bindings {
  const c = normalizeCombo(combo);
  if (!c || !COMMAND_BY_ID.has(id)) return bindings;
  const next: Bindings = { ...bindings };
  if (opts.steal) {
    for (;;) {
      const other = findConflict(next, id, c);
      if (!other) break;
      next[other] = (next[other] ?? []).filter((x) => x !== c);
    }
  }
  const cur = [...(next[id] ?? [])];
  const at = opts.replace ? cur.indexOf(opts.replace) : -1;
  if (at >= 0) cur.splice(at, 1, c);
  else cur.push(c);
  next[id] = cur.filter((x, i) => cur.indexOf(x) === i);
  return next;
}

export function removeCombo(bindings: Bindings, id: string, combo: string): Bindings {
  return { ...bindings, [id]: (bindings[id] ?? []).filter((x) => x !== combo) };
}

/**
 * Volta o comando ao padrão. Se outro comando pegou uma das teclas padrão dele, ela sai do outro
 * (senão a mesma tecla faria duas coisas).
 */
export function restoreCommand(bindings: Bindings, id: string): Bindings {
  const def = COMMAND_BY_ID.get(id);
  if (!def) return bindings;
  let next: Bindings = { ...bindings, [id]: [] };
  for (const c of def.defaults) next = assignCombo(next, id, c, { steal: true });
  return next;
}

export function restoreAll(): Bindings {
  return defaultBindings();
}

/** Modificadores a mais que a folga aceita em cima do atalho padrão. */
const LOOSE_EXTRA: Record<NonNullable<CommandDef['loose']>, readonly string[] | null> = {
  shift: ['Shift'], alt: ['Alt'], shiftAlt: ['Shift', 'Alt'], all: null,
};

/** A combinação apertada cai na folga deste atalho padrão? (exata não conta) */
function looseHit(c: CommandDef, b: string, cb: string): boolean {
  if (!c.loose) return false;
  const bp = parseCombo(b);
  const p = parseCombo(cb);
  if (!bp || !p || bp.key !== p.key) return false;
  for (const m of bp.mods) if (!p.mods.has(m)) return false;
  const extra = [...p.mods].filter((m) => !bp.mods.has(m));
  if (extra.length === 0) return false;
  const allowed = LOOSE_EXTRA[c.loose];
  if (allowed === null) return bp.mods.size === 0;
  return extra.every((m) => allowed.includes(m));
}

/**
 * Quais comandos esta tecla chama, na ordem de tentativa:
 * 1) atalho exato; 2) a folga dos atalhos padrão (Shift ou Option junto, ou qualquer
 * modificador), só quando nenhum comando tem a combinação exata: o atalho que o usuário
 * gravou ganha da folga, e a mesma tecla nunca dispara dois comandos; 3) a tecla Control do
 * Mac (ou a tecla Windows) contando como ⌘/Ctrl, como sempre foi, quando ninguém gravou a
 * combinação com ela. Dentro de cada passo, o de maior prioridade primeiro.
 */
export function matchCommands(e: KeyLike, bindings: Bindings, platform: Platform): string[] {
  const combo = eventToCombo(e, platform);
  if (!combo) return [];
  const out: string[] = [];
  const add = (ids: string[]) => {
    ids.sort((a, b) => (COMMAND_BY_ID.get(b)?.priority ?? 0) - (COMMAND_BY_ID.get(a)?.priority ?? 0));
    for (const id of ids) if (!out.includes(id)) out.push(id);
  };
  /** true se algum comando tem esta combinação exata. */
  const tryCombo = (cb: string): boolean => {
    const exact = COMMANDS.filter((c) => availableOn(c, platform) && (bindings[c.id] ?? []).includes(cb)).map((c) => c.id);
    add(exact);
    if (exact.length > 0) return true;
    const loose: string[] = [];
    for (const c of COMMANDS) {
      if (!c.loose || !availableOn(c, platform)) continue;
      if ((bindings[c.id] ?? []).some((b) => c.defaults.includes(b) && looseHit(c, b, cb))) loose.push(c.id);
    }
    add(loose);
    return false;
  };
  if (tryCombo(combo)) return out;
  // Control do Mac contando como ⌘ (⌃⌘ também conta, como o ctrlKey||metaKey de antes);
  // no Windows, a tecla Windows contando como Ctrl
  const p = parseCombo(combo);
  let legacy = combo;
  if (platform === 'mac' && p?.mods.has('Ctrl')) legacy = p.mods.has('Mod') ? withoutMod(combo, 'Ctrl') : swapMod(combo, 'Ctrl', 'Mod');
  if (platform === 'win' && p?.mods.has('Meta')) legacy = p.mods.has('Mod') ? withoutMod(combo, 'Meta') : swapMod(combo, 'Meta', 'Mod');
  if (legacy !== combo) tryCombo(legacy);
  return out;
}

/**
 * Accelerators para o menu do Electron (id do comando → "CmdOrCtrl+M", ou '' sem atalho).
 * Os itens do sistema (role do Electron) só entram quando o usuário deu um atalho a eles:
 * sem isso, o menu continua com o atalho padrão do próprio sistema.
 */
export function menuAccelerators(bindings: Bindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of COMMANDS) {
    if (!c.menu) continue;
    const list = bindings[c.id] ?? [];
    let acc = '';
    for (const b of list) { acc = comboToAccelerator(b); if (acc) break; }
    if (c.native && (!isModified(bindings, c.id) || !acc)) continue;
    out[c.id] = acc;
  }
  return out;
}

export const EXPORT_KIND = 'vs-stage-atalhos';

export function exportShortcuts(bindings: Bindings): string {
  const atalhos: Record<string, string[]> = {};
  for (const c of COMMANDS) if (!c.locked) atalhos[c.id] = [...(bindings[c.id] ?? [])];
  return JSON.stringify({ tipo: EXPORT_KIND, versao: 1, atalhos }, null, 2);
}

export interface ImportResult {
  bindings: Bindings;
  /** Atalhos do arquivo que não entraram (inválidos, reservados ou repetidos). */
  ignored: number;
}

/** Lê um arquivo exportado. Erro com mensagem em português se não for um arquivo de atalhos. */
export function importShortcuts(text: string, platform: Platform): ImportResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('O arquivo não é um JSON válido.'); }
  const obj = data as { tipo?: unknown; atalhos?: unknown } | null;
  if (!obj || typeof obj !== 'object' || obj.tipo !== EXPORT_KIND || !obj.atalhos || typeof obj.atalhos !== 'object') {
    throw new Error('Este arquivo não é de atalhos do VS Stage.');
  }
  const src = obj.atalhos as Record<string, unknown>;
  let bindings = defaultBindings();
  // os comandos que vêm no arquivo começam vazios; os que faltam ficam no padrão
  for (const id of Object.keys(src)) {
    const def = COMMAND_BY_ID.get(id);
    if (def && !def.locked && Array.isArray(src[id])) bindings[id] = [];
  }
  let ignored = 0;
  for (const [id, list] of Object.entries(src)) {
    const def = COMMAND_BY_ID.get(id);
    if (!def || def.locked || !Array.isArray(list)) { if (Array.isArray(list)) ignored += list.length; continue; }
    for (const raw of list) {
      let c = typeof raw === 'string' ? normalizeCombo(raw) : null;
      // arquivo feito no Mac: o Control (⌃) não existe sozinho no Windows, lá ele vira o Ctrl
      // de sempre (Mod); sem isso o atalho entra, aparece sem o Ctrl e nunca dispara
      if (c && platform === 'win' && parseCombo(c)?.mods.has('Ctrl')) {
        c = normalizeCombo(parseCombo(c)!.mods.has('Mod') ? withoutMod(c, 'Ctrl') : swapMod(c, 'Ctrl', 'Mod'));
      }
      if (!c || validateCombo(id, c, platform) || findConflict(bindings, id, c)) { ignored++; continue; }
      bindings = assignCombo(bindings, id, c);
    }
  }
  return { bindings, ignored };
}
