// A whole `launchclip make` run from recorded answers, with the time each
// call and render takes stood in for by a delay: the run the concurrency
// tests compare (one call at a time against calls overlapping) and
// benchmarks/make-concurrency.mjs times.
//
// The answers are the fixed ones the other make tests use (make_fakes.js,
// concept_fakes.js), plus a description per handed-in screenshot and the two
// calls of the candidates stage. Nothing here reaches a model or a renderer.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describeInventory } from "../../src/asset_understanding.js";
import { CANDIDATE_SCORE_FIELDS } from "../../src/make/candidates.js";
import { runMake } from "../../src/make/index.js";
import { parseProgressLine } from "../../src/progress.js";
import { withConcepts } from "./concept_fakes.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./make_fakes.js";

export const SCREENSHOTS = ["dashboard.png", "invoices.png", "payouts.png", "pricing.png", "settings.png", "team.png"];
const usage = { input_tokens: 2000, output_tokens: 400, total_tokens: 2400 };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const wait = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * options: {callMs (a model call's time), stillMs (one still's), finishMs,
 * jitter (true: a later call of the same kind answers sooner, so answers
 * arrive out of order when calls overlap), screenshots (the handed-in
 * screenshots beside the fixture's clip and logo; [] for none), direction (the
 * map the direction call answers with; none by default, so make drafts one),
 * board (a change to every recorded storyboard)}. run's hooks.adapters are
 * merged over the run's own.
 * → {run(makeOptions, {sleep, now, refuse}) → {report, lines, calls, peak}, project, cwd, assets, cleanup()}
 */
