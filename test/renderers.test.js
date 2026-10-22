import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEvidence, detectRenderer as detectEvidenceRenderer, remotionStillArgs } from "../skills/launchclip-create-video/scripts/build-evidence.mjs";
import { buildTemporalEvidenceSchedule, validateTemporalEvidenceManifest } from "../src/cinematic_evidence.js";
import { detectRenderer, getRenderer, resolveRendererName } from "../src/renderers/index.js";
import { COMPOSITION_ID, frameAt } from "../src/renderers/remotion.js";
import * as storyModule from "./fixtures/story-stub.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE_ENTRY = path.join(ROOT, "test", "fixtures", "remotion-entry", "entry.tsx");
const HYPERFRAMES_CLI = require.resolve("hyperframes/dist/cli.js");
const REMOTION_CLI = path.join(path.dirname(require.resolve("@remotion/cli/package.json")), "remotion-cli.js");

function story(overrides = {}) {
  return {
    schema: "launchclip.story.v1",
    format: { width: 320, height: 240, fps: 30, duration: 1 },
    brand: { colors: { bg: "#101018", primary: "#22cc88" } },
    scenes: [{ id: "s1", module: "box", start: 0, end: 1 }],
    ...overrides
  };
}

async function storyProject(value = story()) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-renderer-"));
  await writeFile(path.join(project, "storyboard.json"), JSON.stringify(value));
  return project;
}

function recorder(respond = () => ({ stdout: "", stderr: "" })) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    return respond(command, args, options);
  };
  return { calls, run };
}

test("getRenderer returns both adapters with the contract surface", () => {
  for (const name of ["hyperframes", "remotion"]) {
    const adapter = getRenderer(name);
    assert.equal(adapter.name, name);
    for (const method of ["render", "still", "check", "previewCommand"]) assert.equal(typeof adapter[method], "function");
  }
  assert.equal(getRenderer("REMOTION").name, "remotion");
  assert.throws(() => getRenderer("flash"), /Unknown renderer "flash"/);
});

test("detects remotion only for story projects without index.html", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-detect-"));
  assert.equal(detectRenderer(project), "hyperframes");
  await writeFile(path.join(project, "STORY.json"), "{}");
  assert.equal(detectRenderer(project), "hyperframes", "a creative STORY.json is not a storyboard");
  const storyOnly = await storyProject();
  assert.equal(detectRenderer(storyOnly), "remotion");
  assert.equal(detectEvidenceRenderer(storyOnly), "remotion");
  assert.equal(resolveRendererName(storyOnly), "remotion");
  assert.equal(resolveRendererName(storyOnly, "hyperframes"), "hyperframes");
  await writeFile(path.join(storyOnly, "index.html"), "<div></div>");
  assert.equal(detectRenderer(storyOnly), "hyperframes");
  assert.equal(detectEvidenceRenderer(storyOnly), "hyperframes");
  assert.throws(() => resolveRendererName(storyOnly, "flash"), /Unknown renderer/);
});

test("hyperframes adapter builds render, snapshot, check and preview invocations", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-hf-adapter-"));
  const { calls, run } = recorder(async (_command, args) => {
    if (args[1] === "snapshot") {
      const output = args[args.indexOf("--output") + 1];
      await writeFile(path.join(output, "frame-000.png"), "png");
    }
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  });
  const adapter = getRenderer("hyperframes", { run });
  const out = path.join(project, "renders", "draft.mp4");
  await adapter.render(project, out, { quality: "high", fps: 60 });
  await adapter.still(project, 1.25, path.join(project, "still.png"));
  const check = await adapter.check(project);

  assert.ok(calls.every((call) => call.command === process.execPath && call.args[0] === HYPERFRAMES_CLI && call.options.cwd === project));
  assert.deepEqual(calls[0].args.slice(1), ["render", "--output", out, "--quality", "high", "--workers", "auto", "--fps", "60", project]);
  const snapshot = calls[1].args.slice(1);
  assert.deepEqual([snapshot[0], snapshot[1], snapshot[2], snapshot[3]], ["snapshot", "--at", "1.25", "--no-end"]);
  assert.deepEqual(snapshot.slice(6), ["--describe", "false", project]);
  assert.equal(await readFile(path.join(project, "still.png"), "utf8"), "png");
  assert.deepEqual(calls[2].args.slice(1), ["lint", "--json", project]);
  assert.deepEqual(calls[3].args.slice(1), ["check", "--json", "--strict", "--snapshots", "--at-transitions", project]);
  assert.equal(check.status, "passed");
  assert.deepEqual(check.findings, []);
  assert.deepEqual(Object.keys(check.raw.checks), ["lint", "check"]);
  assert.deepEqual(adapter.previewCommand(project, { port: 3020 }), [process.execPath, HYPERFRAMES_CLI, "preview", "--port", "3020", project]);
  assert.equal(getRenderer("hyperframes").renderArgs(project, out).includes("draft"), true);
});

