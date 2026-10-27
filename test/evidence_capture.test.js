// Evidence capture (src/evidence/): the launchclip.capture.v1 request, the
// frame-pure beat timeline, block and paywall detection, and consent buttons.
// The browser run itself is exercised by the samples in docs/EVIDENCE_CAPTURE.md.
import assert from "node:assert/strict";
import test from "node:test";
import { CAPTURE_SCHEMA, normalizeTarget, requestDuration, validateCaptureRequest } from "../src/evidence/request.js";
import { buildTimeline, cameraAt, clampCamera, stateAt, toWindow, viewOf } from "../src/evidence/timeline.js";
import { assertPublicUrl, blockReason, captureRegion, isRejectLabel, regionTiles } from "../src/evidence/capture.js";
import { chromeHeight, playerHtml, urlParts } from "../src/evidence/player.js";

const request = (extra = {}) => ({
  schema: CAPTURE_SCHEMA, id: "pr-39217", url: "https://github.com/dotnet/efcore/pull/39217/files", kind: "diff",
  viewport: { width: 1600, height: 1000 }, theme: "dark",
  beats: [{ at: 1.5, action: "select", target: { text: "gpt-6.1-terra" }, dur: 1 }, { at: 0, action: "scroll", target: "#diff-1" }],
  out: "assets/evidence/pr-39217.mp4",
  provenance: { source_title: "PR", fetched_at: "2026-10-27T05:00:00Z", publisher: "GitHub", published_at: "2026-10-16T17:45:34Z" },
  ...extra
});

test("a valid request normalises: defaults filled, beats sorted, targets as objects", () => {
  const { errors, request: r } = validateCaptureRequest(request());
  assert.deepEqual(errors, []);
  assert.equal(r.chrome, "dark");
  assert.equal(r.fps, 30);
  assert.deepEqual(r.beats.map((b) => b.action), ["scroll", "select"]);
  assert.deepEqual(r.beats[0].target, { selector: "#diff-1" });
  assert.equal(r.beats[0].dur, 1.2);
  assert.equal(requestDuration(r), 2.5 + 1.2);
  assert.deepEqual(normalizeTarget({ text: "x", closest: "tr", nth: 2 }), { text: "x", closest: "tr", nth: 2 });
});

test("the validator names each problem", () => {
  const { errors } = validateCaptureRequest(request({
    schema: "x", id: "../bad", url: "ftp://example.com", kind: "tweet", viewport: { width: 1601, height: 1000 },
    beats: [{ at: 0, action: "select", target: "#a" }, { at: 1, action: "zoom" }, { at: 2, action: "pin" }, { at: -1, action: "dance" }],
    out: "../x.mov", provenance: { source_title: "", fetched_at: "yesterday", publisher: "P" }
  }));
  const text = errors.join("\n");
  for (const want of ["schema must be", "id must be", "url must be http", "kind must be", "viewport.width must be even", "(select) needs a {text} target", "(zoom) needs a target", "(pin) needs a label", "beats[3].action", "beats[3].at", "out must be", "provenance.source_title", "provenance.fetched_at"]) assert.match(text, new RegExp(want.replace(/[()[\]{}.]/g, "\\$&")), want);
  assert.match(validateCaptureRequest(request({ url: "https://user:pw@example.com/" })).errors.join(), /credentials/);
});

test("the research agent's capture requests validate as written", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("./fixtures/research/deepseek-v4-1-flash/research/captures/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.ok(files.length >= 1);
  for (const name of files) {
    const { errors, request: r } = validateCaptureRequest(JSON.parse(readFileSync(new URL(name, dir), "utf8")));
    assert.deepEqual(errors, [], name);
    assert.equal(r.beats.find((b) => b.action === "wait").target, null);
  }
  assert.match(validateCaptureRequest(request({ beats: [{ at: 0, action: "pin", label: "x".repeat(49) }] })).errors.join(), /pin\) label must be at most 48/);
});

