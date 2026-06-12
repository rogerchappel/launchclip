// The Director: an LLM authors a motion.timeline.v1 document inside a
// contract enforced in code — schema (validateTimeline), taste (lintTimeline),
// and a repair loop that feeds failures back. See motion-engine/DIRECTOR.md.

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTimeline, MOTION_TIMELINE_VERSION } from "../motion-engine/schema.js";
import { lintTimeline } from "../motion-engine/lint.js";
import { renderCatalog } from "../motion-engine/catalog.js";
import { PRESETS, renderPreset } from "../motion-engine/presets.js";
import { renderMotion } from "./talking_head.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "claude-opus-4-8";
const MAX_ATTEMPTS = 4;

// Condensed hard rules from ART_DIRECTION.md — the part of the spec the
// Director must internalize. The validator and linter enforce the rest.
const ART_DIGEST = `## Art direction (hard rules)
You are directing a short-form video in the "paper world" grammar: a warm paper
tabletop with a faint grid; every piece of content is a physical card with a
soft shadow, placed and built on that paper. The voice is continuous; the
vision transforms constantly.

1. STRUCTURE: voice runs unbroken; the visual base is scenes butt-joined on the
   clock. Scenes persist 2-6s while builds run INSIDE them. Hard cuts are
   chapter breaks; most moves are camera travel (swipe/zoom) across one canvas.
2. CADENCE IS ABSOLUTE: every item lands at the start time of the spoken word
   that names it (use the provided word timings; "at" = a word's exact start).
   Nothing pre-exists its word; nothing lands off-speech.
3. DENSITY: something must enter, build, or transform at least every 1.5s.
   Fill scenes with word-timed items; never leave a graphic scene idle.
4. ONE FOCAL ELEMENT per moment. If two things matter, that's two scenes.
5. TYPOGRAPHY IS THE CAPTIONING: spoken phrases become typography scenes (or
   word builds above a split face). There are NO subtitle captions.
6. ACCENT IS RATIONED: one emphasised word per phrase, colored by meaning
   (mint = highlight/success, coral = warm punch, purple = brand-specific).
7. CONTENT HONESTY: footage/screenshots/prompts must come from the provided
   asset manifest, verbatim. Never invent media paths or fabricate UI.
8. THE FACE IS THE NARRATOR, NOT THE CHASSIS: if presenter footage exists, use
   it for the hook (split layout) and at most one more beat; graphics carry
   the rest.
9. HOOK IN THE FIRST 3 SECONDS; the CTA gets its own final scene with the
   emphasised payoff word.`;

// Loosened mirror of motion.timeline.v1 for structured outputs (the real
// authority is validateTimeline). All objects: additionalProperties false.
const ITEM_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    at: { type: "number" },
    emphasis: { type: "boolean" },
    color: { type: "string" },
    src: { type: "string" }
  },
  required: ["at"],
  additionalProperties: false
};

const TIMELINE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
          transition: { type: "string" },
          src: { type: "string" },
          layout: { type: "string" },
          offset: { type: "number" },
          text: { type: "string" },
          title: { type: "string" },
          mode: { type: "string" },
          items: { type: "array", items: ITEM_SCHEMA }
        },
        required: ["id", "type", "start", "end", "transition"],
        additionalProperties: false
      }
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
          scale: { type: "number" },
          origin_x: { type: "number" },
          origin_y: { type: "number" },
          src: { type: "string" },
          label: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          size: { type: "number" },
          sfx: { type: "string" }
        },
        required: ["id", "type", "start", "end"],
        additionalProperties: false
      }
    },
    rationale: { type: "string" }
  },
  required: ["scenes", "events"],
  additionalProperties: false
};

const DIRECTION_SCHEMA = {
  type: "object",
  properties: {
    must_include: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["steps", "line", "topic"] },
          items: { type: "array", items: { type: "string" } },
          text: { type: "string" }
        },
        required: ["kind"],
        additionalProperties: false
      }
    },
    asset_refs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          role: { type: "string" },
          instruction: { type: "string" }
        },
        required: ["path"],
        additionalProperties: false
      }
    },
    chapters: { type: "array", items: { type: "string" } },
    energy: { type: "string", enum: ["low", "medium", "high"] },
    emphasis_moments: { type: "array", items: { type: "string" } },
    cta_text: { type: "string" }
  },
  required: ["must_include", "asset_refs", "chapters", "energy", "emphasis_moments", "cta_text"],
  additionalProperties: false
};