test("hyperframes adapter reports failures in the contract shape", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-hf-adapter-"));
  const failing = getRenderer("hyperframes", {
    run: async (_command, args) => {
      if (args[1] === "lint") return { stdout: JSON.stringify({ ok: true }) };
      throw Object.assign(new Error("exit 2"), { code: 2, stdout: JSON.stringify({ ok: false }), stderr: "overlap" });
    }
  });
  const check = await failing.check(project, { strict: false });
  assert.equal(check.status, "failed");
  assert.deepEqual(check.findings.map((entry) => entry.source), ["hyperframes-check"]);
  assert.equal(check.raw.checks.check.exit_code, 2);
  await assert.rejects(failing.render(project, path.join(project, "out.mp4")), /HyperFrames render failed \(exit 2\):\noverlap/);
});

test("remotion adapter resolves the story and builds render, still and preview invocations", async () => {
  const project = await storyProject(story({
    format: { width: 1080, height: 1920, fps: 30, duration: 2 },
    scenes: [{ id: "s1", module: "box", start: 0, end: "word:cools" }, { id: "s2", module: "box", start: "word:cools", end: 2, in: { type: "cut", dur: .1 } }]
  }));
  await writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ words: [{ text: "Cools", start: 1.2, end: 1.5 }] }));
  const { calls, run } = recorder();
  const adapter = getRenderer("remotion", { run, entry: FIXTURE_ENTRY, storyModule });
  const props = path.join(project, ".launchclip", "story.resolved.json");
  const shared = ["--props", props, "--public-dir", project, "--overwrite", "--log", "warn"];

  await adapter.render(project, path.join(project, "renders", "draft.mp4"));
  await adapter.render(project, path.join(project, "renders", "final.mp4"), { quality: "high", concurrency: 4 });
  const still = await adapter.still(project, 1.234, path.join(project, "still.png"));
  await adapter.still(project, 5, path.join(project, "late.png"));

  assert.ok(calls.every((call) => call.command === process.execPath && call.args[0] === REMOTION_CLI));
  assert.deepEqual(calls[0].args.slice(1), ["render", FIXTURE_ENTRY, COMPOSITION_ID, path.join(project, "renders", "draft.mp4"), ...shared, "--codec", "h264", "--crf", "28", "--x264-preset", "veryfast"]);
  assert.deepEqual(calls[1].args.slice(1), ["render", FIXTURE_ENTRY, COMPOSITION_ID, path.join(project, "renders", "final.mp4"), ...shared, "--codec", "h264", "--concurrency", "4"]);
  assert.deepEqual(calls[2].args.slice(1), ["still", FIXTURE_ENTRY, COMPOSITION_ID, path.join(project, "still.png"), ...shared, "--frame=37"]);
  assert.equal(still.frame, 37);
  assert.equal(calls[3].args.at(-1), "--frame=59", "stills clamp to the last frame");

  const resolved = JSON.parse(await readFile(props, "utf8"));
  assert.deepEqual(resolved.scenes.map((scene) => [scene.start, scene.end]), [[0, 1.2], [1.2, 2]]);
  assert.deepEqual(resolved.resolved, { duration: 2, fps: 30, frames: 60 });

  await adapter.render(project, path.join(project, "renders", "60.mp4"), { fps: 60 });
  assert.deepEqual(JSON.parse(await readFile(props, "utf8")).resolved, { duration: 2, fps: 60, frames: 120 });

  const preview = adapter.previewCommand(project, { port: 3100 });
  assert.deepEqual(preview, [process.execPath, REMOTION_CLI, "studio", FIXTURE_ENTRY, "--props", props, "--public-dir", project, "--log", "warn", "--port", "3100"]);
  assert.equal(frameAt(0.999, { fps: 30, duration: 1 }), 29);
});

test("remotion adapter prefers the project entry and explains missing pieces", async () => {
  const project = await storyProject();
  await mkdir(path.join(project, "remotion"));
  await writeFile(path.join(project, "remotion", "entry.tsx"), "");
  assert.equal(getRenderer("remotion").resolveEntry(project), path.join(project, "remotion", "entry.tsx"));
  const bare = await mkdtemp(path.join(os.tmpdir(), "launchclip-renderer-"));
  const adapter = getRenderer("remotion", { run: async () => ({}), entry: FIXTURE_ENTRY, storyModule });
  await assert.rejects(adapter.render(bare, path.join(bare, "out.mp4")), /need storyboard\.json/);
  const missingModule = getRenderer("remotion", { run: async () => ({}), entry: FIXTURE_ENTRY, storyModule: path.join(bare, "story.mjs") });
  await assert.rejects(missingModule.still(project, 0, path.join(project, "s.png")), /storyboard\.json support requires .*kit\/core\/story\.mjs/s);
  const missingEntry = getRenderer("remotion", { run: async () => ({}), entry: path.join(bare, "missing.tsx"), storyModule });
  await assert.rejects(missingEntry.still(project, 0, path.join(project, "s.png")), /Remotion entry not found/);
});

