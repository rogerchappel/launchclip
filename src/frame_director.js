import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { ensureTimelineRegistration } from "./hyperframes_timeline.js";
import { OpenAIResponsesClient } from "./openai_responses.js";
import { FRAME_BUNDLE_SCHEMA, PRODUCTION_PATHS, isValidShotId, validateFrameBundle } from "./production_contracts.js";

const FRAME_INSTRUCTIONS = `You are a senior motion designer authoring one modular HyperFrames shot inside a larger film.

Translate the director's shot brief into an original, polished HTML composition. Honor the global design language while making this shot's composition and motion serve its specific idea. Return only the strict frame-bundle JSON.

HyperFrames contract:
- html is one complete SUB-COMPOSITION document. Body contains exactly one <template>; every live <style>, root element, and <script> is inside that template because the host clones only template contents.
- Inside the template, use one root with id="root" and data-composition-id equal to shot_id, data-start="0", the supplied data-duration, width, and height. Style that root with #root, never a root class selector.
- Prefix every non-root element id with "shot_id-" so mounted scenes cannot collide. Motion assertion selectors use those prefixed ids.
- Visual timeline elements use class="clip" with local data-start and data-duration values.
- GSAP is already available as a global. Do not import libraries, fonts, or remote assets. Keep animation seek-safe and deterministic.
- Create the GSAP timeline paused and register it exactly with: window.__timelines = window.__timelines || {}; window.__timelines[shot_id] = timeline. Do not use alternate registry names.
- Do not declare an initial CSS transform on any selector that GSAP animates. Set initial transform state with gsap.set so one system owns the full transform.
- Animate transforms and opacity for movement. Never tween font-size, width, height, top, left, padding, or other layout/reflow properties; author the final readable size in CSS and reveal it with transform/opacity.
- Give every timeline-visible class="clip" element a stable, descriptive, shot-prefixed id for Studio editing and motion inspection.
- Put a full-bleed background on a child layer rather than the composition root; root backgrounds can disappear during frame compositing. Use only declared @font-face families or renderer-safe generic families such as Arial, Georgia, or Courier New; do not name an unavailable platform font.
- Do not include audio or video elements. Request those through root_media_requests; the assembler owns media playback.
- Presenter video follows one continuous production timeline even when its placement changes. Set presenter source_start_seconds to the shot's global start_seconds plus the request's shot-local start_seconds; never restart a presenter take at zero on a later shot.
- Do not fetch, use timers, Date.now, Math.random, requestAnimationFrame, or browser storage.
- Use only supplied local resource paths. If a requested visual asset is unavailable, design a native HTML/CSS/SVG treatment instead of inventing a path.
- When narration_timing is present, synchronize semantic reveals to its shot-local word timestamps instead of estimating speech timing.
- Use transform and opacity for primary motion. Name selectors in motion assertions so inspection can verify the intended reveals.
- Keep essential text and proof inside the frame at all times. Preserve exact visible copy and factual meaning.
- The first and last rendered frame must be intentional, including when mounted next to neighboring shots.`;

export async function directFrames(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const [intake, evidence, plan, narrationTiming] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    readNarrationTiming(workspace)
  ]);
  const store = adapters.store ?? await ProductionJobStore.open(workspace, { create: false });
  if (store.get("creative-plan")?.status !== "succeeded") throw new Error("Creative plan job must succeed before frame delegation");
  const client = adapters.client ?? new OpenAIResponsesClient();
  const concurrency = positiveInteger(options.concurrency ?? 4, "concurrency");
  const tasks = plan.shots.map((shot, index) => () => directOneFrame({ workspace, intake, evidence, plan, shot, index, narrationTiming, store, client, options }));
  const frames = await runPool(tasks, concurrency);
  return {
    stage: "frame-direction",
    status: "ready",
    workspace,
    frames,
    generated: frames.filter((entry) => !entry.cached).length,
    cached: frames.filter((entry) => entry.cached).length
  };
}

