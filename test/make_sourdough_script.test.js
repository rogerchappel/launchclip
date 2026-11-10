// The script of a one-prompt explainer, from a real run
// (test/fixtures/make-sourdough/script.json): it came back 80 words with a
// ceiling of 68 and "no call to action", and one repair fixed neither.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chooseScriptPlan } from "@launchclip/core/script-formats.mjs";
import { defaultCallToAction, ensureCallToAction, fitWordBudget, scriptInstructions, takeClock, writeScript } from "../src/make/script.js";
import { checkScript, countWords } from "../src/script_check.js";

const saved = JSON.parse(await readFile(new URL("./fixtures/make-sourdough/script.json", import.meta.url), "utf8"));
const PROMPT = "A 30-second explainer on why sourdough needs a starter";
const plan = chooseScriptPlan({ prompt: PROMPT, duration: 30, aspect: "16:9" });
const errorIds = (report) => report.errors.map((error) => error.id);

test("reproduced: the saved script had its call to action; the check did not know the words the rules ask for", () => {
  assert.equal(saved.word_count, 80);
  assert.deepEqual(saved.check.errors.map((error) => error.id), ["fits-clock", "cta-missing"]);
  assert.match(saved.narration, /Save this before your next sourdough bake\.$/, "the writer followed the short-video rule: a reason to save");
  assert.match(scriptInstructions(plan), /give a reason to follow or save that follows from the last idea \("save this before your next build"\)/);
  // Fixed: "save this" is a call to action, at the end where it belongs.
  const report = checkScript({ narration: saved.narration, duration: 30, format: "explainer", goal: "reach" });
  assert.ok(!errorIds(report).includes("cta-missing"));
  assert.deepEqual(report.stats.ctas.map((cta) => cta.class), ["save"]);
  // Early, it is still held to the final quarter like any other.
  assert.ok(errorIds(checkScript({ narration: `Save this before your next bake. ${saved.narration.replace(/ Save this.*$/, "")} That is the whole story of the jar on your counter.`, duration: 30, format: "explainer" })).includes("cta-early"));
});

test("reproduced: 80 words fitted the 30-second ceiling of 82; the voice read them in 25 s and the receipt then held them to 68", () => {
  assert.equal(plan.word_ceiling, 82);
  assert.ok(!errorIds(checkScript({ narration: saved.narration, duration: 30, format: "explainer" })).includes("fits-clock"));
  assert.equal(saved.take.seconds, 25.375);
  const measured = checkScript({ narration: saved.narration, duration: Math.round(saved.take.seconds), format: "explainer" });
  assert.match(measured.errors.find((error) => error.id === "fits-clock").message, /80 words cannot be read in 25s: the ceiling is 68/, "a take that was read in 25 s was told it could not be");
});

test("the receipt holds a short take to the rate it was spoken at: the take is the proof it fits", () => {
  const clock = takeClock({ narration: saved.narration, seconds: saved.take.seconds, target: 30, pace: "standard" });
  assert.deepEqual(clock, { duration: 25, limits: { wordsPerSecond: 3.2 } });
  const report = checkScript({ narration: saved.narration, format: "explainer", goal: "reach", ...clock });
  assert.deepEqual(report.errors.map((error) => error.id), [], "the saved script, as spoken, has no error left");
  assert.ok(report.warnings.some((warning) => warning.id === "wpm-band"), "the fast read is still said, as a warning");
  // A take near its target keeps the plan's clock, and a slow one is never given more room than the pace allows.
  assert.deepEqual(takeClock({ narration: saved.narration, seconds: 29, target: 30, pace: "standard" }), { duration: 30 });
  assert.equal(takeClock({ narration: "One two three four.", seconds: 10, target: 30, pace: "standard" }).limits.wordsPerSecond, 2.75);
});

test("the writer is given the length as a hard limit, in words", () => {
  const instructions = scriptInstructions(plan);
  assert.match(instructions, /Length is a hard limit: 82 words at most, about 75 is right\. Count the words of the narration before you answer/);
  assert.match(instructions, /call_to_action: the sentence the narration ends on that asks the viewer to act, word for word/);
});

