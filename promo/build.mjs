// Composes the YouTube Short from the captured browser footage.
//
//   node promo/build.mjs
//
// Steps: upscales each clip 720x1280 -> 1080x1920, draws branded overlays with
// the site's own fonts/palette, synthesises a matching voiceover, then muxes an
// H.264/AAC MP4 at 9:16.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const p of ['patchright', '/tmp/node_modules/patchright', 'playwright', 'playwright-core']) {
    try { return require(p); } catch {}
  }
  throw new Error('patchright/playwright not installed');
})();

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// This machine keeps Chromium under chromium-*/chrome-linux64 rather than the
// chrome-linux path Playwright expects, so point at it explicitly when present.
for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.HOME || '', '.cache/ms-playwright'), '/tmp/node_modules/.cache/ms-playwright']) {
  if (!base || process.env.CHROMIUM_PATH) break;
  const dir = path.join(base, 'chromium-1248', 'chrome-linux64', 'chrome');
  if (fs.existsSync(dir)) process.env.CHROMIUM_PATH = dir;
}
if (process.env.CHROMIUM_PATH) chromium.launch = ((launch) => (options = {}) => launch({ executablePath: process.env.CHROMIUM_PATH, ...options }))(chromium.launch);

const FOOTAGE = path.join(ROOT, 'footage');
const WORK = path.join(ROOT, 'work');
const OUT = path.join(ROOT, '..', 'orbit-shorts.mp4');
fs.mkdirSync(WORK, { recursive: true });

const W = 1080;
const H = 1920;
const FPS = 30;
const SITE = 'quantumstudios.vercel.app';
const LIME = '#c9f36b';

// ---------------------------------------------------------------- timeline
// Caption overlays use YouTube Shorts safe zones: the title sits below the
// 220px top bar and everything stays above the ~1500px caption/UI zone. The
// copy panel has to end above 1250px so it never collides with the progress
// bar at 1580px.
const COPY_BOTTOM = 1095;
const SCENES = [
  {
    clip: 'classic',
    kicker: 'ORBIT · ROBLOX LAUNCHER',
    title: 'Your<br>game library.',
    sub: 'One step away'
  },
  {
    clip: 'typing',
    kicker: 'PASTE A LINK. THAT\'S IT.',
    title: 'Paste a Roblox link<br>or place ID',
    sub: 'Orbit opens the official Roblox page',
    cursor: { x: 520, y: 690, click: 4.15 }
  },
  {
    clip: 'customize',
    kicker: 'MAKE IT YOURS',
    title: 'Three themes.<br>Any accent.',
    sub: 'Saved on this device',
    cursor: { x: 300, y: 700, move: true }
  },
  {
    clip: 'queue',
    kicker: 'ORBIT QUEUE',
    title: 'Build a run.<br>Start the next.',
    sub: 'Queue, session clock, launch',
    cursor: { x: 560, y: 640, move: true }
  }
];

// Voiceover script + on-screen beats. Timings are relative to each scene and
// follow the footage beats, so audio and picture describe the same action.
// No dots in the outro line: espeak reads "vercel.app" as an odd sound.
const VOICE = [
  { clip: 'classic', at: 0.9, text: 'Meet Orbit.' },
  { clip: 'classic', at: 3.4, text: 'A launcher for your Roblox games.' },
  { clip: 'classic', at: 6.6, text: 'Saved in your browser. Ready in one click.' },
  { clip: 'typing', at: 0.7, text: 'Paste a game link.' },
  { clip: 'typing', at: 3.2, text: 'Orbit takes you straight there.' },
  { clip: 'customize', at: 0.7, text: 'Pick your theme.' },
  { clip: 'customize', at: 2.6, text: 'Set your accent.' },
  { clip: 'customize', at: 4.3, text: 'Make it yours.' },
  { clip: 'queue', at: 0.6, text: 'Stack up a run.' },
  { clip: 'queue', at: 3.2, text: 'Search any experience.' },
  { clip: 'queue', at: 6.0, text: 'Set a session clock.' },
  { clip: 'queue', at: 8.8, text: 'Then launch the next.' },
  { clip: 'outro', at: 0.5, text: 'Orbit. Free in your browser.' },
  { clip: 'outro', at: 2.3, text: 'quantumstudios dot vercel dot app.' }
];

