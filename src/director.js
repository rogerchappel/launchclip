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

// Provider abstraction. The Director was built against the Anthropic messages
// API; this lets it also run on an OpenAI key. The shim exposes the same
// `.messages.create(params)` surface the Director uses and translates it to
// the OpenAI chat-completions REST API (no SDK dependency — plain fetch),
// shaping the reply back into Anthropic's `{ content: [{ type, text }] }`.
// Anthropic-only params (output_config, thinking, cache_control) are ignored
// by the shim; every Director call wants a single JSON object, so JSON mode
// is always on. Anthropic stays the default when its key is present.
function openAiMessagesShim({ apiKey, model }) {
  return {
    messages: {
      create: async (params) => {
        const systemText = Array.isArray(params.system)
          ? params.system.map((block) => (typeof block === "string" ? block : block.text ?? "")).join("\n\n")
          : String(params.system ?? "");
        const messages = [
          { role: "system", content: `${systemText}\n\nAlways respond with a single valid JSON object and nothing else.` }
        ];
        for (const message of params.messages ?? []) {
          const content = typeof message.content === "string"
            ? message.content
            : (message.content ?? []).map((part) => (typeof part === "string" ? part : part.text ?? "")).join("\n");
          messages.push({ role: message.role, content });
        }
        // Reasoning models (o-series, gpt-5*) use max_completion_tokens and
        // reject max_tokens/temperature; they also need extra budget for the
        // hidden reasoning tokens. Chat models accept max_completion_tokens too.
        const reasoning = /^(o\d|gpt-5)/.test(model);
        const body = {
          model,
          messages,
          max_completion_tokens: (params.max_tokens ?? 8000) + (reasoning ? 12000 : 0),
          response_format: { type: "json_object" }
        };
        if (reasoning) body.reasoning_effort = "medium";
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 400);
          throw Object.assign(new Error(`OpenAI ${response.status}: ${detail}`), { status: response.status });
        }
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content ?? "";
        if (!text) throw new Error("OpenAI returned empty content");
        return { content: [{ type: "text", text }] };
      }
    }
  };
}

// Pick the LLM provider: an explicit --provider flag wins; otherwise prefer
// Anthropic (project default) and fall back to OpenAI when only its key is set.
export async function makeDirectorClient(flags = {}, log = () => {}) {
  const choice = flags.provider
    ? String(flags.provider)
    : process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : null;
  if (choice === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    log(`provider: anthropic (${MODEL})`);
    return new Anthropic();
  }
  if (choice === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set.");
    // Default to a reasoning model: the strict density/word-grounding linter
    // needs it (gpt-4o/gpt-4.1 rarely pass in the repair budget). gpt-5.5
    // lands valid, lint-clean AND gap-free; o4-mini works as a cheaper
    // fallback. Override via --model or OPENAI_MODEL.
    const model = flags.model || process.env.OPENAI_MODEL || "gpt-5.5";
    log(`provider: openai (${model})`);
    return openAiMessagesShim({ apiKey: process.env.OPENAI_API_KEY, model });
  }
  throw new Error("No LLM key set. Set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY, or pass --provider.");
}

// Condensed hard rules from ART_DIRECTION.md — the part of the spec the
// Director must internalize. The validator and linter enforce the rest.
const ART_DIGEST = `## Art direction (hard rules)
You are directing a short-form video in the "paper world" grammar: a warm paper
tabletop with a faint grid; every piece of content is a physical card with a
soft shadow, placed and built on that paper. The voice is continuous; the
vision transforms constantly.

1. STRUCTURE: voice runs unbroken; the visual base is scenes butt-joined on the
   clock. Scenes persist 2-6s while builds run INSIDE them. Every scene change
   is an instant hard cut — the new composition appears immediately and its
   builds carry the motion. Don't author travel transitions; motion lives
   inside scenes (entrances, reflow, drift), never between them.
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

async function createWithSchemaRetry(client, params, { retries = 3, log = () => {} } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.messages.create(params);
    } catch (error) {
      const message = String(error?.message ?? "");
      const compileTimeout = error?.status === 400 && /grammar compilation/i.test(message);
      if (!compileTimeout || attempt >= retries) throw error;
      log(`schema grammar compiling — retry ${attempt + 1}/${retries} in 4s`);
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }
}

function firstText(response) {
  const block = response.content.find((entry) => entry.type === "text");
  if (!block) throw new Error("model returned no text block");
  return block.text;
}

// Tolerant JSON extraction for calls that skip structured outputs.
function parseJsonLoose(text) {
  let candidate = text.trim();
  if (candidate.startsWith("```")) candidate = candidate.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object in response");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

