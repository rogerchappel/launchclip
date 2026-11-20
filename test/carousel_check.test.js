import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { carouselPlanFindings, cutOff, namesSomething, slideText } from "@launchclip/core/carousel-check.mjs";
import { CAROUSEL_DESTINATIONS } from "@launchclip/core/carousel.mjs";
import { declaredTextBoxes, geometryFindings, measuredContrast, readPixels, run } from "../src/carousel/check.js";

const sample = () => JSON.parse(readFileSync(new URL("../examples/carousel/listicle-4x5/storyboard.json", import.meta.url), "utf8"));
const rules = (findings, rule) => findings.filter((finding) => finding.rule === rule);
// The sample with its cta matching its goal, so every plan rule passes.
const clean = () => { const story = sample(); story.scenes[4].params.action = "Save this habit list"; return story; };

test("the sample passes every plan rule once its cta matches its goal", () => {
  assert.deepEqual(carouselPlanFindings(clean()), []);
});

test("cover-promise: 3 to 12 words naming a subject or number", () => {
  const story = clean();
  story.scenes[0].params.headline = "You need to see this";
  assert.match(rules(carouselPlanFindings(story), "cover-promise")[0].reason, /names no specific/);
  story.scenes[0].params.headline = "Habits";
  assert.match(rules(carouselPlanFindings(story), "cover-promise")[0].reason, /1 word/);
  assert.ok(namesSomething("Seven ways to cut churn"));
  assert.ok(namesSomething("The 5 settings that halved our churn"));
  assert.ok(!namesSomething("This will change everything"));
});

test("one-idea: one headline, one supporting block, word budgets", () => {
  const story = clean();
  story.scenes[1].params.sub = "a second block";
  story.scenes[1].params.body = "and a third";
  assert.match(rules(carouselPlanFindings(story), "one-idea")[0].reason, /2 supporting blocks/);
  const long = clean();
  long.scenes[0].params.headline = "3 habits that make every single team on earth ship much faster now";
  const found = rules(carouselPlanFindings(long), "one-idea");
  assert.equal(found[0].slide, 1);
  assert.match(found[0].reason, /reads in 12 or fewer/);
  assert.deepEqual(slideText(story.scenes[3]).supports.map((block) => block.key), ["items"]);
});

test("one-idea: a template's byline, author and footer do not count against the cover", () => {
  const story = clean();
  // 10 words of headline, as a plain-note cover sets it, under the brand's name and handle.
  story.scenes[0].module = "quote-card";
  story.scenes[0].params = { quote: "Seven small habits that let tiny teams ship work fast", author: "Acme Studio Labs", role: "@acme", variant: "post" };
  assert.deepEqual(rules(carouselPlanFindings(story), "one-idea"), []);
  story.scenes[0].params.quote += " every single week";
  assert.match(rules(carouselPlanFindings(story), "one-idea")[0].reason, /^13 words/);
  // numbered-steps sets its swipe line as the cover panel's body.
  const steps = clean();
  steps.scenes[0].module = "split-screen";
  steps.scenes[0].params = { media: "assets/a.jpg", variant: "top", title: "HOW TO BREW POUR-OVER COFFEE AT HOME IN FIVE STEPS", body: "SWIPE FOR THE STEPS" };
  assert.deepEqual(rules(carouselPlanFindings(steps), "one-idea"), []);
});

test("continuity: a slide that switches its look warns", () => {
  const story = clean();
  story.scenes[2].params.tone = "light";
  const [finding] = rules(carouselPlanFindings(story), "continuity");
  assert.equal(finding.slide, 3);
  assert.equal(finding.level, "warn");
});

test("swipe-cue: a swipe kicker, a counter on slide 2 or a carry; none needed for quote", () => {
  const story = clean();
  delete story.scenes[0].params.kicker;
  story.scenes[1].params.kicker = "Rule";
  assert.equal(rules(carouselPlanFindings(story), "swipe-cue")[0].level, "fail");
  story.scenes[1].params.kicker = "1/3";
  assert.deepEqual(rules(carouselPlanFindings(story), "swipe-cue"), []);
  story.scenes[1].params.kicker = "Rule";
  story.scenes[0].carry = { to: "habit-1" };
  assert.deepEqual(rules(carouselPlanFindings(story), "swipe-cue"), []);
  delete story.scenes[0].carry;
  story.carousel.arc = "quote";
  assert.deepEqual(rules(carouselPlanFindings(story), "swipe-cue"), []);
});

