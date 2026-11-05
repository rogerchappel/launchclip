// `launchclip make --asset-provider-cmd "<cmd>"` (src/asset_provider_cmd.js):
// the app's own command answers shot requests, one JSON line each way, in
// either the shot shape or the flat {path, kind, source, cost_usd, …} shape;
// shots land in the project and their cost in make's costs.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ASSET_PROVIDER_TIMEOUT_MS, MAX_ASSET_PROVIDER_CONCURRENCY, assetProviderConcurrency, assetProviderTimeoutMs, createCommandAssetProvider } from "../src/asset_provider_cmd.js";
import { normalizeShot } from "../src/asset_provider.js";
import { assetErrors, runMake } from "../src/make/index.js";
import { makeOptionsFromFlags } from "../src/make/options.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const node = JSON.stringify(process.execPath);

async function script(t, source) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-asset-cmd-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "provider.mjs");
  await writeFile(file, source);
  return { dir, command: `${node} ${JSON.stringify(file)}` };
}

// Answers each request line with answer(request) as one JSON line.
const answering = (body) => `import { createInterface } from "node:readline";
const answer = ${body};
createInterface({ input: process.stdin }).on("line", async (line) => process.stdout.write(JSON.stringify(await answer(JSON.parse(line))) + "\\n"));
`;

test("the flat shape: path is the file, source none is no shot, its fields and cost are kept", () => {
  assert.equal(normalizeShot({ source: "none" }), null);
  assert.equal(normalizeShot(null), null);
  const shot = normalizeShot({ path: "/lib/a.jpg", kind: "image", source: "ai", provider: "imagegen", model: "m-1", cost_usd: 0.04, asset_id: "a1", crop_hint: { x: 0.5 } });
  assert.equal(shot.file, "/lib/a.jpg");
  assert.deepEqual(shot.source, { origin: "ai", asset_id: "a1", provider: "imagegen", model: "m-1", cost_usd: 0.04, crop_hint: { x: 0.5 } });
  assert.equal(shot.cost_usd, 0.04);
  assert.equal(normalizeShot({ src: "assets/a.png", source: { provider: "lib" } }).cost_usd, 0);
});

test("the command answers requests in order, one JSON line each way, and is started once", async (t) => {
  const { command } = await script(t, answering(`(request) => request.shows === "none" ? { source: "none" } : { path: "/lib/" + request.id + ".jpg", source: "library", pid: process.pid }`));
  const provider = createCommandAssetProvider(command, { notice: () => {} });
  t.after(() => provider.close());
  const [a, b, c] = await Promise.all([provider.findShot({ id: "one", shows: "a" }), provider.findShot({ id: "two", shows: "none" }), provider.findShot({ id: "three", shows: "c" })]);
  assert.equal(a.path, "/lib/one.jpg");
  assert.deepEqual(b, { source: "none" });
  assert.equal(c.path, "/lib/three.jpg");
  assert.equal(a.pid, c.pid);
});

test("no answer in time, a non-JSON line or a dead command is no shot, and answers stay aligned", async (t) => {
  const { command } = await script(t, answering(`async (request) => { if (request.id === "slow") await new Promise((done) => setTimeout(done, 300)); return { id: request.id, path: "/lib/" + request.id + ".jpg" }; }`));
  const notices = [];
  const provider = createCommandAssetProvider(command, { timeoutMs: 100, notice: (line) => notices.push(line) });
  t.after(() => provider.close());
  assert.equal(await provider.findShot({ id: "slow" }), null);
  assert.equal((await provider.findShot({ id: "next" })).path, "/lib/next.jpg", "the late answer for slow is dropped, not given to next");
  assert.ok(notices.some((line) => /no answer for slow/.test(line)));

  const { command: garbled } = await script(t, `process.stdin.on("data", () => process.stdout.write("hello\\n"));`);
  const second = createCommandAssetProvider(garbled, { notice: () => {} });
  t.after(() => second.close());
  assert.equal(await second.findShot({ id: "x" }), null);

  const dead = createCommandAssetProvider(`${node} -e "process.exit(3)"`, { notice: () => {} });
  assert.equal(await dead.findShot({ id: "x" }), null);
  assert.equal(await dead.findShot({ id: "y" }), null);
});

