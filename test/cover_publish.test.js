import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { COVER_SECONDS, coverHeadline, coverStory, resolveStory, validateStory } from "../kit/core/story.mjs";
import { planningPrompt } from "../kit/core/planning-prompt.mjs";
import { checkLayoutProject } from "../src/layout_check.js";
import { moduleParamErrors } from "../src/story_cli.js";
import { buildPublishManifest, platformFit, withUtm, writePublishManifest } from "../src/publish_manifest.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const WORDS = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;

async function minimalStory() {
  return JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
}

// The minimal story with a cover; s1's metric fits what the card leaves of it.
async function coveredStory(cover) {
  const story = await minimalStory();
  story.cover = cover;
  story.scenes[0].params.metric.values = [{ value: 12, at: 0.3 }];
  delete story.scenes[0].hits;
  return story;
}

test("validateStory checks the cover's text, kicker, number and frame", async () => {
  const story = await minimalStory();
  const check = (cover, extra = {}) => validateStory({ ...story, ...extra, cover });
  assert.deepEqual(check({ text: "100g protein. All at once?", number: "100g" }).errors, []);
  assert.deepEqual(check({ text: "Twelve-minute builds", frame: 2.5 }).errors, []);
  assert.match(check({}).errors.join("\n"), /cover\.text is required/);
  assert.match(check({ text: "one two three four five six seven eight nine" }).errors.join("\n"), /at most 6 words/);
  assert.match(check({ text: "one two three four five six seven", frame: 1 }).warnings.join("\n"), /runs 7 words/);
  assert.match(check({ text: "Fast", kicker: "a sticker far too long" }).errors.join("\n"), /cover\.kicker must be 1-18/);
  assert.match(check({ text: "Fast", number: "" }).errors.join("\n"), /cover\.number/);
  assert.match(check({ text: "Fast", frame: "last" }).errors.join("\n"), /cover\.frame must be "first" or the seconds/);
  assert.match(check({ text: "Fast", frame: 6 }).errors.join("\n"), /not within format\.duration/);
  assert.match(check({ text: "Fast", subtitle: "x" }).errors.join("\n"), /cover\.subtitle is not a cover field/);
  // frame "first": the card takes the first 1.5 s, so a scene that ends under it cannot stay.
  const short = structuredClone(story);
  short.scenes[0].end = 1.8;
  short.scenes[1].start = 1.8;
  assert.match(check({ text: "Fast" }, { scenes: short.scenes }).errors.join("\n"), /scenes\[0\] \(s1\) ends at 1\.8 s, under the cover card/);
  const named = structuredClone(story.scenes);
  named[1].id = "cover";
  assert.match(check({ text: "Fast" }, { scenes: named, ending: null }).errors.join("\n"), /"cover" is the cover card's id/);
});

test("a story without a cover resolves exactly as before", async () => {
  const story = await minimalStory();
  const resolved = resolveStory(story, { words: WORDS });
  assert.deepEqual(resolved.scenes.map((scene) => [scene.id, scene.module, scene.start, scene.end]), [["s1", "metric", 0, 3], ["s2", "checklist", 3, 6]]);  assert.equal(resolved.ending.loop_to, "s1");
  assert.equal(resolved.cover, undefined);
});

test("cover.frame first opens the video on a hook-title card that passes the layout check", async () => {
  const story = await coveredStory({ text: "100g protein. All at once?", number: "100g", kicker: "Myth?" });
  assert.deepEqual(validateStory(story).errors, []);
  const resolved = resolveStory(story, { words: WORDS });
  assert.deepEqual(resolved.scenes.map((scene) => [scene.id, scene.module, scene.start, scene.end]), [["cover", "hook-title", 0, COVER_SECONDS], ["s1", "metric", COVER_SECONDS, 3], ["s2", "checklist", 3, 6]]);
  assert.deepEqual(resolved.scenes[0].params, { headline: "100g protein. All at once?", emphasis: "100g", kicker: "Myth?" });
  assert.equal(resolved.ending.loop_to, "cover", "the loop returns to the card");
  assert.deepEqual(validateStory(resolved).errors, []);
  assert.deepEqual(moduleParamErrors(resolved), []);
  assert.deepEqual(resolveStory(resolved, { words: WORDS }).scenes.map((scene) => scene.id), ["cover", "s1", "s2"], "resolving twice adds one card");
  // Frame 0 reads: the card is inside the Shorts safe zone, at a readable size, with nothing over it.
  const layout = await checkLayoutProject(MINIMAL, { story });
  assert.equal(layout.status, "passed", JSON.stringify(layout.findings));
  assert.deepEqual(layout.findings.filter((finding) => finding.ids?.includes("cover")), []);
  const card = layout.rects.find((entry) => entry.id === "cover");
  assert.deepEqual([card.start, card.end], [0, COVER_SECONDS], "the layout check measures the card on frame 0");

  // Footage-led: the card is a full-frame insert over the presenter.
  const footage = resolveStory({ ...story, lane: "footage-led", base: "assets/recording.mp4", scenes: story.scenes.map((scene) => ({ ...scene, track: 1 })) }, { words: WORDS });
  assert.equal(footage.scenes[0].insert, true);
});

test("coverHeadline leads with the number unless the text says it; coverStory is the card alone", async () => {
  assert.equal(coverHeadline({ text: "Which builds more muscle?", number: "10 vs 25" }), "10 vs 25 Which builds more muscle?");
  assert.equal(coverHeadline({ text: "100G protein. All at once?", number: "100g" }), "100G protein. All at once?");
  assert.equal(coverHeadline({ text: "Faster builds" }), "Faster builds");
  const story = await coveredStory({ text: "Faster builds?", number: 4, frame: 2 });
  const card = coverStory(story);
  assert.equal(card.format.duration, 3);
  assert.deepEqual(card.brand, story.brand);
  assert.equal(card.overlays, undefined, "no captions on the cover");
  assert.deepEqual(validateStory(card).errors, []);
  assert.deepEqual(moduleParamErrors(resolveStory(card)), []);
  // A cover frame in seconds leaves the video's timeline alone.
  assert.deepEqual(resolveStory(story, { words: WORDS }).scenes.map((scene) => [scene.id, scene.start]), [["s1", 0], ["s2", 3]]);
  const bare = await minimalStory();
  assert.throws(() => coverStory(bare), /no cover/);
});

test("the planning prompt asks for a cover on Shorts only", () => {
  const brand = { colors: { bg: "#000000", primary: "#ffffff", accent: "#ffcc00", ink: "#000000", paper: "#ffffff" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } };
  const short = planningPrompt({ lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 30 }, brand });
  assert.match(short, /## Cover \(Shorts\)/);
  assert.match(short, /never lead with the brand/);
  assert.match(short, /at most 6 words/);
  assert.doesNotMatch(planningPrompt({ lane: "motion", format: { width: 1920, height: 1080, fps: 30, duration: 30 }, brand }), /Cover \(Shorts\)/);
  assert.doesNotMatch(planningPrompt({ lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 90 }, brand }), /Cover \(Shorts\)/);
});