// Free-text creative direction -> structured contract the linter can verify.
export async function parseDirection(client, promptText, assetPaths = []) {
  if (!promptText || !promptText.trim()) {
    return { must_include: [], asset_refs: [], chapters: [], energy: "high", emphasis_moments: [], cta_text: null };
  }
  const response = await createWithSchemaRetry(client, {
    model: MODEL,
    max_tokens: 4000,
    system:
      "Parse a video creative-direction prompt into the requested JSON. must_include is ONLY literal content the video must contain: step lists, exact lines, names, numbers — written as the content itself, never as instructions about visuals. Component/visual choices (use a stat counter, use an icon flow, chapter rail on) are NOT must_include — capture chapter names in chapters and key moments in emphasis_moments instead. Only list asset_refs for assets the prompt explicitly references (match against the provided asset paths).",
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

// ElevenLabs TTS + scribe alignment: a fully autonomous voice path. Returns
// { voicePath (renderer-relative), words } with REAL timings to align to.
export async function synthesizeVoice(scriptText, { log = () => {} } = {}) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is required for --voice tts");
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  log("tts: synthesizing voiceover");
  const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: scriptText, model_id: "eleven_multilingual_v2" })
  });
  if (!ttsResponse.ok) throw new Error(`ElevenLabs TTS failed (${ttsResponse.status}): ${(await ttsResponse.text()).slice(0, 200)}`);
  const audio = Buffer.from(await ttsResponse.arrayBuffer());
  const voiceDir = path.join(PACKAGE_ROOT, "public", "voice");
  await mkdir(voiceDir, { recursive: true });
  const fileName = `tts-${Date.now()}.mp3`;
  await writeFile(path.join(voiceDir, fileName), audio);
  log("tts: transcribing for word timings");
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "voice.mp3");
  form.append("model_id", "scribe_v1");
  const sttResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
  if (!sttResponse.ok) throw new Error(`scribe failed (${sttResponse.status})`);
  const transcript = await sttResponse.json();
  const words = (transcript.words ?? []).filter((entry) => entry.type === "word").map((entry) => ({ word: entry.text, start: entry.start, end: entry.end }));
  if (!words.length) throw new Error("scribe returned no words");
  return { voicePath: `voice/${fileName}`, words };
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

