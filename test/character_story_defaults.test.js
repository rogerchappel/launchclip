// A character story's defaults (kit/core/character-story.mjs): what the first
// real `make --animation` run got wrong without anyone asking for it. The
// fixture is four scenes of that run (a foal and a mare in a park), 9:16.
import assert from "node:assert/strict";
import test from "node:test";
import { captionOptions, captionPlan, chunkWords } from "@launchclip/core/captions.mjs";
import { castCaptionZones, castReaches, storyCaptionZones } from "@launchclip/core/cast-captions.mjs";
import { isCharacterStory } from "@launchclip/core/character-story.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { applyStyle, packCaptionsForStory, validateStylePack } from "@launchclip/core/style.mjs";
import { resolveStyleV2 } from "../src/style_store.js";
import { characterStory, characterWords } from "./helpers/character_story.js";

const resolved = (edit = (story) => story) => resolveStory(edit(characterStory()), { words: characterWords() });
const keep = { keepPhrase: true };
const lines = (chunks) => chunks.map((chunk) => chunk.words.map((word) => word.text).join(" "));
const say = (text, gap = 0.05) => text.split(" ").map((word, index) => ({ text: word, start: index * 0.3, end: index * 0.3 + 0.3 - gap }));

test("a character story is one made with a show bible that stages its cast", () => {
  assert.ok(isCharacterStory(characterStory()));
  const { bible, ...noBible } = characterStory();
  assert.ok(!isCharacterStory(noBible), "characters without a bible: an explainer with a presenter, not a character story");
  assert.ok(!isCharacterStory({ ...characterStory(), scenes: [{ id: "a", module: "hook-title" }] }));
  assert.ok(!isCharacterStory({ ...characterStory(), lane: "footage-led" }));
});

test("a phrase's last word is kept with its phrase", () => {
  // The run's opening line under its band preset (6 words, 30 letters) left "gate." alone.
  const opening = say("The foal watched the starting gate. Why does it open?");
  assert.deepEqual(lines(chunkWords(opening, { maxWords: 6, maxChars: 30, ...keep })), ["The foal watched the", "starting gate.", "Why does it open?"]);
  // The default chunking: a line cut for size hands its last word to the lone one.
  assert.deepEqual(lines(chunkWords(say("it is a brand new starting gate."), keep)), ["it is a", "brand new", "starting gate."]);
  // A line of two words keeps both (it would leave its first word alone instead).
  assert.deepEqual(lines(chunkWords(say("ship this feature today."), keep)), ["ship this", "feature today."]);
  assert.deepEqual(lines(chunkWords(say("we can ship this feature today."), keep)), ["we can ship", "this feature", "today."]);
  // Off unless asked for: every other video's captions are chunked as before.
  assert.deepEqual(lines(chunkWords(opening, { maxWords: 6, maxChars: 30 })), ["The foal watched the starting", "gate.", "Why does it open?"]);
  // A one-word sentence stays alone, and so does a word spoken after a pause.
  assert.deepEqual(lines(chunkWords(say("Not at all. No. It means you can start."), { maxWords: 6, maxChars: 30, ...keep })), ["Not at all.", "No.", "It means you can start."]);
  const paused = say("one two three four five six seven.", 0.05);
  paused[6] = { ...paused[6], start: paused[5].end + 0.6, end: paused[5].end + 0.9 };
  assert.deepEqual(lines(chunkWords(paused, { maxWords: 6, maxChars: 40, ...keep })), ["one two three four five six", "seven."]);
  // Never a line over the limits, never a first line of one word.
  for (const text of ["a b c d e f g.", "alpha beta gamma delta epsilon zeta.", "The foal stepped back from the gate."]) {
    for (const limits of [{ maxWords: 3, maxChars: 18 }, { maxWords: 4, maxChars: 22 }, { maxWords: 6, maxChars: 30 }]) {
      const out = chunkWords(say(text), { ...limits, ...keep });
      for (const chunk of out) assert.ok(chunk.words.length <= limits.maxWords, `${text} ${JSON.stringify(limits)}: ${lines(out).join(" | ")}`);
      assert.ok(out.length < 2 || out.at(-1).words.length > 1 || out.at(-2).words.length < 3, `${text} ${JSON.stringify(limits)}: ${lines(out).join(" | ")}`);
    }
  }
});

