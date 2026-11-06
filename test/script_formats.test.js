import assert from "node:assert/strict";
import test from "node:test";
import { planningPrompt } from "@launchclip/core/planning-prompt.mjs";
import {
  AWARENESS_LEVELS,
  FAST_MAX_WORDS_PER_SECOND,
  MAX_WORDS_PER_SECOND,
  PACES,
  PACE_IDS,
  SCRIPT_FORMAT_IDS,
  SCRIPT_FORMATS,
  SCRIPT_GOALS,
  SCRIPT_SKELETONS,
  chooseScriptPlan,
  ctaLine,
  ctaPlanOptions,
  reengageTimes,
  scriptFormatsReference,
  scriptPlanLines,
  scriptRuleLines,
  seriesPlanOptions,
  wordBudget
} from "@launchclip/core/script-formats.mjs";

test("the format, goal and awareness vocabularies are fixed", () => {
  assert.deepEqual([...SCRIPT_FORMAT_IDS], ["short-form", "long-form", "explainer", "data-explainer", "story", "promo"]);
  assert.deepEqual([...SCRIPT_GOALS], ["reach", "convert"]);
  assert.deepEqual([...AWARENESS_LEVELS], ["unaware", "problem", "solution", "product", "most"]);
  for (const id of SCRIPT_FORMAT_IDS) {
    const spec = SCRIPT_FORMATS[id];
    assert.ok(SCRIPT_SKELETONS[spec.skeleton], `${id} names a known skeleton`);
    for (const skeleton of spec.skeletons) assert.ok(SCRIPT_SKELETONS[skeleton], `${id}: ${skeleton}`);
    assert.ok(spec.hook && spec.cta && spec.sentences.hard === 25, id);
  }
  for (const skeleton of Object.values(SCRIPT_SKELETONS)) {
    const total = skeleton.beats.reduce((sum, beat) => sum + beat.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${skeleton.id} shares sum to 1 (got ${total})`);
    assert.equal(new Set(skeleton.beats.map((beat) => beat.id)).size, skeleton.beats.length, `${skeleton.id} beat ids are unique`);
  }
});

test("chooseScriptPlan picks a format from the brief, duration and aspect", () => {
  const cases = [
    [{ prompt: "Thirty seconds on why my desk is a mess", duration: 30, aspect: "9:16" }, "short-form"],
    [{ prompt: "Anything at all", duration: 45, aspect: { width: 1080, height: 1920 } }, "short-form"],
    [{ prompt: "A new study of 3,000 nurses found night shifts change sleep", duration: 40, aspect: "9:16" }, "data-explainer"],
    [{ prompt: "What the research says about four-day weeks", duration: 60, aspect: "16:9" }, "data-explainer"],
    [{ prompt: "Animate the fable of the tortoise and the hare", duration: 60, aspect: "16:9" }, "story"],
    [{ prompt: "Read this verse by Rumi over slow visuals", duration: 30, aspect: "9:16" }, "story"],
    [{ prompt: "A 30-second launch video for Ledgerly", duration: 30, aspect: "9:16" }, "promo"],
    [{ prompt: "Introducing our new feature", duration: 60, aspect: "16:9" }, "promo"],
    [{ prompt: "How does a heat pump work", duration: 90, aspect: "16:9" }, "explainer"],
    [{ prompt: "A deep dive on our roadmap", duration: 600, aspect: "16:9" }, "long-form"],
    [{ prompt: "A tour", duration: 120, aspect: "16:9", assets: [{ role: "screen-recording" }] }, "promo"],
    [{ prompt: "A tour", duration: 120, aspect: "16:9" }, "explainer"]
  ];
  for (const [input, format] of cases) assert.equal(chooseScriptPlan(input).format, format, input.prompt);
});

test("chooseScriptPlan defaults goal and awareness, and explicit options override every default", () => {
  const promo = chooseScriptPlan({ prompt: "A 30-second launch video for Ledgerly", duration: 30, aspect: "16:9" });
  assert.equal(promo.goal, "convert");
  assert.equal(promo.awareness, "solution");
  assert.equal(promo.skeleton, "launch");
  const short = chooseScriptPlan({ prompt: "Why your sourdough is flat", duration: 30, aspect: "9:16" });
  assert.deepEqual([short.format, short.goal, short.awareness, short.skeleton], ["short-form", "reach", "problem", "stakes-list"]);
  assert.equal(chooseScriptPlan({ prompt: "A 20s ad that drives sign-ups", duration: 20, aspect: "9:16" }).goal, "convert");
  assert.equal(chooseScriptPlan({ prompt: "Retargeting video for existing customers", duration: 20, aspect: "9:16" }).awareness, "most");

  const forced = chooseScriptPlan({ prompt: "A 30-second launch video for Ledgerly", duration: 30, aspect: "16:9", format: "story", goal: "Reach", awareness: "most" });
  assert.deepEqual([forced.format, forced.goal, forced.awareness, forced.skeleton], ["story", "reach", "most", "story-spine"]);
  assert.ok(forced.reasons.includes("format story: --format"));
  // Short-form for a viewer who already wants the result switches skeleton.
  assert.equal(chooseScriptPlan({ prompt: "x", duration: 30, aspect: "9:16", awareness: "solution" }).skeleton, "before-after-bridge");
  for (const [key, value] of [["format", "vlog"], ["goal", "fame"], ["awareness", "very"]]) {
    assert.throws(() => chooseScriptPlan({ prompt: "x", duration: 30, [key]: value }), new RegExp(`--${key} must be one of`));
  }
});

test("chooseScriptPlan sizes the beats to the word budget", () => {
  const plan = chooseScriptPlan({ prompt: "A 60-second launch video for Ledgerly", duration: 60, aspect: "16:9" });
  assert.equal(plan.word_target, 150);
  assert.equal(plan.word_ceiling, 165);
  assert.deepEqual(plan.beats.map((beat) => beat.id), SCRIPT_SKELETONS.launch.beats.map((beat) => beat.id));
  const words = plan.beats.reduce((sum, beat) => sum + beat.words, 0);
  assert.ok(Math.abs(words - plan.word_target) <= plan.beats.length, `beats add up to about the target (${words})`);
  // A word override (a measured take) never passes the ceiling.
  assert.equal(chooseScriptPlan({ prompt: "x", duration: 30, aspect: "9:16", words: 400 }).word_target, Math.floor(30 * FAST_MAX_WORDS_PER_SECOND), "short-form is fast: its ceiling is 4.2 words a second");
  assert.equal(chooseScriptPlan({ prompt: "x", duration: 30, aspect: "9:16", pace: "standard", words: 400 }).word_target, Math.floor(30 * MAX_WORDS_PER_SECOND));
  const long = chooseScriptPlan({ prompt: "x", duration: 600 });
  assert.equal(long.format, "long-form");
  assert.deepEqual(long.reengage_at, [180, 360]);
  assert.deepEqual(reengageTimes(400), [180]);
});

test("wordBudget uses the format's rate under the hard ceiling of duration × 2.75 words", () => {
  assert.deepEqual(wordBudget(60, "explainer"), { wpm: 150, target: 150, ceiling: 165 });
  assert.deepEqual(wordBudget(60, "data-explainer"), { wpm: 135, target: 135, ceiling: 165 });
  assert.deepEqual(wordBudget(60, "short-form"), { wpm: 215, target: 215, ceiling: 252 }, "short-form defaults to the fast pace");
  assert.deepEqual(wordBudget(30, "short-form"), { wpm: 215, target: 108, ceiling: 126 });
  assert.deepEqual(wordBudget(30, "short-form", "standard"), { wpm: 150, target: 75, ceiling: 82 });
  assert.equal(wordBudget(60, "story").target, 101, "story is calm (135 wpm) and its narration covers about 75% of the runtime");
  assert.equal(wordBudget(600, "long-form").ceiling, 1650);
  assert.equal(wordBudget(1, "promo").target, 8, "never below 8 words");
  for (const id of SCRIPT_FORMAT_IDS) for (const seconds of [3, 15, 45, 90, 180]) {
    const budget = wordBudget(seconds, id);
    assert.ok(budget.target <= budget.ceiling, `${id} ${seconds}s`);
  }
});

test("the plan and rule lines carry the format, goal, awareness, budget and the never-invent rule", () => {
  const plan = chooseScriptPlan({ prompt: "Why your sourdough is flat", duration: 30, aspect: "9:16" });
  const text = scriptPlanLines(plan).join("\n");
  assert.match(text, /Format: short-form/);
  assert.match(text, /Goal: reach/);
  assert.match(text, /Problem-aware: .*No product name/);
  assert.match(text, /about 108 words .*never more than 126/);
  assert.match(text, /Pace: Fast, about 215 words a minute/);
  assert.match(text, /1\. hook — Stakes hook/);
  assert.match(text, /2\. loop — Open loop/);
  assert.match(text, /4\. rehook — Pattern interrupt/);
  const rules = scriptRuleLines(plan).join("\n");
  assert.match(rules, /4–10 words/);
  assert.match(rules, /"but", "so" or "therefore", never "and then"/);
  assert.match(rules, /4 in 10/);
  assert.match(rules, /Never invent facts/);
  assert.match(scriptRuleLines(chooseScriptPlan({ prompt: "How tides work", duration: 90 })).join("\n"), /mean at about 15 words/);
  assert.match(scriptPlanLines(chooseScriptPlan({ prompt: "x", duration: 600 })).join("\n"), /Re-engage near 3:00, 6:00/);
});

test("the storyboard planner is told to follow the script's beats", () => {
  const prompt = planningPrompt({ tier: "structured", lane: "motion" });
  assert.match(prompt, /## Script beats/);
  assert.match(prompt, /follow them in order: each beat gets its own scene/);
  assert.match(prompt, /The CTA beat gets the end card, worded exactly as the narration speaks it/);
});

test("the skills reference lists every format, skeleton and awareness level", () => {
  const reference = scriptFormatsReference();
  assert.match(reference, /^# Script formats/);
  for (const id of [...SCRIPT_FORMAT_IDS, ...Object.keys(SCRIPT_SKELETONS), ...AWARENESS_LEVELS]) assert.ok(reference.includes(`\`${id}\``), id);
  assert.doesNotMatch(reference, /Hormozi|Schwartz|MrBeast|Pixar|Kallaway/, "the frameworks ship as LaunchClip's own vocabulary");
});

