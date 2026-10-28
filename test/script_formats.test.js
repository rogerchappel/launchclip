import assert from "node:assert/strict";
import test from "node:test";
import { planningPrompt } from "@launchclip/core/planning-prompt.mjs";
import {
  AWARENESS_LEVELS,
  MAX_WORDS_PER_SECOND,
  SCRIPT_FORMAT_IDS,
  SCRIPT_FORMATS,
  SCRIPT_GOALS,
  SCRIPT_SKELETONS,
  chooseScriptPlan,
  reengageTimes,
  scriptFormatsReference,
  scriptPlanLines,
  scriptRuleLines,
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
  assert.deepEqual([short.format, short.goal, short.awareness, short.skeleton], ["short-form", "reach", "problem", "call-out-pas"]);
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
  assert.equal(chooseScriptPlan({ prompt: "x", duration: 30, aspect: "9:16", words: 400 }).word_target, Math.floor(30 * MAX_WORDS_PER_SECOND));
  const long = chooseScriptPlan({ prompt: "x", duration: 600 });
  assert.equal(long.format, "long-form");
  assert.deepEqual(long.reengage_at, [180, 360]);
  assert.deepEqual(reengageTimes(400), [180]);
});

test("wordBudget uses the format's rate under the hard ceiling of duration × 2.75 words", () => {
  assert.deepEqual(wordBudget(60, "explainer"), { wpm: 150, target: 150, ceiling: 165 });
  assert.deepEqual(wordBudget(60, "data-explainer"), { wpm: 135, target: 135, ceiling: 165 });
  assert.deepEqual(wordBudget(60, "short-form"), { wpm: 165, target: 165, ceiling: 165 });
  assert.deepEqual(wordBudget(30, "short-form"), { wpm: 165, target: 82, ceiling: 82 });
  assert.equal(wordBudget(60, "story").target, 113, "story narration covers about 75% of the runtime");
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
  assert.match(text, /about 82 words .*never more than 82/);
  assert.match(text, /1\. hook — Call-out hook/);
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
