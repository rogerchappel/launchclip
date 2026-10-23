// Demo autopilot, step 4: record each DEMO-PLAN.json flow in a real browser.
//
// Playwright (optional dependency, Apache-2.0, or the one the recorded app's
// repo installs when LaunchClip's is missing) drives Chromium in a fresh
// context (a clean profile: no cookies, extensions or history) at the plan's
// viewport (1920×1080 by default, deviceScaleFactor 2 for 4K). It uses an
// already installed Chromium and never downloads one: LAUNCHCLIP_CHROMIUM,
// then Playwright's pinned build, then the newest Chromium in the Playwright
// cache, then a system Chrome.
//
// Video comes from the DevTools screencast (Page.startScreencast), not
// Playwright's recordVideo (which needs Playwright's own ffmpeg build): each
// frame carries a wall-clock timestamp, and the system ffmpeg turns the frames
// into a constant-frame-rate H.264 clip with every frame held until the next
// one. Chrome only sends a frame when the page repaints, so held frames are
// exact, and the action log shares the same clock.
//
// Interactions are human-paced: eased cursor paths (easeInOutCubic, 0.35–0.9 s
// by distance), a short settle before each click, and typing at 45–110 ms per
// character from a seeded PRNG, so a re-recording is identical. A synthetic
// cursor and click ripple are drawn in the page (the OS cursor never shows in
// a screencast).
//
// Output per flow: <flow>.mp4, <flow>.actions.json (every action with type,
// selector/text, bounding box in viewport CSS px, start/end seconds in the
// video) and <flow>.poster.png.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertSafeUrl, redactWith } from "./guardrails.js";
import { DEFAULT_VIEWPORT, validateDemoPlan } from "./plan.js";

export const ACTION_LOG_SCHEMA = "launchclip.demo-actions.v1";

/** Chromium executable to drive, without downloading: → path | null. */
export async function findChromium({ env = process.env, playwrightPath = null } = {}) {
  if (env.LAUNCHCLIP_CHROMIUM && existsSync(env.LAUNCHCLIP_CHROMIUM)) return env.LAUNCHCLIP_CHROMIUM;
  if (playwrightPath && existsSync(playwrightPath)) return playwrightPath;
  const cache = env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Caches", "ms-playwright") : process.platform === "win32" ? path.join(env.LOCALAPPDATA ?? "", "ms-playwright") : path.join(os.homedir(), ".cache", "ms-playwright"));
  const builds = (await readdir(cache).catch(() => [])).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const inside = process.platform === "darwin"
    ? ["chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]
    : process.platform === "win32" ? ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"] : ["chrome-linux64/chrome", "chrome-linux/chrome"];
  for (const build of builds) for (const rel of inside) if (existsSync(path.join(cache, build, rel))) return path.join(cache, build, rel);
  const system = process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return system.find((file) => existsSync(file)) ?? null;
}

/**
 * Playwright's chromium, or null when it is missing: LaunchClip's optional
 * dependency first, then a playwright, @playwright/test or playwright-core
 * that the recorded app's repo (`repo`) already installs.
 */
export async function loadPlaywright({ repo = null, own = () => import("playwright") } = {}) {
  try { return (await own()).chromium; } catch { /* not installed with LaunchClip */ }
  if (!repo) return null;
  const require = createRequire(path.join(path.resolve(repo), "package.json"));
  for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
    try { return require(name).chromium ?? null; } catch { /* try the next */ }
  }
  return null;
}

/** What recording needs and whether it is here: {ok, chromium, executablePath, ffmpeg, reasons}. */
export async function recorderAvailability({ env = process.env, repo = null } = {}) {
  const reasons = [];
  const chromium = await loadPlaywright({ repo });
  if (!chromium) reasons.push(`the optional dependency playwright is not installed (npm install playwright)${repo ? `, and ${repo} does not install one either` : ""}`);
  let pinned = null;
  try { pinned = chromium?.executablePath() ?? null; } catch { pinned = null; }
  const executablePath = chromium ? await findChromium({ env, playwrightPath: pinned }) : null;
  if (chromium && !executablePath) reasons.push("no Chromium found; set LAUNCHCLIP_CHROMIUM or install one (npx playwright install chromium)");
  const ffmpeg = await hasFfmpeg();
  if (!ffmpeg) reasons.push("ffmpeg is not on PATH");
  return { ok: reasons.length === 0, chromium, executablePath, ffmpeg, reasons };
}

function exec(command, args, { cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-6000); });
    child.on("error", (error) => resolve({ code: -1, stderr: error.message }));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

