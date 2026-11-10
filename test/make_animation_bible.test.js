// launchclip make --animation, phase 6 (docs/ANIMATION_PIPELINE_RFC.md §9):
// the show bible stage, the shot list planned with the bible pinned, and the
// approval stop. No test here calls a model: every response is a fixture in
// test/fixtures/make-animation/, served by a stub client
// (test/helpers/make_animation.js). The reference sheets are drawn by a
// stand-in, and finish is a stand-in too: these tests read the files the
// stages before it wrote.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bibleCast, validateBible } from "@launchclip/core/bible.mjs";
import { freezeBible, bibleGate, readBible } from "../src/bible.js";
import { castGate } from "../src/cast.js";
import { plannedCast, fitDirectionCast } from "../src/cast_fit.js";
import { saveCharacter } from "../src/character_store.js";
import { parseFlags } from "../src/cli.js";
import { formatMakeSummary } from "../src/make/index.js";
import { approvals, makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";
import { BIBLE_DESIGN_SCHEMA, DEFAULT_DRAWING_STYLE, DESIGN_PATHS, animationBriefLines, makeBible, normalizeBibleDesign } from "../src/make/show_bible.js";
import { readProjectStory } from "../src/story_loader.js";
import { runStoryCommand } from "../src/story_cli.js";
import { fixture, room, schemas } from "./helpers/make_animation.js";

const text = (file) => readFile(file, "utf8");

test("make --animation designs and freezes a show bible, then plans a storyboard that passes story validate, the cast gate and the bible gate", async () => {
  const t = await room();
  try {
    const report = await t.make();
    assert.equal(report.status, "ready", JSON.stringify(report.stages));
    assert.deepEqual(schemas(t.calls), ["premise", "loglines", "script", "bible", "direction", "storyboard"]);
    assert.equal(report.stages.bible.status, "done");
    assert.equal(report.stages.storyboard.status, "done");
    assert.equal(report.stages.finish.status, "done", "the animation path runs through to finish");
    assert.deepEqual(t.finished, [t.project]);
    assert.ok(report.costs.items.some((item) => item.stage === "bible" && item.estimated_usd > 0));
    assert.ok(t.notices.some((line) => /PAID call to openai gpt-5\.6-luna \(show bible: the cast of 2 and the world\)/.test(line)));

    // The designer's call: one structured call, the rig's own options, the default look.
    const design = t.calls[3];
    assert.equal(design.schema, BIBLE_DESIGN_SCHEMA);
    assert.match(design.instructions, /cute, relatable and simply dressed/);
    assert.match(design.instructions, new RegExp(`"" keeps the default \\(${DEFAULT_DRAWING_STYLE}\\)`));
    assert.match(design.input, /Maya keeps shipping a fix that fails/);
    assert.match(design.input, /- maya: lead; wants to ship; speaks short, dry; a female voice \[shares its id with the starter "maya"/);
    assert.match(design.input, /- hair\.style: bald, buzz, short/);
    assert.match(design.input, /- theo: /, "the starters are offered by id");
    assert.doesNotMatch(design.input, /^- (voice|style|name): /m, "the voice, the drawing style and the name are tooling's");

    // BIBLE.json: frozen, valid against the script, drawn chibi, a sheet each.
    const { bible, check } = await readBible(t.project);
    assert.deepEqual(check.errors, []);
    assert.equal(bible.frozen, true);
    assert.equal(bible.cast.style, "chibi");
    assert.deepEqual(bible.style, { pack: report.style.name, seed: report.style.seed, drawing_style: "chibi" });
    assert.deepEqual(bible.cast.characters.map((entry) => [entry.id, entry.position, entry.sheet]), [["maya", "left", "bible/sheets/maya.png"], ["sam", "right", "bible/sheets/sam.png"]], "two characters asked for the left: the second takes the right");
    assert.deepEqual(t.sheets.map((file) => path.relative(t.project, file)), ["bible/sheets/maya.png", "bible/sheets/sam.png"]);
    const [maya, sam] = bible.cast.characters;
    assert.deepEqual([maya.hair, maya.outfit.top, maya.colors.top, maya.accessories], [{ style: "bob", color: "auburn" }, "sweater", "teal", ["round-glasses"]]);
    assert.ok(maya.must_keep.includes("auburn bob hair") && maya.must_keep.includes("round glasses"));
    assert.deepEqual([sam.outfit.top, sam.colors.top, sam.headwear], ["hoodie", "mustard", undefined], "an option the rig lacks is left out");
    assert.ok(report.warnings.some((warning) => /bible: the rig has no headwear=crown for sam; left out/.test(warning)));
    assert.deepEqual(bible.world, { kind: "office", time: "day", sets: ["desk-laptop", "standing"] }, "a set the kit lacks is dropped");
    assert.deepEqual(bible.rules, ["Sam never raises his voice."]);
    assert.equal(validateBible(bible, { script: await t.read("SCRIPT.json") }).ok, true);
    assert.equal(report.bible.hash, bible.hash);
    assert.equal(report.bible.source, "designed");
    assert.deepEqual(report.bible.characters.map((entry) => entry.designed.source), ["starter", "starter"]);
    // The voices are the ones the script was voiced in: the take stands.
    assert.deepEqual(bible.cast.characters.map((entry) => entry.voice), ["af_bella", "am_michael"]);
    assert.equal(t.takes.length, 8, "designing the cast does not voice the script again");

    // The brief the planner reads: the screenplay with its line ids, and the bible.
    const brief = await text(path.join(t.project, "BRIEF.md"));
    assert.match(brief, /## Screenplay \(SCRIPT\.json/);
    assert.match(brief, /- l3 sam: Did you run the check\? \(playing: gentle\)/);
    assert.match(brief, /- l4 \[silent, 1\.2s\] Maya turns to look at Sam\./);
    assert.match(brief, /- maya \(Maya\), stands left: lead; wants to ship; speaks short, dry\. Look: auburn bob hair/);
    assert.match(brief, /- World: office, day\. Sets: desk-laptop, standing\./);
    assert.match(brief, /- Rule: Sam never raises his voice\./);
    assert.doesNotMatch(brief, /undefined/);
    assert.match(t.calls[4].instructions, /Cue ids and action\.who name characters of the story cast only: "maya" \(Maya\), "sam" \(Sam\)/);
    assert.match(t.calls[5].instructions, /## Show bible \(frozen\)/);
    assert.match(t.calls[5].input, new RegExp(`bible: \\{"file":"BIBLE.json","hash":"${bible.hash}"\\}`));

    // storyboard.json and DIRECTION.json name the bible; the cast is the bible's, whatever the model wrote.
    const story = await t.read("storyboard.json");
    const direction = await t.read("DIRECTION.json");
    assert.deepEqual(story.bible, { file: "BIBLE.json", hash: bible.hash });
    assert.deepEqual(direction.bible, { file: "BIBLE.json", hash: bible.hash });
    assert.deepEqual(story.cast, bibleCast(bible), "the fixture's storyboard lists a third character and another drawing style");
    const plan = await t.read(".launchclip/storyboard-plan.json");
    assert.ok(plan.warnings.some((warning) => /cast was changed by the model and has been reset to the show bible's cast/.test(warning)));
    assert.equal(direction.sections[0].lines[0].cast[0].id, "maya", "a cue that spells a bible character by name takes its id");
    assert.deepEqual(direction.sections.flatMap((section) => section.lines.map((line) => line.line)), ["l1", "l2", "l3", "l5", "l6", "l8", "l9", "l10"]);
    assert.equal(story.audio.narration.lines.length, 8);
    assert.deepEqual([story.world.kind, story.world.time], ["office", "day"], "the story's place is the bible's, not the seeded style's");

    // The three checks the phase is done by.
    const validated = await runStoryCommand("validate", path.join(t.project, "storyboard.json"));
    assert.deepEqual(validated.errors ?? [], [], JSON.stringify(validated).slice(0, 600));
    assert.equal(validated.status, "passed");
    const { resolved } = await readProjectStory(t.project);
    const cast = castGate(resolved, { direction });
    assert.equal(cast.status, "passed", JSON.stringify(cast.findings));
    const gate = await bibleGate(t.project, resolved, { direction });
    assert.equal(gate.status, "passed", JSON.stringify(gate.findings));
    assert.deepEqual(gate.characters, ["maya", "sam"]);

    // A rerun reuses the bible and the plan: no call, no sheet, the same files.
    const before = { calls: t.calls.length, sheets: t.sheets.length, bible: await text(path.join(t.project, "BIBLE.json")), story: await text(path.join(t.project, "storyboard.json")), script: await text(path.join(t.project, "SCRIPT.json")) };
    const again = await t.make();
    assert.equal(again.status, "ready");
    assert.deepEqual([again.stages.prepare.status, again.stages.bible.status, again.stages.storyboard.status], ["cached", "cached", "cached"]);
    assert.equal(again.bible.source, "reused");
    assert.equal(t.calls.length, before.calls);
    assert.equal(t.sheets.length, before.sheets);
    assert.equal(await text(path.join(t.project, "BIBLE.json")), before.bible);
    assert.equal(await text(path.join(t.project, "storyboard.json")), before.story);
    assert.equal(await text(path.join(t.project, "SCRIPT.json")), before.script);
  } finally {
    await t.done();
  }
});

test("a replan cannot change who is in the story", async () => {
  // The second storyboard answer recasts the story: other people, another style, a look written in.
  const recast = await fixture("storyboard");
  recast.cast = { style: "outlined", characters: [{ id: "maya", skin: "deep", hair: { style: "afro", color: "black" } }, { id: "theo" }] };
  delete recast.bible;
  const t = await room({ storyboards: ["storyboard", recast] });
  try {
    await t.make();
    const bible = await t.read("BIBLE.json");
    const first = await t.read("storyboard.json");
    const calls = t.calls.length;
    const report = await t.make({ replan: true });
    assert.equal(report.status, "ready", JSON.stringify(report.stages));
    assert.deepEqual(schemas(t.calls).slice(calls), ["direction", "storyboard"], "a replan plans new shots; it does not design a new cast");
    assert.equal(report.stages.bible.status, "cached");
    assert.equal((await t.read("BIBLE.json")).hash, bible.hash);
    const story = await t.read("storyboard.json");
    assert.deepEqual(story.cast, first.cast);
    assert.deepEqual(story.cast, bibleCast(bible));
    assert.deepEqual(story.bible, { file: "BIBLE.json", hash: bible.hash });
    const plan = await t.read(".launchclip/storyboard-plan.json");
    assert.ok(plan.warnings.some((warning) => /reset to the show bible's cast: a plan cannot change who is in the story/.test(warning)));
    const { resolved } = await readProjectStory(t.project);
    assert.equal((await bibleGate(t.project, resolved, { direction: await t.read("DIRECTION.json") })).status, "passed");

    // The cast gate runs inside the plan, so a repair fixes what finish would have failed: here a chibi head off the top of a wide desk shot.
    const o = await room({ storyboards: ["storyboard-off-canvas", "storyboard"] });
    try {
      const fixed = await o.make();
      assert.equal(fixed.status, "ready", JSON.stringify(fixed.stages));
      assert.equal(fixed.repairs.used, 1);
      assert.match(fixed.repairs.attempts[0].errors.join("\n"), /^cast: maya in desk reaches (off the canvas|out of the safe zone)/);
      assert.match(o.calls.at(-1).input, /## Repair 1 of 4[\s\S]*cast: maya in desk reaches/);
    } finally {
      await o.done();
    }

    // A scene that casts someone outside the bible fails the plan's checks; it is never added to the cast.
    const stranger = await fixture("storyboard");
    stranger.scenes[3].params.cast[1].id = "theo";
    const s = await room({ storyboards: [stranger, "storyboard"] });
    try {
      const repaired = await s.make();
      assert.equal(repaired.status, "ready", JSON.stringify(repaired.stages));
      assert.equal(repaired.repairs.used, 1);
      assert.match(repaired.repairs.attempts[0].errors.join("\n"), /theo/);
      assert.deepEqual((await s.read("storyboard.json")).cast.characters.map((entry) => entry.id), ["maya", "sam"]);
    } finally {
      await s.done();
    }
  } finally {
    await t.done();
  }
});

test("--stop-after bible ends awaiting-approval, and --approve bible resumes from there", async () => {
  const t = await room();
  try {
    const stopped = await t.make({ stopAfter: "bible" });
    assert.equal(stopped.status, "awaiting-approval", JSON.stringify(stopped.stages));
    assert.deepEqual(stopped.stopped, { after: "bible", reason: "stopped for approval of the show bible (--stop-after bible)" });
    assert.equal(stopped.stages.bible.status, "done");
    for (const stage of ["storyboard", "candidates", "subject", "finish", "critic"]) assert.equal(stopped.stages[stage].status, "skipped", stage);
    assert.equal(stopped.bible.approved, false);
    assert.match(stopped.next_steps.at(-1), /reference sheets in .*bible\/sheets/);
    assert.match(stopped.next_steps.at(-1), /--approve bible/);
    assert.match(stopped.next_steps.at(-1), /launchclip cast edit <id>/);
    assert.match(formatMakeSummary(stopped), /launchclip make: awaiting-approval/);
    assert.ok(existsSync(path.join(t.project, "BIBLE.json")));
    assert.ok(!existsSync(path.join(t.project, "storyboard.json")));
    assert.deepEqual(t.finished, []);
    assert.deepEqual(schemas(t.calls), ["premise", "loglines", "script", "bible"]);

    // Asked to stop again without an approval, it stops again, and spends nothing.
    const still = await t.make({ stopAfter: "bible" });
    assert.equal(still.status, "awaiting-approval");
    assert.equal(t.calls.length, 4);

    // --approve bible: every earlier stage is reused, and the run goes on to the shot list and finish.
    const resumed = await t.make({ stopAfter: "bible", approve: "bible" });
    assert.equal(resumed.status, "ready", JSON.stringify(resumed.stages));
    assert.deepEqual([resumed.stages.prepare.status, resumed.stages.bible.status, resumed.stages.storyboard.status, resumed.stages.finish.status], ["cached", "cached", "done", "done"]);
    assert.equal(resumed.bible.approved, true);
    assert.equal(resumed.bible.hash, stopped.bible.hash);
    assert.deepEqual(schemas(t.calls).slice(4), ["direction", "storyboard"]);
    assert.equal(resumed.stopped, undefined);
    assert.deepEqual(t.finished, [t.project]);

    // The approval is of this bible: the same command without --approve goes on too.
    const after = await t.make({ stopAfter: "bible" });
    assert.equal(after.status, "ready");
    assert.equal(t.calls.length, 6);
  } finally {
    await t.done();
  }
});

test("an attended run asks before the shots are planned; a headless one goes on", async () => {
  const t = await room();
  try {
    const asked = [];
    t.adapters.ask = async (question) => { asked.push(question); return false; };
    const no = await t.make();
    assert.equal(no.status, "awaiting-approval");
    assert.match(asked[0], /look at the reference sheets in .*bible\/sheets.*Plan the shots with this cast\?/);
    t.adapters.ask = async (question) => { asked.push(question); return true; };
    const yes = await t.make();
    assert.equal(yes.status, "ready", JSON.stringify(yes.stages));
    assert.equal(yes.bible.approved, true);
    assert.equal(asked.length, 2);
    // Approved once, this bible is not asked about again.
    await t.make();
    assert.equal(asked.length, 2);
  } finally {
    await t.done();
  }
});

test("a bible somebody froze in the project is used as it is, and one that does not fit the script stops the run", async () => {
  const t = await room();
  try {
    const first = await t.make({ stopAfter: "bible" });
    // The person redesigns the cast between the stop and the approval: the starters as they are, outlined.
    const frozen = await freezeBible(t.project, { characters: "maya,sam", style: "outlined", force: true }, { render: t.adapters.renderSheet, home: t.adapters.home });
    assert.notEqual(frozen.hash, first.bible.hash);
    const calls = t.calls.length;
    const report = await t.make({ approve: "bible" });
    assert.equal(report.status, "ready", JSON.stringify(report.stages));
    assert.equal(report.bible.source, "project");
    assert.equal(report.bible.hash, frozen.hash);
    assert.equal(report.bible.style, "outlined");
    assert.ok(!schemas(t.calls).slice(calls).includes("bible"), "make designs a cast only when there is none");
    assert.ok(t.notices.some((line) => /bible: using the frozen BIBLE\.json in the project/.test(line)));
    const story = await t.read("storyboard.json");
    assert.equal(story.cast.style, "outlined");
    assert.deepEqual(story.bible, { file: "BIBLE.json", hash: frozen.hash });
    // It stays theirs on the next run, whatever the brief hash says.
    const again = await t.make();
    assert.equal(again.bible.hash, frozen.hash);
    assert.equal(again.stages.bible.status, "cached");

    // A frozen bible of theirs that is no longer valid (a sheet is gone) is not overwritten: the run says what to do.
    await rm(path.join(t.project, "bible/sheets/sam.png"));
    const refused = await t.make();
    assert.equal(refused.status, "failed");
    assert.equal(refused.failed_stage, "bible");
    assert.match(refused.stages.bible.error, /BIBLE\.json is frozen but is not valid for this project:\n- .*bible\/sheets\/sam\.png does not exist/);
    assert.equal((await t.read("BIBLE.json")).hash, frozen.hash);
    assert.match(refused.next_steps[0], /launchclip bible freeze/);
  } finally {
    await t.done();
  }
});

test("a style pack's drawing style is the cast's; a designer's choice is taken only when no pack sets one", async () => {
  const answer = { ...(await fixture("bible")), drawing_style: "paper" };
  const t = await room({ bible: answer });
  try {
    const report = await t.make({ stopAfter: "bible" });
    assert.equal(report.bible.style, "paper", "the brief asked for a drawing style, so the designer named it");
  } finally {
    await t.done();
  }
  const p = await room({ bible: answer });
  try {
    const pack = path.join(p.cwd, "house.json");
    await writeFile(pack, JSON.stringify({ schema: "launchclip.style.v2", name: "house", version: 3, cast: { drawing_style: "outlined" } }));
    const report = await p.make({ stopAfter: "bible", style: pack });
    assert.equal(report.status, "awaiting-approval", JSON.stringify(report.stages));
    assert.equal(report.bible.style, "outlined");
    assert.match(p.calls[3].input, /The drawing style is fixed by the style pack: outlined\./);
  } finally {
    await p.done();
  }
});

test("the cast from a design: a new character goes through the cast create door, a starter is kept or changed, a saved one is the user's", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-bible-design-"));
  const home = path.join(project, "home");
  try {
    await mkdir(project, { recursive: true });
    const script = { schema_version: "launchclip.make-script.v2", title: "T", characters: [{ id: "zed", name: "Zed", role: "lead" }, { id: "maya", role: "foil" }, { id: "ria", role: "boss" }, { id: "kit", role: "friend" }], beats: [{ beat: "setup", place: "sofa", lines: [{ id: "l1", speaker: "zed", text: "Hi." }, { id: "l2", speaker: "maya", text: "Hi." }, { id: "l3", speaker: "ria", text: "Hi." }, { id: "l4", speaker: "kit", text: "Hi." }] }] };
    await writeFile(path.join(project, "SCRIPT.json"), JSON.stringify(script));
    // "ria" was designed by the user before the run.
    await saveCharacter({ schema: "launchclip.character.v1", id: "ria", name: "Ria", style: "flat", voice: "bf_lily", params: { skin: "tan", hair: { style: "bun", color: "black" }, outfit: { top: "blazer" } } }, { projectDir: project, home });
    const design = normalizeBibleDesign({
      characters: [
        { id: "Zed", use: "", position: "right", sets: [{ path: "skin", op: "=", value: "golden" }, { path: "hair.style", op: "=", value: "quiff" }, { path: "hair.color", op: "=", value: "blonde" }, { path: "outfit.top", op: "=", value: "tee" }, { path: "colors.top", op: "=", value: "coral" }, { path: "voice", op: "=", value: "am_santa" }, { path: "outfit.top", op: "=", value: "tuxedo" }] },
        { id: "maya", use: "theo", position: "right", sets: [] },
        { id: "ria", use: "", position: "", sets: [{ path: "outfit.top", op: "=", value: "tee" }] },
        { id: "kit", use: "amara", position: "", sets: [{ path: "outfit.top", op: "=", value: "hoodie" }] },
        { id: "ghost", use: "", position: "left", sets: [] }
      ],
      drawing_style: "watercolour", world: { kind: "moon", time: "noon" }, sets: ["stage", "nowhere", "car", "phone", "podium"], rules: ["One.", "", "Two.", "Three.", "Four."]
    }, { characters: script.characters, places: ["sofa"], prompt: "two friends in the kitchen at night" });
    assert.deepEqual(design.characters.map((entry) => [entry.id, entry.use, entry.position]), [["zed", null, "right"], ["maya", "theo", "left"], ["ria", null, "centre"], ["kit", "amara", null]], "a side each, three at most");
    assert.deepEqual(design.characters[0].sets.map((set) => `${set.path}${set.op}${set.value}`), ["skin=golden", "hair.style=quiff", "hair.color=blonde", "outfit.top=tee", "colors.top=coral"]);
    assert.deepEqual(design.characters[0].rejected.map((set) => set.value), ["tuxedo"], "the voice is not the designer's to set; an option the rig lacks is named");
    assert.equal(design.drawing_style, null);
    assert.deepEqual(design.world, { kind: "kitchen", time: "day" }, "a world the kit lacks falls back to the brief's own words");
    assert.deepEqual(design.sets, ["sofa", "stage", "car"]);
    assert.deepEqual(design.rules, ["One.", "Two.", "Three."]);
    assert.ok(!DESIGN_PATHS.includes("voice") && !DESIGN_PATHS.includes("style") && DESIGN_PATHS.includes("hair.style"));

    const sheets = [];
    const voices = new Map([["zed", "am_michael"], ["maya", "af_bella"], ["ria", "bf_emma"], ["kit", "af_nova"]]);
    const made = await makeBible({ project, script, design, style: "chibi", voices, narratorVoice: "af_heart" }, { home, render: async (html, png) => { sheets.push(png); await writeFile(png, "png"); } });
    assert.deepEqual(made.characters.map((entry) => [entry.id, entry.source, entry.from ?? null, entry.file ?? null]), [["zed", "designed", null, "cast/zed.character.json"], ["maya", "starter", "theo", null], ["ria", "saved", null, "cast/ria.character.json"], ["kit", "starter", "amara", "cast/kit.character.json"]]);
    // The new character: a saved file, in the bible's drawing style, with the chosen look.
    const zed = JSON.parse(await text(path.join(project, "cast/zed.character.json")));
    assert.deepEqual([zed.schema, zed.name, zed.style, zed.voice, zed.params.skin, zed.params.hair, zed.params.outfit.top, zed.params.colors.top], ["launchclip.character.v1", "Zed", "chibi", "am_michael", "golden", { style: "quiff", color: "blonde" }, "tee", "coral"]);
    const { bible, check } = await readBible(project, { home });
    assert.deepEqual(check.errors, []);
    const byId = Object.fromEntries(bible.cast.characters.map((entry) => [entry.id, entry]));
    assert.equal(byId.zed.character_file, "cast/zed.character.json");
    // "maya" played by the starter Theo: his look under her id and name, and no file (a starter id is not a saved character's).
    assert.deepEqual([byId.maya.hair, byId.maya.outfit.top, byId.maya.accessories, byId.maya.character_file], [{ style: "short", color: "brown" }, "tee", ["glasses"], undefined]);
    // The user's own character: its look and its voice, not the designer's sets.
    assert.deepEqual([byId.ria.outfit.top, byId.ria.voice, byId.ria.character_file], ["blazer", "bf_lily", "cast/ria.character.json"]);
    // A new id started from a starter, with a change.
    assert.deepEqual([byId.kit.hair.style, byId.kit.outfit.top, byId.kit.voice], ["braids", "hoodie", "af_nova"]);
    assert.equal(new Set(bible.cast.characters.map((entry) => entry.voice)).size, 4, "every character has a voice of its own");
    assert.equal(sheets.length, 4);
    assert.equal(bible.cast.style, "chibi");

    // The brief lines read the same bible.
    const lines = animationBriefLines({ script, bible }).join("\n");
    assert.match(lines, /setup \(place: sofa\):\n- l1 zed: Hi\./);
    assert.match(lines, /- zed \(Zed\), stands right: lead\. Look: blonde quiff hair, golden skin, coral tee/);
    assert.match(lines, /no shot longer than about six seconds/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("the planner's cast fit takes a frozen bible first and never renames it", async () => {
  const t = await room();
  try {
    await t.make({ stopAfter: "bible" });
    const bible = await t.read("BIBLE.json");
    const seeded = { generated: { seed: "1" }, cast: { drawing_style: "flat", members: [{ id: "p1", skin: "tan", hair: { style: "short", color: "black" } }] } };
    const planned = plannedCast({ story: { cast: { characters: [{ id: "theo" }] } }, style: seeded, bible });
    assert.equal(planned.source, "bible");
    assert.equal(planned.bindable, false);
    assert.deepEqual(planned.cast, bibleCast(bible));
    assert.equal(plannedCast({ style: seeded, bible: { ...bible, frozen: false } }).source, "style", "a draft bible pins nothing");
    const map = { sections: [{ lines: [{ cast: [{ id: "MAYA", pose: "stand" }, { id: "Mia", pose: "stand" }], action: { verb: "wave", who: "Sam", target: "maya" } }] }] };
    const fit = fitDirectionCast(map, { cast: planned, words: [] });
    assert.deepEqual(fit.map.sections[0].lines[0].cast.map((cue) => cue.id), ["maya", "Mia"], "a name the bible has takes its id; one it lacks is left for the checks to name");
    assert.equal(fit.map.sections[0].lines[0].action.who, "sam");
    assert.deepEqual(fit.bound, []);
    assert.deepEqual(fit.cast, bibleCast(bible));
  } finally {
    await t.done();
  }
});

test("--stop-after and --approve: the flags, their values and the CLI's parse", () => {
  assert.deepEqual(parseFlags(["--stop-after", "bible", "--approve", "bible", "--animation"]), { "stop-after": "bible", approve: "bible", animation: true });
  assert.deepEqual(parseFlags(["--approve", "--json"]), { approve: true, json: true }, "elsewhere --approve stays a switch");
  const options = makeOptionsFromFlags({ "stop-after": "bible", approve: "bible" });
  assert.deepEqual([options.stopAfter, options.approve], ["bible", "bible"]);
  assert.deepEqual(approvals("Bible, bible"), ["bible"]);
  assert.deepEqual(approvals(undefined), []);
  assert.doesNotThrow(() => validateMakeOptions({ stopAfter: "bible", approve: ["bible"] }));
  assert.throws(() => validateMakeOptions({ stopAfter: "storyboard" }), /--stop-after must be bible; got storyboard/);
  assert.throws(() => validateMakeOptions({ approve: "script" }), /--approve must be bible; got script/);
  assert.throws(() => validateMakeOptions({ approve: true }), /--approve names what is approved: --approve bible/);
});

test("a video that is not a character story skips the bible stage", async () => {
  const { runMake } = await import("../src/make/index.js");
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-nobible-"));
  try {
    // The model stage passes and the script call fails: enough to see the stage list.
    const client = { provider: "openai", async runStructured() { throw new Error("no model in this test"); } };
    const report = await runMake("A 20-second explainer about caching", { cwd, out: "v", voice: "test", stopAfter: "bible" }, { env: {}, client: { client, provider: "openai", model: "m", spec: "openai:m", vision: false }, notice() {} });
    assert.equal(report.failed_stage, "prepare");
    assert.ok(!("bible" in report.stages), "the run failed before it");
    assert.deepEqual(Object.keys(report.stages), ["model", "inventory", "demo", "route", "prepare"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