test("pace: short-form is fast, story and data are calm, the rest standard; --pace overrides and sets the voice speed", () => {
  assert.deepEqual([...PACE_IDS], ["calm", "standard", "fast"]);
  const short = chooseScriptPlan({ prompt: "Three deck mistakes", duration: 45, aspect: "9:16" });
  assert.deepEqual([short.pace, short.wpm, short.voice_speed], ["fast", 215, 1.2]);
  assert.ok(short.reasons.includes("pace fast: the default for short-form"));
  const story = chooseScriptPlan({ prompt: "A fable about a fox", duration: 60, aspect: "9:16" });
  assert.deepEqual([story.format, story.pace, story.wpm], ["story", "calm", 135]);
  const forced = chooseScriptPlan({ prompt: "x", duration: 45, aspect: "9:16", pace: "Calm" });
  assert.deepEqual([forced.pace, forced.wpm, forced.voice_speed, forced.word_ceiling], ["calm", 135, PACES.calm.speed, Math.floor(45 * MAX_WORDS_PER_SECOND)]);
  assert.throws(() => chooseScriptPlan({ prompt: "x", duration: 30, pace: "ludicrous" }), /--pace must be one of calm, standard, fast/);
});

test("the stakes-list skeleton carries the open loop, the numbered list and the pattern interrupt, and sums to 1", () => {
  const skeleton = SCRIPT_SKELETONS["stakes-list"];
  assert.deepEqual(skeleton.beats.map((beat) => beat.id), ["hook", "loop", "list", "rehook", "payoff", "cta"]);
  assert.ok(Math.abs(skeleton.beats.reduce((sum, beat) => sum + beat.share, 0) - 1) < 1e-9);
  assert.equal(SCRIPT_FORMATS["short-form"].skeleton, "stakes-list");
});

