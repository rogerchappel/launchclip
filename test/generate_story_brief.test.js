// Story-shot briefs (docs/GENERATED_FOOTAGE_RFC.md §4.1) on a fixture story
// with a show bible: test/fixtures/animation-first-run plus
// test/fixtures/generate-story/BIBLE.json and an animatic written here.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { animaticInputs, ANIMATIC_SCHEMA } from "../src/animatic.js";
import { storyShotsCommand } from "../src/story_shots.js";
import { causalBeats, continuesFrom, formatBriefs, layoutFramePath, plateBrief, projectBriefs, retainedRange, STORY_NEGATIVE, storyBrief, storyRefusalReason, third } from "../src/generate/brief.js";
import { STYLE_PARAGRAPHS } from "../src/generate/style-paragraphs.js";
import { DRAWING_STYLES } from "@launchclip/core/characters/styles.mjs";

const FIXTURES = new URL("./fixtures/", import.meta.url);

async function project({ animatic = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "story-brief-"));
  await cp(new URL("animation-first-run/", FIXTURES), dir, { recursive: true });
  await cp(new URL("generate-story/BIBLE.json", FIXTURES), path.join(dir, "BIBLE.json"));
  if (animatic) {
    await mkdir(path.join(dir, "renders"), { recursive: true });
    await writeFile(path.join(dir, "renders", "animatic.mp4"), "");
    const { shots } = await storyShotsCommand(dir);
    await writeFile(path.join(dir, "ANIMATIC.json"), JSON.stringify({ schema: ANIMATIC_SCHEMA, ...(await animaticInputs(dir)), video: "renders/animatic.mp4", fps: 30, shots: shots.map(({ id, start, end, frames, first_frame, last_frame }) => ({ id, start, end, frames, first_frame, last_frame })) }));
  }
  return dir;
}

async function inputs(dir) {
  const bible = JSON.parse(await readFile(path.join(dir, "BIBLE.json"), "utf8"));
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  const animatic = JSON.parse(await readFile(path.join(dir, "ANIMATIC.json"), "utf8"));
  const { shots } = await storyShotsCommand(dir);
  return { bible, story, animatic, shots, shot: (id) => shots.find((s) => s.id === id) };
}