async function hasFfmpeg() {
  return (await exec("ffmpeg", ["-hide_banner", "-version"])).code === 0;
}

// ---------------------------------------------------------------------------
// Pacing

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const char of String(seed)) h = Math.imul(h ^ char.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/**
 * Cursor path from `from` to `to`: [{x, y, dt}] at ~60 Hz, eased, with a
 * slight arc (a hand never moves in a straight line). Duration 0.35–0.9 s by
 * distance.
 */
export function cursorPath(from, to, random = Math.random) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const duration = Math.min(0.9, Math.max(0.35, 0.25 + distance / 2200));
  const steps = Math.max(2, Math.round(duration * 60));
  const bend = (random() - 0.5) * Math.min(120, distance * 0.18);
  const nx = distance ? -dy / distance : 0, ny = distance ? dx / distance : 0;
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const p = easeInOutCubic(i / steps);
    const arc = Math.sin(Math.PI * p) * bend;
    out.push({ x: Math.round((from.x + dx * p + nx * arc) * 10) / 10, y: Math.round((from.y + dy * p + ny * arc) * 10) / 10, dt: duration / steps });
  }
  return out;
}

/** Per-character typing delays (ms), 45–110, a little slower after spaces. */
export function typingDelays(text, random = Math.random) {
  return [...String(text)].map((char) => Math.round(45 + random() * 65 + (char === " " ? 40 : 0)));
}

// Synthetic cursor and click ripple, drawn in every document of the context.
// Exported for callers that build their own context; prepareContext adds it.
export const CURSOR_SCRIPT = `(() => {
  if (window.__lcCursor) return;
  window.__lcCursor = true;
  const pos = (() => { try { return JSON.parse(sessionStorage.getItem('__lc_cursor') || 'null'); } catch { return null; } })() || { x: innerWidth / 2, y: innerHeight / 2 };
  const mount = () => {
    const style = document.createElement('style');
    style.textContent = '#__lc_cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform-origin:4px 3px;transition:scale .12s ease-out;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}#__lc_cursor.down{scale:.82}.__lc_ripple{position:fixed;z-index:2147483646;pointer-events:none;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:3px solid rgba(91,77,255,.85);animation:__lc_ripple .55s ease-out forwards}@keyframes __lc_ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.25);opacity:0}}';
    document.documentElement.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = '__lc_cursor';
    cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 3 L4 22 L9 17.5 L12.6 25 L16 23.5 L12.5 16.2 L19.5 16 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cursor);
    const place = (x, y) => { cursor.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 3) + 'px)'; };
    place(pos.x, pos.y);
    addEventListener('mousemove', (e) => { place(e.clientX, e.clientY); try { sessionStorage.setItem('__lc_cursor', JSON.stringify({ x: e.clientX, y: e.clientY })); } catch {} }, true);
    addEventListener('mousedown', (e) => { cursor.classList.add('down'); const r = document.createElement('div'); r.className = '__lc_ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
    addEventListener('mouseup', () => cursor.classList.remove('down'), true);
  };
  if (document.documentElement) mount(); else addEventListener('DOMContentLoaded', mount);
})();`;

/**
 * Get a context ready to record: the synthetic cursor in every page, and the
 * plan's network setup (`app`, relative paths resolved from `planDir`). Call
 * it on a context you create yourself before passing it to recordFlow.
 */
export async function prepareContext(context, { app = {}, url = app.url, planDir = process.cwd(), log = () => {} } = {}) {
  await context.addInitScript(CURSOR_SCRIPT);
  if (url) await routeNetwork(context, app, { origin: new URL(url).origin, planDir, log });
}

let fixtureLoads = 0;

/** Import a fixtures module afresh (its own state per flow). → its route function. */
export async function loadFixtures(file) {
  const href = `${pathToFileURL(path.resolve(file)).href}?launchclip=${++fixtureLoads}`;
  const module = await import(href);
  const route = module.route ?? module.default?.route ?? module.default;
  if (typeof route !== "function") throw new Error(`${file} must export route({request, url, method, body})`);
  return route;
}

/** A fixture's answer → route.fulfill options. */
export function fixtureResponse(result, { cors = null } = {}) {
  const json = Object.hasOwn(result, "json");
  const raw = result.body;
  const body = json ? JSON.stringify(result.json) : typeof raw === "string" || Buffer.isBuffer(raw) ? raw : raw === undefined ? "" : JSON.stringify(raw);
  const contentType = result.contentType ?? (json || (raw !== undefined && typeof raw !== "string" && !Buffer.isBuffer(raw)) ? "application/json" : "text/plain");
  const headers = { ...(cors ? { "access-control-allow-origin": cors, "access-control-allow-credentials": "true" } : {}), ...(result.headers ?? {}) };
  return { status: result.status ?? 200, contentType, headers, body };
}