test("a host's comment keyword and a series' viewer choice reach the plan and its call-to-action line", () => {
  assert.equal(ctaPlanOptions({}), null);
  assert.deepEqual(ctaPlanOptions({ ctaKeyword: "deck", ctaOffer: "our board care guide" }), { keyword: "DECK", offer: "our board care guide" });
  assert.throws(() => ctaPlanOptions({ ctaKeyword: "two words" }), /--cta-keyword must be one word/);
  assert.throws(() => ctaPlanOptions({ ctaOffer: "a guide" }), /--cta-offer needs --cta-keyword/);
  const plan = chooseScriptPlan({ prompt: "Three deck mistakes", duration: 45, aspect: "9:16", ctaKeyword: "deck", ctaOffer: "our board care guide" });
  assert.deepEqual(plan.cta, { keyword: "DECK", offer: "our board care guide" });
  assert.match(scriptPlanLines(plan).join("\n"), /Call to action: a comment keyword, as the story's last idea: "Comment DECK and I'll send you our board care guide\."/);

  assert.deepEqual(seriesPlanOptions({ episode: "Job 1", choices: "rosa, lou,ike" }), { episode: "Job 1", choices: ["ROSA", "LOU", "IKE"] });
  assert.throws(() => seriesPlanOptions({ choices: "only" }), /two to four options/);
  const episode = chooseScriptPlan({ prompt: "A heist story", duration: 90, aspect: "9:16", format: "short-form", episode: "Job 1", choices: ["ROSA", "LOU", "IKE"] });
  assert.match(ctaLine(episode), /"Comment ROSA, LOU or IKE\. One word\."/);
  const lines = scriptPlanLines(episode).join("\n");
  assert.match(lines, /Series: this is Job 1 of a series/);
  assert.match(lines, /most-picked one happens in the next episode/);
});

test("the short-video rules ask for specifics, an open loop with a re-hook, and a CTA built into the story", () => {
  const rules = scriptRuleLines(chooseScriptPlan({ prompt: "x", duration: 45, aspect: "9:16" })).join("\n");
  assert.match(rules, /Specific, never hedged/);
  assert.match(rules, /never invent the figure/);
  assert.match(rules, /open a loop in the first quarter/);
  assert.match(rules, /pattern interrupt near the middle/);
  assert.match(rules, /Never promise to send something the brief does not offer/);
  const reference = scriptFormatsReference();
  assert.match(reference, /## Pace/);
  assert.match(reference, /`fast` \(215 words a minute, voice speed 1\.2/);
  assert.match(reference, /--cta-keyword WORD/);
  assert.equal(FAST_MAX_WORDS_PER_SECOND, 4.2);
});