test("a character story's captions: no band or plate, sentence case, sized for a phone", () => {
  const story = resolved();
  const options = captionOptions(story.overlays[0], { brand: story.brand, format: story.format, story });
  assert.equal(options.preset, "word-highlight");
  assert.notEqual(options.layout, "band", "no band");
  assert.ok(!options.plate, "no plate");
  assert.equal(options.case, "as-is");
  assert.deepEqual([options.maxWords, options.maxChars], [4, 20]);
  // Heavy type in the brand's body face, at least 6.5% of a 1080 frame's width: read on a phone.
  assert.ok(options.size >= 70 && options.weight >= 800 && options.fontRole === "body", `caption type is ${options.size}px ${options.weight} ${options.fontRole}`);
  const plan = captionPlan(chunkWords(characterWords()), story.overlays[0], { brand: story.brand, format: story.format, story, zones: castCaptionZones(story) });
  assert.ok(!plan.nodes.some((node) => /lc-cap-band/.test(node.cls ?? "")), "no band node is drawn");
  const text = plan.nodes.filter((node) => /(^| )lc-cap( |$)/.test(node.cls ?? "")).map((node) => node.children.map((child) => child.text).join(" "));
  assert.equal(text[0], "The foal watched the");
  assert.equal(text[1], "starting gate.");
  assert.ok(!text.some((line, index) => index > 0 && /^\S+[.!?]$/.test(line) && !/[.!?,]$/.test(text[index - 1])), `no phrase leaves its last word alone: ${text.join(" | ")}`);
  // An overlay that names its own preset keeps it, with that preset's own options.
  const named = captionOptions({ type: "captions", preset: "lower-band" }, { brand: story.brand, format: story.format, story });
  assert.deepEqual([named.preset, named.layout, named.maxWords], ["lower-band", "band", 6]);
  // A story with no bible is unchanged: the kit's default, in capitals.
  const { bible, ...plain } = characterStory();
  const usual = captionOptions({ type: "captions" }, { brand: plain.brand, format: plain.format, story: plain });
  assert.deepEqual([usual.preset, usual.case, usual.maxWords, usual.maxChars, usual.size], ["word-highlight", "upper", 3, 18, 74]);
});

test("a character story's captions sit where its characters are not", () => {
  const story = resolved();
  const zones = castCaptionZones(story);
  assert.equal(zones.length, 1, "one place for the whole run of cast scenes");
  assert.deepEqual([zones[0].start, zones[0].end], [0, 11.55]);
  const band = zones[0].rect;
  // No character's reach (any pose it takes in the scene) meets the caption band.
  for (const scene of castReaches(story)) for (const reach of scene.reaches) {
    const meets = reach.x < band.x + band.width && reach.x + reach.width > band.x && reach.y < band.y + band.height && reach.y + reach.height > band.y;
    assert.ok(!meets, `${scene.id}: a character reaches ${JSON.stringify(reach)} into the captions ${JSON.stringify(band)}`);
  }
  // The usual band (62% down a 9:16 frame) is where the wide shots' characters stand.
  const usual = { x: 65, y: 1190, width: 853, height: 230 };
  assert.ok(castReaches(story).some((scene) => scene.reaches.some((reach) => reach.y < usual.y + usual.height && reach.y + reach.height > usual.y)));
  assert.deepEqual(storyCaptionZones(story, null), zones);
  // Captions the storyboard places itself stay there; a story with no bible has no zones.
  assert.deepEqual(castCaptionZones(resolved((raw) => ({ ...raw, overlays: [{ type: "captions", position: "low" }] }))), []);
  assert.deepEqual(castCaptionZones(resolved((raw) => { const { bible, ...rest } = raw; return rest; })), []);
});

test("a style pack's caption preset is not put on a character story, unless the pack sets one for it", async () => {
  const { pack } = await resolveStyleV2("warm-documentary", {});
  assert.equal(pack.captions.preset, "lower-band", "the pack this test needs: one whose captions are a band");
  const styled = applyStyle({ ...characterStory(), style: pack.name }, pack).story;
  assert.equal(styled.overlays[0].preset, undefined, "the band is not filled in");
  assert.equal(captionOptions(styled.overlays[0], { brand: styled.brand, format: styled.format, story: styled }).preset, "word-highlight");
  assert.equal(packCaptionsForStory(pack, characterStory()), null);
  // The same pack still fills a story with no bible.
  const { bible, ...plain } = characterStory();
  assert.equal(applyStyle({ ...plain, style: pack.name }, pack).story.overlays[0].preset, "lower-band");
  // A pack opts in with captions.lanes.characters.
  const own = { ...pack, captions: { ...pack.captions, lanes: { ...(pack.captions.lanes ?? {}), characters: { preset: "bubble" } } } };
  assert.deepEqual(validateStylePack(own).errors, []);
  assert.equal(applyStyle({ ...characterStory(), style: own.name }, own).story.overlays[0].preset, "bubble");
});

test("a character story's outlined captions need no legibility plate; other captions are judged as before", async () => {
  const { outlinedCaptions, predictCaptionPlates } = await import("../src/caption_legibility.js");
  const story = resolved();
  const options = captionOptions(story.overlays[0], { brand: story.brand, format: story.format, story });
  assert.ok(outlinedCaptions(options), "white type in a dark outline");
  // A character standing right under the line no longer plates it.
  const under = [{ id: "cast", role: "media", rect: { x: 0, y: 0, width: 1080, height: 1920 }, start: 0, end: 11.55 }];
  assert.deepEqual(predictCaptionPlates(story, chunkWords(characterWords()), under), []);
  // The same words in a story with no bible: the kit's default captions, plated where a character is under them.
  const { bible, ...raw } = characterStory();
  const plain = resolveStory(raw, { words: characterWords() });
  assert.ok(!outlinedCaptions(captionOptions(plain.overlays[0], { brand: plain.brand, format: plain.format, story: plain })));
  assert.ok(predictCaptionPlates(plain, chunkWords(characterWords()), under).length > 0);
});
