// Long-form make (docs/LONG_FORM_MAKE_RFC.md, src/make/long_form.js): the
// outline fitted by tooling, chapter takes on one clock, and a 7-minute run
// end to end with a fake model, the test voice and a stub finish.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseScript } from "@launchclip/core/beat-director.mjs";
import { runMake } from "../src/make/index.js";
import { sameShape } from "../src/make/long_form_copy.js";
import { applyChoice, filesAllowed } from "../src/make/long_form_direct.js";
import { CHAPTER_SECONDS, LONG_FORM_VOICE, chapterCount, chapterId, chapterWords, fitOutline, joinTakes, narrationTail, scriptMarkdown } from "../src/make/long_form.js";
import { parseProgressLine } from "../src/progress.js";

test("tooling fits the outline: chapters scale to the duration, clamp, and drop when empty", () => {
  const fitted = fitOutline({ title: "The week in AI", title_options: ["The week in AI", "Three launches"], chapters: [
    { title: "Cold open", point: "Why this week mattered", facts: ["a"], seconds: 30 },
    { title: "Launch one", point: "What shipped", facts: [], seconds: 400 },
    { title: "", point: "no title", facts: [], seconds: 60 },
    { title: "Close", point: "What to watch", facts: [], seconds: 0 }
  ] }, 600);
  assert.deepEqual(fitted.chapters.map((chapter) => chapter.title), ["Cold open", "Launch one", "Close"]);
  for (const chapter of fitted.chapters) assert.ok(chapter.seconds >= CHAPTER_SECONDS.min && chapter.seconds <= CHAPTER_SECONDS.max, `${chapter.title}: ${chapter.seconds}`);
  assert.deepEqual(fitted.title_options, ["The week in AI", "Three launches"]);
  assert.throws(() => fitOutline({ title: "x", chapters: [{ title: "Only", point: "one" }] }, 600), /at least 2/);
  assert.equal(chapterCount(600), 7);
  assert.equal(chapterCount(200), 3);
  assert.equal(chapterCount(1200), 12);
  assert.equal(chapterWords(60, 180), 180);
  assert.equal(chapterId("What's next?", 2), "c3-what-s-next");
});

test("chapter takes join on one clock, with a gap, and SCRIPT.md parses back into chapters", () => {
  const joined = joinTakes([
    { id: "c1", title: "One", duration: 10, words: [{ text: "Hello.", start: 0.2, end: 0.8 }] },
    { id: "c2", title: "Two", duration: 5, words: [{ text: "Next.", start: 0.1, end: 0.5 }] }
  ], 0.6);
  assert.deepEqual(joined.words.map((word) => word.start), [0.2, 10.7]);
  assert.deepEqual(joined.chapters.map((chapter) => chapter.start), [0, 10.4]);
  assert.equal(joined.duration, 15.6);
  assert.equal(narrationTail("One. Two! Three? Four."), "Three? Four.");
  const parsed = parseScript(scriptMarkdown("Title", [{ title: "First part", narration: "Words here." }, { title: "Second part", narration: "More words." }]));
  assert.equal(parsed.title, "Title");
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.title), ["First part", "Second part"]);
});

const SENTENCES = ["Northwind shipped Atlas 2 on October 6.", "It scored 81 percent on CodeBench.", "Kestrel cut its price from 15 dollars to 4.", "Developers moved fast that week.", "Three labs answered within days.", "The context window doubled to a million tokens."];

