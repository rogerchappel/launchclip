import assert from "node:assert/strict";
import test from "node:test";
import { isTopicQuestion } from "../src/script_check.js";
import { cardErrors, fitShotCallouts, hookErrors, hookGate, hookThresholds, hookTiming, hookTimingErrors, labelFitsNotes, MAX_SAME_CARD } from "../src/short_form_checks.js";

const scene = (id, module, params = {}, extra = {}) => ({ id, module, start: 0, end: 2, params, ...extra });
const board = (scenes, duration = 46) => ({ format: { width: 1080, height: 1920, duration }, scenes });

test("a bare topic on the opening is a hook error on every short, footage library or not", () => {
  const opening = scene("cover", "photo-scene", { media: { kind: "video", src: "assets/shots/a.mp4" }, lines: [{ text: "Fence care?", at: 0 }] });
  const errors = hookErrors(board([opening]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^hook: the opening scene cover shows "Fence care\?", a bare topic question/);
  // The stakes on screen pass.
  const strong = scene("cover", "photo-scene", { media: { kind: "video", src: "assets/shots/a.mp4" }, lines: [{ text: "Low-upkeep fences still need 2 cleans a year", at: 0 }] });
  assert.deepEqual(hookErrors(board([strong])), []);
  // Over a recording, or in a long video, the rule is off.
  assert.deepEqual(hookErrors(board([opening]), { base: true }), []);
  assert.deepEqual(hookErrors(board([opening], 300)), []);
});

test("text and icon cards are capped by length, never back to back, and no module more than twice", () => {
  const clip = (id) => scene(id, "clip", { media: { kind: "video", src: `assets/shots/${id}.mp4` } });
  const card = (id, module = "concept-card") => scene(id, module, { text: id, icon: "brush" });
  const crowded = board([clip("a"), card("c1"), clip("b"), card("c2"), card("c3", "icon-row"), clip("c"), card("c4"), card("c5", "checklist")]);
  const errors = cardErrors(crowded, { footage: true });
  assert.ok(errors.some((entry) => /^cards: 5 text or icon cards .* in 46 s; keep at most 3/.test(entry)), errors.join("\n"));
  assert.ok(errors.some((entry) => /^cards: c2 \(concept-card\) and c3 \(icon-row\) are text or icon cards back to back/.test(entry)), errors.join("\n"));
  assert.ok(errors.some((entry) => new RegExp(`^cards: concept-card is used 3 times; at most ${MAX_SAME_CARD}`).test(entry)), errors.join("\n"));
  // Footage between two cards, within the cap: clean.
  assert.deepEqual(cardErrors(board([clip("a"), card("c1"), clip("b"), card("c2", "icon-row"), clip("c")]), { footage: true }), []);
  // No library: a short is capped all the same, and the advice names what to show instead of footage.
  const bare = cardErrors(crowded);
  assert.equal(bare.length, errors.length);
  assert.match(bare[0], /keep at most 3\. Show the other lines instead of spelling them out: a chart or diagram/);
  assert.ok(bare.every((entry) => !/footage/.test(entry)), bare.join("\n"));
  // Past 90 s only a footage library keeps the cap.
  const long = { ...crowded, format: { ...crowded.format, duration: 46 * 3 }, scenes: [...crowded.scenes, ...crowded.scenes.map((entry) => ({ ...entry, id: `${entry.id}x` })), ...crowded.scenes.map((entry) => ({ ...entry, id: `${entry.id}y` }))] };
  assert.deepEqual(cardErrors(long), []);
  assert.ok(cardErrors(long, { footage: true }).length > 0);
});

test("a label fits a shot when at least half its words are in the app's notes", () => {
  const saw = { description: "Man using circular saw on timber joists in a backyard", subjects: ["power saw", "timber joists"] };
  assert.equal(labelFitsNotes("Composite: regular cleaning", saw), false);
  assert.equal(labelFitsNotes("May need oiling", saw), false);
  assert.equal(labelFitsNotes("Cutting the joists", saw), true);
  // "hardwood" contains the notes' "wood".
  assert.equal(labelFitsNotes("Hardwood boards", { description: "Close-up of wood boards with visible grain" }), true);
  // No notes, or a label of stop words only, is not judged.
  assert.equal(labelFitsNotes("Cleaning needed", null), true);
  assert.equal(labelFitsNotes("Still needs it", saw), true);
});

test("tooling drops the callouts and grid labels a shot's notes do not support", () => {
  const story = board([
    scene("clean", "clip", { media: { kind: "video", src: "assets/shots/clean.mp4" }, callouts: [{ text: "Composite: regular cleaning", at: 0 }] }),
    scene("grid", "media-grid", { items: [
      { media: { kind: "video", src: "assets/shots/g1.mp4" }, label: "Hardwood" },
      { media: { kind: "video", src: "assets/shots/g2.mp4" }, label: "Composite" }
    ] }),
    scene("cut", "clip", { media: { kind: "video", src: "assets/shots/cut.mp4" }, callouts: [{ text: "Cutting the joists", at: 0 }] })
  ]);
  const shots = [
    { scene_id: "clean", src: "assets/shots/clean.mp4", notes: { description: "Man using circular saw on timber joists" } },
    { scene_id: "grid", slot: "items[0].media", src: "assets/shots/g1.mp4", notes: { description: "Close-up of dense hardwood grain" } },
    { scene_id: "grid", slot: "items[1].media", src: "assets/shots/g2.mp4", notes: { description: "White outdoor table and chairs on a raised deck" } },
    { scene_id: "cut", src: "assets/shots/cut.mp4", notes: { description: "Worker cutting joists with a saw" } },
    { scene_id: "clean", slot: "backdrop", src: "assets/shots/bg.mp4", notes: { description: "Trees" } }
  ];
  const { storyboard, dropped } = fitShotCallouts(story, shots);
  assert.deepEqual(dropped, ['clean: "Composite: regular cleaning"', 'grid: "Composite"']);
  // The last label gone takes the list with it: an empty one fails the module's schema.
  assert.equal("callouts" in storyboard.scenes[0].params, false);
  assert.equal(storyboard.scenes[1].params.items[0].label, "Hardwood");
  assert.equal("label" in storyboard.scenes[1].params.items[1], false);
  assert.equal(storyboard.scenes[2].params.callouts.length, 1);
  // The input is untouched, and shots without notes change nothing.
  assert.equal(story.scenes[0].params.callouts.length, 1);
  assert.equal(fitShotCallouts(story, [{ scene_id: "clean", src: "assets/shots/clean.mp4" }]).storyboard, story);
});

test("a bare topic question is not a hook; one with a number, a contrast or a stake is", () => {
  for (const text of ["Choosing deck boards for your home?", "Thinking about solar?", "Looking for a new CRM?", "Are you planning a kitchen reno?"]) assert.equal(isTopicQuestion(text), true, text);
  for (const text of ["Choosing between 3 boards?", "Are you choosing the wrong deck board?", "Why do decks rot?", "Looking for a new CRM.", "Low-upkeep boards still need care."]) assert.equal(isTopicQuestion(text), false, text);
});

test("hookThresholds takes the opening's limits from the cadence profile, and says where each comes from", () => {
  const motion = hookThresholds(null);
  assert.deepEqual([motion.claim_by, motion.entrance_max, motion.first_word_by], [0.5, 0.35, 0.5]);
  assert.equal(motion.sources.claim_by, "first_visual_seconds p90 of the short-motion profile (0.5 s)");
  assert.equal(motion.sources.entrance_max, "first_motion_seconds p90 of the short-motion profile (0.35 s)");
  const head = hookThresholds(null, { base: true });
  assert.deepEqual([head.claim_by, head.entrance_max, head.first_word_by], [1.5, 2, 2]);
  assert.match(head.sources.first_word_by, /the later of the two windows: first_motion_seconds p90 of the short-talking-head profile \(2 s\)/);
  // The story's own profile wins; a band of 0 is raised to the structure gate's first-frame limit.
  const own = hookThresholds({ id: "mine", measures: { first_visual_seconds: { p90: 0 }, first_motion_seconds: { p90: 0.8 } } });
  assert.deepEqual([own.claim_by, own.entrance_max, own.first_word_by, own.profile], [0.35, 0.8, 0.8, "mine"]);
  assert.match(own.sources.claim_by, /of the mine profile \(0 s\), raised to FIRST_FRAME_SECONDS \(0\.35 s\)/);
  // A profile without the band falls back to the shipped short profile.
  assert.equal(hookThresholds({ id: "thin", measures: {} }).sources.claim_by, "first_visual_seconds p90 of the short-motion profile (0.5 s)");
});

test("hookTiming: a claim on screen early, no logo open, a quick entrance and a voice that starts on time", () => {
  const image = (extra = {}, params = {}) => scene("s1", "photo-scene", { media: { kind: "image", src: "assets/deck.jpg" }, ...params }, { end: 3, ...extra });
  const title = (start) => scene("s2", "hook-title", { headline: "Your deck is rotting from below" }, { start, end: start + 3 });
  const words = (start) => [{ text: "Your", start, end: start + 0.2 }, { text: "deck", start: start + 0.2, end: start + 0.5 }];
  // The claim rides the opening image, the scene cuts in, the voice starts at once.
  const good = hookTiming(board([image({}, { lines: [{ text: "Your deck is rotting from below", at: 0 }] }), title(3)], 20), { words: words(0.3) });
  assert.equal(good.status, "passed", good.findings.join("\n"));
  assert.deepEqual(Object.keys(good.checks), ["claim", "logo_open", "entrance", "first_word"]);
  // A number is a claim; one word is a label.
  assert.equal(hookTiming(board([image({}, { title: "73%" })], 20)).checks.claim.ok, true);
  assert.equal(hookTiming(board([image({}, { title: "Decks" })], 20)).checks.claim.ok, false);
  // Text that arrives at 3 s is late; captions under a voice that has started count.
  const late = hookTiming(board([image(), title(3)], 20), { words: words(0.3) });
  assert.match(late.findings.join("\n"), /^claim: the first readable text \(s2\) arrives at 3 s, and there are no captions; a short needs its claim or question on screen by 0\.5 s/);
  const captioned = { ...board([image(), title(3)], 20), overlays: [{ type: "captions", style: "word-highlight" }] };
  assert.equal(hookTiming(captioned, { words: words(0.3) }).checks.claim.detail, "the captions put the spoken hook on screen from 0.3 s");
  assert.equal(hookTiming(captioned, { words: words(1.4) }).checks.claim.ok, false);
  // A logo open, a slow fade in and a late voice are each a finding.
  const slow = hookTiming(board([scene("logo", "brand-lockup", { wordmark: "Deckhand" }, { end: 2.5, in: { type: "fade", dur: 0.8 } }), title(2.5)], 20), { words: words(1.2) });
  assert.deepEqual(slow.findings.map((entry) => entry.split(":")[0]), ["claim", "logo_open", "entrance", "first_word"]);
  // A lockup that carries the claim is a title, not a wait.
  assert.equal(hookTiming(board([scene("logo", "brand-lockup", { wordmark: "Deckhand", headline: "Decks that last 20 years" }, { end: 2.5 })], 20)).status, "passed");
  assert.match(slow.checks.entrance.detail, /takes 0\.8 s to arrive .* keep the transition to 0\.35 s or less/);
  assert.match(slow.checks.first_word.detail, /spoken at 1\.2 s; a short starts talking by 0\.5 s/);
  // Over a recording the talking-head windows apply and a logo overlay is not the opening.
  const head = hookTiming({ ...board([scene("tag", "lower-third", { name: "Sam Lee", title: "Builder" }, { track: 1, start: 1.2, end: 4 })], 40), base: { src: "assets/base.mp4" } }, { words: words(1.6), base: true });
  assert.equal(head.status, "passed", head.findings.join("\n"));
  assert.equal(head.checks.logo_open, undefined);
  // Word anchors resolve through times; a long video is not a short.
  const anchored = board([{ ...image({}, { title: "Your deck is rotting" }), start: "word:your" }], 20);
  assert.equal(hookTiming(anchored).status, "skipped");
  assert.equal(hookTiming(anchored, { times: new Map([["s1", { start: 0.3, end: 3 }]]) }).status, "passed");
  assert.equal(hookTiming(board([image()], 300)).status, "skipped");
});

test("the planner repairs what a storyboard can fix; finish's gate adds the voice and the bare topic", () => {
  const story = board([scene("logo", "brand-lockup", { wordmark: "Deckhand", headline: "Decks" }, { end: 2 }), scene("s2", "photo-scene", { media: { kind: "image", src: "assets/deck.jpg" }, title: "Your deck is rotting" }, { start: 2, end: 5 })], 20);
  const words = [{ text: "Your", start: 1.1, end: 1.3 }];
  const errors = hookTimingErrors(story, { words });
  assert.equal(errors.length, 2, "the late voice is not a storyboard repair");
  assert.match(errors.join("\n"), /hook: the video opens on a logo alone \(logo, brand-lockup\)/);
  const gate = hookGate({ story, words });
  assert.equal(gate.status, "failed");
  assert.deepEqual(Object.keys(gate.checks), ["claim", "logo_open", "entrance", "first_word", "text"]);
  assert.deepEqual(gate.findings.map((entry) => entry.split(":")[0]), ["claim", "logo_open", "first_word", "text"]);
  assert.equal(gate.thresholds.profile, null);
  assert.equal(hookGate({ story: board([story.scenes[1]], 300), words }).status, "skipped");
});
