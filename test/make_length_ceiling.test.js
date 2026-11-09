// The duration is a ceiling (docs/MAKE_SKILL_PARITY.md, phase 4): make trims
// a script that runs over and never pads one that runs short.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMake } from "../src/make/index.js";
import { CHAPTER_SECONDS, chapterNeedsResize, fitOutline, shareSpare, writeChapter } from "../src/make/long_form.js";
import { LENGTH_CEILING, needsResize, runsShort, writeScript } from "../src/make/script.js";
import { NARRATION, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const usage = { input_tokens: 3000, output_tokens: 900, total_tokens: 3900 };

test("a take is resized only when it runs over; a short one is reported, not padded", () => {
  assert.equal(needsResize(40, 30), true);
  assert.equal(needsResize(33, 30), false);
  assert.equal(needsResize(12, 30), false, "a short take is never resized");
  assert.equal(runsShort(12, 30), true);
  assert.equal(runsShort(27, 30), false);
  assert.equal(chapterNeedsResize(130, 90), true);
  assert.equal(chapterNeedsResize(40, 90), false, "a short chapter is never resized");
});

test("the outline's seconds are trimmed to the duration and never stretched to it", () => {
  const chapters = (seconds) => seconds.map((value, i) => ({ title: `Chapter ${i + 1}`, point: "A point", facts: ["a"], seconds: value }));
  const under = fitOutline({ title: "Thin", chapters: chapters([60, 90, 80]) }, 600);
  assert.deepEqual(under.chapters.map((chapter) => chapter.seconds), [60, 90, 80], "230 s of material stays 230 s in a 600 s slot");
  const over = fitOutline({ title: "Full", chapters: chapters([200, 400, 200]) }, 400);
  assert.ok(over.chapters.reduce((sum, chapter) => sum + chapter.seconds, 0) <= 400);
  for (const chapter of over.chapters) assert.ok(chapter.seconds >= CHAPTER_SECONDS.min && chapter.seconds <= CHAPTER_SECONDS.max);
});

test("a short chapter's spare seconds go to the later chapters with the most facts", () => {
  const chapters = [{ facts: ["a"] }, { facts: ["a", "b", "c"] }, { facts: [] }, { facts: ["a"] }];
  const slots = [60, 90, 60, 60];
  assert.equal(shareSpare(slots, chapters, 0, 40), 40);
  assert.deepEqual(slots, [60, 120, 60, 70], "three quarters to the chapter with three facts, none to the one with no facts");
  // A chapter is never pushed past the longest a chapter may run; what cannot be placed is dropped.
  const capped = [60, 170, 60, 175];
  assert.equal(shareSpare(capped, chapters, 0, 100), 15);
  assert.deepEqual(capped, [60, 180, 60, 180]);
  assert.equal(shareSpare([60, 60], [{ facts: ["a"] }, { facts: [] }], 0, 30), 0, "no later chapter has material: the video runs shorter");
  assert.equal(shareSpare([60, 60], chapters, 0, -5), 0);
  assert.equal(shareSpare([60, 60, 60, 60], chapters, 3, 30), 0, "the last chapter hands nothing on");
});

test("the script and chapter prompts state the ceiling", async () => {
  const inputs = [];
  const client = { provider: "openai", async runStructured(request) { inputs.push(request.input); return { model: "gpt-5.6-luna", usage, value: { title: "T", narration: NARRATION } }; } };
  await writeScript({ client, prompt: "A video", duration: 30 });
  assert.ok(inputs[0].includes(LENGTH_CEILING));
  const outline = { title: "T", chapters: [{ title: "One", point: "p", facts: [], seconds: 60 }, { title: "Two", point: "p", facts: [], seconds: 60 }] };
  await writeChapter({ client, prompt: "A video", outline, index: 1, words: 180, seconds: 75 });
  assert.match(inputs[1], /Its ceiling is about 180 words \(about 75 seconds read aloud\): stop when its point is made\./);
  assert.ok(inputs[1].includes(LENGTH_CEILING));
  await writeChapter({ client, prompt: "A video", outline, index: 1, words: 150, resize: { previous: "Old text.", measured_words: 300, measured_seconds: 120 } });
  assert.match(inputs[2], /should run at most about 60s\. Cut it to about 150 words/);
});

test("short form: a script that says less than the duration is kept, and the video runs shorter", async (t) => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-ceiling-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const fake = fakeModel();
  // 16 words against a 30 s target: the old path asked the model for about 80.
  const report = await runMake("A launch video for a fictional SaaS called Ledgerly that reconciles Stripe payouts automatically", { assets, duration: 30, voice: "test", music: "synth", cwd, out: "video" }, { env: {}, client: fake.model, inventory: fakeInventory, finish: fakeFinish([]), notice() {} });
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  const scripts = fake.calls.filter((call) => call.schemaName === "launchclip_make_script");
  assert.ok(!scripts.some((call) => /## Resize/.test(call.input)), "no resize pass adds words");
  assert.ok(!report.costs.items.some((item) => item.stage === "script-resize"));
  assert.ok(report.script.take.seconds < 15);
  assert.ok(report.script.take.short_of_target_seconds > 15);
  assert.ok(report.notices.some((line) => /the 30s target is a ceiling; nothing is padded/.test(line)));
  assert.ok(!report.script.check.warnings.includes("wpm-band"), "the script is checked at the length it runs, so it is not told to add words");
});

test("long form: chapters that come in short are not rewritten longer", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-ceiling-long-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const chapterInputs = [];
  const client = {
    provider: "openai",
    async runStructured(request) {
      if (request.schemaName === "launchclip_long_form_outline") return { model: "gpt-5.6-luna", usage, value: { title: "A thin month", title_options: ["A thin month"], chapters: [
        { title: "Cold open", point: "One launch", facts: ["Atlas 2 shipped October 6"], seconds: 60 },
        { title: "The scores", point: "What they mean", facts: ["81% on CodeBench", "a million tokens", "$15 to $4"], seconds: 90 },
        { title: "What's next", point: "What to watch", facts: [], seconds: 60 }
      ] } };
      if (request.schemaName === "launchclip_long_form_chapter") {
        chapterInputs.push(request.input);
        // Every chapter has about 40 words to say, whatever its ceiling.
        return { model: "gpt-5.6-luna", usage, value: { narration: Array.from({ length: 7 }, () => "Northwind shipped Atlas 2 on October 6.").join(" ") } };
      }
      return { model: "gpt-5.6-luna", usage, value: { states: [] } };
    }
  };
  const finish = async (project) => {
    await mkdir(path.join(project, "renders"), { recursive: true });
    await writeFile(path.join(project, "renders/draft.mp4"), "video");
    return { status: "done", seconds: 1, stages: [], gates: {}, final: path.join(project, "renders/draft.mp4"), warnings: [] };
  };
  const joinVoice = async (files, out) => { await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, "wav"); return out; };
  const lines = [];
  const report = await runMake("The biggest AI stories of October", { duration: 420, voice: "test", music: "synth", cwd, out: "october", longFormVisuals: "rules" }, { env: {}, client: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false }, inventory: async (dir) => ({ schema_version: "launchclip.make-assets.v1", dir, entries: [] }), finish, joinVoice, notice: (line) => lines.push(line) });
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.equal(chapterInputs.length, 3, "one call per chapter: no resize pass");
  assert.ok(!chapterInputs.some((input) => /## Resize/.test(input)));
  assert.ok(report.script.long_form.chapters.every((chapter) => chapter.passes === 1));
  // The outline had 210 s of material for a 420 s ceiling, and the chapters said less still.
  assert.ok(report.script.take.seconds < 100, `${report.script.take.seconds}s`);
  assert.ok(report.notices.some((line) => /the 420s target is a ceiling; nothing is padded/.test(line)));
  assert.ok(!report.warnings.some((line) => /the narration runs/.test(line)));
  // The first chapter's spare seconds went to the chapter with three facts, not the one with none.
  assert.ok(lines.some((line) => /chapter 1 ran [\d.]+s short; \d+s go to later chapters with more material/.test(line)), lines.filter((line) => line.startsWith("long form")).join("\n"));
  const targets = report.script.long_form.chapters.map((chapter) => chapter.target_seconds);
  assert.ok(targets[1] > 90 && targets[2] === 60, JSON.stringify(targets));
});
