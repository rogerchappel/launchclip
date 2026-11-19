// Several keyframe candidates per shot (--keyframe-candidates): stills are cheap
// next to a clip, so N are made, the check picks the best, and only it is
// animated. Offline: the fake provider and a stub vision client.
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { projectBriefs } from "../src/generate/brief.js";
import { MAX_KEYFRAME_CANDIDATES, createGenerator, parseKeyframeCandidates, visionKeyframeCheck } from "../src/generate/generator.js";
import { readLedger } from "../src/generate/ledger.js";
import { checkKeyframe, recordShot } from "../src/generate/record.js";
import { audienceConcepts } from "../src/generate/concepts.js";
import { createFakeProvider } from "./fixtures/generate/fake-provider.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "generate-brief");
const NO_POLL = { image: 0, video: 0 };
const PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "parity", "assets", "testsrc.png");

async function project(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidates-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

// One clip request (s1) through the generator.
async function one(dir, generator) {
  const [{ request }] = (await projectBriefs(dir)).filter(({ request: r }) => r.scene_id === "s1");
  const shot = await generator.findShot(request);
  return { request, shot };
}

// A rank() stand-in: picks `best` (0-based) or fails them all.
const ranker = (best, seen = []) => {
  const check = async () => ({ ok: true });
  check.rank = async ({ files }) => { seen.push(files.length); return { best, verdicts: files.map((_, i) => ({ ok: best != null, reason: best == null ? `candidate ${i + 1} is off brief` : null })), change: best == null ? "Show the cup from above." : null }; };
  return check;
};

test("three candidates: one round, one attempt number, the chosen still is the only one animated", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.04 });
  const seen = [];
  const generator = createGenerator({ project: dir, image: fake, video: fake, budget: { usd: 5 }, candidates: 3, check: ranker(1, seen), pollMs: NO_POLL });
  const { request, shot } = await one(dir, generator);
  assert.equal(shot.kind, "video");
  assert.deepEqual(seen, [3], "ranked in one look");
  // The quote counted three stills and one clip.
  assert.equal(generator.report().quotes[0].totals.usd, 0.16);
  const ledger = (await readLedger(dir)).filter((entry) => entry.shot === request.id);
  const stills = ledger.filter((entry) => entry.step === "image");
  assert.deepEqual(stills.map((entry) => [entry.attempt, entry.candidate, entry.verdict]), [[1, 1, "rejected"], [1, 2, "accepted"], [1, 3, "rejected"]]);
  assert.equal(stills[0].reason, "another candidate was chosen");
  assert.equal(ledger.filter((entry) => entry.step === "video").length, 1);
  // Three paid stills, one attempt used: two retries are left.
  assert.equal(new Set(stills.map((entry) => entry.attempt)).size, 1);
});

test("every candidate fails: the round is rejected and retried with the check's change line", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.04 });
  let rounds = 0;
  const check = async () => ({ ok: true });
  check.rank = async ({ files }) => {
    rounds += 1;
    const best = rounds === 2 ? 0 : null;
    return { best, verdicts: files.map(() => ({ ok: best != null, reason: "a logo on the cup" })), change: "Plain cup, no marks." };
  };
  const generator = createGenerator({ project: dir, image: fake, video: fake, budget: { usd: 5 }, candidates: 2, check, pollMs: NO_POLL });
  const { request } = await one(dir, generator);
  const stills = (await readLedger(dir)).filter((entry) => entry.shot === request.id && entry.step === "image");
  assert.deepEqual(stills.map((entry) => [entry.attempt, entry.verdict]), [[1, "rejected"], [1, "rejected"], [2, "accepted"], [2, "rejected"]]);
  assert.equal(stills[2].changed, "Plain cup, no marks.");
});

test("candidates with no vision model: one still per shot, and it says why", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.04 });
  const notes = [];
  const generator = createGenerator({ project: dir, image: fake, video: fake, budget: { usd: 5 }, candidates: 4, pollMs: NO_POLL, notice: (line) => notes.push(line) });
  await one(dir, generator);
  assert.equal(fake.calls.filter(([call, , step]) => call === "submit" && step === "image").length, 1);
  assert.match(notes.join("\n"), /no vision model is configured to choose between keyframe candidates, so one is made per shot, not 4/);
});

