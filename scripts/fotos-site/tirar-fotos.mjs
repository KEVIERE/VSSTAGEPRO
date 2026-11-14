// Fotos do site com o Chrome sem janela e sem som (CDP).
// uso: node shots.mjs <pasta-de-saída> <arquivo-de-passos.json>
// Cada passo: { name, url, w, h, scale, wait, js: ["expressão", ...], clip?: {x,y,width,height} }
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [outDir, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9334;
const profile = mkdtempSync(join(tmpdir(), 'vsshots-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--force-color-profile=srgb', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* abrindo */ }
}
if (!wsUrl) throw new Error('Chrome não abriu');
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(msg.params.exceptionDetails?.exception?.description || 'exceção');
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
await send('Page.enable');
await send('Runtime.enable');
// Hora de show nas fotos (umas 21h): fuso que deixa o relógio da tela à noite.
await send('Emulation.setTimezoneOverride', { timezoneId: process.env.SHOT_TZ || 'Pacific/Gambier' });

let currentUrl = null;
for (const s of steps) {
  const scale = s.scale ?? 2;
  await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: scale, mobile: Boolean(s.mobile) });
  if (s.url && (s.url !== currentUrl || s.reload)) {
    await send('Page.navigate', { url: s.url });
    currentUrl = s.url;
    await sleep(s.loadWait ?? 3500);
  }
  for (const js of s.js ?? []) {
    try {
      const v = await evaluate(js);
      if (v !== undefined) console.log(`  ${s.name}: ${JSON.stringify(v).slice(0, 200)}`);
    } catch (e) {
      console.log(`  ${s.name}: ERRO ${e.message.slice(0, 300)}`);
    }
  }
  await sleep(s.wait ?? 1200);
  if (!s.name.startsWith('_')) {
    const shot = await send('Page.captureScreenshot', { format: 'png', ...(s.clip ? { clip: { ...s.clip, scale: 1 } } : {}), captureBeyondViewport: false });
    writeFileSync(join(outDir, `${s.name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`foto: ${s.name}.png`);
  }
}
if (logs.length) console.log('erros na página:', logs.slice(0, 5).join(' | '));
ws.close();
chrome.kill();