test("payoff: required for a listicle, best second-to-last", () => {
  const story = clean();
  story.scenes[3].slide.role = "body";
  assert.equal(rules(carouselPlanFindings(story), "payoff")[0].level, "fail");
  const moved = clean();
  moved.scenes[3].slide.role = "body";
  moved.scenes[1].slide.role = "payoff";
  const [finding] = rules(carouselPlanFindings(moved), "payoff");
  assert.equal(finding.level, "warn");
  assert.equal(finding.slide, 2);
});

test("cta-match: the cta slide's wording matches the goal", () => {
  assert.deepEqual(rules(carouselPlanFindings(sample()), "cta-match"), [], "the sample's cta asks for the save its goal names");
  const mismatch = sample();
  mismatch.scenes[4].params.action = "Follow for a habit a week";
  mismatch.carousel.caption.cta = "Follow for more";
  const [finding] = rules(carouselPlanFindings(mismatch), "cta-match");
  assert.equal(finding.slide, 5);
  assert.equal(finding.level, "fail");
  mismatch.carousel.goal = "follow";
  assert.deepEqual(rules(carouselPlanFindings(mismatch), "cta-match"), []);
});

test("alt-text: present, not a file name, long enough to describe", () => {
  const story = clean();
  story.scenes[1].slide.alt = "";
  story.scenes[2].slide.alt = "slide-03.png";
  story.scenes[3].slide.alt = "Checklist";
  const found = rules(carouselPlanFindings(story), "alt-text");
  assert.deepEqual(found.map((finding) => [finding.slide, finding.level]), [[2, "fail"], [3, "fail"], [4, "warn"]]);
});

test("claims: a result-type number needs a source", () => {
  const story = clean();
  story.scenes[1].params.headline = "Decide in the thread: 40% fewer meetings";
  assert.equal(rules(carouselPlanFindings(story), "claims")[0].slide, 2);
  story.scenes[1].params.source = "Internal survey, 2026";
  assert.deepEqual(rules(carouselPlanFindings(story), "claims"), []);
  // A count of items ("3 habits") is not a claim.
  assert.deepEqual(rules(carouselPlanFindings(clean()), "claims"), []);
});

test("filler: stock phrases fail on slides and in the caption", () => {
  assert.deepEqual(rules(carouselPlanFindings(clean()), "filler"), []);
  const story = clean();
  story.scenes[2].params.headline = "This habit is a real game-changer";
  story.carousel.caption.body = "Unlock your potential with three small habits.";
  const found = rules(carouselPlanFindings(story), "filler");
  assert.deepEqual(found.map((finding) => [finding.slide, finding.level]), [[3, "fail"], [null, "fail"]]);
  assert.match(found[0].reason, /game-changer/);
  assert.match(found[1].reason, /caption\.body/);
});

test("hook-length: the caption hook and cover headline at 4 to 14 words; under 3 fails", () => {
  assert.deepEqual(rules(carouselPlanFindings(clean()), "hook-length"), []);
  const story = clean();
  story.carousel.caption.hook = "Ship faster.";
  story.scenes[0].params.headline = "Three habits for speed";
  assert.deepEqual(rules(carouselPlanFindings(story), "hook-length").map((finding) => [finding.slide, finding.level]), [[null, "fail"]]);
  story.carousel.caption.hook = "Teams ship faster";
  story.scenes[0].params.headline = "The three habits that let the fastest teams we studied ship every single working day";
  assert.deepEqual(rules(carouselPlanFindings(story), "hook-length").map((finding) => [finding.slide, finding.level]), [[null, "warn"], [1, "warn"]]);
});

test("cut-off: a headline left hanging, or body stopped mid-sentence", () => {
  assert.deepEqual(rules(carouselPlanFindings(clean()), "cut-off"), []);
  assert.equal(cutOff("Ship the smallest change that works"), null);
  assert.match(cutOff("Ship the smallest change…"), /ellipsis/);
  assert.match(cutOff("Ship the smallest change..."), /ellipsis/);
  assert.match(cutOff("Decide in the thread, not in the"), /ends on "the"/);
  assert.match(cutOff("Three habits you can"), /ends on "can"/);
  assert.match(cutOff("Decide in writing. Then the team moves on without", { prose: true }) ?? "", /mid-sentence/);
  assert.equal(cutOff("Decide in writing. Then move on.", { prose: true }), null);
  assert.equal(cutOff("From teams that ship daily", { prose: true }), null, "a one-line fragment is a style, not a cut");
  const story = clean();
  story.scenes[1].params.headline = "Decide in the thread, not in a…";
  story.scenes[2].params.sub = "Small changes review fast. Big ones wait for the";
  const found = rules(carouselPlanFindings(story), "cut-off");
  assert.deepEqual(found.map((finding) => [finding.slide, finding.level]), [[2, "fail"], [3, "fail"]]);
  assert.match(found[1].reason, /params\.sub ends on "the"/);
});

