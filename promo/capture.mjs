// Captures real browser footage of the live Orbit launcher for a YouTube Short.
// Uses Playwright's built-in screencast (real rendered frames, not screenshots)
// and records cursor/typing/scroll interactions against the actual pages.
//
// Run:  ORBIT_BASE=https://quantumstudios.vercel.app node promo/capture.mjs
// (falls back to a local static server on http://localhost:4173 if unset)
//
// The deployed site sits behind a Cloudflare Turnstile gate. The gate only hands
// out a signed HttpOnly access cookie after a *server-side* siteverify call, so
// the footage is recorded against the same pages served locally. The assets,
// layout and copy are identical; only this file's data seeding differs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const p of ['patchright', '/tmp/node_modules/patchright', 'playwright']) {
    try { return require(p); } catch {}
  }
  throw new Error('patchright/playwright not installed');
})();
import fs from 'node:fs';

const BASE = process.env.ORBIT_BASE || 'http://localhost:4173';
const OUT = new URL('./footage/', import.meta.url).pathname;
const FPS = 30;
fs.mkdirSync(OUT, { recursive: true });

const W = 720;
const H = 1280;

const library = [
  { id: '920587237', title: 'Adopt Me!', universeId: '4131853979', color: 'lime' },
  { id: '142823291', title: 'Murder Mystery 2', universeId: '142823291', color: 'blue' },
  { id: '1962086868', title: 'Tower of Hell', universeId: '1721473782', color: 'violet' },
  { id: '2788229376', title: 'Doors', universeId: '2506691911', color: 'amber' },
  { id: '3260590327', title: 'Blox Fruits', universeId: '1586312604', color: 'mint' },
  { id: '155615604', title: "Piggy", universeId: '1166206', color: 'red' }
];

const recents = library.slice(0, 3).map(g => ({ id: g.id }));

// Response shape returned by GET /api/roblox/search on the deployed site.
// Supplied from disk so the clip is deterministic and short; the page still
// runs its real fetch/render/queue code paths.
const SEARCH_FIXTURE = {
  results: [
    { placeId: '1962086868', universeId: '1878091', name: 'Tower of Hell', creator: 'YXCeptional Studios', playerCount: 42183, ageRating: 'All Ages' },
    { placeId: '1962086869', universeId: '1878091', name: 'Tower of Hell! (Classic)', creator: 'Community Build', playerCount: 812, ageRating: 'All Ages' },
    { placeId: '1962086870', universeId: '1878092', name: 'Tower of Heck', creator: 'SkyBuilders', playerCount: 204, ageRating: 'All Ages' }
  ],
  cursor: null
};

async function newPage(browser, { dark = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC'
  });
  await context.addInitScript(({ library, recents, dark }) => {
    const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    set('orbit-games-library', library);
    set('orbit-recent-games', recents);
    if (dark) set('orbit-home-settings', { theme: 'orbit', background: 'glow', density: 'roomy' });
    localStorage.setItem('orbit-donation-prompt-v2', JSON.stringify({ dismissed: true, nextAt: Date.now() + 86400000 }));
  }, { library, recents, dark });
  return { context, page: await context.newPage() };
}

// Records a page to a .webm via the CDP screencast.
async function record(page, name, durationMs, action) {
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    // A real pointer is drawn by the popup card overlay in build.mjs; keep the
    // native cursor out of the frames.
    document.documentElement.style.cursor = 'none';
  });
  const chunks = [];
  let stopped = false;
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    if (stopped) return;
    chunks.push({ data: Buffer.from(data, 'base64'), t: Date.now() });
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now();
  try { await action(Date.now); } catch (error) { console.error(`action failed for ${name}:`, error.message); }
  // Hard cap so a stalled step cannot balloon the source clip.
  const elapsed = Date.now() - t0;
  if (elapsed > durationMs) console.warn(`${name}: action ran ${((elapsed - durationMs) / 1000).toFixed(1)}s over budget`);
  if (elapsed < durationMs) await page.waitForTimeout(durationMs - elapsed);
  stopped = true;
  await cdp.send('Page.stopScreencast').catch(() => {});
  await cdp.detach().catch(() => {});

  // Screencast frames arrive only when the page changes, so replay them at a
  // steady 30fps: each frame is held until the next one arrives.
  const dir = `${OUT}${name}`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const start = chunks[0]?.t ?? t0;
  let frameIndex = 0;
  const last = chunks.length ? chunks[chunks.length - 1].t : start + durationMs;
  const total = Math.max(durationMs, last - start);
  const totalFrames = Math.round((total / 1000) * FPS);
  let ci = 0;
  for (let f = 0; f < totalFrames; f++) {
    const t = start + (f / FPS) * 1000;
    while (ci + 1 < chunks.length && chunks[ci + 1].t <= t) ci++;
    if (chunks[ci]) {
      fs.writeFileSync(`${dir}/f${String(f).padStart(5, '0')}.png`, chunks[ci].data);
      frameIndex++;
    }
  }
  console.log(`${name}: ${frameIndex} frames over ${(total / 1000).toFixed(1)}s`);
  return { dir, frames: frameIndex, seconds: total / 1000 };
}