// Output goes straight to the terminal: execFileSync buffers stdout by default
// and a multi-megabyte encode overflows that buffer.
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
/* Same FFmpeg graph, but executed by name. Executed as a file the shebang can
   be `#!/usr/bin/env -S ffmpeg -hide_banner -loglevel error -y`, so on macOS
   and Linux alike every run is silent, and pressing Play on the script can
   never start a render. */
const runFfmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

// ---------------------------------------------------------------- fonts
const manrope = await fetch(
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;800&family=DM+Mono:wght@500&display=swap',
  { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36' } }
).then(r => r.text());
const fontFiles = {};
for (const [weight, label] of [['400', 'sans-regular'], ['800', 'sans-extra'], ['500', 'mono']]) {
  const src = [...manrope.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1])[
    weight === '500' ? 2 : weight === '800' ? 1 : 0
  ];
  const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
  fontFiles[label] = `data:font/woff2;base64,${buf.toString('base64')}`;
}

// ---------------------------------------------------------------- clips
async function upscale(clip) {
  const frames = fs.readdirSync(path.join(FOOTAGE, clip.dir)).sort();
  const file = path.join(WORK, `${clip.clip}.mp4`);
  const input = path.join(FOOTAGE, clip.dir, 'f%05d.png');
  if (!fs.existsSync(input.replace('%05d', String(frames.length - 1).padStart(5, '0')))) {
    throw new Error(`${clip.clip}: frame sequence looks incomplete`);
  }
  ffmpeg([
    '-framerate', String(FPS), '-i', input,
    '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-r', String(FPS),
    '-movflags', '+faststart', file
  ]);
  return file;
}

