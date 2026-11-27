// Atalhos de teclado personalizáveis (como os Key Commands do Logic): padrão igual ao de antes,
// gravar, conflito, restaurar, exportar/importar, campo de texto e ⌘ no Mac / Ctrl no Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { comboLabel, comboToAccelerator, eventToCombo, isTextTarget, normalizeCombo } from '../src/lib/shortcuts/combo.ts';
import {
  COMMANDS, COMMAND_BY_ID, assignCombo, computeOverrides, defaultBindings, exportShortcuts, findConflict,
  importShortcuts, matchCommands, menuAccelerators, removeCombo, resolveBindings, restoreAll, restoreCommand, validateCombo,
  availableOn, commandHint,
} from '../src/lib/shortcuts/registry.ts';
import { createCommandGate, dispatchKey, menuCommandDecision } from '../src/lib/shortcuts/dispatchCore.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Evento de mentira: guarda se tomou a tecla. */
function ev(key, opts = {}) {
  return {
    key, code: opts.code, metaKey: !!opts.meta, ctrlKey: !!opts.ctrl, altKey: !!opts.alt, shiftKey: !!opts.shift,
    repeat: !!opts.repeat, defaultPrevented: !!opts.prevented, target: opts.target ?? null,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}
const letter = (ch, opts = {}) => ev(opts.shift ? ch.toUpperCase() : ch, { code: `Key${ch.toUpperCase()}`, ...opts });

test('padrão igual ao de antes da lista de atalhos', () => {
  const d = defaultBindings();
  const want = {
    'transport.playPause': ['Space'], 'transport.stop': ['Escape'], 'transport.goToStart': ['Home'], 'transport.goToEnd': ['End'],
    'file.save': ['Mod+S'], 'edit.undo': ['Mod+Z'], 'edit.redo': ['Mod+Shift+Z', 'Mod+Y'],
    'edit.copyClips': ['Mod+C'], 'edit.pasteClips': ['Mod+V'], 'edit.duplicateClips': ['Mod+D'],
    'edit.deleteClips': ['Delete', 'Backspace'], 'edit.selectAllClips': ['Mod+A'], 'edit.split': ['S', 'Mod+T'],
    'edit.group': ['Mod+G'], 'edit.glue': ['Mod+Shift+G'], 'edit.ungroup': ['Mod+U'],
    'view.mixer': ['M'], 'view.showMode': ['Mod+M'], 'show.exit': ['Escape'], 'maestro.deleteCue': ['Delete', 'Backspace'],
    'show.padsPanel': ['P'], 'show.padRollSelected': ['R'], 'show.regionLoop': ['L'], 'show.regionSkip': ['N'],
    'app.keyCommands': ['Alt+K'], 'window.minimize': ['Mod+Alt+M'],
  };
  for (const [id, list] of Object.entries(want)) assert.deepEqual(d[id], list, id);
  for (let n = 1; n <= 9; n++) {
    assert.deepEqual(d[`show.pad${n}`], [String(n)]);
    assert.deepEqual(d[`show.padRoll${n}`], [`Shift+${n}`]);
  }
  // "Duplicar música" não tinha tecla de verdade (o ⌘D duplica clipes): continua sem
  assert.deepEqual(d['playlist.duplicateSong'], []);
  // todo comando do mapa entra, mesmo sem atalho
  for (const id of ['transport.cyclePlayFlow', 'playlist.setNext', 'playlist.createBlock', 'file.export', 'timeline.addRegion',
    'timeline.cutMedley', 'timeline.zoomInH', 'track.mute', 'track.solo', 'maestro.newCue', 'click.generate', 'show.padsFade']) {
    assert.ok(COMMAND_BY_ID.has(id), id);
  }
  // ids únicos e todos os padrões válidos
  assert.equal(new Set(COMMANDS.map((c) => c.id)).size, COMMANDS.length);
  for (const c of COMMANDS) for (const k of c.defaults) assert.equal(normalizeCombo(k), k, `${c.id} ${k}`);
});

test('padrão: as teclas de antes chamam os mesmos comandos (Mac e Windows)', () => {
  const b = defaultBindings();
  const first = (e, p) => matchCommands(e, b, p)[0];
  for (const p of ['mac', 'win']) {
    const mod = p === 'mac' ? { meta: true } : { ctrl: true };
    assert.equal(first(ev(' ', { code: 'Space' }), p), 'transport.playPause');
    assert.equal(first(ev(' ', { code: 'Space', shift: true }), p), 'transport.playPause');
    assert.equal(first(letter('s', mod), p), 'file.save');
    assert.equal(first(letter('s', { ...mod, shift: true }), p), 'file.save', 'Shift junto também salvava');
    assert.equal(first(letter('z', mod), p), 'edit.undo');
    assert.equal(first(letter('z', { ...mod, shift: true }), p), 'edit.redo');
    assert.equal(first(letter('y', mod), p), 'edit.redo');
    assert.equal(first(letter('d', { ...mod, shift: true }), p), 'edit.duplicateClips');
    assert.equal(first(letter('g', { ...mod, shift: true }), p), 'edit.glue');
    assert.equal(first(letter('g', mod), p), 'edit.group');
    assert.equal(first(letter('m', mod), p), 'view.showMode');
    assert.equal(first(letter('m'), p), 'view.mixer');
    assert.equal(first(letter('m', { shift: true }), p), 'view.mixer', 'Shift+M também abria o mixer');
    assert.equal(first(letter('s'), p), 'edit.split');
    assert.equal(first(letter('s', { shift: true }), p), 'edit.split');
    assert.equal(first(letter('t', mod), p), 'edit.split');
    assert.equal(first(ev('Home'), p), 'transport.goToStart');
    assert.equal(first(ev('Home', { shift: true }), p), undefined, 'Home com Shift não fazia nada');
    assert.deepEqual(matchCommands(ev('Escape'), b, p), ['show.exit', 'transport.stop']);
    assert.deepEqual(matchCommands(ev('Delete'), b, p), ['maestro.deleteCue', 'edit.deleteClips']);
    assert.deepEqual(matchCommands(ev('Backspace', mod), b, p), ['maestro.deleteCue', 'edit.deleteClips']);
    assert.equal(first(ev('1', { code: 'Digit1' }), p), 'show.pad1');
    assert.equal(first(ev('!', { code: 'Digit1', shift: true }), p), 'show.padRoll1');
    assert.equal(first(letter('p', { shift: true }), p), 'show.padsPanel');
  }
  // Mac: a tecla Control também contava como ⌘ (Ctrl+S salvava); Option+K vira "˚" mas é Alt+K
  assert.equal(first(letter('s', { ctrl: true }), 'mac'), 'file.save');
  assert.equal(first(ev('˚', { code: 'KeyK', alt: true }), 'mac'), 'app.keyCommands');
  // Windows: a tecla Windows também contava como Ctrl
  assert.equal(first(letter('s', { meta: true }), 'win'), 'file.save');
  assert.equal(first(letter('k', { alt: true }), 'win'), 'app.keyCommands');
});

test('Mac usa ⌘ e Windows usa Ctrl, com o símbolo certo', () => {
  assert.equal(eventToCombo(letter('s', { meta: true }), 'mac'), 'Mod+S');
  assert.equal(eventToCombo(letter('s', { ctrl: true }), 'win'), 'Mod+S');
  assert.equal(eventToCombo(letter('s', { ctrl: true }), 'mac'), 'Ctrl+S');
  assert.equal(eventToCombo(letter('s', { meta: true }), 'win'), 'Meta+S');
  assert.equal(eventToCombo(ev('Shift', { shift: true }), 'mac'), null, 'só o modificador não é atalho');
  assert.equal(comboLabel('Mod+S', 'mac'), '⌘S');
  assert.equal(comboLabel('Mod+S', 'win'), 'Ctrl+S');
  assert.equal(comboLabel('Mod+Shift+G', 'mac'), '⇧⌘G');
  assert.equal(comboLabel('Mod+Shift+Z', 'mac'), '⇧⌘Z');
  assert.equal(comboLabel('Mod+Shift+G', 'win'), 'Ctrl+Shift+G');
  assert.equal(comboLabel('Alt+K', 'mac'), '⌥K');
  assert.equal(comboLabel('Alt+K', 'win'), 'Alt+K');
  assert.equal(comboLabel('Ctrl+Alt+Shift+Mod+X', 'mac'), '⌃⌥⇧⌘X');
  assert.equal(comboLabel('Backspace', 'mac'), '⌫');
  assert.equal(comboLabel('Delete', 'win'), 'Del');
  assert.equal(comboLabel('Space', 'win'), 'Espaço');
  // menu do Electron: CmdOrCtrl vira ⌘ no Mac e Ctrl no Windows; tecla solta não vai para o menu
  assert.equal(comboToAccelerator('Mod+M'), 'CmdOrCtrl+M');
  assert.equal(comboToAccelerator('Alt+K'), 'Alt+K');
  assert.equal(comboToAccelerator('Mod+Shift+ArrowUp'), 'CmdOrCtrl+Shift+Up');
  assert.equal(comboToAccelerator('M'), '');
  assert.equal(comboToAccelerator('Shift+M'), '');
  assert.equal(comboToAccelerator('F5'), 'F5');
});

test('gravar um atalho novo e ele passa a valer (e sobrevive ao salvar e ler de novo)', () => {
  let b = defaultBindings();
  b = assignCombo(b, 'playlist.setNext', 'Mod+Shift+N');
  assert.deepEqual(b['playlist.setNext'], ['Mod+Shift+N']);
  assert.equal(matchCommands(letter('n', { meta: true, shift: true }), b, 'mac')[0], 'playlist.setNext');
  assert.equal(matchCommands(letter('n', { ctrl: true, shift: true }), b, 'win')[0], 'playlist.setNext');
  // trocar um atalho existente (clicou nele e gravou outro)
  b = assignCombo(b, 'edit.split', 'X', { replace: 'S' });
  assert.deepEqual(b['edit.split'], ['X', 'Mod+T']);
  assert.notEqual(matchCommands(letter('s'), b, 'mac')[0], 'edit.split');
  // o que fica guardado é só o que mudou, e volta igual
  const ov = computeOverrides(b);
  assert.deepEqual(Object.keys(ov).sort(), ['edit.split', 'playlist.setNext']);
  assert.deepEqual(resolveBindings(JSON.parse(JSON.stringify(ov))), b);
  // apagar
  b = removeCombo(b, 'edit.split', 'Mod+T');
  assert.deepEqual(b['edit.split'], ['X']);
  // lixo guardado não derruba nada
  assert.deepEqual(resolveBindings({ 'nao.existe': ['A'], 'view.mixer': ['???', 'Mod+Mod+M', 'B', 'B'] })['view.mixer'], ['B']);
  assert.deepEqual(resolveBindings(null), defaultBindings());
});

test('conflito: avisa quem já usa e a troca tira do outro comando', () => {
  let b = defaultBindings();
  assert.equal(findConflict(b, 'transport.cyclePlayFlow', 'M'), 'view.mixer');
  assert.equal(findConflict(b, 'transport.cyclePlayFlow', 'Mod+Shift+F'), null);
  // Esc e Delete já eram divididos no padrão: não é conflito
  assert.equal(findConflict(b, 'maestro.deleteCue', 'Delete'), null);
  assert.equal(findConflict(b, 'show.exit', 'Escape'), null);
  // mas um comando novo no Delete é
  assert.ok(findConflict(b, 'track.mute', 'Delete'));
  b = assignCombo(b, 'transport.cyclePlayFlow', 'M', { steal: true });
  assert.deepEqual(b['transport.cyclePlayFlow'], ['M']);
  assert.deepEqual(b['view.mixer'], []);
  assert.equal(findConflict(b, 'transport.cyclePlayFlow', 'M'), null);
  assert.equal(matchCommands(letter('m'), b, 'mac')[0], 'transport.cyclePlayFlow');
});

test('restaurar o padrão de um comando e de todos', () => {
  let b = assignCombo(defaultBindings(), 'transport.cyclePlayFlow', 'M', { steal: true });
  b = restoreCommand(b, 'view.mixer');
  assert.deepEqual(b['view.mixer'], ['M']);
  assert.deepEqual(b['transport.cyclePlayFlow'], [], 'a tecla padrão sai de quem a tinha pegado');
  b = assignCombo(b, 'edit.undo', 'F1');
  b = restoreCommand(b, 'edit.undo');
  assert.deepEqual(b['edit.undo'], ['Mod+Z']);
  assert.deepEqual(restoreAll(), defaultBindings());
  assert.deepEqual(computeOverrides(restoreAll()), {});
});

test('teclas do sistema não podem ser gravadas', () => {
  assert.match(validateCombo('view.mixer', 'Mod+Q', 'mac'), /Reservada/);
  assert.match(validateCombo('view.mixer', 'Mod+Q', 'win'), /Reservada/);
  assert.match(validateCombo('view.mixer', 'Mod+Tab', 'mac'), /Reservada/);
  assert.match(validateCombo('view.mixer', 'Mod+H', 'mac'), /Reservada/);
  assert.match(validateCombo('view.mixer', 'Mod+Space', 'mac'), /Reservada/);
  assert.match(validateCombo('view.mixer', 'Alt+F4', 'win'), /Reservada/);
  assert.match(validateCombo('view.mixer', 'Alt+Tab', 'win'), /Reservada/);
  assert.match(validateCombo('view.mixer', 'Meta+E', 'win'), /Reservada/);
  assert.equal(validateCombo('view.mixer', 'Mod+H', 'win'), null, 'Ctrl+H no Windows é livre');
  assert.equal(validateCombo('view.mixer', 'Mod+Shift+X', 'mac'), null);
  // o atalho padrão do próprio comando continua valendo
  assert.equal(validateCombo('window.minimize', 'Mod+Alt+M', 'mac'), null);
  assert.match(validateCombo('view.mixer', 'Mod+Alt+M', 'mac'), /Reservada/);
  // comandos do sistema não mudam; itens do menu nativo precisam de ⌘/Option/F
  assert.match(validateCombo('app.quit', 'Mod+Shift+Q', 'mac'), /sistema/);
  assert.match(validateCombo('window.minimize', 'X', 'mac'), /menu do sistema/);
  assert.equal(validateCombo('window.minimize', 'Mod+Shift+M', 'mac'), null);
});

test('exportar e importar os atalhos num .json', () => {
  let b = assignCombo(defaultBindings(), 'track.solo', 'Alt+S');
  b = assignCombo(b, 'transport.cyclePlayFlow', 'M', { steal: true });
  const text = exportShortcuts(b);
  const data = JSON.parse(text);
  assert.equal(data.tipo, 'vs-stage-atalhos');
  assert.equal(data.versao, 1);
  assert.equal(data.atalhos['app.quit'], undefined, 'os do sistema não vão no arquivo');
  for (const p of ['mac', 'win']) {
    const { bindings, ignored } = importShortcuts(text, p);
    assert.equal(ignored, 0);
    assert.deepEqual(bindings, b);
  }
  // arquivo com lixo: entra o que dá, o resto é contado
  const messy = JSON.stringify({ tipo: 'vs-stage-atalhos', versao: 1, atalhos: {
    'track.mute': ['Mod+Q', 'Alt+M', 'nada'], 'nao.existe': ['F2'], 'track.solo': ['Alt+M'],
  } });
  const r = importShortcuts(messy, 'mac');
  assert.deepEqual(r.bindings['track.mute'], ['Alt+M']);
  assert.deepEqual(r.bindings['track.solo'], [], 'repetida no outro comando fica de fora');
  assert.equal(r.ignored, 4);
  assert.deepEqual(r.bindings['view.mixer'], ['M'], 'o que não vem no arquivo fica no padrão');
  assert.throws(() => importShortcuts('{ruim', 'mac'), /JSON/);
  assert.throws(() => importShortcuts(JSON.stringify({ tipo: 'outro', atalhos: {} }), 'mac'), /não é de atalhos/);
});

test('tratador único: campo de texto não dispara (só o Salvar), Espaço tem prioridade', () => {
  const b = defaultBindings();
  const calls = [];
  const handlers = {
    'transport.playPause': [() => { calls.push('play'); }],
    'view.mixer': [() => { calls.push('mixer'); }],
    'file.save': [() => { calls.push('save'); }],
    'edit.copyClips': [() => false], // sem clipe: deixa o copiar do sistema
    'show.exit': [() => false],
    'transport.stop': [() => { calls.push('stop'); }],
    'maestro.deleteCue': [() => { calls.push('cue'); }],
    'edit.deleteClips': [() => { calls.push('clips'); }],
  };
  const env = (phase = 'bubble', p = 'mac') => ({ platform: p, bindings: b, phase, handlers: (id) => handlers[id] ?? [] });
  const input = { tagName: 'INPUT', type: 'text' };
  const area = { tagName: 'TEXTAREA' };
  const editable = { tagName: 'DIV', isContentEditable: true };
  let blurred = 0;
  const button = { tagName: 'BUTTON', blur() { blurred++; } };
  const select = { tagName: 'SELECT', blur() { blurred++; } };

  for (const t of [input, area, editable]) {
    const e = letter('m', { target: t });
    assert.equal(dispatchKey(e, env()), null);
    assert.equal(e.prevented, false);
    const sp = ev(' ', { code: 'Space', target: t });
    assert.equal(dispatchKey(sp, env()), null, 'Espaço dentro de campo de texto digita espaço');
    assert.equal(sp.prevented, false);
    assert.equal(dispatchKey(letter('s', { meta: true, target: t }), env()), 'file.save', 'Salvar vale até digitando');
  }
  assert.equal(isTextTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTextTarget({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(isTextTarget({ tagName: 'INPUT' }), true);

  // Espaço num botão focado: tira o foco e toca, sem clicar o botão
  const sp = ev(' ', { code: 'Space', target: button });
  assert.equal(dispatchKey(sp, env()), 'transport.playPause');
  assert.equal(sp.prevented, true);
  assert.equal(blurred, 1);
  // Espaço numa lista de escolha também; letras não
  assert.equal(dispatchKey(ev(' ', { code: 'Space', target: select }), env()), 'transport.playPause');
  assert.equal(dispatchKey(letter('m', { target: select }), env()), null);
  // segurando o Espaço: toma a tecla, mas não alterna de novo
  const before = calls.filter((c) => c === 'play').length;
  const rep = ev(' ', { code: 'Space', repeat: true });
  assert.equal(dispatchKey(rep, env()), 'transport.playPause');
  assert.equal(rep.prevented, true);
  assert.equal(calls.filter((c) => c === 'play').length, before);

  // ação que não fez nada (⌘C sem clipe): a tecla segue para o sistema
  const copy = letter('c', { meta: true });
  assert.equal(dispatchKey(copy, env()), null);
  assert.equal(copy.prevented, false);
  // Esc fora do Modo Show: o Sair não faz nada e o Parar fica com a tecla
  assert.equal(dispatchKey(ev('Escape'), env()), 'transport.stop');
  // janela por cima já tratou o Esc: nada
  assert.equal(dispatchKey(ev('Escape', { prevented: true }), env()), null);
  // Delete: a fala do Maestro (captura) vem antes e a tecla não segue
  const del = ev('Delete');
  assert.equal(dispatchKey(del, env('capture')), 'maestro.deleteCue');
  assert.equal(del.stopped, true);
  assert.equal(dispatchKey(ev('Delete'), env('bubble')), 'edit.deleteClips');
  assert.equal(dispatchKey(ev('Delete', { prevented: true }), env('bubble')), null, 'não apaga duas vezes');
  // comando sem ação na tela agora (timeline fora): a tecla fica livre
  const split = letter('s');
  assert.equal(dispatchKey(split, env()), null);
  assert.equal(split.prevented, false);
  // Windows: Ctrl+S salva
  assert.equal(dispatchKey(letter('s', { ctrl: true }), env('bubble', 'win')), 'file.save');
});

test('menu do Mac/Windows recebe os atalhos do usuário', () => {
  let b = defaultBindings();
  let acc = menuAccelerators(b);
  assert.equal(acc['view.showMode'], 'CmdOrCtrl+M');
  assert.equal(acc['app.keyCommands'], 'Alt+K');
  assert.equal(acc['window.minimize'], undefined, 'item do sistema sem mudança fica com o padrão do sistema');
  b = assignCombo(b, 'view.showMode', 'Mod+Shift+M', { replace: 'Mod+M' });
  b = assignCombo(b, 'window.minimize', 'Mod+Shift+J', { replace: 'Mod+Alt+M' });
  acc = menuAccelerators(b);
  assert.equal(acc['view.showMode'], 'CmdOrCtrl+Shift+M');
  assert.equal(acc['window.minimize'], 'CmdOrCtrl+Shift+J');
  // Modo Show numa tecla solta: o menu fica sem atalho (senão roubaria a digitação)
  b = assignCombo(b, 'view.showMode', 'F', { replace: 'Mod+Shift+M' });
  assert.equal(menuAccelerators(b)['view.showMode'], '');

  const main = read('desktop/main.js');
  assert.match(main, /ipcMain\.on\('menu:setShortcuts'/);
  assert.match(main, /label: 'Atalhos de Teclado\.\.\.'/);
  assert.match(main, /accelerator: menuAcc\('view\.showMode', 'CmdOrCtrl\+M'\)/);
  const preload = read('desktop/preload.js');
  assert.match(preload, /setMenuShortcuts:/);
  assert.match(preload, /onMenuCommand:/);
});

test('os tratadores espalhados passaram para o tratador único', () => {
  const app = read('src/App.tsx');
  assert.doesNotMatch(app, /window\.addEventListener\('keydown', handler\)/);
  assert.match(app, /installShortcuts\(\)/);
  assert.match(app, /registerAppCommands\(/);
  const timeline = read('src/components/TimelinePanel.tsx');
  assert.doesNotMatch(timeline, /key === 'g'/);
  assert.match(timeline, /useCommand\('edit\.split'/);
  assert.match(timeline, /useCommand\('edit\.deleteClips'[\s\S]*?priority: 1/);
  const pads = read('src/components/SamplePadPanel.tsx');
  assert.doesNotMatch(pads, /addEventListener\('keydown', onKey\)/);
  const sections = read('src/components/SectionPads.tsx');
  assert.doesNotMatch(sections, /addEventListener\('keydown'/);
  const lane = read('src/components/NarrationLane.tsx');
  assert.match(lane, /registerCommand\('maestro\.deleteCue'/);
  // menus da tela sem ⌘ fixo
  const menu = read('src/components/MenuBar.tsx');
  assert.doesNotMatch(menu, /shortcut: '⌘/);
  assert.match(menu, /Atalhos de Teclado\.\.\./);
});

test('revisão: no Windows nenhum texto da janela de atalhos mostra ⌘ ou Option', () => {
  for (const c of COMMANDS) {
    const win = commandHint(c, 'win');
    assert.doesNotMatch(win, /[⌘⌥⌃⇧]|Option|\{/, `${c.id}: ${win}`);
    assert.doesNotMatch(commandHint(c, 'mac'), /\{|Ctrl\+/, c.id);
  }
  assert.equal(commandHint(COMMAND_BY_ID.get('edit.nativeText'), 'win'), 'Atalhos do sistema para texto (Ctrl+X Ctrl+C Ctrl+V Ctrl+A).');
  assert.equal(commandHint(COMMAND_BY_ID.get('edit.nativeText'), 'mac'), 'Atalhos do sistema para texto (⌘X ⌘C ⌘V ⌘A).');
  assert.equal(commandHint(COMMAND_BY_ID.get('timeline.zoomInH'), 'win'), 'Também Ctrl + rolar sobre a timeline.');
  assert.equal(commandHint(COMMAND_BY_ID.get('timeline.zoomInH'), 'mac'), 'Também ⌘ + rolar sobre a timeline.');
  assert.equal(commandHint(COMMAND_BY_ID.get('view.fullscreen'), 'mac'), 'Padrão do sistema: ⌃⌘F.');
  assert.equal(commandHint(COMMAND_BY_ID.get('view.fullscreen'), 'win'), 'Padrão do sistema: F11.');
  const errWin = validateCombo('view.zoomIn', 'S', 'win');
  assert.match(errWin, /Ctrl, Alt ou uma tecla F/);
  assert.doesNotMatch(errWin, /[⌘⌥]|Option/);
  assert.match(validateCombo('view.zoomIn', 'S', 'mac'), /⌘/);
  // a janela não tem mais dica fixa: usa commandHint
  const dlg = read('src/components/KeyCommandsDialog.tsx');
  assert.doesNotMatch(dlg, /\{def\.hint\}/);
  assert.match(dlg, /commandHint\(def, platform\)/);
});

test('revisão: ⌥K e ⌘M pelo teclado e pelo menu rodam uma vez só, e nada dispara com a janela aberta', () => {
  let t = 1000;
  const gate = createCommandGate(() => t);
  const st = (o = {}) => ({ recording: false, dialogOpen: false, gate, ...o });
  // janela fechada: o menu abre
  assert.equal(menuCommandDecision('app.keyCommands', st()), 'run');
  // o teclado abriu agora: o menu que chega logo depois não roda de novo
  gate.noteRan('app.keyCommands');
  assert.equal(menuCommandDecision('app.keyCommands', st({ dialogOpen: true })), 'ignore');
  t += 50;
  // fechou pelo ⌥K na janela (marca que rodou): o menu que chega depois não reabre
  gate.noteRan('app.keyCommands');
  assert.equal(menuCommandDecision('app.keyCommands', st()), 'ignore');
  t += 400;
  // janela aberta, sem gravar: o ⌥K do menu fecha; ⌘M e outros comandos do menu não fazem nada
  assert.equal(menuCommandDecision('app.keyCommands', st({ dialogOpen: true })), 'close-dialog');
  assert.equal(menuCommandDecision('view.showMode', st({ dialogOpen: true })), 'ignore');
  assert.equal(menuCommandDecision('app.checkUpdates', st({ dialogOpen: true })), 'ignore');
  // gravando, ou logo depois de gravar (o useEffect já desligou a gravação), o menu não dispara
  assert.equal(menuCommandDecision('view.showMode', st({ recording: true, dialogOpen: true })), 'ignore');
  gate.noteCaptured();
  t += 10;
  assert.equal(menuCommandDecision('view.showMode', st()), 'ignore');
  assert.equal(menuCommandDecision('app.keyCommands', st({ dialogOpen: true })), 'ignore');
  t += 400;
  assert.equal(menuCommandDecision('view.showMode', st()), 'run');

  const runtime = read('src/lib/shortcuts/runtime.ts');
  assert.match(runtime, /onMenuCommand\?\.\(onMenuCommand\)/);
  assert.match(runtime, /menuCommandDecision\(id, \{ recording, dialogOpen, gate \}\)/);
  assert.match(runtime, /export function shortcutsDialogBusy\(\): boolean \{ return recording \|\| dialogOpen \|\| gate\.capturedRecently\(\); \}/);
  // o ⌘M do menu nativo (menu:showMode) não troca o Modo Show com a janela aberta
  const app = read('src/App.tsx');
  assert.match(app, /function toggleShowMode\(\) \{[\s\S]*?if \(shortcutsDialogBusy\(\)\) return;/);
  const dlg = read('src/components/KeyCommandsDialog.tsx');
  assert.match(dlg, /noteShortcutCaptured\(\);\s*setRecording\(null\);/);
  assert.match(dlg, /if \(commandRanRecently\('app\.keyCommands'\)\) return;\s*noteCommandRan\('app\.keyCommands'\);\s*closeKeyCommands\(\);/);
});

test('revisão: atalho gravado ganha da folga do padrão (a mesma tecla não chama dois comandos)', () => {
  let b = defaultBindings();
  assert.equal(findConflict(b, 'clip.mute', 'Shift+M'), null);
  b = assignCombo(b, 'clip.mute', 'Shift+M');
  for (const p of ['mac', 'win']) {
    assert.deepEqual(matchCommands(letter('m', { shift: true }), b, p), ['clip.mute']);
    assert.deepEqual(matchCommands(letter('m'), b, p), ['view.mixer'], 'o M sozinho continua no mixer');
  }
  b = assignCombo(b, 'playlist.removeSong', 'Shift+Backspace');
  assert.deepEqual(matchCommands(ev('Backspace', { shift: true }), b, 'mac'), ['playlist.removeSong']);
  assert.deepEqual(matchCommands(ev('Backspace'), b, 'mac'), ['maestro.deleteCue', 'edit.deleteClips']);
  // Control do Mac gravado pelo usuário: não cai também no ⌘
  b = assignCombo(b, 'track.solo', 'Ctrl+G');
  assert.deepEqual(matchCommands(letter('g', { ctrl: true }), b, 'mac'), ['track.solo']);
  // e o comando que não fez nada (sem clipe) não deixa o mixer abrir por baixo
  const calls = [];
  const handlers = { 'clip.mute': [() => false], 'view.mixer': [() => { calls.push('mixer'); }] };
  b = assignCombo(defaultBindings(), 'clip.mute', 'Shift+M');
  assert.equal(dispatchKey(letter('m', { shift: true }), { platform: 'mac', bindings: b, phase: 'bubble', handlers: (id) => handlers[id] ?? [] }), null);
  assert.deepEqual(calls, []);
});

test('revisão: modificador a mais continua valendo como antes', () => {
  const b = defaultBindings();
  const first = (e, p) => matchCommands(e, b, p)[0];
  for (const p of ['mac', 'win']) {
    const mod = p === 'mac' ? { meta: true } : { ctrl: true };
    assert.equal(first(letter('c', { ...mod, shift: true }), p), 'edit.copyClips');
    assert.equal(first(letter('v', { ...mod, shift: true }), p), 'edit.pasteClips');
    assert.equal(first(letter('a', { ...mod, shift: true }), p), 'edit.selectAllClips');
    assert.equal(first(letter('u', { ...mod, shift: true }), p), 'edit.ungroup');
    assert.equal(first(letter('z', { ...mod, alt: true }), p), 'edit.undo');
    assert.equal(first(letter('z', { ...mod, alt: true, shift: true }), p), 'edit.redo');
    assert.equal(first(letter('y', { ...mod, shift: true }), p), 'edit.redo');
    assert.equal(first(letter('s', { ...mod, alt: true }), p), 'file.save');
    assert.equal(first(letter('g', { ...mod, alt: true }), p), 'edit.group');
    assert.equal(first(letter('g', { ...mod, alt: true, shift: true }), p), 'edit.glue');
    // ⌘⇧M e ⌘⌥M nunca abriram o Modo Show
    assert.notEqual(first(letter('m', { ...mod, shift: true }), p), 'view.showMode');
    // Home com modificador continua sem fazer nada
    assert.equal(first(ev('Home', { alt: true }), p), undefined);
  }
  // Windows: Alt+M abria o mixer e Alt+S dividia (o teste antigo era só a letra, sem Ctrl)
  assert.equal(first(letter('m', { alt: true }), 'win'), 'view.mixer');
  assert.equal(first(letter('s', { alt: true }), 'win'), 'edit.split');
  assert.equal(first(letter('s', { ctrl: true, alt: true }), 'win'), 'file.save');
  // Mac: ⌃⌘ também contava como ⌘ (ctrlKey||metaKey)
  assert.equal(first(letter('m', { meta: true, ctrl: true }), 'mac'), 'view.showMode');
  // pads e partes continuam sem Option (o tratador antigo saía com Alt)
  assert.equal(first(letter('p', { alt: true }), 'mac'), undefined);
  assert.equal(first(letter('l', { alt: true }), 'win'), undefined);
});

test('revisão: campo de arquivo, cor, imagem e limpar contam como campo de texto, como antes', () => {
  for (const type of ['file', 'color', 'image', 'reset', 'text', 'search', 'number']) {
    assert.equal(isTextTarget({ tagName: 'INPUT', type }), true, type);
  }
  for (const type of ['button', 'checkbox', 'radio', 'range', 'submit']) {
    assert.equal(isTextTarget({ tagName: 'INPUT', type }), false, type);
  }
  const b = defaultBindings();
  const handlers = { 'transport.playPause': [() => {}] };
  const sp = ev(' ', { code: 'Space', target: { tagName: 'INPUT', type: 'file' } });
  assert.equal(dispatchKey(sp, { platform: 'mac', bindings: b, phase: 'bubble', handlers: (id) => handlers[id] ?? [] }), null);
  assert.equal(sp.prevented, false);
});

test('revisão: L e N das partes valem com o foco numa lista de escolha, como antes', () => {
  const b = defaultBindings();
  const calls = [];
  const handlers = { 'show.regionLoop': [() => { calls.push('loop'); }], 'show.regionSkip': [() => { calls.push('skip'); }] };
  const env = { platform: 'win', bindings: b, phase: 'bubble', handlers: (id) => handlers[id] ?? [] };
  const select = { tagName: 'SELECT' };
  assert.equal(dispatchKey(letter('l', { target: select }), env), 'show.regionLoop');
  assert.equal(dispatchKey(letter('n', { target: select }), env), 'show.regionSkip');
  assert.deepEqual(calls, ['loop', 'skip']);
  // os pads (P, 1 a 9, R) continuam fora no SELECT, como no tratador antigo
  assert.ok(!COMMAND_BY_ID.get('show.padsPanel').inSelect);
});

test('revisão: tecla de comando do sistema não oferece Trocar, é recusada', () => {
  const b = defaultBindings();
  // Windows: Ctrl+H é livre (Ocultar só existe no Mac) e não conflita com nada
  assert.equal(findConflict(b, 'view.mixer', 'Mod+H'), null);
  assert.equal(validateCombo('view.mixer', 'Mod+H', 'win'), null);
  assert.equal(availableOn(COMMAND_BY_ID.get('app.hide'), 'win'), false);
  assert.deepEqual(matchCommands(letter('h', { ctrl: true }), b, 'win'), []);
  // Ctrl+X / ⌘X é do Recortar do sistema: recusado com o motivo, sem Trocar
  assert.equal(findConflict(b, 'view.mixer', 'Mod+X'), null);
  for (const p of ['mac', 'win']) assert.match(validateCombo('view.mixer', 'Mod+X', p), /Reservada: Recortar/);
  // um arquivo importado também não consegue pôr a tecla do sistema noutro comando
  const r = importShortcuts(JSON.stringify({ tipo: 'vs-stage-atalhos', versao: 1, atalhos: { 'track.mute': ['Mod+X'] } }), 'win');
  assert.deepEqual(r.bindings['track.mute'], []);
  assert.equal(r.ignored, 1);
  // a troca não mexe nos travados: o que sai ao salvar é o mesmo que volta ao reabrir
  const s = assignCombo(b, 'track.mute', 'Mod+X', { steal: true });
  assert.deepEqual(s['edit.nativeText'], ['Mod+X']);
  assert.deepEqual(resolveBindings(computeOverrides(s))['edit.nativeText'], ['Mod+X']);
});

test('atalho com Control (⌃) exportado no Mac vira Ctrl no Windows', () => {
  const id = COMMANDS.find((c) => !c.locked && !c.native && availableOn(c, 'win')).id;
  const text = JSON.stringify({ tipo: 'vs-stage-atalhos', versao: 1, atalhos: { [id]: ['Ctrl+Shift+F9'] } });
  const { bindings } = importShortcuts(text, 'win');
  assert.ok(bindings[id].includes('Mod+Shift+F9'), JSON.stringify(bindings[id]));
  assert.ok(!bindings[id].some((b) => b.split('+').includes('Ctrl')));
  assert.match(comboLabel('Mod+Shift+F9', 'win'), /Ctrl/);
  // no Mac o Control continua sendo Control
  const mac = importShortcuts(text, 'mac');
  assert.ok(mac.bindings[id].includes(normalizeCombo('Ctrl+Shift+F9')));
});

test('Alt + rodinha no volume não manda o foco para o menu do Windows', () => {
  const src = read('src/components/AnalogPieces.tsx');
  assert.match(src, /markAltWheel\(\)/);
  assert.match(src, /ev\.key !== 'Alt'[\s\S]{0,80}preventDefault/);
  assert.match(src, /\$\{ALT_NAME\} \+ rodinha/);
});
