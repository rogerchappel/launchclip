// Demo autopilot recorder (src/demo/record.js): pacing, Chromium lookup and
// frame encoding. The end-to-end recording of examples/demo-app lives in
// test/demo_autopilot.test.js and skips when no Chromium is available.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chooseFile, cursorPath, encodeFrames, findChromium, fixtureResponse, loadPlaywright, locate, prepareContext, sessionState, recorderAvailability, seededRandom, typingDelays, uploadTarget } from "../src/demo/record.js";
import { mediaSkip } from "./helpers/media.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const available = await recorderAvailability();
const needsBrowser = { skip: mediaSkip(!available.ok && `recorder unavailable: ${available.reasons.join("; ")}`), timeout: 60000 };

async function withPage(t, html) {
  const browser = await available.chromium.launch({ executablePath: available.executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  return page;
}

test("seededRandom is deterministic per seed", () => {
  const a = seededRandom("create"), b = seededRandom("create"), c = seededRandom("tour");
  const take = (random) => Array.from({ length: 5 }, random);
  const first = take(a);
  assert.deepEqual(first, take(b));
  assert.notDeepEqual(first, take(c));
  assert.ok(first.every((value) => value >= 0 && value < 1));
});

test("cursorPath eases from start to target in 0.35–0.9 s", () => {
  const random = seededRandom("path");
  const short = cursorPath({ x: 100, y: 100 }, { x: 110, y: 104 }, random);
  const long = cursorPath({ x: 0, y: 0 }, { x: 1800, y: 1000 }, random);
  const total = (points) => points.reduce((sum, point) => sum + point.dt, 0);
  assert.ok(Math.abs(total(short) - 0.35) < 1e-6);
  assert.ok(Math.abs(total(long) - 0.9) < 1e-6);
  assert.deepEqual([long.at(-1).x, long.at(-1).y], [1800, 1000]);
  // Eased: the first step is much shorter than a middle step.
  const step = (i) => Math.hypot(long[i].x - (i ? long[i - 1].x : 0), long[i].y - (i ? long[i - 1].y : 0));
  assert.ok(step(0) < step(Math.floor(long.length / 2)) / 4);
});

test("typingDelays are human-paced and seeded", () => {
  const delays = typingDelays("Summer launch", seededRandom("t"));
  assert.equal(delays.length, 13);
  assert.ok(delays.every((ms) => ms >= 45 && ms <= 150));
  assert.ok(delays[6] >= 85, "a space adds a beat");
  assert.deepEqual(delays, typingDelays("Summer launch", seededRandom("t")));
});

test("findChromium prefers LAUNCHCLIP_CHROMIUM and never invents a path", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-chromium-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = path.join(dir, "chrome");
  await writeFile(fake, "");
  assert.equal(await findChromium({ env: { LAUNCHCLIP_CHROMIUM: fake } }), fake);
  const found = await findChromium({ env: { PLAYWRIGHT_BROWSERS_PATH: dir } });
  assert.ok(found === null || typeof found === "string");
});

test("loadPlaywright falls back to the Playwright the recorded app's repo installs", async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "launchclip-repo-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const missing = () => Promise.reject(new Error("Cannot find package 'playwright'"));
  assert.equal(await loadPlaywright({ repo, own: missing }), null);
  const pkg = path.join(repo, "node_modules", "@playwright", "test");
  await mkdir(pkg, { recursive: true });
  await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "@playwright/test", main: "index.js" }));
  await writeFile(path.join(pkg, "index.js"), "exports.chromium = { name: 'repo chromium' };");
  assert.deepEqual(await loadPlaywright({ repo, own: missing }), { name: "repo chromium" });
  assert.equal(await loadPlaywright({ own: missing }), null, "no repo, no fallback");
});