export async function recordedRun({ callMs = 0, stillMs = 0, finishMs = 0, jitter = false, screenshots = SCREENSHOTS, direction = null, board = null } = {}) {
  const assets = await assetsDir();
  for (const name of screenshots) await writeFile(path.join(assets, name), `screenshot ${name}`);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-recorded-run-"));
  const project = path.join(cwd, "video");
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  const fake = fakeModel({ vision: true });
  const answer = fake.model.client.runStructured.bind(fake.model.client);
  const scores = (value) => Object.fromEntries(CANDIDATE_SCORE_FIELDS.map((field) => [field, value]));
  const seenByKind = new Map();
  const recorded = async (request) => {
    if (direction && request.schemaName === "launchclip_direction") return { model: "gpt-5.6-luna", usage, value: { direction_json: JSON.stringify(direction) } };
    if (request.schemaName === "launchclip_asset_description") {
      const file = /File: (\S+)/.exec(request.input)[1];
      return { model: "gpt-5.6-luna", usage, value: { shows: `${file.replace(".png", "")} screen`, description: `The ${file.replace(".png", "")} page of Ledgerly.`, text: [], fits: ["how it works"], people: false, windows: [] } };
    }
    if (request.schemaName === "launchclip_make_opening_candidate") return { model: "gpt-5.6-luna", usage, value: { module: "media-window", params_json: JSON.stringify({ title: "Every payout, matched", media: { kind: "video", src: "assets/ui.mp4" } }), why: "The product, with the promise as its title." } };
    if (request.schemaName === "launchclip_make_candidate_judgment") {
      const kind = /the opening of the video/.test(request.input) ? "open" : "trans";
      const wins = kind === "open" ? "b" : "a";
      return { model: "gpt-5.6-luna", usage, value: { rationale: `Candidate ${kind}-${wins} reads sooner.`, candidates: ["a", "b"].map((letter) => ({ id: `${kind}-${letter}`, admissible: true, weakness: letter === wins ? "" : "Slower to read.", scores: scores(letter === wins ? 8 : 6) })) } };
    }
    const answered = await answer(request);
    // board(storyboard) → the storyboard the recorded model returns instead (a shot request, say).
    if (board && request.schemaName === "launchclip_storyboard") return { ...answered, value: { storyboard_json: JSON.stringify(board(JSON.parse(answered.value.storyboard_json))) } };
    return answered;
  };
  fake.model.client.runStructured = recorded;
  const model = withConcepts(fake.model);
  const answered = model.client.runStructured.bind(model.client);
  // Set per run: refuse(request) → true answers that call with a rate limit instead.
  let refuse = null;
  model.client.runStructured = async (request) => {
    if (refuse?.(request)) throw Object.assign(new Error("429 Too Many Requests"), { status: 429 });
    calls.push(request.schemaName);
    const nth = seenByKind.get(request.schemaName) ?? 0;
    seenByKind.set(request.schemaName, nth + 1);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await wait(jitter ? Math.max(1, callMs - nth * Math.ceil(callMs / 8)) : callMs);
      return await answered(request);
    } finally {
      inFlight -= 1;
    }
  };
  const inventory = async (dir) => {
    const base = await fakeInventory(dir);
    for (const [index, name] of screenshots.entries()) base.entries.push({ path: name, kind: "image", role: "screenshot", confidence: 0.8, signals: ["size:1920x1080"], description: "Screenshot (1920×1080) of the product UI to show in a media window", media: { kind: "image", width: 1920, height: 1080, alpha: false }, fingerprint: String(10 + index) });
    return base;
  };
  const still = async (story, at, out, { dir }) => {
    await wait(stillMs);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, Buffer.concat([PNG, Buffer.from(`${path.basename(dir)}@${at}:${story.scenes[0].module}:${story.scenes[1]?.in?.type ?? ""}`)]));
  };
  const finish = fakeFinish([]);
  const critic = async () => ({ status: "written", verdict: "ship", findings: 0, reviewed: 1, unreviewed: 0, warnings: [], model: "gpt-5.6-luna", critique: { verdict: "ship", summary: "", findings: [] } });
  const run = async (options = {}, hooks = {}) => {
    const lines = [];
    refuse = hooks.refuse ?? null;
    // The description cache is the run's own, so a second run in the same project reuses it and another project never sees it.
    const describeAssets = (found, settings) => describeInventory(found, { ...settings, cacheDir: path.join(cwd, "descriptions"), adapters: { motion: async () => null, ocr: async () => null, images: async () => ({ images: [{ url: "data:image/jpeg;base64,AA==", detail: "high" }], times: [0] }) } });
    const adapters = { env: {}, client: model, inventory, describeAssets, candidateStill: still, critic, notice: (line) => lines.push(line), finish: async (...args) => { await wait(finishMs); return finish(...args); }, ...(hooks.sleep ? { sleep: hooks.sleep } : {}), ...(hooks.now ? { now: hooks.now } : {}), ...(hooks.adapters ?? {}) };
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, out: "video", ...options }, adapters);
    return { report, lines, calls: [...calls], peak };
  };
  // model: the fixture's model (its client answers from the recording), for a test that routes some calls through another client.
  return { run, project, cwd, assets, model, cleanup: () => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]) };
}

/** Every file under a project as {relative path: text}, with the run's own folders written as <cwd> and <assets>. */
export async function projectFiles(project, { cwd, assets }) {
  const out = {};
  const walk = async (dir) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else out[path.relative(project, file)] = (await readFile(file)).toString("latin1").split(cwd).join("<cwd>").split(assets).join("<assets>");
    }
  };
  await walk(project);
  return out;
}

/** Everything the run wrote to stderr, in order: progress lines without their seconds, notices with the run's own folders written as <cwd> and <assets>. */
export function stderrLines(lines, { cwd, assets }) {
  return lines.map((line) => {
    const event = parseProgressLine(line);
    if (!event) return line.split(cwd).join("<cwd>").split(assets).join("<assets>");
    const { seconds: _seconds, ...rest } = event;
    return rest;
  });
}

/** The run's progress events in the order they were written, without their seconds. */
export function progressEvents(lines) {
  return lines.map(parseProgressLine).filter(Boolean).map(({ seconds: _seconds, ...event }) => event);
}
