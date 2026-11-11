// launchclip preview <project>: play a planned video in a browser, before any
// render.
//
// A planned project (make --stop-after storyboard, make --speed draft, make
// --refine, finish --plan-only) holds PLAYER-MANIFEST.json: the resolved
// story, the mix, the captions and every media file. This command compiles
// that story to the page the HyperFrames renderer would screenshot, and puts
// a small player around it: the page's one paused timeline is driven by the
// clock of the mix, so what plays is the picture the render draws, live.
//
// The result is a folder of static files (index.html is the player, one document:
// the video with its controls; composition.html the video alone). --export writes it and stops, for a host that
// serves it itself; without it the folder is served on localhost.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createReadStream, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

export const PREVIEW_SCHEMA = "launchclip.preview.v1";
export const PREVIEW_DIR = ".launchclip/preview";
const MANIFEST = "PLAYER-MANIFEST.json";

const TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf"
});

/**
 * Build the preview folder of a planned project.
 * → {schema_version, dir, index, composition, format, title, plan, story_sha256, warnings, offline}
 */
export async function buildPreview(projectPath, options = {}, adapters = {}) {
  const project = path.resolve(String(projectPath));
  const manifestPath = path.join(project, MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new Error(`${project} has no ${MANIFEST}: plan the video first (launchclip make "<prompt>" --stop-after storyboard, launchclip make "<prompt>" --speed draft, or launchclip finish ${projectPath} --plan-only)`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const storyText = await readFile(path.join(project, manifest.story), "utf8");
  const story = JSON.parse(storyText);
  const dir = path.resolve(options.out ?? path.join(project, PREVIEW_DIR));
  if (dir === project || project.startsWith(`${dir}${path.sep}`)) throw new Error("the preview folder cannot be the project or a folder above it");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const compile = adapters.compile ?? (await import("../kit/hyperframes/story-compiler.mjs")).compileStoryToHyperFrames;
  const compiled = await compile(story, { projectDir: dir, sourceDir: project });

  // The compiled page loads its animation library from a CDN. A preview is
  // looked at offline and embedded by hosts, so the library is served beside it.
  let html = compiled.html;
  let offline = false;
  const cdn = html.match(/<script src="(https:\/\/[^"]*gsap[^"]*)"><\/script>/);
  const library = adapters.gsapFile !== undefined ? adapters.gsapFile : gsapFile();
  if (cdn && library && existsSync(library)) {
    await mkdir(path.join(dir, "vendor"), { recursive: true });
    await cp(library, path.join(dir, "vendor", "gsap.min.js"));
    html = html.replace(cdn[0], '<script src="vendor/gsap.min.js"></script>');
    offline = true;
  }
  // An exported preview is streamed to a browser, often through a host's own server: its clips become
  // small, fast-seeking proxies and its soundtrack is compressed. A preview served here keeps the files as they are.
  const media = previewMedia(options.media, { exported: Boolean(options.out) });
  let lightened = null;
  if (media === "light") {
    lightened = await (adapters.lightMedia ?? lightMedia)({ dir, html, format: manifest.format });
    html = lightened.html;
  }
  await writeFile(path.join(dir, "composition.html"), html);
  // The compiler copies the project's whole assets folder; a preview keeps
  // only the files the page names (the stems behind the mix are not played).
  const bytes = await pruneAssets(dir, html);

  const draft = await readJson(path.join(project, "MAKE.json")).then((make) => make?.draft ?? null);
  const info = {
    schema_version: PREVIEW_SCHEMA,
    title: story.title ?? story.meta?.title ?? path.basename(project),
    composition: "composition.html",
    composition_id: compiled.compositionId,
    format: manifest.format,
    plan: draft?.parts?.storyboard === "draft" ? "draft" : "full",
    story_sha256: createHash("sha256").update(storyText).digest("hex"),
    audio: { mastered: false },
    not_in_preview: manifest.not_in_preview ?? [],
    bytes,
    offline,
    media: lightened ? { quality: "light", files: lightened.files, saved_bytes: lightened.saved, ...(lightened.skipped.length ? { kept_original: lightened.skipped } : {}) } : { quality: "original" }
  };
  // A still of the video for a host to show before the player is loaded. It needs a browser; without one there is none.
  info.poster = options.poster === false ? null : await Promise.race([(adapters.poster ?? posterImage)({ dir, format: manifest.format }), new Promise((resolve) => setTimeout(() => resolve(null), POSTER_TIMEOUT_MS).unref())]).catch(() => null);
  await writeFile(path.join(dir, "preview.json"), `${JSON.stringify(info, null, 2)}\n`);
  await writeFile(path.join(dir, "index.html"), playerPage(info, html));
  return { ...info, dir, index: path.join(dir, "index.html"), warnings: compiled.warnings ?? [] };
}

export const PREVIEW_MEDIA = Object.freeze(["light", "original"]);
/** --media light | original. Unset: light for an exported folder, original for a preview served here. */
export function previewMedia(value, { exported = false } = {}) {
  if (value === undefined || value === null || value === "" || value === true) return exported ? "light" : "original";
  const media = String(value).toLowerCase();
  if (!PREVIEW_MEDIA.includes(media)) throw new Error(`--media must be ${PREVIEW_MEDIA.join(" or ")}; got ${value}`);
  return media;
}

// A preview's clips: fitted in this many pixels a side, a keyframe every half second so a seek lands at once.
const LIGHT_SIDE = 960;
const LIGHT_VIDEO = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"];
const LIGHT_AUDIO = ["-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];
const MEDIA_SRC = /<(video|audio)\b[^>]*?\bsrc="([^"]+)"/gi;

/**
 * The media the page plays, made light: each video a small H.264 proxy, each
 * WAV an AAC file, in place of the originals under the preview folder; the
 * page's src attributes follow a file whose name changed. A file ffmpeg
 * cannot convert, or that comes out no smaller, is kept as it was.
 * → {html, files, saved (bytes), skipped: [path]}
 */
export async function lightMedia({ dir, html, format }, { run = promisify(execFile) } = {}) {
  const side = Math.min(LIGHT_SIDE, Math.max(Number(format?.width) || LIGHT_SIDE, Number(format?.height) || LIGHT_SIDE));
  const named = new Map();
  for (const [, tag, src] of html.matchAll(MEDIA_SRC)) {
    const clean = decodeURI(src.split(/[?#]/)[0]);
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(clean) || clean.startsWith("/") || clean.includes("..")) continue;
    if (!named.has(clean)) named.set(clean, { tag: tag.toLowerCase(), src });
  }
  let out = html, saved = 0, files = 0;
  const skipped = [];
  const jobs = [...named].map(([relative, { tag }]) => async () => {
    const source = path.join(dir, relative);
    if (!existsSync(source)) return;
    const ext = path.extname(relative).toLowerCase();
    const video = tag === "video";
    if (!video && ext !== ".wav") return; // an already compressed soundtrack is left alone
    const target = video ? (ext === ".mp4" ? relative : `${relative.slice(0, -ext.length)}.mp4`) : `${relative.slice(0, -ext.length)}.m4a`;
    const temp = path.join(dir, `${target}.light${video ? ".mp4" : ".m4a"}`);
    try {
      await run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", source, ...(video ? ["-vf", `scale=w='min(iw,${side})':h='min(ih,${side})':force_original_aspect_ratio=decrease:force_divisible_by=2`, ...LIGHT_VIDEO] : LIGHT_AUDIO), temp], { maxBuffer: 8 * 1024 * 1024 });
      const [before, after] = [(await stat(source)).size, (await stat(temp)).size];
      if (!(after > 0) || (after >= before && target === relative)) { await rm(temp, { force: true }); skipped.push(relative); return; }
      await rm(source, { force: true });
      await rename(temp, path.join(dir, target));
      saved += before - after; files += 1;
      if (target !== relative) out = out.split(relative).join(target).split(encodeURI(relative)).join(encodeURI(target));
    } catch {
      await rm(temp, { force: true });
      skipped.push(relative);
    }
  });
  // A few at a time: each ffmpeg uses several cores.
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => { while (queue.length) await queue.shift()(); }));
  return { html: out, files, saved, skipped };
}

export const POSTER_FILE = "poster.jpg";
// How far into the video the poster is taken: past the opening's entrances, where the first scene is full.
const POSTER_AT = 0.3;
const POSTER_WIDTH = 540;
// The preview is never held up by its poster.
const POSTER_TIMEOUT_MS = 45_000;

/**
 * poster.jpg in the preview folder: the composition at a point early in the
 * video, half size. → "poster.jpg", or null when there is no browser to draw
 * it (Playwright's Chromium, a system Chrome or a renderer's browser).
 */
export async function posterImage({ dir, format }) {
  const { chromiumSearch, loadPlaywright } = await import("./demo/record.js");
  const chromium = await loadPlaywright();
  if (!chromium) return null;
  let pinned = null;
  try { pinned = chromium.executablePath(); } catch { pinned = null; }
  const found = await chromiumSearch({ playwrightPath: pinned });
  if (!found.path) return null;
  const browser = await chromium.launch({ executablePath: found.path });
  try {
    const { width, height, duration } = format;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: POSTER_WIDTH / width });
    await page.goto(pathToFileURL(path.join(dir, "composition.html")).href, { timeout: 20000 });
    await page.waitForFunction(() => window.__timelines && Object.keys(window.__timelines).length > 0, null, { timeout: 15000 });
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3000))]));
    // The timeline is set, not returned: a returned timeline would be copied out of the page, and it has no end.
    await page.evaluate((at) => { Object.values(window.__timelines)[0].time(at); }, Math.min(Number(duration) * POSTER_AT, 6));
    await page.screenshot({ path: path.join(dir, POSTER_FILE), type: "jpeg", quality: 82, timeout: 15000 });
    return POSTER_FILE;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Build the preview and serve it on localhost. → {...build, url, port, close()} */
