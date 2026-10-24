// Subject stage contracts (kit/core/subject.mjs): mask analysis on synthetic
// silhouettes, sample summaries, frame lookup and schema validation.
import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBJECT_PROBE_SCHEMA,
  SUBJECT_SCHEMA,
  classifyFraming,
  maskStats,
  subjectAt,
  summarizeSamples,
  validateSubjectInfo,
  validateSubjectProbe
} from "../kit/core/subject.mjs";

const W = 180;
const H = 320;

// A presenter: a round head over a wide torso that runs off the bottom edge.
function presenter({ cx = 90, headY = 90, radius = 26, shoulders = 70, alpha = new Uint8Array(W * H) } = {}) {
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inHead = (x - cx) ** 2 + (y - headY) ** 2 <= radius ** 2;
      const neck = y > headY && y < headY + radius + 8 && Math.abs(x - cx) <= radius * 0.45;
      const torso = y >= headY + radius + 8 && Math.abs(x - cx) <= shoulders;
      if (inHead || neck || torso) alpha[y * W + x] = 255;
    }
  }
  return alpha;
}

test("maskStats finds one person, their body and their head", () => {
  const stats = maskStats(presenter(), W, H);
  assert.equal(stats.people, "one");
  assert.ok(stats.coverage > 0.3 && stats.coverage < 0.7, `coverage ${stats.coverage}`);
  assert.ok(Math.abs(stats.body.x - 0.5) < 0.02);
  assert.ok(stats.body.y + stats.body.h / 2 > 0.98, "the torso reaches the bottom edge");
  // The head is about 52 px wide (0.29) and its box stops at the shoulders.
  assert.ok(Math.abs(stats.head.x - 0.5) < 0.02, `head x ${stats.head.x}`);
  assert.ok(stats.head.w > 0.25 && stats.head.w < 0.34, `head w ${stats.head.w}`);
  const headTop = stats.head.y - stats.head.h / 2;
  assert.ok(Math.abs(headTop - 64 / H) < 0.02, `head top ${headTop}`);
  assert.ok(stats.head.y + stats.head.h / 2 < (90 + 26 + 12) / H, "head box ends at the shoulder line");
});

test("maskStats reports no person on an empty mask and several for two people", () => {
  assert.deepEqual(maskStats(new Uint8Array(W * H), W, H), { coverage: 0, people: "none", body: null, head: null });
  const two = presenter({ cx: 45, radius: 18, shoulders: 32 });
  presenter({ cx: 135, radius: 18, shoulders: 32, alpha: two });
  assert.equal(maskStats(two, W, H).people, "several");
});

test("maskStats ignores small specks next to the person", () => {
  const alpha = presenter();
  for (let y = 10; y < 14; y += 1) for (let x = 5; x < 9; x += 1) alpha[y * W + x] = 255;
  assert.equal(maskStats(alpha, W, H).people, "one");
});

test("maskStats rejects a mask of the wrong size", () => {
  assert.throws(() => maskStats(new Uint8Array(10), W, H), /180×320/);
});

test("classifyFraming counts head heights below the chin, in any aspect", () => {
  // Chin at 0.7 with a 0.3 head: one head below → close-up.
  assert.equal(classifyFraming({ x: 0.5, y: 0.55, w: 0.3, h: 0.3 }), "close-up");
  // A 16:9 waist-up shot: chin at 0.45, head 0.28 → about two heads below.
  assert.equal(classifyFraming({ x: 0.5, y: 0.31, w: 0.16, h: 0.28 }), "medium");
  // The same person cropped 9:16: chin at 0.45, head 0.2 → under three heads.
  assert.equal(classifyFraming({ x: 0.5, y: 0.35, w: 0.4, h: 0.2 }), "medium");
  // A small figure with the room around it.
  assert.equal(classifyFraming({ x: 0.5, y: 0.3, w: 0.1, h: 0.08 }), "wide");
  assert.equal(classifyFraming(null), null);
});

