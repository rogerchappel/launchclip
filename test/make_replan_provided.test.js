// A replan after the asset provider fetched clips into the --assets folder.
// From a production run: the first attempt asked the provider for shots (for
// example "Aerial top-down view of a timber deck with a white outdoor dining
// table and surrounding yard"), and the app's provider wrote each clip it
// found into the folder it passes as --assets. The storyboard stage failed,
// the app ran make again with --replan, and the retry
//   - described 21 fetched clips with the model, one file at a time (the
//     inventory stage: 0.1 s on the first attempt, 1385 s on the retry), and
//   - ran the concept, story and script calls again, because the new files
//     changed the asset lines the writing is keyed on.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PROVIDED_FILE, markProvided, providedNotes, readProvided, recordProvided } from "../src/provided_files.js";
import { routeLane } from "../src/make/routing.js";
import { fakeInventory } from "./helpers/make_fakes.js";
import { recordedRun } from "./helpers/make_recorded_run.js";

const SHOWS = "Aerial top-down view of a timber deck with a white outdoor dining table and surrounding yard";
const SAID = "Overhead drone shot of a timber deck with an outdoor dining setting";
const WRITING = ["launchclip_make_script", "launchclip_asset_description"];

// The app's provider: it writes the clip into the assets folder, under broll/, and answers with that file.
function provider(assets, asked = []) {
  return {
    async findShot(request) {
      asked.push(request.shows);
      const file = path.join(assets, "broll", `library-${String(asked.length).padStart(2, "0")}.mp4`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `clip for ${request.shows} #${asked.length}`);
      return { id: request.id, path: file, kind: "video", source: "library", asset_id: `asset-${asked.length}`, description: SAID, duration_s: 6 };
    }
  };
}

// The classifier's entries for the fixture, plus whatever is under broll/ by now.
async function inventory(dir) {
  const base = await fakeInventory(dir);
  let clips = [];
  try { clips = (await readdir(path.join(dir, "broll"))).sort(); } catch { clips = []; }
  clips.forEach((name, index) => base.entries.push({ path: `broll/${name}`, kind: "video", role: "b-roll", confidence: 0.6, signals: ["folder:broll"], description: "B-roll video (6s, 1920×1080, silent)", media: { kind: "video", width: 1920, height: 1080, duration: 6, orientation: "landscape", has_audio: false, mountable: true }, speech: { present: false }, fingerprint: `clip-${index}` }));
  return base;
}

const shotBoard = (board) => ({ ...board, scenes: board.scenes.map((scene, index) => (index === 0 ? { ...scene, params: { ...scene.params, media: { kind: "shot", shows: SHOWS } } } : scene)) });

test("make --replan: clips the provider fetched into --assets are not described by a model, and the script and the voice are reused", async () => {
  const fixture = await recordedRun({ screenshots: [], board: shotBoard });
  try {
    const asked = [];
    const adapters = { assets: provider(fixture.assets, asked), inventory };
    const options = { critic: false, candidates: "off" };
    const first = await fixture.run(options, { adapters });
    assert.notEqual(first.report.status, "failed", first.report.warnings.join("\n"));
    assert.ok(asked.length >= 1, "the plan asked the provider for the shot");
    assert.equal(first.report.shots[0].shows, SHOWS);
    assert.ok(first.calls.includes("launchclip_make_script"));
    const narration = await readFile(path.join(fixture.project, "NARRATION.json"), "utf8");
    const fetched = (await readdir(path.join(fixture.assets, "broll"))).map((name) => `broll/${name}`);

    const second = await fixture.run({ ...options, replan: true }, { adapters });
    const calls = second.calls.slice(first.calls.length);
    assert.notEqual(second.report.status, "failed", second.report.warnings.join("\n"));
    // No model call describes a fetched clip, and nothing of the writing runs again.
    assert.deepEqual(calls.filter((name) => WRITING.includes(name) || /concept|judge|story(?!board)/.test(name)), [], calls.join(", "));
    assert.ok(calls.includes("launchclip_storyboard"), "the storyboard is planned afresh");
    assert.equal(second.report.concept.status, "reused");
    assert.equal(await readFile(path.join(fixture.project, "NARRATION.json"), "utf8"), narration, "the voice take is the first run's");
    assert.equal(second.report.costs.items.filter((item) => item.stage === "asset-description").length, 0);
    // The retry says what it recognised, and routes as the first run did.
    assert.ok(second.lines.some((line) => /^assets: \d+ files? in --assets (was|were) fetched by the asset provider for an earlier plan/.test(line)), second.lines.join("\n"));
    assert.deepEqual(second.report.routing.provided, fetched.filter((name) => second.report.routing.provided.includes(name)));
    assert.ok(second.report.routing.provided.length >= 1);
    assert.deepEqual(second.report.routing.media.map((item) => item.path), first.report.routing.media.map((item) => item.path));
    assert.equal(second.report.routing.lane, first.report.routing.lane);
    assert.ok(!second.report.warnings.some((line) => line.startsWith("broll/")), "a fetched clip is not a warning");
    // ASSETS.json keeps each one, described from the provider's answer and the request it answered.
    const listed = JSON.parse(await readFile(path.join(fixture.project, "ASSETS.json"), "utf8"));
    const entry = listed.entries.find((item) => item.path === second.report.routing.provided[0]);
    assert.match(entry.notes.description, new RegExp(`^${SAID}\\. Fetched by the asset provider for "${SHOWS}"\\.$`));
    assert.equal(entry.notes.role, "b-roll");
    assert.equal(entry.provided.shows, SHOWS);
    assert.equal(entry.understanding.source, "notes");
  } finally {
    await fixture.cleanup();
  }
});