export async function servePreview(projectPath, options = {}, adapters = {}) {
  const built = await buildPreview(projectPath, options, adapters);
  const server = http.createServer((request, response) => {
    serveFile(built.dir, request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  const wanted = options.port == null ? 4173 : Number(options.port);
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 65535) throw new Error("--port must be a port number");
  const port = await listen(server, wanted);
  const url = `http://localhost:${port}/`;
  if (options.open !== false) await (adapters.open ?? openBrowser)(url);
  return { ...built, url, port, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function formatPreviewSummary(result) {
  const lines = [
    result.url ? `preview: ${result.url} (Ctrl+C stops it)` : `preview: written to ${result.dir} (open index.html from a web server; a browser will not play it from file://)`,
    `plan: ${result.plan === "draft" ? "a draft (launchclip make --refine plans it in full)" : "the full plan"}; ${result.format.width}x${result.format.height}, ${result.format.duration}s; nothing is rendered`,
    "sound: the unmastered mix; the render masters it"
  ];
  if (!result.offline) lines.push("the page loads its animation library from a CDN (gsap was not found beside launchclip)");
  for (const warning of result.warnings.slice(0, 5)) lines.push(`warning: ${warning}`);
  return `${lines.join("\n")}\n`;
}

async function pruneAssets(dir, html) {
  const root = path.join(dir, "assets");
  let kept = 0;
  const walk = async (folder) => {
    let left = 0;
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { left += await walk(file); continue; }
      const relative = path.relative(dir, file).split(path.sep).join("/");
      if (html.includes(relative) || html.includes(encodeURI(relative))) { kept += (await stat(file)).size; left += 1; }
      else await rm(file, { force: true });
    }
    if (!left && folder !== root) await rm(folder, { recursive: true, force: true });
    return left;
  };
  await walk(root);
  return kept;
}

export function gsapFile() {
  try { return createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"); } catch { return null; }
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const attempt = (candidate, left) => {
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE" && candidate !== 0 && left > 0) attempt(candidate + 1, left - 1);
        else reject(error);
      });
      server.listen(candidate, "127.0.0.1", () => { server.removeAllListeners("error"); resolve(server.address().port); });
    };
    attempt(port, 20);
  });
}

