import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeShotFile, validateHyperFramesRoot } from "./frame_director.js";
import { describeJobOutput, ProductionJobStore } from "./job_store.js";
import { OpenAIResponsesClient } from "./openai_responses.js";
import { FRAME_BUNDLE_SCHEMA, PRODUCTION_PATHS, validateFrameBundle } from "./production_contracts.js";

const REPAIR_INSTRUCTIONS = `You are repairing one previously authored HyperFrames shot after independent review.

Return a complete replacement frame-bundle JSON. Fix every supplied finding at the smallest scope. Preserve everything listed in each finding and everything in the prior bundle that does not conflict with the repair. Do not redesign unrelated elements.

The replacement must remain a deterministic modular HyperFrames composition: one correctly sized local-time root, class="clip" for timed elements, no remote assets, no fetches, no audio/video tags, and all media requested at the host root with structured placement. Keep exact factual copy and evidence IDs.

Register a paused GSAP timeline exactly on window.__timelines[shot_id]. Give every timeline-visible clip a stable descriptive ID. Style the root by its ID, not a root class. Use only declared @font-face families or Arial, Georgia, or Courier New. Never tween font-size, width, height, top, left, padding, or other reflow properties; use transform and opacity, with initial transforms owned by gsap.set rather than CSS.`;

