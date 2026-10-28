import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TEXT_FADE } from "@launchclip/core/modules.mjs";
import gsap from "gsap";
import {
  calmEase, DEFAULT_GRAMMAR, easeOvershoot, easeRole, GRAMMAR_NAMES, GRAMMARS, grammarDuration, grammarEase, grammarErrors, grammarStagger,
  isEditorialGrammar, resolveGrammar
} from "@launchclip/core/grammar.mjs";
import { getEase } from "@launchclip/core/motion.mjs";
import { resolveEditorialModule } from "@launchclip/core/editorial-core.mjs";
import { emitEditorialModule } from "../kit/hyperframes/editorial-ui-modules.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { sceneWindows, transitionTweens } from "@launchclip/core/transitions.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { readProjectStory } from "../src/story_loader.js";
import { suggestMotion, planningPrompt } from "@launchclip/core/planning-prompt.mjs";
import { sceneAmbient } from "@launchclip/core/ambient.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STORY = path.join(ROOT, "examples", "story");
const sha = (value) => createHash("sha256").update(value).digest("hex");

// sha256 of compileStoryToHyperFrames(...).html for each golden story, taken
// before motion grammars existed: on feat/cinematic-v2 (b5775b2: origin/main
// plus ambient motion and style pack v2 captions, which change every golden's
// HTML). explainer-9x16 is compiled with its original s2 push (the golden now
// pans into s2). Earlier pins, all byte-identical with grammars at the time:
// origin/main 80d3107 (f4e7d778…), feat/ambient-motion 9d5ea0b (39db23d0…).
// cooling, minimal and data-story-9x16 were re-pinned when checklist rows
// stopped showing the pending label before they turn on (checklist HTML and
// motion only; grammars still compile them byte for byte).
// All six were re-pinned when GSAP took over catalogue A's animated
// transforms from the stylesheet (with exit hard kills) and the loop clone's
// timeline was rendered at its hold: HyperFrames renders of the old and new
// HTML match frame for frame (SSIM within the same build's render noise).
// cooling, promo-16x9, explainer-9x16 and footage were re-pinned when GSAP
// took over every catalogue's moved transforms from the inline CSS: renders
// of the old and new HTML differ by no more than two renders of the old one.
// cooling and footage were re-pinned by #316: a caption line spoken into a
// hidden range (a scene that hides captions) now ends at the range start.
// promo-16x9 was re-pinned by the direction guardrails: its call to action
// sits clear of the caption band, so the captions now stay on under it.
// minimal and data-story-9x16 re-pinned for #367: each opens on an editorial
// scene, which now starts at rest on frame 0 in HyperFrames too
// ({opacity:1,y:18} on #s1 and #s1-loop); nothing else in them changed.
const PRE_GRAMMAR_HTML_SHA256 = {
  cooling: "8bc7859b16b4274f74e7f476289344e6f6dc7d5eefdc2b51b0664ffc480b551f",
  minimal: "507b5a5424d4bd568b4955c60b300bcd284f710d52ba1774517fe16c34e501ec",
  "promo-16x9": "d78e0141506a6e6fc6411562ebaee893264ad2f104780ead7691519a38db044e",
  "explainer-9x16": "4f3e0efaa1828eeb7731b15e355acee1385dd26038cef0b6d0c5f7962052e936",
  "data-story-9x16": "958bb6fff06958778d93c4b428e09520b920c3d560aa484deec0796b31e4851f",
  footage: "547417065ab1483124e958ec9d24bcdada47a80a94a11c6f3e2b37e168488652"
};
// test/editorial_core.test.js: the explicit-rect 16:9 corpus subset (re-pinned
// with it when bound messages moved to 2-decimal bounds; error strings only).
const EXPLICIT_16X9_SHA256 = "45c528200fb88850369afee5518317015f2fc7992261c1c473e0555b803a7fd7";

async function goldenStory(id) {
  let dir = path.join(STORY, id), cleanup = async () => {};
  if (id === "cooling") {
    dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-grammar-cooling-"));
    await cp(path.join(STORY, "cooling.story.json"), path.join(dir, "storyboard.json"));
    await cp(path.join(STORY, "cooling.NARRATION.json"), path.join(dir, "cooling.NARRATION.json"));
    cleanup = () => rm(dir, { recursive: true, force: true });
  }
  const { resolved } = await readProjectStory(dir);
  if (id === "explainer-9x16") resolved.scenes.find((scene) => scene.id === "s2").in = { type: "push", dur: 0.45, direction: "up" };
  return { dir, resolved, cleanup };
}