test("restated-ending: a last slide that only repeats the deck", () => {
  assert.deepEqual(rules(carouselPlanFindings(clean()), "restated-ending"), []);
  const story = clean();
  story.scenes[4].params.action = "Save this: decide in the thread, ship the smallest change";
  const found = rules(carouselPlanFindings(story), "restated-ending");
  assert.deepEqual(found.map((finding) => [finding.slide, finding.level]), [[5, "warn"]]);
  // A deck that ends on its payoff summary repeats by design.
  const payoffLast = clean();
  payoffLast.scenes = payoffLast.scenes.slice(0, 4);
  payoffLast.scenes[3].params.items = [{ label: "Decide in the thread" }, { label: "Ship the smallest change" }];
  assert.deepEqual(rules(carouselPlanFindings(payoffLast), "restated-ending"), []);
});

test("duplicates: the same headline or body on two slides", () => {
  assert.deepEqual(rules(carouselPlanFindings(clean()), "duplicates"), []);
  const story = clean();
  story.scenes[2].params.headline = "Decide in the thread — not in a meeting!";
  story.scenes[1].params.sub = "Writing it down ends the debate.";
  story.scenes[2].params.sub = "Writing it down ends the debate.";
  const found = rules(carouselPlanFindings(story), "duplicates");
  assert.deepEqual(found.map((finding) => [finding.slide, finding.level]), [[3, "fail"], [3, "fail"]]);
  assert.match(found[0].reason, /headline as slide 2/);
  assert.match(found[1].reason, /body text as slide 2/);
});

test("word-budget: max(6, 3 per slide) to 28 per slide across the deck", () => {
  assert.deepEqual(rules(carouselPlanFindings(clean()), "word-budget"), []);
  const thin = clean();
  for (const scene of thin.scenes) scene.params = { headline: "Go" };
  assert.deepEqual(rules(carouselPlanFindings(thin), "word-budget").map((finding) => finding.level), ["warn"]);
  const long = clean();
  const sentence = "Every habit here comes from teams that ship daily and write things down first. ";
  long.scenes.forEach((scene) => { scene.params.sub = sentence.repeat(3).trim(); });
  const found = rules(carouselPlanFindings(long), "word-budget");
  assert.deepEqual(found.map((finding) => finding.level), ["fail"]);
  assert.match(found[0].reason, /over 140/);
});

test("scaffold-leak: planning labels in slide copy or the caption", () => {
  assert.deepEqual(rules(carouselPlanFindings(clean()), "scaffold-leak"), []);
  const story = clean();
  story.scenes[1].params.headline = "Slide 2: Decide in the thread";
  story.scenes[2].params.sub = "[image of a merged pull request]";
  story.carousel.caption.hook = "Hook: most teams are not slow, they wait";
  const found = rules(carouselPlanFindings(story), "scaffold-leak");
  assert.deepEqual(found.map((finding) => [finding.slide, finding.level]), [[2, "fail"], [3, "fail"], [null, "fail"]]);
  // A numbered step is copy, not a label.
  const steps = clean();
  steps.scenes[1].params.headline = "Step 1: decide in the thread";
  assert.deepEqual(rules(carouselPlanFindings(steps), "scaffold-leak"), []);
});