export function buildFrameInput({ intake, evidence, plan, shot, index, narrationTiming = null, prior = null, errors = [] }) {
  const neighbors = [plan.shots[index - 1], plan.shots[index + 1]].filter(Boolean).map((entry) => ({
    id: entry.id,
    purpose: entry.purpose,
    transition_out: entry.transition_out,
    visual_description: entry.visual.description
  }));
  const evidenceById = new Map(evidence.items.map((entry) => [entry.id, entry]));
  const resourceById = new Map(intake.resources.map((entry) => [entry.id, entry]));
  const timedWords = (narrationTiming?.words ?? []).filter((word) => Number(word.end) > shot.start_seconds && Number(word.start) < shot.end_seconds).map((word) => ({
    word: word.word,
    global_start_seconds: Number(word.start),
    global_end_seconds: Number(word.end),
    shot_start_seconds: Math.max(0, Number(word.start) - shot.start_seconds),
    shot_end_seconds: Math.min(shot.end_seconds - shot.start_seconds, Number(word.end) - shot.start_seconds)
  }));
  return JSON.stringify({
    global_design: plan.design,
    format: plan.format,
    project: plan.project,
    shot: { ...shot, duration_seconds: shot.end_seconds - shot.start_seconds },
    neighbors,
    evidence: shot.evidence_ids.map((id) => evidenceById.get(id)).filter(Boolean).map((entry) => ({ id: entry.id, title: entry.title, content: entry.content, provenance: entry.provenance })),
    resources: shot.resource_ids.map((id) => resourceById.get(id)).filter(Boolean).map((entry) => ({ id: entry.id, role: entry.role, type: entry.type, local_path: entry.is_remote ? null : entry.location, remote: entry.is_remote })),
    narration_timing: narrationTiming ? { duration_seconds: narrationTiming.duration_seconds, words: timedWords } : null,
    frame_responsibility: "Own visual HTML and motion for this shot only. Request media; do not mount it.",
    prior_attempt: prior,
    validation_errors_to_repair: errors
  });
}

async function directOneFrame({ workspace, intake, evidence, plan, shot, index, narrationTiming, store, client, options }) {
  const jobId = `frame:${shot.id}`;
  const baseInput = buildFrameInput({ intake, evidence, plan, shot, index, narrationTiming });
  const inputHash = semanticHash({ input: baseInput, model: intake.model, reasoning: options.reasoning ?? "high", schema: FRAME_BUNDLE_SCHEMA, worker: "frame-director.v1" });
  const existing = store.get(jobId);
  if (existing?.status === "succeeded" && existing.input_hash === inputHash) {
    const verification = await store.verifyOutputs(jobId);
    if (verification.ok) return { shot_id: shot.id, cached: true, outputs: verification.outputs, response_id: existing.remote?.response_id ?? null };
    await store.markStaleFrom([jobId]);
  } else if (existing && existing.input_hash !== inputHash) {
    await store.markStaleFrom([jobId]);
  }
  const current = store.get(jobId);
  let resumeResponseId = null;
  if (!current) await store.add({ id: jobId, kind: "frame", depends_on: ["creative-plan"], input_hash: inputHash, max_attempts: Number(options.maxAttempts ?? 3) });
  else if (current.status === "failed" || current.status === "stale") await store.retry(jobId, { inputHash });
  else if (current.status === "running" || current.status === "submitted") {
    if (!current.remote?.response_id) throw new Error(`Frame job is ${current.status} without a resumable response id: ${jobId}`);
    resumeResponseId = current.remote.response_id;
  } else if (current.status !== "pending") throw new Error(`Frame job is already ${current.status}: ${jobId}`);

  if (!resumeResponseId) await store.markRunning(jobId, { provider: "openai", response_id: null, status: "running" });
  let prior = null;
  let errors = [];
  try {
    for (let attempt = 1; attempt <= Number(options.semanticAttempts ?? 2); attempt += 1) {
      const request = {
        model: intake.model?.id ?? "gpt-5.6",
        reasoningEffort: options.reasoning ?? "high",
        reasoningContext: "current_turn",
        pro: false,
        instructions: FRAME_INSTRUCTIONS,
        input: buildFrameInput({ intake, evidence, plan, shot, index, narrationTiming, prior, errors }),
        schema: FRAME_BUNDLE_SCHEMA,
        schemaName: "launchclip_frame_bundle",
        background: options.background !== false,
        maxOutputTokens: Number(options.maxOutputTokens ?? 36_000),
        promptCacheKey: "launchclip:frame-director:v1",
        metadata: { job_id: jobId, shot_id: shot.id, attempt },
        onSubmitted: async (response) => store.markRunning(jobId, { provider: "openai", response_id: response.id, status: response.status })
      };
      const result = resumeResponseId ? await client.resumeStructured(resumeResponseId, request) : await client.runStructured(request);
      resumeResponseId = null;
      const candidate = { ...result.value, html: ensureTimelineRegistration(result.value.html, shot.id) };
      const validation = validateFrameBundle(candidate, {
        shotId: shot.id,
        shot,
        format: plan.format,
        evidenceIds: evidence.items.map((entry) => entry.id),
        resourceIds: intake.resources.map((entry) => entry.id),
        resourceRoles: Object.fromEntries(intake.resources.map((entry) => [entry.id, entry.role])),
        allowedAssetPaths: intake.resources.filter((entry) => !entry.is_remote && entry.type !== "directory").map((entry) => entry.location)
      });
      errors = [...validation.errors, ...validateHyperFramesRoot(candidate.html, shot, plan.format)];
      if (errors.length) {
        prior = candidate;
        if (attempt < Number(options.semanticAttempts ?? 2)) continue;
        throw new Error(`Frame ${shot.id} failed semantic validation: ${errors.join("; ")}`);
      }
      const paths = await writeFrameArtifacts(workspace, candidate);
      await store.markRunning(jobId, { provider: "openai", response_id: result.response_id, status: result.status });
      const outputs = await Promise.all(paths.map((filePath) => describeJobOutput(workspace, filePath)));
      await store.markSucceeded(jobId, outputs, result.usage);
      return { shot_id: shot.id, cached: false, bundle: paths[0], html: paths[1], motion: paths[2], response_id: result.response_id, model: result.model, usage: result.usage };
    }
    throw new Error(`Frame ${shot.id} exhausted semantic attempts`);
  } catch (error) {
    await store.markFailed(jobId, error);
    throw error;
  }
}

