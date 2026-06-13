import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_SFX,
  MOTION_TIMELINE_VERSION,
  SCENE_SFX,
  validateTimeline,
  snapEventsToWords,
  chunkWords
} from "../motion-engine/schema.js";
import { buildHeuristicTimeline, flagEmphasis, zoomEvents } from "../motion-engine/heuristics.js";
import { buildTeleprompterMarkdown, parseWords } from "../src/talking_head.js";
import { REQUIRED_SFX_FILES } from "../src/sfx.js";

const words = [
  { word: "I", start: 0.2, end: 0.32 },
  { word: "stopped", start: 0.38, end: 0.7 },
  { word: "hand-editing.", start: 0.76, end: 1.4 },
  { word: "Now", start: 1.9, end: 2.1 },
  { word: "it", start: 2.16, end: 2.26 },
  { word: "renders", start: 2.3, end: 2.7 },
  { word: "itself.", start: 2.76, end: 3.2 }
];

function baseTimeline(events = []) {
  return {
    version: MOTION_TIMELINE_VERSION,
    duration_seconds: 10,
    base: { type: "video", src: "base/take.mp4" },
    words,
    events
  };
}

test("validateTimeline accepts a well-formed timeline and fills defaults", () => {
  const result = validateTimeline(
    baseTimeline([{ id: "z1", type: "punch_zoom", start: 0.38, end: 1.5 }])
  );
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.timeline.events[0].scale, 1.08);
  assert.equal(result.timeline.events[0].sfx, "fast_whoosh.wav");
  assert.equal(result.timeline.audio.music_volume, 0.08);
});

test("SFX role map references only required named pack files", () => {
  const required = new Set(REQUIRED_SFX_FILES);
  const used = [...Object.values(DEFAULT_SFX), ...Object.values(SCENE_SFX)];
  for (const file of used) {
    assert.ok(required.has(file), `${file} is not in the required SFX pack`);
  }
  for (const role of ["funnel_item", "profile_card", "magnifier_focus", "artifact_item", "terminal_status"]) {
    assert.ok(SCENE_SFX[role], `missing scene SFX role ${role}`);
  }
});

test("validateTimeline rejects unknown types, bad timing, and overlapping zooms", () => {
  const result = validateTimeline(
    baseTimeline([
      { id: "x", type: "sparkle", start: 1, end: 2 },
      { id: "z1", type: "punch_zoom", start: 2, end: 1 },
      { id: "z2", type: "punch_zoom", start: 3, end: 5 },
      { id: "z3", type: "punch_zoom", start: 4, end: 6 }
    ])
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("unknown type")));
  assert.ok(result.errors.some((error) => error.includes("invalid timing")));
  assert.ok(result.errors.some((error) => error.includes("overlaps")));
});

test("logo_pop requires src", () => {
  const result = validateTimeline(baseTimeline([{ id: "l1", type: "logo_pop", start: 1, end: 2 }]));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("requires src")));
});

test("snapEventsToWords moves events onto spoken word starts", () => {
  const snapped = snapEventsToWords([{ id: "z", type: "punch_zoom", start: 0.5, end: 1.6 }], words);
  assert.equal(snapped[0].start, 0.38);
  assert.equal(Math.round((snapped[0].end - snapped[0].start) * 100) / 100, 1.1);
});

test("chunkWords breaks on punctuation, pauses, and max length", () => {
  const chunks = chunkWords(words);
  assert.equal(chunks[0].words.map((entry) => entry.word).join(" "), "I stopped hand-editing");
  assert.ok(chunks.length >= 2);
  const second = chunks[1];
  assert.equal(second.words[0].word, "Now");
});

test("heuristics flag numbers and sentence starts, space zooms apart", () => {
  const flagged = flagEmphasis([
    { word: "Save", start: 0, end: 0.3 },
    { word: "$2,000", start: 0.4, end: 0.9 },
    { word: "monthly.", start: 1.0, end: 1.5 },
    { word: "Seriously.", start: 5.0, end: 5.6 }
  ]);
  assert.equal(flagged[1].emphasis, true);
  assert.equal(flagged[3].emphasis, true);
  const zooms = zoomEvents(flagged, 10);
  assert.ok(zooms.length >= 1);
  for (let index = 1; index < zooms.length; index += 1) {
    assert.ok(zooms[index].start - zooms[index - 1].end >= 0);
  }
});

test("buildHeuristicTimeline produces a valid timeline", () => {
  const timeline = buildHeuristicTimeline({ words, durationSeconds: 10, baseSrc: "base/take.mp4" });
  const result = validateTimeline(timeline);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.timeline.base.type, "video");
});