// ---------------------------------------------------------------- overlay renderer
function overlayHTML(scene, duration, index, total) {
  const c = scene.cursor;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:Manrope;font-weight:400;src:url(${fontFiles['sans-regular']}) format('woff2')}
  @font-face{font-family:Manrope;font-weight:800;src:url(${fontFiles['sans-extra']}) format('woff2')}
  @font-face{font-family:DM Mono;font-weight:500;src:url(${fontFiles.mono}) format('woff2')}
  *{box-sizing:border-box;margin:0}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent}
  /* Top scrim covers the app's own header; the bottom scrim darkens the lower
     half so the app's hero copy never competes with the ad copy. */
  .shade{position:absolute;inset:0;background:
    linear-gradient(180deg,rgba(8,12,9,.95) 0,rgba(8,12,9,.88) 150px,rgba(8,12,9,0) 330px),
    linear-gradient(0deg,rgba(8,12,9,.97) 0,rgba(8,12,9,.9) 330px,rgba(8,12,9,.5) 760px,rgba(8,12,9,0) 1080px)}
  .top{position:absolute;left:48px;right:48px;top:150px;display:flex;align-items:center;gap:18px;color:#f2f4ed;
    animation:drop .55s cubic-bezier(.2,.8,.2,1) both}
  .mark{width:46px;height:46px;border-radius:50%;border:2px solid ${LIME};display:grid;place-items:center;
    color:${LIME};font:800 20px Manrope;position:relative;flex:none}
  .mark::after{content:"";position:absolute;width:9px;height:9px;right:-3px;top:2px;border-radius:50%;
    background:${LIME};box-shadow:0 0 16px ${LIME}}
  .brand{font:800 27px Manrope;letter-spacing:.11em}
  .brand span{color:${LIME}}
  .step{margin-left:auto;font:500 20px 'DM Mono';letter-spacing:.16em;color:#c2cdc2}
  /* Captions sit in a solid panel so the footage behind can never wash them out. */
  .copy{position:absolute;left:48px;width:720px;bottom:${H - COPY_BOTTOM}px;padding:30px 32px 32px;color:#fff;
    background:rgba(10,16,11,.9);border:1px solid rgba(201,243,107,.35);box-shadow:0 24px 60px rgba(0,0,0,.55)}
  .kicker{display:inline-block;font:500 21px 'DM Mono';letter-spacing:.17em;color:${LIME};
    border:1px solid #43503f;background:#0b110d;padding:11px 16px;margin-bottom:20px;
    animation:rise .5s .08s cubic-bezier(.2,.8,.2,1) both}
  h1{font:800 62px/1.05 Manrope;letter-spacing:-.025em;text-shadow:0 4px 18px rgba(0,0,0,.85);
    animation:rise .6s .14s cubic-bezier(.2,.8,.2,1) both}
  .sub{font:600 27px Manrope;color:#eef2ea;margin-top:16px;text-shadow:0 2px 10px rgba(0,0,0,.9);
    animation:rise .6s .22s cubic-bezier(.2,.8,.2,1) both}
  .bar{position:absolute;left:48px;width:720px;bottom:270px}
  .progress{height:5px;background:rgba(255,255,255,.22);border-radius:99px;overflow:hidden}
  .fill{height:100%;background:${LIME};box-shadow:0 0 14px ${LIME};width:${((index + 1) / total) * 100}%}
  .cta{display:flex;align-items:center;gap:12px;margin-top:20px;color:#fff;font:800 28px Manrope;
    white-space:nowrap;text-shadow:0 2px 10px rgba(0,0,0,.9)}
  .cta b{color:${LIME}}
  .cta small{font:500 19px 'DM Mono';letter-spacing:.08em;color:#e2e9df;margin-left:auto}
  .cursor{position:absolute;width:38px;height:38px;transform:${
    c ? `translate(${c.x * W / 720 - 6}px,${c.y * H / 1280 - 4}px)` : 'translate(-200px,-200px)'
  };filter:drop-shadow(0 3px 6px rgba(0,0,0,.55))}
  .ripple{position:absolute;width:26px;height:26px;border-radius:50%;border:3px solid ${LIME};
    left:${c ? c.x * W / 720 + 8 : -200}px;top:${c ? c.y * H / 1280 + 10 : -200}px;opacity:0;
    ${c?.click ? `animation:ping .7s ${c.click}s ease-out 2;` : ''}}
  @keyframes ping{0%{transform:scale(.3);opacity:.95}100%{transform:scale(2.6);opacity:0}}
  @keyframes rise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
  @keyframes drop{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}
  </style></head><body>
  <div class="shade"></div>
  <div class="top"><div class="mark">O</div><div class="brand">ORBIT<span>.</span></div>
    <div class="step">0${index + 1} / 0${total}</div></div>
  <div class="copy"><div class="kicker">${scene.kicker}</div><h1>${scene.title}</h1>
    <p class="sub">${scene.sub}</p></div>
  <div class="bar"><div class="progress"><div class="fill"></div></div>
    <div class="cta"><b>Orbit</b> — free in your browser<small>${SITE}</small></div></div>
  ${c ? `<div class="ripple"></div><svg class="cursor" viewBox="0 0 24 24">
    <path d="M4 2l15 9-6.6 1.6L9 20z" fill="#fff" stroke="#0d120e" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>` : ''}
  </body></html>`;
}

async function renderOverlays() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const files = [];
  for (const [i, scene] of SCENES.entries()) {
    await page.setContent(overlayHTML(scene, scene.seconds, i, SCENES.length), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1100); // let entrance animations finish
    const file = path.join(WORK, `overlay-${i}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    files.push(file);
  }
  await browser.close();
  return files;
}