test("a check without rank() takes the first candidate that passes", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.04 });
  let calls = 0;
  const check = async () => ({ ok: ++calls === 2, reason: "hands are malformed" });
  const generator = createGenerator({ project: dir, image: fake, video: fake, budget: { usd: 5 }, candidates: 3, check, pollMs: NO_POLL });
  const { request } = await one(dir, generator);
  const stills = (await readLedger(dir)).filter((entry) => entry.shot === request.id && entry.step === "image");
  assert.deepEqual(stills.map((entry) => entry.verdict), ["rejected", "accepted", "rejected"]);
  assert.equal(stills[0].reason, "hands are malformed");
});

test("the vision rank drops anomalies and text, then picks the highest look plus aesthetics", async () => {
  const client = { runStructured: async (call) => {
    assert.equal(call.images.length, 3);
    return { value: { change: "", candidates: [
      { index: 1, shows_subject: true, has_text_or_logo: false, anomalies: true, look_match: 10, aesthetics: 10, finding: "six fingers" },
      { index: 2, shows_subject: true, has_text_or_logo: false, anomalies: false, look_match: 6, aesthetics: 7, finding: "fine" },
      { index: 3, shows_subject: true, has_text_or_logo: false, anomalies: false, look_match: 8, aesthetics: 8, finding: "best" }
    ] } };
  } };
  const ranked = await visionKeyframeCheck(client, { readImage: async () => "data:image/png;base64," }).rank({ files: ["a", "b", "c"], brief: { image: { prompt: "p" } }, request: { shows: "a cup" } });
  assert.equal(ranked.best, 2);
  assert.equal(ranked.verdicts[0].ok, false);
  assert.equal(ranked.verdicts[0].reason, "six fingers");
});

test("--keyframe-candidates is 1 to the maximum", () => {
  assert.equal(parseKeyframeCandidates(null), null);
  assert.equal(parseKeyframeCandidates("3"), 3);
  assert.throws(() => parseKeyframeCandidates("0"), /1 to/);
  assert.throws(() => parseKeyframeCandidates(String(MAX_KEYFRAME_CANDIDATES + 1)), /1 to/);
});

test("skill path: generate check ranks several files; record keeps one round's candidates on one attempt", async (t) => {
  const dir = await project(t);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidates-files-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const files = await Promise.all([1, 2].map(async (i) => { const file = path.join(scratch, `c${i}.png`); await cp(PNG, file); return file; }));
  const client = { runStructured: async () => ({ value: { change: "", candidates: [
    { index: 1, shows_subject: true, has_text_or_logo: true, anomalies: false, look_match: 9, aesthetics: 9, finding: "text on the sign" },
    { index: 2, shows_subject: true, has_text_or_logo: false, anomalies: false, look_match: 7, aesthetics: 7, finding: "fine" }
  ] } }) };
  const ranked = await checkKeyframe(dir, { shot: "s1", file: files.join(",") }, { client });
  assert.equal(ranked.ok, true);
  assert.equal(ranked.chosen, 2);
  assert.equal(ranked.candidates[0].reason, "text on the sign");

  const base = { shot: "s1", step: "image", madeWith: "tool/model", licence: "terms", cost: "0.04usd", attempt: "1" };
  await recordShot(dir, { ...base, file: files[0], candidate: "1", verdict: "rejected", reason: "text on the sign" });
  const kept = await recordShot(dir, { ...base, file: files[1], candidate: "2" });
  assert.equal(kept.entry.attempt, 1);
  assert.equal(kept.entry.candidate, 2);
  await assert.rejects(recordShot(dir, { ...base, file: files[1], attempt: "3" }), /--attempt must be the round/);
});