test("evidence capture refuses local and private hosts", () => {
  assert.throws(() => assertPublicUrl("http://localhost:3000/"), /public pages only/);
  assert.throws(() => assertPublicUrl("http://192.168.1.4/"), /public pages only/);
  assert.equal(assertPublicUrl("https://huggingface.co/x").hostname, "huggingface.co");
});

test("blocks, sign-in walls and paywalls fail with a reason; a real page passes", () => {
  const page = { status: 200, requested: "https://example.com/a", final: "https://example.com/a", title: "A story", text: "Real article text. ".repeat(40), paywall: [] };
  assert.equal(blockReason(page), null);
  assert.match(blockReason({ ...page, status: 403 }), /HTTP 403/);
  assert.match(blockReason({ ...page, title: "Just a moment...", text: "Checking your browser before accessing" }), /bot check/);
  assert.match(blockReason({ ...page, final: "https://example.com/login?return=/a" }), /sign-in wall/);
  assert.match(blockReason({ ...page, text: page.text + " Subscribe to continue reading." }), /paywall/);
  assert.match(blockReason({ ...page, paywall: [".tp-modal"] }), /paywall overlay/);
  // A sign-in prompt beside a free article is not a paywall.
  assert.equal(blockReason({ ...page, text: page.text + " Already a subscriber? Sign in" }), null);
  assert.match(blockReason({ ...page, text: "hi" }), /empty page/);
});

test("consent: only refusals count, never an accept", () => {
  for (const label of ["Reject all", "Reject All Cookies", "Decline", "Only necessary", "Use necessary cookies only", "Strictly necessary only", "Continue without accepting", "Refuse all"]) assert.ok(isRejectLabel(label), label);
  for (const label of ["Accept all", "Accept", "I agree", "OK", "Allow all cookies", "Manage preferences"]) assert.ok(!isRejectLabel(label), label);
});

// A 1600×948 window over a 1600×4000 page.
const viewport = { width: 1600, height: 1000 }, chrome = 52, page = { width: 1600, height: 4000 };
const win = { width: 1600, height: 948 };
const line = { x: 400, y: 2000, width: 300, height: 20 };

test("the camera stays inside the page and eases between keys", () => {
  assert.deepEqual(clampCamera({ cx: 0, cy: -500, s: 1 }, win, page), { cx: 800, cy: 474, s: 1 });
  assert.deepEqual(clampCamera({ cx: 1600, cy: 4000, s: 2 }, win, page), { cx: 1200, cy: 3763, s: 2 });
  const tl = buildTimeline({ viewport, chrome, page, duration: 4, beats: [{ index: 0, action: "zoom", at: 1, dur: 1, rects: [line] }] });
  const before = cameraAt(tl, 0.5), mid = cameraAt(tl, 1.5), after = cameraAt(tl, 3);
  assert.equal(before.s, 1);
  assert.ok(mid.s > 1 && mid.s < after.s);
  assert.equal(after.s, 2.6);
  const v = viewOf(after, win);
  assert.ok(v.x <= line.x && v.x + v.width >= line.x + line.width && v.y <= line.y && v.y + v.height >= line.y + line.height, "the zoom frames the target");
});

test("a beat whose target is off screen pans first, then plays", () => {
  const tl = buildTimeline({ viewport, chrome, page, duration: 4, beats: [{ index: 0, action: "focus-ring", at: 0.5, dur: 1.2, rects: [line] }] });
  assert.equal(tl.cameraKeys.length, 2);
  assert.ok(tl.effects[0].start > 0.5 && tl.effects[0].start <= 1.1);
  assert.equal(stateAt(tl, 0.6).ring, null);
  const ring = stateAt(tl, 3).ring;
  assert.equal(ring.opacity, 1);
  assert.deepEqual(ring.rect, { x: 394, y: 1994, width: 312, height: 32 });
  const seen = toWindow({ x: ring.rect.x, y: ring.rect.y }, stateAt(tl, 3).camera, win);
  assert.ok(seen.y > 0 && seen.y < win.height);
});