test("the keyframe pastes each bible description word for word, with the place and who is where", async () => {
  const dir = await project();
  const { bible, story, animatic, shot } = await inputs(dir);
  const brief = storyBrief(shot("gate-opens"), { bible, animatic, story, project: dir });
  assert.equal(brief.kind, "story");
  assert.deepEqual(brief.steps, ["image", "video"]);
  for (const member of bible.cast.characters) assert.ok(brief.image.prompt.includes(member.description), member.id);
  assert.match(brief.image.prompt, /Place: .*Light: day, key light #/);
  assert.match(brief.image.prompt, /wide shot\. Foal \(left\): look, happy; Mare \(right\): look, happy\./);
  assert.equal(brief.image.width, 1920);
  assert.equal(brief.image.height, 1080);
});

test("references: the sheets of everyone in frame and the animatic's first frame, absolute", async () => {
  const dir = await project();
  const { bible, story, animatic, shot } = await inputs(dir);
  const { references } = storyBrief(shot("gate-opens"), { bible, animatic, story, project: dir }).image;
  assert.deepEqual(references, [path.join(dir, "bible/sheets/foal.png"), path.join(dir, "bible/sheets/mare.png"), layoutFramePath(dir, "gate-opens")]);
  assert.ok(references.every(path.isAbsolute));
  // With no animatic, no layout reference: the words carry the layout.
  assert.equal(storyBrief(shot("gate-opens"), { bible, story, project: dir }).image.references.length, 2);
});

test("the motion prompt is camera and the one action in timed beats; the negative carries the bible's rules", async () => {
  const dir = await project();
  const { bible, story, animatic, shot } = await inputs(dir);
  const brief = storyBrief(shot("gate-opens"), { bible, animatic, story, project: dir });
  assert.match(brief.video.prompt, /^Camera: wide shot/);
  assert.match(brief.video.prompt, /Action: Foal cheers the closed gate\./);
  // Cause and effect: the setup, then the beat the action lands on, then what follows; each beat names only what changes.
  assert.match(brief.video.prompt, /0–0\.5 s \(setup\): Foal \(left\) looks, happy; Mare \(right\) looks, happy\. 0\.5–1\.1 s \(action\): Foal \(left\) cheers, now delighted/);
  assert.match(brief.video.prompt, /1\.1–2\.5 s \(consequence\): Foal \(left\) walks; Mare \(right\) gazes\./);
  assert.match(brief.video.prompt, /nothing moves that the beats do not name/);
  assert.doesNotMatch(brief.video.prompt, /Nothing else moves/);
  // The mix is ours: no native soundtrack by default.
  assert.match(brief.video.prompt, /Audio: none; no music, no speech or narration, no sound effects\./);
  assert.equal(brief.video.audio, "none");
  const effects = storyBrief(shot("gate-opens"), { bible, animatic, story, project: dir, soundEffects: true });
  assert.match(effects.video.prompt, /Audio: only the sound effects of the actions on screen; no music, no speech or narration\./);
  assert.notEqual(effects.brief_hash, brief.brief_hash);
  assert.ok(!brief.video.prompt.includes("chestnut") && !brief.video.prompt.includes("#b9652f"), "who lives in the keyframe");
  assert.equal(brief.video.seconds, 2.51);
  assert.equal(brief.video.fps, 30);
  assert.ok(brief.image.negative.startsWith(STORY_NEGATIVE));
  for (const word of ["text", "lettering", "extra people", "mirrors", "Mare never runs."]) assert.ok(brief.image.negative.includes(word), word);
});

test("a shot with two actions is refused with a reason", async () => {
  const dir = await project();
  const { bible, story, shot } = await inputs(dir);
  const two = shot("foal-questions");
  assert.equal(two.actions.length, 2);
  assert.match(storyRefusalReason(two, { bible }), /2 actions .*split it or draw it in code/);
  assert.equal(storyBrief(two, { bible, story, project: dir }), null);
  const unknown = { ...shot("gate-opens"), who: ["foal", "stranger"] };
  assert.match(storyRefusalReason(unknown, { bible }), /no description for stranger/);
});

test("a plate is image only, the place with nobody in it", async () => {
  const dir = await project();
  const { bible, story } = await inputs(dir);
  const plate = plateBrief("standing", { bible, story });
  assert.equal(plate.id, "plate-park-standing");
  assert.deepEqual(plate.steps, ["image"]);
  assert.equal(plate.video, null);
  assert.match(plate.image.prompt, /Nobody in frame/);
  for (const member of bible.cast.characters) assert.ok(!plate.image.prompt.includes(member.name));
  assert.match(plate.image.negative, /people, characters/);
});

test("the brief hash is stable and follows the content", async () => {
  const dir = await project();
  const { bible, story, animatic, shot } = await inputs(dir);
  const a = storyBrief(shot("gate-opens"), { bible, animatic, story, project: dir });
  assert.equal(storyBrief(structuredClone(shot("gate-opens")), { bible: structuredClone(bible), animatic, story, project: dir }).brief_hash, a.brief_hash);
  assert.match(a.brief_hash, /^sha256:[0-9a-f]{64}$/);
  const changed = structuredClone(bible);
  changed.cast.characters[0].description += " Changed.";
  assert.notEqual(storyBrief(shot("gate-opens"), { bible: changed, animatic, story, project: dir }).brief_hash, a.brief_hash);
  assert.equal(plateBrief("standing", { bible, story }).brief_hash, plateBrief("standing", { bible, story }).brief_hash);
});

test("projectBriefs adds story shots and plates after the footage, and grabs each layout frame", async () => {
  const dir = await project();
  const grabbed = [];
  const all = await projectBriefs(dir, { frame: async (video, seconds, out) => { grabbed.push({ video, seconds, out }); await writeFile(out, "png"); } });
  const story = all.filter((entry) => entry.request.role === "story");
  const plates = all.filter((entry) => entry.request.role === "plate");
  assert.equal(story.length, 10);
  assert.deepEqual(plates.map((entry) => entry.brief.id), ["plate-park-standing"]);
  const made = story.filter((entry) => entry.brief);
  assert.ok(made.length >= 1 && story.some((entry) => /actions/.test(entry.reason ?? "")));
  assert.equal(grabbed.length, made.length);
  const opens = grabbed.find((entry) => entry.out === layoutFramePath(dir, "gate-opens"));
  assert.equal(opens.seconds, 19);
  assert.ok(existsSync(opens.out));
  const text = formatBriefs(all);
  assert.match(text, /# gate-opens \(story shot\)/);
  assert.match(text, /# plate-park-standing \(plate, nobody in frame\)/);
  assert.match(text, /references:\n.*foal\.png/);
});

test("no animatic, no story entries: footage output is unchanged", async () => {
  const dir = await project({ animatic: false });
  const all = await projectBriefs(dir, { frame: () => assert.fail("no frame without an animatic") });
  assert.ok(all.every((entry) => !["story", "plate"].includes(entry.request.role)));
});

test("the style's locked paragraph is pasted word for word; stick figures add anatomy to the prompt and the negative", async () => {
  const dir = await project();
  const { bible, story, animatic, shot } = await inputs(dir);
  for (const style of DRAWING_STYLES) assert.ok(STYLE_PARAGRAPHS[style]?.drawing && STYLE_PARAGRAPHS[style]?.place, style);
  assert.ok(STYLE_PARAGRAPHS["rubber-hose"].anatomy);
  const stick = structuredClone(bible);
  stick.cast.style = "stick";
  const brief = storyBrief(shot("gate-opens"), { bible: stick, animatic, story, project: dir });
  const { drawing, place, anatomy, negative, motion } = STYLE_PARAGRAPHS.stick;
  assert.ok(brief.image.prompt.includes(`${drawing} ${place} ${anatomy} Match the reference sheets exactly.`));
  assert.match(brief.image.prompt, /Exactly two arms and two legs/);
  assert.ok(brief.image.negative.includes(negative) && brief.image.negative.endsWith("Mare never runs."));
  assert.ok(brief.video.prompt.includes(motion));
  // Another style: its own paragraph, no stick anatomy.
  const chibi = storyBrief(shot("gate-opens"), { bible, animatic, story, project: dir });
  assert.ok(chibi.image.prompt.includes(STYLE_PARAGRAPHS.chibi.drawing));
  assert.ok(!chibi.image.prompt.includes("Exactly two arms") && !chibi.image.negative.includes("ghost limbs") && !chibi.video.prompt.includes("Throughout:"));
  assert.notEqual(chibi.brief_hash, brief.brief_hash);
  // A plate gets the place sentence, never the figures.
  const plate = plateBrief("standing", { bible: stick, story });
  assert.ok(plate.image.prompt.includes(place) && !plate.image.prompt.includes(drawing));
  // A style with no paragraph yet still says its name.
  stick.cast.style = "brand-new";
  assert.match(storyBrief(shot("gate-opens"), { bible: stick, animatic, story, project: dir }).image.prompt, /Drawing: the brand-new style\./);
});

test("beats name grips, releases, contacts and hand-offs when the states carry them", () => {
  const shot = {
    start: 10, seconds: 3, who: ["a", "b"], actions: [{ who: "a", verb: "push", target: "the cart" }],
    poses: {
      a: [{ at: 10, pose: "stand", expression: "calm", holds: "ball" }, { at: 10.5, pose: "stand", action: "handoff", holds: null, to: "b" }, { at: 11, pose: "lean", action: "push", contact: "both hands on the cart" }, { at: 12, pose: "stand", expression: "proud" }],
      b: [{ at: 10, pose: "stand" }, { at: 10.5, pose: "stand", holds: { name: "ball" } }]
    }
  };
  const beats = causalBeats(shot, { nameOf: (id) => id.toUpperCase() });
  assert.deepEqual(beats, [
    "0–0.5 s (setup): a stands, calm, holding the ball; b stands.",
    "0.5–1 s (setup): a lets go of the ball, handoffs to B; b grips the ball.",
    "1–2 s (action): a leans, pushes the cart, both hands on the cart.",
    "2–3 s (consequence): a stands, now proud."
  ]);
  assert.equal(third("turn-to-look"), "turns to look");
  assert.equal(third("catch"), "catches");
  assert.equal(third("carry"), "carries");
});

test("continuity: a shot that carries straight on starts from the last kept frame of the one before", async () => {
  const dir = await project();
  const { bible, story, animatic, shots, shot } = await inputs(dir);
  const [a, b] = shots;
  assert.equal(continuesFrom(a, b, 30), true, "same set, no gap, the foal in both");
  assert.equal(continuesFrom(a, { ...b, set: "elsewhere" }, 30), false);
  assert.equal(continuesFrom(a, { ...b, start: b.start + 1 }, 30), false);
  assert.equal(continuesFrom(a, { ...b, who: ["stranger"] }, 30), false);
  const plain = storyBrief(shot("gate-opens"), { bible, animatic, story, project: dir });
  const chained = storyBrief(shot("gate-opens"), { bible, animatic, story, project: dir, follows: shot("gate-wide") });
  assert.equal(chained.video.continue_from, "gate-wide");
  assert.equal(plain.video.continue_from, undefined);
  assert.match(chained.video.prompt, /The start frame is the last frame of the shot before; carry straight on from it: Foal \(left\) as it left off \(looks, thinking\); Mare \(right\) as it left off \(stands, neutral\), same side of frame/);
  assert.notEqual(chained.brief_hash, plain.brief_hash);
  assert.deepEqual(retainedRange(chained.video), { in: 0.3, out: 2.81, last: 2.777 });
  // Opt-in through the storyboard; a shot is chained only to a generated one (here every neighbour is refused).
  story.generate = { continuity: true, sound_effects: true };
  await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(story));
  const all = await projectBriefs(dir, { frame: async () => {} });
  const made = all.filter((entry) => entry.request.role === "story" && entry.brief);
  assert.ok(made.every((entry) => entry.brief.video.audio === "effects"));
  assert.ok(made.every((entry) => !entry.brief.video.continue_from));
  assert.match(formatBriefs(made), /keep: 0\.3–2\.81 s of the clip; native sound effects only/);
  assert.match(formatBriefs([{ request: { id: "gate-opens", role: "story" }, brief: chained }]), /start frame: the last kept frame of gate-wide's clip, not this shot's keyframe/);
});
