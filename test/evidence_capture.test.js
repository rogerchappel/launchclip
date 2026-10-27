// Evidence capture (src/evidence/): the launchclip.capture.v1 request, the
// frame-pure beat timeline, block and paywall detection, and consent buttons.
// The browser run itself is exercised by the samples in docs/EVIDENCE_CAPTURE.md.
import assert from "node:assert/strict";
import test from "node:test";
import { CAPTURE_SCHEMA, normalizeTarget, requestDuration, validateCaptureRequest } from "../src/evidence/request.js";
import { buildTimeline, cameraAt, clampCamera, stateAt, toWindow, viewOf } from "../src/evidence/timeline.js";
import { assertPublicUrl, blockReason, isRejectLabel } from "../src/evidence/capture.js";
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

test("the player draws the URL in the chrome and inlines the timeline", async () => {
  assert.deepEqual(urlParts("https://www.example.com/a/b/?q=1"), { host: "example.com", rest: "/a/b/?q=1" });
  assert.equal(chromeHeight({ width: 1600, height: 1000 }), 52);
  assert.equal(chromeHeight({ width: 1600, height: 1000 }, "none"), 0);
  const tl = buildTimeline({ viewport, chrome, page, duration: 2, beats: [] });
  const html = await playerHtml({ timeline: tl, image: "page.png", url: "https://github.com/dotnet/efcore/pull/39217/files" });
  assert.match(html, /<span class="host">github\.com<\/span><span class="rest">\/dotnet\/efcore\/pull\/39217\/files<\/span>/);
  assert.match(html, /function stateAt\(/);
  assert.doesNotMatch(html, /^export /m);
});