// Handlers run last-registered first and route.fallback() hands a request to
// the one registered before, so the order is fixtures → HAR → origin guard.
async function routeNetwork(context, app, { origin, planDir, log }) {
  const fixtures = app.fixtures ? await loadFixtures(path.resolve(planDir, app.fixtures)) : null;
  const har = app.har ? path.resolve(planDir, app.har) : null;
  if (app.blockOffOrigin ?? Boolean(fixtures || har)) {
    const allowed = new Set([origin, ...(app.allowOrigins ?? [])]);
    const blocked = new Set();
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url()).origin;
      if (allowed.has(target)) return route.continue();
      if (!blocked.has(target)) { blocked.add(target); log(`blocked requests to ${target} (not the app; add it to app.allowOrigins to let it through)`); }
      return route.abort("blockedbyclient");
    });
  }
  if (har) {
    if (!existsSync(har)) throw new Error(`app.har ${har} does not exist`);
    await context.routeFromHAR(har, { notFound: "fallback" });
  }
  if (fixtures) {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let body = null;
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
      try {
        const result = await fixtures({ request, url, method: request.method(), body });
        if (result === undefined || result === null) return route.fallback();
        return route.fulfill(fixtureResponse(result, { cors: url.origin === origin ? null : origin }));
      } catch (error) {
        log(`fixtures: ${request.method()} ${url.pathname} threw ${error.message}`);
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: `fixture error: ${error.message}` }) });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Screencast → constant-frame-rate MP4

class Screencast {
  constructor(session, dir, { width, height }) {
    this.session = session;
    this.dir = dir;
    this.size = { width, height };
    this.frames = [];
    this.writes = [];
    this.onFrame = ({ data, metadata, sessionId }) => {
      const file = path.join(dir, `f${String(this.frames.length).padStart(6, "0")}.jpg`);
      this.frames.push({ file, t: metadata.timestamp });
      this.writes.push(writeFile(file, Buffer.from(data, "base64")));
      session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    };
  }

  async start() {
    this.session.on("Page.screencastFrame", this.onFrame);
    await this.session.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: this.size.width, maxHeight: this.size.height, everyNthFrame: 1 });
    // Wait for the first frame: it defines t = 0 of the video.
    const deadline = Date.now() + 5000;
    while (!this.frames.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!this.frames.length) throw new Error("the screencast sent no frames");
    return this.frames[0].t;
  }

  async stop() {
    const stoppedAt = Date.now() / 1000;
    await this.session.send("Page.stopScreencast").catch(() => {});
    this.session.off("Page.screencastFrame", this.onFrame);
    await Promise.all(this.writes);
    return stoppedAt;
  }
}

/**
 * Encode timestamped frames into a constant-frame-rate MP4 with ffmpeg's
 * concat demuxer: each frame is held until the next frame's timestamp, the
 * last until `endTime`.
 */
