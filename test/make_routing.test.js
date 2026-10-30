import assert from "node:assert/strict";
import test from "node:test";
import { durationFromPrompt, isLongForm, routeLane } from "../src/make/routing.js";

const entry = (path, kind, role, extra = {}) => ({ path, kind, role, confidence: 0.9, signals: ["test"], description: `${role} ${path}`, ...extra });
const head = (path, duration = 40, orientation = "portrait") => entry(path, "video", "talking-head", { media: { kind: "video", duration, orientation, width: 720, height: 1280, mountable: true }, speech: { present: true } });
const narratedDemo = (path, duration = 30) => entry(path, "video", "screen-recording", { media: { kind: "video", duration, orientation: "landscape", width: 1920, height: 1080, mountable: true }, speech: { present: true } });
const demo = (path) => entry(path, "video", "screen-recording", { media: { kind: "video", duration: 12, orientation: "landscape", width: 1920, height: 1080, mountable: true }, speech: { present: false } });
const shot = (path) => entry(path, "image", "screenshot", { media: { kind: "image", width: 1600, height: 900 } });
const logo = (path) => entry(path, "image", "logo", { media: { kind: "image", width: 512, height: 512, alpha: true } });
const voiceover = (path, duration = 28) => entry(path, "audio", "voiceover", { media: { kind: "audio", duration }, speech: { present: true } });
const music = (path) => entry(path, "audio", "music", { media: { kind: "audio", duration: 60 } });
const route = (entries, options = {}) => routeLane({ entries }, options);

test("no assets, or only images and silent demos: motion with generated narration", () => {
  assert.equal(route([]).lane, "motion");
  const result = route([shot("home.png"), demo("demo.mp4"), logo("logo.png")], { prompt: "A 45-second launch video" });
  assert.equal(result.lane, "motion");
  assert.deepEqual(result.media.map((item) => item.path), ["home.png", "demo.mp4"]);
  assert.deepEqual(result.logos.map((item) => item.path), ["logo.png"]);
  assert.equal(result.format.duration, 45);
  assert.deepEqual([result.format.width, result.format.height], [1920, 1080]);
  assert.match(result.reasons[0], /motion/);
});

test("a voiceover routes to voiceover-motion, the longest one wins", () => {
  const result = route([voiceover("vo-short.wav", 10), voiceover("vo.wav", 31.4), shot("home.png")]);
  assert.equal(result.lane, "voiceover-motion");
  assert.equal(result.voiceover.path, "vo.wav");
  assert.equal(result.format.duration, 31.4);
  assert.ok(result.ignored.some((item) => item.path === "vo-short.wav"));
});

test("talking-head footage routes to footage-led and beats a voiceover and a narrated demo", () => {
  const result = route([narratedDemo("walkthrough.mp4", 60), voiceover("vo.wav"), head("me.mp4", 40), demo("demo.mp4"), shot("home.png")]);
  assert.equal(result.lane, "footage-led");
  assert.equal(result.base.path, "me.mp4");
  assert.deepEqual(result.media.map((item) => item.path), ["demo.mp4", "home.png"]);
  assert.ok(result.ignored.some((item) => item.path === "vo.wav" && /not mounted/.test(item.reason)));
  assert.ok(result.ignored.some((item) => item.path === "walkthrough.mp4"));
  // Format follows the base's orientation unless --aspect says otherwise.
  assert.equal(result.aspect, "9:16");
  assert.equal(route([head("me.mp4")], { aspect: "1:1" }).aspect, "1:1");
});

test("a narrated screen recording alone is the footage-led base", () => {
  const result = route([narratedDemo("walkthrough.mp4", 30)]);
  assert.equal(result.lane, "footage-led");
  assert.equal(result.base.path, "walkthrough.mp4");
  assert.equal(result.aspect, "16:9");
});

test("routing is deterministic and never depends on order", () => {
  const entries = [shot("b.png"), head("x.mp4"), music("bed.mp3"), voiceover("vo.wav")];
  const first = route(entries);
  const second = route([...entries].reverse());
  assert.equal(first.lane, second.lane);
  assert.equal(first.base.path, second.base.path);
  assert.equal(first.music.path, "bed.mp3");
});

test("flags and prompt durations", () => {
  assert.equal(durationFromPrompt("A 45-second launch video"), 45);
  assert.equal(durationFromPrompt("a 2 minute explainer"), 120);
  assert.equal(durationFromPrompt("a launch video"), null);
  assert.equal(route([], { duration: 20, prompt: "A 45-second video" }).format.duration, 20);
  assert.equal(route([]).format.duration, 30);
  assert.throws(() => route([], { aspect: "4:3" }), /--aspect must be one of/);
  assert.throws(() => route([], { duration: 1 }), /--duration must be between/);
});

test("a motion video over 3 minutes is long form, up to 20; a recording keeps its own length", () => {
  assert.equal(isLongForm(route([], { duration: 180 })), false);
  const long = route([], { duration: 600 });
  assert.equal(long.format.duration, 600);
  assert.equal(isLongForm(long), true);
  assert.equal(route([], { prompt: "a 10 minute explainer on the week in AI" }).format.duration, 600);
  assert.throws(() => route([], { duration: 1500 }), /between 3 and 1200/);
  assert.throws(() => route([head("me.mp4")], { duration: 600 }), /for motion videos \(long form\)/);
  assert.equal(isLongForm(route([head("me.mp4", 400)])), false);
});