test("type-size and safe-zone on declared boxes", () => {
  const dest = CAROUSEL_DESTINATIONS.instagram;
  const rect = { x: 80, y: 200, width: 860, height: 600 };
  const box = (texts, role = "body") => [{ slide: 1, role, texts: texts.map((text) => ({ rect, ...text })) }];
  // type-size: font floors of 52 px (headline) and 46 px (body) at 1080 wide, scaled by width.
  assert.deepEqual(geometryFindings(box([{ role: "headline", fontSize: 52 }], "cover"), dest), []);
  assert.match(geometryFindings(box([{ role: "headline", fontSize: 50 }], "cover"), dest)[0].reason, /50 px; at 1080 px wide it needs 52 px/);
  assert.equal(geometryFindings(box([{ role: "body", fontSize: 45 }]), dest)[0].level, "fail");
  assert.deepEqual(geometryFindings(box([{ role: "body", fontSize: 46 }]), dest), []);
  const half = { ...dest, width: 540, height: 675 };
  assert.deepEqual(rules(geometryFindings(box([{ role: "body", fontSize: 23 }]), half), "type-size"), [], "scaled by width");
  assert.equal(rules(geometryFindings(box([{ role: "body", fontSize: 22 }]), half), "type-size").length, 1);
  // safe-zone: px margins per destination (4:5 96/72/96/72, 9:16 180/72/240/72).
  assert.deepEqual(rules(geometryFindings(box([{ role: "body", fontSize: 120 }]), CAROUSEL_DESTINATIONS.tiktok), "safe-zone"), []);
  const wide = [{ slide: 1, role: "body", texts: [{ role: "body", fontSize: 72, rect: { x: 60, y: 90, width: 960, height: 600 } }] }];
  assert.match(rules(geometryFindings(wide, dest), "safe-zone")[0].reason, /6 px into the top zone, 12 px into the left zone, 12 px into the right zone/);
  const low = [{ slide: 1, role: "body", texts: [{ role: "body", fontSize: 72, rect: { x: 80, y: 1500, width: 860, height: 300 } }] }];
  assert.match(rules(geometryFindings(low, CAROUSEL_DESTINATIONS.tiktok), "safe-zone")[0].reason, /^text runs 120 px into the bottom zone/);
});

test("the sample's declared boxes at 4:5 and 9:16", () => {
  const story = sample();
  const four = declaredTextBoxes(story, { width: 1080, height: 1350 });
  assert.equal(four.length, 5);
  assert.equal(four[0].texts[0].role, "headline");
  assert.ok(four.every((box) => !box.error && box.texts.length));
  const tall = declaredTextBoxes(story, { width: 1080, height: 1920 });
  assert.ok(tall[0].texts[0].rect.y !== four[0].texts[0].rect.y, "laid out again for the taller canvas");
});

test("every carousel sample's declared text clears safe-zone on instagram, linkedin, tiktok and meta-ads", () => {
  const dir = new URL("../examples/carousel/", import.meta.url);
  const failures = [];
  for (const name of readdirSync(dir)) {
    const file = new URL(`${name}/storyboard.json`, dir);
    if (!existsSync(file)) continue;
    const story = JSON.parse(readFileSync(file, "utf8"));
    // A sample with explicit 4:5 rects (a seam panorama) is held to its own destinations only.
    const dests = new Set([...(story.carousel?.destinations ?? []), ...(story.scenes.some((scene) => scene.params?.rect) ? [] : ["instagram", "linkedin", "tiktok", "meta-ads"])]);
    for (const id of dests) {
      const dest = CAROUSEL_DESTINATIONS[id];
      for (const finding of geometryFindings(declaredTextBoxes(story, dest), dest)) if (finding.rule === "safe-zone") failures.push(`${name} ${id} slide ${finding.slide}: ${finding.reason}`);
    }
  }
  assert.deepEqual(failures, []);
});

// Synthetic slides: a flat background with ink bars in a rect.
function image(width, height, bg, ink, rect) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const inRect = rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    const color = inRect && Math.floor((y - rect.y) / 12) % 3 === 0 && Math.floor((x - rect.x) / 10) % 2 === 0 ? ink : bg;
    data.set(color, (y * width + x) * 3);
  }
  return { width, height, data };
}
function writePng(file, { width, height, data }) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-i", "pipe:0", "-frames:v", "1", file], { input: data });
}

test("measuredContrast: ink against the box's background", () => {
  const rect = { x: 10, y: 10, width: 200, height: 100 };
  assert.ok(measuredContrast(image(240, 140, [255, 255, 255], [0, 0, 0], rect), rect) > 20);
  const grey = measuredContrast(image(240, 140, [255, 255, 255], [190, 190, 190], rect), rect);
  assert.ok(grey > 1.5 && grey < 3, `light grey on white is low contrast (${grey})`);
  assert.equal(measuredContrast(image(240, 140, [20, 20, 20], [20, 20, 20], rect), rect), null, "no ink, nothing to measure");
});

// The text box of a real render (sample slide 2, Remotion, quarter size): white
// and red type on a dark red glow, which outnumbers the type.
const REAL = fileURLToPath(new URL("./fixtures/carousel/habit-slide-text-box.png", import.meta.url));