async function serveFile(root, request, response) {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end(); return; }
  let info;
  try { info = await stat(file); } catch { info = null; }
  if (!info?.isFile()) { response.writeHead(404); response.end("not found"); return; }
  const headers = { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  // Media is seeked, so byte ranges are answered.
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) { response.writeHead(416, { "Content-Range": `bytes */${info.size}` }); response.end(); return; }
    response.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": end - start + 1 });
    if (request.method === "HEAD") { response.end(); return; }
    createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...headers, "Content-Length": info.size });
  if (request.method === "HEAD") { response.end(); return; }
  createReadStream(file).pipe(response);
}

async function openBrowser(url) {
  const { spawn } = await import("node:child_process");
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* the URL is printed */ }
}

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The player: the composition itself, scaled to fit, with a clock and a bar
// of controls added to it. While it plays, the mix is the clock (the picture
// follows the sound, as in the render); the timeline and every clip on the
// page are set from it each frame.
//
// It is one document. A host that embeds a preview as untrusted content gives
// it a sandbox with no origin of its own; a page there can neither read into
// a frame nested inside it nor, under a frame-ancestors policy, load one. So
// nothing is nested: the composition's markup is in the player page.
//
// A host page drives it by postMessage {type: "launchclip:play" |
// "launchclip:pause" | "launchclip:seek", time}, and it posts {type:
// "launchclip:ready" | "launchclip:time" | "launchclip:ended"} to its parent,
// and "launchclip:waiting" / "launchclip:playing" around a wait for a clip to buffer.
// composition: the compiled page's HTML (composition.html).
export function playerPage(info, composition) {
  const { width, height, duration } = info.format;
  const html = String(composition ?? "");
  const open = html.match(/<body\b[^>]*>/i);
  const close = html.toLowerCase().lastIndexOf("</body>");
  const headEnd = html.toLowerCase().indexOf("</head>");
  if (!open || close < 0 || headEnd < 0) throw new Error("the compiled page has no <head> and <body> to build the player in");
  const bodyStart = open.index + open[0].length;
  // The video's own background, which the compiled page puts on html and body.
  const ground = html.slice(0, bodyStart).match(/html\s*,\s*body\s*\{[^}]*?background(?:-color)?\s*:\s*([^;}]+)/i)?.[1]?.trim() ?? "#000";
  const head = `<title>${escapeHtml(info.title)}: preview</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0 !important; width: 100% !important; height: 100% !important; background: #0b0b0c !important; color: #e8e8ea; font: 13px/1.4 system-ui, sans-serif; overflow: hidden !important; }
  #lc-preview-stage { position: absolute; inset: 0 0 52px 0; display: grid; place-items: center; overflow: hidden; }
  #lc-preview-fit { position: relative; flex: none; overflow: hidden; }
  #lc-preview-canvas { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; overflow: hidden; transform-origin: 0 0; background: ${ground.replace(/[<>"]/g, "")}; }
  #lc-preview-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 14px; box-sizing: border-box; background: #151517; z-index: 2147483000; }
  #lc-preview-bar button { width: 36px; height: 32px; border: 0; border-radius: 6px; background: #2a2a2e; color: inherit; font: inherit; cursor: pointer; }
  #lc-preview-bar button:hover { background: #38383d; }
  #lc-preview-seek { flex: 1; min-width: 0; accent-color: #e8e8ea; }
  #lc-preview-time { font-variant-numeric: tabular-nums; white-space: nowrap; }
  #lc-preview-badge { padding: 2px 8px; border-radius: 999px; background: #2a2a2e; white-space: nowrap; }
  body.lc-preview-bare #lc-preview-bar { display: none; } body.lc-preview-bare #lc-preview-stage { inset: 0; }
</style>
`;
  const before = '<div id="lc-preview-stage"><div id="lc-preview-fit"><div id="lc-preview-canvas">';
  const after = `</div></div></div>
<div id="lc-preview-bar">
  <button id="lc-preview-play" aria-label="Play">&#9654;</button>
  <input id="lc-preview-seek" type="range" min="0" max="${duration}" step="0.01" value="0" aria-label="Position">
  <span id="lc-preview-time">0:00.0 / 0:00.0</span>
  <button id="lc-preview-mute" aria-label="Mute">&#128266;</button>
  <span id="lc-preview-badge">${info.plan === "draft" ? "Draft preview" : "Preview"} &middot; not rendered</span>
</div>
<script>
${playerScript(info)}
</script>
`;
  return `${html.slice(0, headEnd)}${head}${html.slice(headEnd, bodyStart)}${before}${html.slice(bodyStart, close)}${after}${html.slice(close)}`;
}