// ---------------------------------------------------------------- voiceover
// A soft, low trailer bed: two detuned saws + a filtered noise "air" layer,
// ducked under a brightening filter and a gentle sidechain pulse.
function musicTrack(seconds) {
  const sr = 48000;
  const n = Math.floor(seconds * sr);
  const out = Buffer.alloc(n * 4);
  const notes = [110, 130.81, 146.83, 98]; // A2 C3 D3 G2
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const bar = Math.floor(t / 3.2) % notes.length;
    const f = notes[bar];
    const saw = (p) => { const x = (t * p) % 1; return x * 2 - 1; };
    const tone = 0.5 * saw(f) + 0.28 * saw(f * 1.005);
    const env = Math.min(1, t / 1.2) * 0.5;
    const pulse = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.9 * t);
    const beat = 0.8 + 0.2 * Math.exp(-6 * ((t * 1.8) % 1));
    const v = Math.tanh(tone * 0.6) * env * pulse * beat * 0.22;
    out.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, i * 4);
    out.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, i * 4 + 2);
  }
  const file = path.join(WORK, 'bed.wav');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + out.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22); header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(out.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, out]));
  return file;
}

// ---------------------------------------------------------------- video segments
const segments = [];
let t = 0;
// 1.6s hook card, so the first frame says what the video is before footage plays.
const starts = [];

fs.rmSync(WORK, { force: true, recursive: true });
fs.mkdirSync(WORK, { recursive: true });

// Longer than a blink, and it carries the first voice line.
const hookDuration = 3.2;
// Hook card: a held brand frame so the first second is legible before footage.
{
  const file = path.join(WORK, 'hook.mp4');
  const color = `color=c=0x0b110d:s=${W}x${H}:r=${FPS}:d=${hookDuration}`;
  ffmpeg([
    '-f', 'lavfi', '-i', color,
    '-vf', 'format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-t', String(hookDuration), file
  ]);
  segments.push({ file, duration: hookDuration, kind: 'hook', start: 0 });
}
t = hookDuration;

const clips = JSON.parse(fs.readFileSync(path.join(FOOTAGE, 'clips.json'), 'utf8'));
for (const [i, scene] of SCENES.entries()) {
  const clip = clips.find(c => c.dir.endsWith(scene.clip));
  scene.seconds = clip.seconds;
  const file = await upscale({ clip: scene.clip, dir: scene.clip });
  starts.push({ scene: scene.clip, start: t, duration: clip.seconds });
  segments.push({ file, duration: clip.seconds, kind: 'clip', start: t, scene });
  t += clip.seconds;
}

