// Fakes for running launchclip make with no model, voice or renderer: a model
// client that returns a fixed script and storyboard, the inventory the
// classifier would produce, and a finish stand-in.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BRAND } from "../../kit/core/planning-prompt.mjs";

export const PROMPT = "A 6-second launch video for a fictional SaaS called Ledgerly that reconciles Stripe payouts automatically";
// Within the 6-second clock (16 words at 2.75 a second), so the script checks pass.
export const NARRATION = "Payouts never match your books. Ledgerly matches each payout to its invoice. Try Ledgerly free.";

// The storyboard a model would return for NARRATION over the test voice.
export function storyboard({ duration, media = "assets/ui.mp4", width = 1920, height = 1080 }) {
  return {
    schema: "launchclip.story.v1",
    title: "Ledgerly",
    lane: "motion",
    format: { width, height, fps: 30, duration },
    brand: DEFAULT_BRAND,
    audio: { words: "NARRATION.json" },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: "word:ledgerly", energy: 1, params: { headline: "Payouts never match", emphasis: "never" }, hits: [{ at: "word:never", event: "emphasis-0" }] },
      { id: "s2", module: "media-window", start: "word:ledgerly", end: "word:try", energy: 2, in: { type: "fade", dur: 0.3 }, params: { title: "Ledgerly matches every payout", media: { kind: "video", src: media } } },
      { id: "s3", module: "cta", start: "word:try", end: duration, energy: 1, in: { type: "fade", dur: 0.3 }, params: { action: "Try Ledgerly free" } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }],
    grammar: "editorial",
    ending: { loop_to: "s1" }
  };
}

// A fake model: the script pass returns NARRATION; the storyboard pass first
// references a file that is not in the manifest (a repair), then a valid board.
export function fakeModel({ vision = false } = {}) {
  const calls = [];
  const directionCalls = [];
  const usage = { input_tokens: 4000, output_tokens: 800, total_tokens: 4800 };
  let boards = 0;
  const client = {
    provider: "openai",
    async runStructured(request) {
      // The direction-map call returns no map, so make drafts DIRECTION.json from the storyboard.
      if (request.schemaName === "launchclip_direction") { directionCalls.push(request); return { model: "gpt-5.6-luna", value: { direction_json: "" }, usage }; }
      calls.push(request);
      if (request.schemaName === "launchclip_make_script") return { model: "gpt-5.6-luna", value: { title: "Ledgerly", narration: NARRATION }, usage };
      if (request.schemaName === "launchclip_storyboard") {
        boards += 1;
        const duration = Number(/"duration":([\d.]+)/.exec(request.input)[1]);
        const width = Number(/"width":(\d+)/.exec(request.input)[1]);
        const height = Number(/"height":(\d+)/.exec(request.input)[1]);
        const board = storyboard({ duration, width, height, media: boards === 1 ? "assets/missing.png" : "assets/ui.mp4" });
        return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(board) }, usage };
      }
      throw new Error(`unexpected schema ${request.schemaName}`);
    }
  };
  return { calls, directionCalls, model: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision } };
}

export async function assetsDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-in-"));
  await writeFile(path.join(dir, "ui.mp4"), "not really a video");
  await writeFile(path.join(dir, "logo.png"), "png");
  await writeFile(path.join(dir, "notes.md"), "Ledgerly reconciles Stripe payouts against invoices.\n");
  return dir;
}

// The inventory the classifier would produce for assetsDir() (the classifier
// itself is covered by make_assets.test.js).
export const fakeInventory = async (dir) => ({
  schema_version: "launchclip.make-assets.v1",
  dir,
  entries: [
    { path: "logo.png", kind: "image", role: "logo", confidence: 0.95, signals: ["filename:logo"], description: "Logo image (512×512, transparent)", media: { kind: "image", width: 512, height: 512, alpha: true }, fingerprint: "1" },
    { path: "notes.md", kind: "notes", role: "notes", confidence: 1, signals: ["extension"], description: "Brief notes", text: "Ledgerly reconciles Stripe payouts against invoices.", fingerprint: "2" },
    { path: "ui.mp4", kind: "video", role: "screen-recording", confidence: 0.9, signals: ["ui-look", "no-audio"], description: "Screen recording / product demo (4s, 1280×720, silent)", media: { kind: "video", width: 1280, height: 720, duration: 4, orientation: "landscape", has_audio: false, mountable: true }, speech: { present: false }, fingerprint: "3" }
  ],
  counts: {},
  summary: []
});

// finish stand-in: records its options and returns a report shaped like finish.json.
export function fakeFinish(calls) {
  return async (project, options, adapters) => {
    calls.push({ project, options, adapters });
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    assert.ok(story.audio.narration?.text || story.base, "finish gets a narrated or footage-led storyboard");
    await mkdir(path.join(project, "renders"), { recursive: true });
    await writeFile(path.join(project, "renders/draft.mp4"), "video");
    return {
      status: "ready-for-review", seconds: 1.5, final: path.join(project, "renders/draft.mp4"), warnings: [],
      stages: ["voice", "validate", "captions", "sound", "render", "master", "evidence", "gates"].map((name) => ({ name, status: "done", seconds: 0.1 })),
      gates: { layout: { status: "passed" }, loudness: { status: "passed" }, motion: { status: "passed" }, audio: { status: "passed" }, temporal_evidence: { status: "passed" }, critic: { status: "pending", reason: "finish does not produce critic receipts" } }
    };
  };
}
