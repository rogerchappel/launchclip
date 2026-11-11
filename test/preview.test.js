import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromiumSearch, loadPlaywright } from "../src/demo/record.js";
import { POSTER_FILE, buildPreview, formatPreviewSummary, playerPage, posterImage, servePreview } from "../src/preview.js";

const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 12.5 };

async function plannedProject({ draft = false } = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-preview-"));
  await mkdir(path.join(project, ".launchclip/finish"), { recursive: true });
  await writeFile(path.join(project, ".launchclip/finish/story.resolved.json"), JSON.stringify({ title: "A <test> story", scenes: [] }));
  await writeFile(path.join(project, "PLAYER-MANIFEST.json"), JSON.stringify({ story: ".launchclip/finish/story.resolved.json", format: FORMAT, not_in_preview: ["loudness"] }));
  if (draft) await writeFile(path.join(project, "MAKE.json"), JSON.stringify({ draft: { parts: { storyboard: "draft" } } }));
  return project;
}

// No browser is started for the stand-in page; the poster has its own test.
const NO_POSTER = async () => null;

// Stands in for the HyperFrames compiler: the page it writes, with the CDN script the preview replaces.
const compile = async (_story, { projectDir }) => {
  const html = '<html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script></head><body><audio id="lc-audio" class="clip" src="assets/mix.wav"></audio></body></html>';
  await mkdir(path.join(projectDir, "assets"), { recursive: true });
  await writeFile(path.join(projectDir, "assets/mix.wav"), "0123456789");
  await writeFile(path.join(projectDir, "assets/narration.wav"), "a stem the page does not play");
  await writeFile(path.join(projectDir, "index.html"), html);
  return { html, files: ["assets/", "index.html"], warnings: [], compositionId: "launchclip-story" };
};

test("a planned project becomes a folder a browser can play, with the animation library beside it", async () => {
  const project = await plannedProject({ draft: true });
  const library = path.join(project, "gsap.min.js");
  await writeFile(library, "/* gsap */");
  const built = await buildPreview(project, {}, { poster: NO_POSTER, compile, gsapFile: library });
  assert.equal(built.dir, path.join(project, ".launchclip/preview"));
  assert.equal(built.plan, "draft");
  assert.equal(built.offline, true);
  const composition = await readFile(path.join(built.dir, "composition.html"), "utf8");
  assert.match(composition, /<script src="vendor\/gsap\.min\.js">/);
  assert.doesNotMatch(composition, /cdn\.jsdelivr/);
  assert.equal(await readFile(path.join(built.dir, "vendor/gsap.min.js"), "utf8"), "/* gsap */");
  assert.equal(existsSync(path.join(built.dir, "assets/mix.wav")), true);
  assert.equal(existsSync(path.join(built.dir, "assets/narration.wav")), false);
  assert.equal(built.bytes, 10);
  const player = await readFile(path.join(built.dir, "index.html"), "utf8");
  // The player is one document: the composition's own markup, scaled to fit, with nothing nested in a frame.
  assert.doesNotMatch(player, /<iframe/);
  assert.match(player, /<div id="lc-preview-canvas"><audio id="lc-audio" class="clip" src="assets\/mix\.wav"><\/audio><\/div>/);
  assert.match(player, /<script src="vendor\/gsap\.min\.js">/);
  assert.match(player, /A &lt;test&gt; story/);
  assert.match(player, /Draft preview/);
  const info = JSON.parse(await readFile(path.join(built.dir, "preview.json"), "utf8"));
  assert.deepEqual(info.format, FORMAT);
  assert.equal(info.schema_version, "launchclip.preview.v1");
  assert.match(info.story_sha256, /^[0-9a-f]{64}$/);
  assert.match(formatPreviewSummary(built), /nothing is rendered/);
});

test("without the library on disk the page keeps its CDN script and says so", async () => {
  const project = await plannedProject();
  const built = await buildPreview(project, { out: path.join(project, "out") }, { poster: NO_POSTER, compile, gsapFile: null });
  assert.equal(built.offline, false);
  assert.equal(built.plan, "full");
  assert.match(await readFile(path.join(built.dir, "composition.html"), "utf8"), /cdn\.jsdelivr/);
  assert.match(formatPreviewSummary(built), /CDN/);
});

test("a project that is not planned says how to plan it", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-preview-"));
  await assert.rejects(buildPreview(project, {}, { poster: NO_POSTER, compile }), /has no PLAYER-MANIFEST\.json: plan the video first/);
});

test("the preview folder cannot be the project", async () => {
  const project = await plannedProject();
  await assert.rejects(buildPreview(project, { out: project }, { poster: NO_POSTER, compile }), /cannot be the project/);
});