test("platformFit applies the platform limits", () => {
  const vertical = { aspect: "9:16", portrait: true, upright: true };
  assert.equal(platformFit("youtube_shorts", { ...vertical, duration: 180 }).fits, true);
  assert.equal(platformFit("youtube_shorts", { ...vertical, duration: 181 }).fits, false);
  assert.match(platformFit("youtube_shorts", { aspect: "16:9", portrait: false, upright: false, duration: 30 }).notes, /landscape/);
  assert.equal(platformFit("linkedin", { ...vertical, duration: 20 }).fits, true);
  assert.equal(platformFit("linkedin", { ...vertical, duration: 45 }).fits, false);
  assert.match(platformFit("linkedin", { ...vertical, duration: 45 }).notes, /recommends 15-30 s/);
  assert.equal(platformFit("app_store", { ...vertical, duration: 14 }).fits, false);
  assert.equal(platformFit("app_store", { ...vertical, duration: 30 }).fits, true);
  assert.equal(platformFit("reels", { ...vertical, duration: 200 }).fits, false);
  assert.equal(platformFit("x", { ...vertical, duration: 141 }).fits, false);
  assert.equal(platformFit("tiktok", { ...vertical, duration: 600 }).fits, true);
  assert.equal(platformFit("product_hunt", { ...vertical, duration: 30, cta: { text: "Upvote us on launch day" } }).fits, false);
  assert.match(platformFit("product_hunt", { ...vertical, duration: 30, cta: { text: "Try it free" } }).notes, /YouTube link/);
});

test("withUtm tags a link per platform", () => {
  assert.equal(withUtm("https://example.com/p?ref=a", { source: "tiktok", campaign: "launch" }), "https://example.com/p?ref=a&utm_source=tiktok&utm_medium=video&utm_campaign=launch");
  assert.equal(withUtm("https://example.com/?utm_source=old", { source: "x", campaign: "c" }), "https://example.com/?utm_source=x&utm_medium=video&utm_campaign=c");
  assert.throws(() => withUtm("example.com", { source: "x", campaign: "c" }), /absolute URL/);
});

