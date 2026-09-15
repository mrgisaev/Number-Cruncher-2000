import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const inputPath = 'C:\\Users\\Grisha\\Desktop\\Screen-Recording.mp4';
const outputRoot = path.resolve('social', 'creative-resizer', 'video', '.storyboard');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'number-cruncher-video-probe-'));
fs.mkdirSync(outputRoot, { recursive: true });

const fileUrl = `file:///${path.resolve('social', 'creative-resizer', 'video', '.probe-video.html').replaceAll('\\', '/')}`;
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, fileUrl,
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const portFile = path.join(profile, 'DevToolsActivePort');
for (let attempt = 0; attempt < 200 && !fs.existsSync(portFile); attempt += 1) await sleep(50);
if (!fs.existsSync(portFile)) throw new Error('Chrome did not start.');
const [port] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const commandId = ++id;
  pending.set(commandId, { resolve, reject });
  socket.send(JSON.stringify({ id: commandId, method, params }));
});
const evaluate = async (expression) => {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
};

try {
  await cdp('Runtime.enable');
  let metadata;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    metadata = await evaluate(`(async () => {
      const video = document.querySelector('video');
      if (!video || video.readyState < 1) return null;
      if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e10;
        await Promise.race([
          new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true })),
          new Promise((resolve) => setTimeout(resolve, 500)),
        ]);
      }
      const duration = Number.isFinite(video.duration)
        ? video.duration
        : (video.currentTime > 0 ? video.currentTime : null);
      if (!duration) return null;
      video.currentTime = 0;
      return { duration, rawDuration: video.duration, width: video.videoWidth, height: video.videoHeight, readyState: video.readyState };
    })()`);
    if (metadata?.duration) break;
    await sleep(50);
  }
  if (!metadata?.duration) {
    const diagnostics = await evaluate(`(() => { const video = document.querySelector('video'); return { href: location.href, title: document.title, video: Boolean(video), readyState: video?.readyState, networkState: video?.networkState, error: video?.error ? { code: video.error.code, message: video.error.message } : null, src: video?.currentSrc || video?.src }; })()`);
    throw new Error(`Video metadata did not load: ${JSON.stringify(diagnostics)}`);
  }

  const times = Array.from({ length: 12 }, (_, index) => metadata.duration * index / 11);
  for (let index = 0; index < times.length; index += 1) {
    const dataUrl = await evaluate(`(async () => {
      const video = document.querySelector('video');
      video.currentTime = ${times[index]};
      await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
      const width = 720;
      const height = Math.round(width * video.videoHeight / video.videoWidth);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(video, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', .86);
    })()`);
    fs.writeFileSync(path.join(outputRoot, `${String(index).padStart(2, '0')}-${times[index].toFixed(2)}s.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  process.stdout.write(`${JSON.stringify({ inputPath, ...metadata, storyboard: outputRoot }, null, 2)}\n`);
}
finally {
  socket.close(); chrome.kill(); await sleep(250);
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedProfile = path.resolve(profile);
  if (resolvedProfile.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(resolvedProfile, { recursive: true, force: true });
}