test("the local server answers byte ranges and stays inside the preview folder", async () => {
  const project = await plannedProject();
  let opened = null;
  const served = await servePreview(project, { port: 0 }, { poster: NO_POSTER, compile, gsapFile: null, open: (url) => { opened = url; } });
  try {
    assert.equal(opened, served.url);
    const page = await fetch(served.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const part = await fetch(`${served.url}assets/mix.wav`, { headers: { Range: "bytes=2-5" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await part.text(), "2345");
    assert.equal((await fetch(`${served.url}%2e%2e/%2e%2e/PLAYER-MANIFEST.json`)).status, 404);
    assert.equal((await fetch(`${served.url}nope.html`)).status, 404);
  } finally {
    await served.close();
  }
});

const PAGE = '<!doctype html><html><head><style>html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #00212a; }</style></head><body><div id="launchclip-root"><p id="now">-</p><script>window.__timelines = { "launchclip-story": { time(t) { document.getElementById("now").textContent = String(t); } } };</script></div></body></html>';

test("the player page drives the composition's timeline and takes a host's messages", () => {
  const page = playerPage({ title: "T", composition: "composition.html", composition_id: "launchclip-story", format: FORMAT, plan: "full" }, PAGE);
  assert.match(page, /window\.__timelines\[ID\]/);
  assert.match(page, /#lc-preview-canvas \{[^}]*width: 1080px; height: 1920px;[^}]*background: #00212a; \}/, "the video keeps its own background inside the player");
  assert.match(page, /<div id="lc-preview-canvas"><div id="launchclip-root">/);
  assert.throws(() => playerPage({ title: "T", composition_id: "x", format: FORMAT }, "<p>not a page</p>"), /no <head> and <body>/);
  assert.match(page, /launchclip:seek/);
  assert.match(page, /style\.visibility = on \? "" : "hidden"/);
  assert.match(page, /max="12\.5"/);
});

test("in a browser: the player runs inside a sandboxed frame with no origin of its own, driven only by messages", async (t) => {
  const chromium = await loadPlaywright();
  let pinned = null;
  try { pinned = chromium?.executablePath(); } catch { pinned = null; }
  const found = chromium ? await chromiumSearch({ playwrightPath: pinned }) : { path: null };
  if (!found.path) { t.skip("no Chromium on this machine"); return; }
  const page = playerPage({ title: "T", composition: "composition.html", composition_id: "launchclip-story", format: { ...FORMAT, duration: 3 }, plan: "full" }, PAGE);
  const listen = (handler) => new Promise((resolve) => { const server = http.createServer(handler); server.listen(0, "127.0.0.1", () => resolve(server)); });
  // The host's page: it frames the preview from another origin and only talks to it by postMessage.
  const host = await listen((request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end(`<!doctype html><iframe id="preview" sandbox="allow-scripts" src="http://127.0.0.1:${preview.address().port}/index.html?bare" style="width:360px;height:640px;border:0"></iframe><script>window.got = []; addEventListener("message", (event) => window.got.push(event.data));</script>`); });
  const preview = await listen((request, response) => {
    // What a careful host sends: no origin for the document, no network, and only the host may frame it.
    response.writeHead(200, { "content-type": "text/html", "content-security-policy": `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-ancestors http://127.0.0.1:${host.address().port}` });
    response.end(page);
  });
  const browser = await chromium.launch({ executablePath: found.path });
  try {
    const tab = await browser.newPage();
    const errors = [];
    tab.on("pageerror", (error) => errors.push(String(error.message)));
    tab.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await tab.goto(`http://127.0.0.1:${host.address().port}/`);
    await tab.waitForFunction(() => window.got.some((message) => message.type === "launchclip:ready"), null, { timeout: 10000 });
    await tab.evaluate(() => document.getElementById("preview").contentWindow.postMessage({ type: "launchclip:seek", time: 1.5 }, "*"));
    await tab.waitForFunction(() => window.got.some((message) => message.type === "launchclip:time" && message.time === 1.5), null, { timeout: 5000 });
    await tab.evaluate(() => document.getElementById("preview").contentWindow.postMessage({ type: "launchclip:play" }, "*"));
    await tab.waitForFunction(() => window.got.some((message) => message.type === "launchclip:ended"), null, { timeout: 10000 });
    const got = await tab.evaluate(() => window.got);
    assert.ok(got.filter((message) => message.type === "launchclip:time").some((message) => message.time > 1.6 && message.time < 3), "it played on from where it was put");
    assert.equal(got.at(-1).duration, 3);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => host.close(resolve));
    await new Promise((resolve) => preview.close(resolve));
  }
});

test("a poster is written beside the player when a browser can draw it, and named in preview.json", async (t) => {
  const project = await plannedProject();
  // The adapter's answer is what preview.json records; --no-poster (options.poster false) asks for none.
  const named = await buildPreview(project, {}, { compile, gsapFile: null, poster: async ({ dir, format }) => { assert.equal(format.width, 1080); assert.ok(existsSync(path.join(dir, "composition.html"))); return "poster.jpg"; } });
  assert.equal(named.poster, "poster.jpg");
  assert.equal(JSON.parse(await readFile(path.join(named.dir, "preview.json"), "utf8")).poster, "poster.jpg");
  assert.equal((await buildPreview(project, { poster: false }, { compile, gsapFile: null, poster: async () => { throw new Error("asked for a poster"); } })).poster, null);
  assert.equal((await buildPreview(project, {}, { compile, gsapFile: null, poster: async () => { throw new Error("the browser crashed"); } })).poster, null, "a poster that cannot be drawn does not fail the preview");
  // For real: the composition at a point early in the video, half size.
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-poster-"));
  await writeFile(path.join(dir, "composition.html"), PAGE);
  const file = await posterImage({ dir, format: { ...FORMAT, duration: 10 } });
  if (!file) { t.skip("no Chromium on this machine"); return; }
  assert.equal(file, POSTER_FILE);
  const image = await readFile(path.join(dir, POSTER_FILE));
  assert.deepEqual([image[0], image[1]], [0xff, 0xd8], "a JPEG");
  assert.deepEqual([image.readUInt16BE(image.indexOf(Buffer.from([0xff, 0xc0])) + 7), image.readUInt16BE(image.indexOf(Buffer.from([0xff, 0xc0])) + 5)], [540, 960]);
});