export async function directTimeline({ client, words, durationSeconds, assets, direction, preset, scriptText, baseSrc, voiceoverSrc, musicSrc, priorDraft = null, priorIssues = "", log = () => {} }) {
  const system = [{ type: "text", text: buildSystemPrompt(preset), cache_control: { type: "ephemeral" } }];
  const manifest = assets.map((asset) => `- ${asset.path} (${asset.kind})`).join("\n") || "(no assets — graphic scenes only)";
  const baseInput = [
    `DURATION: ${durationSeconds}s exactly. Scenes must cover 0 to ${durationSeconds}.`,
    `SCRIPT (the voiceover):\n${scriptText}`,
    `WORD TIMINGS (item "at" values MUST be these start times):\n${JSON.stringify(words)}`,
    `ASSET MANIFEST (the only media paths you may reference):\n${manifest}`,
    baseSrc ? `PRESENTER FOOTAGE: ${baseSrc} (continuous take aligned to t=0; talking_head scenes use this src)` : "PRESENTER FOOTAGE: none — do not use talking_head scenes.",
    `CREATIVE DIRECTION (must be honored):\n${JSON.stringify(direction)}`,
    priorDraft
      ? `STARTING DRAFT (authored per-scene; repair the listed issues, keep everything that works):\n${JSON.stringify(priorDraft)}\n\nISSUES TO FIX:\n${priorIssues}`
      : "",
    'Return ONLY a JSON object, no other text: {"scenes": [...], "events": [...], "chapters": [...or empty...], "rationale": "one paragraph"}.'
  ].filter(Boolean).join("\n\n");

  let feedback = "";
  let lastReport = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    log(`director attempt ${attempt}/${MAX_ATTEMPTS}`);
    const response = await createWithSchemaRetry(client, {
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: feedback ? `${baseInput}\n\nYOUR PREVIOUS ATTEMPT FAILED. Fix ALL of these and return the corrected full timeline:\n${feedback}` : baseInput }],
    });
    const draft = parseJsonLoose(firstText(response));
    const candidate = {
      version: MOTION_TIMELINE_VERSION,
      duration_seconds: durationSeconds,
      base: { type: baseSrc ? "video" : "placeholder", src: baseSrc ?? "" },
      audio: { voiceover: voiceoverSrc ?? "", music: musicSrc ?? "", music_volume: voiceoverSrc ? 0.16 : 0.3 },
      words,
      scenes: draft.scenes,
      chapters: draft.chapters ?? [],
      events: draft.events
    };
    const validation = validateTimeline(candidate);
    const lint = validation.ok ? lintTimeline(validation.timeline, { direction, assets, presenterSrc: baseSrc }) : { ok: false, failures: [], advisories: [] };
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

const STRUCTURE_SCHEMA = {
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
          intent: { type: "string" }
        },
        required: ["id", "type", "start", "end", "transition", "intent"],
        additionalProperties: false
      }
    },
    chapters: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, at: { type: "number" } },
        required: ["title", "at"],
        additionalProperties: false
      }
    },
    rationale: { type: "string" }
  },
  required: ["scenes", "chapters"],
  additionalProperties: false
};

const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["ship", "revise"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scene_id: { type: "string" },
          issue: { type: "string" },
          fix: { type: "string" }
        },
        required: ["issue", "fix"],
        additionalProperties: false
      }
    }
  },
  required: ["verdict", "findings"],
  additionalProperties: false
};

const CRITIC_CHECKLIST = `A render is disqualified by any of: a scene over 6s or sitting visually idle;
two focal elements fighting; accent color in more than one place at a time; builds that ignore the
voice; a hook that doesn't grab in 3s; a CTA without a payoff word; repetitive scene types back to
back saying the same thing; chapter rail entries that don't match the actual beats; any fabricated
media reference. Also judge: does the sequence FLOW (each scene answers the previous), and does the
creative direction actually shape the result?`;

