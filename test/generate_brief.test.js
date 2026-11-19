import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { commandHelp } from "../src/cli_usage.js";
import { EDGE_PAD_SECONDS, FOOTAGE_NEGATIVE, footageBrief, lookParagraph, refusalReason } from "../src/generate/brief.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "generate-brief");
const request = (over = {}) => ({ id: "s1-abc", scene_id: "s1", shows: "a barista pouring latte art, close up", type: "any", still: false, line: "Good coffee starts slow.", duration: 2, format: { width: 1080, height: 1920, aspect: "portrait" }, ...over });

async function cli(args) {
  let out = "";
  await runCli(args, { stdout: { write: (chunk) => { out += chunk; } }, stderr: { write() {} } });
  return out;
}

test("steps follow the request's type and still", () => {
  assert.deepEqual(footageBrief(request()).steps, ["image", "video"]);
  assert.deepEqual(footageBrief(request({ type: "video" })).steps, ["image", "video"]);
  const image = footageBrief(request({ type: "image" }));
  assert.deepEqual(image.steps, ["image"]);
  assert.equal(image.video, null);
  assert.deepEqual(footageBrief(request({ type: "video", still: true })).steps, ["image"]);
});

test("the prompt uses shows word for word, the line as context and the story's look", () => {
  const look = lookParagraph({ brand: { colors: { bg: "#0b0d1a", primary: "#ffb547" } }, look: "film" });
  assert.match(look, /#0b0d1a/);
  assert.match(look, /film/);
  const brief = footageBrief(request(), { look });
  assert.ok(brief.image.prompt.startsWith("a barista pouring latte art, close up."));
  assert.ok(brief.image.prompt.includes(look));
  assert.match(brief.image.prompt, /never shown as text.*"Good coffee starts slow\."/);
  assert.equal(brief.image.width, 1080);
  assert.equal(brief.image.height, 1920);
  assert.deepEqual(brief.image.references, []);
  // The motion prompt is motion and camera only: the subject lives in the keyframe.
  assert.ok(!brief.video.prompt.includes("barista"));
});

test("the negative forbids text, logos, UI and real people", () => {
  const { negative } = footageBrief(request()).image;
  assert.equal(negative, FOOTAGE_NEGATIVE);
  for (const word of ["text", "lettering", "logos", "user interface", "real or named people"]) assert.ok(negative.includes(word), word);
});

test("a backdrop asks for low motion and no strong subject", () => {
  const brief = footageBrief(request({ role: "background", motion: "low", type: "video" }));
  assert.match(brief.image.prompt, /no strong subject/);
  assert.match(brief.video.prompt, /^Low motion/);
});

test("video length is the duration plus the edge padding at each end", () => {
  assert.equal(EDGE_PAD_SECONDS, 0.3);
  const { video } = footageBrief(request({ duration: 2 }), { fps: 24 });
  assert.equal(video.seconds, 2.6);
  assert.equal(video.pad_seconds, EDGE_PAD_SECONDS);
  assert.equal(video.fps, 24);
});

test("the hash covers everything else and is stable", () => {
  const a = footageBrief(request());
  assert.match(a.brief_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(footageBrief(request()).brief_hash, a.brief_hash);
  // Key order does not change it; content does.
  assert.equal(footageBrief(Object.fromEntries(Object.entries(request()).reverse())).brief_hash, a.brief_hash);
  assert.notEqual(footageBrief(request({ duration: 3 })).brief_hash, a.brief_hash);
  assert.notEqual(footageBrief(request(), { look: "Look: other." }).brief_hash, a.brief_hash);
});

test("a request naming a real product, person or place is refused", () => {
  for (const shows of ["a man unboxing an iPhone", "Elon Musk on stage", "a crowd in Times Square", "a can of Brand™ soda", ""]) {
    assert.ok(refusalReason({ shows }), shows);
    assert.equal(footageBrief(request({ shows })), null, shows);
  }
  // A sentence's opening capital is not a name.
  assert.equal(refusalReason({ shows: "a calm, steady shot that sets the scene for: Hot coffee cools. Why? Your mug waits" }), null);
});

test("generate brief prints every shot request in a project without a provider", async () => {
  const text = await cli(["generate", "brief", FIXTURE]);
  assert.match(text, /# s1-[0-9a-f]{10} \(scene s1\)\nsteps: image → video/);
  assert.match(text, /# s2-[0-9a-f]{10} \(scene s2\)\nsteps: image\n/);
  assert.match(text, /# s4-[0-9a-f]{10} \(scene s4\)\nrefused: .*iPhone/);
  assert.match(text, /\(scene s5, backdrop\)/);
  assert.match(text, /"Good coffee starts slow\."/);

  const all = JSON.parse(await cli(["generate", "brief", FIXTURE, "--json"]));
  assert.deepEqual(all.map(({ request }) => request.scene_id), ["s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual(all.map(({ brief }) => brief?.steps ?? null), [["image", "video"], ["image"], ["image"], null, ["image", "video"]]);
  assert.equal(all[0].brief.video.seconds, 2.6);
  assert.equal(all[0].brief.video.fps, 30);

  const one = JSON.parse(await cli(["generate", "brief", FIXTURE, "--shot", "s3", "--json"]));
  assert.equal(one.length, 1);
  assert.equal(one[0].brief.image.prompt.split(".")[0], "a field of wheat at dawn");
  await assert.rejects(cli(["generate", "brief", FIXTURE, "--shot", "nope"]), /no shot request nope/);
  await assert.rejects(cli(["generate", "quote", FIXTURE]), /launchclip generate needs an action/);
  assert.match(commandHelp("generate", "brief"), /generate brief <project> \[--shot <id>\] \[--json\]/);
});