test("remotion check proves the story bundles and folds in the layout check", async () => {
  const project = await storyProject();
  const props = path.join(project, ".launchclip", "story.resolved.json");
  const { calls, run } = recorder(() => ({ stdout: "LaunchclipStory\n", stderr: "" }));
  const seen = [];
  const layoutCheck = {
    checkStoryLayout(resolved, options) {
      seen.push([resolved.resolved.frames, options.strict, options.format.width]);
      return { ok: true, findings: [{ severity: "warning", message: "caption band is tight" }] };
    }
  };
  const passing = await getRenderer("remotion", { run, entry: FIXTURE_ENTRY, storyModule, layoutCheck }).check(project);
  assert.deepEqual(calls[0].args.slice(1), ["compositions", FIXTURE_ENTRY, "--props", props, "--public-dir", project, "--quiet"]);
  assert.equal(passing.status, "passed");
  assert.deepEqual(seen, [[30, true, 320]]);
  assert.deepEqual(passing.findings, [{ source: "layout-check", severity: "warning", message: "caption band is tight" }]);
  assert.deepEqual(Object.keys(passing.raw.checks), ["story", "compositions", "layout"]);

  const blocked = await getRenderer("remotion", { run, entry: FIXTURE_ENTRY, storyModule, layoutCheck: { default: () => ["s1 overlaps the caption band"] } }).check(project);
  assert.equal(blocked.status, "failed");
  assert.equal(blocked.findings[0].message, "s1 overlaps the caption band");

  const skipped = await getRenderer("remotion", { run, entry: FIXTURE_ENTRY, storyModule, layoutCheck: path.join(project, "absent.mjs") }).check(project);
  assert.equal(skipped.status, "passed");
  assert.match(skipped.raw.checks.layout.skipped, /not found/);

  const unlisted = await getRenderer("remotion", { run: async () => ({ stdout: "Other\n" }), entry: FIXTURE_ENTRY, storyModule, layoutCheck: false }).check(project);
  assert.equal(unlisted.status, "failed");
  assert.match(unlisted.findings[0].message, /did not list LaunchclipStory/);

  await writeFile(path.join(project, "storyboard.json"), "{not json");
  const broken = await getRenderer("remotion", { run, entry: FIXTURE_ENTRY, storyModule, layoutCheck: false }).check(project);
  assert.equal(broken.status, "failed");
  assert.equal(broken.findings[0].source, "story");
});

test("build-evidence builds remotion still arguments from the schedule frame", () => {
  assert.deepEqual(remotionStillArgs({ serveUrl: "e.tsx", propsFile: "p.json", project: "/p", frame: 12, output: "/p/o.png" }),
    ["still", "e.tsx", "LaunchclipStory", "/p/o.png", "--props", "p.json", "--public-dir", "/p", "--frame=12", "--overwrite", "--log", "warn"]);
  assert.deepEqual(remotionStillArgs({ serveUrl: "/tmp/bundle", bundled: true, propsFile: "p.json", project: "/p", frame: 3, output: "/p/o.png" }),
    ["still", "/tmp/bundle", "LaunchclipStory", "/p/o.png", "--props", "p.json", "--frame=3", "--overwrite", "--log", "warn"]);
});

test("remotion adapter renders a real still and MP4, and build-evidence validates against them", { timeout: 240_000 }, async (t) => {
  try {
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
  } catch (error) {
    t.skip(`Chrome Headless Shell is unavailable: ${error.message}`);
    return;
  }
  const project = await storyProject();
  const adapter = getRenderer("remotion", { entry: FIXTURE_ENTRY, storyModule, layoutCheck: false });

  const stillFile = path.join(project, "qa", "still.png");
  const still = await adapter.still(project, .5, stillFile);
  assert.equal(still.frame, 15);
  const png = await readFile(stillFile);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 320);
  assert.equal(png.readUInt32BE(20), 240);

  const video = path.join(project, "renders", "draft.mp4");
  await adapter.render(project, video);
  assert.ok((await stat(video)).size > 1000);
  const mp4 = await readFile(video);
  assert.equal(mp4.subarray(4, 8).toString("ascii"), "ftyp");

  const check = await adapter.check(project);
  assert.equal(check.status, "passed", JSON.stringify(check.findings));

  let ffmpeg = true;
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }
  if (!ffmpeg) return;
  const previous = process.env.REMOTION_BIN;
  process.env.REMOTION_BIN = path.join(ROOT, "node_modules", ".bin", "remotion");
  try {
    const result = await buildEvidence(project, { renderer: "remotion", entry: FIXTURE_ENTRY, storyModule, sheets: false });
    assert.equal(result.renderer, "remotion");
    const manifest = JSON.parse(await readFile(path.join(project, "qa", "temporal-evidence", "manifest.json"), "utf8"));
    assert.ok(manifest.entries.some((entry) => entry.source === "browser-still" && entry.file.endsWith("-browser-still.png")));
    const validation = await validateTemporalEvidenceManifest(project, manifest, video, buildTemporalEvidenceSchedule(1, []));
    assert.equal(validation.ok, true, validation.errors.join("; "));
  } finally {
    if (previous === undefined) delete process.env.REMOTION_BIN;
    else process.env.REMOTION_BIN = previous;
  }
});