test("encodeFrames holds each frame until the next timestamp", { skip: !hasFfmpeg && "ffmpeg is not on PATH" }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-encode-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const frames = [];
  for (const [i, color, at] of [[0, "red", 100], [1, "lime", 100.5], [2, "blue", 101.6]]) {
    const file = path.join(dir, `f${i}.jpg`);
    assert.equal(spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", `color=${color}:s=320x180`, "-frames:v", "1", file]).status, 0);
    frames.push({ file, t: at });
  }
  const out = path.join(dir, "clip.mp4");
  const { duration } = await encodeFrames(frames, 102, out, { fps: 30, width: 320, height: 180 });
  assert.equal(duration, 2);
  const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames,r_frame_rate", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim();
  assert.equal(probe, "30/1,60");
  // Frame 30 (1.0 s) is still the green frame; frame 50 (1.67 s) is blue.
  const pixel = (n) => spawnSync("ffmpeg", ["-loglevel", "error", "-i", out, "-vf", `select=eq(n\\,${n}),scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).stdout;
  const green = pixel(30), blue = pixel(50);
  assert.ok(green[1] > 180 && green[0] < 80, `frame 30 ${[...green]}`);
  assert.ok(blue[2] > 180 && blue[0] < 80, `frame 50 ${[...blue]}`);
});

test("locate skips hidden duplicates that responsive layouts render first", needsBrowser, async (t) => {
  const page = await withPage(t, `<nav style="display:none"><button id="mobile">Save</button><input id="m" placeholder="Name"></nav>
    <main><button id="desktop">Save</button><input id="d" placeholder="Name"></main>`);
  assert.equal(await locate(page, { type: "click", text: "Save" }).getAttribute("id"), "desktop");
  assert.equal(await locate(page, { type: "click", selector: "button" }).getAttribute("id"), "desktop");
  assert.equal(await locate(page, { type: "type", text: "Name" }).getAttribute("id"), "d");
});

test("fixtureResponse turns a fixture's answer into a fulfilled response", () => {
  assert.deepEqual(fixtureResponse({ json: { ok: true } }), { status: 200, contentType: "application/json", headers: {}, body: "{\"ok\":true}" });
  assert.deepEqual(fixtureResponse({ status: 201, body: { id: 1 } }), { status: 201, contentType: "application/json", headers: {}, body: "{\"id\":1}" });
  assert.deepEqual(fixtureResponse({ body: "<p>hi</p>", contentType: "text/html" }, { cors: "http://127.0.0.1:4173" }),
    { status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "http://127.0.0.1:4173", "access-control-allow-credentials": "true" }, body: "<p>hi</p>" });
  assert.deepEqual(fixtureResponse({ status: 204 }), { status: 204, contentType: "text/plain", headers: {}, body: "" });
});

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return server.address().port;
}

test("prepareContext answers from fixtures, then the HAR, and blocks other origins", needsBrowser, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-fixtures-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await serve(t, (req, res) => res.end(req.url === "/" ? "<!doctype html><title>app</title>" : `app ${req.url}`));
  const allowed = await serve(t, (req, res) => { res.setHeader("access-control-allow-origin", "*"); res.end("allowed"); });
  const recorded = createServer((req, res) => { res.setHeader("access-control-allow-origin", "*"); res.end(`recorded ${req.url}`); });
  await new Promise((resolve) => recorded.listen(0, "127.0.0.1", resolve));
  const harOrigin = `http://127.0.0.1:${recorded.address().port}`;
  await writeFile(path.join(dir, "fixtures.mjs"), `let calls = 0;
export function route({ url, method, body }) {
  if (url.pathname === "/api/echo") return { status: 201, json: { method, body, calls: ++calls } };
  if (url.pathname === "/api/boom") throw new Error("no lot 7");
}`);
  const browser = await available.chromium.launch({ executablePath: available.executablePath, headless: true });
  t.after(() => browser.close());
  // Record a HAR from a server that is then shut down: the replay must not need it.
  const recording = await browser.newContext({ recordHar: { path: path.join(dir, "api.har"), urlFilter: `${harOrigin}/**` } });
  const page0 = await recording.newPage();
  await page0.goto(`${harOrigin}/catalogue`);
  await recording.close();
  await new Promise((resolve) => recorded.close(resolve));

  const logs = [];
  const run = async () => {
    const context = await browser.newContext();
    await prepareContext(context, { app: { fixtures: "fixtures.mjs", har: "api.har", allowOrigins: [`http://127.0.0.1:${allowed}`] }, url: `http://127.0.0.1:${app}`, planDir: dir, log: (line) => logs.push(line) });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${app}/`);
    const fetchText = (target, init) => page.evaluate(async ([target, init]) => { try { const r = await fetch(target, init); return `${r.status} ${await r.text()}`; } catch (error) { return `failed ${error.message}`; } }, [target, init]);
    const results = {
      // localhost is another origin than 127.0.0.1: a cross-origin API, preflighted.
      echo: await fetchText(`http://localhost:${app}/api/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lot: 103 }) }),
      fallthrough: await fetchText("/api/other"),
      boom: await fetchText("/api/boom"),
      har: await fetchText(`${harOrigin}/catalogue`),
      allowed: await fetchText(`http://127.0.0.1:${allowed}/`),
      blocked: await fetchText(`http://localhost:${allowed}/`),
      cursor: await page.evaluate(() => Boolean(document.getElementById("__lc_cursor")))
    };
    await context.close();
    return results;
  };
  const first = await run();
  assert.equal(first.echo, "201 {\"method\":\"POST\",\"body\":{\"lot\":103},\"calls\":1}");
  assert.equal(first.fallthrough, "200 app /api/other");
  assert.match(first.boom, /^500 .*no lot 7/);
  assert.equal(first.har, "200 recorded /catalogue");
  assert.equal(first.allowed, "200 allowed");
  assert.match(first.blocked, /^failed/);
  assert.equal(first.cursor, true);
  assert.match(logs.join("\n"), new RegExp(`blocked requests to http://localhost:${allowed}`));
  assert.match(logs.join("\n"), /fixtures: GET \/api\/boom threw no lot 7/);
  // Each context loads the fixtures afresh: module state starts over per flow.
  assert.match((await run()).echo, /"calls":1/);
});

test("sessionState builds a storage state from inline values or a file, and refuses real secrets", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-session-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const url = "http://127.0.0.1:4173";
  assert.deepEqual(await sessionState({ localStorage: { auth_token: "demo-token" }, cookies: [{ name: "s", value: "demo" }, { name: "t", value: "fake", domain: ".acme.test" }, { name: "u", value: "demo", path: "/app" }] }, { url }), {
    cookies: [{ name: "s", value: "demo", url }, { domain: ".acme.test", path: "/", name: "t", value: "fake" }, { domain: "127.0.0.1", path: "/app", name: "u", value: "demo" }],
    origins: [{ origin: url, localStorage: [{ name: "auth_token", value: "demo-token" }] }]
  });
  const state = { cookies: [{ name: "s", value: "demo", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [{ origin: url, localStorage: [{ name: "token", value: "demo-token" }] }] };
  await writeFile(path.join(dir, "state.json"), JSON.stringify(state));
  assert.deepEqual(await sessionState({ storageState: "state.json" }, { url, planDir: dir }), state);
  state.origins[0].localStorage[0].value = "sk_live_abcdef1234567890";
  await writeFile(path.join(dir, "real.json"), JSON.stringify(state));
  await assert.rejects(sessionState({ storageState: "real.json" }, { url, planDir: dir }), /not test-only:\n- real\.json \(http:\/\/127\.0\.0\.1:4173\)\.localStorage\.token looks like a real API key/);
  await assert.rejects(sessionState({ storageState: "missing.json" }, { url, planDir: dir }), /not a readable storage state/);
  assert.deepEqual(await sessionState(undefined, { url }), { cookies: [], origins: [] });
});

test("prepareContext starts the page signed in from app.session", needsBrowser, async (t) => {
  const port = await serve(t, (req, res) => res.end(`<!doctype html><script>window.seen = { token: localStorage.getItem("auth_token"), team: localStorage.getItem("team"), cookie: document.cookie }; localStorage.setItem("team", "team-2");</script>`));
  const url = `http://127.0.0.1:${port}`;
  const browser = await available.chromium.launch({ executablePath: available.executablePath, headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const { secrets } = await prepareContext(context, { app: { session: { localStorage: { auth_token: "demo.token.signature", team: "team-1" }, cookies: [{ name: "sso", value: "demo-sso" }] } }, url });
  assert.deepEqual(secrets, ["demo-sso", "demo.token.signature", "team-1"]);
  const page = await context.newPage();
  await page.goto(url);
  // Written before the app's scripts run.
  assert.deepEqual(await page.evaluate(() => window.seen), { token: "demo.token.signature", team: "team-1", cookie: "sso=demo-sso" });
  await page.reload();
  assert.equal((await page.evaluate(() => window.seen)).team, "team-2", "a value the app changes stays changed");
  const other = await browser.newContext();
  await assert.rejects(prepareContext(other, { app: { session: { cookies: [{ name: "s", value: "demo", url: "https://app.acme.com" }] } }, url }), /production host/);
});

test("uploadTarget and chooseFile answer the file chooser behind a button, a label or a bare input", needsBrowser, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-upload-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "cover.png");
  await writeFile(file, "png bytes");
  const page = await withPage(t, `<button id="pick">Add a cover image</button><input type="file" id="cover" hidden>
    <label for="brief" id="brief-label">Attach a brief</label><input type="file" id="brief" hidden>
    <input type="file" id="bare" hidden>
    <div id="zone">Drop files here</div><input type="file" id="zone-input" hidden>
    <script>
      document.getElementById("pick").onclick = () => document.getElementById("cover").click();
      for (const input of document.querySelectorAll("input")) input.onchange = () => { window.got = { ...window.got, [input.id]: input.files[0].name }; };
    </script>`);
  // A visible button that opens a hidden input.
  const button = await uploadTarget(page, { type: "upload", text: "Add a cover image" });
  assert.equal(await button.target.getAttribute("id"), "pick");
  assert.equal(await chooseFile(page, file, () => button.target.click()), "chooser");
  // A selector naming a hidden input clicks its visible label.
  const labelled = await uploadTarget(page, { type: "upload", selector: "#brief" });
  assert.equal(await labelled.target.getAttribute("id"), "brief-label");
  assert.equal(await chooseFile(page, file, () => labelled.target.click()), "chooser");
  // A hidden input with nothing on screen to open it is set directly.
  const bare = await uploadTarget(page, { type: "upload", selector: "#bare" });
  assert.ok(bare.input && !bare.target);
  await bare.input.setInputFiles(file);
  assert.deepEqual(await page.evaluate(() => window.got), { cover: "cover.png", brief: "cover.png", bare: "cover.png" });
  // A control that opens no chooser names the problem when the page has several inputs.
  const zone = await uploadTarget(page, { type: "upload", text: "Drop files here" });
  await assert.rejects(chooseFile(page, file, () => zone.target.click(), { timeout: 500 }), /opened no file chooser, and the page has 4 file inputs/);
  await assert.rejects(uploadTarget(page, { type: "upload", text: "Nowhere" }, { timeout: 300 }), /Timeout/);
});
