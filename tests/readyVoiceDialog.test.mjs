// Vozes prontas do Maestro: a voz feminina se chama Bianca na tela (o id continua "moca") e a
// janela da fala com voz pronta tem só OK, sem o botão de gerar, e sem o campo de digitar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READY_VOICES, readyVoice } from '../src/lib/maestroCues.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dialog = fs.readFileSync(path.join(here, '..', 'src', 'components', 'NarrationDialog.tsx'), 'utf8');

test('a voz pronta feminina se chama Bianca, sem mudar o id', () => {
  const v = READY_VOICES.find((x) => x.id === 'pronta:moca');
  assert.equal(v?.label, 'Bianca');
  assert.equal(v?.dir, 'moca', 'a pasta dos áudios gravados continua a mesma');
  assert.equal(readyVoice('pronta:moca:forte')?.label, 'Bianca', 'falas salvas com o id antigo mostram o nome novo');
});

test('Minhas falas: primeiro cria, depois adiciona; texto solto não vai para a timeline', () => {
  assert.match(dialog, /'Minhas falas'/);
  assert.doesNotMatch(dialog, /Minhas frases|'Gerar'|Gerar de novo/);
  assert.match(dialog, /const canAdd = !busy && !!text\.trim\(\) && \(onTrack \|\| \(engine && created\)\)/);
  const create = dialog.match(/const createDraft = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(create, /createSpeech\(value, voice\)/);
  assert.doesNotMatch(create, /applyDraft|generateNarration|updateNarration/, 'criar não mexe na timeline');
  const add = dialog.match(/const addSpeech = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(add, /st !== 'gravada'[\s\S]*applyDraft\(natural\)[\s\S]*generateNarration/, 'só fala pronta entra');
  const play = dialog.match(/const playDraft = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(play, /!ready && !created && !onTrack/, 'o Play não gera fala nova');
});

test('contagem da voz clonada usa só o pacote, espera ficar pronta e não estica à toa', () => {
  const count = fs.readFileSync(path.join(here, '..', 'src', 'components', 'CountInDialog.tsx'), 'utf8');
  assert.match(count, /ensureCountPack\(voice\)/);
  assert.match(count, /Preparando contagem \$\{pack\?\.done \?\? 0\} de/);
  assert.match(count, /disabled=\{!grid \|\| waitingPack \|\| !!lackingText\}/);
  assert.match(count, /const fallback = clone \? 1 : COUNT_PACE_DEFAULT/, 'voz clonada começa na velocidade natural');
  const voice = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'maestroVoice.ts'), 'utf8');
  const fn = voice.match(/async function countPackSpeech[\s\S]*?\n}/)?.[0] ?? '';
  assert.match(fn, /Math\.abs\(tempo - 1\) > 0\.005 \|\| cents !== 0/);
  assert.doesNotMatch(fn, /maestroSpeak/, 'não chama o modelo');
  assert.match(voice, /const packed = await countPackSpeech\(/);
});

test('com voz pronta a janela da fala tem Adicionar fala', () => {
  assert.match(dialog, /\{ready \? \(/);
  assert.match(dialog, /onClick=\{confirmReady\}[\s\S]{0,300}Adicionar fala/);
  assert.match(dialog, /const confirmReady = \(\) => \{[\s\S]{0,140}applyDraft\(\);[\s\S]{0,80}scheduleGeneration\(song\.id, narration\.id, 0\);[\s\S]{0,20}onClose\(\);/, 'OK grava o rascunho, põe na faixa e fecha');
});

test('trocar a voz na janela da fala não regrava a marcação; com voz pronta não há campo de digitar', () => {
  const choose = dialog.match(/const chooseVoice = \(v: string\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.ok(choose, 'chooseVoice existe');
  assert.doesNotMatch(choose, /updateNarration|generate|scheduleGeneration/, 'escolher a voz só muda a janela');
  assert.match(dialog, /A voz \$\{readyVoice\(voice\)\?\.label \?\? 'Maestro 1'\} fala só as falas prontas da lista\./);
  assert.match(dialog, /\{readyOnlyText\} Para texto livre, escolha uma voz clonada\./);
  assert.doesNotMatch(dialog, /Feminina|Masculina/);
});

test('fechar a janela não grava nem gera nada; só Adicionar fala aplica o rascunho', () => {
  const close = dialog.match(/const close = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.ok(close, 'close existe');
  assert.doesNotMatch(close, /updateNarration|applyDraft|scheduleGeneration|generateNarration/);
  assert.match(close, /!n\.text\.trim\(\) && !n\.clipId\) removeNarration/, 'marcação nova sem áudio some');
  assert.doesNotMatch(dialog, /onBlur=\{commit/, 'sair do campo não grava o texto');
});

test('clique na fala do Maestro IA toca do buffer, sem fila de geração', () => {
  const play = dialog.match(/const playCue = \(value: string, inVoice: string = voice\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(play, /readyCueCached\(inVoice, value, pitchValue\)/);
  assert.doesNotMatch(play, /generateNarration|updateNarration|applyNarration|maestroSpeak/);
  const pick = dialog.match(/const pickCue = \(cue: ReadyCue\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.doesNotMatch(pick, /generate|updateNarration/);
});

test('prévia não mexe na marcação e Gerar reaproveita o áudio dela', () => {
  const preview = dialog.match(/const previewText = async \(value: string\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(preview, /previewSpeech\(draft\)/);
  assert.doesNotMatch(preview, /updateNarration|applyDraft|generateNarration/);
  const voice = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'maestroVoice.ts'), 'utf8');
  assert.match(voice, /previewDone\.get\(key\) \?\? await previewRunning\.get\(key\)\?\.catch\(\(\) => null\);\s+result = reused \?\? await synthesize\(/);
});

test('o OK do Maestro IA só aceita fala gravada e a prévia não usa a voz do sistema', () => {
  assert.match(dialog, /const canConfirm = !!text\.trim\(\) && \(recordedCue\(text\) \|\| !draftDirty\)/);
  assert.match(dialog, /if \(!canConfirm\) \{ setError\('Escolha uma fala da lista\.'\); return; \}/);
  const voice = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'maestroVoice.ts'), 'utf8');
  assert.match(voice, /\{ requestId, fallback: false \}/);
  assert.match(voice, /maestroSpeakCancel\?\.\(id\)/);
});

test('com a música no ar a prévia nunca sai, e só o último toque pede a saída', () => {
  const voice = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'maestroVoice.ts'), 'utf8');
  const play = voice.match(/export function playPreview[\s\S]*?\n}/)?.[0] ?? '';
  assert.match(play, /owner !== previewOwner/);
  assert.match(play, /transport\.isPlaying\) \{ onEnd\?\.\(\); return; \}/);
  assert.doesNotMatch(play, /keepOld/);
});

test('voz removida não é gerada de novo', () => {
  const voice = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'maestroVoice.ts'), 'utf8');
  const gen = voice.match(/export function generateNarration[\s\S]*?\n}/)?.[0] ?? '';
  assert.match(gen, /!isOfferedVoice\(target\.voice\)/);
  const count = fs.readFileSync(path.join(here, '..', 'src', 'components', 'CountInDialog.tsx'), 'utf8');
  assert.match(count, /target\.kind === 'edit' && !isOfferedVoice\(voice\)/);
});

test('nada regenera marcações sozinho', () => {
  const voice = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'maestroVoice.ts'), 'utf8');
  assert.doesNotMatch(voice, /refreshStale|nextStale/);
  assert.match(voice, /if \(!regeneratesAlone\(\{ \.\.\.n, songId \}\)\) return;/);
});