export async function repairProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const [intake, evidence, plan, critique] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    readJson(path.join(qaDir, "critique.json"))
  ]);
  if (critique.verdict === "ship") return { stage: "production-repair", status: "not-needed", repaired: [] };
  if (critique.verdict === "replan") throw new Error("Critique requires broader work before frame repair: replan");
  const repairableScopes = new Set(["frame", "frames", "assembly", "design"]);
  const repairable = critique.findings.filter((finding) => repairableScopes.has(finding.repair_scope) && finding.shot_ids.length);
  const unsupported = critique.findings.filter((finding) => !repairable.includes(finding));
  const byShot = new Map();
  for (const finding of repairable) {
    for (const shotId of finding.shot_ids) {
      if (!byShot.has(shotId)) byShot.set(shotId, []);
      byShot.get(shotId).push(finding);
    }
  }
  if (!byShot.size) throw new Error(`Critique requires broader work before frame repair: ${unsupported.map((entry) => `${entry.id}:${entry.repair_scope}`).join(", ") || "no repairable shot IDs"}`);
  const store = adapters.store ?? await ProductionJobStore.open(workspace, { create: false });
  const jobIds = [...byShot.keys()].map((shotId) => `frame:${shotId}`);
  const resumableJobIds = new Set(jobIds.filter((jobId) => {
    const job = store.get(jobId);
    return (job?.status === "running" || job?.status === "submitted") && job.remote?.response_id;
  }));
  await store.markStaleFrom(jobIds.filter((jobId) => !resumableJobIds.has(jobId)));
  const client = adapters.client ?? new OpenAIResponsesClient();
  const images = await snapshotImages(path.join(qaDir, "snapshots"), Number(options.maxSnapshots ?? 8));
  const repaired = [];
  const tasks = [...byShot].map(([shotId, findings]) => async () => {
    const shot = plan.shots.find((entry) => entry.id === shotId);
    if (!shot) throw new Error(`Critique references unknown shot: ${shotId}`);
    const prior = await readJson(safeShotFile(path.join(workspace, PRODUCTION_PATHS.frames), shotId, ".json"));
    const jobId = `frame:${shotId}`;
    const current = store.get(jobId);
    let resumeResponseId = null;
    if (current.status === "running" || current.status === "submitted") {
      if (!current.remote?.response_id) throw new Error(`Repair job is ${current.status} without a resumable response id: ${jobId}`);
      resumeResponseId = current.remote.response_id;
    } else {
      if (current.status === "failed" || current.status === "stale") await store.retry(jobId);
      await store.markRunning(jobId, { provider: "openai", response_id: null, status: "repairing" });
    }
    try {
      const request = {
        model: options.model ?? "gpt-5.6",
        reasoningEffort: options.reasoning ?? "high",
        reasoningContext: "current_turn",
        instructions: REPAIR_INSTRUCTIONS,
        input: JSON.stringify({
          global_design: plan.design,
          format: plan.format,
          shot,
          findings,
          prior_bundle: prior,
          available_resources: intake.resources.map((entry) => ({ id: entry.id, role: entry.role, type: entry.type, local_path: entry.is_remote ? null : entry.location })),
          evidence_index: evidence.items.map((entry) => ({ id: entry.id, title: entry.title, provenance: entry.provenance }))
        }),
        images,
        schema: FRAME_BUNDLE_SCHEMA,
        schemaName: "launchclip_repaired_frame_bundle",
        background: options.background !== false,
        maxOutputTokens: Number(options.maxOutputTokens ?? 36_000),
        promptCacheKey: "launchclip:frame-repair:v1",
        metadata: { job_id: jobId, shot_id: shotId, repair_findings: findings.length },
        onSubmitted: async (response) => store.markRunning(jobId, { provider: "openai", response_id: response.id, status: response.status })
      };
      const result = resumeResponseId ? await client.resumeStructured(resumeResponseId, request) : await client.runStructured(request);
      const validation = validateFrameBundle(result.value, {
        shotId,
        evidenceIds: evidence.items.map((entry) => entry.id),
        resourceIds: intake.resources.map((entry) => entry.id),
        allowedAssetPaths: intake.resources.filter((entry) => !entry.is_remote && entry.type !== "directory").map((entry) => entry.location)
      });
      const errors = [...validation.errors, ...validateHyperFramesRoot(result.value.html, shot, plan.format)];
      if (errors.length) throw new Error(`Repaired frame ${shotId} failed validation: ${errors.join("; ")}`);
      const paths = await writeFrameArtifacts(workspace, result.value);
      await store.markRunning(jobId, { provider: "openai", response_id: result.response_id, status: result.status });
      const outputs = await Promise.all(paths.map((filePath) => describeJobOutput(workspace, filePath)));
      await store.markSucceeded(jobId, outputs, result.usage);
      repaired.push({ shot_id: shotId, findings: findings.map((entry) => entry.id), bundle: paths[0], html: paths[1], response_id: result.response_id });
    } catch (error) {
      await store.markFailed(jobId, error);
      throw error;
    }
  });
  await runPool(tasks, Number(options.concurrency ?? 3));
  return {
    stage: "production-repair",
    status: unsupported.length ? "partially-repaired" : "repaired",
    repaired,
    blockers: unsupported.map((finding) => ({ id: finding.id, repair_scope: finding.repair_scope, instruction: finding.instruction })),
    next: "Re-run launchclip assemble and production-verify; resolve any listed blockers before production-render."
  };
}

async function runPool(tasks, concurrency) {
  if (!Number.isInteger(concurrency) || concurrency <= 0) throw new Error("Repair concurrency must be a positive integer");
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      await tasks[index]();
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  const failed = settled.find((entry) => entry.status === "rejected");
  if (failed) throw failed.reason;
}

async function writeFrameArtifacts(workspace, bundle) {
  const directory = path.join(workspace, PRODUCTION_PATHS.frames);
  const paths = [safeShotFile(directory, bundle.shot_id, ".json"), safeShotFile(directory, bundle.shot_id, ".html"), safeShotFile(directory, bundle.shot_id, ".motion.json")];
  await writeAtomic(paths[0], `${JSON.stringify(bundle, null, 2)}\n`);
  await writeAtomic(paths[1], `${bundle.html.trim()}\n`);
  await writeAtomic(paths[2], `${JSON.stringify(bundle.motion, null, 2)}\n`);
  return paths;
}

async function snapshotImages(directory, limit) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  return Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return { url: `data:${mime};base64,${(await readFile(filePath)).toString("base64")}`, detail: "original" };
  }));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, filePath);
}