test("with concurrency, several requests are open at once and answers out of order find their request by id", async (t) => {
  // Answers "slow" last, though it is asked first; reports how many it held at once.
  const { command } = await script(t, answering(`(() => { let open = 0, most = 0; return async (request) => { open += 1; most = Math.max(most, open); await new Promise((done) => setTimeout(done, request.id === "slow" ? 150 : 20)); open -= 1; return { id: request.id, path: "/lib/" + request.id + ".jpg", most }; }; })()`));
  const provider = createCommandAssetProvider(command, { concurrency: 3, notice: () => {} });
  t.after(() => provider.close());
  assert.equal(provider.concurrency, 3);
  const [slow, b, c, d] = await Promise.all(["slow", "b", "c", "d"].map((id) => provider.findShot({ id, shows: id })));
  assert.deepEqual([slow.path, b.path, c.path, d.path], ["/lib/slow.jpg", "/lib/b.jpg", "/lib/c.jpg", "/lib/d.jpg"]);
  assert.equal(Math.max(slow.most, b.most, c.most, d.most), 3, "never more than three open");
});

test("LAUNCHCLIP_ASSET_PROVIDER_CONCURRENCY sets how many requests are open at once; anything else is one", () => {
  assert.equal(assetProviderConcurrency({}), 1);
  assert.equal(assetProviderConcurrency({ LAUNCHCLIP_ASSET_PROVIDER_CONCURRENCY: "4" }), 4);
  assert.equal(assetProviderConcurrency({ LAUNCHCLIP_ASSET_PROVIDER_CONCURRENCY: "0" }), 1);
  assert.equal(assetProviderConcurrency({ LAUNCHCLIP_ASSET_PROVIDER_CONCURRENCY: "lots" }), 1);
  assert.equal(assetProviderConcurrency({ LAUNCHCLIP_ASSET_PROVIDER_CONCURRENCY: "500" }), MAX_ASSET_PROVIDER_CONCURRENCY);
  assert.equal(createCommandAssetProvider("true").concurrency, 1);
});

test("assetErrors allows the provider's assets/shots/ files only when shots are on", () => {
  const story = { scenes: [{ params: { media: { src: "assets/shots/s1-abc.jpg" } } }] };
  assert.equal(assetErrors(story, new Set()).length, 1);
  assert.deepEqual(assetErrors(story, new Set(), { shots: true }), []);
});

test("make --asset-provider-cmd plans with the command's shot and records its cost", async (t) => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-shots-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const library = path.join(cwd, "library-shot.jpg");
  await writeFile(library, "jpeg");
  const { command } = await script(t, answering(`(request) => ({ path: ${JSON.stringify(library)}, kind: "image", source: "ai", provider: "imagegen", model: "img-2", cost_usd: 0.04, asset_id: "gen-" + request.scene_id })`));
  // The fake model asks for a shot in the opening media-window.
  const { model } = fakeModel();
  const inner = model.client.runStructured.bind(model.client);
  model.client.runStructured = async (request) => {
    const result = await inner(request);
    if (request.schemaName !== "launchclip_storyboard") return result;
    const board = JSON.parse(result.value.storyboard_json);
    board.scenes[0].params.media = { kind: "shot", shows: "a messy spreadsheet of payouts", type: "image" };
    return { ...result, value: { storyboard_json: JSON.stringify(board) } };
  };
  const options = { ...makeOptionsFromFlags({ "asset-provider-cmd": command }), assets, voice: "test", music: "synth", cwd };
  const report = await runMake(PROMPT, options, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice: () => {} });
  assert.equal(report.status, "ready-for-review", JSON.stringify(report.stages));
  assert.equal(report.shots.length, 1);
  const shot = report.shots[0];
  assert.match(shot.src, /^assets\/shots\/s1-[0-9a-f]{10}\.jpg$/);
  assert.deepEqual(shot.source, { origin: "ai", asset_id: "gen-s1", provider: "imagegen", model: "img-2", cost_usd: 0.04 });
  assert.equal(await readFile(path.join(report.project, shot.src), "utf8"), "jpeg");
  const story = JSON.parse(await readFile(path.join(report.project, "storyboard.json"), "utf8"));
  assert.equal(story.scenes[0].params.media.src, shot.src);
  assert.deepEqual(report.costs.items.find((item) => item.stage === "shot"), { stage: "shot", scene_id: "s1", provider: "imagegen", model: "img-2", estimated_usd: 0.04, fallback: false });
  assert.ok(report.costs.items.some((item) => item.stage.startsWith("storyboard-")), "model calls are itemised too");
  assert.ok(existsSync(path.join(report.project, shot.src)));
});