// Outro card reusing a frame of real footage (home screen) under the CTA.
const outroDuration = 3.6;
{
  const src = path.join(FOOTAGE, 'classic', 'f00020.png');
  const file = path.join(WORK, 'outro.mp4');
  ffmpeg([
    '-loop', '1', '-i', src, '-t', String(outroDuration),
    '-vf', `scale=${W}:${H}:flags=lanczos,zoompan=z='min(1.10,1+0.10*on/${outroDuration * FPS})':d=1:x='iw/2-(iw/zoom/2)':y='ih*0.25':s=${W}x${H}:fps=${FPS},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', file
  ]);
  segments.push({ file, duration: outroDuration, kind: 'outro', start: t, scene: { clip: 'outro' } });
  starts.push({ scene: 'outro', start: t, duration: outroDuration });
  t += outroDuration;
}

const TOTAL = t;
console.log(`timeline: ${TOTAL.toFixed(2)}s`, starts);

// ---------------------------------------------------------------- overlays
const overlays = await renderOverlays();
{
  const outroHTML = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:Manrope;font-weight:400;src:url(${fontFiles['sans-regular']}) format('woff2')}
    @font-face{font-family:Manrope;font-weight:800;src:url(${fontFiles['sans-extra']}) format('woff2')}
    @font-face{font-family:DM Mono;font-weight:500;src:url(${fontFiles.mono}) format('woff2')}
    *{margin:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent}
    .vignette{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,rgba(10,16,11,.55),rgba(8,12,9,.93) 72%)}
      /* Solid card so the outro copy reads over the zoomed footage too. */
    .c{position:absolute;left:60px;width:760px;top:560px;padding:40px 34px 44px;text-align:center;color:#fff;
      background:rgba(10,16,11,.92);border:1px solid rgba(201,243,107,.35);box-shadow:0 28px 70px rgba(0,0,0,.6)}
    .badge{display:inline-block;font:500 22px 'DM Mono';letter-spacing:.2em;color:${LIME};
      border:1px solid #43503f;padding:12px 18px;background:#0b110d}
    h1{font:800 92px/1 Manrope;letter-spacing:-.03em;margin:30px 0 18px;
      text-shadow:0 4px 18px rgba(0,0,0,.85)}
    h1 span{color:${LIME}}
    p{font:600 32px Manrope;color:#eef2ea;text-shadow:0 2px 10px rgba(0,0,0,.9)}
    .pill{display:inline-flex;align-items:center;gap:14px;margin-top:46px;padding:22px 34px;
      background:${LIME};color:#101610;font:800 36px Manrope;border-radius:2px;
      box-shadow:0 18px 50px rgba(201,243,107,.22)}
    .url{margin-top:26px;font:500 25px 'DM Mono';letter-spacing:.06em;color:#dfe7da}
    .arrow{animation:bob 1.2s ease-in-out infinite}
    @keyframes bob{50%{transform:translateY(5px)}}
  </style></head><body>
    <div class="vignette"></div>
    <div class="c"><div class="badge">ORBIT · ROBLOX LAUNCHER</div>
      <h1>Where to<span>?</span></h1>
      <p>Your game library, one step away.</p>
      <div class="pill"><span class="arrow">↗</span> ${SITE}</div>
      <div class="url">Free · No install · Runs in your browser</div></div>
  </body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(outroHTML, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(WORK, 'overlay-outro.png'), omitBackground: true });
  const hookHTML = overlayHTML({ kicker: 'ROBLOX · FREE IN BROWSER', title: 'Stop<br>searching.', sub: 'Start launching.' }, 1, 0, 4)
    .replace('<div class="step">01 / 04</div>', '<div class="step">YOUTUBE SHORTS</div>')
    .replace('<div class="bar">', '<div class="bar" style="visibility:hidden">');
  await page.setContent(hookHTML, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(WORK, 'overlay-hook.png'), omitBackground: true });
  await browser.close();
}

// ---------------------------------------------------------------- compose
const args = ['-hide_banner', '-loglevel', 'error', '-y'];
const filters = [];
let idx = 0;
function input(file, extra = []) { args.push(...extra, '-i', file); return idx++; }

// hook video
{
  const i = input(segments[0].file);
  const o = input(path.join(WORK, 'overlay-hook.png'), ['-loop', '1', '-framerate', String(FPS), '-t', String(segments[0].duration)]);
  filters.push(`[${i}:v]scale=${W}:${H},setsar=1[v${i}]`);
  filters.push(`[v${i}][${o}:v]overlay=0:0:format=auto,format=yuv420p[vhook]`);
}
// clip videos + overlays
const clipVideoLabels = [];
segments.slice(1).forEach((seg, n) => {
  const i = input(seg.file);
  filters.push(`[${i}:v]scale=${W}:${H},setsar=1[v${i}]`);
  const overlay = seg.kind === 'clip' ? overlays[n] : path.join(WORK, 'overlay-outro.png');
  const o = input(overlay, ['-loop', '1', '-framerate', String(FPS), '-t', String(seg.duration)]);
  filters.push(`[v${i}][${o}:v]overlay=0:0:format=auto,format=yuv420p[v${i}]`);
  clipVideoLabels.push(`v${i}`);
});

// Quick crossfades between scenes. xfade's offset is measured on the already
// combined stream, so track the cursor and then advance it past each scene.
const XFADE = 0.18;
let acc = 'vhook';
let cursor = segments[0].duration;
clipVideoLabels.forEach((label, k) => {
  const out = `xf${k}`;
  filters.push(`[${acc}][${label}]xfade=transition=fade:duration=${XFADE}:offset=${(cursor - XFADE).toFixed(3)}[${out}]`);
  acc = out;
  cursor += segments[k + 1].duration - XFADE;
});
filters.push(`[${acc}]fade=t=in:st=0:d=0.25,fade=t=out:st=${(TOTAL - 0.5).toFixed(2)}:d=0.5,format=yuv420p[vout]`);

// audio: voice clips over music bed
const bed = musicTrack(TOTAL + 1);
const bedIdx = input(bed);
const voLabels = [];
let voIdx = 0;
for (const line of VOICE) {
  const scene = starts.find(s => s.scene === line.clip);
  if (!scene) continue;
  const at = (scene.start + line.at).toFixed(2);
  const padded = path.join(WORK, `vo-${voIdx}.wav`);
  execFileSync('espeak-ng', [
    '-v', 'en-us+m3', '-s', '168', '-p', '40', '-a', '165', '-w', padded, line.text
  ]);
  voLabels.push({ label: `vo${voIdx}`, at: Number(at), i: input(padded) });
  voIdx++;
}
// espeak writes 22050 Hz mono. Set the declared sample rate to the *pitch*
// factor (no /48000) so the octave shift works, then atempo 1/factor to bring
// duration back. The old 48000*factor made every line 2.2x too fast, so the
// whole voiceover finished seconds before its caption.
const voicePitch = Number(process.env.VOICE_PITCH || '0.84');
const delays = [
  `[${bedIdx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
  `volume=0.6,afade=t=in:st=0:d=1.2,afade=t=out:st=${(TOTAL - 0.8).toFixed(2)}:d=0.8[bed]`
];
const voiceLabels = [];
for (const v of voLabels) {
  delays.push(
    `[${v.i}:a]asetrate=22050*${voicePitch},aresample=48000,atempo=${(1 / voicePitch).toFixed(3)},` +
    `aformat=channel_layouts=stereo,` +
    // espeak adds ~6 s of silence after each line; cut it so the voice does not
    // hold the music ducked until the end of the video.
    `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05:stop_periods=-1:stop_threshold=-45dB:stop_silence=0.2,` +
    `highpass=f=110,lowpass=f=7200,volume=2.2,` +
    `adelay=${Math.round(v.at * 1000)}|${Math.round(v.at * 1000)}[${v.label}]`
  );
  voiceLabels.push(`[${v.label}]`);
}
filters.push(...delays);
// Duck the bed under the voice: when the voice mix rises above -25 dB it pulls
// the music down ~10 dB. Without this the two compete on phone speakers.
filters.push(
  `${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0:duration=longest[voice],` +
  `[voice]asplit=2[voiceMix][voiceKey];` +
  `[bed][voiceKey]sidechaincompress=threshold=0.003:ratio=12:attack=15:release=320:makeup=1[bedDucked]`
);
filters.push(
  `[bedDucked]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bed48];` +
  `[voiceMix]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[voice48];` +
  `[voice48][bed48]amix=inputs=2:normalize=0:duration=longest,` +
  `atrim=0:${TOTAL},apad=whole_dur=${TOTAL},` +
  // Shorts are watched on phone speakers, so master mobile-style: -14 LUFS
  // integrated with peaks at or below the YouTube -1.5 dBTP ceiling.
  `loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,` +
  `afade=t=in:st=0:d=0.2,afade=t=out:st=${(TOTAL - 0.6).toFixed(2)}:d=0.6[aout]`
);

fs.writeFileSync(path.join(WORK, 'filters.txt'), filters.join(';\n'));
ffmpeg([
  ...args,
  '-filter_complex_script', path.join(WORK, 'filters.txt'),
  '-map', '[vout]', '-map', '[aout]',
  '-t', String(TOTAL),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-profile:v', 'high', '-level', '4.2',
  '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-movflags', '+faststart',
  OUT
]);

const size = fs.statSync(OUT).size;
console.log(`wrote ${OUT} (${(size / 1048576).toFixed(1)} MB)`);
fs.writeFileSync(path.join(ROOT, 'timeline.json'), JSON.stringify({ total: TOTAL, starts }, null, 2));