test("summarizeSamples takes medians and says why a subject is unusable", () => {
  const one = maskStats(presenter(), W, H);
  const samples = [0, 1, 2, 3].map((t) => ({ t, ...one }));
  const summary = summarizeSamples(samples);
  assert.equal(summary.people, "one");
  assert.equal(summary.usable, true);
  assert.deepEqual(summary.reasons, []);
  assert.equal(summary.stability, 1);
  assert.equal(summary.framing, classifyFraming(one.head));
  assert.ok(summary.headroom > 0.15 && summary.headroom < 0.25);

  const flicker = samples.map((sample, index) => ({ ...sample, coverage: index % 2 ? 0.05 : 0.6 }));
  assert.match(summarizeSamples(flicker).reasons.join(" "), /unstable/);

  const empty = summarizeSamples([{ t: 0, coverage: 0, people: "none", body: null, head: null }]);
  assert.equal(empty.usable, false);
  assert.deepEqual(empty.reasons, ["no person was found"]);
  assert.equal(summarizeSamples([]).usable, false);
});

test("subjectAt returns the nearest frame", () => {
  const info = { frames: [0, 1 / 30, 2 / 30, 3 / 30].map((t, index) => ({ t: 10 + t, index })) };
  assert.equal(subjectAt(info, 9).index, 0);
  assert.equal(subjectAt(info, 10 + 1.4 / 30).index, 1);
  assert.equal(subjectAt(info, 10 + 1.6 / 30).index, 2);
  assert.equal(subjectAt(info, 99).index, 3);
  assert.equal(subjectAt({ frames: [] }, 1), null);
});

const SOURCE = { sha256: "a".repeat(64), width: 1080, height: 1920, fps: 30, duration: 12 };

function probeFixture() {
  const stats = maskStats(presenter(), W, H);
  const samples = [0, 1, 2].map((t) => ({ t, ...stats }));
  return { schema: SUBJECT_PROBE_SCHEMA, source: SOURCE, model: "modnet", ...summarizeSamples(samples), samples };
}

test("validateSubjectProbe accepts a built probe and names bad fields", () => {
  assert.deepEqual(validateSubjectProbe(probeFixture()), { ok: true, errors: [] });
  const bad = { ...probeFixture(), schema: "x", people: "crowd", usable: true, reasons: ["oops"], samples: [{ t: -1, coverage: 2, people: "one", head: { x: 2 }, body: null }] };
  const { ok, errors } = validateSubjectProbe(bad);
  assert.equal(ok, false);
  for (const fragment of ["schema must be", "people must be one of", "reasons must be empty when usable", "samples[0].t", "samples[0].coverage", "samples[0].head"]) {
    assert.ok(errors.some((error) => error.includes(fragment)), `expected an error containing "${fragment}" in ${JSON.stringify(errors)}`);
  }
});

test("validateSubjectInfo checks the range, matte and frame order", () => {
  const stats = maskStats(presenter(), W, H);
  const frames = [0, 1, 2].map((index) => ({ t: 4 + index / 30, ...stats }));
  const info = { schema: SUBJECT_SCHEMA, source: SOURCE, model: "modnet", range: { in: 4, out: 4.1 }, matte: "matte.webm", ...summarizeSamples(frames), frames };
  assert.deepEqual(validateSubjectInfo(info), { ok: true, errors: [] });
  const { errors } = validateSubjectInfo({ ...info, range: { in: 5, out: 4 }, matte: "", frames: [frames[1], frames[0]] });
  assert.ok(errors.some((error) => error.startsWith("range must be")));
  assert.ok(errors.some((error) => error.startsWith("matte must be")));
  assert.ok(errors.some((error) => error === "frames[1].t must increase"));
});

test('maskOutline traces the silhouette and breaks where it meets the frame edge', async () => {
  const {maskOutline, validateSubjectContours, CONTOURS_SCHEMA} = await import('../kit/core/subject.mjs');
  const outline = maskOutline(presenter(), W, H, {rays: 72});
  assert.equal(outline.length, 72);
  const up = outline[54]; // straight up (270°)
  assert.ok(up && Math.abs(up[1] - 64 / H) < 0.02, `the top of the head (${up})`);
  assert.ok(outline.some((point) => point === null), 'rays into the bottom edge leave gaps');
  assert.equal(maskOutline(new Uint8Array(W * H), W, H), null);
  assert.deepEqual(validateSubjectContours({schema: CONTOURS_SCHEMA, range: {in: 0, out: 1}, frames: [{t: 0, points: outline}]}).errors, []);
  assert.equal(validateSubjectContours({schema: CONTOURS_SCHEMA, range: {in: 0, out: 1}, frames: [{t: 0, points: [[2, 0]]}]}).ok, false);
});