// --quality high: structure pass -> parallel per-scene authors -> stitch ->
// adversarial critic -> one full repair round if needed. Each author gets a
// 3-second canvas instead of sixty, which is where per-scene craft comes from.
export async function directHighTimeline(ctx) {
  const { client, words, durationSeconds, assets, direction, preset, scriptText, baseSrc, log = () => {} } = ctx;
  const system = [{ type: "text", text: buildSystemPrompt(preset), cache_control: { type: "ephemeral" } }];
  const manifest = assets.map((asset) => `- ${asset.path} (${asset.kind})`).join("\n") || "(no assets)";

  log("structure pass");
  const structureResponse = await createWithSchemaRetry(client, {
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system,
    messages: [{
      role: "user",
      content: `Plan ONLY the beat sheet (no items yet): scene skeletons {id,type,start,end,transition,intent} covering 0 to ${durationSeconds}s exactly, plus chapters [] (2-6 short titles, or empty if a rail doesn't fit). "intent" is one sentence the scene's author will execute.\n\nSCRIPT:\n${scriptText}\n\nWORD TIMINGS:\n${JSON.stringify(words)}\n\nASSETS:\n${manifest}\n\nPRESENTER FOOTAGE: ${baseSrc ?? "none"}\n\nCREATIVE DIRECTION:\n${JSON.stringify(direction)}`
    }],
    output_config: { format: { type: "json_schema", schema: STRUCTURE_SCHEMA } }
  });
  const structure = JSON.parse(firstText(structureResponse));
  log(`structure: ${structure.scenes.length} scenes, ${structure.chapters.length} chapters`);

  log(`authoring ${structure.scenes.length} scenes in parallel`);
  const authorScene = async (skeleton, index) => {
      const sliceStart = Math.max(0, skeleton.start - 0.4);
      const sliceEnd = skeleton.end + 0.4;
      const slice = words.filter((word) => word.start >= sliceStart && word.start <= sliceEnd);
      const neighbors = [structure.scenes[index - 1], structure.scenes[index + 1]]
        .filter(Boolean)
        .map((scene) => `${scene.id} (${scene.type}): ${scene.intent}`)
        .join("\n");
      const response = await createWithSchemaRetry(client, {
        model: MODEL,
        max_tokens: 6000,
        system,
        messages: [{
          role: "user",
          content: `Author ONE scene in full detail. Return ONLY a JSON object {"scene": {...}, "events": [...]} with no other text. Keep id/type/start/end/transition EXACTLY as given; fill everything else (items word-timed from the slice, layout/src/text/value as the type needs). You may add at most one punch_zoom event inside this scene's time range, and a logo_pop only if an asset demands it. events may be [].\n\nSCENE SKELETON:\n${JSON.stringify(skeleton)}\n\nWORDS SPOKEN DURING THIS SCENE:\n${JSON.stringify(slice)}\n\nNEIGHBOR INTENTS:\n${neighbors}\n\nASSETS:\n${manifest}\n\nPRESENTER FOOTAGE: ${baseSrc ?? "none"}\n\nCREATIVE DIRECTION:\n${JSON.stringify(direction)}`
        }],
      }, { log });
      return parseJsonLoose(firstText(response));
  };
  // Warm the author grammar once (compilation is cached), then fan out.
  const first = await authorScene(structure.scenes[0], 0);
  const rest = await Promise.all(structure.scenes.slice(1).map((skeleton, index) => authorScene(skeleton, index + 1)));
  const authored = [first, ...rest];

  const draft = {
    scenes: authored.map((entry) => entry.scene),
    events: authored.flatMap((entry, index) => entry.events.map((event, eventIndex) => ({ ...event, id: `${event.id || "ev"}-s${index}-${eventIndex}` }))),
    chapters: structure.chapters
  };

  log("critic pass");
  const criticResponse = await createWithSchemaRetry(client, {
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: `You are an adversarial reviewer of motion-graphics timelines. ${CRITIC_CHECKLIST}` }],
    messages: [{ role: "user", content: `SCRIPT:\n${scriptText}\n\nCREATIVE DIRECTION:\n${JSON.stringify(direction)}\n\nTIMELINE:\n${JSON.stringify(draft)}\n\nVerdict?` }],
    output_config: { format: { type: "json_schema", schema: CRITIC_SCHEMA } }
  });
  const critique = JSON.parse(firstText(criticResponse));
  log(`critic: ${critique.verdict} (${critique.findings.length} findings)`);

  // Stitch + check; on any issue (mechanical or critical), one full repair
  // round via the single-pass director seeded with this draft.
  const candidate = {
    version: MOTION_TIMELINE_VERSION,
    duration_seconds: ctx.durationSeconds,
    base: { type: baseSrc ? "video" : "placeholder", src: baseSrc ?? "" },
    audio: { voiceover: ctx.voiceoverSrc ?? "", music: ctx.musicSrc ?? "", music_volume: ctx.voiceoverSrc ? 0.16 : 0.3 },
    words,
    scenes: draft.scenes,
    chapters: draft.chapters,
    events: draft.events
  };
  const validation = validateTimeline(candidate);
  const lint = validation.ok ? lintTimeline(validation.timeline, { direction, assets, presenterSrc: baseSrc }) : { ok: false, failures: [], advisories: [] };
  const criticIssues = critique.verdict === "revise" ? critique.findings.map((finding) => `CRITIC (${finding.scene_id ?? "global"}): ${finding.issue} — fix: ${finding.fix}`) : [];
  const issues = [...validation.errors.map((error) => `SCHEMA: ${error}`), ...lint.failures.map((failure) => `LINT: ${failure}`), ...criticIssues];

  if (!issues.length) {
    log("high path: clean on first stitch");
    return { timeline: validation.timeline, report: { mode: "high", scenes: draft.scenes.length, critic: critique, attempt: 1, advisories: [...validation.warnings, ...lint.advisories] } };
  }
  log(`high path: ${issues.length} issues -> repair round`);
  const repaired = await directTimeline({ ...ctx, priorDraft: draft, priorIssues: issues.join("\n") });
  repaired.report.mode = "high+repair";
  repaired.report.critic = critique;
  return repaired;
}