test("contrast on a real render: the glow behind the type is not the ink", { timeout: 30000 }, async () => {
  const rect = { x: 0, y: 0, width: 215, height: 204 };
  const real = measuredContrast(await readPixels(REAL, 215, 204), rect);
  assert.ok(real > 10, `white type on the dark glow reads well over AA (${real})`);
  // The same slide with its contrast flattened is a real low-contrast case.
  const dir = mkdtempSync(path.join(os.tmpdir(), "carousel-low-"));
  try {
    const low = path.join(dir, "low.png");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", REAL, "-vf", "eq=contrast=0.3:brightness=0.1", low]);
    const ratio = measuredContrast(await readPixels(low, 215, 204), rect);
    assert.ok(ratio < 3, `flattened, it fails AA (${ratio})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readPixels reads a PNG back at a size", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "carousel-px-"));
  try {
    const file = path.join(dir, "a.png");
    writePng(file, image(64, 80, [255, 0, 0], [0, 0, 0]));
    const pixels = await readPixels(file, 32, 40);
    assert.equal(pixels.data.length, 32 * 40 * 3);
    assert.deepEqual([...pixels.data.subarray(0, 3)], [255, 0, 0]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("carousel check on a project: plan only without a render, then pixel rules on render.json", { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "carousel-check-"));
  const exitCode = process.exitCode;
  try {
    const story = clean();
    story.carousel.destinations = ["instagram"];
    writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(story));
    let out = "";
    const io = { stdout: { write: (text) => { out += text; } } };

    const before = await run(dir, {}, io);
    assert.equal(before.destinations[0].rendered, false);
    assert.deepEqual(before.destinations[0].skipped, ["contrast", "cover-thumbnail"]);
    assert.match(out, /skipped contrast, cover-thumbnail/);
    assert.ok(existsSync(path.join(dir, "carousel", "check.json")));

    // Render at half size: the check scales to the destination's canvas.
    const boxes = declaredTextBoxes(story, { width: 1080, height: 1350 });
    const render = path.join(dir, "carousel", "instagram");
    mkdirSync(render, { recursive: true });
    const half = (rect) => ({ x: rect.x / 2, y: rect.y / 2, width: rect.width / 2, height: rect.height / 2 });
    boxes.forEach((box, i) => {
      // Slide 3: grey text on a grey ground.
      const ink = i === 2 ? [120, 120, 120] : [242, 238, 230];
      const bg = i === 2 ? [90, 90, 90] : [21, 21, 21];
      writePng(path.join(render, `slide-${i + 1}.png`), image(540, 675, bg, ink, half(box.texts[0].rect)));
    });
    writeFileSync(path.join(render, "render.json"), JSON.stringify({ slides: boxes.map((box, i) => ({ id: box.id, files: [`slide-${i + 1}.png`], width: 540, height: 675 })) }));

    out = "";
    const after = await run(dir, { json: true }, io);
    const dest = after.destinations[0];
    assert.equal(dest.rendered, true);
    assert.deepEqual(rules(dest.findings, "contrast").map((finding) => finding.slide), [3]);
    assert.deepEqual(rules(dest.findings, "cover-thumbnail"), []);
    assert.equal(after.status, "failed");
    assert.equal(process.exitCode, 1);
    assert.equal(JSON.parse(out).status, "failed");
  } finally {
    process.exitCode = exitCode;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cover-thumbnail: a small cover headline fails at feed size", { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "carousel-thumb-"));
  const exitCode = process.exitCode;
  try {
    const story = clean();
    story.carousel.destinations = ["instagram"];
    writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(story));
    const boxes = declaredTextBoxes(story, { width: 1080, height: 1350 });
    const render = path.join(dir, "carousel", "instagram");
    mkdirSync(render, { recursive: true });
    // The render reports the cover's measured headline: 40 px, too small for a thumbnail.
    const rect = boxes[0].texts[0].rect;
    writePng(path.join(render, "01.png"), image(1080, 1350, [21, 21, 21], [242, 238, 230], rect));
    writeFileSync(path.join(render, "render.json"), JSON.stringify({ slides: [{ file: "01.png", texts: [{ role: "headline", rect, fontSize: 40 }] }] }));
    const report = await run(dir, {}, { stdout: { write() {} } });
    const thumb = rules(report.destinations[0].findings, "cover-thumbnail");
    assert.equal(thumb.length, 1);
    assert.match(thumb[0].reason, /cap height is 4\.1 px/);
  } finally {
    process.exitCode = exitCode;
    rmSync(dir, { recursive: true, force: true });
  }
});