test("the focus ring steps row to row; the selection sweeps in reading order", () => {
  const rows = [{ x: 345, y: 300, width: 1200, height: 20 }, { x: 345, y: 320, width: 1200, height: 20 }];
  const two = [{ x: 100, y: 400, width: 200, height: 20 }, { x: 100, y: 420, width: 100, height: 20 }];
  const tl = buildTimeline({ viewport, chrome, page, duration: 6, beats: [
    { index: 0, action: "focus-ring", at: 0, dur: 0.6, rects: [rows[0]] },
    { index: 1, action: "focus-ring", at: 1, dur: 0.6, rects: [rows[1]] },
    { index: 2, action: "select", at: 2, dur: 1, rects: two }
  ] });
  assert.equal(stateAt(tl, 0.9).ring.rect.y, 294);
  const moving = stateAt(tl, 1.3).ring.rect.y;
  assert.ok(moving > 294 && moving < 314);
  assert.equal(stateAt(tl, 2).selection.length, 0);
  const half = stateAt(tl, 2.5).selection;
  assert.deepEqual(half, [{ x: 100, y: 400, width: 150, height: 20 }]);
  assert.equal(stateAt(tl, 3.5).selection.length, 2);
});

test("the cursor glides on an arc, appears with its first move, and drags across a selection", () => {
  const word = { x: 600, y: 300, width: 80, height: 20 };
  const tl = buildTimeline({ viewport, chrome, page, duration: 5, beats: [
    { index: 0, action: "cursor", at: 0.5, dur: 1, rects: [word] },
    { index: 1, action: "select", at: 2, dur: 1, rects: [word] }
  ] });
  assert.equal(stateAt(tl, 0.2).cursor, null);
  assert.ok(stateAt(tl, 0.55).cursor.opacity < 1);
  const landed = stateAt(tl, 1.6).cursor;
  assert.deepEqual({ x: landed.x, y: landed.y }, { x: 640, y: 311 });
  const dragging = stateAt(tl, 2.5).cursor;
  assert.ok(dragging.down && dragging.x > 600 && dragging.x < 680);
  assert.equal(stateAt(tl, 4).cursor.x, 680);
});

test("pins pop in and stay; every state is a pure function of t", () => {
  const tl = buildTimeline({ viewport, chrome, page, duration: 4, beats: [{ index: 0, action: "pin", at: 1, dur: 0.5, label: "Oct 16, 2026", rects: [] }] });
  assert.deepEqual(stateAt(tl, 0.9).pins, []);
  assert.equal(stateAt(tl, 3).pins[0].scale, 1);
  assert.deepEqual(stateAt(tl, 1.2), stateAt(tl, 1.2));
  const forward = [0.3, 1.1, 2.7].map((t) => stateAt(tl, t)), backward = [2.7, 1.1, 0.3].map((t) => stateAt(tl, t)).reverse();
  assert.deepEqual(forward, backward);
});

test("the timeline survives the JSON trip into the player page unchanged", () => {
  const word = { x: 600, y: 300, width: 80, height: 20 };
  const tl = buildTimeline({ viewport, chrome, page, duration: 6, beats: [
    { index: 0, action: "cursor", at: 0.2, dur: 0.6, rects: [word] },
    { index: 1, action: "select", at: 1, dur: 1, rects: [word] },
    { index: 2, action: "focus-ring", at: 2.5, dur: 0.6, rects: [line] },
    { index: 3, action: "select", at: 3.5, dur: 1, rects: [line] },
    { index: 4, action: "pin", at: 4, dur: 0.5, label: "Oct 16, 2026", rects: [] }
  ] });
  const tripped = JSON.parse(JSON.stringify(tl));
  for (const t of [0.5, 1.5, 2.4, 3, 4.2, 5.9]) assert.deepEqual(stateAt(tripped, t), stateAt(tl, t), `t = ${t}`);
  assert.equal(stateAt(tripped, 2.4).selection.length, 1, "a finished selection stays until the next one");
});

