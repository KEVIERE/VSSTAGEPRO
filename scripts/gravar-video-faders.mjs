// Grava a página tests/browser/faders-video.html quadro a quadro com o Chrome sem janela
// (precisa do Google Chrome instalado no Mac e do servidor de desenvolvimento ligado).
// uso: node scripts/gravar-video-faders.mjs http://localhost:5183/tests/browser/faders-video.html <pasta-dos-quadros>
// Depois, juntar os quadros no vídeo do site:
//   ffmpeg -framerate 30 -i <pasta>/f%04d.png -c:v libx264 -preset veryslow -crf 18 -tune animation \
//     -pix_fmt yuv420p -movflags +faststart -an public/site/faders.mp4
//   ffmpeg -i <pasta>/f0000.png -q:v 4 public/site/faders-poster.jpg
// E as fotos dos destaques (conferir largura e altura em SPOTS, src/components/sales/siteContent.ts):
//   ffmpeg -i <pasta>/timecode.png -q:v 3 public/site/fader-timecode.jpg
//   ffmpeg -i <pasta>/master.png -q:v 3 public/site/fader-master.jpg
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, outDir, fpsArg] = process.argv.slice(2);
const FPS = Number(fpsArg || 30);
const SCALE = 2;
mkdirSync(outDir, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'vsrec-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--force-color-profile=srgb', '--no-first-run', '--window-size=1200,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* ainda abrindo */ }
}
if (!wsUrl) throw new Error('Chrome não abriu');

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: SCALE, mobile: false });
  await send('Page.enable');
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    const ok = await evaluate(`!!window.vsVideo && document.fonts.status === 'loaded' && document.fonts.check('700 12px "Barlow Semi Condensed"')`).catch(() => false);
    if (ok) break;
    if (i === 99) throw new Error('página ou fonte não carregou');
  }
  await sleep(500);
  const loop = await evaluate('window.vsVideo.LOOP');
  const frames = Math.round(loop * FPS);
  // uma volta inteira de aquecimento: medidores e picos chegam no ponto em que o loop emenda
  for (let k = 0; k < frames; k++) await evaluate(`window.vsVideo.seek(${k / FPS})`);
  const a = await evaluate('window.vsVideo.area()');
  const clip = { x: Math.round(a.x), y: Math.round(a.y), width: Math.round(a.width), height: Math.round(a.height), scale: 1 };
  console.log('área', JSON.stringify(clip), 'quadros', frames);
  for (let k = 0; k < frames; k++) {
    await evaluate(`window.vsVideo.seek(${(frames + k) / FPS})`);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip });
    writeFileSync(join(outDir, `f${String(k).padStart(4, '0')}.png`), Buffer.from(shot.data, 'base64'));
  }

  // Fotos do timecode e do master (destaques abaixo do vídeo), em resolução tripla, num ponto
  // do loop em que o master está no verde
  const FOTO = 4;
  for (let k = 2 * frames; k <= 2 * frames + FOTO * FPS; k++) await evaluate(`window.vsVideo.seek(${k / FPS})`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 3, mobile: false });
  await sleep(500);
  for (const name of ['timecode', 'master']) {
    const b = await evaluate(`window.vsVideo.area('${name}')`);
    const c = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height), scale: 1 };
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: c });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(name, JSON.stringify(c));
  }
  console.log('pronto');
} finally {
  ws.close();
  chrome.kill();
}