export function buildSystemPrompt(presetName) {
  const preset = PRESETS[presetName] ?? PRESETS.software_demo;
  return [
    "You are the Director: you author motion-graphics timelines for short-form videos. You return ONLY the JSON timeline requested.",
    ART_DIGEST,
    renderCatalog(),
    renderPreset(preset)
  ].join("\n\n");
}

function firstText(response) {
  const block = response.content.find((entry) => entry.type === "text");
  if (!block) throw new Error("model returned no text block");
  return block.text;
}

// Free-text creative direction -> structured contract the linter can verify.
export async function parseDirection(client, promptText, assetPaths = []) {
  if (!promptText || !promptText.trim()) {
    return { must_include: [], asset_refs: [], chapters: [], energy: "high", emphasis_moments: [], cta_text: null };
  }
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system:
      "Parse a video creative-direction prompt into the requested JSON. Only list asset_refs for assets the prompt explicitly references (match against the provided asset paths). Steps/lines the video MUST contain go in must_include.",
    messages: [
      {
        role: "user",
        content: `Available asset paths:\n${assetPaths.join("\n") || "(none)"}\n\nCreative direction:\n${promptText}`
      }
    ],
    output_config: { format: { type: "json_schema", schema: DIRECTION_SCHEMA } }
  });
  return JSON.parse(firstText(response));
}

// Deterministic word-timing estimator for --voice none (no recorded speech).
export function estimateWords(script) {
  let t = 0.4;
  return script
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const clean = word.replace(/[.,!?]$/, "");
      const duration = 0.16 + clean.length * 0.038;
      const entry = { word, start: Number(t.toFixed(2)), end: Number((t + duration).toFixed(2)) };
      t += duration + (/[.!?]$/.test(word) ? 0.34 : /,$/.test(word) ? 0.18 : 0.06);
      return entry;
    });
}

export async function directTimeline({ client, words, durationSeconds, assets, direction, preset, scriptText, baseSrc, voiceoverSrc, musicSrc, log = () => {} }) {
  const system = [{ type: "text", text: buildSystemPrompt(preset), cache_control: { type: "ephemeral" } }];
  const manifest = assets.map((asset) => `- ${asset.path} (${asset.kind})`).join("\n") || "(no assets — graphic scenes only)";
  const baseInput = [
    `DURATION: ${durationSeconds}s exactly. Scenes must cover 0 to ${durationSeconds}.`,
    `SCRIPT (the voiceover):\n${scriptText}`,
    `WORD TIMINGS (item "at" values MUST be these start times):\n${JSON.stringify(words)}`,
    `ASSET MANIFEST (the only media paths you may reference):\n${manifest}`,
    baseSrc ? `PRESENTER FOOTAGE: ${baseSrc} (continuous take aligned to t=0; talking_head scenes use this src)` : "PRESENTER FOOTAGE: none — do not use talking_head scenes.",
    `CREATIVE DIRECTION (must be honored):\n${JSON.stringify(direction)}`,
    'Return the timeline JSON now: {"scenes": [...], "events": [...], "rationale": "one paragraph"}.'
  ].join("\n\n");

  let feedback = "";
  let lastReport = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    log(`director attempt ${attempt}/${MAX_ATTEMPTS}`);
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: feedback ? `${baseInput}\n\nYOUR PREVIOUS ATTEMPT FAILED. Fix ALL of these and return the corrected full timeline:\n${feedback}` : baseInput }],
      output_config: { format: { type: "json_schema", schema: TIMELINE_OUTPUT_SCHEMA } }
    });
    const draft = JSON.parse(firstText(response));
    const candidate = {
      version: MOTION_TIMELINE_VERSION,
      duration_seconds: durationSeconds,
      base: { type: baseSrc ? "video" : "placeholder", src: baseSrc ?? "" },
      audio: { voiceover: voiceoverSrc ?? "", music: musicSrc ?? "", music_volume: voiceoverSrc ? 0.16 : 0.3 },
      words,
      scenes: draft.scenes,
      events: draft.events
    };
    const validation = validateTimeline(candidate);
    const lint = validation.ok ? lintTimeline(validation.timeline, { direction, assets }) : { ok: false, failures: [], advisories: [] };
    lastReport = { attempt, validation: validation.errors, lint: lint.failures, advisories: [...validation.warnings, ...lint.advisories], rationale: draft.rationale };
    if (validation.ok && lint.ok) {
      log(`director: valid + lint-clean on attempt ${attempt}`);
      return { timeline: validation.timeline, report: lastReport };
    }
    feedback = [...validation.errors.map((error) => `SCHEMA: ${error}`), ...lint.failures.map((failure) => `LINT: ${failure}`)].join("\n");
    log(`attempt ${attempt} rejected: ${feedback.split("\n").length} issues`);
  }
  throw new Error(`Director failed after ${MAX_ATTEMPTS} attempts. Last issues:\n${feedback}`);
}