function longFormModel() {
  const calls = [];
  const usage = { input_tokens: 3000, output_tokens: 900, total_tokens: 3900 };
  const client = {
    provider: "openai",
    async runStructured(request) {
      calls.push(request.schemaName);
      if (request.schemaName === "launchclip_long_form_outline") {
        return { model: "gpt-5.6-luna", usage, value: { title: "October in AI", title_options: ["October in AI", "Three launches that mattered"], chapters: [
          { title: "Cold open", point: "Atlas 2 changed the month", facts: ["Atlas 2 shipped October 6"], seconds: 60 },
          { title: "The benchmarks", point: "What the scores mean", facts: ["81% on CodeBench"], seconds: 150 },
          { title: "The price war", point: "Kestrel cut prices", facts: ["$15 to $4"], seconds: 120 },
          { title: "What's next", point: "What to watch", facts: [], seconds: 90 }
        ] } };
      }
      if (request.schemaName === "launchclip_long_form_direct") {
        // Clause by clause: a stat card where a figure is said, a hold, a made-up file and an unknown module (both refused), else the rule pick.
        const clauses = [...request.input.matchAll(/^### (\S+) \(.*\nNarration: (.*)\nRule pick: (.*)$/gm)].map((match) => ({ id: match[1], text: match[2], pick: match[3] }));
        const states = clauses.map((clause, i) => {
          if (i === 1) return { id: clause.id, action: "hold", module: "", params_json: "" };
          if (i === 2) return { id: clause.id, action: "new", module: "logo-row", params_json: JSON.stringify({ logos: [{ src: "assets/made-up.png", label: "A" }, { src: "assets/also-made-up.png", label: "B" }] }) };
          if (i === 3) return { id: clause.id, action: "new", module: "no-such-module", params_json: "{}" };
          if (/81 percent/.test(clause.text)) return { id: clause.id, action: "new", module: "stat-card", params_json: JSON.stringify({ value: "81%", label: "CodeBench score", source: "the notes" }) };
          const rule = /^(\S+) (\{.*\})$/.exec(clause.pick);
          return rule ? { id: clause.id, action: "new", module: rule[1], params_json: rule[2] } : { id: clause.id, action: "hold", module: "", params_json: "" };
        });
        return { model: "gpt-5.6-luna", usage, value: { states } };
      }
      if (request.schemaName === "launchclip_long_form_copy") {
        // Rewrite each card's first string; one answer breaks the timing and must be refused.
        const cards = [...request.input.matchAll(/^## (\S+) \(.*\n(?:.*\n){3}Params: (.*)$/gm)].map((match) => ({ id: match[1], params: JSON.parse(match[2]) }));
        const states = cards.map((card, i) => {
          const params = structuredClone(card.params);
          const key = Object.keys(params).find((name) => typeof params[name] === "string");
          if (key) params[key] = i === 0 ? params[key] : `${params[key]}`.slice(0, 12);
          if (i === 0) params.__extra = true;
          return { id: card.id, params_json: JSON.stringify(params) };
        });
        return { model: "gpt-5.6-luna", usage, value: { states } };
      }
      const words = Number(/about (\d+) words/.exec(request.input)?.[1] ?? 100);
      const text = [];
      while (text.join(" ").split(" ").length < words) text.push(SENTENCES[text.length % SENTENCES.length]);
      return { model: "gpt-5.6-luna", usage, value: { narration: text.join(" ") } };
    }
  };
  return { calls, model: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false } };
}

const emptyInventory = async (dir) => ({ schema_version: "launchclip.make-assets.v1", dir, entries: [] });

test("make writes, voices and plans a 7-minute video in chapters, and a rerun reuses every chapter", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-long-form-"));
  try {
    const { calls, model } = longFormModel();
    const joins = [];
    const finishes = [];
    const finish = async (project) => {
      finishes.push(project);
      await mkdir(path.join(project, "renders"), { recursive: true });
      await writeFile(path.join(project, "renders/draft.mp4"), "video");
      return { status: "done", seconds: 1, stages: [], gates: {}, final: path.join(project, "renders/draft.mp4"), warnings: [] };
    };
    const joinVoice = async (files, out) => { joins.push(files); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, "wav"); return out; };
    const lines = [];
    const adapters = { env: {}, client: model, inventory: emptyInventory, finish, joinVoice, notice: (line) => lines.push(line) };
    const report = await runMake("The biggest AI stories of October", { duration: 420, voice: "test", music: "synth", cwd, out: "october", longFormVisuals: "rules" }, adapters);
    const project = path.join(cwd, "october");
    assert.equal(report.status, "ready", JSON.stringify(report.stages));
    // Progress lines: each stage starts and ends, and each chapter is counted.
    const events = lines.map(parseProgressLine).filter(Boolean);
    assert.deepEqual(events.filter((event) => event.done !== undefined && !event.step).map((event) => event.stage), ["model", "inventory", "demo", "route", "prepare", "storyboard", "subject", "finish", "critic"]);
    assert.deepEqual(events.filter((event) => event.step === "chapter").map((event) => `${event.done}/${event.total}`), ["0/4", "1/4", "2/4", "3/4"]);
    assert.ok(events.some((event) => event.stage === "finish" && event.status === "done" && Number.isFinite(event.seconds)));
    assert.ok(lines.some((line) => line.startsWith("machine: ")), "the finish notice names the machine");
    assert.deepEqual(calls, ["launchclip_long_form_outline", "launchclip_long_form_chapter", "launchclip_long_form_chapter", "launchclip_long_form_chapter", "launchclip_long_form_chapter"].concat(calls.slice(5)));
    assert.equal(calls.filter((name) => name === "launchclip_long_form_outline").length, 1);
    assert.equal(report.script.long_form.chapters.length, 4);
    assert.equal(joins[0].length, 4, "one take per chapter, joined");

    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    assert.equal(story.audio.voice, LONG_FORM_VOICE);
    assert.equal(story.audio.narration, undefined, "finish mounts the joined take, it does not synthesise again");
    assert.equal(story.title, "October in AI");
    assert.deepEqual(story.chapters.map((chapter) => chapter.title), ["Cold open", "The benchmarks", "The price war", "What's next"]);
    assert.ok(story.scenes.length > 20, `${story.scenes.length} scenes`);
    assert.equal(story.camera?.mode, "world");
    const narration = JSON.parse(await readFile(path.join(project, "NARRATION.json"), "utf8"));
    assert.equal(narration.chapters.length, 4);
    for (let i = 1; i < narration.words.length; i += 1) assert.ok(narration.words[i].start >= narration.words[i - 1].start, "words on one clock");
    for (const file of ["SCRIPT.json", "SCRIPT.md", "BEATMAP.json", "DIRECTION.json"]) assert.ok(existsSync(path.join(project, file)), file);
    assert.equal(report.direction.source, "beat director");
    assert.ok(calls.includes("launchclip_long_form_copy"), "the copy pass ran");
    assert.ok(report.direction.copy.kept >= 1, "a rewrite that adds a key keeps the rule-made params");
    const map = JSON.parse(await readFile(path.join(project, "BEATMAP.json"), "utf8"));
    assert.ok(map.chunks.every((chunk) => chunk.copy), "every chunk is marked rewritten");
    assert.ok(report.costs.items.some((item) => item.stage === "outline"));

    // A rerun reuses the outline, every chapter and the plan: no model calls.
    const before = calls.length;
    const again = await runMake("The biggest AI stories of October", { duration: 420, voice: "test", music: "synth", cwd, out: "october", longFormVisuals: "rules" }, adapters);
    assert.equal(again.status, "ready");
    assert.equal(calls.length, before);
    assert.equal(again.stages.storyboard.status, "cached");
    assert.ok(again.script.long_form.chapters.every((chapter) => chapter.reused));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a copy rewrite keeps the planner's structure: same keys, same items, same timings", () => {
  const before = { title: "Lineage", steps: [{ label: "More", at: 1.2 }, { label: "Remember", at: 2.4 }] };
  assert.ok(sameShape(before, { title: "Halcyon's lineage", steps: [{ label: "Bigger", at: 1.2 }, { label: "Longer memory", at: 2.4 }] }));
  assert.ok(!sameShape(before, { title: "x", steps: [{ label: "a", at: 1.5 }, { label: "b", at: 2.4 }] }), "a moved at");
  assert.ok(!sameShape(before, { title: "x", steps: [{ label: "a", at: 1.2 }] }), "a dropped item");
  assert.ok(!sameShape(before, { title: "x", steps: before.steps, extra: 1 }), "an added key");
  assert.ok(!sameShape({ value: 3 }, { value: "3" }), "a number stays a number");
});

test("a failed finish keeps the command's stderr, not only the command line", async () => {
  const { errorSummary } = await import("../src/make/index.js");
  const error = ["Command failed: node synth-audio-kit.mjs kit --bed 36.8", ...Array.from({ length: 20 }, (_, i) => `    at frame ${i}`), "RangeError: Invalid array length"].join("\n");
  const summary = errorSummary(error);
  assert.match(summary, /^Command failed: node synth-audio-kit/);
  assert.match(summary, /RangeError: Invalid array length$/);
  assert.ok(summary.split("\n").length <= 8);
  assert.equal(errorSummary("one line"), "one line");
});

test("by default the model directs every long-form card on the beat director's clock", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-long-form-direct-"));
  try {
    const { calls, model } = longFormModel();
    const finish = async (project) => {
      await mkdir(path.join(project, "renders"), { recursive: true });
      await writeFile(path.join(project, "renders/draft.mp4"), "video");
      return { status: "done", seconds: 1, stages: [], gates: {}, final: path.join(project, "renders/draft.mp4"), warnings: [] };
    };
    const joinVoice = async (files, out) => { await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, "wav"); return out; };
    const adapters = { env: {}, client: model, inventory: emptyInventory, finish, joinVoice, notice: () => {} };
    const report = await runMake("The biggest AI stories of October", { duration: 420, voice: "test", music: "synth", cwd, out: "october" }, adapters);
    assert.equal(report.status, "ready", JSON.stringify(report.stages));
    const project = path.join(cwd, "october");
    const map = JSON.parse(await readFile(path.join(project, "BEATMAP.json"), "utf8"));
    assert.equal(report.direction.source, "model on the beat director's clock");
    assert.equal(calls.filter((name) => name === "launchclip_long_form_direct").length, map.chunks.length, "one direct call per chunk");
    assert.ok(!calls.includes("launchclip_long_form_copy"), "directed chunks need no copy pass");
    assert.ok(map.chunks.every((chunk) => chunk.directed));
    const { directed, held, kept, failed } = report.direction.direct;
    assert.equal(failed, 0);
    assert.ok(directed > 0 && held >= map.chunks.length, `directed ${directed}, held ${held}`);
    assert.ok(kept >= map.chunks.length * 2, "a made-up file and an unknown module keep the rule-made card");
    const states = map.chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
    assert.ok(states.some((state) => state.module === "stat-card" && state.params.value === "81%"), "the said figure became a stat card");
    assert.ok(!states.some((state) => state.module === "no-such-module" || JSON.stringify(state.params ?? {}).includes("made-up")));
    assert.equal(typeof report.direction.typography_share, "number");
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    assert.ok(story.scenes.some((scene) => scene.module === "stat-card"));
    assert.ok(report.costs.items.some((item) => item.stage.startsWith("direct-")));

    // A rerun reuses every directed chunk: no model calls.
    const before = calls.length;
    const again = await runMake("The biggest AI stories of October", { duration: 420, voice: "test", music: "synth", cwd, out: "october" }, adapters);
    assert.equal(again.stages.storyboard.status, "cached");
    assert.equal(calls.length, before);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a clause's choice: a new card must fit its module and name only the video's files", () => {
  const state = { id: "s1", module: "motion-title", params: { text: "Atlas 2" }, change: "hold", start: 0, end: 4, zooms: [{ at: 1 }] };
  const known = new Set(["stat-card", "logo-row"]);
  const format = { width: 1920, height: 1080 };
  assert.equal(applyChoice({ ...state }, undefined, null, { known, format }), "kept");
  assert.equal(applyChoice({ ...state }, { action: "new", module: "stat-card", params_json: "not json" }, null, { known, format }), "kept");
  assert.equal(applyChoice({ ...state }, { action: "new", module: "stat-card", params_json: JSON.stringify({ value: "81%" }) }, null, { known, format }), "kept", "a card its module rejects");
  const next = { ...state };
  assert.equal(applyChoice(next, { action: "new", module: "stat-card", params_json: JSON.stringify({ value: "81%", label: "CodeBench", source: "Northwind" }) }, null, { known, format }), "directed");
  assert.equal(next.module, "stat-card");
  assert.equal(next.change, "swap", "a rule-made hold becomes a new card");
  assert.equal(next.zooms, undefined, "the rule card's zooms go with it");
  const held = { ...state, change: "swap" };
  assert.equal(applyChoice(held, { action: "hold" }, next, { known, format }), "held");
  assert.equal(held.module, "stat-card");
  assert.equal(held.change, "hold");
  assert.equal(applyChoice({ ...state }, { action: "hold" }, null, { known, format }), "kept", "nothing before to hold");
  assert.equal(filesAllowed({ logos: [{ src: "assets/a.png" }] }, new Set(["assets/a.png"])), true);
  assert.equal(filesAllowed({ logos: [{ src: "assets/b.png" }] }, new Set(["assets/a.png"])), false);
  assert.equal(filesAllowed({ media: { src: "https://example.com/x.mp4" } }, new Set()), false);
});