test("concepts: each candidate is its own concept, one concepts call per batch, the rank judges each against its concept", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.04 });
  const prompts = [];
  const submit = fake.submit;
  fake.submit = (brief, step, ...rest) => { if (step === "image") prompts.push(brief.image.prompt); return submit(brief, step, ...rest); };
  const asked = [];
  const concepts = async (requests) => { asked.push(requests.map((r) => r.id)); return Object.assign(new Map(requests.map((r) => [r.id, ["a cup from above", "steam over a cup at dawn"]])), { audience: "night-shift nurses" }); };
  const seen = [];
  const check = async () => ({ ok: true });
  check.rank = async ({ files, concepts: given, audience }) => { seen.push(given, audience); return { best: 1, verdicts: files.map(() => ({ ok: true })), change: null }; };
  const generator = createGenerator({ project: dir, image: fake, video: fake, budget: { usd: 5 }, candidates: 2, concepts, check, pollMs: NO_POLL });
  const { request } = await one(dir, generator);
  assert.equal(asked.length, 1);
  assert.match(prompts[0], /^a cup from above\./);
  assert.match(prompts[1], /^steam over a cup at dawn\./);
  assert.deepEqual(seen, [["a cup from above", "steam over a cup at dawn"], "night-shift nurses"]);
  const stills = (await readLedger(dir)).filter((entry) => entry.shot === request.id && entry.step === "image");
  assert.deepEqual(stills.map((entry) => [entry.concept, entry.verdict]), [["a cup from above", "rejected"], ["steam over a cup at dawn", "accepted"]]);
});

test("audienceConcepts: one call for every shot; refused or missing concepts fall back to the shot's shows; a failed call writes none", async () => {
  let calls = 0;
  const client = { runStructured: async (call) => {
    calls += 1;
    assert.match(call.input, /Brief: coffee for night-shift nurses/);
    assert.match(call.input, /- s1: a cup of coffee/);
    return { value: { audience: "nurses", direction: "hospital break room, 3am", shots: [{ id: "s1", concepts: ["a paper cup on a break-room counter at 3am.", "a cup held by someone in Starbucks scrubs"] }] } };
  } };
  const notes = [];
  const ideas = await audienceConcepts(client, { count: 3, prompt: "coffee for night-shift nurses", notice: (line) => notes.push(line) })([{ id: "s1", shows: "a cup of coffee" }, { id: "s2", shows: "a clock" }]);
  assert.equal(calls, 1);
  assert.deepEqual(ideas.get("s1"), ["a paper cup on a break-room counter at 3am", "a cup of coffee", "a cup of coffee"]);
  assert.equal(ideas.has("s2"), false);
  assert.equal(ideas.audience, "nurses");
  assert.match(notes[0], /break room/);
  const failed = await audienceConcepts({ runStructured: async () => { throw new Error("down"); } }, { count: 2 })([{ id: "s1", shows: "a cup" }]);
  assert.equal(failed.size, 0);
});

test("the rank adds audience fit to the score and passes the audience and each concept to the model", async () => {
  const client = { runStructured: async (call) => {
    assert.match(call.input, /The audience: café owners/);
    assert.match(call.input, /Candidate 2's concept \(counts as the requested subject\): an owner counting the till/);
    return { value: { change: "", candidates: [
      { index: 1, shows_subject: true, has_text_or_logo: false, anomalies: false, look_match: 8, aesthetics: 8, audience_fit: 2, finding: "generic" },
      { index: 2, shows_subject: true, has_text_or_logo: false, anomalies: false, look_match: 7, aesthetics: 7, audience_fit: 9, finding: "their world" }
    ] } };
  } };
  const ranked = await visionKeyframeCheck(client, { readImage: async () => "data:image/png;base64," }).rank({ files: ["a", "b"], brief: { image: { prompt: "p" } }, request: { shows: "a café" }, concepts: ["a café counter", "an owner counting the till"], audience: "café owners" });
  assert.equal(ranked.best, 1);
});

test("skill path: generate check takes --audience and --concepts for the rank", async (t) => {
  const dir = await project(t);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidates-files-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const files = await Promise.all([1, 2].map(async (i) => { const file = path.join(scratch, `c${i}.png`); await cp(PNG, file); return file; }));
  let input = "";
  const client = { runStructured: async (call) => { input = call.input; return { value: { change: "", candidates: [1, 2].map((index) => ({ index, shows_subject: true, has_text_or_logo: false, anomalies: false, look_match: 5, aesthetics: 5, audience_fit: index * 4, finding: "ok" })) } }; } };
  const ranked = await checkKeyframe(dir, { shot: "s1", file: files.join(","), audience: "nurses", concepts: "a break-room cup | a cup at the nurses' station" }, { client });
  assert.equal(ranked.chosen, 2);
  assert.match(input, /The audience: nurses/);
  assert.match(input, /Candidate 2's concept \(counts as the requested subject\): a cup at the nurses' station/);
});