test("editorial is the default and compiles every golden story byte for byte as before grammars", async () => {
  assert.equal(DEFAULT_GRAMMAR, "editorial");
  for (const [id, expected] of Object.entries(PRE_GRAMMAR_HTML_SHA256)) {
    const { dir, resolved, cleanup } = await goldenStory(id);
    try {
      for (const story of [resolved, { ...resolved, motion: { grammar: "editorial" } }, { ...resolved, motion: { grammar: { base: "editorial" } } }]) {
        const { html } = await compileStoryToHyperFrames(story, { projectDir: dir, write: false });
        assert.equal(sha(html), expected, `${id} (${JSON.stringify(story.motion ?? null)})`);
      }
    } finally {
      await cleanup();
    }
  }
});

test("the editorial grammar leaves the editorial golden corpus byte-identical (EXPLICIT_16X9_SHA256)", async () => {
  const corpus = JSON.parse(await readFile(path.join(ROOT, "test/fixtures/editorial-golden.json"), "utf8"));
  const subset = corpus.filter((entry) => entry.spec && typeof entry.spec === "object" && !Array.isArray(entry.spec) && entry.spec.aspect === "16:9" && entry.spec.rect !== undefined);
  assert.equal(sha(JSON.stringify(subset)), EXPLICIT_16X9_SHA256);
  const grammar = resolveGrammar({ motion: { grammar: "editorial" } });
  for (const entry of corpus) {
    let result;
    try { result = { value: emitEditorialModule(resolveEditorialModule(entry.spec, { grammar })) }; } catch (error) { result = { error: error.message }; }
    if (entry.error !== undefined) assert.equal(result.error, entry.error, entry.name);
    else assert.equal(JSON.stringify(result.value), JSON.stringify(entry.output), entry.name);
  }
});

test("every grammar's eases are GSAP eases that motion.mjs reproduces, with the declared overshoot", () => {
  for (const name of GRAMMAR_NAMES) {
    const grammar = GRAMMARS[name];
    assert.equal(grammar.id, name);
    const names = [...Object.values(grammar.ease), grammar.camera.whip, ...Object.values(grammar.ease).map(calmEase)];
    for (const easeName of names) {
      const ours = getEase(easeName), theirs = gsap.parseEase(easeName);
      assert.equal(typeof theirs, "function", `${name}: GSAP parses ${easeName}`);
      for (let i = 0; i <= 200; i += 1) {
        const p = i / 200;
        assert.ok(Math.abs(ours(p) - theirs(p)) < 1e-6, `${name} ${easeName} at ${p}: ${ours(p)} vs ${theirs(p)}`);
      }
    }
    // overshoot = the peak overshoot of the enter and emphasis eases.
    const peak = Math.max(easeOvershoot(grammar.ease.enter), easeOvershoot(grammar.ease.emphasis));
    assert.ok(Math.abs(peak - grammar.overshoot) < 0.01, `${name}: overshoot ${grammar.overshoot} vs measured ${peak}`);
    // Camera eases leave and land at rest (zero velocity at both ends), so the
    // camera path stays smooth across move boundaries.
    for (const easeName of [grammar.ease.camera, grammar.camera.whip]) {
      const fn = getEase(easeName), h = 1e-4;
      assert.ok(Math.abs(fn(h) / h) < 0.02 && Math.abs((1 - fn(1 - h)) / h) < 0.02, `${name}: ${easeName} starts and ends at rest`);
    }
    for (const key of ["enter", "exit", "transition", "camera"]) assert.ok(grammar.duration[key] > 0, `${name}.duration.${key}`);
    assert.ok(["cuts", "world"].every((mode) => grammar.defaultTransition[mode]?.type), `${name}: default transitions`);
    assert.ok(["subtle", "standard", "lively"].includes(grammar.ambient));
  }
  // The character of each grammar, as the art direction promises.
  assert.equal(GRAMMARS.snappy.ease.enter, "expo.out");
  assert.ok(GRAMMARS.snappy.duration.enter < GRAMMARS.editorial.duration.enter && GRAMMARS.snappy.overshoot > 0);
  assert.equal(GRAMMARS.smooth.overshoot, 0);
  assert.ok(GRAMMARS.smooth.duration.camera > GRAMMARS.editorial.duration.camera);
  assert.match(GRAMMARS.playful.ease.enter, /^back\.out/);
  assert.match(GRAMMARS.playful.ease.emphasis, /^elastic\.out/);
  assert.ok(GRAMMARS.playful.stagger > 1);
  assert.match(GRAMMARS.documentary.ease.move, /^power1/);
  for (const name of ["snappy", "playful"]) assert.match(GRAMMARS[name].ease.camera, /^back\.inOut/, `${name} camera anticipates`);
  // Cinematic: every arrival is slow → fast → slow (an .inOut with zero speed at both ends).
  for (const role of ["enter", "move", "camera", "emphasis"]) {
    const fn = getEase(GRAMMARS.cinematic.ease[role]), h = 1e-3;
    assert.match(GRAMMARS.cinematic.ease[role], /\.inOut$/, `cinematic ${role}`);
    assert.ok(fn(h) / h < 0.05 && (1 - fn(1 - h)) / h < 0.05, `cinematic ${role} starts and lands at rest`);
  }
  assert.ok(GRAMMARS.cinematic.duration.enter > GRAMMARS.smooth.duration.enter && GRAMMARS.cinematic.duration.camera > GRAMMARS.smooth.duration.camera);
  assert.equal(GRAMMARS.cinematic.overshoot, 0);
  assert.deepEqual(resolveGrammar({ motion: { grammar: "cinematic" } }).hold, { level: "lively", mediaPush: 0.04 });
  assert.equal(resolveGrammar({ motion: { grammar: { base: "cinematic", stagger: 1 } } }).panelEnter, 0.8, "overrides keep the base's panel and hold settings");
  for (const name of ["editorial", "snappy", "smooth", "playful", "documentary"]) {
    assert.equal(resolveGrammar({ motion: { grammar: name } }).panelEnter, 0.36, name);
    assert.equal(resolveGrammar({ motion: { grammar: name } }).hold, null, name);
  }
});

