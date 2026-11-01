// Teste de verdade da voz brasileira de IA do Maestro (no GitHub e num Mac de desenvolvimento).
//
// Baixa o modelo com o mesmo código do app (maestroVoiceDownload.js), abre o programa de voz pelo
// mesmo motor do app (maestroQwen.js) e gera as falas de teste com as duas vozes, gravando os WAVs
// para ouvir. Para com erro se alguma fala não sair, sair vazia, começar depois da linha da grade ou
// passar muito do tamanho esperado (o modelo "inventando" depois do texto).
//
// Uso: node scripts/testMaestroVoice.cjs <pasta de saída>
//   VS_MAESTRO_ENGINE_DIR  pasta montada por prepareMaestroVoice.sh (padrão: desktop/maestro-voice-engine)
//   VS_MAESTRO_MODEL_HOME  onde guardar o modelo baixado (padrão: ~/.vs-maestro-voice)
//   VS_MAESTRO_MODEL_DIR   usar um modelo já baixado (pula o download)
//   VS_MAESTRO_CPU=1       sem placa de vídeo (máquina virtual do GitHub)
const fs = require('fs');
const path = require('path');
const download = require('../maestroVoiceDownload');
const qwen = require('../maestroQwen');

const FRASES = ['Atenção, dois compassos e entra o refrão!', 'Um, dois, três, quatro!', 'Vamos pra ponte. Segura!'];
const CONTA = ['Um!', 'Dois!', 'Três!', 'Quatro!'];

function firstSound(buf) {
  const n = (buf.length - 44) / 2;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf.readInt16LE(44 + i * 2)));
  // mesmo limite do corte de silêncio do app (36 dB abaixo do pico): ali o som já começou
  for (let i = 0; i < n; i++) if (Math.abs(buf.readInt16LE(44 + i * 2)) > peak * 0.015) return i / 24000;
  return -1;
}

function check(r, text, maxSeconds) {
  if (!(r.natural > 0.15)) throw new Error(`"${text}" saiu vazia (${r.natural.toFixed(2)} s)`);
  if (r.natural > maxSeconds) throw new Error(`"${text}" saiu com ${r.natural.toFixed(2)} s (esperado até ${maxSeconds} s): o modelo inventou fala a mais`);
  const t = firstSound(r.buf);
  if (t < 0 || t > 0.005) throw new Error(`"${text}": o som começa em ${(t * 1000).toFixed(1)} ms, deveria ser logo no início`);
}

(async () => {
  const out = path.resolve(process.argv[2] || 'falas-de-teste');
  fs.mkdirSync(out, { recursive: true });
  if (!process.env.VS_MAESTRO_MODEL_DIR) {
    const t0 = Date.now();
    await download.downloadAll();
    console.log(`modelo pronto em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${download.modelDir()}`);
  }
  const st = qwen.status();
  console.log('situação:', JSON.stringify(st));
  if (!st.ready) throw new Error(qwen.unavailableReason() || 'voz de IA indisponível');

  const report = [];
  for (const voice of qwen.QWEN_VOICES) {
    for (const [i, text] of FRASES.entries()) {
      const t0 = Date.now();
      const r = await qwen.render({ text, voice, span: 0 });
      fs.writeFileSync(path.join(out, `${voice.ref}-frase${i + 1}.wav`), r.buf);
      check(r, text, 1.5 + text.length * 0.12);
      report.push(`${voice.ref.padEnd(9)} ${text.padEnd(44)} ${r.natural.toFixed(2)} s de fala em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      console.log(report[report.length - 1]);
    }
    for (const [i, text] of CONTA.entries()) {
      const t0 = Date.now();
      const r = await qwen.render({ text, voice, span: 0.5, pace: 1.15 });
      fs.writeFileSync(path.join(out, `${voice.ref}-conta${i + 1}.wav`), r.buf);
      check(r, text, 1.2);
      report.push(`${voice.ref.padEnd(9)} ${text.padEnd(44)} ${r.natural.toFixed(2)} s, velocidade ${r.tempo}×, em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      console.log(report[report.length - 1]);
    }
  }
  fs.writeFileSync(path.join(out, 'relatorio.txt'), `${report.join('\n')}\n`);
  qwen.stopHelper();
  console.log(`ok: ${report.length} falas em ${out}`);
  process.exit(0);
})().catch((err) => {
  console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
  qwen.stopHelper();
  process.exit(1);
});