export async function encodeFrames(frames, endTime, out, { fps = 30, width, height } = {}) {
  if (!frames.length) throw new Error("no frames to encode");
  const t0 = frames[0].t;
  const lines = ["ffconcat version 1.0"];
  frames.forEach((frame, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : endTime;
    lines.push(`file '${frame.file.replace(/'/g, "'\\''")}'`, `duration ${Math.max(0.001, next - frame.t).toFixed(6)}`);
  });
  // The concat demuxer ignores the last duration unless the file is repeated.
  lines.push(`file '${frames.at(-1).file.replace(/'/g, "'\\''")}'`);
  const list = `${out}.ffconcat`;
  await writeFile(list, `${lines.join("\n")}\n`);
  const scale = width && height ? `scale=${width}:${height}:flags=lanczos,` : "";
  const result = await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `${scale}fps=${fps},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", "-t", (endTime - t0).toFixed(3), out]);
  await rm(list, { force: true });
  if (result.code !== 0) throw new Error(`ffmpeg failed to encode ${out}: ${result.stderr}`);
  return { duration: Math.round((endTime - t0) * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// Steps

// The first visible match: responsive apps often render a hidden duplicate
// (a mobile menu, a collapsed sidebar) ahead of the one on screen.
export function locate(page, step) {
  const first = (locator) => locator.filter({ visible: true }).first();
  if (step.selector) return first(page.locator(step.selector));
  const text = step.text;
  if (step.type === "type") return first(page.getByLabel(text, { exact: true }).or(page.getByPlaceholder(text, { exact: true })));
  if (step.type === "click") return first(page.getByRole("button", { name: text, exact: true }).or(page.getByRole("link", { name: text, exact: true })).or(page.getByText(text, { exact: true })));
  return first(page.getByText(text, { exact: false }));
}

/** Run steps off camera at full speed (setup flows such as sign-in). */
async function runQuick(page, steps, { resolveUrl, account }) {
  for (const step of steps) {
    if (step.type === "goto") await page.goto(resolveUrl(step.path ?? step.url), { waitUntil: "load" });
    else if (step.type === "pause") continue;
    else {
      const target = locate(page, step);
      await target.waitFor({ state: "visible", timeout: step.timeout ?? 10000 });
      if (step.type === "click") { await target.click(); await page.waitForLoadState("load").catch(() => {}); }
      if (step.type === "type") {
        const value = typeof step.value === "object" ? account?.[step.value.account] : step.value;
        if (typeof value !== "string") throw new Error(`setup step needs a test account ${step.value.account}`);
        await target.fill(value);
      }
    }
  }
  await page.waitForTimeout(400);
}

const r1 = (value) => Math.round(value * 10) / 10;
const r3 = (value) => Math.round(value * 1000) / 1000;
const boxOf = (box) => (box ? { x: r1(box.x), y: r1(box.y), width: r1(box.width), height: r1(box.height) } : null);

/**
 * Record one flow on a fresh page of `context`. → {video, log, poster}.
 * `accounts` supplies {email, password, username} for {account: …} values.
 */
export async function recordFlow(context, flow, { url, out, viewport, account = null, fps = 30, allowHosts = [], setup = [], log: say = () => {} } = {}) {
  const random = seededRandom(flow.id);
  const page = await context.newPage();
  const scale = viewport.deviceScaleFactor ?? 1;
  const frameSize = { width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) };
  const workDir = await mkdtemp(path.join(os.tmpdir(), `launchclip-demo-${flow.id}-`));
  const masks = account ? Object.values(account).filter((value) => typeof value === "string") : [];
  const actions = [];
  let cursor = { x: viewport.width / 2, y: viewport.height / 2 };
  const resolveUrl = (target) => {
    const href = new URL(target, url).href;
    if (new URL(href).origin !== new URL(url).origin) assertSafeUrl(href, { allowHosts });
    return href;
  };
  try {
    for (const before of setup) await runQuick(page, before.steps, { resolveUrl, account });
    // Open the first page before the clip starts, so it never shows a blank tab.
    const first = flow.steps[0];
    await page.goto(resolveUrl(first.path ?? first.url), { waitUntil: "load" });
    await page.mouse.move(cursor.x, cursor.y);
    await page.waitForTimeout(600);
    const session = await context.newCDPSession(page);
    const cast = new Screencast(session, workDir, frameSize);
    const t0 = await cast.start();
    const now = () => r3(Date.now() / 1000 - t0);
    actions.push({ index: 0, type: "goto", path: first.path ?? first.url, label: first.label ?? null, url: page.url(), start: 0, end: 0, box: null, callout: first.callout ?? null });
    await page.waitForTimeout(700);

    const moveTo = async (target) => {
      for (const point of cursorPath(cursor, target, random)) {
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(point.dt * 1000);
      }
      cursor = target;
    };

    for (const [index, step] of flow.steps.entries()) {
      if (index === 0) continue;
      const entry = { index, type: step.type, selector: step.selector ?? null, text: step.text ?? null, label: step.label ?? step.text ?? null, start: now(), end: null, box: null, callout: step.callout ?? null };
      if (step.type === "goto") {
        await page.goto(resolveUrl(step.path ?? step.url), { waitUntil: "load" });
        entry.path = step.path ?? step.url;
      } else if (step.type === "pause") {
        await page.waitForTimeout(step.ms);
      } else {
        const target = locate(page, step);
        await target.waitFor({ state: "visible", timeout: step.timeout ?? 10000 });
        await target.scrollIntoViewIfNeeded().catch(() => {});
        const box = await target.boundingBox();
        entry.box = boxOf(box);
        if (step.type === "click" || step.type === "type") {
          const point = { x: box.x + box.width / 2 + (random() - 0.5) * Math.min(12, box.width / 4), y: box.y + box.height / 2 + (random() - 0.5) * Math.min(6, box.height / 4) };
          entry.start = now();
          await moveTo(point);
          await page.waitForTimeout(90 + random() * 80);
          entry.at = now();
          await page.mouse.down();
          await page.waitForTimeout(70 + random() * 40);
          await page.mouse.up();
        }
        if (step.type === "type") {
          const value = typeof step.value === "object" ? account?.[step.value.account] : step.value;
          if (typeof value !== "string") throw new Error(`${flow.id} step ${index}: no test account ${step.value.account} for {account: "${step.value.account}"} (seed data or LAUNCHCLIP_DEMO_EMAIL / LAUNCHCLIP_DEMO_PASSWORD)`);
          await page.waitForTimeout(160);
          const delays = typingDelays(value, random);
          entry.keys = [];
          for (const [i, char] of [...value].entries()) {
            entry.keys.push(now());
            await page.keyboard.type(char);
            await page.waitForTimeout(delays[i]);
          }
          entry.value = typeof step.value === "object" ? `{account: ${step.value.account}}` : redactWith(value, masks);
          entry.chars = value.length;
        }
        if (step.type === "wait-for" || step.type === "assert-visible") entry.at = now();
      }
      // Let the page react (navigation, a toast, a chart) before the next step.
      if (step.type === "click") await page.waitForLoadState("load").catch(() => {});
      await page.waitForTimeout(step.type === "pause" ? 0 : 450);
      entry.end = now();
      entry.url = page.url();
      actions.push(entry);
      say(`${flow.id}: ${step.type} ${entry.label ?? entry.path ?? ""} at ${entry.at ?? entry.start}s`);
    }
    await page.waitForTimeout(900);
    const endTime = await cast.stop();
    const video = path.join(out, `${flow.id}.mp4`);
    const { duration } = await encodeFrames(cast.frames, endTime, video, { fps, width: frameSize.width, height: frameSize.height });
    const poster = path.join(out, `${flow.id}.poster.png`);
    await page.screenshot({ path: poster });
    const record = {
      schema: ACTION_LOG_SCHEMA,
      flow: { id: flow.id, title: flow.title, goal: flow.goal ?? null },
      video: path.basename(video),
      viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: scale },
      frame: frameSize,
      fps,
      duration,
      frames: cast.frames.length,
      recorded_at: new Date(t0 * 1000).toISOString(),
      actions: actions.map((action) => JSON.parse(redactWith(JSON.stringify(action), masks)))
    };
    const logPath = path.join(out, `${flow.id}.actions.json`);
    await writeFile(logPath, `${JSON.stringify(record, null, 2)}\n`);
    return { id: flow.id, video, log: logPath, poster, duration, record };
  } finally {
    await page.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Record every flow of a validated plan into `out`. → {flows: [...], executablePath}.
 * `planDir` is where the plan's relative paths (app.fixtures, app.har) start.
 * Throws when the plan has errors or the recorder is unavailable.
 */
export async function recordPlan(plan, { out, url = plan.app?.url, repo = null, planDir = process.cwd(), headed = false, account = null, fps = 30, allowHosts = [], only = null, log = () => {} } = {}) {
  const check = validateDemoPlan(plan);
  if (check.errors.length) throw new Error(`DEMO-PLAN.json has errors:\n- ${check.errors.join("\n- ")}`);
  assertSafeUrl(url, { allowHosts });
  const available = await recorderAvailability({ repo });
  if (!available.ok) throw new Error(`cannot record: ${available.reasons.join("; ")}`);
  await mkdir(out, { recursive: true });
  const viewport = { ...DEFAULT_VIEWPORT, ...(plan.viewport ?? {}) };
  const browser = await available.chromium.launch({ executablePath: available.executablePath, headless: !headed, args: ["--hide-scrollbars", "--disable-features=Translate,MediaRouter", "--no-first-run", "--no-default-browser-check"] });
  const results = [];
  try {
    for (const flow of plan.flows) {
      if (only && !only.includes(flow.id)) continue;
      // A fresh context per flow: a clean profile, the same starting state.
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor, locale: "en-US", timezoneId: "UTC", colorScheme: "light", acceptDownloads: false, serviceWorkers: "block" });
      try {
        await prepareContext(context, { app: plan.app ?? {}, url, planDir, log });
        log(`recording ${flow.id} (${flow.steps.length} steps)`);
        const setup = (flow.setup ?? []).map((id) => plan.flows.find((entry) => entry.id === id));
        results.push(await recordFlow(context, flow, { url, out, viewport, account, fps, allowHosts, setup, log }));
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { flows: results, executablePath: available.executablePath };
}