// A fake model that asks for one shot in the opening media-window.
function oneShotModel() {
  const { model } = fakeModel();
  const inner = model.client.runStructured.bind(model.client);
  model.client.runStructured = async (request) => {
    const result = await inner(request);
    if (request.schemaName !== "launchclip_storyboard") return result;
    const board = JSON.parse(result.value.storyboard_json);
    board.scenes[0].params.media = { kind: "shot", shows: "a messy spreadsheet of payouts", type: "image" };
    return { ...result, value: { storyboard_json: JSON.stringify(board) } };
  };
  return model;
}

test("make --min-shots records shot counts, and too few shots after the repairs is a warning, not a failure", async (t) => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-min-shots-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const library = path.join(cwd, "library-shot.jpg");
  await writeFile(library, "jpeg");
  const { command } = await script(t, answering(`() => ({ path: ${JSON.stringify(library)}, kind: "image", source: "library" })`));
  const run = (flags, out) => runMake(PROMPT, { ...makeOptionsFromFlags({ "asset-provider-cmd": command, ...flags }), assets, voice: "test", music: "synth", cwd, out }, { env: {}, client: oneShotModel(), inventory: fakeInventory, finish: fakeFinish([]), notice: () => {} });

  const enough = await run({ "min-shots": "1" }, "enough");
  assert.equal(enough.status, "ready-for-review", JSON.stringify(enough.stages));
  assert.deepEqual(enough.shot_counts, { min: 1, requested: 1, answered: 1 });
  assert.equal(enough.shots.length, 1);
  assert.ok(!enough.warnings.some((warning) => /shots/.test(warning)), enough.warnings.join("\n"));

  const short = await run({ "min-shots": "3", "max-repairs": "1" }, "short");
  assert.equal(short.status, "ready-for-review", JSON.stringify(short.stages));
  assert.deepEqual(short.shot_counts, { min: 3, requested: 1, answered: 1 });
  assert.equal(short.repairs.used, 1);
  assert.ok(short.warnings.some((warning) => /shots: the storyboard asks for 1 shot, fewer than the 3 wanted, after 1 repair; kept the best storyboard/.test(warning)), short.warnings.join("\n"));

  const clamped = await run({ "min-shots": "9", "max-repairs": "0" }, "clamped");
  assert.equal(clamped.status, "ready-for-review", JSON.stringify(clamped.stages));
  assert.equal(clamped.shot_counts.min, 6);
  assert.ok(clamped.warnings.some((warning) => /--min-shots 9 is more than a plan may ask for; using 6/.test(warning)), clamped.warnings.join("\n"));
});

test("make ignores --min-shots without an asset provider, with a note", async (t) => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-min-shots-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const { model } = fakeModel();
  const report = await runMake(PROMPT, { ...makeOptionsFromFlags({ "min-shots": "2" }), assets, voice: "test", music: "synth", cwd }, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice: () => {} });
  assert.equal(report.status, "ready-for-review", JSON.stringify(report.stages));
  assert.equal(report.shot_counts, undefined);
  assert.equal(report.shots, undefined);
  assert.ok(report.warnings.some((warning) => /--min-shots 2 ignored: there is no asset provider/.test(warning)), report.warnings.join("\n"));
  assert.ok(report.repairs.attempts.every((attempt) => !attempt.errors.some((error) => /^shots:/.test(error))), JSON.stringify(report.repairs.attempts));
});

test("LAUNCHCLIP_ASSET_PROVIDER_TIMEOUT_MS raises the wait for an answer; anything else keeps the default", () => {
  assert.equal(assetProviderTimeoutMs({ LAUNCHCLIP_ASSET_PROVIDER_TIMEOUT_MS: "600000" }), 600_000);
  assert.equal(assetProviderTimeoutMs({}), ASSET_PROVIDER_TIMEOUT_MS);
  assert.equal(assetProviderTimeoutMs({ LAUNCHCLIP_ASSET_PROVIDER_TIMEOUT_MS: "soon" }), ASSET_PROVIDER_TIMEOUT_MS);
  assert.equal(assetProviderTimeoutMs({ LAUNCHCLIP_ASSET_PROVIDER_TIMEOUT_MS: "0" }), ASSET_PROVIDER_TIMEOUT_MS);
});