test("resolveGrammar reads names and {base, ...overrides}; validation names the bad field", () => {
  assert.equal(resolveGrammar({}).id, "editorial");
  assert.equal(isEditorialGrammar(resolveGrammar({})), true);
  const custom = resolveGrammar({ motion: { grammar: { base: "smooth", ease: { enter: "power3.out" }, duration: { camera: 1.4 }, stagger: 1.5 } } });
  assert.equal(custom.id, "smooth");
  assert.equal(custom.custom, true);
  assert.equal(custom.ease.enter, "power3.out");
  assert.equal(custom.ease.exit, GRAMMARS.smooth.ease.exit);
  assert.equal(custom.duration.camera, 1.4);
  assert.equal(custom.stagger, 1.5);
  // Editorial with one override is no longer the identity, but only that role changes.
  const tweaked = resolveGrammar({ motion: { grammar: { base: "editorial", ease: { enter: "expo.out" } } } });
  assert.equal(isEditorialGrammar(tweaked), false);
  assert.equal(grammarEase(tweaked, "power3.out"), "expo.out");
  assert.equal(grammarEase(tweaked, "power2.in"), "power2.in");
  assert.match(grammarErrors("zippy").join(), /must be one of editorial, snappy, smooth, playful, documentary/);
  assert.match(grammarErrors({ base: "snappy", ease: { wobble: "power1.out" } }).join(), /ease\.wobble is not a role/);
  assert.match(grammarErrors({ duration: { enter: 9 } }).join(), /duration\.enter must be between/);
  assert.throws(() => resolveGrammar({ motion: { grammar: { stagger: 99 } } }), /stagger/);
});