test("a long page is shot as the slice the beats need, in tiles", () => {
  const win = { width: 1600, height: 948 };
  // Near the top: from the page top, as before.
  assert.deepEqual(captureRegion([{ x: 0, y: 2000, width: 10, height: 20 }], { docHeight: 9000, win }), { y0: 0, y1: 3158 });
  // Deep: open just above the first target, as if arriving by anchor.
  const deep = captureRegion([{ x: 0, y: 10410, width: 10, height: 20 }, { x: 0, y: 11000, width: 10, height: 20 }], { docHeight: 14000, win });
  assert.deepEqual(deep, { y0: 10126, y1: 12158 });
  assert.equal(captureRegion([{ x: 0, y: 10410, width: 10, height: 20 }], { docHeight: 14000, win, start: "top" }).y0, 0);
  assert.equal(captureRegion([{ x: 0, y: 900, width: 10, height: 20 }], { docHeight: 14000, win, start: "target" }).y0, 616);
  // Never past the page's end, never shorter than a window.
  assert.deepEqual(captureRegion([], { docHeight: 500, win }), { y0: 0, y1: 500 });
  assert.deepEqual(regionTiles({ y0: 100, y1: 9100 }), [{ y: 100, height: 4000 }, { y: 4100, height: 4000 }, { y: 8100, height: 1000 }]);
});