// Scan known public/ dirs + an optional assets dir into a manifest of
// renderer-resolvable paths.
export function scanAssets(extraDir = null) {
  const assets = [];
  const add = (dir, kind, prefix) => {
    const full = path.join(PACKAGE_ROOT, "public", dir);
    if (!existsSync(full)) return;
    for (const file of readdirSync(full)) {
      if (file === "talking-head.mp4") continue; // generated stand-in, never directable
      if (/\.(png|jpe?g|svg|webp|mp4|mov)$/i.test(file)) assets.push({ path: `${prefix}/${file}`, kind });
    }
  };
  add("logos", "icon", "logos");
  add("icons", "generic-icon", "icons");
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
  const log = (message) => process.stderr.write(`[direct] ${message}\n`);
  // Anthropic (default) or OpenAI, by key/flag. Lazy: the linter, catalog,
  // and estimator stay usable (and testable) without any SDK installed.
  const client = await makeDirectorClient(flags, log);

  const preset = String(flags.format ?? "software_demo");
  if (!PRESETS[preset]) throw new Error(`Unknown format "${preset}". Available: ${Object.keys(PRESETS).join(", ")}`);

  // Voice + words: recorded take (words from align/STT) or estimated TTS-less timing.
  let words = null;
  let scriptText = flags["script-text"] ?? null;
  if (flags.words) {
    words = JSON.parse(await readFile(flags.words, "utf8"));
    scriptText = scriptText ?? words.map((word) => word.word).join(" ");
  } else if (scriptText && flags.voice === "tts") {
    const synthesized = await synthesizeVoice(scriptText, { log });
    words = synthesized.words;
    flags["voice-src"] = synthesized.voicePath;
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
  const voiceoverSrc = flags["voice-src"] ?? baseSrc;
  const musicSrc = flags.music ?? (existsSync(path.join(PACKAGE_ROOT, "public", "music", "golden-bed.mp3")) ? "music/golden-bed.mp3" : "");

  const assets = scanAssets(flags.assets ?? null);
  log(`assets: ${assets.length} | words: ${words.length} | duration: ${durationSeconds}s | preset: ${preset}`);

  const direction = await parseDirection(client, flags.prompt ?? "", assets.map((asset) => asset.path));
  log(`direction: ${direction.must_include.length} must-include, ${direction.asset_refs.length} asset refs`);

  const quality = String(flags.quality ?? "fast");
  const directFn = quality === "high" ? directHighTimeline : directTimeline;
  const { timeline, report } = await directFn({
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