test("grammarEase maps designed eases by role, keeps linear ones, and never overshoots opacity or blur", () => {
  assert.deepEqual(["power3.out", "power2.in", "power3.inOut", "back.out(2.2)", "elastic.out(1, 0.4)", "none", "steps(4)", undefined].map(easeRole), ["enter", "exit", "move", "emphasis", "emphasis", null, null, "enter"]);
  const playful = resolveGrammar({ motion: { grammar: "playful" } });
  assert.equal(grammarEase(playful, "power3.out"), "back.out(1.7)");
  assert.equal(grammarEase(playful, "power3.out", { props: { opacity: 0, y: 10 } }), "power2.out", "opacity rides the calm twin");
  assert.equal(grammarEase(playful, "back.out(1.6)", { props: ["scale"] }), "elastic.out(1, 0.5)");
  assert.equal(grammarEase(playful, "power2.inOut"), "power2.inOut", "content mechanics keep their ease by default");
  assert.equal(grammarEase(playful, "power2.inOut", { roles: ["move"] }), "back.inOut(1.4)");
  assert.equal(grammarEase(playful, "none"), "none");
  assert.equal(calmEase("back.inOut(1.4)"), "power2.inOut");
  const editorial = resolveGrammar({});
  for (const name of ["power3.out", "back.out(2.2)", "power2.in", "expo.out"]) assert.equal(grammarEase(editorial, name, { props: ["x"] }), name);
  assert.equal(grammarDuration(editorial, "enter", 0.28), 0.28);
  assert.equal(grammarDuration(resolveGrammar({ motion: { grammar: "snappy" } }), "enter", 0.28), 0.2);
  assert.equal(grammarDuration(resolveGrammar({ motion: { grammar: "documentary" } }), "exit", 0.22, { max: 0.28 }), 0.28);
  assert.equal(grammarStagger(editorial, 0.22), 0.22);
  assert.equal(grammarStagger(playful, 0.22), 0.352);
});

test("grammars reach module enter/exit, pops, staggers and transitions", async () => {
  const { resolved, cleanup } = await goldenStory("explainer-9x16");
  try {
    const withGrammar = (grammar) => ({ ...resolved, motion: { grammar } });
    const model = (story, id) => resolveModule(story.scenes.find((scene) => scene.id === id), story);
    // Catalogue A: equation-lockup terms stagger further apart, eases follow.
    const lockup = (grammar) => model(withGrammar(grammar), "s5");
    const termTimes = (m) => m.content.terms.map((term) => term.time);
    const gap = (m) => termTimes(m)[1] - termTimes(m)[0];
    assert.ok(Math.abs(gap(lockup("playful")) - gap(lockup("editorial")) * 1.6) < 1e-6, `${gap(lockup("playful"))} vs ${gap(lockup("editorial"))}`);
    assert.ok(lockup("playful").animations.some((a) => /^back\.out|^elastic\.out/.test(a.ease)), "playful entrances overshoot");
    assert.ok(lockup("snappy").animations.some((a) => a.ease === "expo.out"));
    for (const a of lockup("playful").animations) {
      if (Object.keys(a.to).some((prop) => ["opacity", "blur", "color"].includes(prop))) assert.doesNotMatch(a.ease, /back|elastic|bounce/, `${a.node} ${Object.keys(a.to)} ${a.ease}`);
    }
    // Catalogue B: the root enter/exit eases and durations.
    const chart = (grammar) => model(withGrammar(grammar), "s2");
    assert.equal(chart("editorial").motion.enterEase, "power3.out");
    assert.equal(chart("smooth").motion.enterEase, "power2.out");
    // A slow grammar's text fade is capped (docs/DIRECTION_GUARDRAILS.md §4): never slower than TEXT_FADE.max.
    assert.ok(chart("smooth").motion.enterDuration >= chart("editorial").motion.enterDuration);
    assert.ok(chart("smooth").motion.enterDuration <= TEXT_FADE.max && chart("cinematic").motion.enterDuration <= TEXT_FADE.max);
    assert.ok(chart("snappy").motion.exitDuration < chart("editorial").motion.exitDuration);
    // Transitions: the push into s2 and the morph follow the grammar.
    const tweens = (grammar) => sceneWindows(withGrammar(grammar)).scenes.find((entry) => entry.id === "s2").tweens.filter((tw) => tw.role === "in");
    assert.deepEqual(tweens("editorial").map((tw) => tw.ease), ["power3.inOut"]);
    assert.deepEqual(tweens("smooth").map((tw) => tw.ease), ["sine.inOut"]);
    assert.deepEqual(tweens("cinematic").map((tw) => tw.ease), ["power2.inOut"]);
    assert.equal(chart("cinematic").motion.enterEase, "power2.inOut");
    // Cinematic's 0.7 s panel entrance is capped for text (docs/DIRECTION_GUARDRAILS.md §4).
    assert.equal(chart("cinematic").motion.enterDuration, TEXT_FADE.max);
    assert.deepEqual(transitionTweens({ type: "fade", dur: 0.4 }, { width: 1080, height: 1920, grammar: resolveGrammar({ motion: { grammar: "playful" } }) }).in.map((tw) => tw.ease), ["power2.inOut"], "a fade never overshoots");
    // Every grammar resolves every golden scene (no new param errors).
    for (const id of ["cooling", "minimal", "promo-16x9", "data-story-9x16", "footage"]) {
      const golden = await goldenStory(id);
      try {
        for (const grammar of GRAMMAR_NAMES) {
          const story = withGrammarOf(golden.resolved, grammar);
          for (const entry of sceneWindows(story).scenes) assert.doesNotThrow(() => resolveModule(entry.scene, story, { end: entry.renderEnd }), `${id} ${grammar} ${entry.id}`);
        }
      } finally {
        await golden.cleanup();
      }
    }
  } finally {
    await cleanup();
  }
});