test("an overshoot is cut to fit by whole sentences: the elaboration goes, the hook, every beat and the call to action stay", () => {
  const tight = { ...plan, word_ceiling: 68 };
  const fitted = fitWordBudget({ narration: saved.narration, beats: saved.beats }, tight);
  assert.ok(fitted.words <= 68, `${fitted.words} words`);
  assert.equal(countWords(fitted.narration), fitted.words);
  assert.deepEqual(fitted.cut, ["Bacteria make acids that give the bread its tang.", "That's more than flavor."]);
  assert.ok(fitted.cut.every((sentence) => saved.narration.includes(sentence) && /[.!?]$/.test(sentence)), "only whole sentences of the script are removed");
  assert.match(fitted.narration, /^Why does sourdough need that jar of starter\?/);
  assert.match(fitted.narration, /Save this before your next sourdough bake\.$/);
  assert.deepEqual(fitted.beats.map((beat) => beat.beat), saved.beats.map((beat) => beat.beat), "no beat loses its turn");
  assert.equal(fitted.beats.map((beat) => beat.text).join(" "), fitted.narration);
  // Every sentence that is left is one the writer wrote, in order.
  const kept = fitted.narration.split(/(?<=[.!?])\s+/);
  let at = -1;
  for (const sentence of kept) { const next = saved.narration.indexOf(sentence, at + 1); assert.ok(next > at, sentence); at = next; }
  // Inside the ceiling nothing is touched.
  const whole = fitWordBudget({ narration: saved.narration, beats: saved.beats }, plan);
  assert.deepEqual(whole.cut, []);
  assert.equal(whole.narration, saved.narration);
});

test("a script cannot omit its call to action: the writer's own sentence, else a plain one", () => {
  const without = saved.narration.replace(/ Save this before your next sourdough bake\.$/, "");
  const beats = saved.beats.map((beat, index) => (index === saved.beats.length - 1 ? { ...beat, text: beat.text.replace(/ Save this.*$/, "") } : beat));
  const own = ensureCallToAction({ narration: without, beats }, plan, "Save this before your next sourdough bake.");
  assert.equal(own.added, "Save this before your next sourdough bake.");
  assert.equal(own.narration, saved.narration);
  assert.equal(own.beats.at(-1).text, saved.beats.at(-1).text);
  // A sentence that asks for nothing is not a call to action: the plain one is used.
  const vague = ensureCallToAction({ narration: without, beats }, plan, "Now you know what the jar is for.");
  assert.equal(vague.added, "Save this for later.");
  assert.equal(defaultCallToAction({ goal: "convert" }), "Try it today.");
  assert.equal(defaultCallToAction({ goal: "reach", cta: { keyword: "deck", offer: "the checklist" } }), "Comment DECK and I'll send you the checklist.");
  // One that is already there is left alone, and a story may end without one.
  assert.equal(ensureCallToAction({ narration: saved.narration, beats: saved.beats }, plan, "").added, null);
  assert.equal(ensureCallToAction({ narration: "Once there was a jar. It rose.", beats: [] }, { ...plan, format: "story" }, "").added, null);
});

test("replayed: a recorded overshoot with no call to action leaves the script pass fitting, with one", async () => {
  // The recorded narration, padded past the ceiling as the run's first draft was, its last line dropped.
  const long = saved.beats.map((beat) => ({ beat: beat.beat, text: beat.beat === "model" ? `${beat.text} That gas has nowhere to go, so the crumb opens up.` : beat.text.replace(/ Save this.*$/, "") }));
  const narration = long.map((beat) => beat.text).join(" ");
  assert.ok(countWords(narration) > 82);
  const client = { provider: "openai", async runStructured() { return { value: { title: "T", narration, beats: long, title_options: ["A", "B", "C"], call_to_action: "Save this before your next sourdough bake." }, usage: {} }; } };
  const script = await writeScript({ client, prompt: PROMPT, duration: 30, plan: { aspect: "16:9" } });
  assert.ok(script.word_count <= script.plan.word_ceiling, `${script.word_count} of ${script.plan.word_ceiling}`);
  assert.equal(script.fit.call_to_action_added, "Save this before your next sourdough bake.");
  assert.ok(script.fit.cut.length >= 1 && script.fit.words_before > 82);
  assert.deepEqual(checkScript({ narration: script.narration, duration: 30, format: "explainer", goal: "reach" }).errors.filter((error) => ["fits-clock", "cta-missing"].includes(error.id)), []);
  assert.equal(script.beats.map((beat) => beat.text).join(" "), script.narration);
});
