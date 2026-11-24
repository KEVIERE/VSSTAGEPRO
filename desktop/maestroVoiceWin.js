// Voz do Windows para o Maestro: o mesmo papel do `say` no Mac (reserva sem internet e sem conta).
// Usa a fala do próprio Windows (System.Speech, SAPI) pelo PowerShell que vem em todo Windows 10/11.
// O texto e o nome da voz vão por arquivo e variável de ambiente: nada passa por linha de comando,
// então aspas e acentos do usuário não quebram nada.
const { execFile } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');

const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Ritmo normal (palavras por minuto) que corresponde ao Rate 0 do Windows. */
const NATURAL_WPM = 175;

function ps(script, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.toString().trim() || err.message));
        else resolve(stdout?.toString() ?? '');
      },
    );
  });
}

const LIST_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $i = $_.VoiceInfo; "$($i.Name)`t$($i.Culture.Name)`t$($i.Gender)" }',
  '$s.Dispose()',
].join('; ');

const SPEAK_SCRIPT = [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$s.SelectVoice($env:VS_VOICE)',
  '$s.Rate = [int]$env:VS_RATE',
  '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  '$s.SetOutputToWaveFile($env:VS_OUT, $fmt)',
  '$s.Speak([IO.File]::ReadAllText($env:VS_TEXT, [Text.Encoding]::UTF8))',
  '$s.Dispose()',
].join('; ');

/** Uma linha "Microsoft Maria Desktop<TAB>pt-BR<TAB>Female" vira a voz no formato do maestroVoice. */
function parseWinVoiceLine(line) {
  const [name, culture, gender] = line.trim().split('\t');
  if (!name || !culture) return null;
  return {
    id: name,
    name,
    locale: culture.replace('-', '_'),
    gender: /female/i.test(gender) ? 'feminina' : /male/i.test(gender) ? 'masculina' : 'outra',
    quality: 0,
  };
}

async function listWinVoices() {
  const raw = await ps(LIST_SCRIPT);
  return raw.split(/\r?\n/).map(parseWinVoiceLine).filter(Boolean);
}

/**
 * Palavras por minuto → Rate do Windows (-10 a 10). No Windows, +10 fica perto de 3x e -10 perto
 * de 1/3 do ritmo normal. A conta é aproximada: quem chama mede o áudio e ajusta (fitPace).
 */
function wpmToRate(wpm) {
  const r = Math.round((10 * Math.log(wpm / NATURAL_WPM)) / Math.log(3));
  return Math.max(-10, Math.min(10, r));
}

/** Grava a fala em WAV 16 bits, 44,1 kHz, mono (o mesmo formato que o Mac entrega). */
async function speakToWav(voice, text, wpm, wavPath) {
  const txt = `${wavPath}.txt`;
  await fsp.writeFile(txt, text, 'utf8');
  try {
    await ps(SPEAK_SCRIPT, { VS_VOICE: voice, VS_RATE: String(wpmToRate(wpm)), VS_OUT: wavPath, VS_TEXT: txt });
  } finally {
    await fsp.rm(txt, { force: true }).catch(() => {});
  }
}

/** Abre a tela de vozes do Windows (Configurações → Hora e idioma → Fala). */
function openWinVoiceSettings() {
  return new Promise((resolve) => {
    execFile('explorer.exe', ['ms-settings:speech'], { windowsHide: true }, () => resolve(''));
  });
}

module.exports = { listWinVoices, speakToWav, openWinVoiceSettings, parseWinVoiceLine, wpmToRate };