function playerScript(info) {
  const { width, height, duration } = info.format;
  return `(() => {
  const W = ${width}, H = ${height}, D = ${duration}, ID = ${JSON.stringify(info.composition_id)};
  const query = new URLSearchParams(location.search);
  if (query.has("bare")) document.body.classList.add("lc-preview-bare");
  const canvas = document.getElementById("lc-preview-canvas"), fit = document.getElementById("lc-preview-fit"), stage = document.getElementById("lc-preview-stage");
  const playButton = document.getElementById("lc-preview-play"), seek = document.getElementById("lc-preview-seek"), time = document.getElementById("lc-preview-time"), muteButton = document.getElementById("lc-preview-mute");
  let tl = null, clips = [], master = null, playing = false, t = 0, last = 0, muted = false, waiting = false, stallSince = 0;

  function layout() {
    const scale = Math.min(stage.clientWidth / W, stage.clientHeight / H);
    fit.style.width = W * scale + "px"; fit.style.height = H * scale + "px";
    canvas.style.transform = "scale(" + scale + ")";
  }
  addEventListener("resize", layout); layout();

  const stamp = (s) => Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0");
  const post = (type, extra) => { if (parent !== window) parent.postMessage(Object.assign({ type: type, time: t, duration: D }, extra || {}), "*"); };

  function draw() {
    if (!tl) return;
    tl.time(Math.min(t, D - 0.001), false);
    for (const clip of clips) {
      const local = t - clip.start, on = local >= 0 && local < clip.duration;
      const el = clip.el;
      // A clip is on the page for its own stretch only (the renderer's runtime does the same).
      if (el.tagName === "VIDEO") el.style.visibility = on ? "" : "hidden";
      if (!on) { if (!el.paused) el.pause(); continue; }
      const want = clip.mediaStart + local;
      if (el !== master || !playing) { if (Math.abs(el.currentTime - want) > (playing ? 0.3 : 0.03)) { try { el.currentTime = want; } catch (e) {} } }
      el.muted = muted; el.volume = Math.max(0, Math.min(1, clip.volume));
      // While the picture waits for a clip, the sound waits too; the clip itself keeps loading.
      const run = playing && !(waiting && el === master);
      if (run && el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
      if (!run && !el.paused) el.pause();
    }
    seek.value = t; time.textContent = stamp(t) + " / " + stamp(D);
  }

  // A clip that is on screen and has not buffered: the picture waits for it, as a video player does,
  // where it used to run on and then jump the clip forward to catch up.
  function stalled() {
    for (const clip of clips) {
      const local = t - clip.start;
      if (local < 0 || local >= clip.duration || clip.el.tagName !== "VIDEO") continue;
      if (clip.el.readyState < 3 && !clip.el.error && !clip.el.ended) return true;
    }
    return false;
  }

  function tick(now) {
    if (playing) {
      // A clip takes a moment to show its first frame after a cut: only a stall that lasts is waited for.
      if (!stalled()) stallSince = 0; else if (!stallSince) stallSince = now;
      const hold = Boolean(stallSince) && now - stallSince > 250;
      if (hold !== waiting) {
        waiting = hold;
        if (master) { if (hold) master.pause(); else { try { master.currentTime = t; } catch (e) {} } }
        post(hold ? "launchclip:waiting" : "launchclip:playing");
      }
      // The mix is the clock while it runs; the wall clock carries on without it.
      if (waiting) { /* the clock holds */ }
      else if (master && !master.paused && !master.ended && master.readyState > 2) t = master.currentTime;
      else t += (now - last) / 1000;
      if (t >= D) { t = D; pause(); post("launchclip:ended"); }
      draw(); post("launchclip:time");
    }
    last = now; requestAnimationFrame(tick);
  }

  function play() { if (!tl) return; if (t >= D) t = 0; playing = true; playButton.innerHTML = "&#10074;&#10074;"; if (master) { try { master.currentTime = t; } catch (e) {} } draw(); }
  function pause() { playing = false; waiting = false; stallSince = 0; playButton.innerHTML = "&#9654;"; draw(); }
  function seekTo(value) { t = Math.max(0, Math.min(D, Number(value) || 0)); if (master) { try { master.currentTime = t; } catch (e) {} } draw(); post("launchclip:time"); }

  playButton.onclick = () => (playing ? pause() : play());
  muteButton.onclick = () => { muted = !muted; muteButton.innerHTML = muted ? "&#128263;" : "&#128266;"; draw(); };
  seek.oninput = () => seekTo(seek.value);
  addEventListener("keydown", (event) => { if (event.code === "Space") { event.preventDefault(); playButton.click(); } });
  addEventListener("message", (event) => {
    const m = event.data || {};
    if (m.type === "launchclip:play") play(); else if (m.type === "launchclip:pause") pause(); else if (m.type === "launchclip:seek") seekTo(m.time);
  });

  (function ready() {
    const doc = document;
    const found = window.__timelines && window.__timelines[ID];
    if (!found) { setTimeout(ready, 50); return; }
    tl = found;
    clips = Array.from(doc.querySelectorAll("audio.clip, video.clip, audio[data-start], video[data-start]")).filter((el, i, all) => all.indexOf(el) === i).map((el) => ({
      el: el, start: Number(el.dataset.start) || 0, duration: Number(el.dataset.duration) || D,
      mediaStart: Number(el.dataset.mediaStart) || 0, volume: el.dataset.volume == null ? (el.tagName === "VIDEO" ? 0 : 1) : Number(el.dataset.volume)
    }));
    for (const clip of clips) { clip.el.preload = "auto"; clip.el.playsInline = true; if (clip.el.tagName === "VIDEO" && clip.volume === 0) clip.el.muted = true; }
    master = doc.getElementById("lc-audio");
    const fonts = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    // Ready once the fonts are in and the sound and the first clips can play (or four seconds have passed).
    const first = clips.filter((clip) => clip.start < 6).map((clip) => clip.el).concat(master ? [master] : []).filter((el, i, all) => all.indexOf(el) === i);
    const buffered = Promise.all(first.map((el) => el.readyState >= 3 ? null : new Promise((resolve) => { el.addEventListener("canplay", resolve, { once: true }); el.addEventListener("error", resolve, { once: true }); })));
    Promise.all([fonts, Promise.race([buffered, new Promise((resolve) => setTimeout(resolve, 4000))])]).then(() => { seekTo(Number(query.get("t")) || 0); post("launchclip:ready"); if (query.has("autoplay")) play(); });
    window.__launchclipPreview = { play: play, pause: pause, seek: seekTo, get time() { return t; }, get playing() { return playing; }, duration: D };
  })();
  requestAnimationFrame(tick);
})();`;
}
