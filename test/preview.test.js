import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPreview, formatPreviewSummary, playerPage, servePreview } from "../src/preview.js";

const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 12.5 };

async function plannedProject({ draft = false } = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-preview-"));
  await mkdir(path.join(project, ".launchclip/finish"), { recursive: true });
  await writeFile(path.join(project, ".launchclip/finish/story.resolved.json"), JSON.stringify({ title: "A <test> story", scenes: [] }));
  await writeFile(path.join(project, "PLAYER-MANIFEST.json"), JSON.stringify({ story: ".launchclip/finish/story.resolved.json", format: FORMAT, not_in_preview: ["loudness"] }));
  if (draft) await writeFile(path.join(project, "MAKE.json"), JSON.stringify({ draft: { parts: { storyboard: "draft" } } }));
  return project;
}

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
  const built = await buildPreview(project, {}, { compile, gsapFile: library });
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
  assert.match(player, /<iframe id="frame" src="composition\.html"/);
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
  const built = await buildPreview(project, { out: path.join(project, "out") }, { compile, gsapFile: null });
  assert.equal(built.offline, false);
  assert.equal(built.plan, "full");
  assert.match(await readFile(path.join(built.dir, "composition.html"), "utf8"), /cdn\.jsdelivr/);
  assert.match(formatPreviewSummary(built), /CDN/);
});

test("a project that is not planned says how to plan it", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-preview-"));
  await assert.rejects(buildPreview(project, {}, { compile }), /has no PLAYER-MANIFEST\.json: plan the video first/);
});

test("the preview folder cannot be the project", async () => {
  const project = await plannedProject();
  await assert.rejects(buildPreview(project, { out: project }, { compile }), /cannot be the project/);
});

test("the local server answers byte ranges and stays inside the preview folder", async () => {
  const project = await plannedProject();
  let opened = null;
  const served = await servePreview(project, { port: 0 }, { compile, gsapFile: null, open: (url) => { opened = url; } });
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

test("the player page drives the composition's timeline and takes a host's messages", () => {
  const page = playerPage({ title: "T", composition: "composition.html", composition_id: "launchclip-story", format: FORMAT, plan: "full" });
  assert.match(page, /__timelines\[ID\]/);
  assert.match(page, /launchclip:seek/);
  assert.match(page, /style\.visibility = on \? "" : "hidden"/);
  assert.match(page, /max="12\.5"/);
});