test("scenes validate: types, footage src, overlap, and length caps", () => {
  const result = validateTimeline(
    baseTimeline([]) && {
      ...baseTimeline([]),
      scenes: [
        { id: "a", type: "talking_head", start: 0, end: 6.4, src: "base/take.mp4" },
        { id: "b", type: "screen", start: 6, end: 7.5 },
        { id: "c", type: "hologram", start: 7.5, end: 8 },
        { id: "d", type: "prompt_card", start: 8, end: 9.5 }
      ]
    }
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("requires src")));
  assert.ok(result.errors.some((error) => error.includes("unknown type")));
  assert.ok(result.errors.some((error) => error.includes("overlaps")));
  assert.ok(result.errors.some((error) => error.includes("requires text")));
  assert.ok(result.warnings.some((warning) => warning.includes("caps scenes")));
});

test("steps and flow items default their build times inside the scene", () => {
  const result = validateTimeline({
    ...baseTimeline([]),
    scenes: [
      { id: "s", type: "card_steps", start: 0, end: 4, items: [{ text: "one" }, { text: "two" }] },
      { id: "f", type: "icon_flow", start: 4, end: 8, items: [{ label: "in" }, { label: "out", at: 5 }] },
      { id: "t", type: "talking_head", start: 8, end: 10, src: "base/take.mp4" }
    ]
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  const [steps, flow] = result.timeline.scenes;
  assert.equal(steps.items[1].at, 0.8);
  assert.equal(flow.items[0].text, "in");
  assert.equal(flow.items[1].at, 5);
});

test("prompt_card icons normalize to at most 3 string paths", () => {
  const result = validateTimeline({
    ...baseTimeline([]),
    scenes: [
      { id: "p", type: "prompt_card", start: 0, end: 4, text: "run it", icons: ["logos/a.svg", "logos/b.svg", "", "logos/c.svg", "logos/d.svg"] },
      { id: "t", type: "talking_head", start: 4, end: 10, src: "base/take.mp4", items: [{ text: "yo", at: 5 }, { text: "hey", at: 7 }] }
    ]
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.deepEqual(result.timeline.scenes[0].icons, ["logos/a.svg", "logos/b.svg", "logos/c.svg"]);
});

test("funnel, profile_cards, and magnifier normalize their fields", () => {
  const result = validateTimeline({
    ...baseTimeline([]),
    scenes: [
      {
        id: "f",
        type: "funnel",
        start: 0,
        end: 4,
        title: "the pipeline",
        items: [
          { text: "Prospect", at: 0.2, icon: "icons/magnifier.svg" },
          { text: "Reply", at: 1.0, color: "mint", badge: "1" }
        ],
        branch: { fromIndex: 1, at: 2.0, text: "No Reply", color: "coral" }
      },
      {
        id: "p",
        type: "profile_cards",
        start: 4,
        end: 8,
        mode: "grid",
        items: [{ name: "Maya", value: "$300/mo", at: 4.2 }],
        total: { label: "Total", value: "$6,000", at: 6.5 }
      },
      { id: "m", type: "magnifier", start: 8, end: 10, src: "shots/x.svg", text: "hi", from: { x: 0.2, y: 0.1 }, to: { x: 0.9, y: 0.8 } }
    ]
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  const [funnel, profile, mag] = result.timeline.scenes;
  assert.equal(funnel.items[0].icon, "icons/magnifier.svg");
  assert.equal(funnel.items[1].color, "mint");
  assert.equal(funnel.branch.fromIndex, 1);
  assert.equal(funnel.branch.color, "coral");
  assert.equal(profile.mode, "grid");
  assert.equal(profile.total.value, "$6,000");
  assert.equal(mag.src, "shots/x.svg");
  assert.equal(mag.to.x, 0.9);
});

test("funnel rejects an out-of-range branch and magnifier requires src", () => {
  const result = validateTimeline({
    ...baseTimeline([]),
    scenes: [
      { id: "f", type: "funnel", start: 0, end: 4, items: [{ text: "a", at: 0.2 }], branch: { fromIndex: 9, at: 1, text: "x" } },
      { id: "m", type: "magnifier", start: 4, end: 6, text: "no src here" }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("branch.fromIndex is out of range")));
  assert.ok(result.errors.some((e) => e.includes("(magnifier) requires src")));
});

test("artifact_grid and terminal_receipt normalize proof fields", () => {
  const result = validateTimeline({
    ...baseTimeline([]),
    scenes: [
      {
        id: "a",
        type: "artifact_grid",
        start: 0,
        end: 4,
        title: "receipts",
        items: [
          { label: "script", path: "video/script.json", at: 0.2 },
          { text: "review", path: "REVIEW.md", status: "ready", at: 0.76 }
        ]
      },
      { id: "t", type: "terminal_receipt", start: 4, end: 7, command: "npm run smoke", output: "Smoke OK", status: "passed", at: 4.2 },
      { id: "c", type: "typography", start: 7, end: 10, items: [{ text: "Now", at: 7.2 }, { text: "done", at: 8.2 }] }
    ]
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  const [grid, terminal] = result.timeline.scenes;
  assert.equal(grid.items[1].label, "review");
  assert.equal(grid.items[1].status, "ready");
  assert.equal(terminal.command, "npm run smoke");
  assert.equal(terminal.status, "passed");
});

test("zooms hugging a scene cut produce a warning", () => {
  const result = validateTimeline({
    ...baseTimeline([{ id: "z", type: "punch_zoom", start: 3.8, end: 4.8 }]),
    scenes: [
      { id: "a", type: "talking_head", start: 0, end: 4, src: "base/take.mp4" },
      { id: "b", type: "talking_head", start: 4, end: 8, src: "base/take.mp4" }
    ]
  });
  assert.ok(result.warnings.some((warning) => warning.includes("cut into")));
});

test("golden timeline example validates", async () => {
  const raw = JSON.parse(await readFile(new URL("../examples/motion/golden-timeline.json", import.meta.url), "utf8"));
  const result = validateTimeline(raw);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.warnings.length, 0, result.warnings.join("; "));
  assert.ok(result.timeline.events.length >= 1);
  assert.ok(result.timeline.scenes.length >= 5, "golden timeline must exercise the scene track");
  const types = new Set(result.timeline.scenes.map((scene) => scene.type));
  for (const required of ["talking_head", "typography", "prompt_card", "card_steps", "icon_flow"]) {
    assert.ok(types.has(required), `golden timeline missing scene type ${required}`);
  }
  const transitions = new Set(result.timeline.scenes.map((scene) => scene.transition));
  for (const required of ["swipe_left", "zoom_into", "cut"]) {
    assert.ok(transitions.has(required), `golden timeline missing transition ${required}`);
  }
});

test("scene transitions and talking_head layouts validate", () => {
  const result = validateTimeline({
    ...baseTimeline([]),
    scenes: [
      { id: "a", type: "talking_head", start: 0, end: 4, src: "base/take.mp4", layout: "teleport" },
      { id: "b", type: "typography", start: 4, end: 8, transition: "warp", items: [{ text: "hi" }] },
      { id: "c", type: "talking_head", start: 8, end: 10, src: "base/take.mp4", layout: "card", transition: "swipe_left" }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("unknown layout")));
  assert.ok(result.errors.some((error) => error.includes("unknown transition")));
  const valid = validateTimeline({
    ...baseTimeline([]),
    scenes: [
      { id: "a", type: "talking_head", start: 0, end: 4, src: "base/take.mp4", transition: "swipe_left", items: [{ text: "yo", at: 1 }] },
      { id: "b", type: "screenshot_pile", start: 4, end: 8, mode: "scroll", transition: "zoom_into", items: [{ src: "shots/a.png" }] },
      { id: "c", type: "talking_head", start: 8, end: 10, src: "base/take.mp4", layout: "full" }
    ]
  });
  assert.equal(valid.ok, true, valid.errors.join("; "));
  assert.equal(valid.timeline.scenes[0].transition, "cut", "first scene is forced to cut");
  assert.equal(valid.timeline.scenes[0].layout, "split");
  assert.equal(valid.timeline.scenes[1].mode, "scroll");
});

test("parseWords accepts plain arrays and whisper output", () => {
  const plain = parseWords(JSON.stringify([{ word: "hi", start: 0, end: 0.2 }]));
  assert.equal(plain[0].word, "hi");
  const whisper = parseWords(
    JSON.stringify({ segments: [{ words: [{ word: " there", start: 0.3, end: 0.5 }] }] })
  );
  assert.equal(whisper[0].word, "there");
});

test("teleprompter renders segments with pacing estimates", () => {
  const markdown = buildTeleprompterMarkdown(
    {
      delivery: "direct",
      segments: [
        { beat: "hook", text: "I stopped hand-editing my launch videos." },
        { beat: "cta", text: "Link in bio." }
      ]
    },
    150
  );
  assert.ok(markdown.includes("### 1. hook"));
  assert.ok(markdown.includes("Link in bio."));
  assert.ok(markdown.includes("HeyGen alternative"));
});