// Scan known public/ dirs + an optional assets dir into a manifest of
// renderer-resolvable paths.
export function scanAssets(extraDir = null) {
  const assets = [];
  const add = (dir, kind, prefix) => {
    const full = path.join(PACKAGE_ROOT, "public", dir);
    if (!existsSync(full)) return;
    for (const file of readdirSync(full)) {
      if (/\.(png|jpe?g|svg|webp|mp4|mov)$/i.test(file)) assets.push({ path: `${prefix}/${file}`, kind });
    }
  };
  add("logos", "icon", "logos");
  add("shots", "screenshot", "shots");
  add("base", "footage", "base");
  if (extraDir) {
    const full = path.resolve(extraDir);
    if (existsSync(full)) {
      for (const file of readdirSync(full)) {
        if (/\.(png|jpe?g|svg|webp|mp4|mov)$/i.test(file)) {
          const kind = /\.(mp4|mov)$/i.test(file) ? "footage" : "image";
          assets.push({ path: `assets/${file}`, kind, source: path.join(full, file) });
        }
      }
    }
  }
  return assets;
}

// CLI: launchclip direct <workspace> --prompt "..." [--words w.json]
// [--take base/x.mp4] [--script-text "..."] [--format explainer]
// [--duration 45] [--music music/bed.mp3] [--no-render]
export async function runDirect(out, flags = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
  // Lazy import keeps the SDK an optional dependency: the linter, catalog,
  // and estimator stay usable (and testable) without it installed.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const log = (message) => process.stderr.write(`[direct] ${message}\n`);

  const preset = String(flags.format ?? "software_demo");
  if (!PRESETS[preset]) throw new Error(`Unknown format "${preset}". Available: ${Object.keys(PRESETS).join(", ")}`);

  // Voice + words: recorded take (words from align/STT) or estimated TTS-less timing.
  let words = null;
  let scriptText = flags["script-text"] ?? null;
  if (flags.words) {
    words = JSON.parse(await readFile(flags.words, "utf8"));
    scriptText = scriptText ?? words.map((word) => word.word).join(" ");
  } else if (scriptText) {
    words = estimateWords(scriptText);
  } else {
    const wordsPath = path.join(out, "video", "words.json");
    if (!existsSync(wordsPath)) throw new Error("Need --words <file>, --script-text, or a prior `launchclip align` (video/words.json).");
    words = JSON.parse(await readFile(wordsPath, "utf8"));
    scriptText = words.map((word) => word.word).join(" ");
  }
  const durationSeconds = Number(flags.duration ?? Math.ceil((words[words.length - 1].end + 0.4) * 10) / 10);

  const baseSrc = flags.take ?? null;
  const voiceoverSrc = baseSrc;
  const musicSrc = flags.music ?? (existsSync(path.join(PACKAGE_ROOT, "public", "music", "golden-bed.mp3")) ? "music/golden-bed.mp3" : "");

  const assets = scanAssets(flags.assets ?? null);
  log(`assets: ${assets.length} | words: ${words.length} | duration: ${durationSeconds}s | preset: ${preset}`);

  const direction = await parseDirection(client, flags.prompt ?? "", assets.map((asset) => asset.path));
  log(`direction: ${direction.must_include.length} must-include, ${direction.asset_refs.length} asset refs`);

  const { timeline, report } = await directTimeline({
    client, words, durationSeconds, assets, direction, preset, scriptText, baseSrc, voiceoverSrc, musicSrc, log
  });

  await mkdir(path.join(out, "video"), { recursive: true });
  const timelinePath = path.join(out, "video", "motion-timeline.json");
  await writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`);
  await writeFile(path.join(out, "video", "direction.json"), `${JSON.stringify(direction, null, 2)}\n`);
  await writeFile(path.join(out, "video", "director-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  let rendered = null;
  if (!flags["no-render"]) {
    log("rendering...");
    rendered = await renderMotion(out, {});
  }
  return {
    stage: "direct",
    timeline: timelinePath,
    attempts: report.attempt,
    advisories: report.advisories,
    rationale: report.rationale,
    video: rendered?.video ?? null
  };
}