async function smoothScroll(page, toY, ms) {
  const from = await page.evaluate(() => window.scrollY);
  const t0 = Date.now();
  while (true) {
    const p = Math.min(1, (Date.now() - t0) / ms);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    await page.evaluate(y => window.scrollTo(0, y), from + (toY - from) * e);
    if (p >= 1) break;
    await page.waitForTimeout(16);
  }
}

async function typeSlow(page, selector, text, perChar = 55) {
  const field = page.locator(selector);
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await field.fill('');
  // Wait until the field is really on screen and focused, otherwise the first
  // characters land while the page is still scrolling and are lost.
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel);
    return document.activeElement === el && el.getBoundingClientRect().top < innerHeight * 0.75;
  }, selector);
  await page.waitForTimeout(250);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: perChar });
  }
  await page.waitForFunction(([sel, value]) => document.querySelector(sel).value === value,
    [selector, text], { timeout: 8000 })
    .catch(() => console.warn(`typing into ${selector} did not complete`));
}

const clips = [];
const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--force-color-profile=srgb'] });

// ---- 1. Classic launcher: hero, library, scroll -----------------------------
{
  const { context, page } = await newPage(browser);
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#welcome-headline');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 560));
  await page.waitForTimeout(400);
  clips.push(await record(page, 'classic', 9200, async () => {
    await page.waitForTimeout(1800);            // my games, in the lower 60% of frame
    await page.getByRole('button', { name: 'Play' }).first().hover().catch(() => {});
    await page.waitForTimeout(1100);
    await smoothScroll(page, 330, 1400);        // back up to the library heading
    await page.waitForTimeout(1000);
    await smoothScroll(page, 1080, 1700);       // explore / quick access
    await page.waitForTimeout(1200);
  }));

  // 2. Typing a Roblox link into the launcher (form sits below the copy band)
  await page.evaluate(() => {
    const form = document.querySelector('#launch-form');
    window.scrollTo(0, document.querySelector('#launch').offsetTop + form.getBoundingClientRect().top - 760);
  });
  await page.waitForTimeout(500);
  clips.push(await record(page, 'typing', 5600, async () => {
    await page.waitForTimeout(800);
    await typeSlow(page, '#game-input', 'roblox.com/games/1962086868', 42);

    await page.waitForTimeout(900);
    await page.locator('#launch-form button[type=submit]').hover();
    await page.waitForTimeout(1200);
  }));

  // 3. Customize panel (real theme switching), opened low so the copy band stays clear
  await page.evaluate(() => window.scrollTo(0, Math.max(0, document.querySelector('#library').offsetTop - 360)));
  await page.waitForTimeout(400);
  clips.push(await record(page, 'customize', 6000, async () => {
    await page.locator('#customize-open').click();
    await page.waitForTimeout(900);
    await page.locator('button[data-theme="ice"]').click();
    await page.waitForTimeout(600);
    // Step aside so the recoloured launcher behind the panel is visible.
    await page.locator('dialog[open]').evaluate(el => el.close()).catch(() => {});
    await page.waitForTimeout(1100);
    await page.locator('#customize-open').click();
    await page.waitForTimeout(600);
    await page.locator('button[data-theme="coral"]').click();
    await page.waitForTimeout(500);
    await page.locator('dialog[open]').evaluate(el => el.close()).catch(() => {});
    await page.waitForTimeout(1200);
  }));
  await context.close();
}

// ---- 4. Orbit Queue: search, queue, session clock ---------------------------
{
  const { context, page } = await newPage(browser);
  await context.route('**/api/roblox/search**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_FIXTURE) })
  );
  await page.goto(`${BASE}/ai.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#page-title');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 420));
  await page.waitForTimeout(400);
  clips.push(await record(page, 'queue', 12500, async () => {
    await page.waitForTimeout(1500);
    await typeSlow(page, '#search-query', 'tower of hell', 70);
    await page.locator('#search-submit').click();
    // The page renders results from the search function response.
    await page.waitForSelector('#search-results .search-result', { timeout: 6000 })
      .catch(() => console.warn('queue search returned no rows'));
    await page.waitForTimeout(1600);
    // Queue the top match, exactly as a visitor would.
    await page.locator('#search-results .search-result').first()
      .getByRole('button', { name: /Queue/ }).click().catch(() => {});
    await page.waitForTimeout(1800);
    await page.locator('#queue-list').hover().catch(() => {});
    await page.waitForTimeout(1200);
  }));
  await context.close();
}

await browser.close();
fs.writeFileSync(`${OUT}clips.json`, JSON.stringify(clips, null, 2));
console.log('done', clips);