test("a file the user put in --assets is still described by the model beside the fetched ones", async () => {
  const fixture = await recordedRun({ screenshots: [], board: shotBoard });
  try {
    const adapters = { assets: provider(fixture.assets), inventory };
    const first = await fixture.run({ critic: false, candidates: "off" }, { adapters });
    // The user adds a clip of their own to the same folder before the retry.
    await writeFile(path.join(fixture.assets, "broll", "my-deck.mp4"), "the user's own clip");
    const second = await fixture.run({ critic: false, candidates: "off", replan: true }, { adapters });
    const calls = second.calls.slice(first.calls.length);
    assert.equal(calls.filter((name) => name === "launchclip_asset_description").length, 1, "one call: the user's clip");
    assert.ok(second.report.routing.media.some((item) => item.path === "broll/my-deck.mp4"));
    assert.ok(!second.report.routing.provided.includes("broll/my-deck.mp4"));
  } finally {
    await fixture.cleanup();
  }
});

test("the record of fetched files: kept by content, read back as notes, and matched wherever the file is", async () => {
  const fixture = await recordedRun({ screenshots: [] });
  try {
    const clip = path.join(fixture.cwd, "answer.mp4");
    await writeFile(clip, "clip bytes");
    const other = path.join(fixture.cwd, "other.mp4");
    await writeFile(other, "other bytes");
    // Answers arrive several at a time: both land in the record.
    await Promise.all([
      recordProvided(fixture.cwd, { file: clip, src: "assets/shots/a.mp4", request: { shows: SHOWS, line: "Start from above." }, shot: { kind: "video", notes: { description: SAID, quality: 0.8 } } }),
      recordProvided(fixture.cwd, { file: other, src: "assets/shots/b.mp4", request: { shows: "A person brushing an outdoor deck surface" } })
    ]);
    const records = await readProvided(fixture.cwd);
    assert.equal(records.size, 2);
    assert.equal(JSON.parse(await readFile(path.join(fixture.cwd, PROVIDED_FILE), "utf8")).schema_version, "launchclip.provided-files.v1");
    assert.deepEqual(providedNotes({ shows: "A person brushing an outdoor deck surface" }), { description: "Fetched by the asset provider for \"A person brushing an outdoor deck surface\".", role: "b-roll" });
    // The same bytes under another name in the assets folder; a file of the user's beside it; the user's own notes win.
    const assets = path.join(fixture.cwd, "handed-in");
    await mkdir(assets);
    await writeFile(path.join(assets, "renamed.mp4"), "clip bytes");
    await writeFile(path.join(assets, "mine.mp4"), "mine");
    const found = { dir: assets, entries: [{ path: "renamed.mp4", kind: "video", notes: { quality: 0.4 } }, { path: "mine.mp4", kind: "video" }, { path: "notes.md", kind: "notes" }] };
    assert.deepEqual(await markProvided(found, { project: fixture.cwd }), ["renamed.mp4"]);
    assert.deepEqual(found.entries[0].provided, { src: "assets/shots/a.mp4", shows: SHOWS });
    assert.equal(found.entries[0].notes.quality, 0.4);
    assert.match(found.entries[0].notes.description, /^Overhead drone shot.*Fetched by the asset provider for "Aerial top-down view/);
    assert.equal(found.entries[1].provided, undefined);
    // A project with no record reads no file at all.
    assert.deepEqual(await markProvided(found, { project: assets, hash: () => { throw new Error("not hashed"); } }), []);
    // Routing leaves a fetched clip out, even one with speech in it.
    const routed = routeLane({ entries: [{ path: "renamed.mp4", kind: "video", role: "talking-head", signals: [], speech: { present: true }, media: { duration: 9 }, provided: found.entries[0].provided }] }, { aspect: "9:16", duration: 30 });
    assert.equal(routed.lane, "motion");
    assert.deepEqual(routed.provided, ["renamed.mp4"]);
    assert.deepEqual(routed.media, []);
    assert.equal(routeLane({ entries: [] }, {}).provided, undefined);
  } finally {
    await fixture.cleanup();
  }
});