export function validateHyperFramesRoot(html, shot, format) {
  const errors = [];
  const source = String(html ?? "");
  const templates = [...source.matchAll(/<template\b[^>]*>([\s\S]*?)<\/template>/gi)];
  if (templates.length !== 1) return ["frame HTML requires exactly one template transport container"];
  const template = templates[0][1];
  const outsideTemplate = `${source.slice(0, templates[0].index)}${source.slice(templates[0].index + templates[0][0].length)}`;
  if (/<(?:style|script)\b/i.test(outsideTemplate)) errors.push("all live style and script blocks must be inside the template");
  const root = template.match(/<[^>]+data-composition-id=["']([^"']+)["'][^>]*>/i)?.[0] ?? "";
  if (!root) return ["frame HTML requires a data-composition-id root"];
  const attr = (name) => root.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
  if (attr("id") !== "root") errors.push('sub-composition root id must be "root"');
  if (attr("class")) errors.push("sub-composition root must not use a class; style it with #root");
  if (attr("data-composition-id") !== shot.id) errors.push(`root data-composition-id must be ${shot.id}`);
  if (Number(attr("data-start")) !== 0) errors.push("root data-start must be 0");
  const duration = shot.end_seconds - shot.start_seconds;
  if (Math.abs(Number(attr("data-duration")) - duration) > 0.01) errors.push(`root data-duration must be ${duration}`);
  if (Number(attr("data-width")) !== format.width) errors.push(`root data-width must be ${format.width}`);
  if (Number(attr("data-height")) !== format.height) errors.push(`root data-height must be ${format.height}`);
  if (!/#root\s*\{/i.test(template)) errors.push("sub-composition root must be styled by #root inside the template");
  if (!new RegExp(`window\\.__timelines\\s*\\[\\s*["']${escapeRegExp(shot.id)}["']\\s*\\]`).test(template)) errors.push(`template must register window.__timelines[${shot.id}]`);
  const ids = [...template.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1]);
  const invalidIds = ids.filter((id) => id !== "root" && !id.startsWith(`${shot.id}-`));
  if (invalidIds.length) errors.push(`non-root ids must be prefixed with ${shot.id}-: ${[...new Set(invalidIds)].join(", ")}`);
  return errors;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function writeFrameArtifacts(workspace, bundle) {
  const directory = path.join(workspace, PRODUCTION_PATHS.frames);
  const bundlePath = safeShotFile(directory, bundle.shot_id, ".json");
  const htmlPath = safeShotFile(directory, bundle.shot_id, ".html");
  const motionPath = safeShotFile(directory, bundle.shot_id, ".motion.json");
  await writeAtomic(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  await writeAtomic(htmlPath, `${bundle.html.trim()}\n`);
  await writeAtomic(motionPath, `${JSON.stringify(bundle.motion, null, 2)}\n`);
  return [bundlePath, htmlPath, motionPath];
}

export function safeShotFile(directory, shotId, suffix) {
  if (!isValidShotId(shotId)) throw new Error(`Unsafe shot ID: ${shotId}`);
  if (!/^\.[a-z0-9.-]+$/i.test(suffix)) throw new Error(`Unsafe shot artifact suffix: ${suffix}`);
  const root = path.resolve(directory);
  const output = path.resolve(root, `${shotId}${suffix}`);
  if (path.dirname(output) !== root) throw new Error(`Shot artifact escapes its directory: ${shotId}`);
  return output;
}

async function runPool(tasks, concurrency) {
  const output = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      output[index] = await tasks[index]();
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  const failed = settled.find((entry) => entry.status === "rejected");
  if (failed) throw failed.reason;
  return output;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readNarrationTiming(workspace) {
  try {
    const manifest = await readJson(path.join(workspace, "production", "media", "manifest.json"));
    const voiceover = manifest.voiceover;
    if (!voiceover?.words_path) return voiceover?.duration_seconds ? { duration_seconds: voiceover.duration_seconds, words: [] } : null;
    return { duration_seconds: voiceover.duration_seconds, words: await readJson(path.resolve(voiceover.words_path)) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}