test("the player draws the URL in the chrome and inlines the timeline", async () => {
  assert.deepEqual(urlParts("https://www.example.com/a/b/?q=1"), { host: "example.com", rest: "/a/b/?q=1" });
  assert.equal(chromeHeight({ width: 1600, height: 1000 }), 52);
  assert.equal(chromeHeight({ width: 1600, height: 1000 }, "none"), 0);
  const tl = buildTimeline({ viewport, chrome, page, duration: 2, beats: [] });
  const html = await playerHtml({ timeline: tl, image: "page.png", url: "https://github.com/dotnet/efcore/pull/39217/files" });
  assert.match(html, /<span class="host">github\.com<\/span><span class="rest">\/dotnet\/efcore\/pull\/39217\/files<\/span>/);
  assert.match(html, /function stateAt\(/);
  assert.doesNotMatch(html, /^export /m);
  const tiled = await playerHtml({ timeline: tl, images: [{ src: "page-0.png", y: 0, height: 4000 }, { src: "page-1.png", y: 4000, height: 1200 }], url: "https://example.com/" });
  assert.match(tiled, /id="shot-0" src="page-0\.png".*id="shot-1" src="page-1\.png"/s);
  assert.match(tiled, /const TILES = \[\{"y":0,"height":4000\},\{"y":4000,"height":1200\}\]/);
});

test("the CLI checks a request, runs a capture or a still, and prints scene params from a sidecar", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { runEvidenceCommand } = await import("../src/evidence/cli.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "evidence-cli-"));
  const file = path.join(dir, "req.json");
  await writeFile(file, JSON.stringify(request()));
  const check = await runEvidenceCommand("check", file);
  assert.equal(check.ok, true);
  await writeFile(path.join(dir, "bad.json"), JSON.stringify(request({ beats: [{ at: 0, action: "zoom" }] })));
  assert.equal((await runEvidenceCommand("check", path.join(dir, "bad.json"))).ok, false);
  await assert.rejects(runEvidenceCommand("capture", path.join(dir, "bad.json"), {}, { capture: {} }), /has errors/);
  const calls = [];
  const record = { final_url: "https://github.com/x", consent: { action: "none" }, duration: 3.7, spans: [{ text: "gpt-6.1-terra" }] };
  const capture = {
    captureEvidence: async (input, options) => { calls.push(["clip", input.id, options.root]); return { video: "v.mp4", poster: "p.png", sidecar: path.join(dir, "x.evidence.json"), fullpage: "f.png", record }; },
    captureStill: async (input, options) => { calls.push(["still", options.target, options.scale]); return { still: "s.png", sidecar: "s.json", record }; }
  };
  const clip = await runEvidenceCommand("capture", file, { root: dir }, { capture });
  assert.deepEqual(clip.spans, ["gpt-6.1-terra"]);
  const still = await runEvidenceCommand("capture", file, { still: true, target: "text:gpt-6.1-terra", scale: "4" }, { capture });
  assert.equal(still.stage, "evidence-still");
  assert.deepEqual(calls, [["clip", "pr-39217", dir], ["still", { text: "gpt-6.1-terra" }, 4]]);
  const sidecar = path.join(dir, "pr.evidence.json");
  await writeFile(sidecar, JSON.stringify({ schema: "launchclip.evidence.v1", id: "pr", video: "pr.mp4", duration: 3, viewport: { width: 1600, height: 1000 }, provenance: { publisher: "GitHub", published_at: "2026-10-16T17:45:34Z" } }));
  const scene = await runEvidenceCommand("scene", sidecar);
  assert.equal(scene.module, "evidence-clip");
  assert.deepEqual(scene.params.source, { publisher: "GitHub", date: "Oct 16, 2026" });
});

test("routes: X posts open the public embed, GitHub files open their own diff anchor", async () => {
  const { githubDiffAnchor, resolveRoute, retarget, xStatus } = await import("../src/evidence/routes.js");
  assert.deepEqual(xStatus("https://x.com/Mr_Salio/status/2114266090356232253?s=20"), { user: "Mr_Salio", id: "2114266090356232253" });
  assert.equal(xStatus("https://example.com/a/status/1"), null);
  const x = resolveRoute({ url: "https://twitter.com/PeterJ_Walker/status/2114377706603429899", theme: "dark" });
  assert.equal(x.name, "x-embed");
  assert.equal(x.url, "https://platform.twitter.com/embed/Tweet.html?id=2114377706603429899&theme=dark&dnt=true&lang=en");
  // The page-title wrapper a research fetch sees is not in the embed.
  for (const text of ['on X: "🚨 GPT-6.1 Terra is showing up', 'Salio on X: "🚨 GPT-6.1 Terra is showing up"']) assert.equal(retarget({ text }, x).target.text, "GPT-6.1 Terra is showing up");
  assert.equal(retarget({ text: "plain words" }, x).note, undefined);
  // GitHub's anchor for a file is the sha256 of its path.
  assert.equal(githubDiffAnchor("eng/harness-evaluation/skills/code-review/eval.yaml"), "diff-30465b3480d20f41a988a131d4c9ba056d6940021f9f1fc1b64b704b355f8f7b");
  const gh = resolveRoute({ url: "https://github.com/dotnet/efcore/pull/39217", file: "eng/harness-evaluation/skills/code-review/eval.yaml" });
  assert.equal(gh.url, "https://github.com/dotnet/efcore/pull/39217/files#diff-30465b3480d20f41a988a131d4c9ba056d6940021f9f1fc1b64b704b355f8f7b");
  assert.deepEqual(retarget({ text: "gpt-6.1-terra" }, gh).target, { text: "gpt-6.1-terra", within: gh.scope });
  assert.deepEqual(retarget({ text: "x", within: "main" }, gh).target, { text: "x", within: "main" });
  assert.throws(() => resolveRoute({ url: "https://example.com/a", file: "a.js" }), /needs a GitHub pull request or commit URL/);
  assert.equal(resolveRoute({ url: "https://example.com/a" }).name, "page");
  assert.match(validateCaptureRequest(request({ file: "/etc/passwd" })).errors.join(), /file must be a repository path/);
});
