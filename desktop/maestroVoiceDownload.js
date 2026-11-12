// Download do modelo de voz do Maestro IA (Qwen3-TTS, ~1,8 GB), uma vez só, em silêncio.
//
// - Os arquivos e o SHA-256 de cada um estão fixos em maestro-voice-model.json (versão travada no
//   Hugging Face): o que chega é exatamente o que foi testado.
// - Fica na pasta do app no Mac do usuário (fora do .app): vale para as próximas versões, que só
//   trocam o .app.
// - Continua de onde parou (cada arquivo baixa num ".part"), pausa enquanto uma música toca (para
//   não disputar a rede e o disco num show) e tenta de novo sozinho se a internet cair.
// - Só marca como pronto (arquivo ".pronto") depois de conferir todos os arquivos.
const fs = require('fs');
const { createModelDownload } = require('./modelDownload');

// nos testes: outra lista de arquivos e outro endereço (servidor local)
const MANIFEST = process.env.VS_MAESTRO_MODEL_MANIFEST
  ? JSON.parse(fs.readFileSync(process.env.VS_MAESTRO_MODEL_MANIFEST, 'utf8'))
  : require('./maestro-voice-model.json');

module.exports = createModelDownload({
  manifest: MANIFEST,
  folder: 'maestro-voice',
  label: 'a voz brasileira',
  userAgent: 'VS-Stage-Maestro-IA',
  homeEnv: 'VS_MAESTRO_MODEL_HOME',
  baseUrlEnv: 'VS_MAESTRO_MODEL_BASE_URL',
  skipEnv: 'VS_MAESTRO_MODEL_DIR',
});