test("buildPublishManifest reads titles from the script, the CTA from the story, and flags upvotes", async () => {
  const story = await minimalStory();
  story.audio.narration = { text: "Builds took forty-eight minutes. Now twelve. Three changes did it. Upvote us on Product Hunt!" };
  const script = { title: "Cut CI from 48 to 12 minutes", title_options: ["Three changes: 48 → 12 minute builds", { title: "You won't believe this one trick" }], narration: story.audio.narration.text };
  const manifest = buildPublishManifest({ story, script, files: { video: "renders/final.mp4", cover: "video/cover.png", captions: "renders/final.srt" }, options: { link: "https://ledgerly.dev", utm: "auto", platforms: "product_hunt" } });
  assert.equal(manifest.schema_version, "launchclip.publish.v1");
  assert.equal(manifest.title, "Cut CI from 48 to 12 minutes");
  assert.deepEqual(manifest.title_options, ["Cut CI from 48 to 12 minutes", "Three changes: 48 → 12 minute builds", "You won't believe this one trick"]);
  assert.equal(manifest.description, "Builds took forty-eight minutes. Now twelve.\n\nUpvote us on Product Hunt!\n\nhttps://ledgerly.dev");
  assert.deepEqual(manifest.cta, { text: "Upvote us on Product Hunt!", url: "https://ledgerly.dev" });
  assert.equal(manifest.aspect, "9:16");
  assert.equal(manifest.duration_seconds, 6);
  assert.equal(manifest.video, "renders/final.mp4");
  assert.equal(manifest.cover, "video/cover.png");
  assert.equal(manifest.captions, "renders/final.srt");
  assert.deepEqual(manifest.hashtags, ["#minutes", "#Shorts"]);
  assert.deepEqual(Object.keys(manifest.platforms), ["youtube_shorts", "tiktok", "reels", "youtube", "linkedin", "x", "product_hunt"]);
  assert.equal(manifest.platforms.linkedin.fits, false, "6 s is under LinkedIn's recommended 15-30 s");
  assert.equal(manifest.platforms.tiktok.url, "https://ledgerly.dev/?utm_source=tiktok&utm_medium=video&utm_campaign=cut-ci-from-48-to-12-minutes");
  assert.equal(manifest.platforms.product_hunt.url, undefined, "Product Hunt takes a YouTube link");
  assert.equal(manifest.platforms.product_hunt.fits, false);
  assert.ok(manifest.warnings.some((warning) => /asks for upvotes/.test(warning)));
  assert.ok(manifest.warnings.some((warning) => /teases/.test(warning)));
  // No script: the storyboard's title; a cta scene gives the CTA and its URL.
  story.scenes[1] = { id: "s2", module: "cta", start: 3, end: 6, params: { action: "Try Ledgerly free", handle: "ledgerly.dev/start" } };
  const plain = buildPublishManifest({ story });
  assert.equal(plain.title, "Minimal dual-renderer story");
  assert.deepEqual(plain.title_options, ["Minimal dual-renderer story"]);
  assert.deepEqual(plain.cta, { text: "Try Ledgerly free", url: "https://ledgerly.dev/start" });
  assert.equal(plain.platforms.youtube_shorts.url, "https://ledgerly.dev/start");
  assert.equal(plain.platforms.app_store, undefined, "App Store only on request");
  assert.equal(plain.captions, undefined);
  delete story.scenes[1];
  story.scenes.length = 1;
  assert.throws(() => buildPublishManifest({ story: { ...story, audio: {} }, options: { utm: "launch" } }), /--utm needs a link/);
  assert.throws(() => buildPublishManifest({ story, options: { platforms: "myspace" } }), /unknown platform myspace/);
});

test("launchclip publish-manifest writes publish.json for a project", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-publish-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    await mkdir(path.join(project, "renders"), { recursive: true });
    await writeFile(path.join(project, "renders/final.mp4"), "video");
    await writeFile(path.join(project, "renders/final.vtt"), "WEBVTT\n");
    await writeFile(path.join(project, "SCRIPT.json"), JSON.stringify({ title: "Builds in 12 minutes", narration: "Builds took forty-eight minutes. Now twelve." }));
    const output = [];
    await runCli(["publish-manifest", project, "--link", "https://example.com", "--utm", "spring", "--platforms", "app_store"], { stdout: { write: (value) => output.push(value) } });
    const printed = JSON.parse(output.join(""));
    assert.equal(printed.file, path.join(project, "publish.json"));
    const manifest = JSON.parse(await readFile(path.join(project, "publish.json"), "utf8"));
    assert.equal(manifest.title, "Builds in 12 minutes");
    assert.equal(manifest.video, "renders/final.mp4");
    assert.equal(manifest.captions, "renders/final.vtt");
    assert.equal(manifest.cover, null);
    assert.equal(manifest.platforms.app_store.fits, false);
    assert.equal(manifest.platforms.x.url, "https://example.com/?utm_source=x&utm_medium=video&utm_campaign=spring");
    const missing = await mkdtemp(path.join(os.tmpdir(), "launchclip-publish-none-"));
    await assert.rejects(writePublishManifest(missing), /needs .*storyboard\.json/);
    await rm(missing, { recursive: true, force: true });
    const help = [];
    await runCli(["publish-manifest", "--help"], { stdout: { write: (value) => help.push(value) } });
    assert.match(help.join(""), /publish-manifest <project> \[--link <url>\]/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