test("cinematic panels arrive slowly with an ease-in-out, and its scenes drift at the lively level", () => {
  const spec = { id: "panel", kind: "checklist", aspect: "16:9", start: 2, duration: 5, title: "Plan", rows: [{ label: "Connect", status: "done", at: 1.2 }] };
  const shell = (name) => resolveEditorialModule(spec, { grammar: resolveGrammar({ motion: { grammar: name } }) }).motion;
  assert.equal(shell("smooth").enterDuration, 0.36, "other grammars keep the 0.36 s cap");
  assert.ok(Math.abs(shell("cinematic").enterDuration - 0.7) < 1e-9);
  assert.equal(shell("cinematic").enterEase, "power2.inOut");
  // The grammar's hold level is the default; the story and the scene still win.
  const scene = { id: "s1", module: "checklist", start: 0, end: 4, energy: 0 };
  assert.equal(sceneAmbient({ motion: { grammar: "cinematic" }, scenes: [scene] }, scene).level, "lively");
  assert.equal(sceneAmbient({ motion: { grammar: "smooth" }, scenes: [scene] }, scene).level, "subtle");
  assert.equal(sceneAmbient({ motion: { grammar: "cinematic" }, ambient: "subtle", scenes: [scene] }, scene).level, "subtle");
  assert.equal(sceneAmbient({ motion: { grammar: "cinematic" }, scenes: [scene] }, { ...scene, ambient: "off" }).level, "off");
});

function withGrammarOf(story, grammar) {
  return { ...story, motion: { grammar } };
}

test("the planner picks the grammar and camera from the art direction and lane", () => {
  assert.deepEqual(suggestMotion({ artDirection: "A playful explainer for kids", lane: "voiceover-motion" }).camera, { mode: "world", layout: "auto" });
  assert.equal(suggestMotion({ artDirection: "punchy, high-energy launch", lane: "motion" }).grammar, "snappy");
  assert.deepEqual(suggestMotion({ artDirection: "punchy, high-energy launch", lane: "footage-led" }).camera, { mode: "cuts" }, "footage-led keeps cuts");
  assert.equal(suggestMotion({ artDirection: "a sober documentary on the archive", lane: "motion" }).grammar, "documentary");
  assert.deepEqual(suggestMotion({ artDirection: "a sober documentary on the archive", lane: "motion" }).camera, { mode: "cuts" });
  assert.deepEqual(suggestMotion({ artDirection: "an editorial explainer that travels across a map", lane: "motion" }).camera, { mode: "world", layout: "auto" });
  assert.equal(suggestMotion({ artDirection: "explain caching", lane: "motion" }).grammar, "editorial");
  const prompt = planningPrompt({ lane: "voiceover-motion", artDirection: "calm premium brand film" });
  assert.match(prompt, /## Motion grammar and camera/);
  assert.match(prompt, /For this request: motion\.grammar "smooth" and camera\.mode "world"/);
  assert.match(prompt, /footage-led keeps camera\.mode "cuts"/);
  for (const name of GRAMMAR_NAMES) assert.match(prompt, new RegExp(`- ${name}: `));
  assert.doesNotMatch(planningPrompt({ lane: "motion" }), /For this request/);
});
